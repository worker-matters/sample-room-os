package com.sampleroom.mobile.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.util.Base64

class NetworkConfigParserTest {
    private fun payload(addressType: String, baseUrl: String, apiVersion: String = "v1"): String {
        val json = JSONObject()
            .put("addressType", addressType)
            .put("baseUrl", baseUrl)
            .put("displayName", "测试地址")
            .put("apiVersion", apiVersion)
            .toString()
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray())
        return "SRS2|NETWORK_CONFIG|1|$encoded"
    }

    @Test fun parsesAndNormalizesLanConfiguration() {
        assertEquals(
            NetworkConfig(ApiMode.LAN, "http://192.168.10.20:3001", "测试地址", "v1"),
            NetworkConfigParser.parse(
                payload("LAN", "http://192.168.10.20:3001/"),
                allowLoopbackHttp = false
            )
        )
    }

    @Test fun parsesPublicHttpsConfiguration() {
        assertEquals(
            "https://api.example.com",
            NetworkConfigParser.parse(
                payload("PUBLIC", "https://API.EXAMPLE.COM/"),
                allowLoopbackHttp = false
            ).baseUrl
        )
    }

    @Test fun rejectsOrdinaryQrAndUnsafeUrls() {
        assertThrows(IllegalArgumentException::class.java) {
            NetworkConfigParser.parse("https://example.com")
        }
        listOf(
            "javascript:alert(1)",
            "file:///tmp/api",
            "https://user:secret@example.com",
            "https://example.com/api",
            "https://example.com?token=secret"
        ).forEach { value ->
            assertThrows(IllegalArgumentException::class.java) {
                NetworkConfigParser.parse(payload("PUBLIC", value))
            }
        }
    }

    @Test fun rejectsWrongVersionAndPublicHttp() {
        assertThrows(IllegalArgumentException::class.java) {
            NetworkConfigParser.parse(payload("LAN", "http://192.168.1.2:3001", "v2"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            NetworkConfigParser.parse(payload("PUBLIC", "http://example.com"))
        }
    }

    @Test fun allowsAllRequiredRfc1918LanRangesOverHttp() {
        listOf(
            "http://10.0.0.1:3001",
            "http://172.16.0.1:3001",
            "http://172.31.255.254:3001",
            "http://192.168.255.254:3001"
        ).forEach { value ->
            assertEquals(
                value,
                NetworkConfigParser.normalizeBaseUrl(
                    value,
                    ApiMode.LAN,
                    allowLoopbackHttp = false
                )
            )
        }
    }

    @Test fun rejectsPublicOrUnrecognizedHostMarkedAsLan() {
        listOf(
            "http://example.com:3001",
            "https://example.com",
            "http://8.8.8.8:3001",
            "http://172.32.0.1:3001",
            "http://192.169.0.1:3001"
        ).forEach { value ->
            assertThrows(IllegalArgumentException::class.java) {
                NetworkConfigParser.parse(
                    payload("LAN", value),
                    allowLoopbackHttp = false
                )
            }
        }
    }

    @Test fun loopbackHttpIsDebugOnly() {
        listOf("http://localhost:3001", "http://127.0.0.1:3001").forEach { value ->
            assertEquals(
                value,
                NetworkConfigParser.normalizeBaseUrl(
                    value,
                    ApiMode.LAN,
                    allowLoopbackHttp = true
                )
            )
            assertThrows(IllegalArgumentException::class.java) {
                NetworkConfigParser.normalizeBaseUrl(
                    value,
                    ApiMode.LAN,
                    allowLoopbackHttp = false
                )
            }
        }
    }

    @Test fun rejectsUnknownSensitiveFields() {
        val json = JSONObject()
            .put("addressType", "PUBLIC")
            .put("baseUrl", "https://api.example.com")
            .put("apiVersion", "v1")
            .put("token", "must-not-be-accepted")
            .toString()
        val encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray())
        assertThrows(IllegalArgumentException::class.java) {
            NetworkConfigParser.parse("SRS2|NETWORK_CONFIG|1|$encoded")
        }
    }
}
