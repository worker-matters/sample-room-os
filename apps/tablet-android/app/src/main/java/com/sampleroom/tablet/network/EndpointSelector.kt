package com.sampleroom.tablet.network

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

data class SelectedEndpoint(val baseUrl: String, val addressType: AddressType)

data class EndpointResolution(
    val endpoint: SelectedEndpoint,
    val syncedConfigs: List<NetworkConfig> = emptyList(),
    val usedPublicFallback: Boolean = false,
    val restoredLan: Boolean = false
)

fun interface HealthProbe {
    fun isSampleRoomApi(baseUrl: String): Boolean
}

class EndpointSelector(private val probe: HealthProbe) {
    fun select(addressType: AddressType, lanBaseUrl: String?, publicBaseUrl: String?): SelectedEndpoint {
        val baseUrl = normalizedOrNull(
            if (addressType == AddressType.LAN) lanBaseUrl else publicBaseUrl,
            addressType
        ) ?: throw IllegalStateException("尚未配置 ${addressType.name} 线路。")
        if (!probe.isSampleRoomApi(baseUrl)) {
            throw IllegalStateException("${addressType.name} 线路当前无法连接，请检查网络后重试。")
        }
        return SelectedEndpoint(baseUrl, addressType)
    }

    private fun normalizedOrNull(value: String?, type: AddressType): String? = value
        ?.takeIf(String::isNotBlank)
        ?.let { runCatching { NetworkConfigParser.normalizeBaseUrl(it, type) }.getOrNull() }
}

class LanPreferredEndpointResolver(
    private val endpointSelector: EndpointSelector,
    private val fetchPublishedConfigs: (String) -> List<NetworkConfig>
) {
    fun resolve(lanBaseUrl: String?, publicBaseUrl: String?): EndpointResolution {
        runCatching {
            endpointSelector.select(AddressType.LAN, lanBaseUrl, publicBaseUrl)
        }.getOrNull()?.let { return EndpointResolution(endpoint = it) }

        val publicEndpoint = endpointSelector.select(AddressType.PUBLIC, lanBaseUrl, publicBaseUrl)
        val publishedLanConfigs = runCatching { fetchPublishedConfigs(publicEndpoint.baseUrl) }
            .getOrDefault(emptyList())
            .filter { it.addressType == AddressType.LAN }
            .filter { config ->
                runCatching {
                    endpointSelector.select(AddressType.LAN, config.baseUrl, publicBaseUrl)
                }.isSuccess
            }

        val recoveredLan = publishedLanConfigs.lastOrNull()
        return EndpointResolution(
            endpoint = recoveredLan?.let { SelectedEndpoint(it.baseUrl, AddressType.LAN) }
                ?: publicEndpoint,
            syncedConfigs = recoveredLan?.let(::listOf).orEmpty(),
            usedPublicFallback = true,
            restoredLan = recoveredLan != null
        )
    }
}

enum class HealthProbeFailure {
    DNS,
    TIMEOUT,
    TLS,
    CONNECTION_REFUSED,
    HTTP,
    IDENTITY,
    API_VERSION,
    CONNECTION
}

sealed interface HealthProbeResult {
    data object Success : HealthProbeResult
    data class Failure(
        val reason: HealthProbeFailure,
        val httpStatus: Int? = null
    ) : HealthProbeResult {
        fun userMessage(): String = when (reason) {
            HealthProbeFailure.DNS -> "无法解析服务器地址"
            HealthProbeFailure.TIMEOUT -> "连接服务器超时"
            HealthProbeFailure.TLS -> "HTTPS 安全连接失败"
            HealthProbeFailure.CONNECTION_REFUSED -> "服务器拒绝连接"
            HealthProbeFailure.HTTP -> "服务器返回 HTTP ${httpStatus ?: "错误"}"
            HealthProbeFailure.IDENTITY -> "服务器身份校验失败"
            HealthProbeFailure.API_VERSION -> "服务器 API 版本不兼容"
            HealthProbeFailure.CONNECTION -> "无法连接服务器"
        }
    }
}

class OkHttpHealthProbe(
    private val client: OkHttpClient = defaultClient()
) : HealthProbe {
    fun probe(baseUrl: String): HealthProbeResult = try {
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/miniapp/health")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                return@use HealthProbeResult.Failure(HealthProbeFailure.HTTP, response.code)
            }
            val json = runCatching { JSONObject(response.body?.string().orEmpty()) }
                .getOrElse { return@use HealthProbeResult.Failure(HealthProbeFailure.IDENTITY) }
            if (!json.optBoolean("ok") || json.optString("service") != "sample-room-api") {
                return@use HealthProbeResult.Failure(HealthProbeFailure.IDENTITY)
            }
            if (json.optString("apiVersion") != "v1") {
                return@use HealthProbeResult.Failure(HealthProbeFailure.API_VERSION)
            }
            HealthProbeResult.Success
        }
    } catch (_: UnknownHostException) {
        HealthProbeResult.Failure(HealthProbeFailure.DNS)
    } catch (_: SSLException) {
        HealthProbeResult.Failure(HealthProbeFailure.TLS)
    } catch (_: ConnectException) {
        HealthProbeResult.Failure(HealthProbeFailure.CONNECTION_REFUSED)
    } catch (_: InterruptedIOException) {
        HealthProbeResult.Failure(HealthProbeFailure.TIMEOUT)
    } catch (_: Exception) {
        HealthProbeResult.Failure(HealthProbeFailure.CONNECTION)
    }

    override fun isSampleRoomApi(baseUrl: String): Boolean = probe(baseUrl) == HealthProbeResult.Success

    companion object {
        private fun defaultClient() = OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS)
            .callTimeout(8, TimeUnit.SECONDS)
            .followRedirects(false)
            .build()
    }
}
