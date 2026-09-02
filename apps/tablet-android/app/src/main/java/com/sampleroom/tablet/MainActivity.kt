package com.sampleroom.tablet

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.net.Uri
import android.provider.Settings
import android.print.PrintAttributes
import android.print.PrintManager
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.widget.Button
import android.widget.ArrayAdapter
import android.widget.AutoCompleteTextView
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.sampleroom.tablet.auth.NativeLoginClient
import com.sampleroom.tablet.auth.LoginHistoryStore
import com.sampleroom.tablet.auth.TabletRoutePolicy
import com.sampleroom.tablet.network.AddressType
import com.sampleroom.tablet.network.EndpointSelector
import com.sampleroom.tablet.network.EndpointResolution
import com.sampleroom.tablet.network.HealthProbeResult
import com.sampleroom.tablet.network.LanPreferredEndpointResolver
import com.sampleroom.tablet.network.NetworkConfigParser
import com.sampleroom.tablet.network.NetworkConfigStore
import com.sampleroom.tablet.network.OkHttpHealthProbe
import com.sampleroom.tablet.network.OriginPolicy
import com.sampleroom.tablet.network.PublishedNetworkConfigClient
import com.sampleroom.tablet.network.SelectedEndpoint
import com.sampleroom.tablet.printing.B1PrinterController
import com.sampleroom.tablet.security.AndroidCookieBackend
import com.sampleroom.tablet.security.CookieSessionController
import com.sampleroom.tablet.security.SessionCookieHandoff
import com.sampleroom.tablet.update.AppReleaseInfo
import com.sampleroom.tablet.update.AppUpdateClient
import com.sampleroom.tablet.update.AppUpdateInstaller
import com.sampleroom.tablet.web.FileChooserCoordinator
import com.sampleroom.tablet.web.NativeFileActions
import com.sampleroom.tablet.web.LocalWebUiAssetProvider
import com.sampleroom.tablet.web.SecureTabletWebViewClient
import com.sampleroom.tablet.web.TabletBridgeHost
import com.sampleroom.tablet.web.TabletJavascriptBridge
import com.sampleroom.tablet.web.WebUiPackageClient
import com.sampleroom.tablet.web.WebUiPackageManifest
import com.sampleroom.tablet.web.WebUiPackageStore
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private data class LoginPreparation(
    val endpoint: SelectedEndpoint,
    val preferredAddressType: AddressType,
    val route: String,
    val cookieHeaders: List<String>,
    val manifest: WebUiPackageManifest,
    val account: String
)

class MainActivity : ComponentActivity(), TabletBridgeHost {
    private lateinit var root: FrameLayout
    private lateinit var configStore: NetworkConfigStore
    private lateinit var loginHistoryStore: LoginHistoryStore
    private lateinit var webUiPackageStore: WebUiPackageStore
    private lateinit var fileChooser: FileChooserCoordinator
    private lateinit var fileActions: NativeFileActions
    private lateinit var b1Printer: B1PrinterController
    private lateinit var accountInput: AutoCompleteTextView
    private lateinit var passwordInput: EditText
    private lateinit var loginButton: Button
    private lateinit var loginProgress: ProgressBar
    private lateinit var loginError: TextView
    private lateinit var networkStatus: TextView
    private lateinit var lanLineButton: Button
    private lateinit var publicLineButton: Button

    private var webView: WebView? = null
    private val sessionController = CookieSessionController(AndroidCookieBackend())
    private val healthProbe = OkHttpHealthProbe()
    private val endpointSelector = EndpointSelector(healthProbe)
    private val loginClient = NativeLoginClient()
    private val webUiPackageClient = WebUiPackageClient()
    private val publishedNetworkConfigClient = PublishedNetworkConfigClient()
    private val appUpdateClient = AppUpdateClient()
    private lateinit var appUpdateInstaller: AppUpdateInstaller
    private var requiredAppUpdate: AppReleaseInfo? = null
    private var appUpdateDialog: AlertDialog? = null
    private var pendingUpdateApk: java.io.File? = null
    private val lanPreferredEndpointResolver = LanPreferredEndpointResolver(
        endpointSelector,
        publishedNetworkConfigClient::fetch
    )
    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val recovering = AtomicBoolean(false)
    private val returningToLogin = AtomicBoolean(false)
    private val businessWriteActive = AtomicBoolean(false)
    private val networkSwitchInFlight = AtomicBoolean(false)
    private var endpoint: SelectedEndpoint? = null
    private var selectedAddressType: AddressType? = null
    private var originPolicy = OriginPolicy(emptySet())
    private var pendingDownload: Triple<String, String, String>? = null
    private var pendingGeneratedSave: Triple<String, String, String>? = null
    private var sessionReady = false
    private var loginInFlight = false
    private var versionCheckReady = false
    private var selectedManifest: WebUiPackageManifest? = null
    private var loadedUiVersion: String? = null
    private var pendingUiVersion: String? = null
    private var sessionCookieHeaders: List<String> = emptyList()
    private var nativeStatusView: View? = null
    private var nativeStatusText: TextView? = null
    private var webUiLoadGeneration = 0
    private var endpointCheckGeneration = 0
    private val discoveredBluetoothDevices = linkedMapOf<String, BluetoothDevice>()
    private var bluetoothDiscoveryRegistered = false
    private var bluetoothDiscoveryActive = false
    private var bluetoothDiscoveryGeneration = 0
    private var bluetoothSearchDialog: AlertDialog? = null

