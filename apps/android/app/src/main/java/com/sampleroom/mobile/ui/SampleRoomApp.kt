package com.sampleroom.mobile.ui

import android.Manifest
import android.app.Activity
import android.app.DownloadManager
import android.app.DatePickerDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.provider.OpenableColumns
import android.os.Environment
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.BackHandler
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Assignment
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.PersonOutline
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sampleroom.mobile.AppScreen
import com.sampleroom.mobile.AppState
import com.sampleroom.mobile.AppViewModel
import com.sampleroom.mobile.AttachmentPreviewActivity
import com.sampleroom.mobile.PhotoCaptureActivity
import com.sampleroom.mobile.shouldNavigateBackWithinApp
import com.sampleroom.mobile.update.AppReleaseInfo
import com.sampleroom.mobile.data.ApiMode
import com.sampleroom.mobile.data.MobileAttachment
import com.sampleroom.mobile.data.MobileOrder
import com.sampleroom.mobile.data.ReceiverCharge
import com.sampleroom.mobile.data.ScanResult
import com.sampleroom.mobile.data.QcReworkPhoto
import com.sampleroom.mobile.data.UploadPayload
import com.sampleroom.mobile.data.WorkerScanCompletion
import com.sampleroom.mobile.data.renameMaterialRecordUpload
import com.sampleroom.mobile.data.splitMaterialRecordFileName
import com.sampleroom.mobile.data.validateMaterialRecordFileName
import coil.compose.AsyncImage
import coil.request.ImageRequest
import kotlinx.coroutines.delay
import okhttp3.Headers
import java.io.ByteArrayOutputStream
import java.io.File

@Composable
fun SampleRoomApp(
    viewModel: AppViewModel,
    onInstallRequiredUpdate: (AppReleaseInfo) -> Unit
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    BackHandler {
        if (state.screen.shouldNavigateBackWithinApp()) {
            viewModel.back()
        }
    }
    when (val screen = state.screen) {
        AppScreen.Boot -> LoadingPage("正在恢复登录…")
        AppScreen.Login -> LoginPage(
            state,
            viewModel::login,
            viewModel::clearLoginHistory,
            viewModel::openNetworkSettings
        )
        AppScreen.ForcePasswordChange -> ForcePasswordChangePage(state, viewModel)
        AppScreen.NetworkSettings -> NetworkSettingsPage(state, viewModel)
        AppScreen.NetworkScanner -> NetworkScannerPage(state, viewModel)
        AppScreen.ReceiverHome -> ReceiverHomePage(state, viewModel)
        AppScreen.ReceiverIntake -> ReceiverIntakePage(state, viewModel)
        AppScreen.ReceiverScanCharge -> ReceiverScanChargePage(state, viewModel)
        AppScreen.PlannerHome -> PlannerHomePage(state, viewModel)
        AppScreen.PlannerProductionPlan -> OrdersPage(state, "planner", viewModel, productionPlanOnly = true)
        AppScreen.PlannerSewingWaiting -> PlannerSewingQueuePage(state, viewModel, waiting = true)
        AppScreen.PlannerSewingDoing -> PlannerSewingQueuePage(state, viewModel, waiting = false)
        AppScreen.PlannerScanCharge -> PlannerScanChargePage(state, viewModel)
        is AppScreen.PlannerOrderCharge -> PlannerOrderChargePage(state, screen.order, viewModel)
        is AppScreen.Orders -> OrdersPage(state, screen.kind, viewModel)
        is AppScreen.OrderDetail -> OrderDetailPage(state, screen.order, screen.kind, screen.initialTab, viewModel)
        AppScreen.WorkerHome -> WorkerHomePage(state, viewModel)
        AppScreen.BossHome -> BossHomePage(state, viewModel)
        AppScreen.BossPending -> BossPendingPage(state, viewModel)
        AppScreen.BossStatements -> BossStatementsPage(state, viewModel)
        is AppScreen.BossPricing -> BossPricingPage(state, screen.orderId, viewModel)
        is AppScreen.StatementDetail -> StatementDetailPage(state, viewModel)
        AppScreen.WorkerPerformancePage -> WorkerPerformancePage(state, viewModel)
        is AppScreen.WorkerQcRecordDetail -> QcRecordDetailPage(state, viewModel)
        AppScreen.AccountSecurity -> AccountSecurityPage(state, viewModel)
        AppScreen.WorkerScan -> ScanPage(state, viewModel)
        AppScreen.WorkerSewingTasks -> WorkerSewingQueuePage(state, viewModel)
        AppScreen.WorkerQcRework -> WorkerQcReworkQueuePage(state, viewModel)
        is AppScreen.ScanResultPage -> ScanResultPage(state, screen.result, viewModel)
        is AppScreen.Placeholder -> PlaceholderPage(state, screen.title, screen.message, viewModel::logout)
    }

    state.requiredAppUpdate?.let { release ->
        ForcedAppUpdateDialog(
            release = release,
            busy = state.appUpdateBusy,
            progress = state.appUpdateProgress,
            error = state.appUpdateError,
            waitingInstallPermission = state.waitingInstallPermission,
            onInstall = { onInstallRequiredUpdate(release) }
        )
    }

    if (state.cuttingTaskCancelledVisible) {
        LaunchedEffect(Unit) {
            delay(1_000)
            viewModel.finishCuttingTaskCancelled()
        }
        Dialog(onDismissRequest = viewModel::finishCuttingTaskCancelled) {
            Card(
                modifier = Modifier.clickable(onClick = viewModel::finishCuttingTaskCancelled),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                elevation = CardDefaults.cardElevation(defaultElevation = 12.dp)
            ) {
                Text(
                    "裁剪任务已取消",
                    color = Navy,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 36.dp, vertical = 24.dp)
                )
            }
        }
    }
}

@Composable
private fun ForcedAppUpdateDialog(
    release: AppReleaseInfo,
    busy: Boolean,
    progress: Int?,
    error: String?,
    waitingInstallPermission: Boolean,
    onInstall: () -> Unit
) {
    AlertDialog(
        onDismissRequest = {},
        title = { Text("发现新版本 V${release.versionName}", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("为确保 Sample Room System 正常使用，需要先完成更新。")
                release.releaseNotes?.let {
                    Text("更新说明：$it", color = Muted)
                }
                when {
                    busy -> {
                        CircularProgressIndicator(modifier = Modifier.size(28.dp))
                        Text("正在下载并校验更新… ${progress ?: 0}%")
                    }
                    waitingInstallPermission -> Text(
                        "请在系统设置中允许“安装未知应用”，返回后会自动继续安装。",
                        color = Navy
                    )
                    !error.isNullOrBlank() -> Text(error, color = Color(0xFFB42318))
                }
            }
        },
        confirmButton = {
            Button(
                enabled = !busy && !waitingInstallPermission,
                onClick = onInstall
            ) {
                Text(if (error.isNullOrBlank()) "立即更新" else "重新下载")
            }
        }
    )
}

@Composable
private fun LoginPage(
    state: AppState,
    onLogin: (String, String) -> Unit,
    onClearLoginHistory: () -> Unit,
    onNetworkSettings: () -> Unit
) {
    var loginId by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var historyExpanded by remember { mutableStateOf(false) }
    BoxWithConstraints(
        modifier = Modifier.fillMaxSize().background(
            Brush.linearGradient(
                listOf(Color(0xFFF7FAFF), Color(0xFFE7F0FC), Color(0xFFDCE9F9))
            )
        )
    ) {
        val compact = maxHeight < 720.dp
        val keyboardCompact = maxHeight < 560.dp
        Column(
            modifier = Modifier.fillMaxSize().padding(
                horizontal = if (compact) 16.dp else 20.dp,
                vertical = if (compact) 10.dp else 22.dp
            ),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (!keyboardCompact) {
                Text("◇", color = Teal, fontSize = if (compact) 38.sp else 52.sp, fontWeight = FontWeight.Bold)
                Text("样品管理 · 高效有序", color = Navy, fontSize = if (compact) 18.sp else 22.sp, fontWeight = FontWeight.Bold)
                if (!compact) {
                    Text("规范管理  |  快速查找  |  安全可控", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
                }
            }
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFFFDFEFF)),
                shape = RoundedCornerShape(if (compact) 18.dp else 24.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 10.dp),
                modifier = Modifier.fillMaxWidth().widthIn(max = 480.dp)
                    .padding(top = if (keyboardCompact) 0.dp else if (compact) 12.dp else 22.dp)
            ) {
                Column(Modifier.padding(horizontal = if (compact) 18.dp else 24.dp, vertical = if (compact) 16.dp else 24.dp)) {
                    Text(
                        "样品间管理系统",
                        color = Navy,
                        fontSize = if (keyboardCompact) 20.sp else if (compact) 22.sp else 26.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.align(Alignment.CenterHorizontally)
                    )
                    if (!keyboardCompact) {
                        Text(
                            "Android 手机端",
                            color = Muted,
                            fontSize = 14.sp,
                            modifier = Modifier.align(Alignment.CenterHorizontally)
                                .padding(top = 4.dp, bottom = if (compact) 12.dp else 20.dp)
                        )
                    }

                    Text("账号 / 手机号", color = Navy, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    BoxWithConstraints(Modifier.fillMaxWidth().padding(top = 5.dp)) {
                        OutlinedTextField(
                            value = loginId,
                            onValueChange = { loginId = it },
                            placeholder = { Text("请输入账号或手机号") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text, imeAction = ImeAction.Next),
                            singleLine = true,
                            shape = RoundedCornerShape(11.dp),
                            trailingIcon = {
                                IconButton(
                                    onClick = { historyExpanded = true },
                                    enabled = state.rememberedLoginIds.isNotEmpty()
                                ) { Icon(Icons.Default.KeyboardArrowDown, "历史登录账号") }
                            },
                            modifier = Modifier.fillMaxWidth()
                        )
                        DropdownMenu(
                            expanded = historyExpanded,
                            onDismissRequest = { historyExpanded = false },
                            modifier = Modifier.width(maxWidth)
                        ) {
                            state.rememberedLoginIds.forEach { remembered ->
                                DropdownMenuItem(
                                    text = { Text(remembered) },
                                    onClick = {
                                        loginId = remembered
                                        historyExpanded = false
                                    }
                                )
                            }
                            if (state.rememberedLoginIds.isNotEmpty()) {
                                HorizontalDivider()
                                DropdownMenuItem(
                                    text = { Text("清除记录", color = Color(0xFFB3261E)) },
                                    onClick = {
                                        onClearLoginHistory()
                                        historyExpanded = false
                                    }
                                )
                            }
                        }
                    }
                    Text("密码", color = Navy, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = if (compact) 10.dp else 14.dp))
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        placeholder = { Text("请输入密码") },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                        singleLine = true,
                        shape = RoundedCornerShape(11.dp),
                        modifier = Modifier.fillMaxWidth().padding(top = 5.dp)
                    )
                    ErrorText(state.error)
                    state.notice?.let { Text(it, color = MaterialTheme.colorScheme.primary, fontSize = 12.sp) }
                    Button(
                        onClick = { onLogin(loginId, password) },
                        enabled = !state.loading && loginId.isNotBlank() && password.isNotBlank(),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().padding(top = if (compact) 12.dp else 18.dp).height(if (compact) 48.dp else 54.dp)
                    ) { Text(if (state.loading) "正在连接…" else "登录", fontSize = 17.sp) }
                    OutlinedButton(
                        onClick = onNetworkSettings,
                        enabled = !state.loading,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().padding(top = 9.dp).height(if (compact) 46.dp else 50.dp)
                    ) {
                        Icon(Icons.Default.QrCodeScanner, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("扫码配置网络")
                    }
                    if (!keyboardCompact) {
                        Text(
                            if (state.lanBaseUrl.isBlank() && state.publicBaseUrl.isBlank())
                                "未配置服务器，请先扫描管理员提供的网络二维码。"
                            else "服务器已配置",
                            color = Muted,
                            fontSize = 12.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().padding(top = 10.dp)
                        )
                    }
                }
            }
            if (!compact && !keyboardCompact) {
                Text(
                    "计划员及裁剪、缝制、组检/出库员工均可直接登录",
                    color = Muted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(top = 12.dp)
                )
            }
        }
    }
}

@Composable
private fun NetworkSettingsPage(state: AppState, viewModel: AppViewModel) {
    Column(
        modifier = Modifier.fillMaxSize().background(PageBackground).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = viewModel::closeNetworkSettings) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
            }
            Text("网络设置", fontSize = 24.sp, fontWeight = FontWeight.Bold)
        }
        Notice("只接受 SRS2|NETWORK_CONFIG|1|... 网络配置二维码。扫码后会验证地址、系统标识和 API 版本，验证成功才保存。")
        SurfaceCard {
            Text("局域网服务器", fontWeight = FontWeight.SemiBold)
            Text(state.lanBaseUrl.ifBlank { "未配置" }, color = if (state.lanBaseUrl.isBlank()) Muted else Color.Unspecified)
            if (state.lanBaseUrl.isNotBlank()) {
                TextButton(onClick = { viewModel.clearNetworkConfig(ApiMode.LAN) }) { Text("清除局域网地址") }
            }
        }
        SurfaceCard {
            Text("公网服务器", fontWeight = FontWeight.SemiBold)
            Text(state.publicBaseUrl.ifBlank { "未配置" }, color = if (state.publicBaseUrl.isBlank()) Muted else Color.Unspecified)
            if (state.publicBaseUrl.isNotBlank()) {
                TextButton(onClick = { viewModel.clearNetworkConfig(ApiMode.PUBLIC) }) { Text("清除公网地址") }
            }
        }
        ErrorText(state.error)
        state.notice?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
        Button(
            onClick = viewModel::openNetworkScanner,
            modifier = Modifier.fillMaxWidth().height(50.dp)
        ) {
            Icon(Icons.Default.QrCodeScanner, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(if (state.lanBaseUrl.isBlank() && state.publicBaseUrl.isBlank()) "扫描网络配置二维码" else "重新扫码或添加地址")
        }
    }
}

@Composable
private fun NetworkScannerPage(state: AppState, viewModel: AppViewModel) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        QrCamera(
            modifier = Modifier.fillMaxSize(),
            onPayload = viewModel::applyNetworkQr,
            onError = viewModel::reportNetworkScannerError
        )
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = viewModel::openNetworkSettings) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = Color.White)
            }
            Text("扫描网络配置二维码", color = Color.White, fontWeight = FontWeight.Bold)
        }
        if (state.loading) {
            Box(Modifier.fillMaxSize().background(Color(0x99000000)), contentAlignment = Alignment.Center) {
                LoadingRow("正在验证服务器…")
            }
        }
    }
}

