package com.sampleroom.mobile.data

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class EndpointSelectorTest {
    @Test fun prefersReachableLan() = runTest {
        val selector = EndpointSelector(
            "http://192.168.1.20:3001",
            "https://public.example",
            HealthProbe { it == "http://192.168.1.20:3001" },
            allowLoopbackHttp = false
        )
        assertEquals(SelectedEndpoint("http://192.168.1.20:3001", ApiMode.LAN), selector.select())
    }

    @Test fun fallsBackToPublic() = runTest {
        val selector = EndpointSelector(
            "http://192.168.1.20:3001",
            "https://public.example",
            HealthProbe { it == "https://public.example" },
            allowLoopbackHttp = false
        )
        assertEquals(SelectedEndpoint("https://public.example", ApiMode.PUBLIC), selector.select())
    }

    @Test fun failsWhenLanAndPublicAreUnreachable() {
        val probed = mutableListOf<String>()
        val selector = EndpointSelector(
            "http://192.168.1.20:3001",
            "https://public.example",
            HealthProbe { probed += it; false },
            allowLoopbackHttp = false
        )
        assertThrows(IllegalStateException::class.java) {
            kotlinx.coroutines.runBlocking { selector.select() }
        }
        assertEquals(listOf("http://192.168.1.20:3001", "https://public.example"), probed)
    }

    @Test fun doesNotProbePlaceholderWhenPublicIsEmpty() {
        val probed = mutableListOf<String>()
        val selector = EndpointSelector(
            "http://192.168.1.20:3001",
            "",
            HealthProbe { probed += it; false },
            allowLoopbackHttp = false
        )
        assertThrows(IllegalStateException::class.java) { kotlinx.coroutines.runBlocking { selector.select() } }
        assertEquals(listOf("http://192.168.1.20:3001"), probed)
    }

    @Test fun ignoresUnsafeLegacyLanEndpointInsteadOfProbingIt() = runTest {
        val probed = mutableListOf<String>()
        val selector = EndpointSelector(
            "http://example.com:3001",
            "https://public.example",
            HealthProbe { probed += it; true },
            allowLoopbackHttp = false
        )

        assertEquals(SelectedEndpoint("https://public.example", ApiMode.PUBLIC), selector.select())
        assertEquals(listOf("https://public.example"), probed)
    }
}
