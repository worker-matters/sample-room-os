package com.sampleroom.mobile

import android.content.Context
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import com.sampleroom.mobile.data.BiometricSessionBridge
import com.sampleroom.mobile.data.BiometricSessionClient
import com.sampleroom.mobile.data.BiometricSessionRejectedException
import com.sampleroom.mobile.data.EndpointSelector
import com.sampleroom.mobile.data.OkHttpHealthProbe
import com.sampleroom.mobile.data.Session
import com.sampleroom.mobile.data.SessionStore
import com.sampleroom.mobile.ui.BiometricQuickLoginPage
import com.sampleroom.mobile.ui.SampleRoomApp
import com.sampleroom.mobile.ui.SampleRoomTheme
import com.sampleroom.mobile.update.AppReleaseInfo
import com.sampleroom.mobile.update.AppUpdateInstaller
import kotlinx.coroutines.launch
import java.io.File
import javax.crypto.Cipher

/**
 * Single phone UI host for password login, biometric quick login, update gating, and the
 * existing Compose application. BiometricPrompt never launches another app Activity.
 */
class PhoneMainActivity : FragmentActivity() {
    private lateinit var store: SessionStore
    private lateinit var viewModel: AppViewModel
    private lateinit var hostState: PhoneHostStateViewModel
    private lateinit var updateInstaller: AppUpdateInstaller
    private val biometricSessionClient = BiometricSessionClient()
    private val phoneShellPreferences by lazy {
        getSharedPreferences(PHONE_SHELL_PREFERENCES, Context.MODE_PRIVATE)
    }
    private var pendingUpdateApk: File? = null
    private var appInitialized = false
    private var biometricPromptActive = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SessionStore(this)
        updateInstaller = AppUpdateInstaller(this)
        hostState = ViewModelProvider(this)[PhoneHostStateViewModel::class.java]