@Composable
private fun ReceiverHomePage(state: AppState, viewModel: AppViewModel) {
    AppScaffold("接单员手机端", state, onLogout = viewModel::logout, onRefresh = viewModel::refreshCurrentScreen) { padding ->
        LazyColumn(
            contentPadding = padding,
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize().padding(16.dp)
        ) {
            item { RoleGreetingCard(state) }
            item { EntryCard("订单", "查询、筛选与只读详情", { viewModel.openOrders("receiver") }) }
            item { EntryCard("现场录入", "拍照简录与常规录入", viewModel::openReceiverIntake) }
            item { EntryCard("扫描费用", "扫描订单码登记费用", viewModel::openReceiverScanCharge) }
        }
    }
}

@Composable
private fun PlannerHomePage(state: AppState, viewModel: AppViewModel) {
    AppScaffold("计划员", state, onLogout = viewModel::logout, onRefresh = viewModel::refreshCurrentScreen) { padding ->
        LazyColumn(
            contentPadding = padding,
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize().padding(16.dp)
        ) {
            item { RoleGreetingCard(state) }
            item {
                EntryCard("缝制中 ${state.orders.count { it.stage == "sewing_doing" }}", "查看已接单、尚未完工的订单", viewModel::openPlannerSewingDoing, featured = true)
            }
            item { EntryCard("待缝制 ${state.orders.count { it.stage == "sewing_waiting" }}", "查看尚未被缝制工接单的订单", viewModel::openPlannerSewingWaiting) }
            item { EntryCard("订单 ${state.orders.size}", "查询、筛选与只读详情", { viewModel.openOrders("planner") }) }
            item { EntryCard("扫描费用", "扫描订单码登记费用", viewModel::openPlannerScanCharge) }
            item { Notice("计划员手机端不分配缝制员工，不修改订单、生产路线或材料状态。") }
        }
    }
}

@Composable
private fun OrdersPage(state: AppState, kind: String, viewModel: AppViewModel, productionPlanOnly: Boolean = false) {
    val context = LocalContext.current
    var keyword by remember { mutableStateOf("") }
    var statusFilter by remember { mutableStateOf("") }
    var roundFilter by remember { mutableStateOf("") }
    var customerFilter by remember { mutableStateOf("") }
    var salespersonFilter by remember { mutableStateOf("") }
    var sampleTypeFilter by remember { mutableStateOf("") }
    var fabricFilter by remember { mutableStateOf("") }
    var trimFilter by remember { mutableStateOf("") }
    var startDate by remember(productionPlanOnly) {
        mutableStateOf(if (productionPlanOnly) "" else java.time.LocalDate.now().withDayOfMonth(1).toString())
    }
    var endDate by remember(productionPlanOnly) {
        mutableStateOf(if (productionPlanOnly) "" else java.time.LocalDate.now().withDayOfMonth(java.time.LocalDate.now().lengthOfMonth()).toString())
    }
    var deliveryStartDate by remember { mutableStateOf("") }
    var deliveryEndDate by remember { mutableStateOf("") }
    var materialOrder by remember { mutableStateOf<MobileOrder?>(null) }
    var pickerTarget by remember { mutableStateOf<MobileOrder?>(null) }
    var pendingUpload by remember { mutableStateOf<UploadPayload?>(null) }
    var pendingUploadBaseName by remember { mutableStateOf("") }
    var pickerError by remember { mutableStateOf<String?>(null) }
    var searchDialogOpen by remember { mutableStateOf(false) }
    var filterDialogOpen by remember { mutableStateOf(false) }
    var dateDialogOpen by remember { mutableStateOf(false) }
    val prepareUpload: (UploadPayload) -> Unit = { upload ->
        pendingUpload = upload
        pendingUploadBaseName = splitMaterialRecordFileName(upload.fileName).baseName
        pickerError = null
    }
    val acceptUpload: (Uri) -> Unit = { uri ->
        runCatching { context.readUpload(uri) }
            .onSuccess(prepareUpload)
            .onFailure { pickerError = it.message ?: "无法读取所选文件" }
    }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { it?.let(acceptUpload) }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(acceptUpload) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        bitmap?.asUpload()?.let(prepareUpload)
    }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) camera.launch(null) else pickerError = "未获得相机权限，请在系统设置中允许后重试。"
    }
    val takePhoto = {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            camera.launch(null)
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }
    val title = when {
        productionPlanOnly -> "计划员 · 缝制进度"
        kind == "planner" -> "计划员 · 订单"
        kind == "client" -> "客户订单"
        else -> "接单员 · 订单"
    }
    val filtered = state.orders
        .filter { !productionPlanOnly || it.stage == "sewing_waiting" || it.stage == "sewing_doing" }
        .filter {
            keyword.isBlank() || listOf(it.orderNo, it.styleNo, it.styleName, it.customerName, it.salespersonName, it.remark)
                .any { value -> value.contains(keyword, ignoreCase = true) }
        }
        .filter { statusFilter.isBlank() || it.stageLabel == statusFilter }
        .filter { roundFilter.isBlank() || it.sampleRound == roundFilter }
        .filter { customerFilter.isBlank() || it.customerName == customerFilter }
        .filter { salespersonFilter.isBlank() || it.salespersonName == salespersonFilter }
        .filter { sampleTypeFilter.isBlank() || it.sampleType == sampleTypeFilter }
        .filter { fabricFilter.isBlank() || it.fabricStatus == fabricFilter }
        .filter { trimFilter.isBlank() || it.trimStatus == trimFilter }
        .filter { startDate.isBlank() || entryDate(it.createdAt) >= startDate }
        .filter { endDate.isBlank() || entryDate(it.createdAt) <= endDate }
        .filter { deliveryStartDate.isBlank() || it.deliveryDate >= deliveryStartDate }
        .filter { deliveryEndDate.isBlank() || it.deliveryDate <= deliveryEndDate }
        .sortedByDescending { it.createdAt }
    val clearFilters = {
        val now = java.time.LocalDate.now()
        statusFilter = ""; roundFilter = ""; customerFilter = ""; salespersonFilter = ""
        sampleTypeFilter = ""; fabricFilter = ""; trimFilter = ""
        startDate = if (productionPlanOnly) "" else now.withDayOfMonth(1).toString()
        endDate = if (productionPlanOnly) "" else now.withDayOfMonth(now.lengthOfMonth()).toString()
        deliveryStartDate = ""; deliveryEndDate = ""
    }
    val content: @Composable (androidx.compose.foundation.layout.PaddingValues) -> Unit = { padding ->
        LazyColumn(
            contentPadding = padding,
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp)
        ) {
            item {
                Spacer(Modifier.height(14.dp))
                if (productionPlanOnly) {
                    Notice("缝制进度仅显示待缝制和缝制中订单；缝制员工由扫码开始任务，计划员不在此分配员工。")
                    Row(
                        Modifier.fillMaxWidth().padding(top = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        ProgressSummaryCard(
                            "待缝制",
                            state.orders.count { it.stage == "sewing_waiting" },
                            Modifier.weight(1f)
                        )
                        ProgressSummaryCard(
                            "缝制中",
                            state.orders.count { it.stage == "sewing_doing" },
                            Modifier.weight(1f)
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                }
                val activeConditions = listOfNotNull(
                    keyword.takeIf(String::isNotBlank)?.let { "搜索：$it" },
                    statusFilter.takeIf(String::isNotBlank)?.let(::stageText),
                    sampleTypeFilter.takeIf(String::isNotBlank)?.let(::sampleTypeText),
                    customerFilter.takeIf(String::isNotBlank),
                    salespersonFilter.takeIf(String::isNotBlank)
                )
                if (activeConditions.isNotEmpty()) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(activeConditions.joinToString(" · "), color = Muted, fontSize = 13.sp, modifier = Modifier.weight(1f))
                        if (keyword.isNotBlank()) IconButton(onClick = { keyword = "" }) {
                            Icon(Icons.Default.Close, "清除搜索", tint = Muted)
                        }
                    }
                }
            }
            item {
                Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("共 ${filtered.size} 条订单", color = Muted)
                    Text("按接单日期降序", color = Muted)
                }
            }
            item { ErrorText(state.error) }
            if (state.loading) item { LoadingRow("正在加载订单…") }
            if (!state.loading && filtered.isEmpty()) item { EmptyCard("暂无符合条件的订单") }
            items(filtered, key = { it.id }) { order ->
                OrderCard(
                    state = state,
                    order = order,
                    kind = kind,
                    productionPlan = productionPlanOnly,
                    onOpen = { viewModel.openOrder(order, if (productionPlanOnly) "planner-production" else kind) },
                    onAddMaterial = { materialOrder = order; pickerError = null },
                    onAddCharge = if (kind == "planner" && !productionPlanOnly) {
                        { viewModel.openPlannerOrderCharge(order) }
                    } else null
                )
            }
            item { Text("— 已经到底了 —", color = Muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(18.dp)) }
        }
    }
    AppScaffold(
        title,
        state,
        onBack = when {
            kind == "receiver" -> viewModel::openReceiverHome
            kind == "planner" -> viewModel::openPlannerHome
            else -> viewModel::back
        },
        onLogout = null,
        homeNavigation = kind == "receiver" || kind == "planner",
        onRefresh = viewModel::refreshCurrentScreen,
        extraActions = {
            IconButton(onClick = { searchDialogOpen = true }) { Icon(Icons.Default.Search, "搜索", tint = Color.White) }
            IconButton(onClick = { filterDialogOpen = true }) { Icon(Icons.Default.FilterList, "筛选", tint = Color.White) }
            IconButton(onClick = { dateDialogOpen = true }) { Icon(Icons.Default.CalendarMonth, "时间范围", tint = Color.White) }
        },
        content = content
    )
    materialOrder?.let { order ->
        AlertDialog(
            onDismissRequest = { materialOrder = null },
            title = { Text("面辅料记录") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("请选择照片或文件。选好后还需要再次确认，才会上传到订单资料与附件。", color = Muted)
                    OutlinedButton(onClick = { pickerTarget = order; materialOrder = null; takePhoto() }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.CameraAlt, null); Spacer(Modifier.width(6.dp)); Text("拍照")
                    }
                    OutlinedButton(onClick = { pickerTarget = order; materialOrder = null; imagePicker.launch("image/*") }, modifier = Modifier.fillMaxWidth()) {
                        Text("从相册选择")
                    }
                    OutlinedButton(onClick = { pickerTarget = order; materialOrder = null; filePicker.launch(arrayOf("*/*")) }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.AttachFile, null); Spacer(Modifier.width(6.dp)); Text("选择手机文件")
                    }
                    ErrorText(pickerError)
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { materialOrder = null }) { Text("取消") } }
        )
    }
    val upload = pendingUpload
    val target = pickerTarget
    if (upload != null && target != null) {
        val fileNameParts = splitMaterialRecordFileName(upload.fileName)
        val fileNameError = validateMaterialRecordFileName(
            pendingUploadBaseName,
            fileNameParts.extension
        )
        AlertDialog(
            onDismissRequest = {
                pendingUpload = null
                pendingUploadBaseName = ""
                pickerTarget = null
            },
            title = { Text("确认上传面辅料记录") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("文件名")
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = pendingUploadBaseName,
                            onValueChange = { pendingUploadBaseName = it },
                            singleLine = true,
                            isError = fileNameError != null,
                            label = { Text("文件名主体") },
                            modifier = Modifier.weight(1f)
                        )
                        Text(fileNameParts.extension.ifBlank { "无扩展名" }, color = Muted)
                    }
                    ErrorText(fileNameError)
                    Text(
                        "上传后将标记为“接单员上传 / 面辅料记录”，并显示在订单的资料与附件中。",
                        color = Muted
                    )
                }
            },
            confirmButton = {
                Button(
                    enabled = fileNameError == null,
                    onClick = {
                        viewModel.uploadMaterialRecord(
                            target,
                            kind,
                            renameMaterialRecordUpload(upload, pendingUploadBaseName)
                        )
                        pendingUpload = null
                        pendingUploadBaseName = ""
                        pickerTarget = null
                    }
                ) { Text("确认上传") }
            },
            dismissButton = {
                TextButton(onClick = {
                    pendingUpload = null
                    pendingUploadBaseName = ""
                    pickerTarget = null
                }) { Text("取消") }
            }
        )
    }
    if (searchDialogOpen) {
        AlertDialog(
            onDismissRequest = { searchDialogOpen = false },
            title = { Text("搜索订单") },
            text = {
                OutlinedTextField(
                    value = keyword,
                    onValueChange = { keyword = it },
                    placeholder = { Text("订单号、款号、客户、业务员或备注") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = { TextButton(onClick = { keyword = keyword.trim(); searchDialogOpen = false }) { Text("搜索") } },
            dismissButton = { TextButton(onClick = { keyword = ""; searchDialogOpen = false }) { Text("清除") } }
        )
    }
    if (filterDialogOpen) {
        AlertDialog(
            onDismissRequest = { filterDialogOpen = false },
            title = { Text("筛选订单") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    CompactFilter("全部客户", customerFilter, state.orders.map { it.customerName }.filter { it.isNotBlank() }.distinct(), { it }, Modifier.fillMaxWidth()) { customerFilter = it }
                    CompactFilter("全部业务员", salespersonFilter, state.orders.map { it.salespersonName }.filter { it.isNotBlank() }.distinct(), { it }, Modifier.fillMaxWidth()) { salespersonFilter = it }
                    CompactFilter("全部状态", statusFilter, state.orders.map { it.stageLabel }.filter { it.isNotBlank() }.distinct(), { stageText(it) }, Modifier.fillMaxWidth()) { statusFilter = it }
                    CompactFilter("全部轮次", roundFilter, state.orders.map { it.sampleRound }.filter { it.isNotBlank() }.distinct(), { sampleRoundText(it) }, Modifier.fillMaxWidth()) { roundFilter = it }
                    CompactFilter("全部样品类型", sampleTypeFilter, state.orders.map { it.sampleType }.filter { it.isNotBlank() }.distinct(), { sampleTypeText(it) }, Modifier.fillMaxWidth()) { sampleTypeFilter = it }
                    CompactFilter("全部面里料状态", fabricFilter, state.orders.map { it.fabricStatus }.filter { it.isNotBlank() }.distinct(), { materialText(it) }, Modifier.fillMaxWidth()) { fabricFilter = it }
                    CompactFilter("全部辅料状态", trimFilter, state.orders.map { it.trimStatus }.filter { it.isNotBlank() }.distinct(), { materialText(it) }, Modifier.fillMaxWidth()) { trimFilter = it }
                }
            },
            confirmButton = { TextButton(onClick = { filterDialogOpen = false }) { Text("应用") } },
            dismissButton = { TextButton(onClick = { clearFilters(); filterDialogOpen = false }) { Text("重置") } }
        )
    }
    if (dateDialogOpen) {
        AlertDialog(
            onDismissRequest = { dateDialogOpen = false },
            title = { Text("时间范围") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("接单日期", color = Muted)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        DateFilterField("开始日期", startDate, Modifier.weight(1f)) { startDate = it }
                        DateFilterField("结束日期", endDate, Modifier.weight(1f)) { endDate = it }
                    }
                    Text("交期", color = Muted)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        DateFilterField("开始日期", deliveryStartDate, Modifier.weight(1f)) { deliveryStartDate = it }
                        DateFilterField("结束日期", deliveryEndDate, Modifier.weight(1f)) { deliveryEndDate = it }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { dateDialogOpen = false }) { Text("应用") } },
            dismissButton = {
                TextButton(onClick = {
                    startDate = ""; endDate = ""; deliveryStartDate = ""; deliveryEndDate = ""; dateDialogOpen = false
                }) { Text("全部时间") }
            }
        )
    }
}

