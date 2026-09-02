package com.sampleroom.mobile.data

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.sampleroom.mobile.BuildConfig
import org.json.JSONArray
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SessionStore(context: Context) {
    private val preferences = context.getSharedPreferences("sample-room-session", Context.MODE_PRIVATE)
    private val tokenVault = TokenVault(
        SharedPreferencesTokenStorage(preferences),
        AndroidKeystoreTokenCipher()
    )
    private val lanKey = "networkLanBaseUrl"
    private val publicKey = "networkPublicBaseUrl"
    private val loginHistoryKey = "successfulLoginIdentifiers"
    private var persistedTokenReadSinceLastSave = false

    fun save(session: Session) {
        if (biometricQuickLoginEnabled() && BiometricSessionBridge.matches(session.token)) {
            BiometricSessionBridge.clear()
            saveSessionMetadata(session.endpoint, session.expiresAt)
            return
        }

        val hadBiometricQuickLogin = biometricQuickLoginEnabled()
        if (hadBiometricQuickLogin) {
            clearBiometricQuickLogin()
        }
        tokenVault.save(session.token)
        saveSessionMetadata(session.endpoint, session.expiresAt)

        val freshPasswordLogin = !hadBiometricQuickLogin && !persistedTokenReadSinceLastSave
        persistedTokenReadSinceLastSave = false
        if (freshPasswordLogin) {
            preferences.edit().putBoolean(BIOMETRIC_ENROLLMENT_PENDING_KEY, true).apply()
        }
    }

    fun token(): String? {
        if (biometricQuickLoginEnabled()) {
            return BiometricSessionBridge.token()
        }
        return tokenVault.token().also { token ->
            if (!token.isNullOrBlank()) {
                persistedTokenReadSinceLastSave = true
            }
        }
    }

    fun endpoint(): SelectedEndpoint? {
        val baseUrl = preferences.getString("baseUrl", null) ?: return null
        val mode = runCatching { ApiMode.valueOf(preferences.getString("apiMode", "")!!) }.getOrNull()
            ?: return null
        return SelectedEndpoint(baseUrl, mode)
    }

    fun lanBaseUrl(): String {
        val configured = preferences.getString(lanKey, "").orEmpty()
        if (configured.isNotBlank()) return configured
        return legacyEndpoint(ApiMode.LAN)
    }

    fun publicBaseUrl(): String {
        val configured = preferences.getString(publicKey, "").orEmpty()
        if (configured.isNotBlank()) return configured
        val legacy = legacyEndpoint(ApiMode.PUBLIC)
        if (legacy.isNotBlank()) return legacy
        return BuildConfig.DEFAULT_REMOTE_ENDPOINT.trim()
    }

    private fun legacyEndpoint(mode: ApiMode): String {
        val endpoint = endpoint() ?: return ""
        if (endpoint.mode != mode) return ""
        saveNetworkConfig(NetworkConfig(mode, endpoint.baseUrl, null, "v1"))
        return endpoint.baseUrl
    }

    fun saveNetworkConfig(config: NetworkConfig) {
        val key = when (config.addressType) {
            ApiMode.LAN -> lanKey
            ApiMode.PUBLIC -> publicKey
            else -> error("Only LAN or PUBLIC network configuration can be saved.")
        }
        preferences.edit().putString(key, config.baseUrl).apply()
    }

    fun clearNetworkConfig(mode: ApiMode) {
        val key = when (mode) {
            ApiMode.LAN -> lanKey
            ApiMode.PUBLIC -> publicKey
            else -> return
        }
        preferences.edit().remove(key).apply()
    }

    fun loginHistory(): List<String> = runCatching {
        val values = JSONArray(preferences.getString(loginHistoryKey, "[]"))
        buildList {
            repeat(values.length()) { index ->
                values.optString(index).trim().takeIf(String::isNotBlank)?.let(::add)
            }
        }.distinct().take(MAX_LOGIN_HISTORY)
    }.getOrDefault(emptyList())

    fun recordSuccessfulLogin(loginId: String) {
        val updated = updatedLoginHistory(loginId, loginHistory())
        preferences.edit().putString(loginHistoryKey, JSONArray(updated).toString()).apply()
    }

    fun clearLoginHistory() {
        preferences.edit().remove(loginHistoryKey).apply()
    }

    fun biometricQuickLoginEnabled(): Boolean =
        preferences.getBoolean(BIOMETRIC_ENABLED_KEY, false) &&
            !preferences.getString(BIOMETRIC_TOKEN_KEY, null).isNullOrBlank() &&
            !preferences.getString(BIOMETRIC_IV_KEY, null).isNullOrBlank()

    fun consumeBiometricEnrollmentRequest(): Boolean {
        val pending = preferences.getBoolean(BIOMETRIC_ENROLLMENT_PENDING_KEY, false)
        if (pending) {
            preferences.edit().remove(BIOMETRIC_ENROLLMENT_PENDING_KEY).apply()
        }
        return pending
    }

    fun prepareBiometricEncryptionCipher(): Cipher {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, biometricSecretKey())
        return cipher
    }

    fun stageBiometricCredential(token: String, authenticatedCipher: Cipher) {
        val encrypted = Base64.encodeToString(
            authenticatedCipher.doFinal(token.toByteArray(Charsets.UTF_8)),
            Base64.NO_WRAP
        )
        val iv = Base64.encodeToString(authenticatedCipher.iv, Base64.NO_WRAP)
        check(
            preferences.edit()
                .putString(PENDING_BIOMETRIC_TOKEN_KEY, encrypted)
                .putString(PENDING_BIOMETRIC_IV_KEY, iv)
                .commit()
        ) { "Unable to stage biometric quick-login credential." }
    }

    fun finalizeBiometricQuickLogin(endpoint: SelectedEndpoint, expiresAt: String) {
        val encrypted = preferences.getString(PENDING_BIOMETRIC_TOKEN_KEY, null)
            ?.takeIf { it.isNotBlank() }
            ?: error("Missing staged biometric credential.")
        val iv = preferences.getString(PENDING_BIOMETRIC_IV_KEY, null)
            ?.takeIf { it.isNotBlank() }
            ?: error("Missing staged biometric initialization vector.")
        check(
            preferences.edit()
                .putBoolean(BIOMETRIC_ENABLED_KEY, true)
                .putString(BIOMETRIC_TOKEN_KEY, encrypted)
                .putString(BIOMETRIC_IV_KEY, iv)
                .remove(PENDING_BIOMETRIC_TOKEN_KEY)
                .remove(PENDING_BIOMETRIC_IV_KEY)
                .remove(BIOMETRIC_ENROLLMENT_PENDING_KEY)
                .commit()
        ) { "Unable to enable biometric quick login." }
        tokenVault.clear()
        saveSessionMetadata(endpoint, expiresAt)
    }

    fun prepareBiometricDecryptionCipher(): Cipher {
        val iv = preferences.getString(BIOMETRIC_IV_KEY, null)
            ?.takeIf { it.isNotBlank() }
            ?: error("Biometric quick-login credential is missing.")
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            biometricSecretKey(),
            GCMParameterSpec(GCM_TAG_LENGTH_BITS, Base64.decode(iv, Base64.NO_WRAP))
        )
        return cipher
    }

    fun decryptBiometricToken(authenticatedCipher: Cipher): String {
        val encrypted = preferences.getString(BIOMETRIC_TOKEN_KEY, null)
            ?.takeIf { it.isNotBlank() }
            ?: error("Biometric quick-login credential is missing.")
        return authenticatedCipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP))
            .toString(Charsets.UTF_8)
    }

    fun updateBiometricSessionMetadata(endpoint: SelectedEndpoint, expiresAt: String) {
        if (!biometricQuickLoginEnabled()) return
        saveSessionMetadata(endpoint, expiresAt)
    }

    fun discardStagedBiometricCredential() {
        preferences.edit()
            .remove(PENDING_BIOMETRIC_TOKEN_KEY)
            .remove(PENDING_BIOMETRIC_IV_KEY)
            .apply()
    }

    fun clearBiometricQuickLogin() {
        BiometricSessionBridge.clear()
        preferences.edit()
            .remove(BIOMETRIC_ENABLED_KEY)
            .remove(BIOMETRIC_TOKEN_KEY)
            .remove(BIOMETRIC_IV_KEY)
            .remove(PENDING_BIOMETRIC_TOKEN_KEY)
            .remove(PENDING_BIOMETRIC_IV_KEY)
            .apply()
        runCatching {
            KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }.run {
                if (containsAlias(BIOMETRIC_KEY_ALIAS)) deleteEntry(BIOMETRIC_KEY_ALIAS)
            }
        }
    }

    fun clear() {
        tokenVault.clear()
        clearBiometricQuickLogin()
        persistedTokenReadSinceLastSave = false
        preferences.edit()
            .remove(BIOMETRIC_ENROLLMENT_PENDING_KEY)
            .remove("expiresAt")
            .remove("baseUrl")
            .remove("apiMode")
            .apply()
    }

    private fun saveSessionMetadata(endpoint: SelectedEndpoint, expiresAt: String) {
        val editor = preferences.edit()
            .putString("baseUrl", endpoint.baseUrl)
            .putString("apiMode", endpoint.mode.name)
        if (expiresAt.isNotBlank()) {
            editor.putString("expiresAt", expiresAt)
        }
        editor.apply()
    }

    private fun biometricSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        (keyStore.getKey(BIOMETRIC_KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val builder = KeyGenParameterSpec.Builder(
            BIOMETRIC_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        } else {
            @Suppress("DEPRECATION")
            builder.setUserAuthenticationValidityDurationSeconds(-1)
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER).run {
            init(builder.build())
            generateKey()
        }
    }

    private companion object {
        const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val BIOMETRIC_KEY_ALIAS = "sample-room-biometric-session-token-v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_LENGTH_BITS = 128
        const val BIOMETRIC_ENABLED_KEY = "biometricQuickLoginEnabled"
        const val BIOMETRIC_TOKEN_KEY = "biometricEncryptedToken"
        const val BIOMETRIC_IV_KEY = "biometricEncryptedTokenIv"
        const val PENDING_BIOMETRIC_TOKEN_KEY = "pendingBiometricEncryptedToken"
        const val PENDING_BIOMETRIC_IV_KEY = "pendingBiometricEncryptedTokenIv"
        const val BIOMETRIC_ENROLLMENT_PENDING_KEY = "biometricEnrollmentPending"
    }
}

