package com.sampleroom.mobile

import com.sampleroom.mobile.data.AccountIdentity
import com.sampleroom.mobile.data.ApiMode
import com.sampleroom.mobile.data.SelectedEndpoint
import com.sampleroom.mobile.data.Session
import com.sampleroom.mobile.ui.forcePasswordValidationError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ForcedPasswordChangeTest {
    @Test
    fun forcedPasswordChangeTakesPriorityForPlannerAndProductionWorkers() {
        val identities = listOf(
            identity("planner", "business", homeRoute = "/planner/home", mustChangePassword = true),
            identity("worker", "worker", "cutting", mustChangePassword = true),
            identity("worker", "worker", "sewing", mustChangePassword = true),
            identity("worker", "worker", "qc_delivery", mustChangePassword = true)
        )

        identities.forEach { account ->
            assertEquals(
                AppScreen.ForcePasswordChange,
                authenticatedEntryScreen(account)
            )
        }
    }

    @Test
    fun normalPlannerAndWorkersKeepTheirExistingHomeRoutes() {
        assertEquals(
            AppScreen.PlannerHome,
            authenticatedEntryScreen(
                identity("planner", "business", homeRoute = "/planner/home")
            )
        )

        listOf("cutting", "sewing", "qc_delivery").forEach { workerType ->
            assertEquals(
                AppScreen.WorkerHome,
                authenticatedEntryScreen(
                    identity("worker", "worker", workerType)
                )
            )
        }
    }

    @Test
    fun forcePasswordFormUsesTheExistingEightCharacterRule() {
        assertEquals(
            "请输入当前密码 / 临时密码",
            forcePasswordValidationError("", "new-password", "new-password")
        )
        assertEquals(
            "新密码至少 8 位",
            forcePasswordValidationError("temporary-password", "short", "short")
        )
        assertEquals(
            "请再次输入新密码",
            forcePasswordValidationError("temporary-password", "new-password", "")
        )
        assertEquals(
            "两次输入的新密码不一致",
            forcePasswordValidationError(
                "temporary-password",
                "new-password",
                "different-password"
            )
        )
        assertNull(
            forcePasswordValidationError(
                "temporary-password",
                "new-password",
                "new-password"
            )
        )
    }

    @Test
    fun temporaryPasswordSessionCannotBeEnrolledForBiometricQuickLogin() {
        assertEquals(
            false,
            shouldOfferBiometricEnrollment(
                session(identity("worker", "worker", "sewing", mustChangePassword = true))
            )
        )
        assertEquals(
            true,
            shouldOfferBiometricEnrollment(
                session(identity("worker", "worker", "sewing", mustChangePassword = false))
            )
        )
    }

    @Test
    fun passwordChangeRequiredIsRecognizedForAutomaticIdentityRefresh() {
        assertEquals(true, isPasswordChangeRequired(IllegalStateException("password_change_required")))
        assertEquals(false, isPasswordChangeRequired(IllegalStateException("network_error")))
    }

    private fun identity(
        role: String,
        accountType: String,
        workerType: String? = null,
        homeRoute: String = "/worker/scan",
        mustChangePassword: Boolean = false
    ) = AccountIdentity(
        accountId = "account-$role-${workerType.orEmpty()}",
        accountType = accountType,
        role = role,
        homeRoute = homeRoute,
        displayName = "测试用户",
        activeWorkerProfileId = workerType?.let { "profile-$it" },
        activeWorkerType = workerType,
        mustChangePassword = mustChangePassword
    )

    private fun session(identity: AccountIdentity) = Session(
        token = "token",
        expiresAt = "2026-08-30T00:00:00.000Z",
        identity = identity,
        endpoint = SelectedEndpoint("https://example.test", ApiMode.PUBLIC)
    )
}
