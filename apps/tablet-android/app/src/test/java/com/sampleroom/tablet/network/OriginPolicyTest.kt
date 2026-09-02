package com.sampleroom.tablet.network

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OriginPolicyTest {
    private val policy = OriginPolicy(setOf(
        "http://192.168.1.10:3001",
        "https://factory.example.test"
    ))

    @Test fun `allows only configured origins and tablet routes`() {
        assertTrue(policy.isAllowedMainFrame("http://192.168.1.10:3001/qc/tablet"))
        assertTrue(policy.isAllowedMainFrame("https://factory.example.test/receiver/tablet"))
        assertTrue(policy.isAllowedMainFrame("https://factory.example.test/planner/tablet"))
        assertTrue(policy.isAllowedMainFrame("https://factory.example.test/account/force-password"))
        assertTrue(policy.isAllowedMainFrame("https://factory.example.test/account/security"))
        assertTrue(policy.isAllowedMainFrame("https://factory.example.test/admin"))
        assertTrue(policy.isAllowedMainFrame("https://factory.example.test/admin/pricing"))
        assertFalse(policy.isAllowedMainFrame("https://factory.example.test/login"))
        assertTrue(OriginPolicy.isNativeLoginPath("https://factory.example.test/login"))
        assertFalse(policy.isAllowedMainFrame("https://factory.example.test/admin/unknown"))
        assertFalse(policy.isAllowedMainFrame("https://factory.example.test/system-owner"))
        assertFalse(policy.isAllowedMainFrame("https://evil.example/qc/tablet"))
    }

    @Test fun `blocks dangerous protocols and external resources`() {
        assertFalse(policy.isAllowedResource("javascript:alert(1)"))
        assertFalse(policy.isAllowedResource("file:///sdcard/secret"))
        assertFalse(policy.isAllowedResource("https://cdn.example/script.js"))
        assertTrue(policy.isAllowedResource("blob:https://factory.example.test/id"))
    }
}