        when (
            phoneStartupDestination(
                appWasInitialized = hostState.appWasInitialized,
                biometricQuickLoginEnabled = store.biometricQuickLoginEnabled()
            )
        ) {
            PhoneStartupDestination.RESTORE_OPEN_APP -> initializeApp()
            PhoneStartupDestination.PASSWORD_ENTRY -> {
                // A persisted password session must not silently reopen a cold app. Without an
                // enrolled biometric credential, a new process starts from explicit password login.
                store.clear()
                hostState.explicitPasswordFlow = true
                initializeApp()
            }
            PhoneStartupDestination.BIOMETRIC_ENTRY -> showBiometricEntryView()
        }
    }

    override fun onResume() {
        super.onResume()
        if (!appInitialized || !::viewModel.isInitialized) return
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

    private fun initializeApp() {
        if (appInitialized) return
        appInitialized = true
        hostState.appWasInitialized = true
        val factory = AppViewModel.Factory(store)
        viewModel = ViewModelProvider(this, factory)[AppViewModel::class.java]

        // Register before composing SampleRoomApp so explicit password flows can collapse the
        // transient Boot state back to Login before the loading page is ever drawn.
        lifecycleScope.launch {
            viewModel.state.collect { state ->
                if (
                    hostState.explicitPasswordFlow &&
                    state.screen == AppScreen.Boot &&
                    state.session == null
                ) {
                    // Only collapse the pre-authentication Boot state. A successful password login
                    // briefly emits Boot with a real session before routing to the role home screen;
                    // treating that state as pre-auth would revoke the newly created session.
                    viewModel.logout()
                    return@collect
                }

                if (state.screen == AppScreen.Login && state.session == null) {
                    hostState.explicitPasswordFlow = true
                }

                val session = state.session
                if (session != null) {
                    hostState.explicitPasswordFlow = false
                    if (store.biometricQuickLoginEnabled()) {
                        rememberBiometricAccountLabel(session)
                    }
                }

                session ?: return@collect
                if (!shouldOfferBiometricEnrollment(session)) return@collect
                if (biometricPromptActive) return@collect
                val enrollmentRequested =
                    store.consumeBiometricEnrollmentRequest() ||
                        hostState.reofferBiometricAfterPasswordLogin
                if (!enrollmentRequested) return@collect
                hostState.reofferBiometricAfterPasswordLogin = false
                offerBiometricEnrollment(session)
            }
        }

        if (hostState.explicitPasswordFlow) {
            viewModel.logout()
        }

        setContent {
            SampleRoomTheme {
                SampleRoomApp(viewModel, ::installRequiredUpdate)
            }
        }
    }

    private fun showBiometricEntryView(
        busy: Boolean = false,
        message: String? = null
    ) {
        if (appInitialized) return
        hostState.appWasInitialized = false
        setContent {
            SampleRoomTheme {
                BiometricQuickLoginPage(
                    accountLabel = savedBiometricAccountLabel(),
                    busy = busy,
                    message = message,
                    onBiometricLogin = ::beginStartupBiometricUnlock,
                    onPasswordLogin = ::openPasswordLogin
                )
            }
        }
    }

    private fun openPasswordLogin() {
        enterPasswordLogin(reofferBiometricAfterLogin = true)
    }

    private fun enterPasswordLogin(reofferBiometricAfterLogin: Boolean) {
        // Keep the biometric credential until a successful password login replaces it. While the
        // user is explicitly in password-login/network-settings flow, Boot must never be rendered.
        hostState.reofferBiometricAfterPasswordLogin = reofferBiometricAfterLogin
        hostState.explicitPasswordFlow = true
        initializeApp()
    }

    private fun beginStartupBiometricUnlock() {
        when (strongBiometricStatus()) {
            BiometricManager.BIOMETRIC_SUCCESS -> promptBiometricUnlock()
            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE,
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> {
                store.clearBiometricQuickLogin()
                clearBiometricAccountLabel()
                toast("当前手机没有可用的指纹或安全面容，请使用密码登录")
                enterPasswordLogin(reofferBiometricAfterLogin = false)
            }
            else -> {
                showBiometricEntryView(
                    message = "生物识别暂不可用，可稍后重试或通过更多选项使用密码登录"
                )
            }
        }
    }

    private fun promptBiometricUnlock() {
        val cipher = runCatching { store.prepareBiometricDecryptionCipher() }.getOrElse {
            store.clearBiometricQuickLogin()
            clearBiometricAccountLabel()
            toast("手机的指纹或面容设置已变化，请使用密码重新登录")
            enterPasswordLogin(reofferBiometricAfterLogin = false)
            return
        }

        authenticate(
            cipher = cipher,
            title = "指纹 / 面容登录",
            subtitle = "验证身份后进入样品间管理系统",
            negativeButtonText = "取消",
            onSuccess = { authenticatedCipher ->
                val token = runCatching { store.decryptBiometricToken(authenticatedCipher) }.getOrElse {
                    store.clearBiometricQuickLogin()
                    clearBiometricAccountLabel()
                    toast("快捷登录凭证已失效，请使用密码登录")
                    enterPasswordLogin(reofferBiometricAfterLogin = false)
                    return@authenticate
                }
                showBiometricEntryView(busy = true)
                refreshBiometricSessionAndOpen(token)
            },
            onCancel = { Unit }
        )
    }

    private fun refreshBiometricSessionAndOpen(token: String) {
        lifecycleScope.launch {
            runCatching {
                val endpoint = EndpointSelector(
                    store.lanBaseUrl(),
                    store.publicBaseUrl(),
                    OkHttpHealthProbe()
                ).select()
                val refresh = biometricSessionClient.refresh(endpoint, token)
                store.updateBiometricSessionMetadata(endpoint, refresh.expiresAt)
                BiometricSessionBridge.provide(refresh.token)
            }.onSuccess {
                initializeApp()
            }.onFailure { error ->
                if (error is BiometricSessionRejectedException) {
                    store.clearBiometricQuickLogin()
                    clearBiometricAccountLabel()
                    toast("快捷登录已失效，请使用密码重新登录")
                    enterPasswordLogin(reofferBiometricAfterLogin = false)
                } else {
                    showBiometricEntryView(
                        message = "暂时无法连接服务器，可重试生物识别或通过更多选项使用密码登录"
                    )
                }
            }
        }
    }

    private fun offerBiometricEnrollment(session: Session) {
        if (strongBiometricStatus() != BiometricManager.BIOMETRIC_SUCCESS) return
        val cipher = runCatching { store.prepareBiometricEncryptionCipher() }.getOrElse { return }

        authenticate(
            cipher = cipher,
            title = "开启指纹 / 面容登录",
            subtitle = "以后打开手机端，可验证本机指纹或安全面容快速进入",
            negativeButtonText = "暂不开启",
            onSuccess = { authenticatedCipher ->
                runCatching { store.stageBiometricCredential(session.token, authenticatedCipher) }
                    .onFailure {
                        store.discardStagedBiometricCredential()
                        toast("生物识别设置失败，可继续使用当前登录")
                    }
                    .onSuccess {
                        lifecycleScope.launch {
                            runCatching {
                                val refresh = biometricSessionClient.refresh(session.endpoint, session.token)
                                store.finalizeBiometricQuickLogin(session.endpoint, refresh.expiresAt)
                            }.onSuccess {
                                rememberBiometricAccountLabel(session)
                                toast("已开启指纹 / 面容快捷登录")
                            }.onFailure {
                                store.discardStagedBiometricCredential()
                                toast("生物识别快捷登录暂未开启，可继续使用当前登录")
                            }
                        }
                    }
            },
            onCancel = { Unit }
        )
    }

    private fun rememberBiometricAccountLabel(session: Session) {
        val label = phoneBiometricAccountLabel(session)
        if (label.isBlank()) return
        phoneShellPreferences.edit()
            .putString(BIOMETRIC_ACCOUNT_LABEL_KEY, label)
            .apply()
    }

    private fun savedBiometricAccountLabel(): String? =
        phoneShellPreferences.getString(BIOMETRIC_ACCOUNT_LABEL_KEY, null)
            ?.trim()
            ?.takeIf(String::isNotBlank)

    private fun clearBiometricAccountLabel() {
        phoneShellPreferences.edit().remove(BIOMETRIC_ACCOUNT_LABEL_KEY).apply()
    }

    private fun authenticate(
        cipher: Cipher,
        title: String,
        subtitle: String,
        negativeButtonText: String,
        onSuccess: (Cipher) -> Unit,
        onCancel: () -> Unit
    ) {
        if (biometricPromptActive) return
        biometricPromptActive = true
        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    biometricPromptActive = false
                    val authenticatedCipher = result.cryptoObject?.cipher
                    if (authenticatedCipher == null) {
                        toast("生物识别验证失败")
                        onCancel()
                        return
                    }
                    onSuccess(authenticatedCipher)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    biometricPromptActive = false
                    when (errorCode) {
                        BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                        BiometricPrompt.ERROR_USER_CANCELED,
                        BiometricPrompt.ERROR_CANCELED -> Unit
                        else -> toast(errString.toString().ifBlank { "生物识别暂不可用" })
                    }
                    onCancel()
                }
            }
        )
        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText(negativeButtonText)
            .build()
        prompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(cipher))
    }

    private fun strongBiometricStatus(): Int =
        BiometricManager.from(this)
            .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)

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

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private companion object {
        const val PHONE_SHELL_PREFERENCES = "sample-room-phone-shell"
        const val BIOMETRIC_ACCOUNT_LABEL_KEY = "biometricAccountLabel"
    }
}

