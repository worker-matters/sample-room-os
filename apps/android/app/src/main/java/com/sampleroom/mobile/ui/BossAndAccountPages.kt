package com.sampleroom.mobile.ui

import android.Manifest
import android.app.DatePickerDialog
import android.app.DownloadManager
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Percent
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ReportProblem
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import coil.request.ImageRequest
import coil.request.CachePolicy
import com.sampleroom.mobile.AppState
import com.sampleroom.mobile.AppViewModel
import com.sampleroom.mobile.AttachmentPreviewActivity
import com.sampleroom.mobile.PhotoCaptureActivity
import com.sampleroom.mobile.QcPhotoExportFormat
import com.sampleroom.mobile.data.BossCustomerChargeItem
import com.sampleroom.mobile.data.BossInternalCostItem
import com.sampleroom.mobile.data.BossPricingRow
import com.sampleroom.mobile.data.ReconciliationStatement
import com.sampleroom.mobile.data.QcPerformanceRecord
import com.sampleroom.mobile.data.QcRecordPhoto
import com.sampleroom.mobile.data.WorkerPerformanceRecord
import okhttp3.Headers
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.delay

private val WorkbenchBackground = Color(0xFFF2F6FC)
private val WorkbenchMuted = Color(0xFF6B7F99)
private val WorkbenchNavy = Color(0xFF123B6D)
private val WorkbenchPrimary = Color(0xFF2468D8)
private val WorkbenchDanger = Color(0xFFB3261E)

private val customerNameOptions = listOf("样衣费", "小样费", "版费")
private val pricingMethodOptions = listOf("fixed" to "固定金额", "unit_quantity" to "单价 × 数量")
private val internalCategoryOptions = listOf(
    "pattern" to "版师成本",
    "cutting" to "裁剪成本",
    "sewing" to "缝制成本",
    "finishing" to "后整成本",
    "other" to "其他成本"
)

@Composable
private fun MobileCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(12.dp),
        modifier = modifier.fillMaxWidth()
    ) {
        Column(
            Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) { content() }
    }
}

@Composable
private fun PageMessage(state: AppState) {
    state.error?.let { Text(it, color = WorkbenchDanger) }
    state.notice?.let { Text(it, color = Color(0xFF18864B)) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BossScaffold(
    title: String,
    state: AppState,
    onBack: (() -> Unit)? = null,
    onLogout: (() -> Unit)? = null,
    extraActions: @Composable RowScope.() -> Unit = {},
    content: @Composable (androidx.compose.foundation.layout.PaddingValues) -> Unit
) {
    Scaffold(
        containerColor = WorkbenchBackground,
        topBar = {
            TopAppBar(
                title = { Text(title, color = Color.White, fontSize = 18.sp) },
                navigationIcon = {
                    if (onBack != null) {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回", tint = Color.White)
                        }
                    }
                },
                actions = {
                    extraActions()
                    if (onLogout != null) {
                        IconButton(onClick = onLogout) {
                            Icon(Icons.AutoMirrored.Filled.Logout, "退出登录", tint = Color.White)
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = WorkbenchNavy)
            )
        },
        content = content
    )
}

@Composable
fun BossHomePage(state: AppState, viewModel: AppViewModel) {
    BossScaffold("老板", state, onLogout = viewModel::logout) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { PageMessage(state) }
            item {
                MobileCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.size(52.dp).clip(RoundedCornerShape(26.dp)).background(Color(0xFFE7F3F7)),
                            contentAlignment = Alignment.Center
                        ) { Text("板", color = WorkbenchPrimary, fontWeight = FontWeight.Bold) }
                        Column(Modifier.padding(start = 12.dp)) {
                            Text(state.session?.identity?.displayName ?: "老板", fontSize = 21.sp, fontWeight = FontWeight.Bold)
                            Text("定价、对账与账号管理", color = WorkbenchMuted)
                        }
                    }
                }
            }
            item {
                BossEntryCard(
                    "待对账",
                    "订单定价、筛选与生成对账单",
                    state.bossRows.size.toString(),
                    primary = true,
                    onClick = viewModel::openBossPending
                )
            }
            item {
                BossEntryCard(
                    "对账单",
                    "查看、下载、收款与退回订单",
                    state.statements.count { it.status != "returned" }.toString(),
                    onClick = viewModel::openBossStatements
                )
            }
            item {
                BossEntryCard(
                    "账号与安全",
                    "修改登录信息、姓名和密码",
                    onClick = viewModel::openAccountSecurity
                )
            }
            item {
                OutlinedButton(
                    onClick = viewModel::logout,
                    enabled = !state.loading,
                    modifier = Modifier.fillMaxWidth()
                ) { Text("退出登录") }
            }
        }
    }
}

@Composable
private fun BossEntryCard(
    title: String,
    description: String,
    count: String = "",
    primary: Boolean = false,
    onClick: () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = if (primary) WorkbenchPrimary else Color.White),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)
    ) {
        Row(
            Modifier.fillMaxWidth().padding(18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(title, color = if (primary) Color.White else Color.Unspecified, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                Text(description, color = if (primary) Color.White.copy(alpha = 0.82f) else WorkbenchMuted, fontSize = 13.sp)
            }
            if (count.isNotBlank()) Text(count, color = if (primary) Color.White else WorkbenchPrimary, fontSize = 19.sp, fontWeight = FontWeight.Bold)
            Icon(Icons.Default.ChevronRight, null, tint = if (primary) Color.White else WorkbenchPrimary)
        }
    }
}

@Composable
fun BossPendingPage(state: AppState, viewModel: AppViewModel) {
    var query by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("all") }
    var customer by remember { mutableStateOf("全部客户") }
    var salesperson by remember { mutableStateOf("全部客户业务员") }
    val customers = remember(state.bossRows) {
        listOf("全部客户") + state.bossRows.map { it.order.customerName }.filter { it.isNotBlank() }.distinct()
    }
    val salespeople = remember(state.bossRows, customer) {
        val source = if (customer == "全部客户") state.bossRows else state.bossRows.filter { it.order.customerName == customer }
        listOf("全部客户业务员") + source.map { it.order.salespersonName }.filter { it.isNotBlank() }.distinct()
    }
    val rows = state.bossRows.filter { row ->
        val priced = row.quotationStatus == "confirmed" && !row.quotationChanged
        (status == "all" || status == "priced" && priced || status == "unpriced" && !priced) &&
            (customer == "全部客户" || row.order.customerName == customer) &&
            (salesperson == "全部客户业务员" || row.order.salespersonName == salesperson) &&
            (query.isBlank() || listOf(
                row.order.orderNo,
                row.order.styleNo,
                row.order.styleName,
                row.order.customerName,
                row.order.salespersonName
            ).any { it.contains(query.trim(), ignoreCase = true) })
    }

    BossScaffold("待对账", state, onBack = viewModel::openBossHome, onLogout = viewModel::logout) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            PageMessage(state)
            OutlinedTextField(
                query,
                { query = it },
                label = { Text("搜索款号 / 款名 / 客户 / 客户业务员") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilterChip(status == "all", { status = "all" }, { Text("全部") })
                FilterChip(status == "unpriced", { status = "unpriced" }, { Text("未定价") })
                FilterChip(status == "priced", { status = "priced" }, { Text("已定价") })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SelectionField(customer, customers, Modifier.weight(1f)) {
                    customer = it
                    salesperson = "全部客户业务员"
                }
                SelectionField(salesperson, salespeople, Modifier.weight(1f)) { salesperson = it }
            }
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(rows, key = { it.order.id }) { row ->
                    BossPricingCard(row, state, viewModel)
                }
                if (!state.loading && rows.isEmpty()) {
                    item { MobileCard { Text("没有符合筛选条件的订单", color = WorkbenchMuted) } }
                }
            }
            Button(
                viewModel::createBossStatement,
                enabled = state.selectedOrderIds.isNotEmpty() && !state.loading,
                modifier = Modifier.fillMaxWidth()
            ) { Text("生成对账单（已选 ${state.selectedOrderIds.size} 单）") }
        }
    }
}

