package com.sampleroom.mobile.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class MaterialRecordFileNameTest {
    @Test
    fun renamedUploadPreservesExtensionAndPayloadMetadata() {
        val original = UploadPayload(
            bytes = "image".toByteArray(),
            fileName = "camera-123.jpg",
            mimeType = "image/jpeg"
        )

        val renamed = renameMaterialRecordUpload(original, "  蓝色主布到货记录  ")

        assertEquals("蓝色主布到货记录.jpg", renamed.fileName)
        assertTrue(original.bytes.contentEquals(renamed.bytes))
        assertEquals(original.mimeType, renamed.mimeType)
        assertNull(validateMaterialRecordFileName("蓝色主布到货记录", ".jpg"))
    }

    @Test
    fun invalidFilenameBodiesAreRejected() {
        assertEquals("文件名不能为空。", validateMaterialRecordFileName("   ", ".jpg"))
        assertTrue(validateMaterialRecordFileName("..", ".jpg")!!.contains("路径符号"))
        assertTrue(validateMaterialRecordFileName("../面料", ".jpg")!!.contains("不能包含"))
        assertTrue(validateMaterialRecordFileName("面料/到货", ".jpg")!!.contains("不能包含"))
        assertTrue(
            validateMaterialRecordFileName(
                "a".repeat(MAX_MATERIAL_RECORD_FILE_NAME_LENGTH),
                ".jpg"
            )!!.contains(MAX_MATERIAL_RECORD_FILE_NAME_LENGTH.toString())
        )
        assertTrue(validateMaterialRecordFileName("material.exe", "")!!.contains("没有扩展名"))
    }

    @Test
    fun invalidFilenameCannotCreateUploadPayload() {
        val upload = UploadPayload("file".toByteArray(), "material.pdf", "application/pdf")

        assertThrows(IllegalArgumentException::class.java) {
            renameMaterialRecordUpload(upload, "../结算单")
        }
    }
}