internal class PhoneHostStateViewModel : ViewModel() {
    var appWasInitialized: Boolean = false
    var reofferBiometricAfterPasswordLogin: Boolean = false
    var explicitPasswordFlow: Boolean = false
}

internal enum class PhoneStartupDestination {
    RESTORE_OPEN_APP,
    PASSWORD_ENTRY,
    BIOMETRIC_ENTRY
}

internal fun phoneStartupDestination(
    appWasInitialized: Boolean,
    biometricQuickLoginEnabled: Boolean
): PhoneStartupDestination = when {
    appWasInitialized -> PhoneStartupDestination.RESTORE_OPEN_APP
    biometricQuickLoginEnabled -> PhoneStartupDestination.BIOMETRIC_ENTRY
    else -> PhoneStartupDestination.PASSWORD_ENTRY
}

internal fun shouldOfferBiometricEnrollment(session: Session): Boolean =
    !session.identity.mustChangePassword

internal fun phoneBiometricAccountLabel(session: Session): String {
    val identity = session.identity
    val roleLabel = when (identity.role) {
        "planner" -> "计划员"
        "receiver" -> "接单员"
        "boss" -> "老板"
        "system_owner" -> "系统管理员"
        "pattern_maker" -> "版师"
        "worker" -> when (identity.activeWorkerType) {
            "cutting" -> "裁剪"
            "sewing" -> "缝制"
            "qc_delivery" -> "组检"
            else -> "工序"
        }
        else -> "用户"
    }
    val displayName = identity.displayName.trim()
    return if (displayName.isBlank()) roleLabel else "$roleLabel $displayName"
}