@Composable
private fun BossPricingCard(row: BossPricingRow, state: AppState, viewModel: AppViewModel) {
    val priced = row.quotationStatus == "confirmed" && !row.quotationChanged
    MobileCard {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            BossThumbnail(state, row)
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column(Modifier.weight(1f)) {
                        AutoFitSingleLineText(
                            text = row.order.styleNo.ifBlank { "未录入款号" },
                            maxFontSize = 16.sp,
                            minFontSize = 8.sp,
                            fontWeight = FontWeight.Bold
                        )
                        AutoFitSingleLineText(
                            text = row.order.styleName.ifBlank { "-" },
                            color = WorkbenchMuted,
                            maxFontSize = 16.sp,
                            minFontSize = 8.sp
                        )
                    }
                    Text(if (priced) "已定价" else "未定价", color = if (priced) Color(0xFF24724B) else Color(0xFFE97812))
                }
                Text("客户：${row.order.customerName}", fontSize = 13.sp)
                Text("客户业务员：${row.order.salespersonName.ifBlank { "-" }}", fontSize = 13.sp)
                Text("数量 / 交期：${row.order.quantity} / ${row.order.deliveryDate}", fontSize = 13.sp)
            }
        }
        if (row.tasks.isNotEmpty()) Text(row.tasks.joinToString(" · "), color = WorkbenchMuted, fontSize = 13.sp)
        Text("应收合计 ${money(row.receivableTotal)}", fontWeight = FontWeight.Bold)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton({ viewModel.toggleBossOrder(row.order.id) }, enabled = row.eligible) {
                Text(
                    if (state.selectedOrderIds.contains(row.order.id)) "✓ 已选择"
                    else if (row.eligible) "选择加入对账"
                    else "确认最新报价后可对账"
                )
            }
            TextButton({ viewModel.openBossPricing(row.order.id) }) { Text("定价详情") }
        }
    }
}

@Composable
private fun BossThumbnail(state: AppState, row: BossPricingRow) {
    val context = LocalContext.current
    val session = state.session
    val attachment = row.order.attachments.firstOrNull { it.id == row.order.thumbnailAttachmentId }
        ?: row.order.attachments.firstOrNull { it.category == "style_thumbnail" && it.mimeType.startsWith("image/") }
        ?: row.order.attachments.firstOrNull { it.mimeType.startsWith("image/") }
    val url = if (session != null && attachment?.hasFile == true) {
        "${session.endpoint.baseUrl.trimEnd('/')}/api/admin/orders/${row.order.id}/attachments/${attachment.id}/download"
    } else null
    Box(
        Modifier.size(78.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFFEFF4F7))
            .then(if (url == null || session == null) Modifier else Modifier.clickable {
                context.startActivity(Intent(context, AttachmentPreviewActivity::class.java)
                    .putExtra(AttachmentPreviewActivity.EXTRA_URL, url)
                    .putExtra(AttachmentPreviewActivity.EXTRA_TOKEN, session.token)
                    .putExtra(AttachmentPreviewActivity.EXTRA_FILE_NAME, "${row.order.styleNo} 款式缩略图"))
            }),
        contentAlignment = Alignment.Center
    ) {
        Icon(Icons.Default.Inventory2, "款式缩略图", tint = WorkbenchMuted)
        if (url != null && session != null) {
            AsyncImage(
                model = ImageRequest.Builder(context)
                    .data(url)
                    .headers(Headers.Builder().add("Authorization", "Bearer ${session.token}").build())
                    .crossfade(true)
                    .build(),
                contentDescription = "${row.order.styleNo} 款式缩略图",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        }
    }
}

@Composable
fun BossStatementsPage(state: AppState, viewModel: AppViewModel) {
    var query by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("all") }
    var customer by remember { mutableStateOf("全部客户") }
    var salesperson by remember { mutableStateOf("全部客户业务员") }
    val customers = listOf("全部客户") + state.statements.map { it.customerName }.filter { it.isNotBlank() }.distinct()
    val salespeople = (
        if (customer == "全部客户") state.statements else state.statements.filter { it.customerName == customer }
        ).map { it.salespersonName }.filter { it.isNotBlank() }.distinct()
    val salespersonOptions = listOf("全部客户业务员") + salespeople
    val filtered = state.statements.filter {
        (status == "all" || it.status == status) &&
            (customer == "全部客户" || it.customerName == customer) &&
            (salesperson == "全部客户业务员" || it.salespersonName == salesperson) &&
            (query.isBlank() || listOf(it.statementNo, it.customerName, it.salespersonName)
                .any { value -> value.contains(query.trim(), ignoreCase = true) })
    }

    BossScaffold("对账单", state, onBack = viewModel::openBossHome, onLogout = viewModel::logout) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            PageMessage(state)
            OutlinedTextField(
                query,
                { query = it },
                label = { Text("搜索对账单号 / 客户 / 客户业务员") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilterChip(status == "all", { status = "all" }, { Text("全部") })
                FilterChip(status == "pending_payment", { status = "pending_payment" }, { Text("待付款") })
                FilterChip(status == "paid", { status = "paid" }, { Text("已收款") })
                FilterChip(status == "returned", { status = "returned" }, { Text("已退回") })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SelectionField(customer, customers, Modifier.weight(1f)) {
                    customer = it
                    salesperson = "全部客户业务员"
                }
                SelectionField(salesperson, salespersonOptions, Modifier.weight(1f)) { salesperson = it }
            }
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(filtered, key = { it.id }) { statement ->
                    MobileCard {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(statement.statementNo, fontWeight = FontWeight.Bold)
                            Text(statementStatus(statement.status), color = statementStatusColor(statement.status))
                        }
                        Text("客户：${statement.customerName}")
                        Text("客户业务员：${statement.salespersonName.ifBlank { "-" }}")
                        Text("账期：${statement.billingPeriod.ifBlank { statement.generatedAt.take(10) }}", color = WorkbenchMuted)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("${statement.orderCount} 单")
                            Text(money(statement.receivableAmount), fontWeight = FontWeight.Bold)
                        }
                        TextButton({ viewModel.openStatement(statement.id) }) { Text("查看对账详情") }
                    }
                }
                if (!state.loading && filtered.isEmpty()) {
                    item { MobileCard { Text("没有符合筛选条件的对账单", color = WorkbenchMuted) } }
                }
            }
        }
    }
}

