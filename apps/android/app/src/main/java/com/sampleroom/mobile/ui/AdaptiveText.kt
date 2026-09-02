package com.sampleroom.mobile.ui

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/**
 * Keeps business identifiers on one line and reduces their font only when the
 * available card width cannot contain the complete value.
 */
@Composable
internal fun AutoFitSingleLineText(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    maxFontSize: TextUnit = 18.sp,
    minFontSize: TextUnit = 8.sp,
    fontWeight: FontWeight? = null
) {
    BoxWithConstraints(modifier) {
        var currentFontSize by remember(text, maxWidth, maxFontSize, minFontSize) {
            mutableStateOf(maxFontSize)
        }
        Text(
            text = text,
            color = color,
            fontSize = currentFontSize,
            fontWeight = fontWeight,
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Clip,
            modifier = Modifier.fillMaxWidth(),
            onTextLayout = { result ->
                if (result.didOverflowWidth && currentFontSize > minFontSize) {
                    currentFontSize = (currentFontSize.value - 1f)
                        .coerceAtLeast(minFontSize.value)
                        .sp
                }
            }
        )
    }
}

/**
 * Keeps style identifiers complete while giving compact cards a predictable
 * two-line budget before allowing the font to shrink.
 */
@Composable
internal fun AdaptiveWrappedText(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    maxFontSize: TextUnit = 18.sp,
    minFontSize: TextUnit = 8.sp,
    maxLines: Int = 2,
    fontWeight: FontWeight? = null
) {
    BoxWithConstraints(modifier) {
        var currentFontSize by remember(text, maxWidth, maxFontSize, minFontSize, maxLines) {
            mutableStateOf(maxFontSize)
        }
        Text(
            text = text,
            color = color,
            fontSize = currentFontSize,
            fontWeight = fontWeight,
            maxLines = maxLines,
            softWrap = true,
            overflow = TextOverflow.Clip,
            modifier = Modifier.fillMaxWidth(),
            onTextLayout = { result ->
                if (result.hasVisualOverflow && currentFontSize > minFontSize) {
                    currentFontSize = (currentFontSize.value - 1f)
                        .coerceAtLeast(minFontSize.value)
                        .sp
                }
            }
        )
    }
}

@Composable
internal fun CompactStyleIdentity(
    styleNo: String,
    styleName: String,
    modifier: Modifier = Modifier,
    maxFontSize: TextUnit = 18.sp,
    minFontSize: TextUnit = 8.sp,
    showLabels: Boolean = true,
    maxLinesEach: Int = 2
) {
    androidx.compose.foundation.layout.Column(modifier) {
        if (showLabels) Text("款号", color = Color(0xFF71839B), fontSize = 12.sp)
        AdaptiveWrappedText(
            text = styleNo.ifBlank { "未录入款号" },
            maxFontSize = maxFontSize,
            minFontSize = minFontSize,
            maxLines = maxLinesEach,
            fontWeight = FontWeight.SemiBold
        )
        if (showLabels) Text("款名", color = Color(0xFF71839B), fontSize = 12.sp)
        AdaptiveWrappedText(
            text = styleName.ifBlank { "-" },
            maxFontSize = maxFontSize,
            minFontSize = minFontSize,
            maxLines = maxLinesEach,
            fontWeight = FontWeight.SemiBold
        )
    }
}
