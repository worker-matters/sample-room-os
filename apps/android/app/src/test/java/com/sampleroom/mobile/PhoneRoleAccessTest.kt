package com.sampleroom.mobile

import com.sampleroom.mobile.data.AccountIdentity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneRoleAccessTest {
    @Test
    fun plannerAndTargetWorkersAreAllowed() {
        assertTrue(isSupportedPhoneIdentity(identity("planner", "business")))
        assertTrue(isSupportedPhoneIdentity(identity("worker", "worker", "cutting")))
        assertTrue(isSupportedPhoneIdentity(identity("worker", "worker", "sewing")))
        assertTrue(isSupportedPhoneIdentity(identity("worker", "worker", "qc_delivery")))
    }

    @Test
    fun otherBusinessRolesAndUnknownWorkerTypesAreRejected() {
        assertFalse(isSupportedPhoneIdentity(identity("receiver", "business")))
        assertFalse(isSupportedPhoneIdentity(identity("boss", "business")))
        assertFalse(isSupportedPhoneIdentity(identity("qc", "business")))
        assertFalse(isSupportedPhoneIdentity(identity("client_business_user", "business")))
        assertFalse(isSupportedPhoneIdentity(identity("worker", "worker", "finishing")))
    }

    private fun identity(role: String, accountType: String, workerType: String? = null) = AccountIdentity(
        accountId = "account-$role-${workerType.orEmpty()}",
        accountType = accountType,
        role = role,
        homeRoute = if (role == "planner") "/planner/home" else "/worker/home",
        displayName = "测试用户",
        activeWorkerProfileId = workerType?.let { "profile-$it" },
        activeWorkerType = workerType
    )
}
