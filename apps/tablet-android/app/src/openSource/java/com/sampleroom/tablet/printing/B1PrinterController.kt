package com.sampleroom.tablet.printing

import android.app.Application
import org.json.JSONObject

/** Open-source fallback; the real implementation is in the optional jingchen variant. */
class B1PrinterController(
    application: Application,
    private val onEvent: (state: String, message: String?) -> Unit
) {
    fun savedAddress(): String? = null

    fun stateJson(): String = JSONObject().apply {
        put("status", STATUS_UNAVAILABLE)
        put("name", "")
        put("address", "")
    }.toString()

    fun connect(name: String, address: String) {
        onEvent(STATUS_ERROR, "精臣 B1 集成需要官方 SDK；请参阅 vendor/jingchen/README.md")
    }

    fun startPrint(jobJson: String): JSONObject = JSONObject()
        .put("accepted", false)
        .put("error", "精臣 B1 集成需要官方 SDK；请参阅 vendor/jingchen/README.md")

    fun close() = Unit

    companion object {
        const val STATUS_DISCONNECTED = "disconnected"
        const val STATUS_CONNECTING = "connecting"
        const val STATUS_CONNECTED = "connected"
        const val STATUS_PRINTING = "printing"
        const val STATUS_COMPLETED = "completed"
        const val STATUS_ERROR = "error"
        const val STATUS_UNAVAILABLE = "unavailable"
    }
}
