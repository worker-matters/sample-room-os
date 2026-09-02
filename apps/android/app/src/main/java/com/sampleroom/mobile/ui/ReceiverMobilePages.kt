package com.sampleroom.mobile.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.core.content.ContextCompat
import com.sampleroom.mobile.AppState
import com.sampleroom.mobile.AppViewModel
import com.sampleroom.mobile.AttachmentPreviewActivity
import com.sampleroom.mobile.data.MobileOrder
import com.sampleroom.mobile.data.ReceiverCustomer
import com.sampleroom.mobile.data.ReceiverIntakeDraft
import com.sampleroom.mobile.data.UploadPayload
import com.sampleroom.mobile.data.renameMaterialRecordUpload
import com.sampleroom.mobile.data.splitMaterialRecordFileName
import kotlinx.coroutines.delay
import java.io.ByteArrayOutputStream
import java.time.LocalDate

@Composable
fun ReceiverIntakePage(state: AppState, viewModel: AppViewModel) {
    val context = LocalContext.current
    var quick by remember { mutableStateOf(true) }
    var optionalOpen by remember { mutableStateOf(false) }
    var customer by remember(state.receiverCustomers) { mutableStateOf(state.receiverCustomers.firstOrNull()) }
    var clientUserId by remember(customer) { mutableStateOf(customer?.clientUsers?.firstOrNull()?.id.orEmpty()) }
    var styleNo by remember { mutableStateOf("") }
    var styleName by remember { mutableStateOf("") }
    var quantity by remember { mutableStateOf("1") }
    var sampleType by remember { mutableStateOf("first_sample") }
    var sampleRound by remember { mutableStateOf("round_1") }
    var deliveryDate by remember { mutableStateOf(LocalDate.now().plusDays(7).toString()) }
    var fabricStatus by remember { mutableStateOf("missing") }
    var trimStatus by remember { mutableStateOf("missing") }
    var remark by remember { mutableStateOf("") }
    val requestItems = remember { mutableStateListOf("sample_garment", "pattern_making", "cutting") }
    val files = remember { mutableStateListOf<UploadPayload>() }
    var thumbnailIndex by remember { mutableStateOf<Int?>(null) }
    var localError by remember { mutableStateOf<String?>(null) }

    val addUri: (Uri) -> Unit = { uri ->
        runCatching { context.readReceiverUpload(uri) }
            .onSuccess { files += it }
            .onFailure { localError = it.message }
    }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { it?.let(addUri) }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(addUri) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        bitmap?.let { files += it.toReceiverUpload() }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) camera.launch(null) else localError = "未获得相机权限"
    }
    val takePhoto = {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) camera.launch(null)
        else permission.launch(Manifest.permission.CAMERA)
    }
    val submit: () -> Unit = {
        val userId = clientUserId
        val validation = when {
            customer == null || userId.isBlank() -> "请选择客户和业务员"
            files.isEmpty() -> "请先拍照或选择打样单附件"
            !quick && (styleNo.isBlank() || styleName.isBlank() || deliveryDate.isBlank()) -> "请填写款号、款名和交期"
            quantity.toIntOrNull()?.let { it <= 0 } != false -> "数量必须为正整数"
            !quick && requestItems.isEmpty() -> "至少选择一个打样要求"
            else -> null
        }
        if (validation != null) {
            localError = validation
        } else {
            viewModel.submitReceiverIntake(
                ReceiverIntakeDraft(
                customerId = customer!!.id,
                clientUserId = userId,
                styleNo = styleNo,
                styleName = styleName,
                quantity = quantity,
                sampleType = sampleType,
                sampleRound = sampleRound,
                deliveryDate = deliveryDate,
                remark = remark,
                fabricStatus = fabricStatus,
                trimStatus = trimStatus,
                sampleRequestItems = requestItems.toList()
                ),
                files.toList(),
                thumbnailIndex?.let(files::getOrNull),
                quick
            )
        }
    }

    FunctionScaffold("接单员 · 现场录入", state, viewModel::openReceiverHome, viewModel::logout) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("现场录入", fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                ModeButton("拍照简录", quick) { quick = true; optionalOpen = false }
                ModeButton("常规录入", !quick) { quick = false; optionalOpen = true }
            }
            InfoNotice(if (quick) "默认拍照简录：客户、业务员和打样单为必填" else "常规录入会直接创建正式订单；字段和顺序沿用现有手机端。")
            WhiteCard {
                SelectField("客户", customer?.name ?: "请选择客户", state.receiverCustomers) { selected ->
                    customer = selected
                    clientUserId = selected.clientUsers.firstOrNull()?.id.orEmpty()
                }
                SelectField(
                    "业务员",
                    customer?.clientUsers?.firstOrNull { it.id == clientUserId }?.displayName ?: "请选择业务员",
                    customer?.clientUsers.orEmpty()
                ) { clientUserId = it.id }
                Text("打样单照片 / 附件", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp))
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = takePhoto, modifier = Modifier.weight(1f)) { Icon(Icons.Default.CameraAlt, null); Text("拍照") }
                    OutlinedButton(onClick = { imagePicker.launch("image/*") }, modifier = Modifier.weight(1f)) { Text("从相册选择") }
                }
                OutlinedButton(onClick = { filePicker.launch(arrayOf("*/*")) }, modifier = Modifier.fillMaxWidth()) { Text("选择文件") }
                if (files.isEmpty()) Text("尚未选择附件", color = MobileMuted, fontSize = 13.sp)
                if (files.isNotEmpty()) {
                    Row(
                        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        files.forEachIndexed { index, file ->
                            ReceiverUploadPreview(
                                file = file,
                                selected = thumbnailIndex == index,
                                onPreview = {
                                    context.startActivity(
                                        AttachmentPreviewActivity.localIntent(
                                            context,
                                            file.fileName,
                                            file.mimeType,
                                            file.bytes
                                        )
                                    )
                                },
                                onSelect = { if (file.mimeType.startsWith("image/")) thumbnailIndex = index },
                                onRemove = {
                                    files.removeAt(index)
                                    thumbnailIndex = thumbnailIndex?.let { selected ->
                                        when {
                                            selected == index -> null
                                            selected > index -> selected - 1
                                            else -> selected
                                        }
                                    }
                                }
                            )
                        }
                    }
                }
            }
            WhiteCard {
                Text("订单缩略图", fontWeight = FontWeight.SemiBold)
                Text("用于订单列表快速识别，请从本次已上传图片中选择。", color = MobileMuted, fontSize = 13.sp)
                val thumbnail = thumbnailIndex?.let(files::getOrNull)
                if (thumbnail == null) {
                    Text("尚未设置订单缩略图", color = MobileMuted)
                    OutlinedButton(
                        onClick = {
                            thumbnailIndex = files.indexOfFirst { it.mimeType.startsWith("image/") }
                                .takeIf { it >= 0 }
                        },
                        enabled = files.any { it.mimeType.startsWith("image/") },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("设为订单缩略图") }
                } else {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        UploadImage(
                            thumbnail,
                            Modifier.size(72.dp).clickable {
                                context.startActivity(
                                    AttachmentPreviewActivity.localIntent(
                                        context,
                                        thumbnail.fileName,
                                        thumbnail.mimeType,
                                        thumbnail.bytes
                                    )
                                )
                            }
                        )
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text("当前缩略图", color = Color(0xFF1265F7), fontWeight = FontWeight.SemiBold)
                            Text(thumbnail.fileName, color = MobileMuted, fontSize = 12.sp, maxLines = 1)
                        }
                        OutlinedButton(onClick = { thumbnailIndex = null }) { Text("更换") }
                    }
                }
            }
            if (quick) {
                WhiteCard {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("完整订单信息（选填）", fontWeight = FontWeight.SemiBold)
                            Text("款号、款名、数量、类型、轮次、交期、备注", color = MobileMuted, fontSize = 12.sp)
                        }
                        TextButton(onClick = { optionalOpen = !optionalOpen }) { Text(if (optionalOpen) "收起" else "展开") }
                    }
                }
            }
            if (optionalOpen || !quick) {
                WhiteCard {
                    TextInput("款号", styleNo) { styleNo = it }
                    TextInput("款名", styleName) { styleName = it }
                    TextInput("数量", quantity, KeyboardType.Number) { quantity = it }
                    StringSelectField("样品类型", sampleType, sampleTypeOptions) { sampleType = it }
                    StringSelectField("样品轮次", sampleRound, sampleRoundOptions) { sampleRound = it }
                    TextInput("期望交期（YYYY-MM-DD）", deliveryDate) { deliveryDate = it }
                    if (!quick) {
                        StringSelectField("面里料状态", fabricStatus, materialOptions) { fabricStatus = it }
                        StringSelectField("辅料状态", trimStatus, materialOptions) { trimStatus = it }
                        Text("打样要求", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp))
                        requestOptions.forEach { (value, label) ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(
                                    checked = value in requestItems,
                                    onCheckedChange = { checked -> if (checked) requestItems.add(value) else requestItems.remove(value) }
                                )
                                Text(label)
                            }
                        }
                    }
                    TextInput("备注", remark, minLines = 3) { remark = it }
                }
            }
            localError?.let { ErrorMessage(it) }
            state.error?.let { ErrorMessage(it) }
            state.notice?.let { SuccessMessage(it) }
            Button(onClick = submit, enabled = !state.loading, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                Text(if (state.loading) "正在提交…" else if (quick) "拍照简录" else "创建完整订单")
            }
            if (quick) Text("保存为待校对订单，不推进生产工序", color = MobileMuted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun ReceiverUploadPreview(
    file: UploadPayload,
    selected: Boolean,
    onPreview: () -> Unit,
    onSelect: () -> Unit,
    onRemove: () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = if (selected) Color(0xFFEAF2FF) else Color.White),
        shape = RoundedCornerShape(9.dp),
        modifier = Modifier.width(112.dp)
    ) {
        Column(Modifier.padding(6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            if (file.mimeType.startsWith("image/")) {
                UploadImage(file, Modifier.fillMaxWidth().height(82.dp).clickable(onClick = onPreview))
                TextButton(onClick = onSelect) { Text(if (selected) "当前缩略图" else "设为缩略图", fontSize = 12.sp) }
            } else {
                Box(Modifier.fillMaxWidth().height(82.dp).background(Color(0xFFF2F5F8)), contentAlignment = Alignment.Center) {
                    Text("文件", color = MobileMuted)
                }
            }
            Text(file.fileName, maxLines = 1, fontSize = 11.sp)
            TextButton(onClick = onRemove) { Text("移除", fontSize = 12.sp) }
        }
    }
}

