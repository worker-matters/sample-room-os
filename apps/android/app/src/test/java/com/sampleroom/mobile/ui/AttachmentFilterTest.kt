package com.sampleroom.mobile.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AttachmentFilterTest {
    @Test
    fun `search matches filename uploader and localized role`() {
        assertTrue(matches(query = "营业执照"))
        assertTrue(matches(query = "示例工厂"))
        assertTrue(matches(query = "计划员"))
        assertFalse(matches(query = "版师"))
    }

    @Test
    fun `type and role filters are both applied`() {
        assertTrue(matches(typeFilter = "image", roleFilter = "planner"))
        assertFalse(matches(typeFilter = "pdf", roleFilter = "planner"))
        assertFalse(matches(typeFilter = "image", roleFilter = "receiver"))
    }

    private fun matches(
        query: String = "",
        typeFilter: String = "",
        roleFilter: String = ""
    ) = attachmentMatchesFilters(
        fileName = "示例工厂 营业执照.png",
        mimeType = "image/png",
        uploaderName = "示例工厂",
        uploaderRole = "planner",
        query = query,
        typeFilter = typeFilter,
        roleFilter = roleFilter
    )
}
