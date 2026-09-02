package com.sampleroom.tablet.network

import android.content.Context
import com.sampleroom.tablet.BuildConfig

class NetworkConfigStore(context: Context) {
    private val preferences = context.getSharedPreferences(
        "sample-room-tablet-network-v1",
        Context.MODE_PRIVATE
    )

    fun save(config: NetworkConfig) {
        val prefix = config.addressType.name.lowercase()
        preferences.edit()
            .putString("${prefix}BaseUrl", config.baseUrl)
            .putString("${prefix}DisplayName", config.displayName)
            .apply()
    }

    fun lanBaseUrl(): String? = preferences.getString("lanBaseUrl", null)

    fun publicBaseUrl(): String? {
        val configured = preferences.getString("publicBaseUrl", null)?.trim()
        if (!configured.isNullOrBlank()) return configured
        return BuildConfig.DEFAULT_REMOTE_ENDPOINT.trim().takeIf { it.isNotBlank() }
    }

    fun baseUrl(addressType: AddressType): String? = when (addressType) {
        AddressType.LAN -> lanBaseUrl()
        AddressType.PUBLIC -> publicBaseUrl()
    }

    fun isConfigured(addressType: AddressType) = !baseUrl(addressType).isNullOrBlank()

    fun defaultAddressType(): AddressType? = when {
        isConfigured(AddressType.LAN) -> AddressType.LAN
        isConfigured(AddressType.PUBLIC) -> AddressType.PUBLIC
        else -> null
    }

    fun allowedBaseUrls(): Set<String> = setOfNotNull(lanBaseUrl(), publicBaseUrl())
}
