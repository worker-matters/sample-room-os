package com.sampleroom.tablet.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class WebUiPackageManifestTest {
    private val sha = "a".repeat(64)

    @Test fun `parses a complete versioned Pad UI manifest`() {
        val manifest = WebUiPackageManifestParser.parse("""
            {"formatVersion":1,"uiVersion":"2026.08.11.102030","bundleSha256":"$sha",
             "downloadBasePath":"/api/tablet/web-ui/files/","files":[
               {"path":"index.html","size":12,"sha256":"$sha"},
               {"path":"assets/app-123.js","size":20,"sha256":"$sha"}]}
        """.trimIndent())
        assertEquals("2026.08.11.102030", manifest.uiVersion)
        assertEquals(listOf("index.html", "assets/app-123.js"), manifest.files.map { it.path })
    }

    @Test fun `rejects unsafe paths and missing index`() {
        assertThrows(IllegalArgumentException::class.java) {
            WebUiPackageManifestParser.parse("""
                {"formatVersion":1,"uiVersion":"2026.08.11.102030","bundleSha256":"$sha",
                 "downloadBasePath":"/api/tablet/web-ui/files/","files":[
                   {"path":"../secret","size":1,"sha256":"$sha"}]}
            """.trimIndent())
        }
    }
}
