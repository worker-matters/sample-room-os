package com.sampleroom.mobile

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewModelScope
import com.sampleroom.mobile.data.AccountIdentity
import com.sampleroom.mobile.data.ApiClient
import com.sampleroom.mobile.data.ApiMode
import com.sampleroom.mobile.data.EndpointConnectionRefusedException
import com.sampleroom.mobile.data.EndpointHttpException
import com.sampleroom.mobile.data.EndpointSelector
import com.sampleroom.mobile.data.EndpointTimeoutException
import com.sampleroom.mobile.data.IncompatibleApiVersionException
import com.sampleroom.mobile.data.MalformedEndpointUrlException
import com.sampleroom.mobile.data.MobileOrder
import com.sampleroom.mobile.data.MobileAttachment
import com.sampleroom.mobile.data.NetworkConfigParser
import com.sampleroom.mobile.data.NotSampleRoomApiException
import com.sampleroom.mobile.data.OkHttpHealthProbe
import com.sampleroom.mobile.data.ReceiverCustomer
import com.sampleroom.mobile.data.ReceiverIntakeDraft
import com.sampleroom.mobile.data.ReceiverScanChargeContext
import com.sampleroom.mobile.data.ReceiverCharge
import com.sampleroom.mobile.data.ScanResult
import com.sampleroom.mobile.data.WorkerScanCompletion
import com.sampleroom.mobile.data.Session
import com.sampleroom.mobile.data.SessionStore
import com.sampleroom.mobile.data.UploadPayload
import com.sampleroom.mobile.data.AccountSecurityProfile
import com.sampleroom.mobile.data.BossCustomerChargeItem
import com.sampleroom.mobile.data.BossInternalCostItem
import com.sampleroom.mobile.data.BossPricingDetail
import com.sampleroom.mobile.data.BossPricingRow
import com.sampleroom.mobile.data.ReconciliationStatement
import com.sampleroom.mobile.data.WorkerPerformance
import com.sampleroom.mobile.data.QcPerformanceRecord
import com.sampleroom.mobile.data.QcRecordDetail
import com.sampleroom.mobile.data.QcRecordPhoto
import com.sampleroom.mobile.data.SewingTask
import com.sampleroom.mobile.ui.SampleRoomApp
import com.sampleroom.mobile.ui.SampleRoomTheme
import com.sampleroom.mobile.update.AppReleaseInfo
import com.sampleroom.mobile.update.AppUpdateClient
import com.sampleroom.mobile.update.AppUpdateInstaller
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.net.UnknownHostException
import javax.net.ssl.SSLException

