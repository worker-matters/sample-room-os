package com.sampleroom.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BiometricQuickLoginPage(
    accountLabel: String?,
    busy: Boolean,
    message: String?,
    onBiometricLogin: () -> Unit,
    onPasswordLogin: () -> Unit
) {
    var optionsVisible by remember { mutableStateOf(false) }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    listOf(Color(0xFFF7FAFF), Color(0xFFE7F0FC), Color(0xFFDCE9F9))
                )
            )
    ) {
        val compact = maxHeight < 720.dp
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    horizontal = if (compact) 16.dp else 20.dp,
                    vertical = if (compact) 18.dp else 28.dp
                ),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "◇",
                color = Teal,
                fontSize = if (compact) 40.sp else 54.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "样品间管理系统",
                color = Navy,
                fontSize = if (compact) 22.sp else 26.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Android 手机端",
                color = Muted,
                fontSize = 14.sp,
                modifier = Modifier.padding(top = 4.dp)
            )

            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFDFEFF)),
                shape = RoundedCornerShape(if (compact) 20.dp else 26.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 10.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = 480.dp)
                    .padding(top = if (compact) 18.dp else 26.dp)
            ) {
                Column(
                    modifier = Modifier.padding(
                        horizontal = if (compact) 20.dp else 28.dp,
                        vertical = if (compact) 22.dp else 30.dp
                    ),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Surface(
                        shape = CircleShape,
                        color = Color(0xFFEAF2FF),
                        modifier = Modifier.size(if (compact) 78.dp else 92.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Fingerprint,
                            contentDescription = null,
                            tint = Teal,
                            modifier = Modifier.padding(if (compact) 16.dp else 19.dp)
                        )
                    }
                    Text(
                        text = "欢迎回来",
                        color = Navy,
                        fontSize = if (compact) 22.sp else 25.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(top = 18.dp)
                    )
                    if (!accountLabel.isNullOrBlank()) {
                        Text(
                            text = accountLabel,
                            color = Muted,
                            fontSize = 14.sp,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                    }
                    Text(
                        text = "使用本机已录入的指纹或安全面容验证身份",
                        color = Muted,
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 10.dp)
                    )

                    if (!message.isNullOrBlank()) {
                        Text(
                            text = message,
                            color = MaterialTheme.colorScheme.error,
                            fontSize = 13.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 14.dp)
                        )
                    }

                    Button(
                        onClick = onBiometricLogin,
                        enabled = !busy,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = if (message.isNullOrBlank()) 22.dp else 16.dp)
                            .height(if (compact) 50.dp else 54.dp)
                    ) {
                        if (busy) {
                            CircularProgressIndicator(
                                color = MaterialTheme.colorScheme.onPrimary,
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(20.dp)
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Default.Fingerprint,
                                contentDescription = null,
                                modifier = Modifier.size(21.dp)
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = if (busy) "正在恢复登录…" else "指纹 / 面容登录",
                            fontSize = 17.sp
                        )
                    }

                    TextButton(
                        onClick = { optionsVisible = true },
                        enabled = !busy,
                        modifier = Modifier.padding(top = 8.dp)
                    ) {
                        Text("更多选项", fontSize = 15.sp)
                    }
                }
            }
        }
    }

    if (optionsVisible) {
        ModalBottomSheet(onDismissRequest = { optionsVisible = false }) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp)
            ) {
                Text(
                    text = "更多选项",
                    color = Navy,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 10.dp)
                )
                TextButton(
                    onClick = {
                        optionsVisible = false
                        onPasswordLogin()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(54.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.LockOpen,
                        contentDescription = null,
                        modifier = Modifier.size(22.dp)
                    )
                    Spacer(Modifier.width(10.dp))
                    Text("密码登录", fontSize = 17.sp)
                }
                HorizontalDivider()
                TextButton(
                    onClick = { optionsVisible = false },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(54.dp)
                ) {
                    Text("取消", fontSize = 17.sp)
                }
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}
