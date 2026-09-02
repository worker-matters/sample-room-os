package com.sampleroom.mobile.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class BiometricSessionRefresh(
    val token: String,
    val expiresAt: String
)

class BiometricSessionRejectedException : IOException("Biometric quick-login session is no longer valid.")

class BiometricSessionClient {
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    suspend fun refresh(endpoint: SelectedEndpoint, token: String): BiometricSessionRefresh =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("${endpoint.baseUrl}/api/auth/android-biometric-session")
                .header("Authorization", "Bearer $token")
                .post("{}".toRequestBody(jsonMediaType))
                .build()
            client.newCall(request).execute().use { response ->
                val payload = response.body?.string().orEmpty()
                if (response.code == 401 || response.code == 403) {
                    throw BiometricSessionRejectedException()
                }
                if (!response.isSuccessful) {
                    throw IOException("Biometric session refresh failed with HTTP ${response.code}.")
                }
                val json = JSONObject(payload)
                val refreshedToken = json.getString("token")
                if (refreshedToken != token) {
                    throw IOException("Biometric session refresh returned an unexpected token.")
                }
                BiometricSessionRefresh(
                    token = refreshedToken,
                    expiresAt = json.getString("expiresAt")
                )
            }
        }
}
