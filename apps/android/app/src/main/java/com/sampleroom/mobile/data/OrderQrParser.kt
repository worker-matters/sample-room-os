package com.sampleroom.mobile.data

data class OrderQrPayload(val version: String, val type: String, val token: String)

object OrderQrParser {
    private val tokenPattern = Regex("^[A-Za-z0-9_-]{8,256}$")

    fun parse(raw: String): OrderQrPayload {
        if (raw.length > 320) throw IllegalArgumentException("二维码内容过长")
        val parts = raw.trim().split('|')
        if (parts.size != 3) throw IllegalArgumentException("不是样品间订单二维码")
        if (parts[0] != "SRS2") throw IllegalArgumentException("不支持的二维码版本")
        if (parts[1] != "ORDER") throw IllegalArgumentException("不是订单二维码")
        val token = parts[2]
        if (!tokenPattern.matches(token)) throw IllegalArgumentException("订单二维码 token 无效")
        return OrderQrPayload(parts[0], parts[1], token)
    }
}
