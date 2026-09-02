package com.sampleroom.mobile.ui

import android.app.DatePickerDialog
import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.FilterAlt
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.ui.window.Dialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.sampleroom.mobile.AppState
import com.sampleroom.mobile.AppViewModel
import com.sampleroom.mobile.AttachmentPreviewActivity
import com.sampleroom.mobile.data.MobileOrder
import com.sampleroom.mobile.data.QcPerformanceRecord
import com.sampleroom.mobile.data.SewingTask
import okhttp3.Headers
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.delay

private enum class QueueSheet { Search, Filter, Date }

@Composable
fun PlannerSewingQueuePage(state: AppState, viewModel: AppViewModel, waiting: Boolean) {
    val stage = if (waiting) "sewing_waiting" else "sewing_doing"
    val rows = state.orders.filter { it.stage == stage }
    QueuePage(
        title = if (waiting) "待缝制" else "缝制中",
        state = state,
        rows = rows,
        searchText = { "${it.styleNo} ${it.styleName}" },
        filterValue = { it.sampleType },
        dateValue = { if (waiting) it.createdAt else it.activeWorkerStartedAt },
        onBack = viewModel::openPlannerHome,
        onRefresh = viewModel::refreshCurrentScreen,
        rowContent = { order ->
            PlannerQueueCard(
                state = state,
                order = order,
                waiting = waiting,
                onChanged = viewModel::refreshCurrentScreen
            ) {
                viewModel.openOrder(order, if (waiting) "planner-waiting" else "planner-sewing")
            }
        }
    )
}

@Composable
fun WorkerSewingQueuePage(state: AppState, viewModel: AppViewModel) {
    var terminatedPromptVisible by remember(state.error) {
        mutableStateOf(state.error == "订单已终止")
    }
    val dismissTerminatedPrompt = {
        terminatedPromptVisible = false
        viewModel.openWorkerHome()
    }
    QueuePage(
        title = "缝制中",
        state = state,
        rows = state.sewingTasks,
        searchText = { "${it.styleNo} ${it.styleName}" },
        filterValue = { it.sampleType },
        dateValue = { it.startedAt },
        onBack = viewModel::openWorkerHome,
        onRefresh = viewModel::refreshCurrentScreen,
        rowContent = { task ->
            SewingTaskCard(state, task) { viewModel.openWorkerSewingTask(task.orderId) }
        }
    )
    if (terminatedPromptVisible) {
        LaunchedEffect(state.error) {
            delay(5_000)
            dismissTerminatedPrompt()
        }
        Dialog(onDismissRequest = dismissTerminatedPrompt) {
            Card(
                modifier = Modifier.clickable(onClick = dismissTerminatedPrompt),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White)
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 30.dp, vertical = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("订单已终止", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text("点击提示或等待 5 秒后返回角色首页", fontSize = 12.sp)
                }
            }
        }
    }
}

