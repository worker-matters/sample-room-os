package com.sampleroom.tablet.printing

import android.app.Application
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.gengcon.www.jcprintersdk.JCPrintApi
import com.gengcon.www.jcprintersdk.callback.Callback
import com.gengcon.www.jcprintersdk.callback.PrintCallback
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class B1PrinterController(
    application: Application,
    private val onEvent: (state: String, message: String?) -> Unit
) {
    private val preferences = application.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val printing = AtomicBoolean(false)
    @Volatile private var status = STATUS_DISCONNECTED
    @Volatile private var connectedAddress: String? = null
    @Volatile private var connectedName: String? = null

    private val api = JCPrintApi.getInstance(object : Callback {
        override fun onConnectSuccess(address: String, type: Int) {
            connectedAddress = address
            connectedName = preferences.getString(KEY_NAME, "B1") ?: "B1"
            status = STATUS_CONNECTED
            preferences.edit().putString(KEY_ADDRESS, address).apply()
            emit(STATUS_CONNECTED, "B1 已连接")
        }

        override fun onDisConnect() {
            status = STATUS_DISCONNECTED
            connectedAddress = null
            emit(STATUS_DISCONNECTED, "B1 连接已断开")
        }

        override fun onElectricityChange(powerLevel: Int) = Unit
        override fun onCoverStatus(coverStatus: Int) = Unit
        override fun onPaperStatus(paperStatus: Int) = Unit
        override fun onRfidReadStatus(rfidReadStatus: Int) = Unit
        override fun onRibbonStatus(ribbonStatus: Int) = Unit
        override fun onRibbonRfidReadStatus(ribbonRfidReadStatus: Int) = Unit
        override fun onFirmErrors() = emit(STATUS_ERROR, "B1 固件状态异常，请检查打印机")
    })
    private val sdkReady = runCatching {
        api.initSdk(application).also { initialized ->
            if (initialized) api.initDefaultImageLibrarySettings("", "")
        }
    }.getOrDefault(false)

    fun savedAddress(): String? = preferences.getString(KEY_ADDRESS, null)

    fun stateJson(): String = JSONObject().apply {
        put("status", if (printing.get()) STATUS_PRINTING else status)
        put("name", connectedName ?: preferences.getString(KEY_NAME, ""))
        put("address", connectedAddress ?: preferences.getString(KEY_ADDRESS, ""))
    }.toString()

    fun connect(name: String, address: String) {
        if (!sdkReady) {
            emit(STATUS_ERROR, "精臣 B1 SDK 初始化失败")
            return
        }
        if (printing.get()) {
            emit(STATUS_ERROR, "正在打印，不能切换打印机")
            return
        }
        if (status == STATUS_CONNECTED && connectedAddress.equals(address, ignoreCase = true) && api.isConnection() == 0) {
            emit(STATUS_CONNECTED, "$name 已连接")
            return
        }
        status = STATUS_CONNECTING
        connectedName = name
        preferences.edit().putString(KEY_NAME, name).putString(KEY_ADDRESS, address).apply()
        emit(STATUS_CONNECTING, "正在连接 $name")
        executor.execute {
            if (api.isConnection() == 0 && !connectedAddress.equals(address, ignoreCase = true)) {
                runCatching { api.close() }
            }
            val result = runCatching { api.connectBluetoothPrinter(address) }.getOrElse { -1 }
            if (result != 0) {
                status = STATUS_DISCONNECTED
                emit(STATUS_ERROR, when (result) {
                    -2 -> "打印机连接忙，请彻底退出精臣官方 App 后重试"
                    -3 -> "该蓝牙设备不是受支持的精臣打印机"
                    else -> "B1 蓝牙连接失败，请重新搜索后连接"
                })
            }
        }
    }

    fun startPrint(jobJson: String): JSONObject {
        if (!sdkReady) return rejected("精臣 B1 SDK 初始化失败")
        if (!printing.compareAndSet(false, true)) {
            return rejected("已有打印任务正在进行")
        }
        if (api.isConnection() != 0 || status != STATUS_CONNECTED) {
            printing.set(false)
            return rejected("请先连接蓝牙 B1 打印机")
        }

        val job = runCatching { parseJob(jobJson) }.getOrElse {
            printing.set(false)
            return rejected(it.message ?: "打印数据无效")
        }
        executor.execute { executePrint(job) }
        return JSONObject().put("accepted", true)
    }

    private fun executePrint(job: PrintJob) {
        val pages = runCatching { job.pages.map(::renderPage) }.getOrElse {
            printing.set(false)
            emit(STATUS_ERROR, it.message ?: "标签绘制失败")
            return
        }
        val info = job.pages.map { page ->
            JSONObject().put(
                "printerImageProcessingInfo",
                JSONObject()
                    .put("orientation", 0)
                    .put("margin", JSONArray(listOf(0, 0, 0, 0)))
                    .put("printQuantity", job.copies)
                    .put("horizontalOffset", 0)
                    .put("verticalOffset", 0)
                    .put("width", page.widthMm)
                    .put("height", page.heightMm)
                    .put("epc", "")
            ).toString()
        }
        val committed = AtomicInteger(0)
        val failed = AtomicBoolean(false)
        status = STATUS_PRINTING
        emit(STATUS_PRINTING, "正在打印")
        api.setTotalPrintQuantity(pages.size * job.copies)
        api.startPrintJob(job.density, job.labelType, job.printMode, object : PrintCallback {
            override fun onError(errorCode: Int) = Unit

            override fun onError(errorCode: Int, printState: Int) {
                if (failed.compareAndSet(false, true)) {
                    printing.set(false)
                    status = if (errorCode == 22 || errorCode == 23) STATUS_DISCONNECTED else STATUS_CONNECTED
                    if (status == STATUS_DISCONNECTED) connectedAddress = null
                    emit(STATUS_ERROR, printErrorMessage(errorCode))
                }
            }

            override fun onBufferFree(pageIndex: Int, bufferSize: Int) {
                if (failed.get() || pageIndex > pages.size) return
                val start = committed.get()
                val count = minOf(bufferSize, pages.size - start)
                if (count <= 0) return
                api.commitData(
                    pages.subList(start, start + count),
                    info.subList(start, start + count)
                )
                committed.addAndGet(count)
            }

            override fun onProgress(pageIndex: Int, quantityIndex: Int, detail: HashMap<String, Any>) {
                if (pageIndex == pages.size && quantityIndex == job.copies && !failed.get()) {
                    api.endPrintJob()
                    printing.set(false)
                    status = STATUS_CONNECTED
                    emit(STATUS_COMPLETED, "打印完成")
                }
            }

            override fun onPause(success: Boolean) = Unit
            override fun onPausing() = Unit
            override fun onResume(success: Boolean) = Unit
            override fun onCancelJob(success: Boolean) = Unit
        })
    }

    private fun renderPage(page: PrintPage): String {
        api.drawEmptyLabel(page.widthMm, page.heightMm, 0, emptyList())
        page.elements.forEach { element ->
            when (element.type) {
                "qr" -> api.drawLabelQrCode(
                    element.x, element.y, element.width, element.height,
                    element.value, 31, 0
                )
                "text" -> api.drawLabelText(
                    element.x, element.y, element.width, element.height,
                    element.value, "", element.fontSize, 0,
                    0, 1, 6, 0f, 1f,
                    booleanArrayOf(element.bold, false, false, false)
                )
            }
        }
        return String(api.generateLabelJson(), StandardCharsets.UTF_8)
    }

    fun close() {
        if (sdkReady) {
            if (printing.get()) api.cancelJob()
            api.close()
        }
        executor.shutdown()
    }

    private fun emit(state: String, message: String?) {
        mainHandler.post { onEvent(state, message) }
    }

    private fun rejected(error: String) = JSONObject().put("accepted", false).put("error", error)

    private fun parseJob(raw: String): PrintJob {
        require(raw.length <= MAX_JOB_CHARS) { "打印数据过大" }
        val json = JSONObject(raw)
        require(json.optInt("schemaVersion") == 1 && json.optString("printerModel") == "B1") { "打印数据版本不兼容" }
        val copies = json.optInt("copies")
        val density = json.optInt("density")
        val labelType = json.optInt("labelType")
        val printMode = json.optInt("printMode")
        require(copies in 1..20 && density == 3 && labelType == 1 && printMode == 1) { "B1 打印参数无效" }
        val pagesJson = json.getJSONArray("pages")
        require(pagesJson.length() in 1..100) { "标签数量必须为 1 至 100" }
        return PrintJob(copies, density, labelType, printMode, (0 until pagesJson.length()).map { index ->
            parsePage(pagesJson.getJSONObject(index))
        })
    }

    private fun parsePage(json: JSONObject): PrintPage {
        val width = json.optDouble("widthMm").toFloat()
        val height = json.optDouble("heightMm").toFloat()
        require(width in 20f..50f && height in 20f..200f) { "B1 标签尺寸超出支持范围" }
        val elementsJson = json.getJSONArray("elements")
        require(elementsJson.length() in 1..10) { "标签元素数量无效" }
        val elements = (0 until elementsJson.length()).map { index ->
            parseElement(elementsJson.getJSONObject(index), width, height)
        }
        return PrintPage(width, height, elements)
    }

    private fun parseElement(json: JSONObject, pageWidth: Float, pageHeight: Float): PrintElement {
        val type = json.optString("type")
        require(type == "qr" || type == "text") { "不支持的标签元素" }
        val x = json.optDouble("x").toFloat()
        val y = json.optDouble("y").toFloat()
        val width = json.optDouble("width").toFloat()
        val height = json.optDouble("height").toFloat()
        require(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= pageWidth && y + height <= pageHeight) {
            "标签元素超出纸张范围"
        }
        val value = json.optString("value")
        require(value.isNotBlank() && value.length <= if (type == "qr") 2048 else 200) { "标签内容无效" }
        val fontSize = if (type == "text") json.optDouble("fontSize", 2.4).toFloat() else 0f
        require(type != "text" || fontSize in 1.5f..6.5f) { "标签文字大小无效" }
        return PrintElement(
            type, x, y, width, height, value,
            fontSize,
            json.optBoolean("bold", false)
        )
    }

    private fun printErrorMessage(code: Int) = when (code) {
        1 -> "打印机上盖未关闭"
        2, 8 -> "未检测到标签纸或标签纸已用完"
        3 -> "打印机电量过低"
        7 -> "打印头温度过高"
        9 -> "打印机正忙，请稍后再试"
        22 -> "B1 通讯异常，请退出其他打印 App 后重新搜索并连接"
        23 -> "B1 蓝牙连接已断开"
        else -> "B1 打印失败（错误码 $code）"
    }

    private data class PrintJob(
        val copies: Int,
        val density: Int,
        val labelType: Int,
        val printMode: Int,
        val pages: List<PrintPage>
    )
    private data class PrintPage(val widthMm: Float, val heightMm: Float, val elements: List<PrintElement>)
    private data class PrintElement(
        val type: String,
        val x: Float,
        val y: Float,
        val width: Float,
        val height: Float,
        val value: String,
        val fontSize: Float,
        val bold: Boolean
    )

    companion object {
        const val STATUS_DISCONNECTED = "disconnected"
        const val STATUS_CONNECTING = "connecting"
        const val STATUS_CONNECTED = "connected"
        const val STATUS_PRINTING = "printing"
        const val STATUS_COMPLETED = "completed"
        const val STATUS_ERROR = "error"
        private const val PREFERENCES = "sample_room_b1_printer"
        private const val KEY_NAME = "device_name"
        private const val KEY_ADDRESS = "device_address"
        private const val MAX_JOB_CHARS = 512_000
    }
}
