package com.sampleroom.mobile

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.exifinterface.media.ExifInterface
import com.sampleroom.mobile.data.QcRecordDetail
import com.sampleroom.mobile.data.QcRecordPhoto
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlin.math.min

enum class QcPhotoExportFormat { IMAGE, PDF }

/**
 * 仅在员工明确点击“导出报告”后生成文件。服务端原图先在内存中读取，
 * 不会作为单张照片写入相册；最终只保存用户选择的合并长图或 PDF。
 * 合并长图进入系统相册，PDF 进入公开下载目录。
 */
internal object QcPhotoExporter {
    private const val CELL_WIDTH = 720
    private const val CELL_HEIGHT = 960

    suspend fun export(
        context: Context,
        detail: QcRecordDetail,
        format: QcPhotoExportFormat,
        photoData: List<Pair<QcRecordPhoto, ByteArray>>
    ): String = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        require(photoData.isNotEmpty()) { "当前记录没有可导出的照片" }
        val stamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss"))
        val baseName = sanitizeFileName(
            listOf(detail.record.styleNo, detail.record.styleName, stamp)
                .filter(String::isNotBlank)
                .joinToString("_")
        )
        val fileName = when (format) {
            QcPhotoExportFormat.IMAGE -> "$baseName.png"
            QcPhotoExportFormat.PDF -> "$baseName.pdf"
        }
        val mimeType = if (format == QcPhotoExportFormat.IMAGE) "image/png" else "application/pdf"
        val target = openExportOutput(context, fileName, mimeType, format)
        try {
            target.output.use { output ->
                when (format) {
                    QcPhotoExportFormat.IMAGE -> renderCombinedImage(detail, photoData, output)
                    QcPhotoExportFormat.PDF -> renderPdf(detail, photoData, output)
                }
            }
        } catch (error: Throwable) {
            target.pendingUri?.let { context.contentResolver.delete(it, null, null) }
            throw error
        }
        target.pendingUri?.let { uri ->
            context.contentResolver.update(
                uri,
                ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) },
                null,
                null
            )
        }
        target.legacyGalleryFile?.let { file ->
            MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf(mimeType), null)
        }
        fileName
    }

    private fun renderCombinedImage(
        detail: QcRecordDetail,
        photoData: List<Pair<QcRecordPhoto, ByteArray>>,
        output: OutputStream
    ) {
        val bitmap = Bitmap.createBitmap(CELL_WIDTH, CELL_HEIGHT * photoData.size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap).apply { drawColor(Color.rgb(242, 245, 249)) }
        photoData.forEachIndexed { index, (photo, bytes) ->
            val top = index * CELL_HEIGHT
            drawExportCard(canvas, detail, photo, bytes, 0f, top.toFloat(), index + 1, photoData.size)
        }
        check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) { "合并图片生成失败" }
        bitmap.recycle()
    }

    private fun renderPdf(
        detail: QcRecordDetail,
        photoData: List<Pair<QcRecordPhoto, ByteArray>>,
        output: OutputStream
    ) {
        val document = PdfDocument()
        try {
            photoData.forEachIndexed { index, (photo, bytes) ->
                val page = document.startPage(
                    PdfDocument.PageInfo.Builder(595, 842, index + 1).create()
                )
                drawExportCard(
                    page.canvas,
                    detail,
                    photo,
                    bytes,
                    0f,
                    0f,
                    index + 1,
                    photoData.size,
                    595,
                    842
                )
                document.finishPage(page)
            }
            document.writeTo(output)
        } finally {
            document.close()
        }
    }

    private fun drawExportCard(
        canvas: Canvas,
        detail: QcRecordDetail,
        photo: QcRecordPhoto,
        bytes: ByteArray,
        left: Float,
        top: Float,
        pageNo: Int,
        total: Int,
        width: Int = CELL_WIDTH,
        height: Int = CELL_HEIGHT
    ) {
        val scale = width / CELL_WIDTH.toFloat()
        val padding = 24f * scale
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL) }
        paint.color = Color.WHITE
        canvas.drawRect(left + 8f * scale, top + 8f * scale, left + width - 8f * scale, top + height - 8f * scale, paint)

        paint.color = Color.rgb(20, 35, 58)
        paint.textAlign = Paint.Align.CENTER
        paint.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        paint.textSize = 26f * scale
        val title = listOf(detail.record.styleNo, detail.record.styleName, sampleTypeLabel(detail.record.sampleType))
            .filter(String::isNotBlank).joinToString("  ")
        canvas.drawText(title, left + width / 2f, top + 54f * scale, paint)

        paint.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
        paint.textSize = 15f * scale
        paint.color = Color.rgb(71, 85, 105)
        canvas.drawText("导出时间：${LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))}", left + width / 2f, top + 82f * scale, paint)
        paint.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        paint.textSize = 20f * scale
        paint.color = Color.rgb(15, 23, 42)
        canvas.drawText(photoCategoryLabel(photo.category), left + width / 2f, top + 116f * scale, paint)

        val imageTop = top + 140f * scale
        val imageBottom = top + height - 105f * scale
        val imageRect = RectF(left + padding, imageTop, left + width - padding, imageBottom)
        paint.color = Color.rgb(245, 247, 250)
        canvas.drawRect(imageRect, paint)
        decodeBitmap(bytes, imageRect.width().toInt(), imageRect.height().toInt())?.let { source ->
            val ratio = min(imageRect.width() / source.width, imageRect.height() / source.height)
            val drawWidth = source.width * ratio
            val drawHeight = source.height * ratio
            val target = RectF(
                imageRect.centerX() - drawWidth / 2f,
                imageRect.centerY() - drawHeight / 2f,
                imageRect.centerX() + drawWidth / 2f,
                imageRect.centerY() + drawHeight / 2f
            )
            canvas.drawBitmap(source, null, target, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
            source.recycle()
        }

        paint.textAlign = Paint.Align.CENTER
        paint.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
        paint.textSize = 15f * scale
        paint.color = Color.rgb(30, 41, 59)
        canvas.drawText(photo.fileName.take(48), left + width / 2f, top + height - 62f * scale, paint)
        paint.textSize = 14f * scale
        canvas.drawText("第 $pageNo 页 / 共 $total 页", left + width / 2f, top + height - 30f * scale, paint)
    }

    private fun decodeBitmap(bytes: ByteArray, targetWidth: Int, targetHeight: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (bounds.outWidth / sample > targetWidth * 2 || bounds.outHeight / sample > targetHeight * 2) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(
            bytes,
            0,
            bytes.size,
            BitmapFactory.Options().apply { inSampleSize = sample.coerceAtLeast(1) }
        ) ?: return null
        val orientation = runCatching {
            ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            )
        }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
        val matrix = Matrix().apply {
            when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
                ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
                ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(270f)
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> postScale(-1f, 1f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> postScale(1f, -1f)
            }
        }
        if (matrix.isIdentity) return decoded
        return Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true).also {
            if (it !== decoded) decoded.recycle()
        }
    }

    private data class ExportOutput(
        val output: OutputStream,
        val pendingUri: Uri? = null,
        val legacyGalleryFile: File? = null
    )

    private fun openExportOutput(
        context: Context,
        fileName: String,
        mimeType: String,
        format: QcPhotoExportFormat
    ): ExportOutput {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val relativePath = if (format == QcPhotoExportFormat.IMAGE) {
                "${Environment.DIRECTORY_PICTURES}/样品间"
            } else {
                "${Environment.DIRECTORY_DOWNLOADS}/样品间"
            }
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val collection = if (format == QcPhotoExportFormat.IMAGE) {
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI
            } else {
                MediaStore.Downloads.EXTERNAL_CONTENT_URI
            }
            val uri = context.contentResolver.insert(collection, values) ?: error("无法创建导出文件")
            val output = context.contentResolver.openOutputStream(uri) ?: run {
                context.contentResolver.delete(uri, null, null)
                error("无法写入导出文件")
            }
            return ExportOutput(
                output = output,
                pendingUri = uri
            )
        }
        @Suppress("DEPRECATION")
        val publicDirectory = if (format == QcPhotoExportFormat.IMAGE) {
            Environment.DIRECTORY_PICTURES
        } else {
            Environment.DIRECTORY_DOWNLOADS
        }
        @Suppress("DEPRECATION")
        val directory = File(Environment.getExternalStoragePublicDirectory(publicDirectory), "样品间").apply { mkdirs() }
        val file = File(directory, fileName)
        return ExportOutput(
            output = FileOutputStream(file),
            legacyGalleryFile = file.takeIf { format == QcPhotoExportFormat.IMAGE }
        )
    }

    private fun sanitizeFileName(value: String) = value
        .replace(Regex("[\\\\/:*?\"<>|]"), "_")
        .replace(Regex("\\s+"), "_")
        .trim('_')
        .take(96)
        .ifBlank { "QC照片" }

    private fun sampleTypeLabel(value: String) = when (value) {
        "initial", "first_sample" -> "初样"
        "repeat", "fit_sample" -> "试身样"
        "revision_sample" -> "修改样"
        "pre_production_sample" -> "产前样"
        "sales_sample" -> "销售样"
        else -> value
    }

    private fun photoCategoryLabel(value: String) = when (value) {
        "qc_measurement_photo" -> "尺寸表照片"
        "qc_issue_photo" -> "问题照片"
        else -> "样衣照片"
    }
}