@Composable
fun BossPricingPage(state: AppState, orderId: String, viewModel: AppViewModel) {
    val detail = state.bossPricingDetail
    var customerDrafts by remember(detail) { mutableStateOf(detail?.customerCharges.orEmpty()) }
    var internalDrafts by remember(detail) { mutableStateOf(detail?.internalCosts.orEmpty()) }
    var otherName by remember { mutableStateOf("") }
    var otherAmount by remember { mutableStateOf("") }
    var deleteOtherId by remember { mutableStateOf<String?>(null) }
    var localError by remember { mutableStateOf<String?>(null) }
    val locked = detail?.row?.quotationStatus == "confirmed"
    val customerSubtotal = customerDrafts.sumOf { it.amount }
    val internalTotal = internalDrafts.sumOf { it.amount }
    val otherTotal = detail?.row?.confirmedOtherChargeTotal ?: 0.0

    BossScaffold("定价详情", state, onBack = viewModel::openBossPending, onLogout = viewModel::logout) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                PageMessage(state)
                localError?.let { Text(it, color = WorkbenchDanger) }
            }
            if (detail != null) {
                item {
                    MobileCard {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Column(Modifier.weight(1f)) {
                                AutoFitSingleLineText(
                                    text = detail.row.order.styleNo.ifBlank { "未录入款号" },
                                    maxFontSize = 21.sp,
                                    minFontSize = 8.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                AutoFitSingleLineText(
                                    text = detail.row.order.styleName.ifBlank { "-" },
                                    color = WorkbenchMuted,
                                    maxFontSize = 16.sp,
                                    minFontSize = 8.sp
                                )
                            }
                            Text(if (locked) "已确认" else if (detail.hasConfirmedQuotation) "更新中" else "草稿")
                        }
                        Text("${detail.row.order.customerName} / ${detail.row.order.salespersonName}")
                        Text("数量 / 交期：${detail.row.order.quantity} / ${detail.row.order.deliveryDate}")
                    }
                }
                item {
                    MobileCard {
                        Text("本单任务", fontWeight = FontWeight.Bold)
                        Text(detail.row.tasks.joinToString(" · ").ifBlank { "无任务" }, color = WorkbenchMuted)
                        Text("任务用于推荐费用项目和标识来源，不限制真实费用录入。", color = WorkbenchMuted, fontSize = 12.sp)
                    }
                }
                item {
                    MobileCard {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            Metric("客户报价小计", money(customerSubtotal), Modifier.weight(1f))
                            Metric("其他费用", money(otherTotal), Modifier.weight(1f))
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            Metric("应收合计", money(customerSubtotal + otherTotal), Modifier.weight(1f), primary = true)
                            Metric("内部成本", money(internalTotal), Modifier.weight(1f))
                        }
                    }
                }
                item {
                    MobileCard {
                        Text("客户报价", fontSize = 19.sp, fontWeight = FontWeight.Bold)
                        Text("费用名称使用与 Web 相同的固定字段。", color = WorkbenchMuted, fontSize = 12.sp)
                        customerDrafts.forEach { item ->
                            CustomerChargeEditor(
                                item = item,
                                locked = locked,
                                tasks = detail.row.tasks,
                                onChange = { changed ->
                                    customerDrafts = customerDrafts.map { if (it.id == changed.id) changed else it }
                                },
                                onDelete = { customerDrafts = customerDrafts.filterNot { it.id == item.id } }
                            )
                            HorizontalDivider()
                        }
                        if (!locked) {
                            OutlinedButton(
                                onClick = {
                                    customerDrafts = customerDrafts + BossCustomerChargeItem(
                                        id = "draft-customer-${System.nanoTime()}",
                                        name = "样衣费",
                                        pricingMethod = "fixed",
                                        amount = 0.0
                                    )
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) { Text("新增客户报价项目") }
                        }
                    }
                }
                item {
                    MobileCard {
                        Text("内部成本（客户不可见）", fontSize = 19.sp, fontWeight = FontWeight.Bold)
                        Text("只保留成本类别选择与金额输入；适用性仍由服务器统一判断。", color = WorkbenchMuted, fontSize = 12.sp)
                        internalDrafts.forEach { item ->
                            InternalCostEditor(
                                item = item,
                                locked = locked,
                                onChange = { changed ->
                                    internalDrafts = internalDrafts.map { if (it.id == changed.id) changed else it }
                                },
                                onDelete = { internalDrafts = internalDrafts.filterNot { it.id == item.id } }
                            )
                            HorizontalDivider()
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("其他费用（查看汇总）", color = WorkbenchMuted)
                            Text(money(otherTotal))
                        }
                        if (!locked) {
                            OutlinedButton(
                                onClick = {
                                    internalDrafts = internalDrafts + BossInternalCostItem(
                                        id = "draft-internal-${System.nanoTime()}",
                                        name = "其他成本",
                                        category = "other",
                                        amount = 0.0
                                    )
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) { Text("新增成本项") }
                        }
                    }
                }
                item {
                    MobileCard {
                        Text("其他费用", fontSize = 19.sp, fontWeight = FontWeight.Bold)
                        Text("已确认记录自动进入其他费用与应收合计，不进入内部成本。", color = WorkbenchMuted, fontSize = 12.sp)
                        if (detail.otherCharges.isEmpty()) Text("暂无其他费用", color = WorkbenchMuted)
                        detail.otherCharges.forEach { charge ->
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(charge.name, fontWeight = FontWeight.SemiBold)
                                    Text("${money(charge.amount)} · ${chargeStatus(charge.status)}", color = WorkbenchMuted, fontSize = 13.sp)
                                }
                                if (charge.status == "pending") {
                                    TextButton({ viewModel.confirmBossOtherCharge(orderId, charge.id) }) { Text("确认") }
                                }
                                TextButton({ deleteOtherId = charge.id }) { Text("删除", color = WorkbenchDanger) }
                            }
                        }
                        if (!locked) {
                            OutlinedTextField(otherName, { otherName = it }, label = { Text("费用名称") }, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(otherAmount, { otherAmount = it }, label = { Text("金额") }, modifier = Modifier.fillMaxWidth())
                            OutlinedButton(
                                onClick = {
                                    val amount = otherAmount.toDoubleOrNull()
                                    if (otherName.trim().isBlank() || amount == null || amount <= 0) {
                                        localError = "请填写费用名称和大于零的金额"
                                    } else {
                                        localError = null
                                        viewModel.createBossOtherCharge(orderId, otherName.trim(), amount)
                                        otherName = ""
                                        otherAmount = ""
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) { Text("登记其他费用") }
                        }
                    }
                }
                item {
                    if (locked) {
                        Button(
                            { viewModel.beginBossPricingUpdate(orderId) },
                            enabled = !state.loading,
                            modifier = Modifier.fillMaxWidth()
                        ) { Text("更新客户报价") }
                    } else {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(
                                onClick = {
                                    localError = pricingValidation(customerDrafts, internalDrafts)
                                    if (localError == null) viewModel.saveBossPricing(orderId, customerDrafts, internalDrafts, false)
                                },
                                enabled = !state.loading,
                                modifier = Modifier.weight(1f)
                            ) { Text("保存草稿") }
                            Button(
                                onClick = {
                                    localError = pricingValidation(customerDrafts, internalDrafts)
                                    if (customerDrafts.isEmpty()) localError = "请至少保留一个客户报价项目"
                                    if (localError == null) viewModel.saveBossPricing(orderId, customerDrafts, internalDrafts, true)
                                },
                                enabled = !state.loading,
                                modifier = Modifier.weight(1f)
                            ) { Text(if (detail.hasConfirmedQuotation) "确认更新报价" else "确认客户报价") }
                        }
                    }
                }
            }
        }
    }

    deleteOtherId?.let { chargeId ->
        AlertDialog(
            onDismissRequest = { deleteOtherId = null },
            title = { Text("删除这笔其他费用？") },
            text = { Text("费用会退出金额合计，历史审计记录仍保留。") },
            confirmButton = {
                TextButton({
                    deleteOtherId = null
                    viewModel.deleteBossOtherCharge(orderId, chargeId)
                }) { Text("确认删除", color = WorkbenchDanger) }
            },
            dismissButton = { TextButton({ deleteOtherId = null }) { Text("取消") } }
        )
    }
}

