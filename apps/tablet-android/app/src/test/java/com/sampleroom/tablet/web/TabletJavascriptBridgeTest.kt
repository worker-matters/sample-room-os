package com.sampleroom.tablet.web

import org.junit.Assert.assertEquals
import org.junit.Test

class TabletJavascriptBridgeTest {
    @Test fun `bridge exposes only the approved tablet handoffs`() {
        val calls = mutableListOf<String>()
        val bridge = TabletJavascriptBridge(object : TabletBridgeHost {
            override fun scanOrderQr() { calls += "scan" }
            override fun clearWebSession() { calls += "clear" }
            override fun returnToNativeLogin() { calls += "login" }
            override fun printCurrentPage() { calls += "print" }
            override fun setNextUploadSource(source: String) { calls += "source:$source" }
            override fun downloadFile(relativePath: String, displayName: String, mimeType: String) {
                calls += "download:$relativePath:$displayName:$mimeType"
            }
            override fun shareFile(relativePath: String, displayName: String, mimeType: String) {
                calls += "share:$relativePath:$displayName:$mimeType"
            }
            override fun webUiReady() { calls += "ready" }
            override fun networkState(): String = "{\"current\":\"LAN\"}".also { calls += "state" }
            override fun switchNetwork(addressType: String) { calls += "switch:$addressType" }
            override fun setBusinessWriteActive(active: Boolean) { calls += "write:$active" }
            override fun printerState(): String = "{\"status\":\"connected\"}".also { calls += "printer-state" }
            override fun connectB1Printer() { calls += "printer-connect" }
            override fun printB1Labels(jobJson: String): String = "{\"accepted\":true}".also { calls += "printer-print:$jobJson" }
            override fun saveGeneratedFile(base64: String, displayName: String, mimeType: String) {
                calls += "generated:$displayName:$mimeType"
            }
        })

        bridge.scanOrderQr()
        bridge.clearSession()
        bridge.returnToNativeLogin()
        bridge.printPage()
        bridge.setNextUploadSource("gallery")
        bridge.downloadFile("/api/qc/file", "photo.jpg", "image/jpeg")
        bridge.shareFile("/api/qc/file", "photo.jpg", "image/jpeg")
        bridge.webUiReady()
        assertEquals("{\"current\":\"LAN\"}", bridge.networkState())
        bridge.switchNetwork("PUBLIC")
        bridge.setBusinessWriteActive(true)
        bridge.setBusinessWriteActive(false)
        assertEquals("{\"status\":\"connected\"}", bridge.printerState())
        bridge.connectB1Printer()
        assertEquals("{\"accepted\":true}", bridge.printB1Labels("{}"))
        bridge.saveGeneratedFile("eA==", "QC.pdf", "application/pdf")

        assertEquals(
            listOf(
                "scan",
                "clear",
                "login",
                "print",
                "source:gallery",
                "download:/api/qc/file:photo.jpg:image/jpeg",
                "share:/api/qc/file:photo.jpg:image/jpeg",
                "ready",
                "state",
                "switch:PUBLIC",
                "write:true",
                "write:false",
                "printer-state",
                "printer-connect",
                "printer-print:{}",
                "generated:QC.pdf:application/pdf"
            ),
            calls
        )
    }
}