class MainActivity : ComponentActivity() {
    private lateinit var viewModel: AppViewModel
    private lateinit var updateInstaller: AppUpdateInstaller
    private var pendingUpdateApk: File? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        updateInstaller = AppUpdateInstaller(this)
        val factory = AppViewModel.Factory(SessionStore(this))
        viewModel = ViewModelProvider(this, factory)[AppViewModel::class.java]
        setContent {
            SampleRoomTheme {
                SampleRoomApp(viewModel, ::installRequiredUpdate)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (!::updateInstaller.isInitialized) return
        val pending = pendingUpdateApk ?: return
        if (updateInstaller.canRequestPackageInstalls()) {
            pendingUpdateApk = null
            viewModel.markAppUpdateInstallerLaunched()
            updateInstaller.launchInstaller(pending)
        } else {
            pendingUpdateApk = null
            viewModel.failRequiredAppUpdate("尚未允许此 App 安装更新，请重新点击立即更新并完成系统授权")
        }
    }

    private fun installRequiredUpdate(release: AppReleaseInfo) {
        viewModel.beginRequiredAppUpdate()
        lifecycleScope.launch {
            runCatching {
                updateInstaller.downloadAndVerify(release) { progress ->
                    runOnUiThread { viewModel.updateRequiredAppUpdateProgress(progress) }
                }
            }.onSuccess { apk ->
                if (updateInstaller.canRequestPackageInstalls()) {
                    viewModel.markAppUpdateInstallerLaunched()
                    updateInstaller.launchInstaller(apk)
                } else {
                    pendingUpdateApk = apk
                    viewModel.waitingForInstallPermission()
                    startActivity(updateInstaller.installPermissionIntent())
                }
            }.onFailure { error ->
                viewModel.failRequiredAppUpdate(error.message ?: "更新失败，请重试")
            }
        }
    }
}

sealed interface AppScreen {
    data object Boot : AppScreen
    data object Login : AppScreen
    data object ForcePasswordChange : AppScreen
    data object NetworkSettings : AppScreen
    data object NetworkScanner : AppScreen
    data object ReceiverHome : AppScreen
    data object ReceiverIntake : AppScreen
    data object ReceiverScanCharge : AppScreen
    data object PlannerHome : AppScreen
    data object PlannerProductionPlan : AppScreen
    data object PlannerSewingWaiting : AppScreen
    data object PlannerSewingDoing : AppScreen
    data object PlannerScanCharge : AppScreen
    data class PlannerOrderCharge(val order: MobileOrder) : AppScreen
    data class Orders(val kind: String) : AppScreen
    data class OrderDetail(val order: MobileOrder, val kind: String, val initialTab: String = "overview") : AppScreen
    data object WorkerHome : AppScreen
    data object BossHome : AppScreen
    data object BossPending : AppScreen
    data object BossStatements : AppScreen
    data class BossPricing(val orderId: String) : AppScreen
    data class StatementDetail(val statementId: String) : AppScreen
    data object WorkerPerformancePage : AppScreen
    data class WorkerQcRecordDetail(val orderId: String) : AppScreen
    data object AccountSecurity : AppScreen
    data object WorkerScan : AppScreen
    data object WorkerSewingTasks : AppScreen
    data object WorkerQcRework : AppScreen
    data class ScanResultPage(val result: ScanResult) : AppScreen
    data class Placeholder(val title: String, val message: String) : AppScreen
}

internal fun AppScreen.shouldNavigateBackWithinApp(): Boolean = when (this) {
    AppScreen.Boot,
    AppScreen.Login,
    AppScreen.ForcePasswordChange,
    AppScreen.ReceiverHome,
    AppScreen.PlannerHome,
    AppScreen.WorkerHome,
    AppScreen.BossHome,
    is AppScreen.Placeholder -> false
    is AppScreen.Orders -> kind != "client"
    else -> true
}

internal fun isSupportedPhoneIdentity(identity: AccountIdentity): Boolean = when {
    identity.role == "planner" && identity.accountType == "business" -> true
    identity.role == "worker" &&
        identity.accountType == "worker" &&
        identity.activeWorkerType in setOf("cutting", "sewing", "qc_delivery") -> true
    else -> false
}

internal fun authenticatedEntryScreen(identity: AccountIdentity): AppScreen {
    if (identity.mustChangePassword) return AppScreen.ForcePasswordChange
    return when (identity.homeRoute) {
        "/receiver/home", "/pages/receiver/home" -> AppScreen.ReceiverHome
        "/planner/home", "/pages/planner/home" -> AppScreen.PlannerHome
        "/client/home", "/pages/client/orders" -> AppScreen.Orders("client")
        "/worker/scan", "/pages/worker/home" -> AppScreen.WorkerHome
        "/boss", "/system-owner", "/pages/account/boss" -> AppScreen.BossHome
        "/pattern-maker" -> AppScreen.Placeholder("版师移动端尚未开放", "请继续使用现有 Web 工作台。")
        else -> AppScreen.Placeholder("移动入口暂未开放", "服务端返回：${identity.homeRoute}")
    }
}

internal const val UNSUPPORTED_PHONE_ROLE_MESSAGE =
    "本手机应用仅支持计划员、裁剪员工、缝制员工和组检/出库员工"

internal fun isPasswordChangeRequired(error: Throwable): Boolean =
    error.message == "password_change_required"

data class AppState(
    val screen: AppScreen = AppScreen.Boot,
    val session: Session? = null,
    val apiMode: ApiMode = ApiMode.UNDETECTED,
    val orders: List<MobileOrder> = emptyList(),
    val attachments: List<MobileAttachment> = emptyList(),
    val receiverCustomers: List<ReceiverCustomer> = emptyList(),
    val receiverChargePayload: String = "",
    val receiverChargeContext: ReceiverScanChargeContext? = null,
    val orderCharges: List<ReceiverCharge> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val lanBaseUrl: String = "",
    val publicBaseUrl: String = ""
    ,
    val bossRows: List<BossPricingRow> = emptyList(),
    val statements: List<ReconciliationStatement> = emptyList(),
    val selectedOrderIds: Set<String> = emptySet(),
    val bossPricingDetail: BossPricingDetail? = null,
    val selectedStatement: ReconciliationStatement? = null,
    val workerPerformance: WorkerPerformance? = null,
    val qcPerformanceRecords: List<QcPerformanceRecord> = emptyList(),
    val qcRecordDetail: QcRecordDetail? = null,
    val sewingTasks: List<SewingTask> = emptyList(),
    val qcReworkTasks: List<QcPerformanceRecord> = emptyList(),
    val accountProfile: AccountSecurityProfile? = null,
    val rememberedLoginIds: List<String> = emptyList(),
    val completionThanksVisible: Boolean = false,
    val completionThanksText: String = "感谢完工",
    val cuttingTaskCancelledVisible: Boolean = false,
    val taskAcceptedVisible: Boolean = false,
    val chargeEntrySuccessVisible: Boolean = false,
    val qcExportSavedVisible: Boolean = false,
    val refreshing: Boolean = false,
    val contentRevision: Long = 0L,
    val requiredAppUpdate: AppReleaseInfo? = null,
    val appUpdateBusy: Boolean = false,
    val appUpdateProgress: Int? = null,
    val appUpdateError: String? = null,
    val waitingInstallPermission: Boolean = false
)

private data class RefreshResult(
    val orders: List<MobileOrder>? = null,
    val attachments: List<MobileAttachment>? = null,
    val orderCharges: List<ReceiverCharge>? = null,
    val sewingTasks: List<SewingTask>? = null,
    val qcReworkTasks: List<QcPerformanceRecord>? = null,
    val accountProfile: AccountSecurityProfile? = null,
    val refreshedOrder: MobileOrder? = null
)

class AppViewModel(
    private val store: SessionStore,
    private val updateClient: AppUpdateClient = AppUpdateClient()
) : ViewModel() {
    private val api = ApiClient()
    private val endpointProbe = OkHttpHealthProbe()
    private val mutableState = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = mutableState.asStateFlow()
    private var plannerOrdersLoadedAt = 0L
    private var passwordRequirementRefreshInProgress = false

    init { startWithUpdateGate() }

    private fun selector() = EndpointSelector(store.lanBaseUrl(), store.publicBaseUrl(), endpointProbe)

    private suspend fun discoverRequiredUpdate(baseUrl: String): AppReleaseInfo? =
        runCatching { updateClient.latest(baseUrl) }
            .getOrNull()
            ?.takeIf { it.versionCode > BuildConfig.VERSION_CODE.toLong() }

    private fun startWithUpdateGate() = viewModelScope.launch {
        mutableState.value = AppState(screen = AppScreen.Boot)
        val selected = runCatching { selector().select() }.getOrNull()
        val required = selected?.let { discoverRequiredUpdate(it.baseUrl) }
        if (required != null) {
            mutableState.value = loginState().copy(requiredAppUpdate = required)
            return@launch
        }
        restoreSession()
    }

    fun beginRequiredAppUpdate() {
        mutableState.value = mutableState.value.copy(
            appUpdateBusy = true,
            appUpdateProgress = 0,
            appUpdateError = null,
            waitingInstallPermission = false
        )
    }

    fun updateRequiredAppUpdateProgress(progress: Int) {
        mutableState.value = mutableState.value.copy(
            appUpdateBusy = true,
            appUpdateProgress = progress.coerceIn(0, 100),
            appUpdateError = null
        )
    }

    fun waitingForInstallPermission() {
        mutableState.value = mutableState.value.copy(
            appUpdateBusy = false,
            waitingInstallPermission = true,
            appUpdateError = null
        )
    }

    fun markAppUpdateInstallerLaunched() {
        mutableState.value = mutableState.value.copy(
            appUpdateBusy = false,
            waitingInstallPermission = false,
            appUpdateError = null
        )
    }

    fun failRequiredAppUpdate(message: String) {
        mutableState.value = mutableState.value.copy(
            appUpdateBusy = false,
            waitingInstallPermission = false,
            appUpdateError = message
        )
    }

    private suspend fun syncPublishedNetworkConfig(baseUrl: String) {
        val published = endpointProbe.publishedNetworkConfig(baseUrl)
        val candidates = listOf(
            ApiMode.LAN to published.lanApiBaseUrl,
            ApiMode.PUBLIC to published.publicApiBaseUrl
        )
        var savedCount = 0
        for ((mode, raw) in candidates) {
            if (raw.isBlank()) continue
            runCatching {
                val normalized = NetworkConfigParser.normalizeBaseUrl(raw, mode)
                endpointProbe.validate(normalized, published.apiVersion)
                store.saveNetworkConfig(com.sampleroom.mobile.data.NetworkConfig(mode, normalized, null, published.apiVersion))
            }.onSuccess { savedCount += 1 }
        }
        check(savedCount > 0) { "管理员保存的网络地址当前均不可用" }
    }

    private fun loginState(error: String? = null, notice: String? = null) = AppState(
        screen = AppScreen.Login,
        error = error,
        notice = notice,
        lanBaseUrl = store.lanBaseUrl(),
        publicBaseUrl = store.publicBaseUrl(),
        rememberedLoginIds = store.loginHistory()
    )

    private fun restoreSession() = viewModelScope.launch {
        val token = store.token()
        if (token.isNullOrBlank()) {
            mutableState.value = loginState()
            val notice = runCatching {
                val selected = selector().select()
                syncPublishedNetworkConfig(selected.baseUrl)
            }.fold({ "已同步管理员保存的网络地址" }, { null })
            if (notice != null && mutableState.value.screen == AppScreen.Login) {
                mutableState.value = loginState(notice = notice)
            }
            return@launch
        }
        val session = runCatching {
            val endpoint = selector().select()
            api.restore(endpoint, token)
        }.getOrElse {
            store.clear()
            mutableState.value = loginState(readableError(it))
            return@launch
        }
        if (!isSupportedPhoneIdentity(session.identity)) {
            runCatching { api.logout(session) }
            store.clear()
            mutableState.value = loginState(UNSUPPORTED_PHONE_ROLE_MESSAGE)
            return@launch
        }
        store.save(session)
        mutableState.value = AppState(session = session, apiMode = session.endpoint.mode)
        routeFromIdentity(session.identity)
        viewModelScope.launch { runCatching { syncPublishedNetworkConfig(session.endpoint.baseUrl) } }
    }

    fun login(loginId: String, password: String) = viewModelScope.launch {
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        val session = runCatching {
            if (store.lanBaseUrl().isBlank() && store.publicBaseUrl().isBlank()) {
                throw IllegalStateException("请先打开网络设置并扫描 System Owner 提供的配置二维码")
            }
            val endpoint = selector().select()
            val required = discoverRequiredUpdate(endpoint.baseUrl)
            if (required != null) {
                mutableState.value = loginState().copy(requiredAppUpdate = required)
                return@launch
            }
            api.login(endpoint, loginId, password)
        }.getOrElse {
            mutableState.value = mutableState.value.copy(loading = false, error = readableError(it))
            return@launch
        }
        if (!isSupportedPhoneIdentity(session.identity)) {
            runCatching { api.logout(session) }
            store.clear()
            mutableState.value = loginState(UNSUPPORTED_PHONE_ROLE_MESSAGE)
            return@launch
        }
        store.save(session)
        store.recordSuccessfulLogin(loginId)
        mutableState.value = AppState(
            session = session,
            apiMode = session.endpoint.mode,
            rememberedLoginIds = store.loginHistory()
        )
        routeFromIdentity(session.identity)
    }

    fun clearLoginHistory() {
        store.clearLoginHistory()
        mutableState.value = mutableState.value.copy(rememberedLoginIds = emptyList())
    }

    fun logout() = viewModelScope.launch {
        val session = mutableState.value.session
        if (store.biometricQuickLoginEnabled()) {
            // Treat in-app sign out as a local lock when biometric quick login is enrolled.
            // The encrypted credential remains protected by BiometricPrompt for the next cold start.
            mutableState.value = loginState()
            return@launch
        }
        session?.let { runCatching { api.logout(it) } }
        store.clear()
        mutableState.value = loginState()
    }

    fun openNetworkSettings() {
        mutableState.value = AppState(
            screen = AppScreen.NetworkSettings,
            lanBaseUrl = store.lanBaseUrl(),
            publicBaseUrl = store.publicBaseUrl()
        )
    }

    fun openNetworkScanner() {
        mutableState.value = mutableState.value.copy(
            screen = AppScreen.NetworkScanner,
            error = null,
            notice = null
        )
    }

    fun applyNetworkQr(payload: String) = viewModelScope.launch {
        mutableState.value = mutableState.value.copy(loading = true, error = null, notice = null)
        runCatching {
            val config = NetworkConfigParser.parse(payload)
            endpointProbe.validate(config.baseUrl, config.apiVersion)
            store.saveNetworkConfig(config)
            config
        }.onSuccess { config ->
            mutableState.value = AppState(
                screen = AppScreen.NetworkSettings,
                notice = "${if (config.addressType == ApiMode.LAN) "局域网" else "公网"}服务器地址已验证并保存",
                lanBaseUrl = store.lanBaseUrl(),
                publicBaseUrl = store.publicBaseUrl()
            )
            viewModelScope.launch {
                if (runCatching { syncPublishedNetworkConfig(config.baseUrl) }.isSuccess &&
                    mutableState.value.screen == AppScreen.NetworkSettings
                ) {
                    mutableState.value = mutableState.value.copy(
                        lanBaseUrl = store.lanBaseUrl(),
                        publicBaseUrl = store.publicBaseUrl()
                    )
                }
            }
        }.onFailure {
            mutableState.value = AppState(
                screen = AppScreen.NetworkSettings,
                error = readableNetworkError(it),
                lanBaseUrl = store.lanBaseUrl(),
                publicBaseUrl = store.publicBaseUrl()
            )
        }
    }

    fun reportNetworkScannerError(message: String) {
        mutableState.value = AppState(
            screen = AppScreen.NetworkSettings,
            error = message,
            lanBaseUrl = store.lanBaseUrl(),
            publicBaseUrl = store.publicBaseUrl()
        )
    }

    fun clearNetworkConfig(mode: ApiMode) {
        store.clearNetworkConfig(mode)
        mutableState.value = AppState(
            screen = AppScreen.NetworkSettings,
            notice = "${if (mode == ApiMode.LAN) "局域网" else "公网"}地址已清除",
            lanBaseUrl = store.lanBaseUrl(),
            publicBaseUrl = store.publicBaseUrl()
        )
    }

    fun closeNetworkSettings() {
        startWithUpdateGate()
    }

    fun openReceiverHome() { mutableState.value = mutableState.value.copy(screen = AppScreen.ReceiverHome) }

    fun openPlannerHome() {
        mutableState.value = mutableState.value.copy(screen = AppScreen.PlannerHome, error = null)
        refreshPlannerOrdersIfStale()
    }

    private fun refreshPlannerOrdersIfStale(force: Boolean = false) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        if (session.identity.role != "planner") return@launch
        if (!force && mutableState.value.orders.isNotEmpty() && System.currentTimeMillis() - plannerOrdersLoadedAt < 60_000) return@launch
        runCatching { api.listOrders(session) }
            .onSuccess {
                plannerOrdersLoadedAt = System.currentTimeMillis()
                mutableState.value = mutableState.value.copy(
                    orders = it,
                    contentRevision = mutableState.value.contentRevision + 1
                )
            }
            .onFailure { mutableState.value = mutableState.value.copy(error = readableError(it)) }
    }

