package com.sampleroom.mobile.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class OkHttpHealthProbeTest {
    @Test
    fun validatesTheSharedMobileHealthContract() {
        val server = MockWebServer()
        server.enqueue(
            MockResponse().setBody(
                """{"ok":true,"service":"sample-room-api","apiVersion":"v1"}"""
            )
        )
        server.start()
        try {
            assertEquals(
                EndpointProbeResult("sample-room-api", "v1"),
                runBlocking { OkHttpHealthProbe().validate(server.url("/").toString().trimEnd('/')) }
            )
            assertEquals("/api/miniapp/health", server.takeRequest().path)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun rejectsWrongServiceAndApiVersion() {
        val server = MockWebServer()
        server.enqueue(
            MockResponse().setBody(
                """{"ok":true,"service":"ordinary-web-site","apiVersion":"v1"}"""
            )
        )
        server.enqueue(
            MockResponse().setBody(
                """{"ok":true,"service":"sample-room-api","apiVersion":"v2"}"""
            )
        )
        server.start()
        try {
            val baseUrl = server.url("/").toString().trimEnd('/')
            assertThrows(NotSampleRoomApiException::class.java) {
                runBlocking { OkHttpHealthProbe().validate(baseUrl) }
            }
            assertThrows(IncompatibleApiVersionException::class.java) {
                runBlocking { OkHttpHealthProbe().validate(baseUrl) }
            }
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun classifiesMalformedUrlAndHttpError() {
        assertThrows(MalformedEndpointUrlException::class.java) {
            runBlocking { OkHttpHealthProbe().validate("not a URL") }
        }

        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(503))
        server.start()
        try {
            val error = assertThrows(EndpointHttpException::class.java) {
                runBlocking { OkHttpHealthProbe().validate(server.url("/").toString().trimEnd('/')) }
            }
            assertEquals(503, error.statusCode)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun classifiesTimeoutAndConnectionRefused() {
        val timeoutServer = MockWebServer()
        timeoutServer.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        timeoutServer.start()
        try {
            assertThrows(EndpointTimeoutException::class.java) {
                runBlocking {
                    OkHttpHealthProbe().validate(timeoutServer.url("/").toString().trimEnd('/'))
                }
            }
        } finally {
            timeoutServer.shutdown()
        }

        val refusedServer = MockWebServer()
        refusedServer.start()
        val refusedUrl = refusedServer.url("/").toString().trimEnd('/')
        refusedServer.shutdown()
        assertThrows(EndpointConnectionRefusedException::class.java) {
            runBlocking { OkHttpHealthProbe().validate(refusedUrl) }
        }
    }
}
