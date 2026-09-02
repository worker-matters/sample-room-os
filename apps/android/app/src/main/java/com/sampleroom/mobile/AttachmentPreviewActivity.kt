package com.sampleroom.mobile

import android.content.Context
import android.content.Intent
import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.RectF
import android.graphics.pdf.PdfRenderer
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.util.AttributeSet
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.CacheControl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.min

class AttachmentPreviewActivity : ComponentActivity() {
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .cache(null)
        .build()
    private lateinit var content: FrameLayout
    private var cachedFile: File? = null
    private var descriptor: ParcelFileDescriptor? = null
    private var renderer: PdfRenderer? = null
    private var currentPage = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = intent.getStringExtra(EXTRA_URL).orEmpty()
        val token = intent.getStringExtra(EXTRA_TOKEN).orEmpty()
        val name = intent.getStringExtra(EXTRA_FILE_NAME).orEmpty()
        val localPath = intent.getStringExtra(EXTRA_LOCAL_PATH).orEmpty()
        val localMime = intent.getStringExtra(EXTRA_MIME_TYPE).orEmpty()
        if (localPath.isBlank() && (url.isBlank() || token.isBlank())) {
            finish()
            return
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(242, 246, 252))
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(14), dp(18), dp(14))
            setBackgroundColor(Color.rgb(18, 59, 109))
        }
        header.addView(TextView(this).apply {
            text = name.ifBlank { "附件预览" }
            setTextColor(Color.WHITE)
            textSize = 18f
            maxLines = 1
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        content = FrameLayout(this).apply {
            addView(
                ProgressBar(this@AttachmentPreviewActivity),
                FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER)
            )
        }
        val footer = LinearLayout(this).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(8), dp(16), dp(12))
            addView(Button(this@AttachmentPreviewActivity).apply {
                text = "退出"
                setOnClickListener { finish() }
            })
        }
        root.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(footer, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(root)
        if (localPath.isNotBlank()) {
            val localFile = File(localPath)
            cachedFile = localFile
            if (localMime == "application/pdf") showPdf(localFile) else showImage(localFile)
        } else {
            loadPreview(url, token)
        }
    }

    private fun loadPreview(url: String, token: String) = lifecycleScope.launch {
        runCatching {
            withContext(Dispatchers.IO) {
                val request = Request.Builder().url(url)
                    .header("Authorization", "Bearer $token")
                    .cacheControl(CacheControl.FORCE_NETWORK)
                    .build()
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) error("预览失败（${response.code}）")
                    val mime = response.header("Content-Type").orEmpty().substringBefore(';')
                    if (!mime.startsWith("image/") && mime != "application/pdf") error("仅支持预览图片或 PDF")
                    val file = File.createTempFile(
                        "attachment-preview-",
                        if (mime == "application/pdf") ".pdf" else ".img",
                        cacheDir
                    )
                    response.body?.byteStream()?.use { input -> file.outputStream().use(input::copyTo) }
                        ?: error("附件内容为空")
                    cachedFile = file
                    mime to file
                }
            }
        }.onSuccess { (mime, file) ->
            if (mime == "application/pdf") showPdf(file) else showImage(file)
        }.onFailure { showError(it.message ?: "无法预览附件") }
    }

    private fun showImage(file: File) {
        val bitmap = decodeImageRespectingExif(file)
        if (bitmap == null) {
            showError("无法读取图片")
            return
        }
        content.removeAllViews()
        content.addView(ZoomableImageView(this).apply {
            contentDescription = "附件图片，可双指缩放并拖动查看"
            setPadding(dp(8), dp(8), dp(8), dp(8))
            displayBitmap(bitmap)
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    private fun decodeImageRespectingExif(file: File): Bitmap? {
        val source = BitmapFactory.decodeFile(file.absolutePath) ?: return null
        val exif = runCatching {
            androidx.exifinterface.media.ExifInterface(file.absolutePath)
        }.getOrNull() ?: return source
        val orientation = exif.getAttributeInt(
            androidx.exifinterface.media.ExifInterface.TAG_ORIENTATION,
            androidx.exifinterface.media.ExifInterface.ORIENTATION_NORMAL
        )

        if (
            orientation == androidx.exifinterface.media.ExifInterface.ORIENTATION_NORMAL ||
            orientation == androidx.exifinterface.media.ExifInterface.ORIENTATION_UNDEFINED
        ) {
            return source
        }

        val matrix = Matrix()
        when (orientation) {
            androidx.exifinterface.media.ExifInterface.ORIENTATION_FLIP_HORIZONTAL ->
                matrix.setScale(-1f, 1f)
            androidx.exifinterface.media.ExifInterface.ORIENTATION_ROTATE_180 ->
                matrix.setRotate(180f)
            androidx.exifinterface.media.ExifInterface.ORIENTATION_FLIP_VERTICAL -> {
                matrix.setRotate(180f)
                matrix.postScale(-1f, 1f)
            }
            androidx.exifinterface.media.ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.setRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            androidx.exifinterface.media.ExifInterface.ORIENTATION_ROTATE_90 ->
                matrix.setRotate(90f)
            androidx.exifinterface.media.ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.setRotate(-90f)
                matrix.postScale(-1f, 1f)
            }
            androidx.exifinterface.media.ExifInterface.ORIENTATION_ROTATE_270 ->
                matrix.setRotate(-90f)
            else -> return source
        }

        return runCatching {
            Bitmap.createBitmap(
                source,
                0,
                0,
                source.width,
                source.height,
                matrix,
                true
            )
        }.getOrElse {
            source
        }.also { result ->
            if (result !== source) source.recycle()
        }
    }
    private fun showPdf(file: File) {
        descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        renderer = PdfRenderer(descriptor!!)
        currentPage = 0
        renderPdfPage()
    }

    private fun renderPdfPage() {
        val pdf = renderer ?: return
        if (pdf.pageCount == 0) {
            showError("PDF 没有可预览页面")
            return
        }
        val page = pdf.openPage(currentPage)
        val width = resources.displayMetrics.widthPixels.coerceAtLeast(720)
        val height = (width.toFloat() / page.width * page.height).toInt().coerceAtLeast(1)
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.WHITE)
        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        page.close()
        content.removeAllViews()
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        column.addView(ZoomableImageView(this).apply {
            contentDescription = "PDF 第 ${currentPage + 1} 页，可双指缩放并拖动查看"
            displayBitmap(bitmap)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        val controls = LinearLayout(this).apply {
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(6), dp(8), dp(10))
        }
        controls.addView(Button(this).apply {
            text = "上一页"
            isEnabled = currentPage > 0
            setOnClickListener { currentPage--; renderPdfPage() }
        })
        controls.addView(TextView(this).apply {
            text = getString(R.string.pdf_page_count, currentPage + 1, pdf.pageCount)
            setPadding(dp(18), 0, dp(18), 0)
        })
        controls.addView(Button(this).apply {
            text = "下一页"
            isEnabled = currentPage < pdf.pageCount - 1
            setOnClickListener { currentPage++; renderPdfPage() }
        })
        column.addView(controls)
        content.addView(column, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    private fun showError(message: String) {
        content.removeAllViews()
        content.addView(TextView(this).apply {
            text = message
            gravity = Gravity.CENTER
            textSize = 16f
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    override fun onDestroy() {
        renderer?.close()
        descriptor?.close()
        cachedFile?.delete()
        client.dispatcher.cancelAll()
        super.onDestroy()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_URL = "previewUrl"
        const val EXTRA_TOKEN = "previewToken"
        const val EXTRA_FILE_NAME = "previewFileName"
        const val EXTRA_LOCAL_PATH = "previewLocalPath"
        const val EXTRA_MIME_TYPE = "previewMimeType"

        fun localIntent(context: Context, fileName: String, mimeType: String, bytes: ByteArray): Intent {
            val suffix = if (mimeType == "application/pdf") ".pdf" else ".img"
            val file = File.createTempFile("local-preview-", suffix, context.cacheDir)
            file.writeBytes(bytes)
            return Intent(context, AttachmentPreviewActivity::class.java)
                .putExtra(EXTRA_LOCAL_PATH, file.absolutePath)
                .putExtra(EXTRA_MIME_TYPE, mimeType)
                .putExtra(EXTRA_FILE_NAME, fileName)
        }
    }
}

@SuppressLint("AppCompatCustomView")
private class ZoomableImageView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : ImageView(context, attrs) {
    private val transform = Matrix()
    private var currentScale = 1f
    private var minimumScale = 1f
    private var lastCenterX = 0f
    private var lastCenterY = 0f
    private var hasLastCenter = false
    private val scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            val nextScale = (currentScale * detector.scaleFactor).coerceIn(minimumScale, minimumScale * 5f)
            val factor = nextScale / currentScale
            transform.postScale(factor, factor, detector.focusX, detector.focusY)
            currentScale = nextScale
            constrainAndApply()
            return true
        }
    })

    init {
        scaleType = ScaleType.MATRIX
        isClickable = true
    }

    fun displayBitmap(bitmap: Bitmap) {
        super.setImageBitmap(bitmap)
        post(::resetTransform)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w > 0 && h > 0 && drawable != null) resetTransform()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)
        val centerX = (0 until event.pointerCount).sumOf { event.getX(it).toDouble() }.toFloat() / event.pointerCount
        val centerY = (0 until event.pointerCount).sumOf { event.getY(it).toDouble() }.toFloat() / event.pointerCount
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                lastCenterX = centerX
                lastCenterY = centerY
                hasLastCenter = true
            }
            MotionEvent.ACTION_MOVE -> {
                if (hasLastCenter) {
                    transform.postTranslate(centerX - lastCenterX, centerY - lastCenterY)
                    constrainAndApply()
                }
                lastCenterX = centerX
                lastCenterY = centerY
            }
            MotionEvent.ACTION_POINTER_UP -> {
                hasLastCenter = false
            }
            MotionEvent.ACTION_UP -> {
                hasLastCenter = false
                performClick()
            }
            MotionEvent.ACTION_CANCEL -> hasLastCenter = false
        }
        return true
    }

    override fun performClick(): Boolean = super.performClick()

    private fun resetTransform() {
        val image = drawable ?: return
        val availableWidth = (width - paddingLeft - paddingRight).coerceAtLeast(1).toFloat()
        val availableHeight = (height - paddingTop - paddingBottom).coerceAtLeast(1).toFloat()
        minimumScale = min(availableWidth / image.intrinsicWidth, availableHeight / image.intrinsicHeight)
        currentScale = minimumScale
        val left = paddingLeft + (availableWidth - image.intrinsicWidth * minimumScale) / 2f
        val top = paddingTop + (availableHeight - image.intrinsicHeight * minimumScale) / 2f
        transform.reset()
        transform.postScale(minimumScale, minimumScale)
        transform.postTranslate(left, top)
        imageMatrix = transform
    }

    private fun constrainAndApply() {
        val image = drawable ?: return
        val bounds = RectF(0f, 0f, image.intrinsicWidth.toFloat(), image.intrinsicHeight.toFloat())
        transform.mapRect(bounds)
        val leftLimit = paddingLeft.toFloat()
        val topLimit = paddingTop.toFloat()
        val rightLimit = (width - paddingRight).toFloat()
        val bottomLimit = (height - paddingBottom).toFloat()
        val dx = when {
            bounds.width() <= rightLimit - leftLimit -> (leftLimit + rightLimit) / 2f - bounds.centerX()
            bounds.left > leftLimit -> leftLimit - bounds.left
            bounds.right < rightLimit -> rightLimit - bounds.right
            else -> 0f
        }
        val dy = when {
            bounds.height() <= bottomLimit - topLimit -> (topLimit + bottomLimit) / 2f - bounds.centerY()
            bounds.top > topLimit -> topLimit - bounds.top
            bounds.bottom < bottomLimit -> bottomLimit - bounds.bottom
            else -> 0f
        }
        transform.postTranslate(dx, dy)
        imageMatrix = transform
    }
}
