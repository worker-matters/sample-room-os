package com.sampleroom.tablet

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.hardware.camera2.CaptureRequest
import android.os.Bundle
import android.view.Gravity
import android.view.ScaleGestureDetector
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.sampleroom.tablet.network.NetworkConfigParser
import com.sampleroom.tablet.security.TabletBridgePolicy
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class QrScannerActivity : ComponentActivity() {
    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private val delivered = AtomicBoolean(false)
    private val scanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    )
    private lateinit var previewView: PreviewView
    private lateinit var status: TextView
    private lateinit var torchButton: Button
    private var camera: Camera? = null
    private var torchOn = false

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) bindCamera()
        else {
            status.text = "未获得相机权限，仍可从右下角相册选择二维码图片。"
            torchButton.isEnabled = false
        }
    }

    private val galleryLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri == null || delivered.get()) return@registerForActivityResult
        runCatching { InputImage.fromFilePath(this, uri) }
            .onSuccess { image ->
                scanner.process(image)
                    .addOnSuccessListener { barcodes ->
                        val payload = barcodes.firstNotNullOfOrNull {
                            it.rawValue?.trim()?.takeIf(String::isNotEmpty)
                        }
                        if (payload == null) {
                            status.text = "所选图片中没有识别到二维码，请重新选择或继续相机扫描"
                        } else {
                            handlePayload(payload)
                        }
                    }
                    .addOnFailureListener {
                        status.text = "二维码图片识别失败，请重新选择或继续相机扫描"
                    }
            }
            .onFailure {
                status.text = "无法读取所选图片，请重新选择"
            }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            bindCamera()
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun buildUi() {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        previewView = PreviewView(this).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        val zoomDetector = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                val activeCamera = camera ?: return false
                val zoomState = activeCamera.cameraInfo.zoomState.value ?: return false
                val nextRatio = (zoomState.zoomRatio * detector.scaleFactor)
                    .coerceIn(zoomState.minZoomRatio, zoomState.maxZoomRatio)
                activeCamera.cameraControl.setZoomRatio(nextRatio)
                return true
            }
        })
        previewView.setOnTouchListener { _, event -> zoomDetector.onTouchEvent(event) }
        root.addView(previewView, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))

        status = TextView(this).apply {
            text = if (mode() == MODE_NETWORK) "请扫描网络配置二维码" else "请扫描订单二维码"
            setTextColor(Color.WHITE)
            textSize = 18f
            gravity = Gravity.CENTER
            setBackgroundColor(0x990F172A.toInt())
            setPadding(dp(180), dp(15), dp(180), dp(15))
        }
        root.addView(status, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP
        ))

        val exit = Button(this).apply {
            text = "× 退出"
            textSize = 17f
            setTextColor(Color.WHITE)
            setBackgroundColor(0xCCB42318.toInt())
            setOnClickListener { finish() }
        }
        root.addView(exit, FrameLayout.LayoutParams(dp(132), dp(56), Gravity.TOP or Gravity.END).apply {
            setMargins(0, dp(10), dp(16), 0)
        })

        torchButton = Button(this).apply {
            text = "打开补光灯"
            textSize = 16f
            setTextColor(Color.WHITE)
            setBackgroundColor(0xCC0F172A.toInt())
            setOnClickListener { toggleTorch() }
        }
        root.addView(torchButton, FrameLayout.LayoutParams(dp(160), dp(56), Gravity.BOTTOM or Gravity.START).apply {
            setMargins(dp(20), 0, 0, dp(20))
        })

        val galleryButton = Button(this).apply {
            text = "相册"
            textSize = 16f
            setTextColor(Color.WHITE)
            setBackgroundColor(0xCC0F172A.toInt())
            setCompoundDrawablesWithIntrinsicBounds(android.R.drawable.ic_menu_gallery, 0, 0, 0)
            compoundDrawableTintList = ColorStateList.valueOf(Color.WHITE)
            compoundDrawablePadding = dp(8)
            contentDescription = "从相册选择二维码图片"
            setOnClickListener { galleryLauncher.launch("image/*") }
        }
        root.addView(galleryButton, FrameLayout.LayoutParams(dp(132), dp(56), Gravity.BOTTOM or Gravity.END).apply {
            setMargins(0, 0, dp(20), dp(20))
        })

        root.addView(TextView(this).apply {
            text = "双指缩放 · 自动对焦"
            textSize = 15f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setBackgroundColor(0x880F172A.toInt())
            setPadding(dp(18), dp(10), dp(18), dp(10))
        }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
            setMargins(0, 0, 0, dp(28))
        })
        setContentView(root)
    }

    @OptIn(markerClass = [ExperimentalCamera2Interop::class, ExperimentalGetImage::class])
    private fun bindCamera() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            val provider = providerFuture.get()
            val previewBuilder = Preview.Builder()
            Camera2Interop.Extender(previewBuilder).setCaptureRequestOption(
                CaptureRequest.CONTROL_AF_MODE,
                CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
            )
            val preview = previewBuilder.build().also { it.surfaceProvider = previewView.surfaceProvider }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            analysis.setAnalyzer(cameraExecutor) { imageProxy ->
                val mediaImage = imageProxy.image
                if (mediaImage == null || delivered.get()) {
                    imageProxy.close()
                    return@setAnalyzer
                }
                val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                scanner.process(image)
                    .addOnSuccessListener { barcodes ->
                        barcodes.firstNotNullOfOrNull { it.rawValue?.trim()?.takeIf(String::isNotEmpty) }
                            ?.let(::handlePayload)
                    }
                    .addOnCompleteListener { imageProxy.close() }
            }
            provider.unbindAll()
            camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            torchButton.isEnabled = camera?.cameraInfo?.hasFlashUnit() == true
        }, ContextCompat.getMainExecutor(this))
    }

    private fun toggleTorch() {
        val activeCamera = camera ?: return
        if (!activeCamera.cameraInfo.hasFlashUnit()) return
        torchOn = !torchOn
        activeCamera.cameraControl.enableTorch(torchOn)
        torchButton.text = if (torchOn) "关闭补光灯" else "打开补光灯"
    }

    private fun handlePayload(payload: String) {
        val valid = if (mode() == MODE_NETWORK) {
            payload.startsWith(NetworkConfigParser.PREFIX)
        } else {
            TabletBridgePolicy.isOrderQrPayload(payload)
        }
        if (!valid) {
            runOnUiThread {
                status.text = if (mode() == MODE_NETWORK) {
                    "这不是样品间网络配置二维码，请重新扫描"
                } else {
                    "这不是样品间订单二维码，请重新扫描"
                }
            }
            return
        }
        if (!delivered.compareAndSet(false, true)) return
        setResult(
            Activity.RESULT_OK,
            Intent().putExtra(EXTRA_PAYLOAD, payload).putExtra(EXTRA_MODE, mode())
        )
        finish()
    }

    private fun mode(): String = intent.getStringExtra(EXTRA_MODE) ?: MODE_ORDER

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        scanner.close()
        cameraExecutor.shutdown()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_MODE = "scanner_mode"
        const val EXTRA_PAYLOAD = "scanner_payload"
        const val MODE_NETWORK = "network"
        const val MODE_ORDER = "order"
    }
}
