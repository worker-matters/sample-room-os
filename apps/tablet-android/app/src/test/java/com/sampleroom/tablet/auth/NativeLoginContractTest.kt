package com.sampleroom.tablet.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class NativeLoginContractTest {
    @Test fun `phone number uses phoneNumber without guessing username`() {
        val payload = NativeLoginContract.payload(" 13800000000 ", "secret")
        assertEquals("13800000000", payload.getString("phoneNumber"))
        assertFalse(payload.has("username"))
        assertEquals("android", payload.getString("clientType"))
    }

    @Test fun `other account uses username without a second request`() {
        val payload = NativeLoginContract.payload(" receiver@example.test ", "secret")
        assertEquals("receiver@example.test", payload.getString("username"))
        assertFalse(payload.has("phoneNumber"))
    }

    @Test fun `routes only approved roles and forces password change first`() {
        val receiver = user(role = "receiver", accountType = "business")
        val planner = user(role = "planner", accountType = "business")
        val qc = user(
            role = "worker",
            accountType = "worker",
            activeWorkerType = "qc_delivery",
            activeWorkerProfileId = "qc-profile"
        )
        assertEquals("/receiver/tablet", TabletRoutePolicy.routeFor(receiver))
        assertEquals("/planner/tablet", TabletRoutePolicy.routeFor(planner))
        assertEquals("/qc/tablet", TabletRoutePolicy.routeFor(qc))
        assertEquals("/admin", TabletRoutePolicy.routeFor(user(role = "boss", accountType = "business")))
        assertEquals("/account/force-password", TabletRoutePolicy.routeFor(receiver.copy(mustChangePassword = true)))
        assertEquals("/account/force-password", TabletRoutePolicy.routeFor(user(role = "boss", accountType = "business").copy(mustChangePassword = true)))
        assertNull(TabletRoutePolicy.routeFor(qc.copy(activeWorkerType = "sewing")))
    }

    private fun user(
        role: String,
        accountType: String,
        activeWorkerType: String? = null,
        activeWorkerProfileId: String? = null
    ) = TabletAuthenticatedUser(
        id = "account-1",
        accountId = "account-1",
        accountType = accountType,
        role = role,
        displayName = "Tester",
        activeWorkerProfileId = activeWorkerProfileId,
        activeWorkerType = activeWorkerType,
        mustChangePassword = false
    )
}