@Composable
private fun UploadImage(file: UploadPayload, modifier: Modifier = Modifier) {
    val bitmap = remember(file.bytes) {
        BitmapFactory.decodeByteArray(file.bytes, 0, file.bytes.size)?.asImageBitmap()
    }
    if (bitmap == null) {
        Box(modifier.background(Color(0xFFF2F5F8), RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
            Text("无法预览", color = MobileMuted, fontSize = 11.sp)
        }
    } else {
        Image(
            bitmap = bitmap,
            contentDescription = file.fileName,
            contentScale = ContentScale.Crop,
            modifier = modifier.clip(RoundedCornerShape(8.dp))
        )
    }
}

@Composable
fun ReceiverScanChargePage(state: AppState, viewModel: AppViewModel) {
    MobileScanChargePage(
        title = "接单员 · 扫描费用",
        state = state,
        onHome = viewModel::openReceiverHome,
        onReset = viewModel::openReceiverScanCharge,
        onResolve = viewModel::resolveReceiverChargePayload,
        onSubmit = viewModel::submitReceiverCharge,
        onDismissSuccess = viewModel::finishChargeEntrySuccess,
        onLogout = null
    )
}

@Composable
fun PlannerScanChargePage(state: AppState, viewModel: AppViewModel) {
    MobileScanChargePage(
        title = "计划员 · 扫描费用",
        state = state,
        onHome = viewModel::openPlannerHome,
        onReset = viewModel::openPlannerScanCharge,
        onResolve = viewModel::resolvePlannerChargePayload,
        onSubmit = viewModel::submitPlannerCharge,
        onDismissSuccess = viewModel::finishChargeEntrySuccess,
        onLogout = null,
        openCameraOnEnter = true
    )
}

@Composable
fun PlannerOrderChargePage(state: AppState, order: MobileOrder, viewModel: AppViewModel) {
    MobileScanChargePage(
        title = "计划员 · 追加费用",
        state = state,
        onHome = viewModel::back,
        onReset = { viewModel.openPlannerOrderCharge(order) },
        onResolve = {},
        onSubmit = viewModel::submitPlannerOrderCharge,
        onDismissSuccess = viewModel::finishChargeEntrySuccess,
        onLogout = null,
        showScanEntry = false,
        compactOrderChargeLayout = true
    )
}

@Composable
private fun MobileScanChargePage(
    title: String,
    state: AppState,
    onHome: () -> Unit,
    onReset: () -> Unit,
    onResolve: (String) -> Unit,
    onSubmit: (String, Double, String, List<UploadPayload>) -> Unit,
    onDismissSuccess: () -> Unit,
    onLogout: (() -> Unit)?,
    openCameraOnEnter: Boolean = false,
    showScanEntry: Boolean = true,
    compactOrderChargeLayout: Boolean = false
) {
    val context = LocalContext.current
    var cameraOpen by remember(openCameraOnEnter) {
        mutableStateOf(
            openCameraOnEnter &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        )
    }
    var name by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var explanation by remember { mutableStateOf("") }
    val files = remember { mutableStateListOf<UploadPayload>() }
    var localError by remember { mutableStateOf<String?>(null) }
    var photoSourceOpen by remember { mutableStateOf(false) }
    var editUploadIndex by remember { mutableStateOf<Int?>(null) }
    var editUploadBaseName by remember { mutableStateOf("") }
    val amountFocusRequester = remember { FocusRequester() }
    val addUri: (Uri) -> Unit = { uri ->
        runCatching { context.readReceiverUpload(uri) }
            .onSuccess { files.apply { clear(); add(it) } }
            .onFailure { localError = it.message }
    }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { it?.let(addUri) }
    val photoCamera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        bitmap?.toReceiverUpload()?.let { files.apply { clear(); add(it) } }
    }
    val photoPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) photoCamera.launch(null) else localError = "未获得相机权限，请在系统设置中允许后重试。"
    }
    val takeUploadPhoto = {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) photoCamera.launch(null)
        else photoPermission.launch(Manifest.permission.CAMERA)
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { cameraOpen = it }
    val openCamera = {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) cameraOpen = true
        else permission.launch(Manifest.permission.CAMERA)
    }
    LaunchedEffect(openCameraOnEnter, state.receiverChargeContext) {
        if (openCameraOnEnter && state.receiverChargeContext == null && !cameraOpen) openCamera()
    }
    LaunchedEffect(state.chargeEntrySuccessVisible) {
        if (state.chargeEntrySuccessVisible) {
            name = ""
            amount = ""
            explanation = ""
            files.clear()
            localError = null
        }
    }
    FunctionScaffold(title, state, onHome, onLogout) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (cameraOpen) {
                QrCamera(
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    onPayload = { cameraOpen = false; onResolve(it) },
                    onError = { cameraOpen = false; localError = it }
                )
            } else if (state.receiverChargeContext == null && showScanEntry) {
                WhiteCard {
                    Text("扫描费用", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    Button(onClick = openCamera, modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) {
                        Icon(Icons.Default.QrCodeScanner, null); Spacer(Modifier.width(8.dp)); Text("扫描订单二维码")
                    }
                }
            } else if (state.receiverChargeContext != null) {
                val chargeContext = state.receiverChargeContext
                if (compactOrderChargeLayout) {
                    if (chargeContext.chargeLocked) ErrorMessage("订单已对账，不能继续增加费用。")
                    if (!chargeContext.chargeLocked) {
                        WhiteCard {
                            ChargeEntryForm(
                                state = state,
                                name = name,
                                amount = amount,
                                explanation = explanation,
                                files = files,
                                amountFocusRequester = amountFocusRequester,
                                onNameChange = { name = it },
                                onAmountChange = { amount = it },
                                onExplanationChange = { explanation = it },
                                onOpenPhotoSource = { photoSourceOpen = true },
                                onPreview = { context.startActivity(AttachmentPreviewActivity.localIntent(context, it.fileName, it.mimeType, it.bytes)) },
                                onRename = { index, file ->
                                    editUploadIndex = index
                                    editUploadBaseName = splitMaterialRecordFileName(file.fileName).baseName
                                },
                                onRemove = { files.removeAt(it) },
                                onSubmit = {
                                    val numericAmount = amount.toDoubleOrNull()
                                    if (name.isBlank() || numericAmount == null || numericAmount <= 0) localError = "请填写费用名称和正数金额"
                                    else onSubmit(name, numericAmount, explanation, files.toList())
                                }
                            )
                        }
                    }
                    WhiteCard(modifier = Modifier.weight(1f), fillHeight = true) {
                        Text("有效费用", fontSize = 19.sp, fontWeight = FontWeight.Bold)
                        LazyColumn(Modifier.fillMaxWidth().weight(1f)) {
                            if (chargeContext.charges.isEmpty()) item { Text("暂无有效费用", color = MobileMuted) }
                            items(chargeContext.charges) { charge ->
                                Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                                    SimpleRow(charge.name, "¥${charge.amount}")
                                    Text(
                                        "${chargeRoleLabel(charge.creatorRole)} · ${charge.creatorName.ifBlank { "-" }} · ${charge.createdAt.take(10)}",
                                        color = MobileMuted,
                                        fontSize = 13.sp
                                    )
                                }
                            }
                        }
                    }
                } else LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (showScanEntry) item {
                        OutlinedButton(onClick = onReset, modifier = Modifier.fillMaxWidth()) { Text("重新扫描") }
                    }
                    item {
                        WhiteCard {
                            AutoFitSingleLineText(
                                text = "${chargeContext.order.styleNo} · ${chargeContext.order.styleName}",
                                maxFontSize = 20.sp,
                                minFontSize = 8.sp,
                                fontWeight = FontWeight.Bold
                            )
                            SimpleRow("客户", chargeContext.order.customerName)
                            SimpleRow("客户业务员", chargeContext.order.salespersonName)
                        }
                    }
                    if (chargeContext.chargeLocked) item { ErrorMessage("订单已对账，不能继续增加费用。") }
                    if (!chargeContext.chargeLocked) item {
                        WhiteCard {
                            ChargeEntryForm(
                                state, name, amount, explanation, files, amountFocusRequester,
                                { name = it }, { amount = it }, { explanation = it }, { photoSourceOpen = true },
                                { context.startActivity(AttachmentPreviewActivity.localIntent(context, it.fileName, it.mimeType, it.bytes)) },
                                { index, file -> editUploadIndex = index; editUploadBaseName = splitMaterialRecordFileName(file.fileName).baseName },
                                { files.removeAt(it) },
                                {
                                    val numericAmount = amount.toDoubleOrNull()
                                    if (name.isBlank() || numericAmount == null || numericAmount <= 0) localError = "请填写费用名称和正数金额"
                                    else onSubmit(name, numericAmount, explanation, files.toList())
                                }
                            )
                        }
                    }
                    item {
                        WhiteCard {
                            Text("有效费用", fontSize = 19.sp, fontWeight = FontWeight.Bold)
                            if (chargeContext.charges.isEmpty()) Text("暂无有效费用", color = MobileMuted)
                            chargeContext.charges.forEach { charge ->
                                SimpleRow(charge.name, "¥${charge.amount}")
                                Text(
                                    "${chargeRoleLabel(charge.creatorRole)} · ${charge.creatorName.ifBlank { "-" }} · ${charge.createdAt.take(10)}",
                                    color = MobileMuted,
                                    fontSize = 13.sp
                                )
                            }
                        }
                    }
                }
            } else {
                WhiteCard {
                    Text(
                        if (state.loading) "正在加载订单费用…" else "订单费用暂时无法加载，请返回订单列表后重试。",
                        color = MobileMuted
                    )
                }
            }
            localError?.let { ErrorMessage(it) }
            state.error?.let { ErrorMessage(it) }
            state.notice?.let { SuccessMessage(it) }
        }
    }
    if (photoSourceOpen) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { photoSourceOpen = false },
            title = { Text("上传照片") },
            text = { Text("请选择拍照，或从相册选择已有照片。") },
            confirmButton = {
                TextButton(onClick = { photoSourceOpen = false; takeUploadPhoto() }) { Text("拍照") }
            },
            dismissButton = {
                TextButton(onClick = { photoSourceOpen = false; imagePicker.launch("image/*") }) { Text("打开相册") }
            }
        )
    }
    editUploadIndex?.let { index ->
        val upload = files.getOrNull(index)
        if (upload != null) {
            androidx.compose.material3.AlertDialog(
                onDismissRequest = { editUploadIndex = null },
                title = { Text("编辑照片") },
                text = {
                    OutlinedTextField(
                        editUploadBaseName,
                        { editUploadBaseName = it },
                        label = { Text("文件名") },
                        singleLine = true
                    )
                },
                confirmButton = {
                    TextButton(onClick = {
                        runCatching { renameMaterialRecordUpload(upload, editUploadBaseName) }
                            .onSuccess { files[index] = it; editUploadIndex = null }
                            .onFailure { localError = it.message }
                    }, enabled = editUploadBaseName.isNotBlank()) { Text("保存") }
                },
                dismissButton = { TextButton(onClick = { editUploadIndex = null }) { Text("取消") } }
            )
        }
    }
    if (state.chargeEntrySuccessVisible) {
        LaunchedEffect(Unit) {
            delay(1_000)
            onDismissSuccess()
        }
        Dialog(onDismissRequest = onDismissSuccess) {
            Card(
                modifier = Modifier.clickable(onClick = onDismissSuccess),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                shape = RoundedCornerShape(18.dp)
            ) {
                Text("录入成功", fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 44.dp, vertical = 26.dp))
            }
        }
    }
}

