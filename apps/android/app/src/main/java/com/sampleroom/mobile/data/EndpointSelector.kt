package com.sampleroom.mobile.data

import com.sampleroom.mobile.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit

fun interface HealthProbe {
    suspend fun isSampleRoomApi(baseUrl: String): Boolean
}

class EndpointTimeoutException(message: String, cause: Throwable) : IllegalStateException(message, cause)
class EndpointConnectionRefusedException(message: String, cause: Throwable) : IllegalStateException(message, cause)
class MalformedEndpointUrlException(message: String, cause: Throwable) : IllegalArgumentException(message, cause)
class EndpointHttpException(val statusCode: Int) : IllegalStateException("服务器无法访问（HTTP $statusCode）")
class IncompatibleApiVersionException(message: String) : IllegalStateException(message)
class NotSampleRoomApiException(message: String) : IllegalStateException(message)

data class EndpointProbeResult(val service: String, val apiVersion: String)

data class PublishedNetworkConfig(
    val lanApiBaseUrl: String,
    val publicApiBaseUrl: String,
    val apiVersion: String
)

class EndpointSelector(
    private val lanBaseUrl: String,
    private val publicBaseUrl: String,
    private val probe: HealthProbe = OkHttpHealthProbe(),
    private val allowLoopbackHttp: Boolean = BuildConfig.DEBUG
) {
    @Volatile private var selected: SelectedEndpoint? = null

    suspend fun select(force: Boolean = false): SelectedEndpoint = withContext(Dispatchers.IO) {
        if (!force) selected?.let { return@withContext it }
        val lan = validatedBaseUrl(lanBaseUrl, ApiMode.LAN)
        val public = validatedBaseUrl(publicBaseUrl, ApiMode.PUBLIC)
        val result = when {
            lan.isNotEmpty() && probe.isSampleRoomApi(lan) -> SelectedEndpoint(lan, ApiMode.LAN)
            public.isNotEmpty() && probe.isSampleRoomApi(public) -> SelectedEndpoint(public, ApiMode.PUBLIC)
            public.isEmpty() -> throw IllegalStateException("请连接工厂 Wi-Fi 或检查服务器")
            else -> throw IllegalStateException("样品间 API 当前不可用")
        }
        selected = result
        result
    }

    fun clear() { selected = null }

    private fun validatedBaseUrl(value: String, mode: ApiMode): String =
        runCatching {
            NetworkConfigParser.normalizeBaseUrl(value.trim(), mode, allowLoopbackHttp)
        }.getOrDefault("")
}

class OkHttpHealthProbe : HealthProbe {
    private val client = OkHttpClient.Builder()
        .connectTimeout(1, TimeUnit.SECONDS)
        .readTimeout(1, TimeUnit.SECONDS)
        .callTimeout(1200, TimeUnit.MILLISECONDS)
        .build()

    suspend fun validate(baseUrl: String, expectedApiVersion: String = "v1"): EndpointProbeResult =
        withContext(Dispatchers.IO) {
            val request = try {
                Request.Builder().url("${baseUrl.trimEnd('/')}/api/miniapp/health").get().build()
            } catch (error: IllegalArgumentException) {
                throw MalformedEndpointUrlException("服务器地址格式错误", error)
            }
            try {
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw EndpointHttpException(response.code)
                    }
                    val json = JSONObject(response.body?.string().orEmpty())
                    if (!json.optBoolean("ok") || json.optString("service") != "sample-room-api") {
                        throw NotSampleRoomApiException("二维码地址不是样品间系统 API")
                    }
                    val apiVersion = json.optString("apiVersion")
                    if (apiVersion != expectedApiVersion) {
                        throw IncompatibleApiVersionException("API 版本不兼容：需要 $expectedApiVersion，服务器为 ${apiVersion.ifBlank { "未知" }}")
                    }
                    EndpointProbeResult("sample-room-api", apiVersion)
                }
            } catch (error: SocketTimeoutException) {
                throw EndpointTimeoutException("服务器连接超时", error)
            } catch (error: ConnectException) {
                throw EndpointConnectionRefusedException("服务器拒绝连接", error)
            }
        }

    override suspend fun isSampleRoomApi(baseUrl: String): Boolean =
        runCatching { validate(baseUrl) }.isSuccess

    suspend fun publishedNetworkConfig(baseUrl: String): PublishedNetworkConfig = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("${baseUrl.trimEnd('/')}/api/miniapp/network-config").get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw EndpointHttpException(response.code)
            val json = JSONObject(response.body?.string().orEmpty())
            val apiVersion = json.optString("apiVersion")
            if (apiVersion != "v1") throw IncompatibleApiVersionException("API 版本不兼容")
            PublishedNetworkConfig(
                lanApiBaseUrl = json.optString("lanApiBaseUrl"),
                publicApiBaseUrl = json.optString("publicApiBaseUrl"),
                apiVersion = apiVersion
            )
        }
    }
}
