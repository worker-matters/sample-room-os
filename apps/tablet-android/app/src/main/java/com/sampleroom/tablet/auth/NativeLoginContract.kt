package com.sampleroom.tablet.auth

import org.json.JSONObject

data class TabletAuthenticatedUser(
    val id: String,
    val accountId: String,
    val accountType: String,
    val role: String,
    val displayName: String,
    val activeWorkerProfileId: String?,
    val activeWorkerType: String?,
    val mustChangePassword: Boolean
)

data class NativeLoginResult(
    val user: TabletAuthenticatedUser,
    val setCookieHeaders: List<String>
)

object NativeLoginContract {
    private val phoneNumber = Regex("^1[3-9]\\d{9}$")

    fun payload(account: String, password: String): JSONObject {
        val normalized = account.trim()
        return JSONObject()
            .put(if (phoneNumber.matches(normalized)) "phoneNumber" else "username", normalized)
            .put("password", password)
            .put("clientType", "android")
    }
}

object TabletRoutePolicy {
    fun routeFor(user: TabletAuthenticatedUser): String? {
        val businessRoute = when {
            user.role == "receiver" && user.accountType == "business" -> "/receiver/tablet"
            user.role == "planner" && user.accountType == "business" -> "/planner/tablet"
            user.role == "boss" && user.accountType == "business" -> "/admin"
            user.role == "worker" &&
                user.accountType == "worker" &&
                user.activeWorkerType == "qc_delivery" &&
                !user.activeWorkerProfileId.isNullOrBlank() -> "/qc/tablet"
            else -> null
        }
        return businessRoute?.let {
            if (user.mustChangePassword) "/account/force-password" else it
        }
    }
}
