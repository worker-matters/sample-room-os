package com.sampleroom.tablet.web

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.CookieManager
import android.widget.Toast
import android.util.Base64
import androidx.core.content.FileProvider
import com.sampleroom.tablet.security.TabletBridgePolicy
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class NativeFileActions(
    private val context: Context,
    private val baseUrl: () -> String?,
    private val cookieManager: CookieManager = CookieManager.getInstance()
) {
    private val executor = Executors.newSingleThreadExecutor()
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()

    fun download(relativePath: String, displayName: String, mimeType: String) {
        val url = validatedUrl(relativePath, displayName) ?: return fail("下载请求不安全，已阻止。")
        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle(displayName)
            .setMimeType(mimeType.ifBlank { "application/octet-stream" })
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, displayName)
        cookieManager.getCookie(url)?.takeIf(String::isNotBlank)?.let { request.addRequestHeader("Cookie", it) }
        (context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
        toast("已交给系统下载，可在通知栏查看进度。")
    }

    fun share(relativePath: String, displayName: String, mimeType: String) {
        val url = validatedUrl(relativePath, displayName) ?: return fail("分享请求不安全，已阻止。")
        executor.execute {
            runCatching {
                val builder = Request.Builder().url(url).get()
                cookieManager.getCookie(url)?.takeIf(String::isNotBlank)?.let { builder.header("Cookie", it) }
                client.newCall(builder.build()).execute().use { response ->
                    check(response.isSuccessful) { "HTTP ${response.code}" }
                    val directory = File(context.cacheDir, "shared-files").apply { mkdirs() }
                    directory.listFiles()?.forEach { if (it.isFile && it.lastModified() < System.currentTimeMillis() - DAY_MS) it.delete() }
                    val file = File(directory, displayName)
                    response.body?.byteStream()?.use { input -> file.outputStream().use(input::copyTo) }
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                    val intent = Intent(Intent.ACTION_SEND).apply {
                        type = mimeType.ifBlank { "application/octet-stream" }
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(Intent.createChooser(intent, "分享 $displayName").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            }.onFailure { fail("文件分享失败，请检查网络后重试。") }
        }
    }

    fun saveGenerated(base64: String, displayName: String, mimeType: String) {
        executor.execute {
            runCatching {
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                check(TabletBridgePolicy.isSafeGeneratedFile(displayName, mimeType, bytes.size))
                val isImage = mimeType.startsWith("image/", ignoreCase = true)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val values = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
                        put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                        put(
                            MediaStore.MediaColumns.RELATIVE_PATH,
                            "${if (isImage) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_DOWNLOADS}/样品间"
                        )
                        put(MediaStore.MediaColumns.IS_PENDING, 1)
                    }
                    val collection = if (isImage) {
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                    } else {
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI
                    }
                    val uri = context.contentResolver.insert(collection, values)
                        ?: error("cannot create export")
                    try {
                        context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                            ?: error("cannot write export")
                        context.contentResolver.update(uri, ContentValues().apply {
                            put(MediaStore.MediaColumns.IS_PENDING, 0)
                        }, null, null)
                    } catch (error: Throwable) {
                        context.contentResolver.delete(uri, null, null)
                        throw error
                    }
                } else {
                    @Suppress("DEPRECATION")
                    val directory = File(
                        Environment.getExternalStoragePublicDirectory(
                            if (isImage) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_DOWNLOADS
                        ),
                        "样品间"
                    )
                        .apply { mkdirs() }
                    val file = File(directory, displayName).apply { writeBytes(bytes) }
                    if (isImage) {
                        MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf(mimeType), null)
                    }
                }
                toast(if (isImage) "组检报告图片已保存到相册。" else "组检报告 PDF 已保存到下载/样品间。")
            }.onFailure { fail("导出文件保存失败。") }
        }
    }

    private fun validatedUrl(relativePath: String, displayName: String): String? {
        if (!TabletBridgePolicy.isSafeApiFileRequest(relativePath, displayName)) return null
        return baseUrl()?.trimEnd('/')?.plus(relativePath)
    }

    private fun fail(message: String) {
        toast(message)
    }

    private fun toast(message: String) {
        android.os.Handler(context.mainLooper).post {
            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
        }
    }

    fun close() = executor.shutdown()

    companion object { private const val DAY_MS = 24L * 60 * 60 * 1000 }
}
