package com.sampleroom.tablet.web

import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import com.sampleroom.tablet.network.OriginPolicy

class LocalWebUiAssetProvider(
    private val store: WebUiPackageStore,
    private val version: String,
    private val policy: () -> OriginPolicy
) {
    fun response(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url.toString()
        if (!policy().isAllowedOrigin(url)) return null
        val path = if (request.isForMainFrame && policy().isAllowedMainFrame(url)) {
            "index.html"
        } else {
            request.url.path?.removePrefix("/") ?: return null
        }
        if (!store.hasFile(version, path)) return null
        val input = store.open(version, path) ?: return null
        return WebResourceResponse(
            mimeType(path),
            if (isText(path)) "UTF-8" else null,
            200,
            "OK",
            mapOf(
                "Cache-Control" to "no-store",
                "X-Content-Type-Options" to "nosniff"
            ),
            input
        )
    }

    private fun mimeType(path: String): String = when (Uri.parse(path).lastPathSegment?.substringAfterLast('.', "")) {
        "html" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json" -> "application/json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "gif" -> "image/gif"
        "ico" -> "image/x-icon"
        "woff" -> "font/woff"
        "woff2" -> "font/woff2"
        else -> "application/octet-stream"
    }

    private fun isText(path: String) = path.endsWith(".html") || path.endsWith(".js") ||
        path.endsWith(".mjs") || path.endsWith(".css") || path.endsWith(".json") || path.endsWith(".svg")
}
