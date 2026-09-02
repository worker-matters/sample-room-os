package com.sampleroom.tablet

import org.junit.Assert.assertEquals
import org.junit.Test

class CameraCaptureModeTest {
    @Test fun `single and multiple inputs use the same camera activity with distinct modes`() {
        assertEquals(CameraCaptureMode.SINGLE, CameraCaptureModeResolver.from(false))
        assertEquals(CameraCaptureMode.MULTIPLE, CameraCaptureModeResolver.from(true))
    }
}
