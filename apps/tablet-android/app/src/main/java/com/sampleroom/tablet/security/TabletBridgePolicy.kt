package com.sampleroom.tablet.security

import java.net.URI

object TabletBridgePolicy {
    private val tokenPattern = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{7,255}$")
    private val safeFileName = Regex("^[^/\\\\]{1,160}$")

    fun isOrderQrPayload(value: String): Boolean {
        val normalized = value.trim()
        val parts = normalized.split('|')
        if (parts.size == 3 && parts[0] == "SRS2" && parts[1] == "ORDER") {
            return tokenPattern.matches(parts[2])
        }
        if (tokenPattern.matches(normalized) && normalized.startsWith("order_scan_")) return true
        val uri = runCatching { URI(normalized) }.getOrNull() ?: return false
        if (uri.isAbsolute && uri.scheme != "https") return false
        val segments = uri.path.orEmpty().trim('/').split('/')
        return segments.size == 2 && segments[0] == "scan" && tokenPattern.matches(segments[1])
    }

    fun isSafeApiFileRequest(relativePath: String, displayName: String): Boolean {
        val allowedPrefix = listOf("/api/qc/", "/api/receiver/", "/api/planner/")
            .any(relativePath::startsWith)
        if (!allowedPrefix || relativePath.contains("..")) return false
        val uri = runCatching { URI(relativePath) }.getOrNull() ?: return false
        return uri.isAbsolute.not() && uri.rawUserInfo == null && uri.fragment == null &&
            safeFileName.matches(displayName)
    }

    fun isSafeGeneratedFile(displayName: String, mimeType: String, byteCount: Int): Boolean {
        val extensionMatches = when (mimeType) {
            "application/pdf" -> displayName.lowercase().endsWith(".pdf")
            "image/png" -> displayName.lowercase().endsWith(".png")
            else -> false
        }
        return byteCount in 1..MAX_GENERATED_FILE_BYTES && safeFileName.matches(displayName) && extensionMatches
    }

    private const val MAX_GENERATED_FILE_BYTES = 80 * 1024 * 1024
}
