package com.sampleroom.mobile.ui

import com.sampleroom.mobile.data.MobileOrder
import com.sampleroom.mobile.data.ScanResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkerScanPresentationTest {
    @Test
    fun scannedWrongStageShowsCurrentStagePrompt() {
        val result = scanResult(blockedReason = "wrong_stage")

        assertTrue(shouldShowStageMismatchPrompt(result))
        assertEquals("当前订单待缝制", stageMismatchPromptText(result))
    }

    @Test
    fun priorStageStillOpenKeepsItsExistingHandling() {
        assertFalse(shouldShowStageMismatchPrompt(scanResult(blockedReason = "previous_unfinished")))
    }

    @Test
    fun terminatedOrderUsesTheHighestPriorityPrompt() {
        val result = scanResult(blockedReason = "terminated", statusMessage = "当前订单待缝制")

        assertTrue(shouldShowStageMismatchPrompt(result))
        assertEquals("订单已终止", stageMismatchPromptText(result))
    }

    @Test
    fun listEntryAndOtherBlockedReasonsKeepTheirExistingHandling() {
        assertFalse(shouldShowStageMismatchPrompt(scanResult(entrySource = "sewing_task")))
        assertFalse(shouldShowStageMismatchPrompt(scanResult(blockedReason = "done")))
    }

    @Test
    fun completedSewingRoundUsesReadOnlyBusinessMessage() {
        val result = scanResult(
            blockedReason = "SEWING_ROUND_ALREADY_COMPLETED",
            statusMessage = "本轮成果已经提交，订单正在等待组检，不能重复加入或再次提交。"
        )

        assertTrue(isCompletedSewingRound(result))
        assertFalse(shouldShowStageMismatchPrompt(result))
        assertEquals(result.statusMessage, completedSewingRoundMessage(result))
    }

    private fun scanResult(
        entrySource: String = "scan",
        blockedReason: String = "wrong_stage",
        statusMessage: String = "当前订单待缝制"
    ) = ScanResult(
        token = "test-token",
        entrySource = entrySource,
        order = MobileOrder(
            id = "order-1",
            orderNo = "ORDER-1",
            styleNo = "LONG-STYLE-NUMBER",
            styleName = "Long style name",
            customerName = "Customer",
            salespersonName = "Salesperson",
            quantity = 1,
            deliveryDate = "2026-08-12",
            stageLabel = "待缝制",
            sampleType = "first_sample",
            sampleRound = "1",
            remark = ""
        ),
        currentStageLabel = "缝制",
        statusMessage = statusMessage,
        stage = "sewing",
        allowedAction = "blocked",
        blockedReason = blockedReason,
        defaultPieces = null,
        activeTaskWorkerId = null,
        activeTaskWorkerName = null
    )
}