@Composable
private fun CustomerChargeEditor(
    item: BossCustomerChargeItem,
    locked: Boolean,
    tasks: List<String>,
    onChange: (BossCustomerChargeItem) -> Unit,
    onDelete: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SelectionField(item.name, customerNameOptions, Modifier.weight(1f), enabled = !locked) {
                onChange(item.copy(name = it))
            }
            SelectionField(
                pricingMethodOptions.firstOrNull { it.first == item.pricingMethod }?.second ?: "固定金额",
                pricingMethodOptions.map { it.second },
                Modifier.weight(1f),
                enabled = !locked
            ) { label ->
                val method = pricingMethodOptions.first { it.second == label }.first
                onChange(
                    item.copy(
                        pricingMethod = method,
                        unitPrice = item.unitPrice ?: 0.0,
                        quantity = item.quantity ?: 1.0,
                        amount = if (method == "unit_quantity") (item.unitPrice ?: 0.0) * (item.quantity ?: 1.0) else item.amount
                    )
                )
            }
        }
        if (item.pricingMethod == "unit_quantity") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    (item.unitPrice ?: 0.0).numberInput(),
                    {
                        val value = it.toDoubleOrNull() ?: 0.0
                        onChange(item.copy(unitPrice = value, amount = value * (item.quantity ?: 0.0)))
                    },
                    enabled = !locked,
                    label = { Text("单价") },
                    modifier = Modifier.weight(1f)
                )
                OutlinedTextField(
                    (item.quantity ?: 0.0).numberInput(),
                    {
                        val value = it.toDoubleOrNull() ?: 0.0
                        onChange(item.copy(quantity = value, amount = (item.unitPrice ?: 0.0) * value))
                    },
                    enabled = !locked,
                    label = { Text("数量") },
                    modifier = Modifier.weight(1f)
                )
            }
            Text("金额：${money(item.amount)}", color = WorkbenchMuted)
        } else {
            OutlinedTextField(
                item.amount.numberInput(),
                { onChange(item.copy(amount = it.toDoubleOrNull() ?: 0.0)) },
                enabled = !locked,
                label = { Text("金额") },
                modifier = Modifier.fillMaxWidth()
            )
        }
        if (tasks.isNotEmpty()) {
            SelectionField(
                item.sourceTask.ifBlank { "人工新增" },
                listOf("人工新增") + tasks,
                Modifier.fillMaxWidth(),
                enabled = !locked
            ) { onChange(item.copy(sourceTask = if (it == "人工新增") "" else it)) }
        }
        if (!locked) TextButton(onDelete) { Text("删除此项", color = WorkbenchDanger) }
    }
}

@Composable
private fun InternalCostEditor(
    item: BossInternalCostItem,
    locked: Boolean,
    onChange: (BossInternalCostItem) -> Unit,
    onDelete: () -> Unit
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        SelectionField(
            internalCategoryOptions.firstOrNull { it.first == item.category }?.second ?: item.name,
            internalCategoryOptions.map { it.second },
            Modifier.weight(1f),
            enabled = !locked
        ) { label ->
            val category = internalCategoryOptions.first { it.second == label }
            onChange(item.copy(name = category.second, category = category.first))
        }
        OutlinedTextField(
            item.amount.numberInput(),
            { onChange(item.copy(amount = it.toDoubleOrNull() ?: 0.0)) },
            enabled = !locked,
            label = { Text("金额") },
            modifier = Modifier.weight(0.8f)
        )
        if (!locked) TextButton(onDelete) { Text("删除", color = WorkbenchDanger) }
    }
}

