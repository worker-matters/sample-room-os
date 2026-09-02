package com.sampleroom.mobile.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@Composable
@androidx.annotation.OptIn(markerClass = [ExperimentalGetImage::class])
fun QrCamera(modifier: Modifier = Modifier, onPayload: (String) -> Unit, onError: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient() }
    val delivered = remember { AtomicBoolean(false) }
    val cameraProviderFuture = remember { ProcessCameraProvider.getInstance(context) }
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        granted = it
        if (!it) onError("未获得相机权限，仍可从相册选择二维码图片。")
    }
    val galleryLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            delivered.set(false)
            runCatching { InputImage.fromFilePath(context, uri) }
                .onSuccess { image ->
                    scanner.process(image)
                        .addOnSuccessListener { barcodes ->
                            val raw = barcodes.firstNotNullOfOrNull { it.rawValue }
                            if (raw != null && delivered.compareAndSet(false, true)) onPayload(raw)
                            else if (raw == null) onError("所选图片中没有识别到二维码")
                        }
                        .addOnFailureListener { onError(it.message ?: "二维码识别失败") }
                }
                .onFailure { onError(it.message ?: "无法读取所选图片") }
        }
    }

    LaunchedEffect(Unit) {
        if (!granted) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    Box(modifier) {
        if (granted) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { currentContext ->
                    val previewView = PreviewView(currentContext).apply {
                        scaleType = PreviewView.ScaleType.FILL_CENTER
                    }
                    cameraProviderFuture.addListener({
                        val provider = cameraProviderFuture.get()
                        val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
                        val analysis = ImageAnalysis.Builder()
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()
                        analysis.setAnalyzer(executor) { imageProxy ->
                            val mediaImage = imageProxy.image
                            if (mediaImage == null || delivered.get()) {
                                imageProxy.close()
                                return@setAnalyzer
                            }
                            val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                            scanner.process(image)
                                .addOnSuccessListener { barcodes ->
                                    val raw = barcodes.firstNotNullOfOrNull { it.rawValue }
                                    if (raw != null && delivered.compareAndSet(false, true)) onPayload(raw)
                                }
                                .addOnFailureListener { onError(it.message ?: "二维码识别失败") }
                                .addOnCompleteListener { imageProxy.close() }
                        }
                        runCatching {
                            provider.unbindAll()
                            provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                        }.onFailure { onError(it.message ?: "相机启动失败") }
                    }, ContextCompat.getMainExecutor(currentContext))
                    previewView
                }
            )
        } else {
            Text("请允许相机权限，或使用右下角相册按钮", modifier = Modifier.align(Alignment.Center))
        }
        FilledIconButton(
            onClick = { galleryLauncher.launch("image/*") },
            modifier = Modifier.align(Alignment.BottomEnd).padding(18.dp)
        ) {
            Icon(Icons.Default.PhotoLibrary, "从相册选择二维码")
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            runCatching { cameraProviderFuture.get().unbindAll() }
            scanner.close()
            executor.shutdown()
        }
    }
}
