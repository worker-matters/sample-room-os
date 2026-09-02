package com.sampleroom.tablet.web

import android.graphics.Bitmap
import android.net.http.SslError
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.sampleroom.tablet.network.OriginPolicy
import java.io.ByteArrayInputStream

class SecureTabletWebViewClient(
    private val policy: () -> OriginPolicy,
    private val onNativeLoginRequired: () -> Unit,
    private val onBlockedNavigation: (String) -> Unit,
    private val onMainFrameFailure: (String) -> Unit,
    private val onPageCommitted: () -> Unit,
    private val localAssetProvider: ((WebResourceRequest) -> WebResourceResponse?)? = null
) : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (!request.isForMainFrame) return !policy().isAllowedResource(request.url.toString())
        val url = request.url.toString()
        if (policy().isAllowedOrigin(url) && OriginPolicy.isNativeLoginPath(url)) {
            onNativeLoginRequired()
            return true
        }
        if (policy().isAllowedMainFrame(url)) return false
        onBlockedNavigation(url)
        return true
    }

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        localAssetProvider?.invoke(request)?.let { return it }
        if (policy().isAllowedResource(request.url.toString())) return null
        return WebResourceResponse(
            "text/plain",
            "UTF-8",
            403,
            "Blocked by tablet origin policy",
            emptyMap(),
            ByteArrayInputStream(ByteArray(0))
        )
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        if (policy().isAllowedOrigin(url) && OriginPolicy.isNativeLoginPath(url)) {
            view.stopLoading()
            onNativeLoginRequired()
            return
        }
        if (!policy().isAllowedMainFrame(url)) {
            view.stopLoading()
            onBlockedNavigation(url)
            return
        }
        super.onPageStarted(view, url, favicon)
    }

    override fun onPageFinished(view: WebView, url: String) {
        onPageCommitted()
        super.onPageFinished(view, url)
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame) onMainFrameFailure("页面加载失败：${error.description}")
        super.onReceivedError(view, request, error)
    }

    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
        if (request.isForMainFrame && response.statusCode >= 500) {
            onMainFrameFailure("服务器暂时不可用（HTTP ${response.statusCode}）")
        }
        super.onReceivedHttpError(view, request, response)
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.cancel()
        onMainFrameFailure("HTTPS 证书校验失败，已停止连接。")
    }
}
