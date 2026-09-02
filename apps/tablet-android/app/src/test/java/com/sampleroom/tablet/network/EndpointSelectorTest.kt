package com.sampleroom.tablet.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class EndpointSelectorTest {
    @Test fun `uses only the explicitly selected LAN line`() {
        val visited = mutableListOf<String>()
        val selected = EndpointSelector { url -> visited += url; true }.select(
            AddressType.LAN,
            "http://192.168.1.10:3001",
            "https://factory.example.test"
        )
        assertEquals(AddressType.LAN, selected.addressType)
        assertEquals(listOf("http://192.168.1.10:3001"), visited)
    }

    @Test fun `does not fall back when the selected line fails`() {
        val visited = mutableListOf<String>()
        assertThrows(IllegalStateException::class.java) {
            EndpointSelector { url -> visited += url; false }.select(
                AddressType.LAN,
                "http://192.168.1.10:3001",
                "https://factory.example.test"
            )
        }
        assertEquals(listOf("http://192.168.1.10:3001"), visited)
    }

    @Test fun `fails closed when neither verified service is reachable`() {
        assertThrows(IllegalStateException::class.java) {
            EndpointSelector { false }.select(AddressType.PUBLIC, "http://10.0.0.8", null)
        }
    }

    @Test fun `LAN preferred resolver stays on LAN when the saved LAN is healthy`() {
        val visited = mutableListOf<String>()
        var publishedFetches = 0
        val resolution = LanPreferredEndpointResolver(
            EndpointSelector { url -> visited += url; true },
            { publishedFetches += 1; emptyList() }
        ).resolve("http://192.168.1.10:3001", "https://factory.example.test")

        assertEquals(AddressType.LAN, resolution.endpoint.addressType)
        assertEquals("http://192.168.1.10:3001", resolution.endpoint.baseUrl)
        assertEquals(listOf("http://192.168.1.10:3001"), visited)
        assertEquals(0, publishedFetches)
        assertFalse(resolution.usedPublicFallback)
        assertFalse(resolution.restoredLan)
    }

    @Test fun `LAN preferred resolver falls back through PUBLIC and restores the published LAN`() {
        val oldLan = "http://192.168.1.10:3001"
        val publicUrl = "https://factory.example.test"
        val newLan = NetworkConfig(AddressType.LAN, "http://192.168.1.20:3001", "new LAN", "v1")
        val visited = mutableListOf<String>()
        val fetchedFrom = mutableListOf<String>()
        val resolution = LanPreferredEndpointResolver(
            EndpointSelector { url -> visited += url; url != oldLan },
            { url -> fetchedFrom += url; listOf(newLan) }
        ).resolve(oldLan, publicUrl)

        assertEquals(AddressType.LAN, resolution.endpoint.addressType)
        assertEquals(newLan.baseUrl, resolution.endpoint.baseUrl)
        assertEquals(listOf(oldLan, publicUrl, newLan.baseUrl), visited)
        assertEquals(listOf(publicUrl), fetchedFrom)
        assertEquals(listOf(newLan), resolution.syncedConfigs)
        assertTrue(resolution.usedPublicFallback)
        assertTrue(resolution.restoredLan)
    }

    @Test fun `LAN preferred resolver remains on PUBLIC when the published LAN is not healthy`() {
        val oldLan = "http://192.168.1.10:3001"
        val publicUrl = "https://factory.example.test"
        val newLan = NetworkConfig(AddressType.LAN, "http://192.168.1.20:3001", "new LAN", "v1")
        val visited = mutableListOf<String>()
        val resolution = LanPreferredEndpointResolver(
            EndpointSelector { url -> visited += url; url == publicUrl },
            { listOf(newLan) }
        ).resolve(oldLan, publicUrl)

        assertEquals(AddressType.PUBLIC, resolution.endpoint.addressType)
        assertEquals(publicUrl, resolution.endpoint.baseUrl)
        assertEquals(listOf(oldLan, publicUrl, newLan.baseUrl), visited)
        assertTrue(resolution.syncedConfigs.isEmpty())
        assertTrue(resolution.usedPublicFallback)
        assertFalse(resolution.restoredLan)
    }

    @Test fun `LAN preferred resolver fails closed when LAN and PUBLIC are both unavailable`() {
        val visited = mutableListOf<String>()
        assertThrows(IllegalStateException::class.java) {
            LanPreferredEndpointResolver(
                EndpointSelector { url -> visited += url; false },
                { error("must not fetch from an unavailable PUBLIC endpoint") }
            ).resolve("http://192.168.1.10:3001", "https://factory.example.test")
        }
        assertEquals(listOf("http://192.168.1.10:3001", "https://factory.example.test"), visited)
    }
}