@Composable
private fun ChargeEntryForm(
    state: AppState,
    name: String,
    amount: String,
    explanation: String,
    files: List<UploadPayload>,
    amountFocusRequester: FocusRequester,
    onNameChange: (String) -> Unit,
    onAmountChange: (String) -> Unit,
    onExplanationChange: (String) -> Unit,
    onOpenPhotoSource: () -> Unit,
    onPreview: (UploadPayload) -> Unit,
    onRename: (Int, UploadPayload) -> Unit,
    onRemove: (Int) -> Unit,
    onSubmit: () -> Unit
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text("登记新费用", fontSize = 19.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        OutlinedButton(onClick = onOpenPhotoSource) {
            Icon(Icons.Default.CameraAlt, null)
            Spacer(Modifier.width(6.dp))
            Text("上传照片")
        }
    }
    TextInput("费用名称", name, onNext = { amountFocusRequester.requestFocus() }, onValue = onNameChange)
    TextInput("金额", amount, KeyboardType.Decimal, modifier = Modifier.focusRequester(amountFocusRequester), onValue = onAmountChange)
    TextInput("费用说明（可选）", explanation, onValue = onExplanationChange)
    files.forEachIndexed { index, file ->
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                file.fileName,
                color = Color(0xFF1769D2),
                modifier = Modifier.weight(1f).clickable { onPreview(file) },
                maxLines = 1
            )
            IconButton(onClick = { onRename(index, file) }) {
                Icon(Icons.Default.Edit, "编辑文件名", tint = Color(0xFF1769D2))
            }
            TextButton(onClick = { onRemove(index) }) { Text("移除") }
        }
    }
    Button(onClick = onSubmit, enabled = !state.loading, modifier = Modifier.fillMaxWidth()) {
        Text(if (state.loading) "正在登记…" else "登记费用")
    }
}

