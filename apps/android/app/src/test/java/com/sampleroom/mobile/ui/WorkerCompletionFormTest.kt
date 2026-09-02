package com.sampleroom.mobile.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkerCompletionFormTest {
    @Test
    fun sewingAndCuttingNotesAreOptional() {
        assertFalse(completionNoteRequired("sewing"))
        assertFalse(completionNoteRequired("cutting"))
    }

    @Test
    fun qualifiedQcRequiresScoreAndFinalSamplePhoto() {
        assertTrue(qcCompletionValidationError("3", "qualified", "95", "", 0) != null)
        assertTrue(qcCompletionValidationError("3", "qualified", "101", "", 1) != null)
        assertTrue(qcCompletionValidationError("3", "qualified", "95", "", 1) == null)
    }

    @Test
    fun reworkQcRequiresReasonButNotScoreOrPhoto() {
        assertTrue(qcCompletionValidationError("3", "rework", "", "", 0) != null)
        assertTrue(qcCompletionValidationError("3", "rework", "", "车线需要返工", 0) == null)
    }

    @Test
    fun qcPhotoEntriesFollowTheCurrentResultInsteadOfTheOrderHistory() {
        assertEquals(setOf("qc_sample_photo", "qc_measurement_photo"), qcSubmissionPhotoCategories("qualified"))
        assertEquals(setOf("qc_issue_photo"), qcSubmissionPhotoCategories("rework"))
    }
}
