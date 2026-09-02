package com.sampleroom.tablet.web

import android.webkit.JavascriptInterface

interface TabletBridgeHost {
    fun scanOrderQr()
    fun clearWebSession()
    fun returnToNativeLogin()
    fun printCurrentPage()
    fun setNextUploadSource(source: String)
    fun downloadFile(relativePath: String, displayName: String, mimeType: String)
    fun shareFile(relativePath: String, displayName: String, mimeType: String)
    fun webUiReady()
    fun networkState(): String
    fun switchNetwork(addressType: String)
    fun setBusinessWriteActive(active: Boolean)
    fun printerState(): String
    fun connectB1Printer()
    fun printB1Labels(jobJson: String): String
    fun saveGeneratedFile(base64: String, displayName: String, mimeType: String)
}

class TabletJavascriptBridge(private val host: TabletBridgeHost) {
    @JavascriptInterface fun scanOrderQr() = host.scanOrderQr()
    @JavascriptInterface fun clearSession() = host.clearWebSession()
    @JavascriptInterface fun returnToNativeLogin() = host.returnToNativeLogin()
    @JavascriptInterface fun printPage() = host.printCurrentPage()
    @JavascriptInterface fun setNextUploadSource(source: String) = host.setNextUploadSource(source)

    @JavascriptInterface
    fun downloadFile(relativePath: String, displayName: String, mimeType: String) =
        host.downloadFile(relativePath, displayName, mimeType)

    @JavascriptInterface
    fun shareFile(relativePath: String, displayName: String, mimeType: String) =
        host.shareFile(relativePath, displayName, mimeType)

    @JavascriptInterface fun webUiReady() = host.webUiReady()
    @JavascriptInterface fun networkState(): String = host.networkState()
    @JavascriptInterface fun switchNetwork(addressType: String) = host.switchNetwork(addressType)
    @JavascriptInterface fun setBusinessWriteActive(active: Boolean) = host.setBusinessWriteActive(active)
    @JavascriptInterface fun printerState(): String = host.printerState()
    @JavascriptInterface fun connectB1Printer() = host.connectB1Printer()
    @JavascriptInterface fun printB1Labels(jobJson: String): String = host.printB1Labels(jobJson)
    @JavascriptInterface fun saveGeneratedFile(base64: String, displayName: String, mimeType: String) =
        host.saveGeneratedFile(base64, displayName, mimeType)
}
