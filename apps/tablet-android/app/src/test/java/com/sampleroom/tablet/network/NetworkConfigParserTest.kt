package com.sampleroom.tablet.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.util.Base64

class NetworkConfigParserTest {
    private fun payload(json: String) = NetworkConfigParser.PREFIX +
        Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray())

    @Test fun `accepts verified LAN and PUBLIC shapes`() {
        val lan = NetworkConfigParser.parse(payload("""{"addressType":"LAN","baseUrl":"http://192.168.10.8:3001","apiVersion":"v1"}"""))
        val public = NetworkConfigParser.parse(payload("""{"addressType":"PUBLIC","baseUrl":"https://pad.example.test","displayName":"公网","apiVersion":"v1"}"""))
        assertEquals(AddressType.LAN, lan.addressType)
        assertEquals("http://192.168.10.8:3001", lan.baseUrl)
        assertEquals(AddressType.PUBLIC, public.addressType)
        assertEquals("https://pad.example.test", public.baseUrl)
    }

    @Test fun `rejects guessed public HTTP and unsafe fields`() {
        assertThrows(IllegalArgumentException::class.java) {
            NetworkConfigParser.parse(payload("""{"addressType":"PUBLIC","baseUrl":"http://example.test","apiVersion":"v1"}"""))
        }
        assertThrows(IllegalArgumentException::class.java) {
            NetworkConfigParser.parse(payload("""{"addressType":"LAN","baseUrl":"http://192.168.1.9","apiVersion":"v1","token":"secret"}"""))
        }
    }

    @Test fun `rejects non private LAN and incompatible API`() {
        assertThrows(IllegalArgumentException::class.java) {
            NetworkConfigParser.parse(payload("""{"addressType":"LAN","baseUrl":"http://8.8.8.8","apiVersion":"v1"}"""))
        }
        assertThrows(IllegalArgumentException::class.java) {
            NetworkConfigParser.parse(payload("""{"addressType":"LAN","baseUrl":"http://10.0.0.8","apiVersion":"v2"}"""))
        }
    }
}
