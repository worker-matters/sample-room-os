package com.sampleroom.tablet.network

import com.sampleroom.tablet.BuildConfig
import org.json.JSONObject
import java.net.URI
import java.util.Base64

enum class AddressType { LAN, PUBLIC }

data class NetworkConfig(
    val addressType: AddressType,
    val baseUrl: String,
    val displayName: String?,
    val apiVersion: String
)

object NetworkConfigParser {
    const val PREFIX = "SRS2|NETWORK_CONFIG|1|"
    private const val MAX_PAYLOAD_LENGTH = 2048
    private val allowedFields = setOf("addressType", "baseUrl", "displayName", "apiVersion")

    fun parse(raw: String, allowLoopbackHttp: Boolean = BuildConfig.DEBUG): NetworkConfig {
        val value = raw.trim()
        require(value.length <= MAX_PAYLOAD_LENGTH) { "网络配置二维码内容过长" }
        require(value.startsWith(PREFIX)) { "二维码不是本系统网络配置二维码" }
        val encoded = value.removePrefix(PREFIX)
        require(encoded.isNotBlank() && !encoded.contains('|')) { "网络配置二维码格式错误" }

        val json = runCatching {
            JSONObject(Base64.getUrlDecoder().decode(encoded).toString(Charsets.UTF_8))
        }.getOrElse { throw IllegalArgumentException("网络配置二维码格式错误") }
        require(json.keys().asSequence().all { it in allowedFields }) {
            "网络配置二维码包含不允许的字段"
        }
        require(
            json.opt("addressType") is String &&
                json.opt("baseUrl") is String &&
                json.opt("apiVersion") is String &&
                (!json.has("displayName") || json.opt("displayName") is String)
        ) { "网络配置二维码字段格式错误" }

        val addressType = runCatching { AddressType.valueOf(json.getString("addressType")) }
            .getOrElse { throw IllegalArgumentException("网络配置地址类型无效") }
        require(json.getString("apiVersion") == "v1") { "API 版本不兼容" }
        return NetworkConfig(
            addressType = addressType,
            baseUrl = normalizeBaseUrl(json.getString("baseUrl"), addressType, allowLoopbackHttp),
            displayName = json.optString("displayName").trim().takeIf(String::isNotEmpty),
            apiVersion = "v1"
        )
    }

    fun normalizeBaseUrl(
        raw: String,
        addressType: AddressType,
        allowLoopbackHttp: Boolean = BuildConfig.DEBUG
    ): String {
        require(raw.isNotBlank() && raw.none(Char::isWhitespace)) { "地址格式错误" }
        val uri = runCatching { URI(raw.trim()) }
            .getOrElse { throw IllegalArgumentException("地址格式错误") }
        require(uri.scheme == "http" || uri.scheme == "https") { "地址仅允许使用 http 或 https" }
        require(uri.rawUserInfo == null) { "地址不能包含账号或密码" }
        require(!uri.host.isNullOrBlank()) { "地址缺少有效主机" }
        require(uri.rawQuery == null && uri.rawFragment == null) { "地址不能包含查询参数或片段" }
        require(uri.path.isNullOrEmpty() || uri.path == "/") { "地址不能包含 API 路径" }
        require(uri.port == -1 || uri.port in 1..65535) { "地址端口无效" }

        val privateIpv4 = isPrivateIpv4(uri.host)
        val loopback = allowLoopbackHttp && isLoopback(uri.host)
        if (addressType == AddressType.PUBLIC) {
            require(uri.scheme == "https") { "公网地址必须使用 HTTPS" }
        }
        if (addressType == AddressType.LAN) {
            require(privateIpv4 || loopback) { "局域网地址必须使用 RFC1918 私有 IPv4 地址" }
        }
        if (uri.scheme == "http") {
            require(privateIpv4 || loopback) { "HTTP 仅允许用于已配置的工厂局域网地址" }
        }

        return URI(
            uri.scheme.lowercase(),
            null,
            uri.host.lowercase(),
            uri.port,
            null,
            null,
            null
        ).toString()
    }

    private fun isPrivateIpv4(host: String): Boolean {
        val octets = host.split('.').map { it.toIntOrNull() ?: return false }
        if (octets.size != 4 || octets.any { it !in 0..255 }) return false
        return octets[0] == 10 ||
            (octets[0] == 172 && octets[1] in 16..31) ||
            (octets[0] == 192 && octets[1] == 168)
    }

    private fun isLoopback(host: String): Boolean {
        val normalized = host.trim('[', ']').lowercase()
        if (normalized == "localhost" || normalized == "::1") return true
        return normalized.substringBefore('.').toIntOrNull() == 127
    }
}
