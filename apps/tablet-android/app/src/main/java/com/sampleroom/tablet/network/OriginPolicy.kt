package com.sampleroom.tablet.network

import java.net.URI

class OriginPolicy(private val allowedBaseUrls: Set<String>) {
    private val allowedOrigins = allowedBaseUrls.mapNotNull(::originOf).toSet()

    fun isAllowedResource(url: String): Boolean {
        val uri = runCatching { URI(url) }.getOrNull() ?: return false
        return when (uri.scheme?.lowercase()) {
            "http", "https" -> originOf(url) in allowedOrigins
            "blob", "data", "about" -> true
            else -> false
        }
    }

    fun isAllowedMainFrame(url: String): Boolean {
        val uri = runCatching { URI(url) }.getOrNull() ?: return false
        if (uri.scheme == "about" && uri.schemeSpecificPart == "blank") return true
        if (originOf(url) !in allowedOrigins) return false
        return uri.path in ALLOWED_PATHS
    }

    fun isAllowedOrigin(url: String): Boolean = originOf(url) in allowedOrigins

    companion object {
        val ALLOWED_PATHS = setOf(
            "/qc/tablet",
            "/receiver/tablet",
            "/planner/tablet",
            "/account/security",
            "/admin",
            "/admin/pricing",
            "/admin/performance",
            "/admin/workers",
            "/admin/accounts",
            "/admin/internal-accounts",
            "/admin/sample-types",
            "/account/force-password"
        )

        fun isNativeLoginPath(url: String): Boolean = runCatching {
            URI(url).path == "/login"
        }.getOrDefault(false)

        fun originOf(url: String): String? = runCatching {
            val uri = URI(url)
            if (uri.scheme !in setOf("http", "https") || uri.host.isNullOrBlank()) return null
            val defaultPort = (uri.scheme == "http" && uri.port == 80) ||
                (uri.scheme == "https" && uri.port == 443)
            "${uri.scheme.lowercase()}://${uri.host.lowercase()}${if (uri.port == -1 || defaultPort) "" else ":${uri.port}"}"
        }.getOrNull()
    }
}