@Composable
fun WorkerHomePage(state: AppState, viewModel: AppViewModel) {
    val identity = state.session?.identity
    val isQcDelivery = identity?.activeWorkerType == "qc_delivery"
    val isSewing = identity?.activeWorkerType == "sewing"
    FunctionScaffold(
        if (isQcDelivery) "组检/出库" else "工序员工",
        state,
        onHome = null,
        onLogout = viewModel::logout,
        onRefresh = viewModel::refreshCurrentScreen
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            RoleGreetingCard(state)
            Button(
                onClick = viewModel::openScanner,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().height(58.dp)
            ) {
                Icon(Icons.Default.QrCodeScanner, null); Spacer(Modifier.width(8.dp)); Text(if (isQcDelivery) "扫码进入组检" else "扫描订单流转码", fontSize = 18.sp)
            }
            if (isSewing) {
                OutlinedButton(
                    onClick = { viewModel.openWorkerSewingTasks() },
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().height(52.dp)
                ) { Text("缝制中 ${state.sewingTasks.size}") }
            }
            if (isQcDelivery) {
                OutlinedButton(
                    onClick = viewModel::openWorkerQcRework,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().height(52.dp)
                ) { Text("待返工 ${state.qcReworkTasks.size}") }
            }
            OutlinedButton(
                onClick = viewModel::openWorkerPerformance,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().height(52.dp)
            ) { Text("我的绩效") }
            OutlinedButton(
                onClick = viewModel::openAccountSecurity,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().height(52.dp)
            ) { Text("账号与安全") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FunctionScaffold(
    title: String,
    state: AppState,
    onHome: (() -> Unit)?,
    onLogout: (() -> Unit)?,
    onRefresh: (() -> Unit)? = null,
    content: @Composable (androidx.compose.foundation.layout.PaddingValues) -> Unit
) {
    Scaffold(
        containerColor = MobilePageBackground,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        title,
                        color = Color.White,
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                },
                navigationIcon = {
                    if (onHome != null) IconButton(onClick = onHome) {
                        Surface(color = Color(0x22FFFFFF), shape = RoundedCornerShape(22.dp)) {
                            Icon(Icons.Default.Home, "返回功能首页", modifier = Modifier.padding(7.dp), tint = Color.White)
                        }
                    }
                },
                actions = {
                    if (onLogout != null) IconButton(onClick = onLogout) {
                        Icon(Icons.AutoMirrored.Filled.Logout, "退出", tint = Color.White)
                    }
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

@Composable
private fun WhiteCard(
    modifier: Modifier = Modifier,
    fillHeight: Boolean = false,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, Color(0xFFDCE5F0)),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = modifier.fillMaxWidth()
    ) {
        Column(
            (if (fillHeight) Modifier.fillMaxSize() else Modifier.fillMaxWidth()).padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            content = content
        )
    }
}

@Composable private fun ModeButton(label: String, selected: Boolean, onClick: () -> Unit) =
    if (selected) Button(onClick = onClick) { Text(label) } else OutlinedButton(onClick = onClick) { Text(label) }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> SelectField(label: String, selectedLabel: String, options: List<T>, onSelect: (T) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedTextField(
            value = selectedLabel,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.fillMaxWidth()
        )
        Box(Modifier.matchParentSize().background(Color.Transparent).padding(1.dp)) {
            TextButton(onClick = { expanded = true }, modifier = Modifier.fillMaxSize()) {}
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                val text = when (option) {
                    is ReceiverCustomer -> option.name
                    is com.sampleroom.mobile.data.ReceiverClientUser -> option.displayName
                    is Pair<*, *> -> option.second.toString()
                    else -> option.toString()
                }
                DropdownMenuItem(text = { Text(text) }, onClick = { onSelect(option); expanded = false })
            }
        }
    }
}

@Composable
private fun StringSelectField(label: String, value: String, options: List<Pair<String, String>>, onSelect: (String) -> Unit) {
    SelectField(label, options.firstOrNull { it.first == value }?.second ?: value, options) { onSelect(it.first) }
}

@Composable
private fun TextInput(
    label: String,
    value: String,
    keyboardType: KeyboardType = KeyboardType.Text,
    minLines: Int = 1,
    modifier: Modifier = Modifier,
    onNext: (() -> Unit)? = null,
    onValue: (String) -> Unit
) {
    val focusManager = LocalFocusManager.current
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        label = { Text(label) },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = ImeAction.Next),
        keyboardActions = KeyboardActions(onNext = { onNext?.invoke() ?: focusManager.moveFocus(FocusDirection.Down) }),
        singleLine = true,
        modifier = modifier.fillMaxWidth()
    )
}

