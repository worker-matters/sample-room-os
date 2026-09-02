package com.sampleroom.tablet.security

object SessionCookieHandoff {
    private const val COOKIE_NAME = "sample_room_session"

    fun webViewCookie(setCookieHeaders: List<String>): String? = setCookieHeaders
        .firstOrNull { it.substringBefore('=').trim() == COOKIE_NAME }

    fun requestCookieHeader(setCookieHeaders: List<String>): String? = webViewCookie(setCookieHeaders)
        ?.substringBefore(';')
        ?.trim()
        ?.takeIf(String::isNotBlank)

    fun cookieForOrigin(setCookieHeaders: List<String>, baseUrl: String): String? = requestCookieHeader(setCookieHeaders)
        ?.let { cookie ->
            buildString {
                append(cookie)
                append("; Path=/; HttpOnly; SameSite=Lax")
                if (baseUrl.startsWith("https://")) append("; Secure")
            }
        }
}
