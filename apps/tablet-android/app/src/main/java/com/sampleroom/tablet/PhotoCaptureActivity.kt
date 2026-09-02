package com.sampleroom.tablet

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.GestureDetector
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File
import java.util.concurrent.TimeUnit

enum class CameraCaptureMode { SINGLE, MULTIPLE }

object CameraCaptureModeResolver {
    fun from(multiple: Boolean) = if (multiple) CameraCaptureMode.MULTIPLE else CameraCaptureMode.SINGLE
}

class PhotoCaptureActivity : ComponentActivity() {
    private lateinit var root: FrameLayout
    private lateinit var previewView: PreviewView
    private lateinit var previewImage: ImageView
    private lateinit var shutter: View
    private lateinit var flashButton: ImageButton
    private lateinit var captureControls: LinearLayout
    private lateinit var reviewControls: LinearLayout
    private lateinit var thumbnailStrip: LinearLayout
    private lateinit var thumbnailScroll: HorizontalScrollView
    private lateinit var countLabel: TextView
    private lateinit var finishButton: TextView
    private lateinit var focusIndicator: View
    private var imageCapture: ImageCapture? = null
    private var camera: Camera? = null
    private var flashMode = ImageCapture.FLASH_MODE_AUTO
    private var captureInFlight = false
    private var submitted = false
    private var reviewFile: File? = null
    private val capturedFiles = mutableListOf<File>()
    private val mode by lazy {
        CameraCaptureModeResolver.from(intent.getBooleanExtra(EXTRA_MULTIPLE, false))
    }

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) bindCamera() else showPermissionError()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        buildUi()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            bindCamera()
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun buildUi() {
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        previewView = PreviewView(this).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        configurePreviewGestures()
        root.addView(previewView, fullFrame())

        previewImage = ImageView(this).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            setBackgroundColor(Color.BLACK)
            visibility = View.GONE
        }
        root.addView(previewImage, fullFrame())

        focusIndicator = View(this).apply {
            background = GradientDrawable().apply {
                setColor(Color.TRANSPARENT)
                setStroke(dp(2), Color.WHITE)
            }
            alpha = 0f
        }
        root.addView(focusIndicator, FrameLayout.LayoutParams(dp(54), dp(54)))

        val topBar = FrameLayout(this).apply {
            setPadding(dp(18), dp(14), dp(18), dp(10))
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0xB3000000.toInt(), Color.TRANSPARENT)
            )
        }
        topBar.addView(iconButton(R.drawable.ic_camera_back, "返回") { cancelAndFinish() }, FrameLayout.LayoutParams(dp(52), dp(52), Gravity.START))
        flashButton = iconButton(R.drawable.ic_camera_flash_auto, "闪光灯") { cycleFlashMode() }
        flashButton.visibility = View.GONE
        topBar.addView(flashButton, FrameLayout.LayoutParams(dp(52), dp(52), Gravity.END))
        root.addView(topBar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(86), Gravity.TOP))

        captureControls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(12), dp(20), dp(16))
            background = GradientDrawable(
                GradientDrawable.Orientation.BOTTOM_TOP,
                intArrayOf(0xCC000000.toInt(), 0x33000000)
            )
        }
        thumbnailScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            visibility = if (mode == CameraCaptureMode.MULTIPLE) View.VISIBLE else View.INVISIBLE
        }
        thumbnailStrip = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        thumbnailScroll.addView(thumbnailStrip, ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(68)))
        captureControls.addView(thumbnailScroll, LinearLayout.LayoutParams(0, dp(68), 1f))

        shutter = View(this).apply {
            contentDescription = "拍照"
            isEnabled = false
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.WHITE)
                setStroke(dp(5), 0x99FFFFFF.toInt())
            }
            setOnClickListener { capturePhoto() }
        }
        captureControls.addView(shutter, LinearLayout.LayoutParams(dp(70), dp(70)).apply {
            marginStart = dp(22)
            marginEnd = dp(22)
        })

        val finishArea = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            visibility = if (mode == CameraCaptureMode.MULTIPLE) View.VISIBLE else View.INVISIBLE
        }
        countLabel = TextView(this).apply {
            text = "已拍 0 张"
            textSize = 13f
            setTextColor(0xFFDCE6F3.toInt())
            gravity = Gravity.CENTER
        }
        finishButton = actionText("完成（0）", primary = true) { submitMultiple() }.apply { isEnabled = false }
        finishArea.addView(countLabel, LinearLayout.LayoutParams(dp(116), dp(24)))
        finishArea.addView(finishButton, LinearLayout.LayoutParams(dp(116), dp(44)))
        captureControls.addView(finishArea, LinearLayout.LayoutParams(0, dp(68), 1f))
        root.addView(captureControls, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(104), Gravity.BOTTOM))

        reviewControls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(14), dp(24), dp(18))
            setBackgroundColor(0xCC000000.toInt())
            visibility = View.GONE
        }
        root.addView(reviewControls, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(88), Gravity.BOTTOM))
        setContentView(root)
    }

    private fun configurePreviewGestures() {
        val scaleDetector = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                val active = camera ?: return false
                val state = active.cameraInfo.zoomState.value ?: return false
                active.cameraControl.setZoomRatio(
                    (state.zoomRatio * detector.scaleFactor).coerceIn(state.minZoomRatio, state.maxZoomRatio)
                )
                return true
            }
        })
        val tapDetector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(event: MotionEvent) = true
            override fun onSingleTapUp(event: MotionEvent): Boolean {
                focusAt(event.x, event.y)
                return true
            }
        })
        previewView.setOnTouchListener { _, event ->
            scaleDetector.onTouchEvent(event)
            if (!scaleDetector.isInProgress) tapDetector.onTouchEvent(event)
            true
        }
    }

    private fun bindCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            runCatching {
                val provider = future.get()
                val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
                imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setFlashMode(flashMode)
                    .build()
                provider.unbindAll()
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
                val hasFlash = camera?.cameraInfo?.hasFlashUnit() == true
                flashButton.visibility = if (hasFlash) View.VISIBLE else View.GONE
                shutter.isEnabled = true
                updateFlashIcon()
            }.onFailure { showCameraError(it.message ?: "相机启动失败") }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun focusAt(x: Float, y: Float) {
        val active = camera ?: return
        val point = previewView.meteringPointFactory.createPoint(x, y)
        active.cameraControl.startFocusAndMetering(
            FocusMeteringAction.Builder(point)
                .setAutoCancelDuration(2, TimeUnit.SECONDS)
                .build()
        )
        focusIndicator.animate().cancel()
        focusIndicator.x = x - focusIndicator.width / 2f
        focusIndicator.y = y - focusIndicator.height / 2f
        focusIndicator.alpha = 1f
        focusIndicator.scaleX = 1.2f
        focusIndicator.scaleY = 1.2f
        focusIndicator.animate().scaleX(1f).scaleY(1f).alpha(0f).setStartDelay(650).setDuration(280).start()
    }

    private fun cycleFlashMode() {
        if (camera?.cameraInfo?.hasFlashUnit() != true) return
        flashMode = when (flashMode) {
            ImageCapture.FLASH_MODE_AUTO -> ImageCapture.FLASH_MODE_ON
            ImageCapture.FLASH_MODE_ON -> ImageCapture.FLASH_MODE_OFF
            else -> ImageCapture.FLASH_MODE_AUTO
        }
        imageCapture?.flashMode = flashMode
        updateFlashIcon()
    }

    private fun updateFlashIcon() {
        flashButton.setImageResource(when (flashMode) {
            ImageCapture.FLASH_MODE_ON -> R.drawable.ic_camera_flash_on
            ImageCapture.FLASH_MODE_OFF -> R.drawable.ic_camera_flash_off
            else -> R.drawable.ic_camera_flash_auto
        })
    }

    private fun capturePhoto() {
        val capture = imageCapture ?: return
        if (captureInFlight) return
        captureInFlight = true
        shutter.isEnabled = false
        shutter.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        val target = File.createTempFile("tablet-photo-", ".jpg", File(cacheDir, "file-chooser").apply { mkdirs() })
        capture.takePicture(
            ImageCapture.OutputFileOptions.Builder(target).build(),
            ContextCompat.getMainExecutor(this),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                    captureInFlight = false
                    shutter.isEnabled = true
                    capturedFiles += target
                    previewView.animate().alpha(0.45f).setDuration(60).withEndAction {
                        previewView.animate().alpha(1f).setDuration(100).start()
                    }.start()
                    if (mode == CameraCaptureMode.SINGLE) showSingleReview(target) else updateMultipleControls()
                }

                override fun onError(exception: ImageCaptureException) {
                    target.delete()
                    captureInFlight = false
                    shutter.isEnabled = true
                    showCameraError(exception.message ?: "拍照失败，请重试")
                }
            }
        )
    }

    private fun showSingleReview(file: File) {
        reviewFile = file
        showReviewImage(file)
        reviewControls.removeAllViews()
        reviewControls.addView(actionText("重拍") { retakeSingle() }, LinearLayout.LayoutParams(dp(150), dp(52)).apply { marginEnd = dp(18) })
        reviewControls.addView(actionText("使用照片", primary = true) { submitSingle() }, LinearLayout.LayoutParams(dp(170), dp(52)))
    }

    private fun showMultipleReview(file: File) {
        reviewFile = file
        showReviewImage(file)
        reviewControls.removeAllViews()
        reviewControls.addView(actionText("返回拍摄") { hideReview() }, LinearLayout.LayoutParams(dp(150), dp(52)).apply { marginEnd = dp(18) })
        reviewControls.addView(actionText("删除照片", danger = true) { deleteReviewedPhoto() }, LinearLayout.LayoutParams(dp(170), dp(52)))
    }

    private fun showReviewImage(file: File) {
        previewImage.setImageURI(fileUri(file))
        previewImage.visibility = View.VISIBLE
        previewView.visibility = View.GONE
        captureControls.visibility = View.GONE
        reviewControls.visibility = View.VISIBLE
        flashButton.visibility = View.GONE
    }

    private fun hideReview() {
        reviewFile = null
        previewImage.setImageDrawable(null)
        previewImage.visibility = View.GONE
        previewView.visibility = View.VISIBLE
        captureControls.visibility = View.VISIBLE
        reviewControls.visibility = View.GONE
        flashButton.visibility = if (camera?.cameraInfo?.hasFlashUnit() == true) View.VISIBLE else View.GONE
    }

    private fun retakeSingle() {
        reviewFile?.let { file -> capturedFiles.remove(file); file.delete() }
        hideReview()
    }

    private fun deleteReviewedPhoto() {
        reviewFile?.let { file -> capturedFiles.remove(file); file.delete() }
        hideReview()
        updateMultipleControls()
    }

    private fun updateMultipleControls() {
        val count = capturedFiles.size
        countLabel.text = "已拍 ${count} 张"
        finishButton.text = "完成（${count}）"
        finishButton.isEnabled = count > 0
        finishButton.alpha = if (count > 0) 1f else 0.45f
        thumbnailStrip.removeAllViews()
        capturedFiles.forEach { file ->
            thumbnailStrip.addView(ImageView(this).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                setImageURI(fileUri(file))
                contentDescription = "查看已拍照片"
                background = rounded(Color.WHITE, 7f)
                clipToOutline = true
                setOnClickListener { showMultipleReview(file) }
            }, LinearLayout.LayoutParams(dp(62), dp(62)).apply { marginEnd = dp(8) })
        }
        thumbnailScroll.post { thumbnailScroll.fullScroll(View.FOCUS_RIGHT) }
    }

    private fun submitSingle() {
        val file = reviewFile ?: return
        submit(listOf(file))
    }

    private fun submitMultiple() {
        if (capturedFiles.isEmpty()) return
        submit(capturedFiles.toList())
    }

    private fun submit(files: List<File>) {
        val uris = files.map(::fileUri)
        val result = Intent()
            .putStringArrayListExtra(EXTRA_URIS, ArrayList(uris.map { it.toString() }))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (uris.size == 1) result.putExtra(EXTRA_URI, uris.single().toString())
        result.clipData = ClipData.newUri(contentResolver, "photos", uris.first()).also { clip ->
            uris.drop(1).forEach { clip.addItem(ClipData.Item(it)) }
        }
        submitted = true
        setResult(Activity.RESULT_OK, result)
        finish()
    }

    private fun cancelAndFinish() {
        setResult(Activity.RESULT_CANCELED)
        finish()
    }

    private fun showPermissionError() = showCameraError("未获得相机权限，无法拍照")

    private fun showCameraError(message: String) {
        TextView(this).apply {
            text = message
            textSize = 16f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setBackgroundColor(0xCC7F1D1D.toInt())
            setPadding(dp(18), dp(10), dp(18), dp(10))
            root.addView(this, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
            postDelayed({ (parent as? ViewGroup)?.removeView(this) }, 2500)
        }
    }

    private fun iconButton(icon: Int, description: String, onClick: () -> Unit) = ImageButton(this).apply {
        setImageResource(icon)
        contentDescription = description
        setColorFilter(Color.WHITE)
        setPadding(dp(13), dp(13), dp(13), dp(13))
        background = rounded(0x66000000, 26f)
        setOnClickListener { onClick() }
    }

    private fun actionText(
        label: String,
        primary: Boolean = false,
        danger: Boolean = false,
        onClick: () -> Unit
    ) = TextView(this).apply {
        text = label
        textSize = 16f
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        setTextColor(Color.WHITE)
        background = rounded(when {
            danger -> 0xFFB42318.toInt()
            primary -> 0xFF2468D8.toInt()
            else -> 0x66475569
        }, 24f)
        setOnClickListener { if (isEnabled) onClick() }
        alpha = if (isEnabled) 1f else 0.45f
        setOnFocusChangeListener { _, _ -> alpha = if (isEnabled) 1f else 0.45f }
    }

    private fun fileUri(file: File) = FileProvider.getUriForFile(this, "$packageName.files", file)
    private fun fullFrame() = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    private fun rounded(color: Int, radiusDp: Float) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radiusDp.toInt()).toFloat()
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) WindowInsetsControllerCompat(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    override fun onDestroy() {
        if (isFinishing && !submitted) capturedFiles.forEach(File::delete)
        super.onDestroy()
    }

    companion object {
        const val EXTRA_URI = "photo_uri"
        const val EXTRA_URIS = "photo_uris"
        const val EXTRA_MULTIPLE = "multiple"
    }
}
