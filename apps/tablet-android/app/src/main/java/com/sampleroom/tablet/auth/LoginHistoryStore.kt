package com.sampleroom.tablet.auth

import android.content.Context
import org.json.JSONArray

class LoginHistoryStore(context: Context) {
    private val preferences = context.getSharedPreferences("sample-room-tablet-login-history-v1", Context.MODE_PRIVATE)

    fun list(): List<String> = runCatching {
        val values = JSONArray(preferences.getString("accounts", "[]"))
        buildList {
            repeat(values.length()) { index ->
                values.optString(index).trim().takeIf(String::isNotBlank)?.let(::add)
            }
        }.distinct().take(MAX_ENTRIES)
    }.getOrDefault(emptyList())

    fun record(account: String) {
        val normalized = account.trim()
        if (normalized.isBlank()) return
        val updated = (listOf(normalized) + list().filterNot { it == normalized }).take(MAX_ENTRIES)
        preferences.edit().putString("accounts", JSONArray(updated).toString()).apply()
    }

    fun clear() = preferences.edit().remove("accounts").apply()

    companion object {
        const val MAX_ENTRIES = 8
    }
}
