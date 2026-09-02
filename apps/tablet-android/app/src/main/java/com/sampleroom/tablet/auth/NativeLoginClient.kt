package com.sampleroom.tablet.auth

import com.sampleroom.tablet.BuildConfig
import com.sampleroom.tablet.security.SessionCookieHandoff
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class NativeLoginClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    fun login(baseUrl: String, account: String, password: String): NativeLoginResult {
        val body = NativeLoginContract.payload(account, password)
            .toString()
            .toRequestBody(JSON_MEDIA_TYPE)
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/auth/login")
            .header("Accept", "application/json")
            .header("X-App-Version", BuildConfig.VERSION_NAME)
            .post(body)
            .build()

        client.newCall(request).execute().use { response ->
            val responseBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw IllegalStateException(loginErrorMessage(response.code))
            }
            val json = runCatching { JSONObject(responseBody) }
                .getOrElse { throw IllegalStateException("服务器返回的登录结果无法识别。") }
            val user = json.optJSONObject("user")
                ?: throw IllegalStateException("服务器没有返回已认证用户。")
            return NativeLoginResult(
                user = TabletAuthenticatedUser(
                    id = user.optString("id"),
                    accountId = user.optString("accountId"),
                    accountType = user.optString("accountType"),
                    role = user.optString("role"),
                    displayName = user.optString("displayName").ifBlank { user.optString("id") },
                    activeWorkerProfileId = user.optString("activeWorkerProfileId").takeIf(String::isNotBlank),
                    activeWorkerType = user.optString("activeWorkerType").takeIf(String::isNotBlank),
                    mustChangePassword = user.optBoolean("mustChangePassword", false)
                ),
                setCookieHeaders = response.headers("Set-Cookie")
            )
        }
    }

    fun logoutBestEffort(baseUrl: String, setCookieHeaders: List<String>) {
        val cookie = SessionCookieHandoff.requestCookieHeader(setCookieHeaders) ?: return
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/auth/logout")
            .header("Cookie", cookie)
            .post(ByteArray(0).toRequestBody(null))
            .build()
        runCatching { client.newCall(request).execute().close() }
    }

    private fun loginErrorMessage(statusCode: Int) = when (statusCode) {
        401 -> "账号或密码错误。"
        429 -> "登录尝试过多，请稍后再试。"
        else -> "登录失败，服务器返回 HTTP $statusCode。"
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}
