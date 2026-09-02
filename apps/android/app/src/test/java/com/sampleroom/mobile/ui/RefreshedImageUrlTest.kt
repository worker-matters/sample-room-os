package com.sampleroom.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class RefreshedImageUrlTest {
    @Test
    fun appendsRevisionWithoutBreakingExistingQueryParameters() {
        assertEquals(
            "https://example.test/thumbnail?androidRefresh=7",
            refreshedImageUrl("https://example.test/thumbnail", 7)
        )
        assertEquals(
            "https://example.test/thumbnail?size=small&androidRefresh=8",
            refreshedImageUrl("https://example.test/thumbnail?size=small", 8)
        )
    }

    @Test
    fun leavesUrlUntouchedBeforeTheFirstSuccessfulRefresh() {
        assertEquals("https://example.test/thumbnail", refreshedImageUrl("https://example.test/thumbnail", 0))
    }
}
