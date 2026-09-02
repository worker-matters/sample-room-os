package com.sampleroom.tablet.web

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

data class WebUiPackageFile(val path: String, val size: Long, val sha256: String)

data class WebUiPackageManifest(
    val uiVersion: String,
    val bundleSha256: String,
    val downloadBasePath: String,
    val files: List<WebUiPackageFile>
)

object WebUiPackageManifestParser {
    private val versionPattern = Regex("[0-9]{4}\\.[0-9]{2}\\.[0-9]{2}\\.[0-9]{6}")
    private val shaPattern = Regex("[a-f0-9]{64}")

    fun parse(raw: String): WebUiPackageManifest {
        val json = JSONObject(raw)
        require(json.optInt("formatVersion") == 1) { "工作界面清单版本不兼容" }
        val uiVersion = json.getString("uiVersion")
        require(versionPattern.matches(uiVersion)) { "工作界面版本无效" }
        val bundleSha256 = json.getString("bundleSha256")
        require(shaPattern.matches(bundleSha256)) { "工作界面完整性信息无效" }
        val downloadBasePath = json.getString("downloadBasePath")
        require(downloadBasePath.startsWith("/api/tablet/web-ui/files/") && downloadBasePath.endsWith('/')) {
            "工作界面下载地址无效"
        }
        val source = json.getJSONArray("files")
        require(source.length() in 1..2_000) { "工作界面文件数量无效" }
        val files = buildList {
            repeat(source.length()) { index ->
                val item = source.getJSONObject(index)
                val path = item.getString("path")
                require(isSafeRelativePath(path)) { "工作界面文件路径无效" }
                val size = item.getLong("size")
                require(size in 0..100_000_000) { "工作界面文件大小无效" }
                val sha256 = item.getString("sha256")
                require(shaPattern.matches(sha256)) { "工作界面文件校验信息无效" }
                add(WebUiPackageFile(path, size, sha256))
            }
        }
        require(files.map(WebUiPackageFile::path).toSet().size == files.size) { "工作界面文件重复" }
        require(files.sumOf(WebUiPackageFile::size) <= 200_000_000) { "工作界面总大小超出限制" }
        require(files.any { it.path == "index.html" }) { "工作界面缺少入口文件" }
        return WebUiPackageManifest(uiVersion, bundleSha256, downloadBasePath, files)
    }

    private fun isSafeRelativePath(path: String): Boolean =
        path.isNotBlank() && path.length <= 240 && !path.startsWith('/') &&
            !path.contains('\\') && path.split('/').none { it.isBlank() || it == "." || it == ".." }
}

class WebUiPackageClient(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()
) {
    fun fetchManifest(baseUrl: String): WebUiPackageManifest {
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/tablet/web-ui/manifest")
            .header("Accept", "application/json")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "当前服务器未提供工作界面更新" }
            return WebUiPackageManifestParser.parse(response.body?.string().orEmpty())
        }
    }

    fun download(baseUrl: String, manifest: WebUiPackageManifest, file: WebUiPackageFile, target: File) {
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}${manifest.downloadBasePath}${file.path}")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "工作界面文件下载失败" }
            target.parentFile?.mkdirs()
            response.body?.byteStream()?.use { input -> target.outputStream().use(input::copyTo) }
                ?: error("工作界面文件内容为空")
        }
        check(target.length() == file.size && sha256(target) == file.sha256) { "工作界面文件校验失败" }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}

class WebUiPackageStore(context: Context, private val client: WebUiPackageClient = WebUiPackageClient()) {
    private val root = File(context.filesDir, "pad-web-ui")
    private val versions = File(root, "versions")
    private val preferences = context.getSharedPreferences("sample-room-pad-web-ui-v1", Context.MODE_PRIVATE)

    fun activeVersion(): String? = preferences.getString("activeVersion", null)
    fun previousVersion(): String? = preferences.getString("previousVersion", null)

    fun prepare(baseUrl: String, manifest: WebUiPackageManifest, onProgress: (Int, Int) -> Unit = { _, _ -> }) {
        if (isComplete(manifest)) return
        root.mkdirs()
        versions.mkdirs()
        root.listFiles()?.filter { it.name.startsWith("staging-") }?.forEach(File::deleteRecursively)
        val keepBeforeConfirmation = setOfNotNull(activeVersion(), previousVersion(), manifest.uiVersion)
        versions.listFiles()?.filter { it.isDirectory && it.name !in keepBeforeConfirmation }?.forEach(File::deleteRecursively)
        val staging = File(root, "staging-${UUID.randomUUID()}")
        try {
            manifest.files.forEachIndexed { index, file ->
                client.download(baseUrl, manifest, file, safeFile(staging, file.path))
                onProgress(index + 1, manifest.files.size)
            }
            File(staging, "pad-web-ui-manifest.json").writeText(manifestJson(manifest))
            val target = versionDirectory(manifest.uiVersion)
            if (target.exists()) target.deleteRecursively()
            check(staging.renameTo(target)) { "工作界面无法写入本地目录" }
        } finally {
            if (staging.exists()) staging.deleteRecursively()
        }
    }

    fun confirm(version: String) {
        require(versionDirectory(version).isDirectory) { "工作界面版本尚未准备完成" }
        val oldActive = activeVersion()
        preferences.edit()
            .putString("activeVersion", version)
            .putString("previousVersion", oldActive?.takeIf { it != version })
            .apply()
        val keep = setOfNotNull(version, oldActive?.takeIf { it != version })
        versions.listFiles()?.filter { it.isDirectory && it.name !in keep }?.forEach(File::deleteRecursively)
    }

    fun discardUnconfirmed(version: String) {
        if (version != activeVersion() && version != previousVersion()) versionDirectory(version).deleteRecursively()
    }

    fun open(version: String, relativePath: String) = safeFile(versionDirectory(version), relativePath)
        .takeIf(File::isFile)
        ?.inputStream()

    fun hasFile(version: String, relativePath: String) = safeFile(versionDirectory(version), relativePath).isFile

    private fun isComplete(manifest: WebUiPackageManifest): Boolean {
        val saved = File(versionDirectory(manifest.uiVersion), "pad-web-ui-manifest.json")
        if (!saved.isFile) return false
        return runCatching {
            val installed = WebUiPackageManifestParser.parse(saved.readText())
            installed.bundleSha256 == manifest.bundleSha256 && installed.files.all { file ->
                val local = safeFile(versionDirectory(installed.uiVersion), file.path)
                local.isFile && local.length() == file.size
            }
        }
            .getOrDefault(false)
    }

    private fun versionDirectory(version: String): File {
        require(Regex("[0-9.]{10,32}").matches(version)) { "工作界面版本无效" }
        return File(versions, version)
    }

    private fun safeFile(parent: File, relativePath: String): File {
        val target = File(parent, relativePath)
        val parentPath = parent.canonicalFile.toPath()
        require(target.canonicalFile.toPath().startsWith(parentPath)) { "工作界面文件路径越界" }
        return target
    }

    private fun manifestJson(manifest: WebUiPackageManifest) = JSONObject().apply {
        put("formatVersion", 1)
        put("uiVersion", manifest.uiVersion)
        put("bundleSha256", manifest.bundleSha256)
        put("downloadBasePath", manifest.downloadBasePath)
        put("files", JSONArray().apply {
            manifest.files.forEach { file -> put(JSONObject().apply {
                put("path", file.path)
                put("size", file.size)
                put("sha256", file.sha256)
            }) }
        })
    }.toString()
}
