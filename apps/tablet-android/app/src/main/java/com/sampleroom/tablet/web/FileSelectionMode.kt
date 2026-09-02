package com.sampleroom.tablet.web

enum class FileSelectionMode(val mimeType: String, val allowMultiple: Boolean) {
    CAMERA("image/*", false),
    GALLERY("image/*", true),
    FILE("*/*", true)
}