@Composable
private fun OrderDetailPage(state: AppState, order: MobileOrder, kind: String, initialTab: String, viewModel: AppViewModel) {
    OrderDetailPageContent(
        state = state,
        order = order,
        kind = kind,
        initialTab = initialTab,
        onBack = viewModel::back,
        onLogout = null,
        onRefresh = viewModel::refreshCurrentScreen,
        onUpdateAttachment = { attachmentId, name, visibility -> viewModel.updateAttachment(order.id, attachmentId, name, visibility) },
        onDeleteAttachment = { attachmentId -> viewModel.deleteAttachment(order.id, attachmentId) },
        onUpdateCharge = { chargeId, name, amount, explanation -> viewModel.updateOrderCharge(order.id, chargeId, name, amount, explanation) },
        onDeleteCharge = { chargeId -> viewModel.deleteOwnOrderCharge(order.id, chargeId) },
        onRenameChargeAttachment = { chargeId, attachmentId, name -> viewModel.renameChargeAttachment(order.id, chargeId, attachmentId, name) },
        onDeleteChargeAttachment = { chargeId, attachmentId -> viewModel.deleteChargeAttachment(order.id, chargeId, attachmentId) }
    )
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
internal fun OrderDetailPageContent(
    state: AppState,
    order: MobileOrder,
    kind: String,
    initialTab: String = "overview",
    onBack: () -> Unit,
    onLogout: (() -> Unit)? = null,
    onRefresh: (() -> Unit)? = null,
    onUpdateAttachment: ((String, String, String) -> Unit)? = null,
    onDeleteAttachment: ((String) -> Unit)? = null,
    onUpdateCharge: ((String, String, Double, String) -> Unit)? = null,
    onDeleteCharge: ((String) -> Unit)? = null,
    onRenameChargeAttachment: ((String, String, String) -> Unit)? = null,
    onDeleteChargeAttachment: ((String, String) -> Unit)? = null
) {
    val plannerMode = kind.startsWith("planner")
    val context = LocalContext.current
    var selectedTab by remember(order.id) {
        mutableStateOf(
            when (initialTab) {
                "flow" -> "flow"
                "attachments" -> "attachments"
                "charges" -> "charges"
                else -> "overview"
            }
        )
    }
    var renameAttachment by remember { mutableStateOf<MobileAttachment?>(null) }
    var renameValue by remember { mutableStateOf("") }
    var renameVisibility by remember { mutableStateOf("internal_only") }
    var deleteAttachment by remember { mutableStateOf<MobileAttachment?>(null) }
    var selectedCharge by remember { mutableStateOf<ReceiverCharge?>(null) }
    var chargeName by remember { mutableStateOf("") }
    var chargeAmount by remember { mutableStateOf("") }
    var chargeExplanation by remember { mutableStateOf("") }
    var renameChargeAttachment by remember { mutableStateOf<Pair<String, com.sampleroom.mobile.data.ReceiverChargeAttachment>?>(null) }
    var renameChargeAttachmentValue by remember { mutableStateOf("") }
    var deleteCharge by remember { mutableStateOf<ReceiverCharge?>(null) }
    var attachmentQuery by remember(order.id) { mutableStateOf("") }
    var attachmentQueryDraft by remember(order.id) { mutableStateOf("") }
    var attachmentTypeFilter by remember(order.id) { mutableStateOf("") }
    var attachmentRoleFilter by remember(order.id) { mutableStateOf("") }
    var attachmentSearchOpen by remember { mutableStateOf(false) }
    var attachmentFilterOpen by remember { mutableStateOf(false) }
    var chargeQuery by remember(order.id) { mutableStateOf("") }
    var chargeQueryDraft by remember(order.id) { mutableStateOf("") }
    var chargeRoleFilter by remember(order.id) { mutableStateOf("") }
    var chargeSearchOpen by remember { mutableStateOf(false) }
    var chargeFilterOpen by remember { mutableStateOf(false) }
    val allAttachments = (order.attachments + state.attachments).distinctBy { it.id }.filter {
        it.orderChargeId.isBlank() && it.category != "order_charge"
    }
    val attachmentCount = allAttachments.size + if (plannerMode) order.deliverables.size else 0
    val chargeCount = state.orderCharges.size
    val filteredCharges = state.orderCharges.filter { charge ->
        val queryMatched = chargeQuery.isBlank() || listOf(charge.name, charge.creatorName, charge.creatorRole)
            .any { it.contains(chargeQuery, ignoreCase = true) }
        queryMatched && (chargeRoleFilter.isBlank() || charge.creatorRole == chargeRoleFilter)
    }
    val filteredAttachments = allAttachments.filter { attachment ->
        attachmentMatchesFilters(
            fileName = attachment.fileName,
            mimeType = attachment.mimeType,
            uploaderName = attachment.uploadedByName,
            uploaderRole = attachment.uploadedByRole,
            query = attachmentQuery,
            typeFilter = attachmentTypeFilter,
            roleFilter = attachmentRoleFilter
        )
    }
    val filteredDeliverables = order.deliverables.filter { deliverable ->
        attachmentMatchesFilters(
            fileName = deliverable.fileName.ifBlank { deliverable.type },
            mimeType = attachmentMimeFromName(deliverable.fileName),
            uploaderName = deliverable.uploadedByName,
            uploaderRole = "pattern_maker",
            query = attachmentQuery,
            typeFilter = attachmentTypeFilter,
            roleFilter = attachmentRoleFilter,
            extraSearchText = "${deliverable.type} ${deliverable.version} 版师"
        )
    }
    val attachmentFiltersActive = attachmentQuery.isNotBlank() || attachmentTypeFilter.isNotBlank() || attachmentRoleFilter.isNotBlank()
    AppScaffold(
        "订单详情",
        state,
        onBack = onBack,
        onLogout = onLogout,
        onRefresh = onRefresh,
        extraActions = {
            if (plannerMode && selectedTab == "attachments") {
                IconButton(onClick = {
                    attachmentQueryDraft = attachmentQuery
                    attachmentSearchOpen = true
                }) { Icon(Icons.Default.Search, "搜索附件", tint = Color.White) }
                IconButton(onClick = { attachmentFilterOpen = true }) {
                    Icon(Icons.Default.FilterList, "筛选附件", tint = Color.White)
                }
            }
            if (plannerMode && selectedTab == "charges") {
                IconButton(onClick = { chargeQueryDraft = chargeQuery; chargeSearchOpen = true }) {
                    Icon(Icons.Default.Search, "搜索费用", tint = Color.White)
                }
                IconButton(onClick = { chargeFilterOpen = true }) {
                    Icon(Icons.Default.FilterList, "筛选费用", tint = Color.White)
                }
            }
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 14.dp)) {
            Spacer(Modifier.height(14.dp))
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.Top) {
                        if (plannerMode) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                OrderThumbnail(state, order, kind, 92.dp)
                                StatusPill(stageText(order.stageLabel), Modifier.padding(top = 7.dp))
                            }
                        } else {
                            OrderThumbnail(state, order, kind, 92.dp)
                        }
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Row(verticalAlignment = Alignment.Top) {
                                CompactStyleIdentity(
                                    styleNo = order.styleNo,
                                    styleName = order.styleName,
                                    modifier = Modifier.weight(1f),
                                    maxFontSize = 19.sp,
                                    minFontSize = 8.sp,
                                    maxLinesEach = 3
                                )
                                if (!plannerMode) {
                                    Spacer(Modifier.width(8.dp))
                                    StatusPill(stageText(order.stageLabel))
                                }
                            }
                            Text("接单日期 ${entryDate(order.createdAt)}", color = Muted, modifier = Modifier.padding(top = 8.dp))
                        }
                    }
                }
            }
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = 10.dp, bottom = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                DetailTab("概览", selectedTab == "overview") { selectedTab = "overview" }
                DetailTab(countedDetailTabLabel("资料与附件", attachmentCount), selectedTab == "attachments") { selectedTab = "attachments" }
                DetailTab(countedDetailTabLabel("其他费用", chargeCount), selectedTab == "charges") { selectedTab = "charges" }
                DetailTab("流转记录", selectedTab == "flow") { selectedTab = "flow" }
            }
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 20.dp),
                modifier = Modifier.fillMaxWidth().weight(1f)
            ) {
            if (selectedTab == "overview") {
                item {
                    SurfaceCard {
                        Text("订单基础信息", fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                        Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            InfoCell("客户", order.customerName, Modifier.weight(1f), maxLines = Int.MAX_VALUE)
                            InfoCell("业务员", order.salespersonName, Modifier.weight(1f), maxLines = Int.MAX_VALUE)
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            InfoCell("数量", order.quantity.toString(), Modifier.weight(1f))
                            InfoCell("样品类型", sampleTypeText(order.sampleType), Modifier.weight(1f))
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            InfoCell("轮次", sampleRoundText(order.sampleRound), Modifier.weight(1f))
                            InfoCell("期望交期", order.deliveryDate, Modifier.weight(1f))
                        }
                    }
                }
                item {
                    SurfaceCard {
                        Text("任务与材料状态", fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                        DetailRow("版师任务进度", patternStatusText(order.patternTaskStatus))
                        if (plannerMode) DetailRow("版师负责人", order.patternMakerName.ifBlank { "-" })
                        Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            InfoCell("面里料", materialText(order.fabricStatus), Modifier.weight(1f))
                            InfoCell("辅料", materialText(order.trimStatus), Modifier.weight(1f))
                        }
                    }
                }
                item {
                    SurfaceCard {
                        Text("要求与备注", fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                        Text("打样要求", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
                        Text(order.sampleRequestItems.joinToString("、") { requestText(it) }.ifBlank { "-" }, modifier = Modifier.padding(top = 10.dp))
                        HorizontalDivider(Modifier.padding(vertical = 12.dp), color = DividerColor)
                        Text("备注", color = Muted, fontSize = 13.sp)
                        Text(order.remark.ifBlank { "-" }, modifier = Modifier.padding(top = 6.dp))
                    }
                }
            }
            if (selectedTab == "attachments" && plannerMode && attachmentQuery.isNotBlank()) item {
                Surface(color = Color(0xFFEAF2FF), shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
                    Row(
                        Modifier.fillMaxWidth().padding(start = 12.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            "搜索：$attachmentQuery",
                            color = Navy,
                            fontSize = 13.sp,
                            modifier = Modifier.weight(1f),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                        IconButton(onClick = {
                            attachmentQuery = ""
                            attachmentQueryDraft = ""
                        }) { Icon(Icons.Default.Close, "清除附件搜索", tint = Muted) }
                    }
                }
            }
            if (selectedTab == "attachments" && plannerMode && (attachmentTypeFilter.isNotBlank() || attachmentRoleFilter.isNotBlank())) item {
                Surface(color = Color(0xFFF8FAFC), shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
                    Row(
                        Modifier.fillMaxWidth().padding(start = 12.dp, top = 6.dp, bottom = 6.dp, end = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            listOfNotNull(
                                attachmentTypeFilter.takeIf(String::isNotBlank)?.let { "类型：${attachmentTypeLabel(it)}" },
                                attachmentRoleFilter.takeIf(String::isNotBlank)?.let { "上传角色：${orderChargeRoleLabel(it)}" }
                            ).joinToString(" · "),
                            color = Muted,
                            fontSize = 13.sp,
                            modifier = Modifier.weight(1f)
                        )
                        TextButton(onClick = {
                            attachmentTypeFilter = ""
                            attachmentRoleFilter = ""
                        }) { Text("重置筛选") }
                    }
                }
            }
            if (selectedTab == "attachments") item {
                    SurfaceCard {
                        if (filteredAttachments.isEmpty() && (!plannerMode || filteredDeliverables.isEmpty())) {
                            Text(if (attachmentFiltersActive) "没有符合条件的附件" else "暂无可查看附件", color = Muted)
                        }
                        filteredAttachments.forEach { attachment ->
                            val previewable = attachment.hasFile &&
                                (attachment.mimeType.startsWith("image/") || attachment.mimeType == "application/pdf")
                            if (plannerMode) {
                                val session = state.session
                                val previewUrl = session?.let {
                                    "${it.endpoint.baseUrl.trimEnd('/')}/api/miniapp/planner/orders/${order.id}/attachments/${attachment.id}/preview"
                                }
                                val previewAction = {
                                    if (previewable && session != null && previewUrl != null) {
                                        context.startActivity(Intent(context, AttachmentPreviewActivity::class.java)
                                            .putExtra(AttachmentPreviewActivity.EXTRA_URL, previewUrl)
                                            .putExtra(AttachmentPreviewActivity.EXTRA_TOKEN, session.token)
                                            .putExtra(AttachmentPreviewActivity.EXTRA_FILE_NAME, attachment.fileName))
                                    }
                                }
                                Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f).padding(end = 8.dp)) {
                                        Surface(color = Color(0xFFEAF2FF), shape = RoundedCornerShape(5.dp)) {
                                            Text(attachmentCategoryLabel(attachment.category), color = BrightBlue, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp))
                                        }
                                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                            Text(
                                                attachment.fileName,
                                                color = if (previewable) Teal else Color(0xFF1E293B),
                                                fontWeight = FontWeight.SemiBold,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                                modifier = Modifier.weight(1f).then(if (previewable) Modifier.clickable(onClick = previewAction) else Modifier)
                                            )
                                        }
                                        Text(
                                            listOf(attachmentUploaderText(attachment), entryDate(attachment.createdAt)).joinToString(" · "),
                                            color = Muted,
                                            fontSize = 12.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        if (!previewable) Text("该附件暂不支持手机内预览", color = Muted, fontSize = 11.sp)
                                    }
                                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                        if (attachment.canRename && onUpdateAttachment != null) IconButton(onClick = {
                                            renameAttachment = attachment
                                            renameValue = attachment.fileName
                                            renameVisibility = attachment.visibility
                                        }) { Icon(Icons.Default.Edit, "修改名称和可见范围", tint = Muted, modifier = Modifier.size(20.dp)) }
                                        if (attachment.canDelete && onDeleteAttachment != null) IconButton(onClick = { deleteAttachment = attachment }) {
                                            Icon(Icons.Default.DeleteOutline, "删除附件", tint = Color(0xFFB3261E))
                                        }
                                    }
                                }
                            } else {
                                DetailRow(
                                    attachment.fileName,
                                    listOf(attachmentUploaderText(attachment), entryDate(attachment.createdAt)).filter { it.isNotBlank() }.joinToString(" · ")
                                )
                            }
                            if (!plannerMode) Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                TextButton(
                                    onClick = {
                                        val session = state.session ?: return@TextButton
                                        val role = if (plannerMode) "planner" else "receiver"
                                        val url = "${session.endpoint.baseUrl.trimEnd('/')}/api/miniapp/$role/orders/${order.id}/attachments/${attachment.id}/download"
                                        val request = DownloadManager.Request(Uri.parse(url))
                                            .addRequestHeader("Authorization", "Bearer ${session.token}")
                                            .setTitle(attachment.fileName)
                                            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                                            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, attachment.fileName.replace(Regex("[\\\\/:*?\"<>|]"), "_"))
                                        (context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
                                    },
                                    enabled = attachment.hasFile
                                ) { Text("下载") }
                                if (attachment.canDelete && onDeleteAttachment != null) TextButton(onClick = { deleteAttachment = attachment }) { Text("删除", color = Color(0xFFB3261E)) }
                            }
                            if (plannerMode) HorizontalDivider(color = DividerColor)
                        }
                        if (plannerMode && filteredDeliverables.isNotEmpty()) {
                            Text("版师交付物", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp))
                            filteredDeliverables.forEach { deliverable ->
                                DetailRow(
                                    deliverable.fileName.ifBlank { deliverable.type },
                                    listOf(deliverable.version, deliverable.uploadedByName, "版师", entryDate(deliverable.createdAt)).filter { it.isNotBlank() }.joinToString(" · ")
                                )
                            }
                        }
                    }
                }
            if (selectedTab == "charges") item {
                    SurfaceCard {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("其他费用", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                                Text("共 ${state.orderCharges.size} 笔", color = BrightBlue, fontSize = 12.sp)
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                Text("¥${"%.2f".format(state.orderCharges.sumOf { it.amount })}", color = BrightBlue, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                                Text("费用合计金额", color = Muted, fontSize = 11.sp)
                            }
                        }
                        if (chargeQuery.isNotBlank() || chargeRoleFilter.isNotBlank()) {
                            Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(listOfNotNull(
                                    chargeQuery.takeIf(String::isNotBlank)?.let { "搜索：$it" },
                                    chargeRoleFilter.takeIf(String::isNotBlank)?.let { "角色：${orderChargeRoleLabel(it)}" }
                                ).joinToString(" · "), color = Muted, fontSize = 12.sp, modifier = Modifier.weight(1f))
                                IconButton(onClick = { chargeQuery = ""; chargeRoleFilter = "" }) { Icon(Icons.Default.Close, "清除费用搜索筛选", tint = Muted) }
                            }
                        }
                        if (state.orderCharges.isEmpty()) {
                            Text("暂无其他费用", color = Muted, modifier = Modifier.padding(top = 14.dp))
                        }
                        filteredCharges.forEachIndexed { index, charge ->
                            Card(
                                colors = CardDefaults.cardColors(containerColor = Color(0xFFFBFDFF)),
                                border = BorderStroke(1.dp, Color(0xFFE3EAF4)),
                                modifier = Modifier.fillMaxWidth().padding(top = 10.dp).clickable {
                                    selectedCharge = charge
                                    chargeName = charge.name
                                    chargeAmount = charge.amount.toString()
                                    chargeExplanation = charge.explanation
                                }
                            ) {
                            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.Top) {
                                Surface(color = Color(0xFFEAF2FF), shape = RoundedCornerShape(7.dp)) {
                                    Text("${index + 1}", color = BrightBlue, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp))
                                }
                                Column(Modifier.weight(1f).padding(start = 10.dp)) {
                                    Text(charge.name, fontWeight = FontWeight.SemiBold)
                                    Text("¥${"%.2f".format(charge.amount)}", color = BrightBlue, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 3.dp))
                                    Text(
                                        "${orderChargeRoleLabel(charge.creatorRole)} · ${charge.creatorName.ifBlank { "-" }}",
                                        color = Muted,
                                        fontSize = 13.sp,
                                        modifier = Modifier.padding(top = 6.dp)
                                    )
                                    Text(entryDate(charge.createdAt) + if (charge.attachments.isNotEmpty()) "  ·  已附 ${charge.attachments.size} 个附件" else "", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Icon(Icons.Default.ChevronRight, "查看费用详情", tint = BrightBlue)
                                    if (charge.canVoid && onDeleteCharge != null) {
                                        IconButton(onClick = { deleteCharge = charge }) { Icon(Icons.Default.DeleteOutline, "删除费用", tint = Color(0xFFB3261E)) }
                                    }
                                }
                            }
                            }
                        }
                    }
                }
            if (selectedTab == "flow") item {
                    SurfaceCard {
                        Text("流转记录", fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                        if (order.scanRecords.isEmpty()) Text("暂无扫码记录", color = Muted)
                        order.scanRecords.forEach { record ->
                            DetailRow("${record.stageLabel} · ${record.actionLabel}", "${record.workerName} · ${mobileRecordTime(record.eventTime)}")
                        }
                    }
                }
            item {
                state.notice?.let { Notice(it) }
                ErrorText(state.error)
                Spacer(Modifier.height(20.dp))
            }
            }
        }
    }
    if (attachmentSearchOpen) {
        AlertDialog(
            onDismissRequest = { attachmentSearchOpen = false },
            title = { Text("搜索附件") },
            text = {
                OutlinedTextField(
                    value = attachmentQueryDraft,
                    onValueChange = { attachmentQueryDraft = it },
                    placeholder = { Text("附件名称、上传人或上传角色") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = {
                        attachmentQuery = attachmentQueryDraft.trim()
                        attachmentSearchOpen = false
                    }),
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    attachmentQuery = attachmentQueryDraft.trim()
                    attachmentSearchOpen = false
                }) { Text("搜索") }
            },
            dismissButton = {
                TextButton(onClick = {
                    attachmentQuery = ""
                    attachmentQueryDraft = ""
                    attachmentSearchOpen = false
                }) { Text("清除") }
            }
        )
    }
    if (attachmentFilterOpen) {
        val roleOptions = (allAttachments.map { it.uploadedByRole }.filter { it.isNotBlank() } +
            order.deliverables.takeIf { it.isNotEmpty() }?.let { listOf("pattern_maker") }.orEmpty()).distinct()
        AlertDialog(
            onDismissRequest = { attachmentFilterOpen = false },
            title = { Text("筛选附件") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    CompactFilter(
                        "全部文件类型",
                        attachmentTypeFilter,
                        listOf("image", "pdf", "other"),
                        ::attachmentTypeLabel,
                        Modifier.fillMaxWidth()
                    ) { attachmentTypeFilter = it }
                    CompactFilter(
                        "全部上传角色",
                        attachmentRoleFilter,
                        roleOptions,
                        ::orderChargeRoleLabel,
                        Modifier.fillMaxWidth()
                    ) { attachmentRoleFilter = it }
                }
            },
            confirmButton = { TextButton(onClick = { attachmentFilterOpen = false }) { Text("应用") } },
            dismissButton = {
                TextButton(onClick = {
                    attachmentTypeFilter = ""
                    attachmentRoleFilter = ""
                    attachmentFilterOpen = false
                }) { Text("重置") }
            }
        )
    }
    if (chargeSearchOpen) {
        AlertDialog(
            onDismissRequest = { chargeSearchOpen = false },
            title = { Text("搜索其他费用") },
            text = {
                OutlinedTextField(
                    chargeQueryDraft,
                    { chargeQueryDraft = it },
                    placeholder = { Text("费用名称、记录人或角色") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { chargeQuery = chargeQueryDraft.trim(); chargeSearchOpen = false })
                )
            },
            confirmButton = { TextButton(onClick = { chargeQuery = chargeQueryDraft.trim(); chargeSearchOpen = false }) { Text("搜索") } },
            dismissButton = { TextButton(onClick = { chargeQuery = ""; chargeQueryDraft = ""; chargeSearchOpen = false }) { Text("清除") } }
        )
    }
    if (chargeFilterOpen) {
        AlertDialog(
            onDismissRequest = { chargeFilterOpen = false },
            title = { Text("筛选记录角色") },
            text = {
                CompactFilter(
                    "全部记录角色",
                    chargeRoleFilter,
                    state.orderCharges.map { it.creatorRole }.filter(String::isNotBlank).distinct(),
                    ::orderChargeRoleLabel,
                    Modifier.fillMaxWidth()
                ) { chargeRoleFilter = it }
            },
            confirmButton = { TextButton(onClick = { chargeFilterOpen = false }) { Text("应用") } },
            dismissButton = { TextButton(onClick = { chargeRoleFilter = ""; chargeFilterOpen = false }) { Text("重置") } }
        )
    }
    selectedCharge?.let { charge ->
        val chargeSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = { selectedCharge = null },
            sheetState = chargeSheetState,
            containerColor = Color.White,
            dragHandle = null
        ) {
            Column(Modifier.fillMaxWidth().fillMaxHeight(0.92f)) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("其他费用详情", color = Navy, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    IconButton(onClick = { selectedCharge = null }) { Icon(Icons.Default.Close, "关闭", tint = Navy) }
                }
                HorizontalDivider(color = DividerColor)
                Column(
                    Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                OutlinedTextField(chargeName, { chargeName = it }, label = { Text("费用名称") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    chargeAmount,
                    { chargeAmount = it.filter { char -> char.isDigit() || char == '.' } },
                    label = { Text("金额（CNY）") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                DetailRow("记录人", "${orderChargeRoleLabel(charge.creatorRole)} · ${charge.creatorName.ifBlank { "-" }}")
                DetailRow("日期", entryDate(charge.createdAt))
                OutlinedTextField(
                    chargeExplanation,
                    { if (it.length <= 200) chargeExplanation = it },
                    label = { Text("备注（选填）") },
                    supportingText = { Text("${chargeExplanation.length}/200") },
                    minLines = 3,
                    maxLines = 4,
                    modifier = Modifier.fillMaxWidth()
                )
                Text("附件（${charge.attachments.size}）", color = Muted)
                charge.attachments.forEach { attachment ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.AttachFile, null, tint = BrightBlue)
                        Text(
                            attachment.fileName,
                            color = BrightBlue,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f).padding(start = 8.dp).clickable {
                                val session = state.session ?: return@clickable
                                val role = if (plannerMode) "planner" else "receiver"
                                val url = "${session.endpoint.baseUrl.trimEnd('/')}/api/miniapp/$role/orders/${order.id}/charges/${charge.id}/attachments/${attachment.id}/preview"
                                context.startActivity(Intent(context, AttachmentPreviewActivity::class.java)
                                    .putExtra(AttachmentPreviewActivity.EXTRA_URL, url)
                                    .putExtra(AttachmentPreviewActivity.EXTRA_TOKEN, session.token)
                                    .putExtra(AttachmentPreviewActivity.EXTRA_FILE_NAME, attachment.fileName))
                            }
                        )
                        if (attachment.canRename && onRenameChargeAttachment != null) {
                            IconButton(onClick = {
                                renameChargeAttachment = charge.id to attachment
                                renameChargeAttachmentValue = attachment.fileName
                            }) { Icon(Icons.Default.Edit, "修改费用附件名称", tint = Muted) }
                        }
                        if (attachment.canDelete && onDeleteChargeAttachment != null) {
                            IconButton(onClick = { onDeleteChargeAttachment.invoke(charge.id, attachment.id) }) {
                                Icon(Icons.Default.DeleteOutline, "删除费用附件", tint = Color(0xFFB3261E))
                            }
                        }
                    }
                }
                }
                HorizontalDivider(color = DividerColor)
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    if (charge.canVoid && onDeleteCharge != null) {
                        OutlinedButton(onClick = { deleteCharge = charge; selectedCharge = null }, modifier = Modifier.weight(1f)) { Text("删除", color = Color(0xFFB3261E)) }
                    }
                    OutlinedButton(onClick = { selectedCharge = null }, modifier = Modifier.weight(1f)) { Text("取消") }
                    Button(
                        onClick = {
                            val numericAmount = chargeAmount.toDoubleOrNull()
                            if (numericAmount != null && numericAmount > 0 && chargeName.isNotBlank()) {
                                onUpdateCharge?.invoke(charge.id, chargeName.trim(), numericAmount, chargeExplanation.trim())
                                selectedCharge = null
                            }
                        },
                        enabled = charge.canRename && !state.loading,
                        modifier = Modifier.weight(1f)
                    ) { Text("保存") }
                }
            }
        }
    }
    renameChargeAttachment?.let { (chargeId, attachment) ->
        AlertDialog(
            onDismissRequest = { renameChargeAttachment = null },
            title = { Text("修改附件名称") },
            text = { OutlinedTextField(renameChargeAttachmentValue, { renameChargeAttachmentValue = it }, singleLine = true) },
            confirmButton = {
                TextButton(onClick = {
                    onRenameChargeAttachment?.invoke(chargeId, attachment.id, renameChargeAttachmentValue)
                    renameChargeAttachment = null
                }, enabled = renameChargeAttachmentValue.isNotBlank()) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { renameChargeAttachment = null }) { Text("取消") } }
        )
    }
    renameAttachment?.let { attachment ->
        AlertDialog(
            onDismissRequest = { renameAttachment = null },
            title = { Text("修改附件名称") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(renameValue, { renameValue = it }, label = { Text("展示名称（扩展名不能修改）") }, singleLine = true)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { renameVisibility = "internal_only" }, modifier = Modifier.weight(1f)) { Text(if (renameVisibility == "internal_only") "✓ 内部可见" else "内部可见") }
                        OutlinedButton(onClick = { renameVisibility = "client_visible" }, modifier = Modifier.weight(1f)) { Text(if (renameVisibility == "client_visible") "✓ 全部可见" else "全部可见") }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { onUpdateAttachment?.invoke(attachment.id, renameValue, renameVisibility); renameAttachment = null }, enabled = renameValue.isNotBlank()) { Text("保存") } },
            dismissButton = { TextButton(onClick = { renameAttachment = null }) { Text("取消") } }
        )
    }
    deleteAttachment?.let { attachment ->
        AlertDialog(
            onDismissRequest = { deleteAttachment = null },
            title = { Text("删除附件？") },
            text = { Text("只可删除服务端确认有权限的附件，操作会保留日志。") },
            confirmButton = { TextButton(onClick = { onDeleteAttachment?.invoke(attachment.id); deleteAttachment = null }) { Text("确认删除", color = Color(0xFFB3261E)) } },
            dismissButton = { TextButton(onClick = { deleteAttachment = null }) { Text("取消") } }
        )
    }
    deleteCharge?.let { charge ->
        AlertDialog(
            onDismissRequest = { deleteCharge = null },
            title = { Text("删除这笔费用？") },
            text = { Text("${charge.name} · ¥${"%.2f".format(charge.amount)}\n删除后会保留操作记录。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDeleteCharge?.invoke(charge.id)
                        deleteCharge = null
                    },
                    enabled = !state.loading
                ) { Text("确认删除", color = Color(0xFFB3261E)) }
            },
            dismissButton = { TextButton(onClick = { deleteCharge = null }) { Text("取消") } }
        )
    }
}

