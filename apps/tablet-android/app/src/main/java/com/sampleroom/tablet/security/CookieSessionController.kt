package com.sampleroom.tablet.security

import android.webkit.CookieManager

interface CookieBackend {
    fun flush()
    fun removeAll(callback: (Boolean) -> Unit)
}

class CookieSessionController(private val backend: CookieBackend) {
    fun persist() = backend.flush()

    fun clear(onComplete: () -> Unit) {
        backend.removeAll {
            backend.flush()
            onComplete()
        }
    }
}

class AndroidCookieBackend(
    private val cookieManager: CookieManager = CookieManager.getInstance()
) : CookieBackend {
    override fun flush() = cookieManager.flush()
    override fun removeAll(callback: (Boolean) -> Unit) = cookieManager.removeAllCookies(callback)
}
