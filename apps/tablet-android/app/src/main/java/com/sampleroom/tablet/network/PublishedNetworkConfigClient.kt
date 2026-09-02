package com.sampleroom.tablet.network

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class PublishedNetworkConfigClient(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()
) {
    fun fetch(baseUrl: String): List<NetworkConfig> {
        val request = Request.Builder().url("${baseUrl.trimEnd('/')}/api/miniapp/network-config").get().build()
        client.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "HTTP ${response.code}" }
            val json = JSONObject(response.body?.string().orEmpty())
            check(json.optString("apiVersion") == "v1") { "API 版本不兼容" }
            return listOfNotNull(
                runCatching { json.optString("lanApiBaseUrl").takeIf(String::isNotBlank)?.let {
                    NetworkConfig(AddressType.LAN, NetworkConfigParser.normalizeBaseUrl(it, AddressType.LAN), "工厂局域网 API", "v1")
                } }.getOrNull(),
                runCatching { json.optString("publicApiBaseUrl").takeIf(String::isNotBlank)?.let {
                    NetworkConfig(AddressType.PUBLIC, NetworkConfigParser.normalizeBaseUrl(it, AddressType.PUBLIC), "公网 API", "v1")
                } }.getOrNull()
            )
        }
    }
}