@Composable
private fun ScanPage(state: AppState, viewModel: AppViewModel) {
    val context = LocalContext.current
    var cameraOpen by remember { mutableStateOf(false) }
    var cameraPermissionDenied by remember { mutableStateOf(false) }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        cameraOpen = granted
        cameraPermissionDenied = !granted
    }
    val openCamera = {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            cameraOpen = true
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }
    LaunchedEffect(Unit) { openCamera() }
    AppScaffold("扫描订单二维码", state, onBack = viewModel::openWorkerHome, onLogout = null, homeNavigation = true) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            IdentityCard(state)
            if (cameraOpen) {
                QrCamera(
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    onPayload = { cameraOpen = false; viewModel.resolveScannedPayload(it) },
                    onError = { cameraOpen = false }
                )
            } else {
                Button(onClick = openCamera, enabled = !state.loading, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                    Icon(Icons.Default.QrCodeScanner, null); Spacer(Modifier.width(8.dp)); Text("扫描订单二维码")
                }
                if (cameraPermissionDenied) ErrorText("未获得相机权限，请在系统设置中允许后重试。")
                ErrorText(state.error)
            }
        }
    }
}

@Composable
private fun ScanResultPage(state: AppState, result: ScanResult, viewModel: AppViewModel) {
    val focusManager = LocalFocusManager.current
    val context = LocalContext.current
    val order = result.order
    var pieces by remember(result.token, result.allowedAction) {
        mutableStateOf(result.defaultPieces?.toString().orEmpty())
    }
    var workHours by remember(result.token, result.allowedAction) { mutableStateOf("") }
    var note by remember(result.token, result.allowedAction) { mutableStateOf("") }
    var qualityScore by remember(result.token, result.allowedAction) { mutableStateOf("") }
    var qualityResult by remember(result.token, result.allowedAction) { mutableStateOf("qualified") }
    val photos = remember(result.token, result.allowedAction) { mutableStateListOf<UploadPayload>() }
    var photoError by remember(result.token, result.allowedAction) { mutableStateOf<String?>(null) }
    var completionError by remember(result.token, result.allowedAction) { mutableStateOf<String?>(null) }
    var photoTargetCategory by remember(result.token, result.allowedAction) { mutableStateOf("qc_sample_photo") }
    var previousReworkOpen by remember(result.token, result.allowedAction) { mutableStateOf(false) }
    var renamePhotoIndex by remember { mutableStateOf<Int?>(null) }
    var renamePhotoBaseName by remember { mutableStateOf("") }
    var pendingQcCompletion by remember(result.token, result.allowedAction) {
        mutableStateOf<WorkerScanCompletion?>(null)
    }
    val addPhoto: (UploadPayload, String) -> Unit = { upload, category ->
        val totalBytes = photos.sumOf { it.bytes.size.toLong() } + upload.bytes.size
        when {
            photos.size >= 10 -> photoError = "最多上传10张照片。"
            !upload.mimeType.startsWith("image/") -> photoError = "组检凭证只能选择图片。"
            upload.bytes.size > 20 * 1024 * 1024 -> photoError = "单张照片不能超过20MB。"
            totalBytes > 60L * 1024 * 1024 -> photoError = "全部照片合计不能超过60MB。"
            else -> {
                photos += upload.copy(category = category)
                photoError = null
                completionError = null
            }
        }
    }
    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        uris.take(10 - photos.size).forEach { uri ->
            runCatching { context.readUpload(uri) }
                .onSuccess { addPhoto(it, photoTargetCategory) }
                .onFailure { photoError = it.message ?: "照片读取失败。" }
        }
    }
    val photoCamera = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { cameraResult ->
        if (cameraResult.resultCode == Activity.RESULT_OK) {
            val data = cameraResult.data
            val uris = data?.getStringArrayListExtra(PhotoCaptureActivity.EXTRA_URIS)
                ?.map(Uri::parse)
                .orEmpty()
            val paths = data?.getStringArrayListExtra(PhotoCaptureActivity.EXTRA_PATHS).orEmpty()
            try {
                uris.take(10 - photos.size).forEach { uri ->
                    runCatching { context.readUpload(uri) }
                        .onSuccess { addPhoto(it, photoTargetCategory) }
                        .onFailure { photoError = it.message ?: "照片读取失败。" }
                }
            } finally {
                paths.forEach { File(it).delete() }
            }
        }
    }
    val takeQcPhoto: (String) -> Unit = { category ->
        photoTargetCategory = category
        photoCamera.launch(
            Intent(context, PhotoCaptureActivity::class.java)
                .putExtra(PhotoCaptureActivity.EXTRA_MAX_PHOTOS, 10 - photos.size)
        )
    }
    val pickQcPhotos: (String) -> Unit = { category ->
        photoTargetCategory = category
        photoPicker.launch("image/*")
    }
    val completionAction = result.allowedAction == "complete"
    var stageMismatchPromptVisible by remember(result.token, result.blockedReason, result.entrySource) {
        mutableStateOf(shouldShowStageMismatchPrompt(result))
    }
    val submissionTerminated = state.error == "订单已终止"
    var submissionTerminatedPromptVisible by remember(result.token, state.error) {
        mutableStateOf(submissionTerminated)
    }
    val dismissStageMismatchPrompt = {
        stageMismatchPromptVisible = false
        viewModel.openWorkerHome()
    }
    val dismissSubmissionTerminatedPrompt = {
        submissionTerminatedPromptVisible = false
        viewModel.openWorkerHome()
    }

    AppScaffold("扫码结果", state, onBack = viewModel::back, onLogout = null) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                photoError?.let { ErrorText(it) }
            }
            item {
                if (result.stage == "qc_delivery") {
                    QcResultOrderCard(
                        state = state,
                        result = result,
                        onOpenRework = { previousReworkOpen = true }
                    )
                } else if (result.stage == "sewing") {
                    SewingResultOrderCard(state, result)
                } else {
                    SurfaceCard {
                        AutoFitSingleLineText(
                            text = order.styleNo.ifBlank { "未录入款号" },
                            maxFontSize = 22.sp,
                            minFontSize = 8.sp,
                            fontWeight = FontWeight.Bold
                        )
                        AutoFitSingleLineText(
                            text = order.styleName.ifBlank { "-" },
                            color = Muted,
                            maxFontSize = 17.sp,
                            minFontSize = 8.sp
                        )
                        DetailRow("数量", order.quantity.toString())
                        DetailRow("当前阶段", result.currentStageLabel)
                        if (order.remark.isNotBlank()) DetailRow("接单备注 / 特殊要求", order.remark)
                    }
                }
            }

            if (isCompletedSewingRound(result)) {
                item {
                    SurfaceCard {
                        Text("你已完成本轮缝制", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                        Text(completedSewingRoundMessage(result), color = Muted)
                    }
                }
            }

            if (completionAction) {
                item {
                    SurfaceCard {
                        Text(
                            when {
                                result.stage == "qc_delivery" -> "登记组检 / 出库结果"
                                else -> "登记工序完成"
                            },
                            fontSize = 18.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                        if (result.stage == "qc_delivery") {
                            Text("QC 结果", color = Navy, fontWeight = FontWeight.SemiBold)
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                if (qualityResult == "qualified") {
                                    Button(
                                        onClick = {},
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier.weight(1f)
                                    ) { Text("合格并完成") }
                                    OutlinedButton(
                                        onClick = {
                                            qualityResult = "rework"
                                            qualityScore = ""
                                            photos.clear()
                                            photoError = null
                                            completionError = null
                                        },
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier.weight(1f)
                                    ) { Text("需要返工") }
                                } else {
                                    OutlinedButton(
                                        onClick = {
                                            qualityResult = "qualified"
                                            photos.clear()
                                            photoError = null
                                            completionError = null
                                        },
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier.weight(1f)
                                    ) { Text("合格并完成") }
                                    Button(
                                        onClick = {},
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier.weight(1f)
                                    ) { Text("需要返工") }
                                }
                            }
                            OutlinedTextField(
                                value = pieces,
                                onValueChange = {
                                    pieces = it.filter(Char::isDigit)
                                    completionError = null
                                },
                                label = { Text("实收 / 检查件数") },
                                keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )
                            if (qualityResult == "qualified") {
                                OutlinedTextField(
                                    value = qualityScore,
                                    onValueChange = {
                                        qualityScore = it.filter(Char::isDigit)
                                        completionError = null
                                    },
                                    label = { Text("质量评分（0–100）") },
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
                                    keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                            OutlinedTextField(
                                value = note,
                                onValueChange = {
                                    note = it
                                    completionError = null
                                },
                                label = {
                                    Text(if (qualityResult == "rework") "返工原因（必填）" else "异常说明（选填）")
                                },
                                placeholder = {
                                    Text(if (qualityResult == "rework") "请填写明确的返工原因" else "如有异常，可在这里说明")
                                },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                                modifier = Modifier.fillMaxWidth()
                            )
                            Text(
                                if (qualityResult == "rework")
                                    "返工不填写质量评分；问题照片可选，订单继续等待原组检员工复检。"
                                else "合格必须填写评分并上传至少一张最终样衣照片，提交后订单进入已完成。",
                                color = Color(0xFF375A7F),
                                fontSize = 12.sp,
                                modifier = Modifier.background(Color(0xFFF1F6FC), RoundedCornerShape(10.dp)).padding(10.dp)
                            )
                            QcPhotoSection(
                                title = if (qualityResult == "rework") "问题照片（选填）" else "最终样衣照片（至少 1 张）",
                                description = if (qualityResult == "rework") "用于说明返工问题，可不上传" else "合格提交的最终样衣凭证",
                                photos = photos.withIndex().filter { it.value.category != "qc_measurement_photo" },
                                totalPhotoCount = photos.size,
                                loading = state.loading,
                                onTakePhoto = {
                                    takeQcPhoto(if (qualityResult == "rework") "qc_issue_photo" else "qc_sample_photo")
                                },
                                onPickPhotos = {
                                    pickQcPhotos(if (qualityResult == "rework") "qc_issue_photo" else "qc_sample_photo")
                                },
                                onPreview = { context.startActivity(AttachmentPreviewActivity.localIntent(context, it.fileName, it.mimeType, it.bytes)) },
                                onRename = { index, selectedPhoto ->
                                    renamePhotoIndex = index
                                    renamePhotoBaseName = splitMaterialRecordFileName(selectedPhoto.fileName).baseName
                                },
                                onRemove = { photos.removeAt(it) }
                            )
                            if ("qc_measurement_photo" in qcSubmissionPhotoCategories(qualityResult)) {
                                QcPhotoSection(
                                    title = "尺寸表照片（选填）",
                                    description = "如需留档，可拍摄或选择尺寸表照片",
                                    photos = photos.withIndex().filter { it.value.category == "qc_measurement_photo" },
                                    totalPhotoCount = photos.size,
                                    loading = state.loading,
                                    onTakePhoto = { takeQcPhoto("qc_measurement_photo") },
                                    onPickPhotos = { pickQcPhotos("qc_measurement_photo") },
                                    onPreview = { context.startActivity(AttachmentPreviewActivity.localIntent(context, it.fileName, it.mimeType, it.bytes)) },
                                    onRename = { index, selectedPhoto ->
                                        renamePhotoIndex = index
                                        renamePhotoBaseName = splitMaterialRecordFileName(selectedPhoto.fileName).baseName
                                    },
                                    onRemove = { photos.removeAt(it) }
                                )
                            }
                        } else {
                            OutlinedTextField(
                                value = pieces,
                                onValueChange = { pieces = it },
                                label = { Text("完成件数") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )
                            OutlinedTextField(
                                value = workHours,
                                onValueChange = { workHours = it },
                                label = { Text("工时（小时）") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )
                            OutlinedTextField(
                                value = note,
                                onValueChange = { note = it },
                                label = {
                                    Text(if (completionNoteRequired(result.stage)) "完成备注（必填）" else "完成备注（选填）")
                                },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus() }),
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                        completionError?.let { ErrorText(it) }
                    }
                }
            }

            if (result.allowedAction == "takeover" || result.allowedAction == "choose_sewing_assignment") {
                item {
                    SurfaceCard {
                        Text("当前负责人：${result.activeTaskWorkerName ?: "-"}")
                        if (result.allowedAction == "choose_sewing_assignment") {
                            Text("请选择接替当前负责人，或作为协作者一起完成。", color = Muted)
                        }
                        OutlinedTextField(
                            value = note,
                            onValueChange = { note = it },
                            label = { Text("接替原因") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus() }),
                            modifier = Modifier.fillMaxWidth()
                        )
                        Button(
                            enabled = !state.loading && note.isNotBlank(),
                            onClick = { viewModel.takeoverWorkerScan(result, note.trim()) },
                            modifier = Modifier.fillMaxWidth()
                        ) { Text("替代当前缝制工") }
                    }
                }
            }

            if (result.allowedAction == "choose_sewing_assignment" || result.allowedAction == "join_collaboration") {
                item {
                    SurfaceCard {
                        Text("加入多人协作", fontWeight = FontWeight.SemiBold)
                        Text(
                            "加入后请在完成时填写自己的实际件数；计划件数由计划员单独协调。",
                            color = Muted,
                            fontSize = 12.sp
                        )
                        Button(
                            enabled = !state.loading,
                            onClick = { viewModel.joinCollaborativeSewing(result) },
                            modifier = Modifier.fillMaxWidth()
                        ) { Text("确认协作") }
                    }
                }
            }

            if (result.allowedAction !in setOf("blocked", "choose_sewing_assignment", "join_collaboration", "takeover") && !submissionTerminated) {
                item {
                    Button(
                        enabled = !state.loading,
                        onClick = {
                            when (result.allowedAction) {
                                "start" -> viewModel.startWorkerScan(result)
                                "complete" -> {
                                    if (result.stage == "qc_delivery") {
                                        val allowedPhotoCategories = qcSubmissionPhotoCategories(qualityResult)
                                        val evidencePhotos = photos.count {
                                            it.category in allowedPhotoCategories && it.category != "qc_measurement_photo"
                                        }
                                        val validationError = qcCompletionValidationError(
                                            pieces,
                                            qualityResult,
                                            qualityScore,
                                            note,
                                            evidencePhotos
                                        )
                                        if (validationError != null) {
                                            completionError = validationError
                                            return@Button
                                        }
                                        val evidenceCategory = if (qualityResult == "rework") {
                                            "qc_issue_photo"
                                        } else {
                                            "qc_sample_photo"
                                        }
                                        pendingQcCompletion = WorkerScanCompletion(
                                            pieces = pieces.toInt(),
                                            note = note.trim(),
                                            qualityResult = qualityResult,
                                            qualityScore = qualityScore.toIntOrNull()
                                                ?.takeIf { qualityResult == "qualified" },
                                            photos = photos.filter { photo ->
                                                photo.category in allowedPhotoCategories
                                            }.map { photo ->
                                                if (photo.category == "qc_measurement_photo") photo
                                                else photo.copy(category = evidenceCategory)
                                            }
                                        )
                                    } else {
                                        val pieceCount = pieces.toIntOrNull() ?: return@Button
                                        if (result.stage == "sewing" && pieceCount <= 0) {
                                            completionError = "缝制实际件数必须大于 0。"
                                            return@Button
                                        }
                                        val hours = workHours.toDoubleOrNull() ?: return@Button
                                        if (completionNoteRequired(result.stage) && note.isBlank()) return@Button
                                        viewModel.completeWorkerScan(
                                            result,
                                            WorkerScanCompletion(
                                                pieces = pieceCount,
                                                workHours = hours,
                                                note = note.trim()
                                            )
                                        )
                                    }
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            when (result.allowedAction) {
                                "start" -> "开始任务"
                                else -> when {
                                    result.stage == "qc_delivery" -> "核对并提交"
                                    else -> "提交工序完成"
                                }
                            }
                        )
                    }
                }
            }
            item {
                OutlinedButton(
                    onClick = viewModel::back,
                    modifier = Modifier.fillMaxWidth()
                ) { Text(if (result.entrySource == "sewing_task") "返回缝制中" else "返回角色首页") }
            }
        }
    }

    if (stageMismatchPromptVisible) {
        LaunchedEffect(result.token, result.blockedReason) {
            delay(5_000)
            dismissStageMismatchPrompt()
        }
        Dialog(onDismissRequest = dismissStageMismatchPrompt) {
            Card(
                modifier = Modifier.clickable(onClick = dismissStageMismatchPrompt),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                elevation = CardDefaults.cardElevation(defaultElevation = 12.dp)
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 30.dp, vertical = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(if (result.blockedReason == "terminated") "订单已终止" else "当前任务阶段", color = Navy, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text(stageMismatchPromptText(result), fontSize = 17.sp)
                    Text("点击提示或等待 5 秒后返回角色首页", color = Muted, fontSize = 12.sp)
                }
            }
        }
    }

    if (submissionTerminatedPromptVisible) {
        LaunchedEffect(result.token, state.error) {
            delay(5_000)
            dismissSubmissionTerminatedPrompt()
        }
        Dialog(onDismissRequest = dismissSubmissionTerminatedPrompt) {
            Card(
                modifier = Modifier.clickable(onClick = dismissSubmissionTerminatedPrompt),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                elevation = CardDefaults.cardElevation(defaultElevation = 12.dp)
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 30.dp, vertical = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("订单已终止", color = Navy, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text("点击提示或等待 5 秒后返回角色首页", color = Muted, fontSize = 12.sp)
                }
            }
        }
    }

    if (state.completionThanksVisible) {
        LaunchedEffect(Unit) {
            delay(1_000)
            viewModel.finishCompletionThanks()
        }
        Dialog(onDismissRequest = viewModel::finishCompletionThanks) {
            Card(
                modifier = Modifier.clickable(onClick = viewModel::finishCompletionThanks),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                elevation = CardDefaults.cardElevation(defaultElevation = 12.dp)
            ) {
                Text(
                    state.completionThanksText,
                    color = Navy,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 42.dp, vertical = 28.dp)
                )
            }
        }
    }

    if (state.taskAcceptedVisible) {
        LaunchedEffect(Unit) {
            delay(1_000)
            viewModel.finishTaskAccepted()
        }
        Dialog(onDismissRequest = viewModel::finishTaskAccepted) {
            Card(
                modifier = Modifier.clickable(onClick = viewModel::finishTaskAccepted),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                elevation = CardDefaults.cardElevation(defaultElevation = 12.dp)
            ) {
                Text(
                    "已接单",
                    color = Navy,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 48.dp, vertical = 28.dp)
                )
            }
        }
    }

    pendingQcCompletion?.let { completion ->
        val isRework = completion.qualityResult == "rework"
        AlertDialog(
            onDismissRequest = { if (!state.loading) pendingQcCompletion = null },
            title = { Text(if (isRework) "确认需要返工？" else "确认合格并完成？") },
            text = {
                Text(
                    if (isRework) {
                        "实收 ${completion.pieces} 件。提交后会记录本次返工，订单继续等待原组检员工复检。"
                    } else {
                        "实收 ${completion.pieces} 件，质量评分 ${completion.qualityScore} 分。提交后订单进入已完成。"
                    }
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !state.loading,
                    onClick = {
                        pendingQcCompletion = null
                        viewModel.completeWorkerScan(result, completion)
                    }
                ) { Text(if (isRework) "确认返工" else "确认完成") }
            },
            dismissButton = {
                TextButton(
                    enabled = !state.loading,
                    onClick = { pendingQcCompletion = null }
                ) { Text("返回核对") }
            }
        )
    }


    renamePhotoIndex?.let { index ->
        val selectedPhoto = photos.getOrNull(index)
        if (selectedPhoto != null) {
            val extension = splitMaterialRecordFileName(selectedPhoto.fileName).extension
            AlertDialog(
                onDismissRequest = { renamePhotoIndex = null },
                title = { Text("修改照片名称") },
                text = {
                    Column {
                        OutlinedTextField(
                            value = renamePhotoBaseName,
                            onValueChange = { renamePhotoBaseName = it },
                            label = { Text("文件名") },
                            singleLine = true
                        )
                        Text("扩展名 $extension 保持不变", color = Muted, fontSize = 12.sp)
                    }
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            val error = validateMaterialRecordFileName(renamePhotoBaseName, extension)
                            if (error == null) {
                                photos[index] = renameMaterialRecordUpload(selectedPhoto, renamePhotoBaseName)
                                renamePhotoIndex = null
                                photoError = null
                            } else {
                                photoError = error
                            }
                        }
                    ) { Text("保存") }
                },
                dismissButton = {
                    TextButton(onClick = { renamePhotoIndex = null }) { Text("取消") }
                }
            )
        }
    }

    if (previousReworkOpen) {
        val rework = result.latestRework
        if (rework != null) {
            Dialog(onDismissRequest = { previousReworkOpen = false }) {
                Surface(
                    modifier = Modifier.fillMaxWidth().heightIn(max = 620.dp),
                    color = Color.White,
                    shape = RoundedCornerShape(22.dp),
                    shadowElevation = 14.dp
                ) {
                    Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text("上一次返工记录", color = Navy, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                            IconButton(onClick = { previousReworkOpen = false }) { Icon(Icons.Default.Close, "关闭", tint = Navy) }
                        }
                        Surface(color = Color(0xFFFFF7ED), shape = RoundedCornerShape(12.dp)) {
                            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("返工原因", color = Color(0xFF9A4A0A), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                Text(rework.note.ifBlank { "未填写" }, color = Navy, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                            }
                        }
                        if (rework.photos.isNotEmpty()) {
                            Text("返工照片（点击临时预览）", color = Navy, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                            LazyColumn(
                                modifier = Modifier.fillMaxWidth().heightIn(max = 300.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                items(rework.photos.chunked(3)) { photosInRow ->
                                    Row(
                                        Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        photosInRow.forEach { photo ->
                                            AsyncImage(
                                                model = authenticatedPreviewRequest(context, state, photo.previewUrl),
                                                contentDescription = photo.fileName,
                                                contentScale = ContentScale.Crop,
                                                modifier = Modifier.weight(1f).height(92.dp)
                                                    .clip(RoundedCornerShape(8.dp))
                                                    .background(Color(0xFFF1F5F9))
                                                    .clickable {
                                                        val session = state.session ?: return@clickable
                                                        val url = if (photo.previewUrl.startsWith("http")) photo.previewUrl
                                                        else "${session.endpoint.baseUrl.trimEnd('/')}/${photo.previewUrl.trimStart('/')}"
                                                        context.startActivity(Intent(context, AttachmentPreviewActivity::class.java)
                                                            .putExtra(AttachmentPreviewActivity.EXTRA_URL, url)
                                                            .putExtra(AttachmentPreviewActivity.EXTRA_TOKEN, session.token)
                                                            .putExtra(AttachmentPreviewActivity.EXTRA_FILE_NAME, photo.fileName))
                                                    }
                                            )
                                        }
                                        repeat(3 - photosInRow.size) { Spacer(Modifier.weight(1f)) }
                                    }
                                }
                            }
                        } else {
                            Text("返工照片", color = Navy, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                            Text("暂无返工照片", color = Muted, modifier = Modifier.background(Color(0xFFF6F8FB), RoundedCornerShape(10.dp)).padding(12.dp).fillMaxWidth())
                        }
                        OutlinedButton(onClick = { previousReworkOpen = false }, modifier = Modifier.fillMaxWidth()) { Text("关闭") }
                    }
                }
            }
        }
    }

}

private fun authenticatedPreviewRequest(context: Context, state: AppState, path: String): ImageRequest? {
    val session = state.session ?: return null
    val url = if (path.startsWith("http://") || path.startsWith("https://")) {
        path
    } else {
        "${session.endpoint.baseUrl.trimEnd('/')}/${path.trimStart('/')}"
    }
    return ImageRequest.Builder(context)
        .data(url)
        .headers(Headers.Builder().add("Authorization", "Bearer ${session.token}").build())
        .crossfade(true)
        .build()
}

internal fun refreshedImageUrl(url: String, contentRevision: Long): String {
    if (url.isBlank() || contentRevision <= 0L) return url
    val separator = if ('?' in url) '&' else '?'
    return "$url${separator}androidRefresh=$contentRevision"
}

@Composable
private fun SewingResultOrderCard(state: AppState, result: ScanResult) {
    val order = result.order
    val collaboration = result.collaborationParticipationId.isNotBlank()
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, Color(0xFFE3EAF4)),
        elevation = CardDefaults.cardElevation(3.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            AuthenticatedTaskThumbnail(
                state,
                order.thumbnailUrl,
                "${order.styleNo} 款式缩略图",
                112.dp
            )
            Column(
                Modifier.weight(1f).padding(start = 16.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp)
            ) {
                AutoFitSingleLineText(
                    text = order.styleNo.ifBlank { "未录入款号" },
                    color = Color(0xFF101D33),
                    maxFontSize = 24.sp,
                    minFontSize = 8.sp,
                    fontWeight = FontWeight.Bold
                )
                AutoFitSingleLineText(
                    text = order.styleName.ifBlank { "-" },
                    color = Muted,
                    maxFontSize = 17.sp,
                    minFontSize = 8.sp
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Inventory2, null, tint = Muted, modifier = Modifier.size(19.dp))
                    Text("数量", color = Muted, modifier = Modifier.padding(start = 8.dp))
                    Text(order.quantity.toString(), fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 24.dp))
                }
                if (collaboration) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Inventory2, null, tint = Teal, modifier = Modifier.size(19.dp))
                        Text("我的任务", color = Teal, modifier = Modifier.padding(start = 8.dp))
                        Text(
                            "参与缝制",
                            color = Teal,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(start = 12.dp)
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Repeat, null, tint = Muted, modifier = Modifier.size(19.dp))
                    Text("样品轮次", color = Muted, modifier = Modifier.padding(start = 8.dp))
                    Surface(
                        color = Color(0xFFEDF5FF),
                        shape = RoundedCornerShape(7.dp),
                        modifier = Modifier.padding(start = 12.dp)
                    ) {
                        Text(sampleRoundText(order.sampleRound), color = Teal, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.AttachFile, null, tint = Muted, modifier = Modifier.size(19.dp))
                    Text("样品类型", color = Muted, modifier = Modifier.padding(start = 8.dp))
                    Surface(
                        color = Color(0xFFEDF5FF),
                        shape = RoundedCornerShape(7.dp),
                        modifier = Modifier.padding(start = 12.dp)
                    ) {
                        Text(sampleTypeText(order.sampleType), color = Teal, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun QcResultOrderCard(
    state: AppState,
    result: ScanResult,
    onOpenRework: () -> Unit
) {
    val order = result.order
    val rework = result.latestRework
    if (rework != null) {
        QcReworkSummaryCard(
            state = state,
            thumbnailPath = order.thumbnailUrl,
            styleNo = order.styleNo,
            styleName = order.styleName,
            quantity = order.quantity,
            sampleType = sampleTypeText(order.sampleType),
            reworkReason = rework.note,
            submittedAt = mobileRecordTime(rework.eventTime),
            onReasonClick = onOpenRework
        )
        return
    }
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(13.dp),
        border = BorderStroke(1.dp, Color(0xFFE6EBF2)),
        elevation = CardDefaults.cardElevation(3.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            AuthenticatedTaskThumbnail(state, order.thumbnailUrl, "${order.styleNo} 款式缩略图", 104.dp)
                Column(Modifier.weight(1f).padding(start = 14.dp)) {
                CompactStyleIdentity(
                    styleNo = order.styleNo,
                    styleName = order.styleName,
                    maxFontSize = 16.sp,
                    minFontSize = 7.sp,
                    showLabels = false,
                    maxLinesEach = 1
                )
                Row(
                    Modifier.padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("件数：", color = Color(0xFF334155), fontSize = 13.sp)
                    Text("${order.quantity} 件", color = Teal, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    Surface(color = Color(0xFFEDF5FF), shape = RoundedCornerShape(5.dp)) {
                        Text(sampleTypeText(order.sampleType), color = Teal, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp))
                    }
                }
                val submittedAt = order.recordSubmittedAt
                if (submittedAt.isNotBlank()) {
                    Text(
                        "◷ 记录提交时间：${mobileRecordTime(submittedAt)}",
                        color = Muted,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
            }
        }
    }
}

@Composable
internal fun QcReworkSummaryCard(
    state: AppState? = null,
    thumbnailPath: String = "",
    styleNo: String,
    styleName: String,
    quantity: Int,
    sampleType: String,
    reworkReason: String,
    submittedAt: String,
    onClick: (() -> Unit)? = null,
    onReasonClick: (() -> Unit)? = null
) {
    val clickModifier = if (onClick == null) Modifier else Modifier.clickable(onClick = onClick)
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, Color(0xFFE3EAF4)),
        elevation = CardDefaults.cardElevation(3.dp),
        modifier = Modifier.fillMaxWidth().then(clickModifier)
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                if (state != null) {
                    AuthenticatedTaskThumbnail(state, thumbnailPath, "$styleNo 款式缩略图", 92.dp)
                }
                Column(Modifier.weight(1f).padding(start = if (state == null) 0.dp else 12.dp)) {
                    CompactStyleIdentity(
                        styleNo = styleNo,
                        styleName = styleName,
                        maxFontSize = 16.sp,
                        minFontSize = 7.sp,
                        showLabels = false,
                        maxLinesEach = 1
                    )
                    Row(
                        Modifier.padding(top = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(7.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("件数：", color = Muted, fontSize = 13.sp)
                        Text("$quantity 件", color = Teal, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        Surface(color = Color(0xFFEDF5FF), shape = RoundedCornerShape(7.dp)) {
                            Text(sampleType, color = Teal, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
                        }
                    }
                }
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 18.dp)
                    .background(Color(0xFFFFF8F7), RoundedCornerShape(12.dp))
                    .then(if (onReasonClick == null) Modifier else Modifier.clickable(onClick = onReasonClick))
                    .padding(13.dp),
                verticalAlignment = Alignment.Top
            ) {
                Surface(color = Color(0xFFFFECEA), shape = RoundedCornerShape(7.dp)) {
                    Text(
                        "返工原因：",
                        color = Color(0xFFF04438),
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(horizontal = 9.dp, vertical = 6.dp)
                    )
                }
                Text(
                    reworkReason.ifBlank { "未填写" },
                    color = Color(0xFF24364D),
                    fontSize = 15.sp,
                    lineHeight = 22.sp,
                    maxLines = 5,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).padding(start = 10.dp, top = 4.dp)
                )
            }
            HorizontalDivider(Modifier.padding(top = 18.dp, bottom = 12.dp), color = DividerColor)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.AccessTime, null, tint = Muted, modifier = Modifier.size(17.dp))
                Text(
                    "返工记录提交时间：${submittedAt.ifBlank { "-" }}",
                    color = Muted,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(start = 7.dp)
                )
            }
        }
    }
}

@Composable
private fun AuthenticatedTaskThumbnail(state: AppState, path: String, description: String, size: androidx.compose.ui.unit.Dp) {
    val context = LocalContext.current
    val session = state.session
    val url = session?.let { "${it.endpoint.baseUrl.trimEnd('/')}/${path.trimStart('/')}" }
    Box(
        Modifier.size(size).clip(RoundedCornerShape(10.dp)).background(Color(0xFFF1F5F9))
            .then(if (session == null || url == null || path.isBlank()) Modifier else Modifier.clickable {
                context.startActivity(
                    Intent(context, AttachmentPreviewActivity::class.java)
                        .putExtra(AttachmentPreviewActivity.EXTRA_URL, url)
                        .putExtra(AttachmentPreviewActivity.EXTRA_TOKEN, session.token)
                        .putExtra(AttachmentPreviewActivity.EXTRA_FILE_NAME, description)
                )
            }),
        contentAlignment = Alignment.Center
    ) {
        Icon(Icons.Default.Inventory2, null, tint = Color(0xFF94A3B8))
        if (session != null && url != null && path.isNotBlank()) {
            AsyncImage(
                model = ImageRequest.Builder(context).data(url)
                    .headers(Headers.Builder().add("Authorization", "Bearer ${session.token}").build())
                    .crossfade(true)
                    .build(),
                contentDescription = description,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        }
    }
}

private fun mobileRecordTime(value: String) = value.replace("T", " ").take(16).ifBlank { "-" }

@Composable
private fun QcPhotoSection(
    title: String,
    description: String,
    photos: List<IndexedValue<UploadPayload>>,
    totalPhotoCount: Int,
    loading: Boolean,
    onTakePhoto: () -> Unit,
    onPickPhotos: () -> Unit,
    onPreview: (UploadPayload) -> Unit,
    onRename: (Int, UploadPayload) -> Unit,
    onRemove: (Int) -> Unit
) {
    var menuOpen by remember { mutableStateOf(false) }
    Text(title, color = Navy, fontWeight = FontWeight.SemiBold)
    Text(description, color = Muted, fontSize = 12.sp)
    Box {
        OutlinedButton(
            onClick = { menuOpen = true },
            enabled = totalPhotoCount < 10 && !loading,
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(Icons.Default.CameraAlt, null)
            Spacer(Modifier.width(8.dp))
            Text(if (totalPhotoCount < 10) "添加照片（共 $totalPhotoCount/10）" else "已达10张上限")
        }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            DropdownMenuItem(
                text = { Text("连续拍照") },
                onClick = {
                    menuOpen = false
                    onTakePhoto()
                }
            )
            DropdownMenuItem(
                text = { Text("从相册选择") },
                onClick = {
                    menuOpen = false
                    onPickPhotos()
                }
            )
        }
    }
    photos.forEach { indexedPhoto ->
        val selectedPhoto = indexedPhoto.value
        Surface(
            shape = RoundedCornerShape(10.dp),
            border = BorderStroke(1.dp, Color(0xFFE2E8EC)),
            color = Color.White
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                AsyncImage(
                    model = ImageRequest.Builder(LocalContext.current).data(selectedPhoto.bytes).build(),
                    contentDescription = selectedPhoto.fileName,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(64.dp).clip(RoundedCornerShape(8.dp))
                        .clickable { onPreview(selectedPhoto) }
                )
                Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                    Text(selectedPhoto.fileName, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("点击缩略图预览", color = Muted, fontSize = 12.sp)
                }
                Column(horizontalAlignment = Alignment.End) {
                    TextButton(
                        enabled = !loading,
                        onClick = { onRename(indexedPhoto.index, selectedPhoto) }
                    ) { Text("修改名称", fontSize = 12.sp) }
                    TextButton(
                        enabled = !loading,
                        onClick = { onRemove(indexedPhoto.index) }
                    ) { Text("移除", color = Color(0xFFA82E2E), fontSize = 12.sp) }
                }
            }
        }
    }
}

