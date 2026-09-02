package com.sampleroom.mobile.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class OrderQrParserTest {
    @Test fun parsesCurrentOrderPayload() {
        val parsed = OrderQrParser.parse("SRS2|ORDER|order_scan_123456")
        assertEquals("SRS2", parsed.version)
        assertEquals("ORDER", parsed.type)
        assertEquals("order_scan_123456", parsed.token)
    }

    @Test fun rejectsWrongVersion() {
        assertThrows(IllegalArgumentException::class.java) { OrderQrParser.parse("SRS1|ORDER|order_scan_123456") }
    }

    @Test fun rejectsWrongType() {
        assertThrows(IllegalArgumentException::class.java) { OrderQrParser.parse("SRS2|REGISTER|order_scan_123456") }
    }

    @Test fun rejectsEmptyOrUnsafeToken() {
        assertThrows(IllegalArgumentException::class.java) { OrderQrParser.parse("SRS2|ORDER|") }
        assertThrows(IllegalArgumentException::class.java) { OrderQrParser.parse("SRS2|ORDER|bad token") }
    }
}
