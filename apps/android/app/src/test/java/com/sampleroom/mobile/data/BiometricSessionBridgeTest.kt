package com.sampleroom.mobile.data

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BiometricSessionBridgeTest {
    @After
    fun clearBridge() {
        BiometricSessionBridge.clear()
    }

    @Test
    fun keepsAuthorizedTokenOnlyInProcessMemory() {
        assertNull(BiometricSessionBridge.token())
        BiometricSessionBridge.provide("authorized-token")
        assertEquals("authorized-token", BiometricSessionBridge.token())
        assertTrue(BiometricSessionBridge.matches("authorized-token"))
        assertFalse(BiometricSessionBridge.matches("different-token"))
        BiometricSessionBridge.clear()
        assertNull(BiometricSessionBridge.token())
    }
}