@Composable
fun StatementDetailPage(state: AppState, viewModel: AppViewModel) {
    val statement = state.selectedStatement
    val context = LocalContext.current
    var confirmAction by remember { mutableStateOf<String?>(null) }
    var returnItemId by remember { mutableStateOf<String?>(null) }

    BossScaffold("对账单详情", state, onBack = viewModel::openBossStatements, onLogout = viewModel::logout) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item { PageMessage(state) }
            if (statement != null) {
                item {
                    MobileCard {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(statement.statementNo, fontSize = 21.sp, fontWeight = FontWeight.Bold)
                            Text(statementStatus(statement.status), color = statementStatusColor(statement.status))
                        }
                        Text("客户：${statement.customerName}")
                        Text("客户业务员：${statement.salespersonName.ifBlank { "-" }}")
                        Text("账期：${statement.billingPeriod.ifBlank { statement.generatedAt.take(10) }}")
                        Text("${statement.orderCount} 单 · ${money(statement.receivableAmount)}", fontWeight = FontWeight.Bold)
                    }
                }
                item { Text("包含订单明细", fontWeight = FontWeight.Bold) }
                items(statement.items, key = { it.id }) { item ->
                    MobileCard {
                        AutoFitSingleLineText(
                            text = "${item.styleNo} · ${item.styleName}",
                            maxFontSize = 16.sp,
                            minFontSize = 8.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("样衣金额 ${money(item.sampleAmount)}", color = WorkbenchMuted)
                            Text("版费 ${money(item.patternFeeTotal)}", color = WorkbenchMuted)
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("其他费用 ${money(item.otherChargeTotal)}", color = WorkbenchMuted)
                            Text("应收小计 ${money(item.receivableTotal)}", fontWeight = FontWeight.Bold)
                        }
                        if (statement.status == "pending_payment" && item.returnedAt.isBlank()) {
                            TextButton({ returnItemId = item.id }) { Text("退回此订单", color = WorkbenchDanger) }
                        } else if (item.returnedAt.isNotBlank()) {
                            Text("已退回", color = WorkbenchMuted)
                        }
                    }
                }
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            { enqueueStatementDownload(context, state, statement) },
                            modifier = Modifier.weight(1f)
                        ) { Text("下载对账单") }
                        if (statement.status == "pending_payment") {
                            Button({ confirmAction = "paid" }, modifier = Modifier.weight(1f)) { Text("确认收款") }
                        } else if (statement.status == "paid") {
                            OutlinedButton({ confirmAction = "undo" }, modifier = Modifier.weight(1f)) { Text("取消确认收款") }
                        }
                    }
                }
                if (statement.status == "pending_payment") {
                    item {
                        OutlinedButton({ confirmAction = "return_all" }, modifier = Modifier.fillMaxWidth()) {
                            Text("整单退回", color = WorkbenchDanger)
                        }
                    }
                }
            }
        }
    }

    if (confirmAction != null || returnItemId != null) {
        val action = confirmAction
        AlertDialog(
            onDismissRequest = { confirmAction = null; returnItemId = null },
            title = {
                Text(
                    when {
                        returnItemId != null -> "退回这个订单？"
                        action == "return_all" -> "退回整张对账单？"
                        action == "undo" -> "取消确认收款？"
                        else -> "标记为已收款？"
                    }
                )
            },
            text = {
                Text(
                    when {
                        returnItemId != null -> "订单会回到待对账，本对账单其余订单和历史记录不受影响。"
                        action == "return_all" -> "所有未退回订单会回到待对账；对账单历史记录保留。"
                        action == "undo" -> "对账单会恢复为待付款，金额快照和订单明细不会改变。"
                        else -> "请确认实际收款后再执行此操作。"
                    }
                )
            },
            confirmButton = {
                TextButton({
                    val itemId = returnItemId
                    confirmAction = null
                    returnItemId = null
                    when {
                        itemId != null -> viewModel.returnStatementItem(itemId)
                        action == "return_all" -> viewModel.returnStatementItem(null)
                        action == "undo" -> viewModel.markStatementPaid(true)
                        else -> viewModel.markStatementPaid(false)
                    }
                }) { Text("确认", color = if (action == "paid") WorkbenchPrimary else WorkbenchDanger) }
            },
            dismissButton = { TextButton({ confirmAction = null; returnItemId = null }) { Text("取消") } }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkerPerformancePage(state: AppState, viewModel: AppViewModel) {
    val report = state.workerPerformance
    var period by remember { mutableStateOf("week") }
    var dateFrom by remember { mutableStateOf(defaultWorkerRange("week").first) }
    var dateTo by remember { mutableStateOf(defaultWorkerRange("week").second) }
    var recordQuery by remember { mutableStateOf("") }
    var searchOpen by remember { mutableStateOf(false) }
    var dateOpen by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val normalizedQuery = recordQuery.trim().lowercase()
    val ordinaryRecords = report?.records.orEmpty().filter { record ->
        normalizedQuery.isBlank() || "${record.styleNo} ${record.styleName}".lowercase().contains(normalizedQuery)
    }
    val qcRecords = state.qcPerformanceRecords.filter { record ->
        normalizedQuery.isBlank() || "${record.styleNo} ${record.styleName}".lowercase().contains(normalizedQuery)
    }

    BossScaffold(
        "我的绩效",
        state,
        onBack = viewModel::openWorkerHome,
        onLogout = null,
        extraActions = {
            IconButton(onClick = { searchOpen = true }) { Icon(Icons.Default.Search, "搜索任务记录", tint = Color.White) }
            IconButton(onClick = { dateOpen = true }) { Icon(Icons.Default.CalendarMonth, "选择时间范围", tint = Color.White) }
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = { viewModel.loadWorkerPerformance(dateFrom, dateTo) },
            modifier = Modifier.fillMaxSize().padding(padding)
        ) {
          Column(
              Modifier.fillMaxSize().padding(16.dp),
              verticalArrangement = Arrangement.spacedBy(10.dp)
          ) {
              if (state.loading) Text("正在加载…", color = WorkbenchMuted)
              state.error?.let { error -> Text(error, color = WorkbenchDanger) }
              if (report != null) {
                  MobileCard {
                      if (report.workerType == "qc_delivery") {
                          QcMetricsGrid(
                              listOf(
                                  Triple("完成订单", report.completedOrders.toString(), Icons.Default.CheckCircle),
                                  Triple("实收核对件数", report.checkedPieces.toString(), Icons.Default.Inventory2),
                                  Triple("客诉订单", report.complaintOrders.toString(), Icons.Default.ReportProblem),
                                  Triple("客诉比例", "${formatNumber(report.complaintRate)}%", Icons.Default.Percent)
                              )
                          )
                      } else {
                          MetricsGrid(
                              listOf(
                                  "完成订单" to report.completedOrders.toString(),
                                  "完成件数" to report.completedPieces.toString(),
                                  "记录工时" to formatNumber(report.totalHours),
                                  "件 / 小时" to formatNumber(report.hourlyOutput)
                              )
                          )
                      }
                  }
                  if (report.workerType == "sewing") {
                      MobileCard {
                          MetricsGrid(
                              listOf(
                                  "平均组检评分" to (report.averageQualityScore?.let { formatNumber(it, 1) } ?: "-"),
                                  "未评分订单" to report.unratedOrders.toString()
                              )
                          )
                      }
                  }
                  Column {
                      Text("任务记录", fontSize = 19.sp, fontWeight = FontWeight.Bold)
                      if (recordQuery.isNotBlank()) {
                          Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                              Text("搜索：$recordQuery", color = WorkbenchMuted, fontSize = 13.sp, modifier = Modifier.weight(1f))
                              IconButton(onClick = { recordQuery = "" }) {
                                  Icon(Icons.Default.Close, "清除搜索", tint = WorkbenchMuted)
                              }
                          }
                      }
                  }
                  MobileCard(modifier = Modifier.weight(1f)) {
                      LazyColumn(
                          modifier = Modifier.fillMaxSize(),
                          verticalArrangement = Arrangement.spacedBy(8.dp)
                      ) {
                          if (report.workerType == "qc_delivery") {
                              items(qcRecords, key = { "${it.orderId}-${it.status}-${it.eventTime}" }) { record ->
                                  QcPerformanceRecordRow(state, record) {
                                      viewModel.openQcRecordDetail(record.orderId)
                                  }
                              }
                              if (!state.loading && qcRecords.isEmpty()) {
                                  item { EmptyPerformanceRecords(recordQuery, false) }
                              }
                          } else {
                              items(ordinaryRecords, key = { "${it.styleNo}-${it.completedAt}" }) { record ->
                                  WorkerPerformanceRecordRow(record, report.workerType)
                              }
                              if (!state.loading && ordinaryRecords.isEmpty()) {
                                  item { EmptyPerformanceRecords(recordQuery, false) }
                              }
                          }
                      }
                  }
              }
          }
        }
    }

    if (searchOpen) {
        AlertDialog(
            onDismissRequest = { searchOpen = false },
            title = { Text("搜索任务记录") },
            text = {
                OutlinedTextField(
                    value = recordQuery,
                    onValueChange = { recordQuery = it },
                    placeholder = { Text("输入款号或款名") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = { TextButton(onClick = { searchOpen = false }) { Text("搜索") } },
            dismissButton = { TextButton(onClick = { recordQuery = ""; searchOpen = false }) { Text("清除") } }
        )
    }
    if (dateOpen) {
        AlertDialog(
            onDismissRequest = { dateOpen = false },
            title = { Text("时间范围") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        PeriodChip("本周", period == "week", Modifier.weight(1f)) { period = "week" }
                        PeriodChip("本月", period == "month", Modifier.weight(1f)) { period = "month" }
                        PeriodChip("近三月", period == "three_months", Modifier.weight(1f)) { period = "three_months" }
                    }
                    PeriodChip("自定义日期", period == "custom", Modifier.fillMaxWidth()) { period = "custom" }
                    if (period == "custom") {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            DateButton(context, dateFrom, Modifier.weight(1f)) { dateFrom = it }
                            DateButton(context, dateTo, Modifier.weight(1f)) { dateTo = it }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val range = if (period == "custom") dateFrom to dateTo else defaultWorkerRange(period)
                    dateFrom = range.first
                    dateTo = range.second
                    viewModel.loadWorkerPerformance(range.first, range.second)
                    dateOpen = false
                }) { Text("应用") }
            },
            dismissButton = { TextButton(onClick = { dateOpen = false }) { Text("取消") } }
        )
    }
}

@Composable
private fun QcPerformanceRecordRow(
    state: AppState,
    record: QcPerformanceRecord,
    onClick: () -> Unit
) {
    val context = LocalContext.current
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF8FAFD)),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
          Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            AsyncImage(
                model = qcPerformanceImageRequest(context, state, record.thumbnailUrl, temporary = false),
                contentDescription = "${record.styleNo} 款式缩略图",
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(104.dp).clip(RoundedCornerShape(12.dp)).clickable {
                    val session = state.session ?: return@clickable
                    val url = if (record.thumbnailUrl.startsWith("http")) record.thumbnailUrl
                    else "${session.endpoint.baseUrl.trimEnd('/')}/${record.thumbnailUrl.trimStart('/')}"
                    context.startActivity(Intent(context, AttachmentPreviewActivity::class.java)
                        .putExtra(AttachmentPreviewActivity.EXTRA_URL, url)
                        .putExtra(AttachmentPreviewActivity.EXTRA_TOKEN, session.token)
                        .putExtra(AttachmentPreviewActivity.EXTRA_FILE_NAME, "${record.styleNo} 款式缩略图"))
                }
            )
            Column(Modifier.weight(1f).padding(start = 14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                AutoFitSingleLineText(
                    text = record.styleNo.ifBlank { "未录入款号" },
                    maxFontSize = 19.sp,
                    minFontSize = 8.sp,
                    fontWeight = FontWeight.Bold
                )
                AutoFitSingleLineText(
                    text = record.styleName.ifBlank { "-" },
                    color = WorkbenchMuted,
                    maxFontSize = 16.sp,
                    minFontSize = 8.sp
                )
                Surface(color = Color(0xFFEDF5FF), shape = RoundedCornerShape(6.dp)) {
                    Text(qcSampleTypeLabel(record.sampleType), color = WorkbenchPrimary, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
                }
                Text("数量 ${record.quantity} · 评分 ${record.score?.let { formatNumber(it, 1) } ?: "-"}", fontSize = 14.sp)
            }
          }
          HorizontalDivider(Modifier.padding(top = 12.dp, bottom = 9.dp), color = Color(0xFFE8EDF4))
          Row(verticalAlignment = Alignment.CenterVertically) {
              Icon(Icons.Default.CalendarMonth, null, tint = WorkbenchMuted, modifier = Modifier.size(17.dp))
              Text("上传日期 ${record.eventTime.take(10).ifBlank { "-" }}", color = WorkbenchMuted, fontSize = 13.sp, modifier = Modifier.padding(start = 7.dp))
          }
        }
    }
}

@Composable
private fun WorkerPerformanceRecordRow(
    record: WorkerPerformanceRecord,
    workerType: String
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF8FAFD)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
            AutoFitSingleLineText(
                text = record.styleNo.ifBlank { "未录入款号" },
                maxFontSize = 16.sp,
                minFontSize = 8.sp,
                fontWeight = FontWeight.Bold
            )
            AutoFitSingleLineText(
                text = record.styleName.ifBlank { "-" },
                color = WorkbenchMuted,
                maxFontSize = 16.sp,
                minFontSize = 8.sp
            )
            Text(record.completedAt.take(10), color = WorkbenchMuted)
            when (workerType) {
                "sewing" -> Text("${record.pieces} 件 · ${formatNumber(record.workHours)} 小时 · 评分 ${record.qualityScore?.let { formatNumber(it, 1) } ?: "未评分"}")
                else -> Text("${record.pieces} 件 · ${formatNumber(record.workHours)} 小时")
            }
        }
    }
}