    private fun openPlannerSewingList(screen: AppScreen) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(screen = screen, loading = true, error = null)
        runCatching { api.listOrders(session) }
            .onSuccess {
                plannerOrdersLoadedAt = System.currentTimeMillis()
                mutableState.value = mutableState.value.copy(
                    orders = it,
                    loading = false,
                    contentRevision = mutableState.value.contentRevision + 1
                )
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun openPlannerSewingWaiting() = openPlannerSewingList(AppScreen.PlannerSewingWaiting)
    fun openPlannerSewingDoing() = openPlannerSewingList(AppScreen.PlannerSewingDoing)

    fun openPlannerProductionPlan() = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(screen = AppScreen.PlannerProductionPlan, loading = true, error = null)
        runCatching { api.listOrders(session) }
            .onSuccess { mutableState.value = mutableState.value.copy(
                orders = it,
                loading = false,
                contentRevision = mutableState.value.contentRevision + 1
            ) }
            .onFailure { mutableState.value = mutableState.value.copy(orders = emptyList(), loading = false, error = readableError(it)) }
    }

    fun openReceiverIntake() = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(screen = AppScreen.ReceiverIntake, loading = true, error = null, notice = null)
        runCatching { api.listReceiverSelfEntryOptions(session) }
            .onSuccess { mutableState.value = mutableState.value.copy(receiverCustomers = it, loading = false) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun submitReceiverIntake(
        draft: ReceiverIntakeDraft,
        files: List<UploadPayload>,
        thumbnail: UploadPayload?,
        quick: Boolean
    ) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null, notice = null)
        runCatching { api.createReceiverIntake(session, draft, files, thumbnail, quick) }
            .onSuccess { order ->
                mutableState.value = mutableState.value.copy(
                    loading = false,
                    notice = if (quick) "已生成待校对订单 ${order.styleNo}" else "完整订单 ${order.styleNo} 已创建"
                )
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun openReceiverScanCharge() {
        mutableState.value = mutableState.value.copy(
            screen = AppScreen.ReceiverScanCharge,
            receiverChargePayload = "",
            receiverChargeContext = null,
            chargeEntrySuccessVisible = false,
            error = null,
            notice = null
        )
    }

    fun resolveReceiverChargePayload(payload: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null, notice = null)
        runCatching { api.resolveReceiverScanCharge(session, payload) }
            .onSuccess { context ->
                mutableState.value = mutableState.value.copy(
                    loading = false,
                    receiverChargePayload = payload,
                    receiverChargeContext = context
                )
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun submitReceiverCharge(name: String, amount: Double, explanation: String, files: List<UploadPayload>) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        val payload = mutableState.value.receiverChargePayload
        if (payload.isBlank()) return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null, notice = null)
        runCatching { api.createReceiverScanCharge(session, payload, name, amount, explanation, files) }
            .onSuccess { context ->
                mutableState.value = mutableState.value.copy(
                    loading = false,
                    receiverChargeContext = context,
                    notice = null,
                    chargeEntrySuccessVisible = true
                )
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun openPlannerScanCharge() {
        mutableState.value = mutableState.value.copy(
            screen = AppScreen.PlannerScanCharge,
            receiverChargePayload = "",
            receiverChargeContext = null,
            chargeEntrySuccessVisible = false,
            error = null,
            notice = null
        )
    }

    fun resolvePlannerChargePayload(payload: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null, notice = null)
        runCatching { api.resolvePlannerScanCharge(session, payload) }
            .onSuccess { context ->
                mutableState.value = mutableState.value.copy(
                    loading = false,
                    receiverChargePayload = payload,
                    receiverChargeContext = context
                )
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun submitPlannerCharge(name: String, amount: Double, explanation: String, files: List<UploadPayload>) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        val payload = mutableState.value.receiverChargePayload
        if (payload.isBlank()) return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null, notice = null)
        runCatching { api.createPlannerScanCharge(session, payload, name, amount, explanation, files) }
            .onSuccess { context ->
                mutableState.value = mutableState.value.copy(
                    loading = false,
                    receiverChargeContext = context,
                    notice = null,
                    chargeEntrySuccessVisible = true
                )
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun openPlannerOrderCharge(order: MobileOrder) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(
            screen = AppScreen.PlannerOrderCharge(order),
            receiverChargePayload = "",
            receiverChargeContext = null,
            chargeEntrySuccessVisible = false,
            loading = true,
            error = null,
            notice = null
        )
        runCatching { api.getPlannerOrderChargeContext(session, order) }
            .onSuccess { context ->
                mutableState.value = mutableState.value.copy(
                    loading = false,
                    receiverChargeContext = context
                )
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun submitPlannerOrderCharge(name: String, amount: Double, explanation: String, files: List<UploadPayload>) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        val order = (mutableState.value.screen as? AppScreen.PlannerOrderCharge)?.order ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null, notice = null)
        runCatching { api.createPlannerOrderCharge(session, order, name, amount, explanation, files) }
            .onSuccess { context ->
                mutableState.value = mutableState.value.copy(
                    loading = false,
                    receiverChargeContext = context,
                    chargeEntrySuccessVisible = true
                )
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun openOrders(kind: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(screen = AppScreen.Orders(kind), loading = true, error = null)
        runCatching { api.listOrders(session) }
            .onSuccess { mutableState.value = mutableState.value.copy(
                orders = it,
                loading = false,
                contentRevision = mutableState.value.contentRevision + 1
            ) }
            .onFailure { mutableState.value = mutableState.value.copy(orders = emptyList(), loading = false, error = readableError(it)) }
    }

    fun openOrder(order: MobileOrder, kind: String, initialTab: String = "overview") {
        mutableState.value = mutableState.value.copy(
            screen = AppScreen.OrderDetail(order, kind, initialTab),
            attachments = emptyList(),
            orderCharges = emptyList(),
            notice = null,
            error = null
        )
        if (kind == "receiver" || kind.startsWith("planner")) loadReceiverAttachments(order.id)
        if (kind == "receiver" || kind.startsWith("planner")) loadOrderCharges(order.id)
    }

    private fun loadReceiverAttachments(orderId: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        runCatching { api.listReceiverAttachments(session, orderId) }
            .onSuccess { attachments ->
                mutableState.value = mutableState.value.copy(
                    attachments = attachments
                )
            }
            .onFailure { mutableState.value = mutableState.value.copy(error = readableError(it)) }
    }

    private fun loadOrderCharges(orderId: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        runCatching { api.listOrderCharges(session, orderId) }
            .onSuccess { charges -> mutableState.value = mutableState.value.copy(orderCharges = charges) }
            .onFailure { mutableState.value = mutableState.value.copy(error = readableError(it)) }
    }

    fun openScanner() { mutableState.value = mutableState.value.copy(screen = AppScreen.WorkerScan, error = null) }

    fun openWorkerHome() {
        mutableState.value = mutableState.value.copy(screen = AppScreen.WorkerHome, error = null)
        refreshWorkerQueues()
    }

    fun refreshCurrentScreen() = viewModelScope.launch {
        val snapshot = mutableState.value
        val session = snapshot.session ?: return@launch
        if (snapshot.refreshing) return@launch
        mutableState.value = snapshot.copy(refreshing = true, error = null)
        runCatching {
            when (val screen = snapshot.screen) {
                AppScreen.PlannerHome,
                AppScreen.PlannerSewingWaiting,
                AppScreen.PlannerSewingDoing,
                AppScreen.ReceiverHome,
                is AppScreen.Orders -> RefreshResult(orders = api.listOrders(session))
                AppScreen.WorkerHome -> when (session.identity.activeWorkerType) {
                    "sewing" -> RefreshResult(sewingTasks = api.listOwnSewingTasks(session))
                    "qc_delivery" -> RefreshResult(qcReworkTasks = api.listQcReworkTasks(session))
                    else -> RefreshResult()
                }
                AppScreen.WorkerSewingTasks -> RefreshResult(sewingTasks = api.listOwnSewingTasks(session))
                AppScreen.WorkerQcRework -> RefreshResult(qcReworkTasks = api.listQcReworkTasks(session))
                is AppScreen.OrderDetail -> {
                    val orders = api.listOrders(session)
                    val canLoadSupportingData = screen.kind == "receiver" || screen.kind.startsWith("planner")
                    RefreshResult(
                        orders = orders,
                        attachments = if (canLoadSupportingData) {
                            api.listReceiverAttachments(session, screen.order.id)
                        } else null,
                        orderCharges = if (canLoadSupportingData) {
                            api.listOrderCharges(session, screen.order.id)
                        } else null,
                        refreshedOrder = orders.find { it.id == screen.order.id }
                    )
                }
                AppScreen.AccountSecurity -> RefreshResult(accountProfile = api.getAccountSecurity(session))
                else -> RefreshResult()
            }
        }.onSuccess { refreshed ->
            val current = mutableState.value
            val currentScreen = current.screen
            mutableState.value = current.copy(
                orders = refreshed.orders ?: current.orders,
                attachments = refreshed.attachments ?: current.attachments,
                orderCharges = refreshed.orderCharges ?: current.orderCharges,
                sewingTasks = refreshed.sewingTasks ?: current.sewingTasks,
                qcReworkTasks = refreshed.qcReworkTasks ?: current.qcReworkTasks,
                accountProfile = refreshed.accountProfile ?: current.accountProfile,
                screen = if (currentScreen is AppScreen.OrderDetail && refreshed.refreshedOrder != null) {
                    currentScreen.copy(order = refreshed.refreshedOrder)
                } else currentScreen,
                refreshing = false,
                contentRevision = current.contentRevision + 1
            )
            if (refreshed.orders != null && session.identity.role == "planner") {
                plannerOrdersLoadedAt = System.currentTimeMillis()
            }
        }.onFailure {
            mutableState.value = mutableState.value.copy(refreshing = false, error = readableError(it))
        }
    }

    private fun refreshWorkerQueues() = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        when (session.identity.activeWorkerType) {
            "sewing" -> runCatching { api.listOwnSewingTasks(session) }
                .onSuccess { mutableState.value = mutableState.value.copy(
                    sewingTasks = it,
                    contentRevision = mutableState.value.contentRevision + 1
                ) }
            "qc_delivery" -> runCatching { api.listQcReworkTasks(session) }
                .onSuccess { mutableState.value = mutableState.value.copy(
                    qcReworkTasks = it,
                    contentRevision = mutableState.value.contentRevision + 1
                ) }
        }
    }

    fun openWorkerSewingTasks(capacityError: String? = null) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(
            screen = AppScreen.WorkerSewingTasks,
            loading = true,
            error = capacityError
        )
        runCatching { api.listOwnSewingTasks(session) }
            .onSuccess { mutableState.value = mutableState.value.copy(
                sewingTasks = it,
                loading = false,
                contentRevision = mutableState.value.contentRevision + 1
            ) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun openWorkerQcRework() = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(screen = AppScreen.WorkerQcRework, loading = true, error = null)
        runCatching { api.listQcReworkTasks(session) }
            .onSuccess { mutableState.value = mutableState.value.copy(
                qcReworkTasks = it,
                loading = false,
                contentRevision = mutableState.value.contentRevision + 1
            ) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun openWorkerSewingTask(orderId: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.getOwnSewingTask(session, orderId) }
            .onSuccess { mutableState.value = mutableState.value.copy(
                screen = AppScreen.ScanResultPage(it),
                loading = false
            ) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun openQcRecordDetail(orderId: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(
            screen = AppScreen.WorkerQcRecordDetail(orderId),
            qcRecordDetail = null,
            loading = true,
            error = null,
            qcExportSavedVisible = false
        )
        runCatching { api.getQcRecordDetail(session, orderId) }
            .onSuccess { mutableState.value = mutableState.value.copy(
                qcRecordDetail = it,
                loading = false
            ) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun addQcRecordPhotos(orderId: String, uploads: List<UploadPayload>) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.addQcRecordPhotos(session, orderId, uploads) }
            .onSuccess { openQcRecordDetail(orderId) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun updateQcRecordPhoto(orderId: String, photo: QcRecordPhoto, name: String, category: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.updateQcRecordPhoto(session, orderId, photo.id, name, category) }
            .onSuccess { openQcRecordDetail(orderId) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun deleteQcRecordPhoto(orderId: String, photoId: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.deleteQcRecordPhoto(session, orderId, photoId) }
            .onSuccess { openQcRecordDetail(orderId) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun exportQcRecordPhotos(context: Context, format: QcPhotoExportFormat) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        val detail = mutableState.value.qcRecordDetail ?: return@launch
        if (detail.photos.isEmpty()) {
            mutableState.value = mutableState.value.copy(error = "当前记录没有可导出的照片")
            return@launch
        }
        mutableState.value = mutableState.value.copy(loading = true, error = null, notice = null)
        runCatching {
            val photoData = detail.photos.sortedByDescending(QcRecordPhoto::createdAt).map { photo ->
                photo to api.downloadQcRecordPhoto(session, detail.record.orderId, photo.id)
            }
            QcPhotoExporter.export(context.applicationContext, detail, format, photoData)
        }.onSuccess {
            mutableState.value = mutableState.value.copy(
                loading = false,
                notice = null,
                qcExportSavedVisible = true
            )
        }.onFailure {
            mutableState.value = mutableState.value.copy(loading = false, error = readableError(it))
        }
    }

    fun finishQcExportSaved() {
        if (!mutableState.value.qcExportSavedVisible) return
        mutableState.value = mutableState.value.copy(qcExportSavedVisible = false, notice = null)
        openWorkerPerformance()
    }

    fun openWorkerQcReworkTask(orderId: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.getQcReworkTask(session, orderId) }
            .onSuccess { mutableState.value = mutableState.value.copy(
                screen = AppScreen.ScanResultPage(it),
                loading = false
            ) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun openBossHome() = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(screen = AppScreen.BossHome, loading = true, error = null)
        runCatching { api.listBossPricing(session) to api.listStatements(session) }
            .onSuccess { (rows, statements) -> mutableState.value = mutableState.value.copy(bossRows = rows, statements = statements, loading = false) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun openBossPending() = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(screen = AppScreen.BossPending, loading = true, error = null)
        runCatching { api.listBossPricing(session) }
            .onSuccess { rows -> mutableState.value = mutableState.value.copy(bossRows = rows, loading = false) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun openBossStatements() = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(screen = AppScreen.BossStatements, loading = true, error = null)
        runCatching { api.listStatements(session) }
            .onSuccess { statements -> mutableState.value = mutableState.value.copy(statements = statements, loading = false) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun toggleBossOrder(orderId: String) {
        val row = mutableState.value.bossRows.find { it.order.id == orderId } ?: return
        if (!row.eligible) return
        val ids = mutableState.value.selectedOrderIds.toMutableSet()
        if (!ids.add(orderId)) ids.remove(orderId)
        mutableState.value = mutableState.value.copy(selectedOrderIds = ids)
    }

    fun createBossStatement() = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        val ids = mutableState.value.selectedOrderIds.toList()
        if (ids.isEmpty()) return@launch
        val selectedRows = mutableState.value.bossRows.filter { ids.contains(it.order.id) }
        val first = selectedRows.firstOrNull()?.order
        if (first != null && selectedRows.any {
                it.order.customerName != first.customerName ||
                    it.order.salespersonName != first.salespersonName
            }) {
            mutableState.value = mutableState.value.copy(error = "请选择同一客户和客户业务员的订单")
            return@launch
        }
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.createStatement(session, ids) }
            .onSuccess {
                mutableState.value = mutableState.value.copy(selectedOrderIds = emptySet(), notice = "对账单已生成")
                openBossPending()
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun openBossPricing(orderId: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(screen = AppScreen.BossPricing(orderId), loading = true, error = null, bossPricingDetail = null)
        runCatching { fetchBossPricing(session, orderId) }
            .onSuccess { mutableState.value = mutableState.value.copy(bossPricingDetail = it, loading = false) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    private suspend fun fetchBossPricing(session: Session, orderId: String): BossPricingDetail {
        var detail = api.getBossPricing(session, orderId)
        if (detail.row.quotationStatus != "confirmed" && !detail.recommendationsInitialized) {
            detail = api.initializeBossPricing(session, orderId)
        }
        return detail.copy(otherCharges = api.listBossOrderCharges(session, orderId))
    }

    fun saveBossPricing(
        orderId: String,
        customerCharges: List<BossCustomerChargeItem>,
        internalCosts: List<BossInternalCostItem>,
        confirm: Boolean
    ) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        val current = mutableState.value.bossPricingDetail ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching {
            val customerIds = customerCharges.filterNot { it.id.startsWith("draft-") }.map { it.id }.toSet()
            current.customerCharges
                .filterNot { customerIds.contains(it.id) }
                .forEach { api.deleteBossCustomerCharge(session, orderId, it.id) }
            customerCharges.forEach {
                if (it.id.startsWith("draft-")) api.createBossCustomerCharge(session, orderId, it)
                else api.updateBossCustomerCharge(session, orderId, it)
            }

            val internalIds = internalCosts.filterNot { it.id.startsWith("draft-") }.map { it.id }.toSet()
            current.internalCosts
                .filterNot { internalIds.contains(it.id) }
                .forEach { api.deleteBossInternalCost(session, orderId, it.id) }
            internalCosts.forEach {
                if (it.id.startsWith("draft-")) api.createBossInternalCost(session, orderId, it)
                else api.updateBossInternalCost(session, orderId, it)
            }
            if (confirm) api.confirmBossQuotation(session, orderId)
            fetchBossPricing(session, orderId)
        }.onSuccess {
            mutableState.value = mutableState.value.copy(
                bossPricingDetail = it,
                loading = false,
                notice = if (confirm) "客户报价已确认" else "草稿已保存"
            )
        }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun beginBossPricingUpdate(orderId: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching {
            api.beginBossQuotationUpdate(session, orderId)
            fetchBossPricing(session, orderId)
        }.onSuccess {
            mutableState.value = mutableState.value.copy(
                bossPricingDetail = it,
                loading = false,
                notice = "已进入报价更新"
            )
        }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun createBossOtherCharge(orderId: String, name: String, amount: Double) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching {
            api.createBossOrderCharge(session, orderId, name, amount)
            fetchBossPricing(session, orderId)
        }.onSuccess {
            mutableState.value = mutableState.value.copy(bossPricingDetail = it, loading = false, notice = "其他费用已登记")
        }.onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun confirmBossOtherCharge(orderId: String, chargeId: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching {
            api.confirmBossOrderCharge(session, orderId, chargeId)
            fetchBossPricing(session, orderId)
        }.onSuccess {
            mutableState.value = mutableState.value.copy(bossPricingDetail = it, loading = false)
        }.onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun deleteBossOtherCharge(orderId: String, chargeId: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching {
            api.deleteBossOrderCharge(session, orderId, chargeId)
            fetchBossPricing(session, orderId)
        }.onSuccess {
            mutableState.value = mutableState.value.copy(bossPricingDetail = it, loading = false)
        }.onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun openStatement(statementId: String) {
        mutableState.value = mutableState.value.copy(
            screen = AppScreen.StatementDetail(statementId),
            selectedStatement = mutableState.value.statements.find { it.id == statementId },
            error = null
        )
    }

    fun returnStatementItem(itemId: String?) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        val statement = mutableState.value.selectedStatement ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { if (itemId == null) api.returnStatement(session, statement.id) else api.returnStatementItem(session, statement.id, itemId) }
            .onSuccess { mutableState.value = mutableState.value.copy(selectedStatement = it, loading = false) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun markStatementPaid(undo: Boolean) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        val statement = mutableState.value.selectedStatement ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching {
            if (undo) api.undoStatementPaid(session, statement.id)
            else api.markStatementPaid(session, statement.id)
        }.onSuccess { updated ->
            mutableState.value = mutableState.value.copy(
                selectedStatement = updated,
                statements = mutableState.value.statements.map {
                    if (it.id == updated.id) updated else it
                },
                loading = false,
                notice = if (undo) "已取消确认收款" else "已标记收款"
            )
        }.onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun openWorkerPerformance() = viewModelScope.launch {
        val today = java.time.LocalDate.now()
        val start = today.minusDays((today.dayOfWeek.value - 1).toLong())
        loadWorkerPerformance(start.toString(), today.toString(), openPage = true)
    }

    fun loadWorkerPerformance(dateFrom: String, dateTo: String, openPage: Boolean = false) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(
            screen = if (openPage) AppScreen.WorkerPerformancePage else mutableState.value.screen,
            loading = true,
            refreshing = !openPage,
            error = null
        )
        runCatching {
            val report = api.getOwnPerformance(session, dateFrom, dateTo)
            val qcRecords = if (session.identity.activeWorkerType == "qc_delivery") {
                api.listQcPerformanceRecords(session, dateFrom, dateTo)
            } else {
                emptyList()
            }
            report to qcRecords
        }
            .onSuccess { (report, qcRecords) ->
                mutableState.value = mutableState.value.copy(
                    workerPerformance = report,
                    qcPerformanceRecords = qcRecords,
                    loading = false,
                    refreshing = false,
                    contentRevision = mutableState.value.contentRevision + 1
                )
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, refreshing = false, error = readableError(it)) }
    }

    fun openAccountSecurity() = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(screen = AppScreen.AccountSecurity, loading = true, error = null)
        runCatching { api.getAccountSecurity(session) }
            .onSuccess { mutableState.value = mutableState.value.copy(accountProfile = it, loading = false) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun saveAccountProfile(username: String, displayName: String, phoneNumber: String, currentPassword: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.updateAccountSecurity(session, username, displayName, phoneNumber, currentPassword) }
            .onSuccess { (profile, signedOut) ->
                if (signedOut) {
                    store.clear()
                    mutableState.value = loginState(notice = "登录凭据已更新，请使用新信息重新登录")
                } else {
                    mutableState.value = mutableState.value.copy(accountProfile = profile, loading = false, notice = "账号资料已保存")
                }
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun savePassword(current: String, next: String, confirm: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.changePassword(session, current, next, confirm) }
            .onSuccess {
                store.clear()
                mutableState.value = loginState(notice = "密码已更新，请使用新密码重新登录")
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun renameAttachment(orderId: String, attachmentId: String, name: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        runCatching { api.renameAttachment(session, orderId, attachmentId, name) }
            .onSuccess { mutableState.value = mutableState.value.copy(attachments = it) }
            .onFailure { mutableState.value = mutableState.value.copy(error = readableError(it)) }
    }

    fun updateAttachment(orderId: String, attachmentId: String, name: String, visibility: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        runCatching { api.updateAttachment(session, orderId, attachmentId, name, visibility) }
            .onSuccess { mutableState.value = mutableState.value.copy(attachments = it) }
            .onFailure { mutableState.value = mutableState.value.copy(error = readableError(it)) }
    }

    fun renameOrderCharge(orderId: String, chargeId: String, name: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.renameOrderCharge(session, orderId, chargeId, name) }
            .onSuccess {
                mutableState.value = mutableState.value.copy(
                    orderCharges = it,
                    loading = false,
                    notice = "费用名称已更新"
                )
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun deleteOwnOrderCharge(orderId: String, chargeId: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.deleteOwnOrderCharge(session, orderId, chargeId) }
            .onSuccess {
                mutableState.value = mutableState.value.copy(
                    orderCharges = it,
                    loading = false,
                    notice = "费用记录已删除"
                )
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun updateOrderCharge(orderId: String, chargeId: String, name: String, amount: Double, explanation: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.updateOrderCharge(session, orderId, chargeId, name, amount, explanation) }
            .onSuccess { mutableState.value = mutableState.value.copy(orderCharges = it, loading = false, notice = "费用已保存") }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun renameChargeAttachment(orderId: String, chargeId: String, attachmentId: String, name: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        runCatching { api.renameChargeAttachment(session, orderId, chargeId, attachmentId, name) }
            .onSuccess { mutableState.value = mutableState.value.copy(orderCharges = it) }
            .onFailure { mutableState.value = mutableState.value.copy(error = readableError(it)) }
    }

    fun deleteChargeAttachment(orderId: String, chargeId: String, attachmentId: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        runCatching { api.deleteChargeAttachment(session, orderId, chargeId, attachmentId) }
            .onSuccess { mutableState.value = mutableState.value.copy(orderCharges = it) }
            .onFailure { mutableState.value = mutableState.value.copy(error = readableError(it)) }
    }

    fun deleteAttachment(orderId: String, attachmentId: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        runCatching { api.deleteAttachment(session, orderId, attachmentId) }
            .onSuccess { mutableState.value = mutableState.value.copy(attachments = it) }
            .onFailure { mutableState.value = mutableState.value.copy(error = readableError(it)) }
    }

    fun resolveScannedPayload(payload: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.resolveOrder(session, payload) }
            .onSuccess { mutableState.value = mutableState.value.copy(
                screen = AppScreen.ScanResultPage(it),
                loading = false,
                contentRevision = mutableState.value.contentRevision + 1
            ) }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun startWorkerScan(result: ScanResult) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.startWorkerScan(session, result) }
            .onSuccess { updated ->
                mutableState.value = mutableState.value.copy(
                    screen = AppScreen.ScanResultPage(updated),
                    loading = false,
                    notice = null,
                    taskAcceptedVisible = true
                )
            }
            .onFailure {
                val message = readableError(it)
                if (message == "当前已超过最大接单数量") openWorkerSewingTasks(message)
                else mutableState.value = mutableState.value.copy(loading = false, error = message)
            }
    }

    fun completeWorkerScan(result: ScanResult, completion: WorkerScanCompletion) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null, notice = null)
        runCatching { api.completeWorkerScan(session, result, completion) }
            .onSuccess { updated ->
                mutableState.value = mutableState.value.copy(
                    screen = AppScreen.ScanResultPage(updated),
                    loading = false,
                    notice = null,
                    completionThanksVisible = true,
                    completionThanksText = "感谢完工"
                )
            }
            .onFailure {
                val message = readableError(it)
                if (message == "裁剪任务已取消") {
                    mutableState.value = mutableState.value.copy(
                        screen = AppScreen.WorkerHome,
                        loading = false,
                        error = null,
                        cuttingTaskCancelledVisible = true
                    )
                    refreshWorkerQueues()
                } else {
                    mutableState.value = mutableState.value.copy(loading = false, error = message)
                }
            }
    }

    fun finishCuttingTaskCancelled() {
        if (!mutableState.value.cuttingTaskCancelledVisible) return
        mutableState.value = mutableState.value.copy(cuttingTaskCancelledVisible = false)
        openWorkerHome()
    }

    fun finishCompletionThanks() {
        if (!mutableState.value.completionThanksVisible) return
        val identity = mutableState.value.session?.identity ?: return
        mutableState.value = mutableState.value.copy(completionThanksVisible = false)
        routeFromIdentity(identity)
    }

    fun finishTaskAccepted() {
        if (!mutableState.value.taskAcceptedVisible) return
        val identity = mutableState.value.session?.identity ?: return
        mutableState.value = mutableState.value.copy(taskAcceptedVisible = false)
        routeFromIdentity(identity)
    }

    fun finishChargeEntrySuccess() {
        mutableState.value = mutableState.value.copy(chargeEntrySuccessVisible = false)
    }

    fun takeoverWorkerScan(result: ScanResult, reason: String) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.takeoverWorkerScan(session, result, reason) }
            .onSuccess { updated ->
                mutableState.value = mutableState.value.copy(
                    screen = AppScreen.ScanResultPage(updated),
                    loading = false,
                    notice = null,
                    taskAcceptedVisible = true
                )
            }
            .onFailure {
                val message = readableError(it)
                if (message == "当前已超过最大接单数量") openWorkerSewingTasks(message)
                else mutableState.value = mutableState.value.copy(loading = false, error = message)
            }
    }

    fun joinCollaborativeSewing(result: ScanResult) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null)
        runCatching { api.joinCollaborativeSewing(session, result) }
            .onSuccess { updated ->
                mutableState.value = mutableState.value.copy(
                    screen = AppScreen.ScanResultPage(updated),
                    loading = false,
                    notice = null,
                    taskAcceptedVisible = true
                )
            }
            .onFailure {
                val message = readableError(it)
                if (message == "当前已超过最大接单数量") openWorkerSewingTasks(message)
                else mutableState.value = mutableState.value.copy(loading = false, error = message)
            }
    }

    fun uploadMaterialRecord(order: MobileOrder, kind: String, upload: UploadPayload) = viewModelScope.launch {
        val session = mutableState.value.session ?: return@launch
        mutableState.value = mutableState.value.copy(loading = true, error = null, notice = null)
        runCatching { api.uploadReceiverMaterialRecord(session, order.id, upload) }
            .onSuccess {
                mutableState.value = mutableState.value.copy(
                    loading = false,
                    notice = "面辅料记录上传成功"
                )
                loadReceiverAttachments(order.id)
            }
            .onFailure { mutableState.value = mutableState.value.copy(loading = false, error = readableError(it)) }
    }

    fun showPlaceholder(title: String, message: String) {
        mutableState.value = mutableState.value.copy(screen = AppScreen.Placeholder(title, message), error = null)
    }

    fun back() {
        val current = mutableState.value.screen
        val identity = mutableState.value.session?.identity
        when (current) {
            is AppScreen.OrderDetail -> when (current.kind) {
                "planner-waiting" -> openPlannerSewingWaiting()
                "planner-sewing" -> openPlannerSewingDoing()
                "planner-production" -> openPlannerProductionPlan()
                else -> openOrders(current.kind)
            }
            is AppScreen.ScanResultPage -> {
                when (current.result.entrySource) {
                    "qc_rework" -> openWorkerQcRework()
                    "sewing_task" -> openWorkerSewingTasks()
                    else -> identity?.let(::routeFromIdentity)
                }
            }
            is AppScreen.Orders -> when (current.kind) {
                "receiver" -> openReceiverHome()
                "planner" -> openPlannerHome()
                else -> identity?.let(::routeFromIdentity)
            }
            AppScreen.PlannerProductionPlan, AppScreen.PlannerSewingWaiting,
            AppScreen.PlannerSewingDoing, AppScreen.PlannerScanCharge -> openPlannerHome()
            is AppScreen.PlannerOrderCharge -> openOrders("planner")
            AppScreen.ReceiverIntake, AppScreen.ReceiverScanCharge, AppScreen.WorkerScan,
            AppScreen.WorkerSewingTasks, AppScreen.WorkerQcRework -> identity?.let(::routeFromIdentity)
            AppScreen.BossPending, AppScreen.BossStatements -> openBossHome()
            is AppScreen.BossPricing -> openBossPending()
            is AppScreen.StatementDetail -> openBossStatements()
            AppScreen.ForcePasswordChange -> Unit
            AppScreen.WorkerPerformancePage, AppScreen.AccountSecurity -> identity?.let(::routeFromIdentity)
            is AppScreen.WorkerQcRecordDetail -> openWorkerPerformance()
            AppScreen.NetworkScanner -> openNetworkSettings()
            AppScreen.NetworkSettings -> closeNetworkSettings()
            else -> identity?.let(::routeFromIdentity)
        }
    }

    private fun routeFromIdentity(identity: AccountIdentity) {
        val screen = authenticatedEntryScreen(identity)
        mutableState.value = mutableState.value.copy(screen = screen, loading = false, error = null)
        if (screen is AppScreen.Orders) openOrders(screen.kind)
        if (screen is AppScreen.BossHome) openBossHome()
        if (screen is AppScreen.PlannerHome) refreshPlannerOrdersIfStale()
        if (screen is AppScreen.WorkerHome) refreshWorkerQueues()
    }

    private fun readableError(error: Throwable): String {
        if (isPasswordChangeRequired(error)) {
            refreshPasswordRequirement()
            return "正在同步账号安全状态…"
        }
        return when (error.message) {
            "invalid_credentials" -> "账号或密码错误"
            "unauthenticated" -> "登录已失效，请重新登录"
            else -> error.message ?: "操作失败"
        }
    }

    private fun refreshPasswordRequirement() {
        if (passwordRequirementRefreshInProgress) return
        val session = mutableState.value.session ?: return
        passwordRequirementRefreshInProgress = true
        viewModelScope.launch {
            runCatching { api.restore(session.endpoint, session.token) }
                .onSuccess { refreshed ->
                    val current = mutableState.value
                    val updatedSession = refreshed.copy(expiresAt = session.expiresAt)
                    mutableState.value = current.copy(
                        session = updatedSession,
                        loading = false,
                        refreshing = false,
                        error = null
                    )
                    routeFromIdentity(updatedSession.identity)
                }
                .onFailure { refreshError ->
                    if (refreshError.message == "unauthenticated") {
                        store.clear()
                        mutableState.value = loginState("登录已失效，请重新登录")
                    } else {
                        mutableState.value = mutableState.value.copy(
                            loading = false,
                            refreshing = false,
                            error = "账号安全状态同步失败，请重新登录"
                        )
                    }
                }
            passwordRequirementRefreshInProgress = false
        }
    }

    private fun readableNetworkError(error: Throwable): String = when (error) {
        is EndpointTimeoutException -> "服务器连接超时"
        is EndpointConnectionRefusedException -> "服务器拒绝连接"
        is MalformedEndpointUrlException -> "服务器地址格式错误"
        is EndpointHttpException -> error.message ?: "服务器返回 HTTP 错误"
        is IncompatibleApiVersionException -> error.message ?: "API 版本不兼容"
        is NotSampleRoomApiException -> "二维码地址不是本系统 API"
        is SSLException -> "HTTPS 证书错误，请联系 System Owner 检查证书"
        is UnknownHostException -> "当前网络无法解析服务器地址"
        is IllegalArgumentException -> error.message ?: "二维码或地址格式错误"
        else -> error.message ?: "服务器无法访问"
    }

    class Factory(private val store: SessionStore) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = AppViewModel(store) as T
    }
}