internal object BiometricSessionBridge {
    @Volatile
    private var inMemoryToken: String? = null

    fun provide(token: String) {
        inMemoryToken = token
    }

    fun token(): String? = inMemoryToken

    fun matches(token: String): Boolean = inMemoryToken == token

    fun clear() {
        inMemoryToken = null
    }
}

internal const val MAX_LOGIN_HISTORY = 8

internal fun updatedLoginHistory(loginId: String, current: List<String>): List<String> {
    val normalized = loginId.trim()
    if (normalized.isBlank()) return current.distinct().take(MAX_LOGIN_HISTORY)
    return (listOf(normalized) + current.filterNot { it == normalized }).take(MAX_LOGIN_HISTORY)
}

internal data class EncryptedToken(val ciphertext: String, val initializationVector: String)

internal interface TokenCipher {
    fun encrypt(plaintext: String): EncryptedToken
    fun decrypt(value: EncryptedToken): String
}

internal interface TokenStorage {
    fun get(key: String): String?
    fun put(values: Map<String, String>): Boolean
    fun remove(keys: Set<String>): Boolean
}

internal class TokenVault(
    private val storage: TokenStorage,
    private val cipher: TokenCipher
) {
    fun save(token: String) {
        val encrypted = cipher.encrypt(token)
        check(
            storage.put(
                mapOf(
                    ENCRYPTED_TOKEN_KEY to encrypted.ciphertext,
                    INITIALIZATION_VECTOR_KEY to encrypted.initializationVector,
                    FORMAT_KEY to FORMAT_VERSION
                )
            )
        ) { "Unable to store the encrypted login session." }
        check(storage.remove(setOf(LEGACY_TOKEN_KEY))) {
            "Unable to remove the legacy login session."
        }
    }

    fun token(): String? {
        val ciphertext = storage.get(ENCRYPTED_TOKEN_KEY)
        val initializationVector = storage.get(INITIALIZATION_VECTOR_KEY)
        if (!ciphertext.isNullOrBlank() && !initializationVector.isNullOrBlank()) {
            return runCatching {
                cipher.decrypt(EncryptedToken(ciphertext, initializationVector))
            }.getOrElse {
                clear()
                null
            }
        }

        val legacyToken = storage.get(LEGACY_TOKEN_KEY)?.takeIf { it.isNotBlank() } ?: return null
        save(legacyToken)
        return legacyToken
    }

    fun clear() {
        storage.remove(
            setOf(
                LEGACY_TOKEN_KEY,
                ENCRYPTED_TOKEN_KEY,
                INITIALIZATION_VECTOR_KEY,
                FORMAT_KEY
            )
        )
    }

    private companion object {
        const val LEGACY_TOKEN_KEY = "token"
        const val ENCRYPTED_TOKEN_KEY = "encryptedToken"
        const val INITIALIZATION_VECTOR_KEY = "encryptedTokenIv"
        const val FORMAT_KEY = "encryptedTokenFormat"
        const val FORMAT_VERSION = "1"
    }
}

