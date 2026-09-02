package com.sampleroom.mobile.data

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class BiometricSessionClientTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun refreshUsesAndroidBiometricEndpointAndBearerToken() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"token":"device-token","expiresAt":"2026-09-23T00:00:00.000Z"}"""
            )
        )
        val endpoint = SelectedEndpoint(
            server.url("/").toString().removeSuffix("/"),
            ApiMode.LAN
        )

        val refreshed = BiometricSessionClient().refresh(endpoint, "device-token")
        val request = server.takeRequest()

        assertEquals("/api/auth/android-biometric-session", request.path)
        assertEquals("Bearer device-token", request.getHeader("Authorization"))
        assertEquals("device-token", refreshed.token)
        assertEquals("2026-09-23T00:00:00.000Z", refreshed.expiresAt)
    }

    @Test
    fun refreshRejectsAnExpiredOrRevokedSession() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("{\"error\":\"unauthenticated\"}"))
        val endpoint = SelectedEndpoint(
            server.url("/").toString().removeSuffix("/"),
            ApiMode.PUBLIC
        )

        val failure = runCatching {
            BiometricSessionClient().refresh(endpoint, "expired-token")
        }.exceptionOrNull()

        assertTrue(failure is BiometricSessionRejectedException)
    }
}
