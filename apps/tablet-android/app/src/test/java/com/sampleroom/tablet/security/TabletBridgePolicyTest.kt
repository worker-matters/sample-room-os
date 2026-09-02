package com.sampleroom.tablet.security

import com.sampleroom.tablet.web.FileSelectionMode
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TabletBridgePolicyTest {
    @Test fun `accepts only compatible formal order QR payloads`() {
        assertTrue(TabletBridgePolicy.isOrderQrPayload("SRS2|ORDER|order_scan_12345678"))
        assertTrue(TabletBridgePolicy.isOrderQrPayload("/scan/order_scan_12345678"))
        assertTrue(TabletBridgePolicy.isOrderQrPayload("https://factory.example/scan/order_scan_12345678"))
        assertTrue(TabletBridgePolicy.isOrderQrPayload("order_scan_12345678"))
        assertFalse(TabletBridgePolicy.isOrderQrPayload("SRS2|NETWORK_CONFIG|1|abc"))
        assertFalse(TabletBridgePolicy.isOrderQrPayload("https://evil.example/scan/short"))
    }

    @Test fun `limits file actions to approved role API paths and safe names`() {
        assertTrue(TabletBridgePolicy.isSafeApiFileRequest("/api/qc/me/orders/1/photos/2/download", "photo.jpg"))
        assertTrue(TabletBridgePolicy.isSafeApiFileRequest("/api/receiver/orders/1/attachments/2/download", "record.jpg"))
        assertTrue(TabletBridgePolicy.isSafeApiFileRequest("/api/planner/orders/1/attachments/2/download", "record.jpg"))
        assertFalse(TabletBridgePolicy.isSafeApiFileRequest("/api/admin/export", "data.xlsx"))
        assertFalse(TabletBridgePolicy.isSafeApiFileRequest("/api/qc/../admin", "photo.jpg"))
        assertFalse(TabletBridgePolicy.isSafeApiFileRequest("/api/qc/file", "../photo.jpg"))
    }

    @Test fun `file chooser modes keep camera single and gallery files multiple`() {
        assertFalse(FileSelectionMode.CAMERA.allowMultiple)
        assertTrue(FileSelectionMode.GALLERY.allowMultiple)
        assertTrue(FileSelectionMode.FILE.allowMultiple)
    }

    @Test fun `generated exports accept only bounded PDF and PNG files`() {
        assertTrue(TabletBridgePolicy.isSafeGeneratedFile("QC照片.pdf", "application/pdf", 1024))
        assertTrue(TabletBridgePolicy.isSafeGeneratedFile("QC照片.png", "image/png", 1024))
        assertFalse(TabletBridgePolicy.isSafeGeneratedFile("../QC照片.pdf", "application/pdf", 1024))
        assertFalse(TabletBridgePolicy.isSafeGeneratedFile("QC照片.html", "text/html", 1024))
        assertFalse(TabletBridgePolicy.isSafeGeneratedFile("QC照片.pdf", "application/pdf", 0))
    }
}
