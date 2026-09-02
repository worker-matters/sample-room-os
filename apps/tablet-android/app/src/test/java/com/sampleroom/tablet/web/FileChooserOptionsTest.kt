package com.sampleroom.tablet.web

import org.junit.Assert.assertEquals
import org.junit.Test

class FileChooserOptionsTest {
    @Test fun `image and unrestricted inputs offer camera gallery and files`() {
        assertEquals(
            listOf(UploadSource.CAMERA, UploadSource.GALLERY, UploadSource.FILE),
            FileChooserOptions.sourcesFor(arrayOf("image/*"))
        )
        assertEquals(3, FileChooserOptions.sourcesFor(emptyArray()).size)
    }

    @Test fun `non image inputs do not offer camera`() {
        assertEquals(listOf(UploadSource.FILE), FileChooserOptions.sourcesFor(arrayOf("application/pdf")))
    }

    @Test fun `capture and one shot gallery bypass the source chooser`() {
        assertEquals(
            FileChooserAction.CAMERA,
            FileChooserOptions.actionFor(arrayOf("image/*"), captureEnabled = true, nextSource = null)
        )
        assertEquals(
            FileChooserAction.GALLERY,
            FileChooserOptions.actionFor(arrayOf("image/*"), captureEnabled = false, nextSource = UploadSource.GALLERY)
        )
        assertEquals(
            FileChooserAction.CHOOSE_SOURCE,
            FileChooserOptions.actionFor(arrayOf("image/*"), captureEnabled = false, nextSource = null)
        )
        assertEquals(
            FileChooserAction.FILE,
            FileChooserOptions.actionFor(arrayOf("application/pdf"), captureEnabled = false, nextSource = null)
        )
    }
}