@Composable
fun WorkerQcReworkQueuePage(state: AppState, viewModel: AppViewModel) {
    QueuePage(
        title = "待返工",
        state = state,
        rows = state.qcReworkTasks,
        searchText = { "${it.styleNo} ${it.styleName}" },
        filterValue = { if (it.quantity <= 1) "1件" else "2件及以上" },
        dateValue = { it.eventTime },
        onBack = viewModel::openWorkerHome,
        onRefresh = viewModel::refreshCurrentScreen,
        rowContent = { task ->
            QcReworkTaskCard(state, task) { viewModel.openWorkerQcReworkTask(task.orderId) }
        }
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> QueuePage(
    title: String,
    state: AppState,
    rows: List<T>,
    searchText: (T) -> String,
    filterValue: (T) -> String,
    dateValue: (T) -> String,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    rowContent: @Composable (T) -> Unit
) {
    var sheet by remember { mutableStateOf<QueueSheet?>(null) }
    var query by remember { mutableStateOf("") }
    var draftQuery by remember { mutableStateOf("") }
    var selectedFilter by remember { mutableStateOf("") }
    var dateFrom by remember { mutableStateOf("") }
    var dateTo by remember { mutableStateOf("") }
    val options = rows.map(filterValue).filter(String::isNotBlank).distinct()
    val filtered = rows.filter { row ->
        (query.isBlank() || searchText(row).contains(query, ignoreCase = true)) &&
            (selectedFilter.isBlank() || filterValue(row) == selectedFilter) &&
            dateValue(row).take(10).let { date ->
                (dateFrom.isBlank() || date >= dateFrom) && (dateTo.isBlank() || date <= dateTo)
            }
    }
    Scaffold(
        containerColor = PageBackground,
        topBar = {
            TopAppBar(
                title = { Text(title, color = Color.White, fontWeight = FontWeight.SemiBold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回", tint = Color.White)
                    }
                },
                actions = {
                    IconButton(onClick = { draftQuery = query; sheet = QueueSheet.Search }) {
                        Icon(Icons.Default.Search, "搜索", tint = Color.White)
                    }
                    IconButton(onClick = { sheet = QueueSheet.Filter }) {
                        Icon(Icons.Default.FilterAlt, "筛选", tint = Color.White)
                    }
                    IconButton(onClick = { sheet = QueueSheet.Date }) {
                        Icon(Icons.Default.CalendarMonth, "时间范围", tint = Color.White)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Navy)
            )
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize().padding(padding)
        ) {
          LazyColumn(
            modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp)
          ) {
            item {
                Column(Modifier.fillMaxWidth().padding(top = 10.dp)) {
                    if (query.isNotBlank()) {
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("搜索：$query", color = Muted, fontSize = 13.sp, modifier = Modifier.weight(1f))
                            IconButton(onClick = { query = ""; draftQuery = "" }) {
                                Icon(Icons.Default.Close, "清除搜索", tint = Muted)
                            }
                        }
                    }
                    Text("共 ${filtered.size} 条任务", color = Muted, fontSize = 13.sp)
                }
            }
            if (state.loading) item { Text("正在加载…", color = Muted, modifier = Modifier.padding(18.dp)) }
            state.error?.let { message -> item { Text(message, color = Color(0xFFB3261E)) } }
            if (!state.loading && filtered.isEmpty()) {
                item { QueueEmptyCard(if (query.isNotBlank() || selectedFilter.isNotBlank() || dateFrom.isNotBlank()) "没有符合条件的任务" else "暂无任务") }
            }
            items(filtered) { row -> rowContent(row) }
            item { Spacer(Modifier.height(16.dp)) }
          }
        }
    }

    when (sheet) {
        QueueSheet.Search -> ModalBottomSheet(onDismissRequest = { sheet = null }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
                Text("搜索任务", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                OutlinedTextField(
                    value = draftQuery,
                    onValueChange = { draftQuery = it },
                    placeholder = { Text("输入款号或款名") },
                    singleLine = true,
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = ImeAction.Search),
                    modifier = Modifier.fillMaxWidth().padding(top = 16.dp)
                )
                Button(
                    onClick = { query = draftQuery.trim(); sheet = null },
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp)
                ) { Text("搜索") }
                if (query.isNotBlank()) TextButton(onClick = { query = ""; draftQuery = ""; sheet = null }) { Text("清除搜索") }
                Spacer(Modifier.height(24.dp))
            }
        }
        QueueSheet.Filter -> ModalBottomSheet(onDismissRequest = { sheet = null }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
                Text("筛选", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                FilterChoice("全部", selectedFilter.isBlank()) { selectedFilter = ""; sheet = null }
                options.forEach { option ->
                    FilterChoice(sampleTypeLabel(option), selectedFilter == option) { selectedFilter = option; sheet = null }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
        QueueSheet.Date -> ModalBottomSheet(onDismissRequest = { sheet = null }) {
            QueueDateSheet(dateFrom, dateTo, onSelect = { from, to -> dateFrom = from; dateTo = to; sheet = null })
        }
        null -> Unit
    }
}

@Composable
private fun QueueDateSheet(dateFrom: String, dateTo: String, onSelect: (String, String) -> Unit) {
    val context = LocalContext.current
    val today = LocalDate.now()
    var customFrom by remember(dateFrom) { mutableStateOf(dateFrom) }
    var customTo by remember(dateTo) { mutableStateOf(dateTo) }
    val pick: (Boolean) -> Unit = { start ->
        val current = runCatching { LocalDate.parse(if (start) customFrom else customTo) }.getOrDefault(today)
        DatePickerDialog(context, { _, year, month, day ->
            val value = LocalDate.of(year, month + 1, day).toString()
            if (start) customFrom = value else customTo = value
        }, current.year, current.monthValue - 1, current.dayOfMonth).show()
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
        Text("时间范围", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        FilterChoice("今天", false) { onSelect(today.toString(), today.toString()) }
        FilterChoice("最近 7 天", false) { onSelect(today.minusDays(6).toString(), today.toString()) }
        FilterChoice("最近 30 天", false) { onSelect(today.minusDays(29).toString(), today.toString()) }
        FilterChoice("全部时间", dateFrom.isBlank() && dateTo.isBlank()) { onSelect("", "") }
        HorizontalDivider(Modifier.padding(vertical = 10.dp))
        Text("自定义", fontWeight = FontWeight.SemiBold)
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { pick(true) }, modifier = Modifier.weight(1f)) { Text(customFrom.ifBlank { "开始日期" }) }
            OutlinedButton(onClick = { pick(false) }, modifier = Modifier.weight(1f)) { Text(customTo.ifBlank { "结束日期" }) }
        }
        Button(onClick = { onSelect(customFrom, customTo) }, enabled = customFrom.isNotBlank() && customTo.isNotBlank(), modifier = Modifier.fillMaxWidth().padding(top = 10.dp)) { Text("应用") }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun FilterChoice(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        color = if (selected) Color(0xFFEAF2FF) else Color.Transparent,
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp).clickable(onClick = onClick)
    ) {
        Text(label, color = if (selected) Teal else Color(0xFF1E293B), modifier = Modifier.padding(14.dp))
    }
}

@Composable
private fun PlannerQueueCard(
    state: AppState,
    order: MobileOrder,
    waiting: Boolean,
    onChanged: () -> Unit,
    onClick: () -> Unit
) {
    val collaboration = order.sewingMode == "collaboration" || order.activeWorkerName == "多人"
    var collaborationOpen by remember(order.id) { mutableStateOf(false) }
    QueueCard(onClick) {
        PlannerThumbnail(state, order)
        Column(Modifier.weight(1f).padding(start = 11.dp)) {
            CompactStyleIdentity(
                styleNo = order.styleNo,
                styleName = order.styleName,
                maxFontSize = 15.sp,
                minFontSize = 7.sp,
                showLabels = true,
                maxLinesEach = 1
            )
            Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                QueueTag(sampleTypeLabel(order.sampleType))
                Text("数量：${order.quantity}", color = Muted, fontSize = 13.sp)
                QueueTag(roundLabel(order.sampleRound))
                if (collaboration) QueueTag("协作")
                if (order.sewingCollaboration?.let { it.completedPieces >= order.quantity && it.activeParticipantCount > 0 } == true) {
                    QueueTag("绩效数量待确认")
                }
            }
            if (!waiting || collaboration) {
                Text(
                    "缝制人  ${if (collaboration) "多人" else order.activeWorkerName.ifBlank { "-" }}",
                    fontSize = 12.sp,
                    color = Muted,
                    modifier = Modifier.padding(top = 7.dp)
                )
                if (order.activeWorkerStartedAt.isNotBlank()) {
                    Text(
                        "接单时间  ${formatTime(order.activeWorkerStartedAt)}  ·  已接单 ${elapsed(order.activeWorkerStartedAt)}",
                        fontSize = 12.sp,
                        color = Muted,
                        modifier = Modifier.padding(top = 3.dp)
                    )
                }
            }
            order.sewingCollaboration?.let { summary ->
                Text(
                    "计划分配 ${summary.plannedPieces}件 · 已申报绩效 ${summary.completedPieces}件 · 进行中 ${summary.activeParticipantCount}人",
                    fontSize = 12.sp,
                    color = Muted,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
            if (collaboration && state.session != null) {
                OutlinedButton(
                    onClick = { collaborationOpen = true },
                    modifier = Modifier.padding(top = 7.dp)
                ) { Text("协作分配") }
            }
        }
    }
    if (collaborationOpen && state.session != null) {
        PlannerCollaborationDialog(
            order = order,
            session = state.session,
            onDismiss = { collaborationOpen = false },
            onChanged = onChanged
        )
    }
}

@Composable
private fun SewingTaskCard(state: AppState, task: SewingTask, onClick: () -> Unit) {
    QueueCard(onClick) {
        QueueThumbnail(state, task.thumbnailUrl, "${task.styleNo} 缩略图")
        Column(Modifier.weight(1f).padding(start = 11.dp)) {
            AutoFitSingleLineText(
                text = "${task.styleNo} · ${task.styleName}",
                maxFontSize = 16.sp,
                minFontSize = 8.sp,
                fontWeight = FontWeight.Bold
            )
            Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                QueueTag(sampleTypeLabel(task.sampleType))
                QueueTag(roundLabel(task.sampleRound))
                Text("数量：${task.quantity}", color = Muted, fontSize = 13.sp)
                if (task.collaboration) QueueTag("协作")
            }
            if (task.collaboration) {
                Text(
                    "我的任务：参与缝制",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Teal,
                    modifier = Modifier.padding(top = 7.dp)
                )
            }
            Text(
                "接单时间  ${formatTime(task.startedAt)}  ·  已接单 ${elapsed(task.startedAt)}",
                fontSize = 12.sp,
                color = Muted,
                modifier = Modifier.padding(top = if (task.collaboration) 3.dp else 7.dp)
            )
            if (task.previousReworkReason.isNotBlank()) Text("上一轮返工：${task.previousReworkReason}", fontSize = 12.sp, color = Color(0xFFC55A11), maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
private fun QcReworkTaskCard(state: AppState, task: QcPerformanceRecord, onClick: () -> Unit) {
    QcReworkSummaryCard(
        state = state,
        thumbnailPath = task.thumbnailUrl,
        styleNo = task.styleNo,
        styleName = task.styleName,
        quantity = task.quantity,
        sampleType = sampleTypeLabel(task.sampleType),
        reworkReason = task.reworkReason,
        submittedAt = formatShortTime(task.eventTime),
        onClick = onClick
    )
}

@Composable
private fun QueueCard(onClick: () -> Unit, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, Color(0xFFE2E8F0)),
        elevation = CardDefaults.cardElevation(1.dp),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)
    ) { Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically, content = content) }
}

@Composable
private fun PlannerThumbnail(state: AppState, order: MobileOrder) {
    val attachmentId = order.thumbnailAttachmentId
    val path = if (attachmentId.isBlank()) "" else "/api/miniapp/planner/orders/${order.id}/attachments/$attachmentId/download"
    QueueThumbnail(state, path, "${order.styleNo} 缩略图")
}

@Composable
private fun QueueThumbnail(state: AppState, path: String, description: String, size: androidx.compose.ui.unit.Dp = 62.dp) {
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
        Icon(Icons.Default.Image, null, tint = Color(0xFF94A3B8))
        if (url != null && path.isNotBlank()) {
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

@Composable
private fun QueueTag(label: String, warning: Boolean = false) {
    Surface(color = if (warning) Color(0xFFFFF1E8) else Color(0xFFEDF5FF), shape = RoundedCornerShape(5.dp)) {
        Text(label, color = if (warning) Color(0xFFC55A11) else Teal, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
    }
}

@Composable
private fun QueueEmptyCard(message: String) {
    Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
        Text(message, color = Muted, modifier = Modifier.padding(24.dp))
    }
}

private fun sampleTypeLabel(value: String) = when (value) {
    "first_sample" -> "初样"
    "fit_sample" -> "大货样"
    "revision_sample" -> "修改样"
    "pre_production_sample" -> "产前样"
    else -> value.ifBlank { "未分类" }
}

private fun roundLabel(value: String) = when (value) {
    "round_1" -> "第1轮"
    "round_2" -> "第2轮"
    "round_3" -> "第3轮"
    else -> value
}

private fun formatTime(value: String) = value.replace("T", " ").take(16).ifBlank { "-" }
private fun formatShortTime(value: String) = value.replace("T", " ").take(16).removePrefix("${LocalDate.now().year}-").ifBlank { "-" }

private fun elapsed(value: String): String = runCatching {
    val duration = Duration.between(Instant.parse(value), Instant.now())
    val days = duration.toDays()
    val hours = duration.minusDays(days).toHours()
    if (days > 0) "${days}天${hours}小时" else "${duration.toHours()}小时"
}.getOrDefault("-")
