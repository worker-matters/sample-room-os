package com.sampleroom.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sampleroom.mobile.AppState
import com.sampleroom.mobile.AppViewModel

internal fun forcePasswordValidationError(
    currentPassword: String,
    newPassword: String,
    confirmPassword: String
): String? = when {
    currentPassword.isBlank() -> "请输入当前密码 / 临时密码"
    newPassword.length < 8 -> "新密码至少 8 位"
    confirmPassword.isBlank() -> "请再次输入新密码"
    newPassword != confirmPassword -> "两次输入的新密码不一致"
    else -> null
}

@Composable
fun ForcePasswordChangePage(
    state: AppState,
    viewModel: AppViewModel
) {
    var currentPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf<String?>(null) }

    Scaffold(containerColor = Color(0xFFF2F6FC)) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(Color(0xFFF2F6FC)),
            contentAlignment = Alignment.Center
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .widthIn(max = 520.dp),
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = Color.White),
                    elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(24.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Text(
                            text = "请先修改密码",
                            fontSize = 24.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF123B6D)
                        )
                        Text(
                            text = "你的密码已被管理员重置。请使用刚刚登录的临时密码设置自己的新密码；修改完成后需要重新登录。",
                            color = Color(0xFF5F7188),
                            fontSize = 14.sp
                        )

                        OutlinedTextField(
                            value = currentPassword,
                            onValueChange = {
                                currentPassword = it
                                localError = null
                            },
                            label = { Text("当前密码 / 临时密码") },
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                                keyboardType = KeyboardType.Password
                            ),
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                        OutlinedTextField(
                            value = newPassword,
                            onValueChange = {
                                newPassword = it
                                localError = null
                            },
                            label = { Text("新密码") },
                            supportingText = { Text("至少 8 位") },
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                                keyboardType = KeyboardType.Password
                            ),
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                        OutlinedTextField(
                            value = confirmPassword,
                            onValueChange = {
                                confirmPassword = it
                                localError = null
                            },
                            label = { Text("确认新密码") },
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                                keyboardType = KeyboardType.Password
                            ),
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )

                        (localError ?: state.error)?.let { message ->
                            Text(
                                text = message,
                                color = MaterialTheme.colorScheme.error,
                                fontSize = 13.sp
                            )
                        }

                        Button(
                            onClick = {
                                val validation = forcePasswordValidationError(
                                    currentPassword,
                                    newPassword,
                                    confirmPassword
                                )
                                if (validation != null) {
                                    localError = validation
                                } else {
                                    viewModel.savePassword(
                                        currentPassword,
                                        newPassword,
                                        confirmPassword
                                    )
                                }
                            },
                            enabled = !state.loading,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(if (state.loading) "正在修改…" else "修改密码并重新登录")
                        }
                        OutlinedButton(
                            onClick = viewModel::logout,
                            enabled = !state.loading,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("退出登录")
                        }
                        Text(
                            text = "为保护账号安全，完成改密前无法进入订单、扫码和绩效等业务页面。",
                            color = Color(0xFF6B7F99),
                            fontSize = 12.sp
                        )
                    }
                }
            }
        }
    }
}