    private val bluetoothDiscoveryReceiver = object : BroadcastReceiver() {
        @SuppressLint("MissingPermission")
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                BluetoothDevice.ACTION_FOUND -> {
                    val device = bluetoothDeviceFrom(intent) ?: return
                    if (isClassicBluetoothDevice(device)) {
                        discoveredBluetoothDevices[device.address] = device
                    }
                }

                BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
                    if (bluetoothDiscoveryActive) finishB1PrinterDiscovery(showResults = true)
                }
            }
        }
    }

    private val scannerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) return@registerForActivityResult
        val payload = result.data?.getStringExtra(QrScannerActivity.EXTRA_PAYLOAD)
            ?: return@registerForActivityResult
        when (result.data?.getStringExtra(QrScannerActivity.EXTRA_MODE)) {
            QrScannerActivity.MODE_NETWORK -> validateAndSaveNetwork(payload)
            else -> deliverOrderQr(payload)
        }
    }

    private val storagePermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val request = pendingDownload
        val generated = pendingGeneratedSave
        pendingDownload = null
        pendingGeneratedSave = null
        if (granted && request != null) fileActions.download(request.first, request.second, request.third)
        else if (granted && generated != null) fileActions.saveGenerated(generated.first, generated.second, generated.third)
        else if (!granted) toast("未获得存储权限，无法把文件保存到系统下载目录。")
    }

    private val bluetoothPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        if (permissions.values.all { it }) startB1PrinterDiscovery()
        else toast("未获得蓝牙搜索权限，无法在 App 内查找 B1 打印机。")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        configStore = NetworkConfigStore(this)
        appUpdateInstaller = AppUpdateInstaller(this)
        loginHistoryStore = LoginHistoryStore(this)
        webUiPackageStore = WebUiPackageStore(this, webUiPackageClient)
        selectedAddressType = configStore.defaultAddressType()
        originPolicy = OriginPolicy(configStore.allowedBaseUrls())
        root = FrameLayout(this)
        setContentView(root)
        fileChooser = FileChooserCoordinator(this)
        fileActions = NativeFileActions(this, baseUrl = { endpoint?.baseUrl })
        b1Printer = B1PrinterController(application, ::deliverB1PrinterEvent)
        configureBackButton()
        showNativeLogin()
        clearLocalSession {
            sessionReady = true
            updateLoginButtonState()
            refreshEndpointStatus()
        }
    }

    override fun onResume() {
        super.onResume()
        if (!::appUpdateInstaller.isInitialized) return
        val pending = pendingUpdateApk ?: return
        if (appUpdateInstaller.canRequestPackageInstalls()) {
            pendingUpdateApk = null
            appUpdateInstaller.launchInstaller(pending)
        }
    }

    private fun showNativeLogin(statusHint: String? = null) {
        loginInFlight = false
        appUpdateDialog?.dismiss()
        appUpdateDialog = null
        requiredAppUpdate = null
        if (selectedAddressType == null || !configStore.isConfigured(selectedAddressType!!)) {
            selectedAddressType = configStore.defaultAddressType()
        }
        versionCheckReady = false
        destroyWebView()
        root.removeAllViews()
        root.background = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(0xFFF7FAFF.toInt(), 0xFFE7F0FC.toInt(), 0xFFDCE9F9.toInt())
        )

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val stage = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(32), dp(24), dp(32), dp(24))
        }

        if (resources.configuration.screenWidthDp >= 900) {
            stage.addView(buildBrandPanel(), LinearLayout.LayoutParams(dp(330), ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                marginEnd = dp(48)
            })
        }
        stage.addView(buildLoginCard(statusHint), LinearLayout.LayoutParams(dp(500), ViewGroup.LayoutParams.WRAP_CONTENT))
        scroll.addView(stage, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(scroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        updateLoginButtonState()
    }

    private fun buildBrandPanel() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setPadding(dp(20), dp(32), dp(20), dp(32))
        addView(TextView(this@MainActivity).apply {
            text = "◇"
            textSize = 72f
            gravity = Gravity.CENTER
            setTextColor(BRAND_BLUE)
            typeface = Typeface.DEFAULT_BOLD
        })
        addView(TextView(this@MainActivity).apply {
            text = "样品管理 · 高效有序"
            textSize = 23f
            gravity = Gravity.CENTER
            setTextColor(DEEP_BLUE)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, dp(14), 0, 0)
        })
        addView(TextView(this@MainActivity).apply {
            text = "规范管理  |  快速查找  |  安全可控"
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(MUTED_BLUE)
            setPadding(0, dp(12), 0, 0)
        })
    }

    private fun buildLoginCard(statusHint: String?) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(46), dp(38), dp(46), dp(36))
        background = rounded(0xFDFEFFFE.toInt(), 24f)
        elevation = dp(12).toFloat()

        addView(TextView(this@MainActivity).apply {
            text = "样品间管理系统"
            textSize = 34f
            gravity = Gravity.CENTER
            setTextColor(DEEP_BLUE)
            typeface = Typeface.DEFAULT_BOLD
        }, matchWidth())
        addView(TextView(this@MainActivity).apply {
            text = "Pad 登录"
            textSize = 19f
            gravity = Gravity.CENTER
            setTextColor(MUTED_BLUE)
            setPadding(0, dp(8), 0, dp(26))
        }, matchWidth())

        addView(fieldLabel("账号 / 手机号"), matchWidth())
        accountInput = historyLoginInput()
        addView(accountInput, matchWidth(dp(58)).apply { bottomMargin = dp(18) })

        addView(fieldLabel("密码"), matchWidth())
        passwordInput = loginInput("请输入密码", true)
        addView(passwordInput, matchWidth(dp(58)).apply { bottomMargin = dp(22) })

        loginError = TextView(this@MainActivity).apply {
            text = ""
            textSize = 14f
            setTextColor(0xFFB42318.toInt())
            visibility = View.GONE
            setPadding(0, 0, 0, dp(10))
        }
        addView(loginError, matchWidth())

        loginButton = Button(this@MainActivity).apply {
            text = "登录"
            textSize = 20f
            setTextColor(Color.WHITE)
            isAllCaps = false
            background = rounded(BRAND_BLUE, 12f)
            setOnClickListener { performLogin() }
        }
        addView(loginButton, matchWidth(dp(58)))

        loginProgress = ProgressBar(this@MainActivity).apply {
            visibility = View.GONE
        }
        addView(loginProgress, LinearLayout.LayoutParams(dp(28), dp(28)).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(10)
        })

        addView(Button(this@MainActivity).apply {
            text = "扫码配置网络"
            textSize = 18f
            setTextColor(BRAND_BLUE)
            isAllCaps = false
            background = bordered(Color.WHITE, BRAND_BLUE, 12f)
            setOnClickListener { launchScanner(QrScannerActivity.MODE_NETWORK) }
        }, matchWidth(dp(56)).apply { topMargin = dp(12) })

        addView(buildEndpointSelector(), matchWidth(dp(54)).apply { topMargin = dp(14) })

        networkStatus = TextView(this@MainActivity).apply {
            text = statusHint ?: networkStatusLabel(endpoint)
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(MUTED_BLUE)
            setPadding(0, dp(14), 0, 0)
        }
        addView(networkStatus, matchWidth())
    }

    private fun fieldLabel(label: String) = TextView(this).apply {
        text = label
        textSize = 15f
        setTextColor(DEEP_BLUE)
        typeface = Typeface.DEFAULT_BOLD
        setPadding(0, 0, 0, dp(7))
    }

    private fun loginInput(hintText: String, password: Boolean) = EditText(this).apply {
        hint = hintText
        textSize = 17f
        setTextColor(0xFF1E293B.toInt())
        setHintTextColor(0xFF94A3B8.toInt())
        setPadding(dp(18), 0, dp(18), 0)
        isSingleLine = true
        background = bordered(Color.WHITE, 0xFFC8D4E3.toInt(), 11f)
        inputType = if (password) {
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        } else {
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_NORMAL
        }
        importantForAutofill = if (password) View.IMPORTANT_FOR_AUTOFILL_YES else View.IMPORTANT_FOR_AUTOFILL_YES
    }

    private fun historyLoginInput() = AutoCompleteTextView(this).apply {
        hint = "请输入账号或手机号"
        textSize = 17f
        setTextColor(0xFF1E293B.toInt())
        setHintTextColor(0xFF94A3B8.toInt())
        setPadding(dp(18), 0, dp(18), 0)
        isSingleLine = true
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_NORMAL
        background = bordered(Color.WHITE, 0xFFC8D4E3.toInt(), 11f)
        threshold = 0
        setAdapter(historyAccountAdapter())
        setOnItemClickListener { parent, _, position, _ ->
            val selected = parent.getItemAtPosition(position)?.toString().orEmpty()
            if (selected == CLEAR_LOGIN_HISTORY_LABEL) {
                loginHistoryStore.clear()
                setText("", false)
                setAdapter(historyAccountAdapter())
                dismissDropDown()
            } else {
                setText(selected, false)
                setSelection(selected.length)
            }
        }
        setOnClickListener { if (loginHistoryStore.list().isNotEmpty()) showDropDown() }
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_YES
    }

    private fun historyAccountAdapter() = ArrayAdapter(
        this,
        android.R.layout.simple_dropdown_item_1line,
        loginHistoryStore.list().let { accounts ->
            if (accounts.isEmpty()) accounts else accounts + CLEAR_LOGIN_HISTORY_LABEL
        }
    )

    private fun buildEndpointSelector() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER
        lanLineButton = lineButton(AddressType.LAN)
        publicLineButton = lineButton(AddressType.PUBLIC)
        addView(lanLineButton, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f).apply { marginEnd = dp(6) })
        addView(publicLineButton, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f).apply { marginStart = dp(6) })
        updateLineButtons()
    }

    private fun lineButton(addressType: AddressType) = Button(this).apply {
        text = if (addressType == AddressType.LAN) "局域网 LAN" else "公网 PUBLIC"
        textSize = 15f
        isAllCaps = false
        setOnClickListener { selectAddressType(addressType) }
    }

    private fun selectAddressType(addressType: AddressType) {
        if (!configStore.isConfigured(addressType)) return
        selectedAddressType = addressType
        endpoint = null
        selectedManifest = null
        versionCheckReady = false
        updateLineButtons()
        refreshEndpointStatus()
    }

    private fun updateLineButtons() {
        if (!::lanLineButton.isInitialized || !::publicLineButton.isInitialized) return
        listOf(AddressType.LAN to lanLineButton, AddressType.PUBLIC to publicLineButton).forEach { (type, button) ->
            val selected = selectedAddressType == type
            button.isEnabled = configStore.isConfigured(type) && !loginInFlight
            button.setTextColor(if (selected) Color.WHITE else BRAND_BLUE)
            button.background = if (selected) rounded(BRAND_BLUE, 10f) else bordered(Color.WHITE, BRAND_BLUE, 10f)
        }
    }

    private fun refreshEndpointStatus() {
        if (configStore.allowedBaseUrls().isEmpty()) {
            endpoint = null
            versionCheckReady = false
            setNetworkStatus("未配置服务器")
            return
        }
        val addressType = selectedAddressType ?: configStore.defaultAddressType() ?: return
        selectedAddressType = addressType
        versionCheckReady = false
        updateLoginButtonState()
        setNetworkStatus("正在检查 ${addressType.name} 线路和工作界面…")
        val generation = ++endpointCheckGeneration
        executor.execute {
            runCatching {
                val resolution = resolveEndpoint(addressType)
                resolution.syncedConfigs.forEach(configStore::save)
                val manifest = webUiPackageClient.fetchManifest(resolution.endpoint.baseUrl)
                val releaseCheck = runCatching { appUpdateClient.latest(resolution.endpoint.baseUrl) }
                Triple(resolution, manifest, releaseCheck)
            }
                .onSuccess { (resolution, manifest, releaseCheck) -> runOnUiThread {
                    if (generation != endpointCheckGeneration || selectedAddressType != addressType) return@runOnUiThread
                    val selected = resolution.endpoint
                    endpoint = selected
                    originPolicy = OriginPolicy(configStore.allowedBaseUrls())
                    selectedManifest = manifest
                    val appRelease = releaseCheck.getOrNull()
                    val requiredRelease = appRelease?.takeIf {
                        it.versionCode > BuildConfig.VERSION_CODE.toLong()
                    }
                    if (requiredRelease != null) {
                        requiredAppUpdate = requiredRelease
                        versionCheckReady = false
                        setNetworkStatus("发现新版 V${requiredRelease.versionName}，请先更新 App")
                        updateLoginButtonState()
                        showRequiredAppUpdateDialog(requiredRelease)
                        return@runOnUiThread
                    }

                    requiredAppUpdate = null
                    appUpdateDialog?.dismiss()
                    appUpdateDialog = null
                    versionCheckReady = true
                    val updateHint = if (webUiPackageStore.activeVersion() != manifest.uiVersion) "，登录后更新界面" else ""
                    val updateCheckHint = if (releaseCheck.isFailure) "，App 更新检查暂不可用" else ""
                    val networkHint = when {
                        resolution.restoredLan -> "PUBLIC 已同步新 LAN，现已优先恢复 LAN"
                        resolution.usedPublicFallback -> "LAN 不可用，已自动切换 PUBLIC"
                        else -> "当前线路：${selected.addressType.name}"
                    }
                    setNetworkStatus("$networkHint$updateHint$updateCheckHint")
                    updateLoginButtonState()
                    if (!resolution.usedPublicFallback) {
                        syncPublishedNetworkConfigInBackground(selected.baseUrl)
                    }
                } }
                .onFailure { runOnUiThread {
                    if (generation != endpointCheckGeneration || selectedAddressType != addressType) return@runOnUiThread
                    endpoint = null
                    selectedManifest = null
                    versionCheckReady = false
                    setNetworkStatus("当前网络不可用，请重试")
                    updateLoginButtonState()
                } }
        }
    }

    private fun showRequiredAppUpdateDialog(release: AppReleaseInfo) {
        if (isFinishing || isDestroyed) return
        if (appUpdateDialog?.isShowing == true && requiredAppUpdate?.versionCode == release.versionCode) return

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(8), dp(4), dp(8), 0)
        }
        val message = TextView(this).apply {
            text = buildString {
                append("为确保 Sample Room System 正常使用，需要先更新到 V${release.versionName}。")
                release.releaseNotes?.let { append("\n\n更新说明：$it") }
            }
            textSize = 16f
            setTextColor(DEEP_BLUE)
        }
        val progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
        }
        val status = TextView(this).apply {
            textSize = 14f
            setTextColor(MUTED_BLUE)
            setPadding(0, dp(10), 0, 0)
        }
        content.addView(message, matchWidth())
        content.addView(progress, matchWidth(dp(10)).apply { topMargin = dp(16) })
        content.addView(status, matchWidth())

        val dialog = AlertDialog.Builder(this)
            .setTitle("发现新版本 V${release.versionName}")
            .setView(content)
            .setCancelable(false)
            .setPositiveButton("立即更新", null)
            .create()

        dialog.setCanceledOnTouchOutside(false)
        dialog.setOnShowListener {
            val button = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
            button.setOnClickListener {
                button.isEnabled = false
                progress.visibility = View.VISIBLE
                progress.progress = 0
                status.text = "正在下载并校验更新…"
                startRequiredAppUpdate(release, progress, status) {
                    button.isEnabled = true
                }
            }
        }
        appUpdateDialog?.dismiss()
        appUpdateDialog = dialog
        dialog.show()
    }

    private fun startRequiredAppUpdate(
        release: AppReleaseInfo,
        progress: ProgressBar,
        status: TextView,
        onRetryReady: () -> Unit
    ) {
        executor.execute {
            runCatching {
                appUpdateInstaller.downloadAndVerify(release) { value ->
                    runOnUiThread {
                        progress.progress = value
                        status.text = "正在下载并校验更新… $value%"
                    }
                }
            }.onSuccess { apk ->
                runOnUiThread {
                    progress.progress = 100
                    if (appUpdateInstaller.canRequestPackageInstalls()) {
                        status.text = "下载完成，正在打开安装程序…"
                        appUpdateInstaller.launchInstaller(apk)
                    } else {
                        pendingUpdateApk = apk
                        status.text = "请允许“安装未知应用”，返回后会自动继续安装。"
                        startActivity(appUpdateInstaller.installPermissionIntent())
                        onRetryReady()
                    }
                }
            }.onFailure { error ->
                runOnUiThread {
                    progress.visibility = View.GONE
                    status.setTextColor(0xFFB42318.toInt())
                    status.text = error.message ?: "更新失败，请重试"
                    onRetryReady()
                }
            }
        }
    }

    private fun performLogin() {
        val account = accountInput.text.toString().trim()
        val password = passwordInput.text.toString()
        if (account.isBlank() || password.isBlank()) {
            showLoginError("请输入账号或手机号和密码。")
            return
        }
        if (configStore.allowedBaseUrls().isEmpty()) {
            showLoginError("请先扫码配置服务器。")
            setNetworkStatus("未配置服务器")
            return
        }

        setLoginBusy(true)
        showLoginError(null)
        executor.execute {
            runCatching {
                val addressType = selectedAddressType ?: error("请选择 LAN 或 PUBLIC 线路。")
                val resolution = resolveEndpoint(addressType)
                resolution.syncedConfigs.forEach(configStore::save)
                val selected = resolution.endpoint
                val manifest = webUiPackageClient.fetchManifest(selected.baseUrl)
                val result = loginClient.login(selected.baseUrl, account, password)
                val route = TabletRoutePolicy.routeFor(result.user)
                if (route == null) {
                    loginClient.logoutBestEffort(selected.baseUrl, result.setCookieHeaders)
                    throw IllegalStateException("当前账号未开放 Pad 工作台")
                }
                SessionCookieHandoff.webViewCookie(result.setCookieHeaders)
                    ?: throw IllegalStateException("服务器未签发正式登录 Cookie。")
                LoginPreparation(selected, addressType, route, result.setCookieHeaders, manifest, account)
            }.onSuccess { prepared ->
                runOnUiThread { completeCookieHandoff(prepared) }
            }.onFailure { error ->
                runOnUiThread {
                    passwordInput.text.clear()
                    setLoginBusy(false)
                    showLoginError(error.message ?: "登录失败，请重试。")
                    refreshEndpointStatus()
                }
            }
        }
    }

    private fun completeCookieHandoff(prepared: LoginPreparation) {
        endpoint = prepared.endpoint
        selectedAddressType = prepared.preferredAddressType
        selectedManifest = prepared.manifest
        sessionCookieHeaders = prepared.cookieHeaders
        originPolicy = OriginPolicy(configStore.allowedBaseUrls())
        seedSessionCookies(prepared.cookieHeaders) { success ->
            runOnUiThread {
                if (!success) {
                    setLoginBusy(false)
                    showLoginError("登录成功，但 WebView 会话交接失败，请重试。")
                    return@runOnUiThread
                }
                loginHistoryStore.record(prepared.account)
                passwordInput.text.clear()
                CookieManager.getInstance().flush()
                showNativeWorkStatus("正在检查工作界面…")
                prepareAndLoadWebUi(prepared.endpoint, prepared.route, prepared.manifest)
            }
        }
    }

    private fun seedSessionCookies(cookieHeaders: List<String>, onComplete: (Boolean) -> Unit) {
        val targets = configStore.allowedBaseUrls().toList()
        if (targets.isEmpty()) {
            onComplete(false)
            return
        }
        var remaining = targets.size
        var selectedSucceeded = false
        targets.forEach { baseUrl ->
            val cookie = SessionCookieHandoff.cookieForOrigin(cookieHeaders, baseUrl)
            if (cookie == null) {
                remaining -= 1
                if (remaining == 0) onComplete(false)
                return@forEach
            }
            CookieManager.getInstance().setCookie(baseUrl, cookie) { success ->
                if (baseUrl == endpoint?.baseUrl && success) selectedSucceeded = true
                remaining -= 1
                if (remaining == 0) onComplete(selectedSucceeded)
            }
        }
    }

    private fun prepareAndLoadWebUi(selected: SelectedEndpoint, route: String, manifest: WebUiPackageManifest) {
        val needsDownload = webUiPackageStore.activeVersion() != manifest.uiVersion
        if (needsDownload) updateNativeWorkStatus("正在更新工作界面…")
        executor.execute {
            runCatching {
                webUiPackageStore.prepare(selected.baseUrl, manifest) { completed, total ->
                    runOnUiThread { updateNativeWorkStatus("正在更新工作界面… $completed/$total") }
                }
            }.onSuccess {
                runOnUiThread {
                    pendingUiVersion = manifest.uiVersion.takeIf { it != webUiPackageStore.activeVersion() }
                    buildWebUi(manifest.uiVersion)
                    updateNativeWorkStatus("正在进入工作台…")
                    webView?.loadUrl("${selected.baseUrl}$route")
                    scheduleWebUiLoadTimeout(manifest.uiVersion)
                }
            }.onFailure { error ->
                runOnUiThread {
                    webUiPackageStore.discardUnconfirmed(manifest.uiVersion)
                    returnToNativeLogin(error.message ?: "工作界面更新失败，请重试。")
                }
            }
        }
    }

    private fun setLoginBusy(busy: Boolean) {
        loginInFlight = busy
        loginProgress.visibility = if (busy) View.VISIBLE else View.GONE
        accountInput.isEnabled = !busy
        passwordInput.isEnabled = !busy
        updateLineButtons()
        updateLoginButtonState()
    }

    private fun updateLoginButtonState() {
        if (::loginButton.isInitialized) loginButton.isEnabled = sessionReady && versionCheckReady && !loginInFlight
    }

    private fun showLoginError(message: String?) {
        loginError.text = message.orEmpty()
        loginError.visibility = if (message.isNullOrBlank()) View.GONE else View.VISIBLE
    }

    private fun setNetworkStatus(message: String) {
        if (::networkStatus.isInitialized) networkStatus.text = "●  $message"
    }

    private fun showNativeWorkStatus(message: String, retry: (() -> Unit)? = null) {
        root.removeAllViews()
        root.background = rounded(0xFFF4F7FB.toInt(), 0f)
        addNativeWorkStatus(message, retry)
    }

    private fun addNativeWorkStatus(message: String, retry: (() -> Unit)? = null) {
        nativeStatusView?.let { (it.parent as? ViewGroup)?.removeView(it) }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(32), dp(32), dp(32), dp(32))
            addView(ProgressBar(this@MainActivity), LinearLayout.LayoutParams(dp(42), dp(42)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = dp(18)
            })
            nativeStatusText = TextView(this@MainActivity).apply {
                text = message
                textSize = 19f
                gravity = Gravity.CENTER
                setTextColor(DEEP_BLUE)
                typeface = Typeface.DEFAULT_BOLD
            }
            addView(nativeStatusText, matchWidth())
            if (retry != null) {
                addView(Button(this@MainActivity).apply {
                    text = "重试"
                    isAllCaps = false
                    setTextColor(Color.WHITE)
                    background = rounded(BRAND_BLUE, 10f)
                    setOnClickListener { retry() }
                }, LinearLayout.LayoutParams(dp(180), dp(52)).apply {
                    gravity = Gravity.CENTER_HORIZONTAL
                    topMargin = dp(20)
                })
            }
        }
        nativeStatusView = panel
        root.addView(panel, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    private fun updateNativeWorkStatus(message: String) {
        nativeStatusText?.text = message
    }

    private fun scheduleWebUiLoadTimeout(version: String) {
        val generation = ++webUiLoadGeneration
        mainHandler.postDelayed({
            if (generation == webUiLoadGeneration && loadedUiVersion != version) {
                webUiPackageStore.discardUnconfirmed(version)
                returnToNativeLogin("工作界面加载失败，请重试。")
            }
        }, WEB_UI_READY_TIMEOUT_MS)
    }

    private fun networkStatusLabel(selected: SelectedEndpoint?) = when (selected?.addressType) {
        AddressType.LAN -> "当前网络：LAN"
        AddressType.PUBLIC -> "当前网络：PUBLIC"
        null -> if (configStore.allowedBaseUrls().isEmpty()) "未配置服务器" else "当前服务器暂不可连接"
    }

    private fun buildWebUi(uiVersion: String) {
        root.removeAllViews()
        destroyWebView()
        webView = WebView(this).also {
            it.visibility = View.INVISIBLE
            configureWebView(it, uiVersion)
            root.addView(it, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ))
        }
        addNativeWorkStatus("正在进入工作台…")
    }

    @Suppress("SetJavaScriptEnabled")
    private fun configureWebView(target: WebView, uiVersion: String) {
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(target, false)
        }
        target.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            loadWithOverviewMode = false
            useWideViewPort = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            userAgentString = "$userAgentString SampleRoomTablet/${BuildConfig.VERSION_NAME}"
            safeBrowsingEnabled = true
        }
        target.isLongClickable = false
        target.addJavascriptInterface(TabletJavascriptBridge(this), "SampleRoomTablet")
        target.webViewClient = SecureTabletWebViewClient(
            policy = { originPolicy },
            onNativeLoginRequired = { returnToNativeLogin() },
            onBlockedNavigation = ::handleBlockedNavigation,
            onMainFrameFailure = ::recoverOrReturnToLogin,
            onPageCommitted = { sessionController.persist() },
            localAssetProvider = LocalWebUiAssetProvider(webUiPackageStore, uiVersion) { originPolicy }::response
        )
        target.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<android.net.Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean = fileChooser.show(filePathCallback, fileChooserParams)

            override fun onPermissionRequest(request: PermissionRequest) {
                request.deny()
            }
        }
        target.setDownloadListener { url, _, _, mimeType, _ ->
            val base = endpoint?.baseUrl ?: return@setDownloadListener
            if (!originPolicy.isAllowedOrigin(url)) {
                toast("下载地址不在已验证服务器范围内，已阻止。")
                return@setDownloadListener
            }
            val relative = url.removePrefix(base)
            downloadFile(relative, "样品间下载", mimeType ?: "application/octet-stream")
        }
    }

    private fun handleBlockedNavigation(url: String) {
        toast(if (originPolicy.isAllowedOrigin(url)) {
            "此页面未开放给 Pad 工作台。"
        } else {
            "已阻止打开未验证的网站或危险链接。"
        })
    }

    private fun recoverOrReturnToLogin(message: String) {
        if (!recovering.compareAndSet(false, true)) return
        pendingUiVersion?.let(webUiPackageStore::discardUnconfirmed)
        pendingUiVersion = null
        if (message.contains("HTTPS") || selectedAddressType != AddressType.LAN) {
            recovering.set(false)
            returnToNativeLogin(if (message.contains("HTTPS")) message else "当前网络不可用，请重试")
            return
        }
        if (businessWriteActive.get()) {
            recovering.set(false)
            returnToNativeLogin("网络中断时业务仍在保存，请先核对本次操作结果，系统没有自动重放写入。")
            return
        }

        val route = Uri.parse(webView?.url.orEmpty()).encodedPath
            ?.takeIf(String::isNotBlank)
            ?: "/"
        updateNativeWorkStatus("LAN 连接失败，正在通过 PUBLIC 同步并恢复线路…")
        executor.execute {
            runCatching {
                val resolution = resolveEndpoint(AddressType.LAN)
                resolution.syncedConfigs.forEach(configStore::save)
                resolution
            }.onSuccess { resolution ->
                runOnUiThread {
                    if (resolution.endpoint == endpoint) {
                        recovering.set(false)
                        returnToNativeLogin("当前线路服务异常，请重新登录后重试。")
                    } else {
                        restoreWebSessionOnEndpoint(resolution.endpoint, route)
                    }
                }
            }.onFailure {
                runOnUiThread {
                    recovering.set(false)
                    returnToNativeLogin("LAN 和 PUBLIC 当前都不可用，请检查网络后重试。")
                }
            }
        }
    }

    private fun restoreWebSessionOnEndpoint(target: SelectedEndpoint, route: String) {
        if (businessWriteActive.get()) {
            recovering.set(false)
            returnToNativeLogin("网络恢复时业务仍在保存，请先核对本次操作结果，系统没有自动重放写入。")
            return
        }
        val cookie = SessionCookieHandoff.cookieForOrigin(sessionCookieHeaders, target.baseUrl)
        if (cookie == null) {
            recovering.set(false)
            returnToNativeLogin("线路已恢复，但登录会话无法安全衔接，请重新登录。")
            return
        }
        originPolicy = OriginPolicy(configStore.allowedBaseUrls())
        CookieManager.getInstance().setCookie(target.baseUrl, cookie) { success ->
            runOnUiThread {
                if (!success) {
                    recovering.set(false)
                    returnToNativeLogin("线路已恢复，但登录会话衔接失败，请重新登录。")
                    return@runOnUiThread
                }
                CookieManager.getInstance().flush()
                endpoint = target
                recovering.set(false)
                toast(if (target.addressType == AddressType.LAN) {
                    "已同步并优先恢复 LAN。"
                } else {
                    "LAN 暂不可用，已自动切换 PUBLIC。"
                })
                webView?.loadUrl("${target.baseUrl}$route")
            }
        }
    }

    private fun validateAndSaveNetwork(payload: String) {
        setNetworkStatus("正在验证服务器身份和 API 版本…")
        executor.execute {
            runCatching {
                val config = NetworkConfigParser.parse(payload)
                when (val result = healthProbe.probe(config.baseUrl)) {
                    HealthProbeResult.Success -> Unit
                    is HealthProbeResult.Failure -> error("${result.userMessage()}，配置未保存。")
                }
                configStore.save(config)
                config
            }.onSuccess { config ->
                runOnUiThread {
                    syncPublishedNetworkConfigInBackground(config.baseUrl)
                    endpoint = null
                    if (selectedAddressType == null || !configStore.isConfigured(selectedAddressType!!)) {
                        selectedAddressType = config.addressType
                    }
                    sessionReady = false
                    showNativeLogin("正在清理旧服务器登录状态…")
                    clearLocalSession {
                        sessionReady = true
                        updateLoginButtonState()
                        toast("${config.addressType.name} 地址验证通过并已保存。")
                        refreshEndpointStatus()
                    }
                }
            }.onFailure { error ->
                runOnUiThread {
                    showLoginError(error.message ?: "网络配置无效")
                    refreshEndpointStatus()
                }
            }
        }
    }

    private fun deliverOrderQr(payload: String) {
        val target = webView ?: return
        val quoted = JSONObject.quote(payload)
        target.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('sample-room-tablet-order-qr',{detail:{payload:$quoted}}));",
            null
        )
    }

    private fun launchScanner(mode: String) {
        scannerLauncher.launch(
            Intent(this, QrScannerActivity::class.java)
                .putExtra(QrScannerActivity.EXTRA_MODE, mode)
        )
    }

    override fun scanOrderQr() = runOnUiThread { launchScanner(QrScannerActivity.MODE_ORDER) }

    override fun clearWebSession() = returnToNativeLogin()

    override fun returnToNativeLogin() = returnToNativeLogin(null)

    override fun printCurrentPage() = runOnUiThread {
        val target = webView ?: return@runOnUiThread
        val printManager = getSystemService(PRINT_SERVICE) as PrintManager
        val adapter = target.createPrintDocumentAdapter("样品间 Pad")
        printManager.print(
            "样品间 Pad",
            adapter,
            PrintAttributes.Builder().build()
        )
    }

    override fun printerState(): String = b1Printer.stateJson()

    override fun connectB1Printer() = runOnUiThread {
        val permissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT
            )
        } else {
            arrayOf(
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.ACCESS_FINE_LOCATION
            )
        }
        if (permissions.any { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }) {
            bluetoothPermissionLauncher.launch(permissions)
            return@runOnUiThread
        }
        startB1PrinterDiscovery()
    }

    override fun printB1Labels(jobJson: String): String = b1Printer.startPrint(jobJson).toString()

    private fun deliverB1PrinterEvent(state: String, message: String?) {
        val detail = JSONObject().apply {
            put("state", state)
            if (!message.isNullOrBlank()) put("message", message)
        }
        webView?.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('sample-room-tablet-b1-printer',{detail:${detail}}));",
            null
        )
        if (state == B1PrinterController.STATUS_ERROR && !message.isNullOrBlank()) toast(message)
    }

    @SuppressLint("MissingPermission")
    private fun startB1PrinterDiscovery() {
        val adapter = bluetoothAdapter()
        if (adapter == null) {
            toast("这台 Pad 不支持蓝牙，无法连接 B1。")
            return
        }
        if (!adapter.isEnabled) {
            toast("请先开启蓝牙；开启后回到 App 重新搜索 B1。")
            startActivity(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
            return
        }
        if (Build.VERSION.SDK_INT in Build.VERSION_CODES.Q..Build.VERSION_CODES.R && !isLocationEnabled()) {
            toast("Android 10/11 搜索蓝牙设备需要开启定位服务；开启后回到 App 重试。")
            startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            return
        }

        ensureBluetoothDiscoveryReceiver()
        bluetoothDiscoveryGeneration += 1
        val generation = bluetoothDiscoveryGeneration
        bluetoothDiscoveryActive = false
        discoveredBluetoothDevices.clear()
        adapter.bondedDevices
            .filter(::isClassicBluetoothDevice)
            .forEach { discoveredBluetoothDevices[it.address] = it }
        if (adapter.isDiscovering) adapter.cancelDiscovery()

        bluetoothSearchDialog?.dismiss()
        bluetoothSearchDialog = AlertDialog.Builder(this)
            .setTitle("搜索精臣 B1 打印机")
            .setMessage("请打开 B1 并靠近 Pad。无需在系统蓝牙设置中配对。")
            .setNegativeButton("取消") { _, _ -> finishB1PrinterDiscovery(showResults = false) }
            .setCancelable(false)
            .create()
            .also { it.show() }

        mainHandler.postDelayed({
            if (generation != bluetoothDiscoveryGeneration) return@postDelayed
            bluetoothDiscoveryActive = true
            if (!adapter.startDiscovery()) {
                finishB1PrinterDiscovery(showResults = false)
                toast("蓝牙搜索启动失败，请确认蓝牙已开启后重试。")
                return@postDelayed
            }
            mainHandler.postDelayed({
                if (generation == bluetoothDiscoveryGeneration && bluetoothDiscoveryActive) {
                    finishB1PrinterDiscovery(showResults = true)
                }
            }, B1_DISCOVERY_TIMEOUT_MS)
        }, B1_DISCOVERY_RESTART_DELAY_MS)
    }

    @SuppressLint("MissingPermission")
    private fun finishB1PrinterDiscovery(showResults: Boolean) {
        if (!bluetoothDiscoveryActive && !showResults) {
            bluetoothDiscoveryGeneration += 1
        }
        bluetoothDiscoveryActive = false
        bluetoothAdapter()?.let { adapter ->
            if (adapter.isDiscovering) adapter.cancelDiscovery()
        }
        bluetoothSearchDialog?.dismiss()
        bluetoothSearchDialog = null
        if (!showResults) return

        val savedAddress = b1Printer.savedAddress()
        val devices = discoveredBluetoothDevices.values.sortedWith(
            compareByDescending<BluetoothDevice> { it.address.equals(savedAddress, ignoreCase = true) }
                .thenByDescending { isLikelyB1Name(bluetoothDeviceName(it)) }
                .thenBy { bluetoothDeviceName(it) }
        )
        if (devices.isEmpty()) {
            toast("未搜索到可连接的经典蓝牙设备。请打开 B1、退出精臣官方 App 后重试。")
            return
        }
        val labels = devices.map { "${bluetoothDeviceName(it)}  ${it.address}" }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("选择精臣 B1 打印机")
            .setItems(labels) { _, index ->
                val device = devices[index]
                bluetoothAdapter()?.cancelDiscovery()
                b1Printer.connect(bluetoothDeviceName(device), device.address)
            }
            .setNegativeButton("取消", null)
            .show()
    }

    @SuppressLint("MissingPermission")
    private fun isClassicBluetoothDevice(device: BluetoothDevice): Boolean =
        device.type == BluetoothDevice.DEVICE_TYPE_CLASSIC || device.type == BluetoothDevice.DEVICE_TYPE_DUAL

    @SuppressLint("MissingPermission")
    private fun bluetoothDeviceName(device: BluetoothDevice): String =
        device.name?.trim().takeUnless { it.isNullOrBlank() } ?: "未命名设备"

    private fun isLikelyB1Name(name: String): Boolean =
        name.contains("B1", ignoreCase = true) || name.startsWith("I2", ignoreCase = true)

    private fun bluetoothDeviceFrom(intent: Intent): BluetoothDevice? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
        }

    private fun isLocationEnabled(): Boolean {
        val manager = getSystemService(LOCATION_SERVICE) as LocationManager
        return manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
            manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }

    private fun bluetoothAdapter(): BluetoothAdapter? =
        getSystemService(BluetoothManager::class.java)?.adapter

    private fun ensureBluetoothDiscoveryReceiver() {
        if (bluetoothDiscoveryRegistered) return
        ContextCompat.registerReceiver(
            this,
            bluetoothDiscoveryReceiver,
            IntentFilter().apply {
                addAction(BluetoothDevice.ACTION_FOUND)
                addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
            },
            ContextCompat.RECEIVER_EXPORTED
        )
        bluetoothDiscoveryRegistered = true
    }

    override fun setNextUploadSource(source: String) = fileChooser.setNextUploadSource(source)

    private fun returnToNativeLogin(statusHint: String?) = runOnUiThread {
        if (!returningToLogin.compareAndSet(false, true)) return@runOnUiThread
        destroyWebView()
        webUiLoadGeneration += 1
        businessWriteActive.set(false)
        networkSwitchInFlight.set(false)
        loadedUiVersion = null
        pendingUiVersion = null
        selectedManifest = null
        sessionCookieHeaders = emptyList()
        versionCheckReady = false
        sessionReady = false
        showNativeLogin(statusHint ?: networkStatusLabel(endpoint))
        if (!statusHint.isNullOrBlank()) showLoginError(statusHint)
        clearLocalSession {
            returningToLogin.set(false)
            sessionReady = true
            updateLoginButtonState()
            refreshEndpointStatus()
        }
    }

    private fun clearLocalSession(onComplete: () -> Unit) {
        sessionController.clear {
            WebStorage.getInstance().deleteAllData()
            runOnUiThread(onComplete)
        }
    }

    override fun downloadFile(relativePath: String, displayName: String, mimeType: String) {
        runOnUiThread {
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
            ) {
                pendingDownload = Triple(relativePath, displayName, mimeType)
                storagePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            } else {
                fileActions.download(relativePath, displayName, mimeType)
            }
        }
    }

    override fun shareFile(relativePath: String, displayName: String, mimeType: String) {
        fileActions.share(relativePath, displayName, mimeType)
    }

    override fun saveGeneratedFile(base64: String, displayName: String, mimeType: String) {
        runOnUiThread {
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
            ) {
                pendingGeneratedSave = Triple(base64, displayName, mimeType)
                storagePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            } else {
                fileActions.saveGenerated(base64, displayName, mimeType)
            }
        }
    }

    private fun syncPublishedNetworkConfigInBackground(baseUrl: String) {
        executor.execute {
            val changed = runCatching {
                var saved = false
                publishedNetworkConfigClient.fetch(baseUrl).forEach { config ->
                    if (healthProbe.probe(config.baseUrl) == HealthProbeResult.Success) {
                        configStore.save(config)
                        saved = true
                    }
                }
                saved
            }.getOrDefault(false)
            if (changed) runOnUiThread {
                originPolicy = OriginPolicy(configStore.allowedBaseUrls())
                updateLineButtons()
            }
        }
    }

    private fun resolveEndpoint(addressType: AddressType): EndpointResolution =
        if (addressType == AddressType.LAN) {
            lanPreferredEndpointResolver.resolve(configStore.lanBaseUrl(), configStore.publicBaseUrl())
        } else {
            EndpointResolution(
                endpointSelector.select(addressType, configStore.lanBaseUrl(), configStore.publicBaseUrl())
            )
        }

    override fun webUiReady() = runOnUiThread {
        val version = selectedManifest?.uiVersion ?: return@runOnUiThread
        pendingUiVersion?.let(webUiPackageStore::confirm)
        pendingUiVersion = null
        loadedUiVersion = version
        webUiLoadGeneration += 1
        revealWebUi()
    }

    override fun networkState(): String = JSONObject().apply {
        put("current", endpoint?.addressType?.name ?: selectedAddressType?.name ?: JSONObject.NULL)
        put("lanConfigured", configStore.isConfigured(AddressType.LAN))
        put("publicConfigured", configStore.isConfigured(AddressType.PUBLIC))
        put("uiVersion", loadedUiVersion ?: selectedManifest?.uiVersion ?: webUiPackageStore.activeVersion() ?: "")
        put("writeInProgress", businessWriteActive.get())
    }.toString()

    override fun setBusinessWriteActive(active: Boolean) {
        businessWriteActive.set(active)
    }

    override fun switchNetwork(addressType: String) = runOnUiThread {
        val targetType = runCatching { AddressType.valueOf(addressType) }.getOrNull() ?: return@runOnUiThread
        val current = endpoint ?: return@runOnUiThread
        if (targetType == current.addressType || !configStore.isConfigured(targetType)) return@runOnUiThread
        if (businessWriteActive.get()) {
            toast("业务正在保存或上传，请完成后再切换线路。")
            return@runOnUiThread
        }
        val route = Uri.parse(webView?.url ?: return@runOnUiThread).encodedPath
            ?.takeIf(String::isNotBlank) ?: return@runOnUiThread
        if (!networkSwitchInFlight.compareAndSet(false, true)) return@runOnUiThread
        toast("正在验证 ${targetType.name} 线路…")
        executor.execute {
            runCatching {
                endpointSelector.select(targetType, configStore.lanBaseUrl(), configStore.publicBaseUrl())
            }.onSuccess { target ->
                runOnUiThread {
                    if (businessWriteActive.get()) {
                        networkSwitchInFlight.set(false)
                        toast("业务正在保存或上传，本次线路切换已取消。")
                        return@runOnUiThread
                    }
                    val cookie = SessionCookieHandoff.cookieForOrigin(sessionCookieHeaders, target.baseUrl)
                    if (cookie == null) {
                        networkSwitchInFlight.set(false)
                        toast("当前登录会话无法切换线路，请重新登录。")
                        return@runOnUiThread
                    }
                    CookieManager.getInstance().setCookie(target.baseUrl, cookie) { success ->
                        runOnUiThread {
                            if (!success) {
                                networkSwitchInFlight.set(false)
                                toast("线路会话衔接失败，已保持当前线路。")
                                return@runOnUiThread
                            }
                            if (businessWriteActive.get()) {
                                networkSwitchInFlight.set(false)
                                toast("业务正在保存或上传，本次线路切换已取消。")
                                return@runOnUiThread
                            }
                            CookieManager.getInstance().flush()
                            endpoint = target
                            selectedAddressType = targetType
                            networkSwitchInFlight.set(false)
                            webView?.loadUrl("${target.baseUrl}$route")
                        }
                    }
                }
            }.onFailure {
                runOnUiThread {
                    networkSwitchInFlight.set(false)
                    toast("${targetType.name} 线路当前无法连接，已保持原线路。")
                }
            }
        }
    }

    private fun revealWebUi() {
        nativeStatusView?.let { (it.parent as? ViewGroup)?.removeView(it) }
        nativeStatusView = null
        nativeStatusText = null
        webView?.visibility = View.VISIBLE
    }

    private fun configureBackButton() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val target = webView
                when {
                    target == null -> finish()
                    target.canGoBack() -> target.goBack()
                    else -> returnToNativeLogin()
                }
            }
        })
    }

    private fun destroyWebView() {
        webView?.let {
            it.stopLoading()
            it.removeJavascriptInterface("SampleRoomTablet")
            (it.parent as? ViewGroup)?.removeView(it)
            it.destroy()
        }
        webView = null
    }

    private fun matchWidth(height: Int = ViewGroup.LayoutParams.WRAP_CONTENT) =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height)

    private fun rounded(color: Int, radiusDp: Float) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radiusDp.toInt()).toFloat()
    }

    private fun bordered(fill: Int, stroke: Int, radiusDp: Float) = rounded(fill, radiusDp).apply {
        setStroke(dp(1), stroke)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    override fun onPause() {
        sessionController.persist()
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            WindowInsetsControllerCompat(window, window.decorView).apply {
                systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                hide(WindowInsetsCompat.Type.systemBars())
            }
        }
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        finishB1PrinterDiscovery(showResults = false)
        if (bluetoothDiscoveryRegistered) {
            unregisterReceiver(bluetoothDiscoveryReceiver)
            bluetoothDiscoveryRegistered = false
        }
        fileChooser.cancel()
        destroyWebView()
        fileActions.close()
        b1Printer.close()
        executor.shutdown()
        super.onDestroy()
    }

    companion object {
        private const val WEB_UI_READY_TIMEOUT_MS = 20_000L
        private const val B1_DISCOVERY_RESTART_DELAY_MS = 600L
        private const val B1_DISCOVERY_TIMEOUT_MS = 12_000L
        private const val CLEAR_LOGIN_HISTORY_LABEL = "清除历史账号"
        private const val BRAND_BLUE = 0xFF2468D8.toInt()
        private const val DEEP_BLUE = 0xFF123B6D.toInt()
        private const val MUTED_BLUE = 0xFF6B7F99.toInt()
    }
}
