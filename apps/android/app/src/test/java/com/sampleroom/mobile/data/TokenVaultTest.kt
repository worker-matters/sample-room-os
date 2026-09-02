package com.sampleroom.mobile.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class TokenVaultTest {
    @Test fun migratesLegacyTokenAndRemovesPlaintext() {
        val storage = FakeTokenStorage(mutableMapOf("token" to "legacy-secret-token"))
        val vault = TokenVault(storage, ReversingTokenCipher())

        assertEquals("legacy-secret-token", vault.token())
        assertNull(storage.values["token"])
        assertEquals("nekot-terces-ycagel", storage.values["encryptedToken"])
        assertTrue(storage.values["encryptedTokenIv"]?.isNotBlank() == true)
    }

    @Test fun logoutClearsLegacyAndEncryptedTokenValues() {
        val storage = FakeTokenStorage(
            mutableMapOf(
                "token" to "legacy-token",
                "encryptedToken" to "ciphertext",
                "encryptedTokenIv" to "iv",
                "encryptedTokenFormat" to "1",
                "networkLanBaseUrl" to "http://192.168.1.20:3001"
            )
        )

        TokenVault(storage, ReversingTokenCipher()).clear()

        assertFalse(storage.values.containsKey("token"))
        assertFalse(storage.values.containsKey("encryptedToken"))
        assertFalse(storage.values.containsKey("encryptedTokenIv"))
        assertFalse(storage.values.containsKey("encryptedTokenFormat"))
        assertTrue(storage.values.containsKey("networkLanBaseUrl"))
    }

    @Test fun storageFailureDoesNotExposeTokenInException() {
        val token = "token-that-must-not-appear"
        val storage = FakeTokenStorage(mutableMapOf(), allowWrites = false)

        val error = assertThrows(IllegalStateException::class.java) {
            TokenVault(storage, ReversingTokenCipher()).save(token)
        }

        assertFalse(error.message.orEmpty().contains(token))
        assertFalse(storage.values.values.any { it == token })
    }

    @Test fun corruptedEncryptedTokenIsRemoved() {
        val storage = FakeTokenStorage(
            mutableMapOf(
                "encryptedToken" to "broken",
                "encryptedTokenIv" to "iv",
                "encryptedTokenFormat" to "1"
            )
        )
        val cipher = object : TokenCipher {
            override fun encrypt(plaintext: String) = error("not used")
            override fun decrypt(value: EncryptedToken): String = error("cannot decrypt")
        }

        assertNull(TokenVault(storage, cipher).token())
        assertFalse(storage.values.containsKey("encryptedToken"))
        assertFalse(storage.values.containsKey("encryptedTokenIv"))
    }
}

private class FakeTokenStorage(
    val values: MutableMap<String, String>,
    private val allowWrites: Boolean = true
) : TokenStorage {
    override fun get(key: String): String? = values[key]

    override fun put(values: Map<String, String>): Boolean {
        if (allowWrites) this.values.putAll(values)
        return allowWrites
    }

    override fun remove(keys: Set<String>): Boolean {
        if (allowWrites) keys.forEach(values::remove)
        return allowWrites
    }
}

private class ReversingTokenCipher : TokenCipher {
    override fun encrypt(plaintext: String) = EncryptedToken(plaintext.reversed(), "test-iv")
    override fun decrypt(value: EncryptedToken): String = value.ciphertext.reversed()
}