@Composable
private fun EmptyPerformanceRecords(query: String, filtered: Boolean) {
    Text(
        if (query.isNotBlank() || filtered) "没有符合搜索或筛选条件的记录" else "当前时间范围暂无生产记录",
        color = WorkbenchMuted,
        modifier = Modifier.padding(12.dp)
    )
}

private fun qcPerformanceImageRequest(
    context: Context,
    state: AppState,
    path: String,
    temporary: Boolean
): ImageRequest? {
    val session = state.session ?: return null
    val url = if (path.startsWith("http://") || path.startsWith("https://")) path
    else "${session.endpoint.baseUrl.trimEnd('/')}/${path.trimStart('/')}"
    return ImageRequest.Builder(context)
        .data(url)
        .headers(Headers.Builder().add("Authorization", "Bearer ${session.token}").build())
        .apply {
            if (temporary) {
                diskCachePolicy(CachePolicy.DISABLED)
                memoryCachePolicy(CachePolicy.DISABLED)
            }
        }
        .build()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QcRecordDetailPage(state: AppState, viewModel: AppViewModel) {
    val detail = state.qcRecordDetail
    val context = LocalContext.current
    var sourceCategory by remember { mutableStateOf<String?>(null) }
    var exportOpen by remember { mutableStateOf(false) }
    var pendingLegacyExport by remember { mutableStateOf<QcPhotoExportFormat?>(null) }
    var editPhoto by remember { mutableStateOf<QcRecordPhoto?>(null) }
    var deletePhoto by remember { mutableStateOf<QcRecordPhoto?>(null) }
    val galleryLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        val category = sourceCategory ?: "qc_sample_photo"
        val uploads = uris.take(10).mapNotNull { uri ->
            runCatching { context.readUpload(uri).copy(category = category) }.getOrNull()
        }
        sourceCategory = null
        if (detail != null && uploads.isNotEmpty()) viewModel.addQcRecordPhotos(detail.record.orderId, uploads)
    }
    var photoSourceOpen by remember { mutableStateOf(false) }
    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val category = sourceCategory ?: "qc_sample_photo"
        val uploads = if (result.resultCode == Activity.RESULT_OK) {
            result.data?.getStringArrayListExtra(PhotoCaptureActivity.EXTRA_URIS).orEmpty().mapNotNull { value ->
                runCatching { context.readUpload(Uri.parse(value)).copy(category = category) }.getOrNull()
            }
        } else emptyList()
        sourceCategory = null
        if (detail != null && uploads.isNotEmpty()) viewModel.addQcRecordPhotos(detail.record.orderId, uploads)
    }
    val storagePermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val format = pendingLegacyExport
        pendingLegacyExport = null
        if (granted && format != null) viewModel.exportQcRecordPhotos(context, format)
    }
    val beginExport: (QcPhotoExportFormat) -> Unit = { format ->
        exportOpen = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        ) {
            viewModel.exportQcRecordPhotos(context, format)
        } else {
            pendingLegacyExport = format
            storagePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0x660F172A))
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(vertical = 6.dp)
    ) {
      Surface(Modifier.fillMaxSize(), color = Color.White, shape = RoundedCornerShape(22.dp)) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val dense = maxHeight < 660.dp || maxWidth < 350.dp
            val compact = dense || maxHeight < 760.dp
            Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier.fillMaxWidth().height(if (compact) 54.dp else 62.dp).padding(horizontal = if (compact) 10.dp else 16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedButton(
                        onClick = { exportOpen = true },
                        enabled = detail?.photos?.isNotEmpty() == true && !state.loading
                    ) {
                        Icon(Icons.Default.Download, null, modifier = Modifier.size(if (compact) 16.dp else 18.dp))
                        Text("导出报告", fontSize = if (compact) 13.sp else 14.sp, modifier = Modifier.padding(start = 5.dp))
                    }
                    Text(
                        "组检报告",
                        fontSize = if (compact) 18.sp else 20.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f).padding(start = if (compact) 10.dp else 16.dp)
                    )
                    IconButton(onClick = viewModel::openWorkerPerformance) { Icon(Icons.Default.Close, "关闭") }
                }
                HorizontalDivider(color = Color(0xFFE7ECF3))
                Column(
                    Modifier.fillMaxSize().padding(horizontal = if (compact) 10.dp else 16.dp, vertical = if (compact) 7.dp else 10.dp),
                    verticalArrangement = Arrangement.spacedBy(if (compact) 7.dp else 10.dp)
                ) {
                    state.error?.let { Text(it, color = WorkbenchDanger, fontSize = if (compact) 12.sp else 14.sp) }
                    if (state.loading && detail == null) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text("正在加载记录照片…", color = WorkbenchMuted)
                        }
                    }
                    if (detail != null) {
                        QcRecordSummary(detail.record, dense)
                        QcPhotoGroup(
                            title = "样衣照片",
                            photos = detail.photos.filter { it.category == "qc_sample_photo" },
                            state = state,
                            compact = compact,
                            dense = dense,
                            modifier = Modifier.weight(1f),
                            onAdd = { sourceCategory = "qc_sample_photo"; photoSourceOpen = true },
                            onEdit = { editPhoto = it },
                            onDelete = { deletePhoto = it }
                        )
                        HorizontalDivider(color = Color(0xFFE7ECF3))
                        QcPhotoGroup(
                            title = "尺寸表照片",
                            photos = detail.photos.filter { it.category == "qc_measurement_photo" },
                            state = state,
                            compact = compact,
                            dense = dense,
                            modifier = Modifier.weight(1f),
                            onAdd = { sourceCategory = "qc_measurement_photo"; photoSourceOpen = true },
                            onEdit = { editPhoto = it },
                            onDelete = { deletePhoto = it }
                        )
                    }
                }
            }
        }
      }
    }

    if (photoSourceOpen && sourceCategory != null) {
        val category = sourceCategory!!
        AlertDialog(
            onDismissRequest = { photoSourceOpen = false; sourceCategory = null },
            title = { Text("补充${if (category == "qc_measurement_photo") "尺寸表" else "样衣"}照片") },
            text = { Text("可以连续拍摄，也可以从相册一次选择多张照片。") },
            confirmButton = {
                TextButton(onClick = {
                    photoSourceOpen = false
                    cameraLauncher.launch(Intent(context, PhotoCaptureActivity::class.java).putExtra(PhotoCaptureActivity.EXTRA_MAX_PHOTOS, 10))
                }) { Text("拍照") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = { photoSourceOpen = false; galleryLauncher.launch("image/*") }) { Text("打开相册") }
                    TextButton(onClick = { photoSourceOpen = false; sourceCategory = null }) { Text("取消") }
                }
            }
        )
    }

    editPhoto?.let { photo ->
        QcPhotoEditDialog(
            photo = photo,
            onDismiss = { editPhoto = null },
            onSave = { name, category ->
                detail?.let { viewModel.updateQcRecordPhoto(it.record.orderId, photo, name, category) }
                editPhoto = null
            }
        )
    }

    deletePhoto?.let { photo ->
        AlertDialog(
            onDismissRequest = { deletePhoto = null },
            title = { Text("删除照片") },
            text = { Text("确认删除“${photo.fileName}”吗？此操作只删除你本人上传的这张组检照片。") },
            confirmButton = {
                TextButton(onClick = {
                    detail?.let { viewModel.deleteQcRecordPhoto(it.record.orderId, photo.id) }
                    deletePhoto = null
                }) { Text("删除", color = WorkbenchDanger) }
            },
            dismissButton = { TextButton(onClick = { deletePhoto = null }) { Text("取消") } }
        )
    }

    if (exportOpen && detail != null) {
        AlertDialog(
            onDismissRequest = { exportOpen = false },
            title = { Text("选择导出方式") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(
                        onClick = {
                            beginExport(QcPhotoExportFormat.IMAGE)
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Image, null)
                        Column(Modifier.padding(start = 12.dp).weight(1f)) {
                            Text("导出为图片", fontWeight = FontWeight.Bold)
                            Text("生成一张高清长图并保存到相册（PNG）", color = WorkbenchMuted, fontSize = 12.sp)
                        }
                    }
                    OutlinedButton(
                        onClick = {
                            beginExport(QcPhotoExportFormat.PDF)
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Download, null, tint = Color(0xFFE53935))
                        Column(Modifier.padding(start = 12.dp).weight(1f)) {
                            Text("导出为 PDF", fontWeight = FontWeight.Bold)
                            Text("每张照片生成一页 PDF", color = WorkbenchMuted, fontSize = 12.sp)
                        }
                    }
                    Text(
                        "文件名：${qcExportFileNamePreview(detail.record)}",
                        color = WorkbenchMuted,
                        fontSize = 12.sp
                    )
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { exportOpen = false }) { Text("取消") } }
        )
    }

    if (state.qcExportSavedVisible) {
        LaunchedEffect(Unit) {
            delay(1_000)
            viewModel.finishQcExportSaved()
        }
        Dialog(onDismissRequest = viewModel::finishQcExportSaved) {
            Card(
                modifier = Modifier.clickable(onClick = viewModel::finishQcExportSaved),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                elevation = CardDefaults.cardElevation(defaultElevation = 12.dp)
            ) {
                Text(
                    "已保存",
                    color = WorkbenchNavy,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 48.dp, vertical = 28.dp)
                )
            }
        }
    }
}