@Composable private fun SimpleRow(label: String, value: String) = Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
    Text(label, color = MobileMuted, modifier = Modifier.weight(0.44f))
    Text(value.ifBlank { "-" }, modifier = Modifier.weight(0.56f))
}

@Composable private fun InfoNotice(message: String) = Box(Modifier.fillMaxWidth().background(Color(0xFFEAF6FC), RoundedCornerShape(6.dp)).padding(12.dp)) { Text(message, color = Color(0xFF31556A)) }
@Composable private fun ErrorMessage(message: String) = Text(message, color = MaterialTheme.colorScheme.error)
@Composable private fun SuccessMessage(message: String) = Text(message, color = Color(0xFF18864B))

private fun Context.readReceiverUpload(uri: Uri): UploadPayload {
    val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    } ?: "attachment"
    val mime = contentResolver.getType(uri) ?: "application/octet-stream"
    val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("无法读取文件")
    return UploadPayload(bytes, name, mime)
}

private fun Bitmap.toReceiverUpload(): UploadPayload {
    val output = ByteArrayOutputStream()
    compress(Bitmap.CompressFormat.JPEG, 88, output)
    return UploadPayload(output.toByteArray(), "camera-${System.currentTimeMillis()}.jpg", "image/jpeg")
}

private fun workerTypeLabel(value: String?) = when (value) {
    "cutting" -> "裁剪"
    "sewing" -> "缝制"
    "qc_delivery" -> "组检/出库"
    else -> "未识别工序"
}

private fun chargeRoleLabel(value: String) = when (value) {
    "receiver" -> "接单员"
    "planner" -> "计划员"
    "boss" -> "老板"
    "system_owner" -> "System Owner"
    else -> value
}

private val sampleTypeOptions = listOf("first_sample" to "初样", "fit_sample" to "试身样", "revision_sample" to "修改样", "pre_production_sample" to "产前样", "sales_sample" to "销售样")
private val sampleRoundOptions = listOf("round_1" to "第 1 轮", "round_2" to "第 2 轮", "round_3" to "第 3 轮", "round_4" to "第 4 轮")
private val materialOptions = listOf("missing" to "未齐", "partial" to "部分到", "complete" to "全齐")
private val requestOptions = listOf(
    "sample_garment" to "生产样衣", "production_sample" to "生产小样", "pattern_making" to "制版",
    "pattern_revision" to "改版", "full_size_pattern" to "推全码版", "quotation_material" to "报价核料",
    "bulk_material" to "大货核料", "replenishment_consumption" to "充棉/绒量", "check_chain_length" to "核拉链长度", "cutting" to "裁剪"
)

private val MobilePageBackground = Color(0xFFF2F6FC)
private val MobileMuted = Color(0xFF6B7F99)