@Composable
private fun PlaceholderPage(state: AppState, title: String, message: String, onLogout: () -> Unit) {
    AppScaffold(title, state, onLogout = onLogout) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) { SurfaceCard { Text(title, fontSize = 22.sp, fontWeight = FontWeight.Bold); Text(message, color = Muted, modifier = Modifier.padding(top = 8.dp)) } }
    }
}

@Composable
private fun CompactFilter(
    emptyLabel: String,
    value: String,
    options: List<String>,
    display: (String) -> String,
    modifier: Modifier = Modifier,
    onSelect: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { expanded = true }, shape = RoundedCornerShape(8.dp), modifier = modifier) {
            Text(if (value.isBlank()) emptyLabel else display(value), maxLines = 1)
            Icon(Icons.Default.KeyboardArrowDown, null)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(text = { Text(emptyLabel) }, onClick = { onSelect(""); expanded = false })
            options.forEach { option ->
                DropdownMenuItem(text = { Text(display(option)) }, onClick = { onSelect(option); expanded = false })
            }
        }
    }
}

@Composable
private fun DateFilterField(label: String, value: String, modifier: Modifier = Modifier, onSelect: (String) -> Unit) {
    val context = LocalContext.current
    val selected = runCatching { java.time.LocalDate.parse(value) }.getOrElse { java.time.LocalDate.now() }
    OutlinedButton(
        onClick = {
            DatePickerDialog(
                context,
                { _, year, month, day ->
                    onSelect(java.time.LocalDate.of(year, month + 1, day).toString())
                },
                selected.year,
                selected.monthValue - 1,
                selected.dayOfMonth
            ).show()
        },
        shape = RoundedCornerShape(8.dp),
        modifier = modifier
    ) {
        Text(value.ifBlank { label }, maxLines = 1)
    }
}