@Composable
private fun QcRecordSummary(record: QcPerformanceRecord, dense: Boolean) {
    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFF8FAFD)), shape = RoundedCornerShape(14.dp)) {
        Column(
            Modifier.fillMaxWidth().padding(if (dense) 9.dp else 12.dp),
            verticalArrangement = Arrangement.spacedBy(if (dense) 3.dp else 5.dp)
        ) {
            AutoFitSingleLineText(
                text = listOf(record.styleNo, record.styleName).filter(String::isNotBlank).joinToString(" / ").ifBlank { "未命名款式" },
                maxFontSize = if (dense) 15.sp else 18.sp,
                minFontSize = 8.sp,
                fontWeight = FontWeight.Bold,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("件数：", color = WorkbenchMuted, fontSize = if (dense) 12.sp else 14.sp)
                Text("${record.quantity} 件", color = WorkbenchPrimary, fontSize = if (dense) 12.sp else 14.sp, fontWeight = FontWeight.Bold)
                Surface(color = Color(0xFFEDF5FF), shape = RoundedCornerShape(6.dp), modifier = Modifier.padding(start = 12.dp)) {
                    Text(qcSampleTypeLabel(record.sampleType), color = WorkbenchPrimary, fontSize = if (dense) 10.sp else 12.sp, modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp))
                }
            }
            Text("记录提交时间：${record.eventTime.replace("T", " ").take(16)}", color = WorkbenchMuted, fontSize = if (dense) 11.sp else 13.sp)
        }
    }
}

@Composable
private fun QcPhotoGroup(
    title: String,
    photos: List<QcRecordPhoto>,
    state: AppState,
    compact: Boolean,
    dense: Boolean,
    modifier: Modifier = Modifier,
    onAdd: () -> Unit,
    onEdit: (QcRecordPhoto) -> Unit,
    onDelete: (QcRecordPhoto) -> Unit
) {
    val ordered = photos.sortedByDescending(QcRecordPhoto::createdAt)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(if (compact) 5.dp else 8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(title, fontSize = if (compact) 16.sp else 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            OutlinedButton(onClick = onAdd) {
                Icon(Icons.Default.Add, null, modifier = Modifier.size(if (compact) 16.dp else 18.dp))
                Text("补充", fontSize = if (compact) 13.sp else 14.sp)
            }
        }
        if (ordered.isEmpty()) {
            Text("暂无照片，可以点击“补充”添加。", color = WorkbenchMuted, fontSize = if (compact) 12.sp else 14.sp, modifier = Modifier.padding(vertical = if (compact) 6.dp else 12.dp))
        } else {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                ordered.forEach { photo -> QcPhotoTile(state, photo, compact, dense, onEdit, onDelete) }
            }
        }
    }
}

@Composable
private fun QcPhotoTile(
    state: AppState,
    photo: QcRecordPhoto,
    compact: Boolean,
    dense: Boolean,
    onEdit: (QcRecordPhoto) -> Unit,
    onDelete: (QcRecordPhoto) -> Unit
) {
    val context = LocalContext.current
    val tileWidth = if (dense) 104.dp else if (compact) 124.dp else 144.dp
    val tileHeight = if (dense) 116.dp else if (compact) 146.dp else 178.dp
    val imageHeight = if (dense) 82.dp else if (compact) 106.dp else 132.dp
    Box(Modifier.width(tileWidth).height(tileHeight)) {
        Card(
            onClick = { openQcPhotoPreview(context, state, photo) },
            colors = CardDefaults.cardColors(containerColor = Color(0xFFF3F6FA)),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            Column {
                AsyncImage(
                    model = qcPerformanceImageRequest(context, state, photo.previewUrl, temporary = true),
                    contentDescription = photo.fileName,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().height(imageHeight)
                )
                Text(photo.fileName, fontSize = if (dense) 9.sp else 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(if (dense) 5.dp else 8.dp))
            }
        }
        if (photo.canDelete) {
            IconButton(
                onClick = { onDelete(photo) },
                modifier = Modifier.align(Alignment.TopEnd).size(34.dp).background(Color.White.copy(alpha = 0.92f), RoundedCornerShape(17.dp))
            ) { Icon(Icons.Default.DeleteOutline, "删除照片", tint = Color.Red, modifier = Modifier.size(19.dp)) }
        }
        if (photo.canRename) {
            IconButton(
                onClick = { onEdit(photo) },
                modifier = Modifier.align(Alignment.BottomEnd).size(34.dp).background(Color.White.copy(alpha = 0.94f), RoundedCornerShape(17.dp))
            ) { Icon(Icons.Default.Edit, "编辑照片", modifier = Modifier.size(18.dp)) }
        }
    }
}

@Composable
private fun QcPhotoEditDialog(photo: QcRecordPhoto, onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
    var name by remember(photo.id) { mutableStateOf(photo.fileName) }
    var category by remember(photo.id) { mutableStateOf(photo.category) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("编辑照片") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("文件名") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text("照片分类", color = WorkbenchMuted)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    FilterChip(category != "qc_measurement_photo", { category = "qc_sample_photo" }, { Text("样衣照片") })
                    FilterChip(category == "qc_measurement_photo", { category = "qc_measurement_photo" }, { Text("尺寸表照片") })
                }
            }
        },
        confirmButton = { TextButton(onClick = { onSave(name.trim(), category) }, enabled = name.isNotBlank()) { Text("保存") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
    )
}

private fun openQcPhotoPreview(context: Context, state: AppState, photo: QcRecordPhoto) {
    val session = state.session ?: return
    val url = if (photo.previewUrl.startsWith("http")) photo.previewUrl
    else "${session.endpoint.baseUrl.trimEnd('/')}/${photo.previewUrl.trimStart('/')}"
    context.startActivity(
        Intent(context, AttachmentPreviewActivity::class.java)
            .putExtra(AttachmentPreviewActivity.EXTRA_URL, url)
            .putExtra(AttachmentPreviewActivity.EXTRA_TOKEN, session.token)
            .putExtra(AttachmentPreviewActivity.EXTRA_FILE_NAME, photo.fileName)
    )
}

private fun qcSampleTypeLabel(value: String) = when (value) {
    "initial", "first_sample" -> "初样"
    "repeat", "fit_sample" -> "试身样"
    "revision_sample" -> "修改样"
    "pre_production_sample" -> "产前样"
    "sales_sample" -> "销售样"
    else -> value.ifBlank { "未分类" }
}

