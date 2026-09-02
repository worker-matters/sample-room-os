package com.sampleroom.tablet.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CookieSessionControllerTest {
    @Test fun `flushes on persist and removes all cookies on logout`() {
        var flushes = 0
        var removed = false
        var completed = false
        val controller = CookieSessionController(object : CookieBackend {
            override fun flush() { flushes += 1 }
            override fun removeAll(callback: (Boolean) -> Unit) {
                removed = true
                callback(true)
            }
        })

        controller.persist()
        controller.clear { completed = true }

        assertEquals(2, flushes)
        assertTrue(removed)
        assertTrue(completed)
    }
}