@Composable
private fun DetailTab(label: String, selected: Boolean, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(label, color = if (selected) BrightBlue else Color(0xFF202630), fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
        Box(Modifier.padding(top = 8.dp).height(3.dp).width(54.dp).background(if (selected) BrightBlue else Color.Transparent))
    }
}

@Composable
private fun StatusPill(label: String, modifier: Modifier = Modifier) {
    Surface(color = Color(0xFFFFF3E6), shape = RoundedCornerShape(18.dp), modifier = modifier) {
        Text(label.ifBlank { "待处理" }, color = Color(0xFFE97812), fontSize = 13.sp, modifier = Modifier.padding(horizontal = 11.dp, vertical = 5.dp))
    }
}

@Composable
private fun InfoCell(label: String, value: String, modifier: Modifier = Modifier, maxLines: Int = 2) {
    Column(modifier.padding(bottom = 12.dp)) {
        Text(label, color = Muted, fontSize = 13.sp)
        Text(value.ifBlank { "-" }, fontSize = 15.sp, modifier = Modifier.padding(top = 4.dp), maxLines = maxLines, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun IconLabelValue(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, value: String) {
    Row(Modifier.padding(bottom = 13.dp), verticalAlignment = Alignment.Top) {
        Icon(icon, null, tint = BrightBlue)
        Column(Modifier.padding(start = 8.dp)) {
            Text(label, color = Muted, fontSize = 13.sp)
            Text(value.ifBlank { "-" }, modifier = Modifier.padding(top = 3.dp))
        }
    }
}

@Composable
private fun MaterialAttachmentCard(attachment: MobileAttachment) {
    Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(15.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Inventory2, null, tint = BrightBlue)
                Text("接单员上传 / 面辅料记录", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 8.dp).weight(1f))
                Text(dateTimeText(attachment.createdAt), color = Muted, fontSize = 12.sp)
            }
            Surface(color = Color(0xFFF6F8FB), shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.AttachFile, null, tint = BrightBlue)
                    Text(attachment.fileName, modifier = Modifier.padding(start = 8.dp).weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            Text("上传人：${attachment.uploadedByName.ifBlank { attachment.uploadedByRole }}", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 9.dp))
        }
    }
}

