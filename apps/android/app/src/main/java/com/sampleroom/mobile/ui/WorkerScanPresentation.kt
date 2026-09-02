package com.sampleroom.mobile.ui

import com.sampleroom.mobile.data.ScanResult

internal fun isCompletedSewingRound(result: ScanResult): Boolean =
    result.allowedAction == "blocked" &&
        result.blockedReason == "SEWING_ROUND_ALREADY_COMPLETED"

internal fun completedSewingRoundMessage(result: ScanResult): String =
    result.statusMessage.ifBlank { "本轮成果已经提交，不能重复加入或再次提交。" }

internal fun shouldShowStageMismatchPrompt(result: ScanResult): Boolean =
    result.entrySource == "scan" &&
        result.allowedAction == "blocked" &&
        result.blockedReason in setOf("wrong_stage", "terminated")

internal fun stageMismatchPromptText(result: ScanResult): String =
    if (result.blockedReason == "terminated") "订单已终止"
    else result.statusMessage.ifBlank { "当前订单待${result.currentStageLabel.ifBlank { "对应工序" }}" }
