package com.sampleroom.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class OrderDetailCountTest {
    @Test
    fun positiveCountsAreAppendedButZeroIsHidden() {
        assertEquals("资料与附件", countedDetailTabLabel("资料与附件", 0))
        assertEquals("资料与附件 1", countedDetailTabLabel("资料与附件", 1))
        assertEquals("其他费用 2", countedDetailTabLabel("其他费用", 2))
        assertEquals("追加费用", addChargeButtonLabel(0))
        assertEquals("追加费用 3", addChargeButtonLabel(3))
    }
}
