package com.sampleroom.tablet.update

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

data class AppReleaseInfo(
    val clientType: String,
    val packageName: String,
    val versionCode: Long,
    val versionName: String,
    val sizeBytes: Long,
    val sha256: String,
    val releaseNotes: String?,
    val downloadUrl: String,
    val baseUrl: String
) {
    fun absoluteDownloadUrl(): String =
        if (downloadUrl.startsWith("http://") || downloadUrl.startsWith("https://")) {
            downloadUrl
        } else {
            "${baseUrl.trimEnd('/')}/${downloadUrl.trimStart('/')}"
        }
}

class AppUpdateClient(
    private val clientType: String = "pad",
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()
) {
    fun latest(baseUrl: String): AppReleaseInfo? = run {
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/miniapp/app-releases/$clientType/latest")
            .header("Cache-Control", "no-cache")
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("App 更新检查失败（HTTP ${response.code}）")
            }
            val body = response.body?.string().orEmpty()
            val release = JSONObject(body).optJSONObject("release") ?: return@run null
            val versionCode = release.optLong("versionCode", -1)
            val packageName = release.optString("packageName").trim()
            val versionName = release.optString("versionName").trim()
            val downloadUrl = release.optString("downloadUrl").trim()
            val sha256 = release.optString("sha256").trim().lowercase()
            if (versionCode <= 0 || packageName.isBlank() || versionName.isBlank() ||
                downloadUrl.isBlank() || sha256.length != 64
            ) {
                throw IllegalStateException("服务器返回的 App 版本信息不完整")
            }
            AppReleaseInfo(
                clientType = release.optString("clientType", clientType),
                packageName = packageName,
                versionCode = versionCode,
                versionName = versionName,
                sizeBytes = release.optLong("sizeBytes", 0),
                sha256 = sha256,
                releaseNotes = release.optString("releaseNotes").trim().takeIf { it.isNotBlank() },
                downloadUrl = downloadUrl,
                baseUrl = baseUrl.trimEnd('/')
            )
        }
    }
}

class AppUpdateInstaller(private val activity: ComponentActivity) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    fun downloadAndVerify(
        release: AppReleaseInfo,
        onProgress: (Int) -> Unit
    ): File = run {
        if (release.packageName != activity.packageName) {
            throw IllegalStateException("更新包与当前 App 不匹配")
        }

        val target = File(activity.cacheDir, "app-update-${release.versionCode}.apk")
        val request = Request.Builder()
            .url(release.absoluteDownloadUrl())
            .header("Cache-Control", "no-cache")
            .get()
            .build()

        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("更新包下载失败（HTTP ${response.code}）")
            }
            val body = response.body ?: throw IllegalStateException("更新包内容为空")
            val total = body.contentLength().takeIf { it > 0 } ?: release.sizeBytes
            body.byteStream().use { input ->
                target.outputStream().buffered().use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var copied = 0L
                    var read: Int
                    while (input.read(buffer).also { read = it } >= 0) {
                        if (read == 0) continue
                        output.write(buffer, 0, read)
                        copied += read
                        if (total > 0) {
                            onProgress(((copied * 100L) / total).toInt().coerceIn(0, 100))
                        }
                    }
                }
            }
        }

        val actualSha256 = sha256(target)
        if (!actualSha256.equals(release.sha256, ignoreCase = true)) {
            target.delete()
            throw IllegalStateException("更新包校验失败，请重新下载")
        }

        verifyPackageIdentity(target, release)
        onProgress(100)
        target
    }

    fun canRequestPackageInstalls(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            activity.packageManager.canRequestPackageInstalls()

    fun installPermissionIntent(): Intent =
        Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${activity.packageName}")
        )

    fun launchInstaller(apk: File) {
        val uri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.files",
            apk
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, APK_MIME)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivity(intent)
    }

    private fun verifyPackageIdentity(file: File, release: AppReleaseInfo) {
        val packageManager = activity.packageManager
        val archive = packageInfoFromArchive(packageManager, file)
            ?: throw IllegalStateException("Android 无法读取更新包")
        val installed = installedPackageInfo(packageManager)

        if (archive.packageName != activity.packageName || archive.packageName != release.packageName) {
            throw IllegalStateException("更新包 packageName 不匹配")
        }

        val archiveVersion = longVersionCode(archive)
        val installedVersion = longVersionCode(installed)
        if (archiveVersion != release.versionCode || archiveVersion <= installedVersion) {
            throw IllegalStateException("更新包版本号无效")
        }

        val installedSigners = signingFingerprints(installed)
        val archiveSigners = signingFingerprints(archive)
        if (installedSigners.isEmpty() || archiveSigners.isEmpty() ||
            installedSigners.intersect(archiveSigners).isEmpty()
        ) {
            throw IllegalStateException("更新包签名与当前 App 不一致")
        }
    }

    private fun installedPackageInfo(packageManager: PackageManager): PackageInfo {
        val flags = signatureFlags()
        return if (Build.VERSION.SDK_INT >= 33) {
            packageManager.getPackageInfo(
                activity.packageName,
                PackageManager.PackageInfoFlags.of(flags.toLong())
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.getPackageInfo(activity.packageName, flags)
        }
    }

    private fun packageInfoFromArchive(packageManager: PackageManager, file: File): PackageInfo? {
        val flags = signatureFlags()
        return if (Build.VERSION.SDK_INT >= 33) {
            packageManager.getPackageArchiveInfo(
                file.absolutePath,
                PackageManager.PackageInfoFlags.of(flags.toLong())
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.getPackageArchiveInfo(file.absolutePath, flags)
        }
    }

    private fun signatureFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            @Suppress("DEPRECATION")
            PackageManager.GET_SIGNATURES
        }

    private fun signingFingerprints(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signingInfo = info.signingInfo ?: return emptySet()
            if (signingInfo.hasMultipleSigners()) {
                signingInfo.apkContentsSigners?.toList().orEmpty()
            } else {
                signingInfo.signingCertificateHistory?.toList()
                    ?: signingInfo.apkContentsSigners?.toList().orEmpty()
            }
        } else {
            @Suppress("DEPRECATION")
            info.signatures?.toList().orEmpty()
        }

        return signatures.map {
            MessageDigest.getInstance("SHA-256")
                .digest(it.toByteArray())
                .joinToString("") { byte -> "%02x".format(byte) }
        }.toSet()
    }

    private fun longVersionCode(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var read: Int
            while (input.read(buffer).also { read = it } >= 0) {
                if (read > 0) digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private companion object {
        const val APK_MIME = "application/vnd.android.package-archive"
    }
}