private fun qcExportFileNamePreview(record: QcPerformanceRecord): String {
    val stamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss"))
    return listOf(record.styleNo, record.styleName, stamp).filter(String::isNotBlank).joinToString("_")
}

@Composable
fun AccountSecurityPage(state: AppState, viewModel: AppViewModel) {
    val profile = state.accountProfile
    val focusManager = LocalFocusManager.current
    val nextField = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) })
    var username by remember(profile) { mutableStateOf(profile?.username.orEmpty()) }
    var displayName by remember(profile) { mutableStateOf(profile?.displayName.orEmpty()) }
    var phone by remember(profile) { mutableStateOf(profile?.phoneNumber.orEmpty()) }
    var profilePassword by remember { mutableStateOf("") }
    var currentPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    BossScaffold("账号与安全", state, onBack = viewModel::back, onLogout = null) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { PageMessage(state) }
            if (profile != null) {
                item {
                    MobileCard {
                        Text("基本资料", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Text("当前角色：${profile.roleLabel}")
                        if (profile.accountType == "business") {
                            OutlinedTextField(
                                username,
                                { username = it },
                                label = { Text("用户名") },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = nextField,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                        OutlinedTextField(
                            displayName,
                            { displayName = it },
                            label = { Text("姓名 / 显示名称") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                            keyboardActions = nextField,
                            modifier = Modifier.fillMaxWidth()
                        )
                        OutlinedTextField(
                            phone,
                            { phone = it },
                            label = { Text("手机号") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next),
                            keyboardActions = nextField,
                            modifier = Modifier.fillMaxWidth()
                        )
                        OutlinedTextField(
                            profilePassword,
                            { profilePassword = it },
                            label = { Text("修改登录名时输入当前密码") },
                            visualTransformation = PasswordVisualTransformation(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus() }),
                            modifier = Modifier.fillMaxWidth()
                        )
                        Button(
                            { viewModel.saveAccountProfile(username, displayName, phone, profilePassword) },
                            modifier = Modifier.fillMaxWidth()
                        ) { Text("保存资料") }
                    }
                }
            }
            item {
                MobileCard {
                    Text("修改密码", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    OutlinedTextField(
                        currentPassword,
                        { currentPassword = it },
                        label = { Text("当前密码") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Next),
                        keyboardActions = nextField,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        newPassword,
                        { newPassword = it },
                        label = { Text("新密码（至少 8 位）") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Next),
                        keyboardActions = nextField,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        confirmPassword,
                        { confirmPassword = it },
                        label = { Text("确认新密码") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus() }),
                        modifier = Modifier.fillMaxWidth()
                    )
                    Button({ viewModel.savePassword(currentPassword, newPassword, confirmPassword) }, modifier = Modifier.fillMaxWidth()) { Text("保存修改") }
                }
            }
        }
    }
}

@Composable
private fun SelectionField(
    value: String,
    options: List<String>,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onSelect: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier) {
        OutlinedButton(
            onClick = { expanded = true },
            enabled = enabled,
            modifier = Modifier.fillMaxWidth()
        ) { Text(value, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        DropdownMenu(expanded, { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option) },
                    onClick = {
                        onSelect(option)
                        expanded = false
                    }
                )
            }
        }
    }
}

@Composable
private fun Metric(label: String, value: String, modifier: Modifier = Modifier, primary: Boolean = false) {
    Column(modifier) {
        Text(label, color = WorkbenchMuted, fontSize = 13.sp)
        Text(value, color = if (primary) WorkbenchPrimary else Color.Unspecified, fontSize = 18.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun MetricsGrid(values: List<Pair<String, String>>) {
    values.chunked(2).forEach { row ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            row.forEach { (label, value) -> Metric(label, value, Modifier.weight(1f), primary = true) }
            if (row.size == 1) Spacer(Modifier.weight(1f))
        }
    }
}

@Composable
private fun QcMetricsGrid(values: List<Triple<String, String, ImageVector>>) {
    values.chunked(2).forEach { row ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            row.forEach { (label, value, icon) ->
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    Surface(color = Color(0xFFEDF5FF), shape = RoundedCornerShape(10.dp)) {
                        Icon(icon, null, tint = WorkbenchPrimary, modifier = Modifier.padding(8.dp).size(20.dp))
                    }
                    Column(Modifier.padding(start = 9.dp)) {
                        Text(label, color = WorkbenchMuted, fontSize = 12.sp)
                        Text(value, color = WorkbenchPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
            if (row.size == 1) Spacer(Modifier.weight(1f))
        }
    }
}

@Composable
private fun PeriodChip(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    FilterChip(selected, onClick, { Text(label, maxLines = 1) }, modifier = modifier)
}

@Composable
private fun DateButton(context: Context, value: String, modifier: Modifier, onSelect: (String) -> Unit) {
    val selected = runCatching { LocalDate.parse(value) }.getOrElse { LocalDate.now() }
    OutlinedButton(
        onClick = {
            DatePickerDialog(
                context,
                { _, year, month, day -> onSelect(LocalDate.of(year, month + 1, day).toString()) },
                selected.year,
                selected.monthValue - 1,
                selected.dayOfMonth
            ).show()
        },
        modifier = modifier
    ) { Text(value, fontSize = 12.sp) }
}

private fun defaultWorkerRange(period: String): Pair<String, String> {
    val today = LocalDate.now()
    val from = when (period) {
        "week" -> today.minusDays((today.dayOfWeek.value - 1).toLong())
        "three_months" -> today.minusMonths(3).plusDays(1)
        else -> today.withDayOfMonth(1)
    }
    return from.toString() to today.toString()
}

private fun pricingValidation(
    customers: List<BossCustomerChargeItem>,
    internals: List<BossInternalCostItem>
): String? {
    if (customers.any { it.name !in customerNameOptions || it.amount < 0 }) return "请完整填写客户报价金额"
    if (customers.any {
            it.pricingMethod == "unit_quantity" &&
                ((it.unitPrice ?: -1.0) < 0 || (it.quantity ?: -1.0) < 0)
        }) return "请完整填写单价与数量"
    if (internals.any { it.amount < 0 }) return "内部成本金额不能小于零"
    return null
}

private fun enqueueStatementDownload(context: Context, state: AppState, statement: ReconciliationStatement) {
    val session = state.session ?: return
    val url = "${session.endpoint.baseUrl.trimEnd('/')}/api/miniapp/boss/reconciliation-statements/${statement.id}/download"
    val fileName = "${statement.statementNo.ifBlank { "对账单" }}.pdf".replace(Regex("[\\\\/:*?\"<>|]"), "_")
    val request = DownloadManager.Request(Uri.parse(url))
        .addRequestHeader("Authorization", "Bearer ${session.token}")
        .setTitle(fileName)
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
    (context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
}

private fun money(value: Double) = "¥${String.format(Locale.CHINA, "%,.2f", value)}"
private fun formatNumber(value: Double, decimals: Int = 2) =
    if (value.isFinite()) String.format(Locale.CHINA, "%.${decimals}f", value) else "0"
private fun Double.numberInput() = if (this % 1.0 == 0.0) toInt().toString() else toString()
private fun statementStatus(value: String) = when (value) {
    "paid" -> "已收款"
    "returned" -> "已退回"
    else -> "待付款"
}
private fun statementStatusColor(value: String) = when (value) {
    "paid" -> Color(0xFF24724B)
    "returned" -> WorkbenchMuted
    else -> Color(0xFFE97812)
}
private fun chargeStatus(value: String) = when (value) {
    "pending" -> "待确认"
    "confirmed", "effective" -> "已确认"
    "void" -> "已归档"
    else -> value
}
private fun workerTypeLabel(value: String?) = when (value) {
    "cutting" -> "裁剪"
    "sewing" -> "缝制"
    "qc_delivery" -> "组检 / 出库"
    else -> value ?: "-"
}