private class SharedPreferencesTokenStorage(
    private val preferences: SharedPreferences
) : TokenStorage {
    override fun get(key: String): String? = preferences.getString(key, null)

    override fun put(values: Map<String, String>): Boolean {
        val editor = preferences.edit()
        values.forEach { (key, value) -> editor.putString(key, value) }
        return editor.commit()
    }

    override fun remove(keys: Set<String>): Boolean {
        val editor = preferences.edit()
        keys.forEach(editor::remove)
        return editor.commit()
    }
}

private class AndroidKeystoreTokenCipher : TokenCipher {
    override fun encrypt(plaintext: String): EncryptedToken {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        return EncryptedToken(
            ciphertext = Base64.encodeToString(
                cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8)),
                Base64.NO_WRAP
            ),
            initializationVector = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        )
    }

    override fun decrypt(value: EncryptedToken): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            Cipher.DECRYPT_MODE,
            secretKey(),
            GCMParameterSpec(
                GCM_TAG_LENGTH_BITS,
                Base64.decode(value.initializationVector, Base64.NO_WRAP)
            )
        )
        return cipher.doFinal(
            Base64.decode(value.ciphertext, Base64.NO_WRAP)
        ).toString(Charsets.UTF_8)
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER).run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build()
            )
            generateKey()
        }
    }

    private companion object {
        const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val KEY_ALIAS = "sample-room-session-token-v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_LENGTH_BITS = 128
    }
}