internal fun attachmentMatchesFilters(
    fileName: String,
    mimeType: String,
    uploaderName: String,
    uploaderRole: String,
    query: String,
    typeFilter: String,
    roleFilter: String,
    extraSearchText: String = ""
): Boolean {
    val queryMatches = query.isBlank() || listOf(
        fileName,
        uploaderName,
        uploaderRole,
        orderChargeRoleLabel(uploaderRole),
        extraSearchText
    ).any { it.contains(query.trim(), ignoreCase = true) }
    val typeMatches = typeFilter.isBlank() || attachmentType(mimeType, fileName) == typeFilter
    val roleMatches = roleFilter.isBlank() || uploaderRole == roleFilter
    return queryMatches && typeMatches && roleMatches
}

private fun attachmentType(mimeType: String, fileName: String): String = when {
    mimeType.startsWith("image/", ignoreCase = true) -> "image"
    mimeType.equals("application/pdf", ignoreCase = true) || fileName.endsWith(".pdf", ignoreCase = true) -> "pdf"
    else -> "other"
}

private fun attachmentMimeFromName(fileName: String): String = when {
    fileName.endsWith(".pdf", ignoreCase = true) -> "application/pdf"
    listOf(".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp").any { fileName.endsWith(it, ignoreCase = true) } -> "image/*"
    else -> "application/octet-stream"
}

private fun attachmentTypeLabel(value: String) = when (value) {
    "image" -> "图片"
    "pdf" -> "PDF"
    "other" -> "其他文件"
    else -> value
}

private fun attachmentCategoryLabel(category: String) = when (category) {
    "receiver_order_form", "client_order_form", "pattern_order_form", "receiver_sample_sheet",
    "receiver_quick_photo", "client_quick_photo" -> "打样单附件"
    "size_chart" -> "尺寸表附件"
    "style_thumbnail" -> "款式缩略图"
    "defect_photo" -> "瑕疵附件"
    "receiver_material_record" -> "面辅料附件"
    "planner_upload", "sample_room_upload", "receiver_attachment", "client_reference",
    "client_upload", "other" -> "其他附件"
    else -> "其他附件"
}

internal fun countedDetailTabLabel(label: String, count: Int) =
    if (count > 0) "$label $count" else label

private fun entryDate(value: String) = value.take(10).ifBlank { "-" }
private fun dateTimeText(value: String) = value.replace("T", " ").take(16).ifBlank { "-" }
private fun orderChargeRoleLabel(value: String) = when (value) {
    "client" -> "客户"
    "receiver" -> "接单员"
    "planner" -> "计划员"
    "pattern_maker" -> "版师"
    "worker" -> "工序员工"
    "boss" -> "老板"
    "system_owner" -> "System Owner"
    else -> value
}
private fun stageText(value: String) = when (value) {
    "pending_receive" -> "待接单"
    "pending_pattern", "pattern_waiting" -> "待制版"
    "pattern_making", "pattern_doing" -> "制版中"
    "pattern_complete" -> "制版完成"
    "cutting_waiting" -> "待裁剪"
    "cutting", "cutting_doing" -> "裁剪中"
    "sewing_waiting" -> "待缝制"
    "sewing", "sewing_doing" -> "缝制中"
    "qc_delivery_waiting" -> "待组检/出库"
    "qc_delivery" -> "组检/出库"
    "completed", "done" -> "已完成"
    else -> value.ifBlank { "待处理" }
}
private fun materialText(value: String) = when (value) {
    "ready", "complete" -> "全齐"
    "partial" -> "部分到"
    "not_ready", "missing" -> "未齐"
    else -> value.ifBlank { "未确认" }
}
private fun sampleTypeText(value: String) = when (value) { "initial", "first_sample" -> "初样"; "repeat", "fit_sample" -> "试身样"; "revision_sample" -> "修改样"; "pre_production_sample" -> "产前样"; "sales_sample" -> "销售样"; else -> value.ifBlank { "-" } }
private fun sampleRoundText(value: String) = when (value) { "first", "round_1" -> "第 1 轮"; "second", "round_2" -> "第 2 轮"; "third", "round_3" -> "第 3 轮"; "round_4" -> "第 4 轮"; else -> value.ifBlank { "-" } }
private fun requestText(value: String) = when (value) {
    "sample_garment" -> "生产样衣"
    "production_sample", "sample_small" -> "生产小样"
    "pattern_making" -> "制版"
    "pattern_revision" -> "改版"
    "full_size_pattern", "pattern_full_size" -> "推全码版"
    "quotation_material", "quote_material_check" -> "报价核料"
    "bulk_material", "bulk_material_check" -> "大货核料"
    "replenishment_consumption", "pattern_padding_amount" -> "充棉/绒量"
    "check_chain_length", "pattern_zipper_length" -> "核拉链长度"
    "cutting" -> "裁剪"
    else -> value
}
private fun patternStatusText(value: String) = when (value) {
    "pending" -> "待领取"
    "active" -> "进行中"
    "paused" -> "已暂停"
    "completed" -> "已完成"
    else -> value.ifBlank { "-" }
}

