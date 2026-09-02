package com.sampleroom.tablet.network

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.concurrent.TimeUnit

class OkHttpHealthProbeTest {
    @Test fun `classifies health identity version HTTP and timeout results`() {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setBody("""{"ok":true,"service":"sample-room-api","apiVersion":"v1"}"""))
            server.enqueue(MockResponse().setBody("""{"ok":true,"service":"other-service","apiVersion":"v1"}"""))
            server.enqueue(MockResponse().setBody("""{"ok":true,"service":"sample-room-api","apiVersion":"v2"}"""))
            server.enqueue(MockResponse().setResponseCode(502))
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            val testClient = OkHttpClient.Builder()
                .connectTimeout(100, TimeUnit.MILLISECONDS)
                .readTimeout(100, TimeUnit.MILLISECONDS)
                .callTimeout(150, TimeUnit.MILLISECONDS)
                .followRedirects(false)
                .build()
            val probe = OkHttpHealthProbe(testClient)
            val baseUrl = server.url("/").toString().trimEnd('/')

            assertEquals(HealthProbeResult.Success, probe.probe(baseUrl))
            assertEquals(
                HealthProbeResult.Failure(HealthProbeFailure.IDENTITY),
                probe.probe(baseUrl)
            )
            assertEquals(
                HealthProbeResult.Failure(HealthProbeFailure.API_VERSION),
                probe.probe(baseUrl)
            )
            assertEquals(
                HealthProbeResult.Failure(HealthProbeFailure.HTTP, 502),
                probe.probe(baseUrl)
            )
            assertEquals(
                HealthProbeResult.Failure(HealthProbeFailure.TIMEOUT),
                probe.probe(baseUrl)
            )
        } finally {
            server.shutdown()
        }
    }
}
