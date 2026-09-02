package com.sampleroom.tablet.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionCookieHandoffTest {
    @Test fun `preserves server cookie attributes for WebView`() {
        val header = "sample_room_session=opaque-token; Path=/; HttpOnly; Secure; SameSite=Lax"
        assertEquals(header, SessionCookieHandoff.webViewCookie(listOf("other=1", header)))
        assertEquals("sample_room_session=opaque-token", SessionCookieHandoff.requestCookieHeader(listOf(header)))
        assertEquals(
            "sample_room_session=opaque-token; Path=/; HttpOnly; SameSite=Lax",
            SessionCookieHandoff.cookieForOrigin(listOf(header), "http://192.168.1.8:3001")
        )
        assertEquals(
            "sample_room_session=opaque-token; Path=/; HttpOnly; SameSite=Lax; Secure",
            SessionCookieHandoff.cookieForOrigin(listOf(header), "https://factory.example.test")
        )
    }

    @Test fun `rejects responses without the formal session cookie`() {
        assertNull(SessionCookieHandoff.webViewCookie(listOf("other=1; Path=/")))
    }
}