internal fun completionNoteRequired(stage: String?) = false

internal fun qcCompletionValidationError(
    piecesText: String,
    qualityResult: String,
    qualityScoreText: String,
    note: String,
    evidencePhotoCount: Int
): String? {
    val pieces = piecesText.toIntOrNull()
    if (pieces == null || pieces < 0) return "请输入有效的实收件数。"
    return when (qualityResult) {
        "qualified" -> {
            val score = qualityScoreText.toIntOrNull()
            when {
                score == null || score !in 0..100 -> "质量评分必须是 0–100 的整数。"
                evidencePhotoCount < 1 -> "合格时请至少上传一张最终样衣照片。"
                else -> null
            }
        }
        "rework" -> if (note.isBlank()) "请填写明确的返工原因。" else null
        else -> "请选择合格或需要返工。"
    }
}

internal fun qcSubmissionPhotoCategories(qualityResult: String) = when (qualityResult) {
    "qualified" -> setOf("qc_sample_photo", "qc_measurement_photo")
    "rework" -> setOf("qc_issue_photo")
    else -> emptySet()
}

private val BrightBlue = Teal
private val DividerColor = Color(0xFFE3E8EF)
private val WarningBackground = Color(0xFFFFF8EE)
private val WarningBorder = Color(0xFFFFD9A3)
private val WarningText = Color(0xFFF07818)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppScaffold(
    title: String,
    state: AppState,
    onBack: (() -> Unit)? = null,
    onLogout: (() -> Unit)? = null,
    homeNavigation: Boolean = false,
    onRefresh: (() -> Unit)? = null,
    extraActions: @Composable RowScope.() -> Unit = {},
    content: @Composable (androidx.compose.foundation.layout.PaddingValues) -> Unit
) {
    Scaffold(
        containerColor = PageBackground,
        topBar = {
            TopAppBar(
                title = { Text(title, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold) },
                navigationIcon = { if (onBack != null) IconButton(onClick = onBack) { Icon(if (homeNavigation) Icons.Default.Home else Icons.AutoMirrored.Filled.ArrowBack, if (homeNavigation) "功能首页" else "返回", tint = Color.White) } },
                actions = {
                    extraActions()
                    if (onLogout != null) IconButton(onClick = onLogout) { Icon(Icons.AutoMirrored.Filled.Logout, "退出", tint = Color.White) }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Navy)
            )
        },
        content = { padding ->
            if (onRefresh != null) {
                PullToRefreshBox(
                    isRefreshing = state.refreshing,
                    onRefresh = onRefresh,
                    modifier = Modifier.fillMaxSize()
                ) { content(padding) }
            } else {
                content(padding)
            }
        }
    )
}

@Composable private fun IdentityCard(state: AppState) = SurfaceCard {
    val identity = state.session?.identity
    Text(identity?.displayName ?: "未登录", color = Navy, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
    DetailRow(
        "角色",
        if (identity?.role == "worker") workerStageLabel(identity.activeWorkerType.orEmpty()) else phoneRoleLabel(identity?.role)
    )
}

@Composable
internal fun RoleGreetingCard(state: AppState) {
    val identity = state.session?.identity
    val displayName = identity?.displayName?.takeIf { it.isNotBlank() } ?: "伙伴"
    val greetingFontSize = when {
        displayName.length <= 6 -> 24.sp
        displayName.length <= 10 -> 21.sp
        displayName.length <= 14 -> 18.sp
        else -> 16.sp
    }
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.Transparent),
        shape = RoundedCornerShape(18.dp),
        elevation = CardDefaults.cardElevation(3.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .background(
                    Brush.horizontalGradient(
                        listOf(Color.White, Color(0xFFF4F8FF), Color(0xFFEAF2FF))
                    )
                )
                .padding(horizontal = 20.dp, vertical = 18.dp)
        ) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .size(76.dp)
                    .background(Color(0x1A2B6FE8), RoundedCornerShape(38.dp))
            )
            Row(
                Modifier.align(Alignment.BottomEnd).padding(end = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                repeat(3) { index ->
                    Box(
                        Modifier
                            .size((8 + index * 4).dp)
                            .background(Color(0x263E7BE8), RoundedCornerShape(10.dp))
                    )
                }
            }
            Column(Modifier.fillMaxWidth().padding(end = 46.dp)) {
                Text(
                    "你好呀，$displayName",
                    color = Navy,
                    fontSize = greetingFontSize,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    softWrap = false,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    "欢迎回来，今天也一起高效安排工作吧",
                    color = Muted,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
        }
    }
}

private fun phoneRoleLabel(role: String?) = when (role) {
    "planner" -> "计划员"
    "worker" -> "工序员工"
    else -> role ?: "-"
}

private fun attachmentUploaderText(attachment: MobileAttachment): String {
    val name = attachment.uploadedByName.ifBlank { "未知上传人" }
    return "$name · ${orderChargeRoleLabel(attachment.uploadedByRole)}"
}

private fun workerStageLabel(stage: String) = when (stage) {
    "cutting" -> "裁剪"
    "sewing" -> "缝制"
    "qc_delivery" -> "组检/出库"
    else -> stage
}

@Composable internal fun OrderCard(
    state: AppState,
    order: MobileOrder,
    kind: String,
    productionPlan: Boolean = false,
    onOpen: () -> Unit,
    onAddMaterial: () -> Unit,
    onAddCharge: (() -> Unit)? = null
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(14.dp),
        elevation = CardDefaults.cardElevation(3.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                if (kind == "planner") {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        OrderThumbnail(state, order, kind, 84.dp)
                        StatusPill(stageText(order.stageLabel), Modifier.padding(top = 6.dp))
                    }
                } else {
                    OrderThumbnail(state, order, kind, 84.dp)
                }
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    Row(verticalAlignment = Alignment.Top) {
                        CompactStyleIdentity(
                            styleNo = order.styleNo,
                            styleName = order.styleName,
                            modifier = Modifier.weight(1f),
                            maxFontSize = 17.sp,
                            minFontSize = 7.sp,
                            maxLinesEach = 1
                        )
                        if (kind != "planner") {
                            Spacer(Modifier.width(8.dp))
                            StatusPill(stageText(order.stageLabel))
                        }
                    }
                    Text("接单日期 ${entryDate(order.createdAt)}", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 7.dp))
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 10.dp), color = DividerColor)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                InfoCell("客户", order.customerName, Modifier.weight(1f))
                InfoCell("业务员", order.salespersonName, Modifier.weight(1f))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                InfoCell("样品类型 / 轮次", "${sampleTypeText(order.sampleType)} / ${sampleRoundText(order.sampleRound)}", Modifier.weight(1f))
                InfoCell("面里料 / 辅料", "${materialText(order.fabricStatus)} / ${materialText(order.trimStatus)}", Modifier.weight(1f))
            }
            InfoCell(
                "打样要求",
                order.sampleRequestItems.joinToString("、") { requestText(it) }.ifBlank { "-" },
                Modifier.fillMaxWidth()
            )
            if (productionPlan) {
                HorizontalDivider(Modifier.padding(bottom = 8.dp), color = DividerColor)
                DetailRow("进入缝制", entryDate(order.activeWorkerStartedAt))
                DetailRow("缝制员工", order.activeWorkerName.ifBlank { "尚未扫码开始" })
            }
            Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (kind == "receiver") {
                    OutlinedButton(onClick = onOpen, modifier = Modifier.weight(1f)) { Text("查看详情") }
                    Button(onClick = onAddMaterial, modifier = Modifier.weight(1f)) { Text("面辅料记录") }
                } else if (kind == "planner" && onAddCharge != null) {
                    OutlinedButton(onClick = onOpen, modifier = Modifier.weight(1f)) { Text("查看详情") }
                    Button(onClick = onAddCharge, modifier = Modifier.weight(1f)) { Text(addChargeButtonLabel(order.chargeCount)) }
                } else {
                    Spacer(Modifier.weight(1f))
                    OutlinedButton(onClick = onOpen) { Text("查看详情") }
                }
            }
            if (kind == "client" && order.tasks.isNotEmpty()) {
                Text("订单任务", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
                Text("已完成 ${order.tasks.count { it.completed }} / ${order.tasks.size}", color = Muted)
            }
        }
    }
}

@Composable
private fun OrderThumbnail(state: AppState, order: MobileOrder, kind: String, size: androidx.compose.ui.unit.Dp) {
    val context = LocalContext.current
    val session = state.session
    val attachmentId = order.thumbnailAttachmentId
    val rolePath = if (kind.startsWith("planner")) "planner" else "receiver"
    val url = if (session != null && attachmentId.isNotBlank()) {
        "${session.endpoint.baseUrl.trimEnd('/')}/api/miniapp/$rolePath/orders/${order.id}/attachments/$attachmentId/download"
    } else null
    Box(
        Modifier.size(size).clip(RoundedCornerShape(10.dp)).background(Color(0xFFF0F4F8))
            .then(if (url == null || session == null) Modifier else Modifier.clickable {
                context.startActivity(
                    Intent(context, AttachmentPreviewActivity::class.java)
                        .putExtra(AttachmentPreviewActivity.EXTRA_URL, url)
                        .putExtra(AttachmentPreviewActivity.EXTRA_TOKEN, session.token)
                        .putExtra(AttachmentPreviewActivity.EXTRA_FILE_NAME, "${order.styleNo.ifBlank { "订单" }}-款式缩略图")
                )
            }),
        contentAlignment = Alignment.Center
    ) {
        Icon(Icons.Default.Inventory2, "订单缩略图", tint = Muted, modifier = Modifier.size(30.dp))
        if (url != null && session != null) {
            AsyncImage(
                model = ImageRequest.Builder(context)
                    .data(url)
                    .headers(Headers.Builder().add("Authorization", "Bearer ${session.token}").build())
                    .crossfade(true)
                    .build(),
                contentDescription = "${order.styleNo} ${order.styleName} 缩略图",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        }
    }
}

private fun orderTitle(order: MobileOrder): String = listOf(order.styleNo, order.styleName)
    .filter { it.isNotBlank() }
    .joinToString(" · ")
    .ifBlank { "未命名款式" }

internal fun addChargeButtonLabel(count: Int) = if (count > 0) "追加费用 $count" else "追加费用"

@Composable
private fun ProgressSummaryCard(label: String, count: Int, modifier: Modifier = Modifier) {
    Surface(
        color = Color(0xFFF8FAFC),
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, Color(0xFFDCE5F0)),
        modifier = modifier
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 13.dp)) {
            Text(label, color = Muted, fontSize = 13.sp)
            Text(count.toString(), color = Navy, fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

@Composable
private fun EntryCard(title: String, description: String, onClick: () -> Unit, featured: Boolean = false) =
    Card(
        colors = CardDefaults.cardColors(containerColor = if (featured) Color(0xFFF0F5FD) else Color.White),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, if (featured) Color(0xFF9DBBEA) else Color(0xFFDCE5F0)),
        elevation = CardDefaults.cardElevation(defaultElevation = if (featured) 3.dp else 1.dp),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 17.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title, color = if (featured) Navy else Color(0xFF1E293B), fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                Text(description, color = Muted, fontSize = 14.sp, modifier = Modifier.padding(top = 5.dp))
            }
            Icon(Icons.Default.ChevronRight, null, tint = Teal)
        }
    }

@Composable private fun SurfaceCard(content: @Composable ColumnScope.() -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, Color(0xFFDCE5F0)),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(18.dp), content = content)
    }
}

@Composable private fun DetailRow(label: String, value: String) = Row(Modifier.fillMaxWidth().padding(top = 7.dp), horizontalArrangement = Arrangement.SpaceBetween) {
    Text(label, color = Muted, fontSize = 14.sp, modifier = Modifier.weight(0.42f))
    Text(value.ifBlank { "-" }, fontSize = 14.sp, modifier = Modifier.weight(0.58f))
}

@Composable private fun Notice(message: String) = Box(Modifier.fillMaxWidth().background(Color(0xFFEDF7FB), RoundedCornerShape(8.dp)).padding(12.dp)) { Text(message, color = Color(0xFF375466), fontSize = 14.sp) }
@Composable private fun ErrorText(error: String?) { if (!error.isNullOrBlank()) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 10.dp)) }
@Composable private fun EmptyCard(message: String) = SurfaceCard { Text(message, color = Muted, modifier = Modifier.align(Alignment.CenterHorizontally)) }
@Composable private fun LoadingRow(message: String) = Row(Modifier.fillMaxWidth().padding(20.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.width(24.dp)); Spacer(Modifier.width(10.dp)); Text(message) }
@Composable private fun LoadingPage(message: String) = Box(Modifier.fillMaxSize().background(PageBackground), contentAlignment = Alignment.Center) { LoadingRow(message) }

internal fun Context.readUpload(uri: Uri): UploadPayload {
    val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    } ?: "attachment"
    val mime = contentResolver.getType(uri) ?: "application/octet-stream"
    val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("无法读取文件")
    return UploadPayload(bytes, name, mime)
}

private fun Bitmap.asUpload(): UploadPayload {
    val output = ByteArrayOutputStream()
    compress(Bitmap.CompressFormat.JPEG, 88, output)
    return UploadPayload(output.toByteArray(), "camera-${System.currentTimeMillis()}.jpg", "image/jpeg")
}
