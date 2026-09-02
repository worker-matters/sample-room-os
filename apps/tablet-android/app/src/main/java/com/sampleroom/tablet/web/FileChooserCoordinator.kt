package com.sampleroom.tablet.web

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.sampleroom.tablet.PhotoCaptureActivity

enum class UploadSource { CAMERA, GALLERY, FILE }

enum class FileChooserAction { CAMERA, GALLERY, FILE, CHOOSE_SOURCE }

object FileChooserOptions {
    fun sourcesFor(acceptTypes: Array<String>): List<UploadSource> {
        val normalized = acceptTypes.map(String::trim).filter(String::isNotEmpty)
        val acceptsImages = normalized.isEmpty() || normalized.any {
            it == "*/*" || it.startsWith("image/")
        }
        return if (acceptsImages) {
            listOf(UploadSource.CAMERA, UploadSource.GALLERY, UploadSource.FILE)
        } else {
            listOf(UploadSource.FILE)
        }
    }

    fun actionFor(
        acceptTypes: Array<String>,
        captureEnabled: Boolean,
        nextSource: UploadSource?
    ): FileChooserAction {
        if (captureEnabled) return FileChooserAction.CAMERA
        if (nextSource == UploadSource.GALLERY) return FileChooserAction.GALLERY
        return if (sourcesFor(acceptTypes) == listOf(UploadSource.FILE)) {
            FileChooserAction.FILE
        } else {
            FileChooserAction.CHOOSE_SOURCE
        }
    }
}

class FileChooserCoordinator(private val activity: ComponentActivity) {
    private var callback: ValueCallback<Array<Uri>>? = null
    private var acceptTypes: Array<String> = emptyArray()
    private var allowMultiple = false
    @Volatile private var nextUploadSource: UploadSource? = null

    private val documentLauncher = activity.registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        finish(if (result.resultCode == Activity.RESULT_OK) urisFromIntent(result.data) else null)
    }

    private val photoLauncher = activity.registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uris = if (result.resultCode == Activity.RESULT_OK) {
            result.data?.getStringArrayListExtra(PhotoCaptureActivity.EXTRA_URIS)
                ?.map(Uri::parse)
                ?.takeIf(List<Uri>::isNotEmpty)
                ?.toTypedArray()
                ?: result.data?.getStringExtra(PhotoCaptureActivity.EXTRA_URI)
                    ?.let(Uri::parse)
                    ?.let { arrayOf(it) }
        } else null
        finish(uris)
    }

    fun show(
        filePathCallback: ValueCallback<Array<Uri>>,
        params: WebChromeClient.FileChooserParams
    ): Boolean {
        callback?.onReceiveValue(null)
        callback = filePathCallback
        acceptTypes = params.acceptTypes ?: emptyArray()
        allowMultiple = params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
        val oneShotSource = nextUploadSource
        nextUploadSource = null
        when (FileChooserOptions.actionFor(acceptTypes, params.isCaptureEnabled, oneShotSource)) {
            FileChooserAction.CAMERA -> launchCamera()
            FileChooserAction.GALLERY -> launchDocument(FileSelectionMode.GALLERY)
            FileChooserAction.FILE -> launchDocument(FileSelectionMode.FILE)
            FileChooserAction.CHOOSE_SOURCE -> showSourceChooser()
        }
        return true
    }

    private fun showSourceChooser() {
        val sources = FileChooserOptions.sourcesFor(acceptTypes)
        val labels = sources.map {
            when (it) {
                UploadSource.CAMERA -> "拍照"
                UploadSource.GALLERY -> "相册"
                UploadSource.FILE -> "选择文件"
            }
        }.toTypedArray()
        AlertDialog.Builder(activity)
            .setTitle("选择上传方式")
            .setItems(labels) { _, which ->
                when (sources[which]) {
                    UploadSource.CAMERA -> launchCamera()
                    UploadSource.GALLERY -> launchDocument(FileSelectionMode.GALLERY)
                    UploadSource.FILE -> launchDocument(FileSelectionMode.FILE)
                }
            }
            .setOnCancelListener { finish(null) }
            .show()
    }

    private fun launchCamera() {
        photoLauncher.launch(
            Intent(activity, PhotoCaptureActivity::class.java)
                .putExtra(PhotoCaptureActivity.EXTRA_MULTIPLE, allowMultiple)
        )
    }

    private fun launchDocument(mode: FileSelectionMode) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (mode == FileSelectionMode.GALLERY) "image/*" else preferredMimeType()
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, mode.allowMultiple && allowMultiple)
            val normalized = acceptTypes.map(String::trim).filter { it.isNotEmpty() && it != "*/*" }
            if (mode == FileSelectionMode.FILE && normalized.size > 1) {
                putExtra(Intent.EXTRA_MIME_TYPES, normalized.toTypedArray())
            }
        }
        documentLauncher.launch(intent)
    }

    private fun preferredMimeType(): String {
        val normalized = acceptTypes.map(String::trim).filter { it.isNotEmpty() && it != "*/*" }
        return normalized.singleOrNull() ?: "*/*"
    }

    private fun urisFromIntent(data: Intent?): Array<Uri>? {
        val values = mutableListOf<Uri>()
        data?.clipData?.let { clip ->
            repeat(clip.itemCount) { index -> values += clip.getItemAt(index).uri }
        }
        data?.data?.let(values::add)
        return values.distinct().takeIf(List<Uri>::isNotEmpty)?.toTypedArray()
    }

    private fun finish(result: Array<Uri>?) {
        callback?.onReceiveValue(result)
        callback = null
        acceptTypes = emptyArray()
        allowMultiple = false
        nextUploadSource = null
    }

    fun cancel() = finish(null)

    fun setNextUploadSource(source: String) {
        nextUploadSource = if (source == "gallery") UploadSource.GALLERY else null
    }
}
