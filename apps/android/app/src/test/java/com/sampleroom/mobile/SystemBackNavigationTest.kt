package com.sampleroom.mobile

import com.sampleroom.mobile.data.MobileOrder
import com.sampleroom.mobile.data.ScanResult
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SystemBackNavigationTest {
    @Test
    fun rootScreensConsumeSystemBackWithoutLeavingTheApp() {
        val rootScreens = listOf(
            AppScreen.Boot,
            AppScreen.Login,
            AppScreen.ForcePasswordChange,
            AppScreen.ReceiverHome,
            AppScreen.PlannerHome,
            AppScreen.WorkerHome,
            AppScreen.BossHome,
            AppScreen.Orders("client"),
            AppScreen.Placeholder("尚未开放", "只读提示")
        )

        rootScreens.forEach { screen ->
            assertFalse("$screen should stay in the app", screen.shouldNavigateBackWithinApp())
        }
    }

    @Test
    fun childScreensRouteSystemBackThroughExistingAppNavigation() {
        val order = mobileOrder()
        val childScreens = listOf(
            AppScreen.NetworkSettings,
            AppScreen.NetworkScanner,
            AppScreen.ReceiverIntake,
            AppScreen.ReceiverScanCharge,
            AppScreen.PlannerProductionPlan,
            AppScreen.PlannerScanCharge,
            AppScreen.PlannerOrderCharge(order),
            AppScreen.Orders("receiver"),
            AppScreen.Orders("planner"),
            AppScreen.BossPending,
            AppScreen.BossStatements,
            AppScreen.OrderDetail(order, "receiver"),
            AppScreen.WorkerScan,
            AppScreen.ScanResultPage(
                ScanResult(
                    token = "scan-token",
                    order = order,
                    currentStageLabel = "待制版",
                    statusMessage = "等待版师任务",
                    stage = "pattern",
                    allowedAction = "blocked",
                    blockedReason = "workflow_invalid",
                    defaultPieces = null,
                    activeTaskWorkerId = null,
                    activeTaskWorkerName = null
                )
            )
        )

        childScreens.forEach { screen ->
            assertTrue("$screen should navigate within the app", screen.shouldNavigateBackWithinApp())
        }
    }

    private fun mobileOrder() = MobileOrder(
        id = "order-1",
        orderNo = "SR-1",
        styleNo = "ST-1",
        styleName = "测试款",
        customerName = "测试客户",
        salespersonName = "测试业务员",
        quantity = 1,
        deliveryDate = "2026-07-31",
        stageLabel = "pending_pattern",
        sampleType = "first_sample",
        sampleRound = "round_1",
        remark = ""
    )
}
