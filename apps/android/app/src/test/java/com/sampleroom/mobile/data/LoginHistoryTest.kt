package com.sampleroom.mobile.data

import org.junit.Assert.assertEquals
import org.junit.Test

class LoginHistoryTest {
    @Test
    fun successfulLoginHistoryIsNewestFirstDeduplicatedAndCapped() {
        val current = (1..8).map { "account-$it" }
        assertEquals(
            listOf("account-4", "account-1", "account-2", "account-3", "account-5", "account-6", "account-7", "account-8"),
            updatedLoginHistory(" account-4 ", current)
        )
        assertEquals(
            listOf("new-account", "account-1", "account-2", "account-3", "account-4", "account-5", "account-6", "account-7"),
            updatedLoginHistory("new-account", current)
        )
    }

    @Test
    fun blankLoginDoesNotCreateAHistoryEntry() {
        assertEquals(listOf("planner"), updatedLoginHistory("  ", listOf("planner", "planner")))
    }
}
