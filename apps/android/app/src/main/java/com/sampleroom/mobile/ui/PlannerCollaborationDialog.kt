package com.sampleroom.mobile.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Assignment
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.sampleroom.mobile.data.MobileOrder
import com.sampleroom.mobile.data.PlannerCollaborationClient
import com.sampleroom.mobile.data.PlannerSewingCollaboration
import com.sampleroom.mobile.data.PlannerSewingParticipation
import com.sampleroom.mobile.data.Session
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val CollaborationBlue = Color(0xFF1769E0)
private val CollaborationBlueSoft = Color(0xFFEAF2FF)
private val CollaborationGreen = Color(0xFF12B76A)
private val CollaborationGreenSoft = Color(0xFFEAFBF3)
private val CollaborationOrange = Color(0xFFE76813)
private val CollaborationOrangeSoft = Color(0xFFFFF7F0)
private val CollaborationBorder = Color(0xFFDCE4EE)
private val CollaborationText = Color(0xFF172033)
private val CollaborationMuted = Color(0xFF718096)
private val CollaborationDanger = Color(0xFFD92D20)

internal fun changedPlannerTargets(
    collaboration: PlannerSewingCollaboration?,
    drafts: Map<String, Int?>
): List<Pair<String, Int>> = collaboration?.participants.orEmpty().mapNotNull { participant ->
    if (participant.status != "active") return@mapNotNull null
    val draft = drafts[participant.id]
    if (draft == null || draft <= 0 || draft == participant.targetPieces) null else participant.id to draft
}

internal fun plannerPerformanceNeedsReview(collaboration: PlannerSewingCollaboration?) =
    collaboration != null &&
        collaboration.completedPieces >= collaboration.quantity &&
        collaboration.activeParticipantCount > 0

internal data class PlannerCollaborationExpansionState(
    val ongoingExpanded: Boolean = true,
    val completedExpanded: Boolean = false,
    val warningExpanded: Boolean = false,
    val planningHelpExpanded: Boolean = false
)

@Composable
fun PlannerCollaborationDialog(
    order: MobileOrder,
    session: Session,
    onDismiss: () -> Unit,
    onChanged: () -> Unit
) {
    val client = remember { PlannerCollaborationClient() }
    val scope = rememberCoroutineScope()
    var collaboration by remember(order.id) { mutableStateOf<PlannerSewingCollaboration?>(null) }
    var loading by remember(order.id) { mutableStateOf(true) }
    var saving by remember(order.id) { mutableStateOf(false) }
    var cancellingParticipationId by remember(order.id) { mutableStateOf<String?>(null) }
    var error by remember(order.id) { mutableStateOf<String?>(null) }
    var notice by remember(order.id) { mutableStateOf<String?>(null) }
    var saveConfirmed by remember(order.id) { mutableStateOf(false) }
    var expansion by remember(order.id) { mutableStateOf(PlannerCollaborationExpansionState()) }
    var pendingCancellation by remember(order.id) { mutableStateOf<PlannerSewingParticipation?>(null) }
    var confirmDiscard by remember(order.id) { mutableStateOf(false) }
    val targets = remember(order.id) { mutableStateMapOf<String, Int?>() }

    fun applyServerState(result: PlannerSewingCollaboration, preserveDrafts: Boolean) {
        val previousDrafts = targets.toMap()
        collaboration = result
        targets.clear()
        result.participants.filter { it.status == "active" }.forEach { participant ->
            targets[participant.id] = if (preserveDrafts && previousDrafts.containsKey(participant.id)) {
                previousDrafts[participant.id]
            } else participant.targetPieces
        }
    }

    fun load(preserveDrafts: Boolean = false, messageAfterLoad: String? = null) {
        scope.launch {
            loading = true
            error = null
            runCatching { client.get(session, order.id) }
                .onSuccess {
                    applyServerState(it, preserveDrafts)
                    notice = messageAfterLoad
                }
                .onFailure { error = "暂时无法加载协作信息，请重试。" }
            loading = false
        }
    }

    LaunchedEffect(order.id) { load() }

    val dirtyTargets = changedPlannerTargets(collaboration, targets)
    val busy = loading || saving || cancellingParticipationId != null
    val activeParticipants = collaboration?.participants.orEmpty().filter { it.status == "active" }
    val completedParticipants = collaboration?.participants.orEmpty().filter { it.status == "completed" }

    fun requestClose() {
        if (dirtyTargets.isNotEmpty()) confirmDiscard = true else onDismiss()
    }

    fun saveTargets() {
        val current = collaboration ?: return
        val changes = changedPlannerTargets(current, targets)
        if (changes.isEmpty()) return
        scope.launch {
            saving = true
            error = null
            notice = null
            saveConfirmed = false
            runCatching { client.updateTargets(session, order.id, current.revision, changes) }
                .onSuccess { result ->
                    applyServerState(result, preserveDrafts = false)
                    saving = false
                    saveConfirmed = true
                    onChanged()
                    delay(1200)
                    saveConfirmed = false
                }
                .onFailure { error = "计划分配保存失败，请重试。" }
            saving = false
        }
    }

    fun cancel(participant: PlannerSewingParticipation) {
        val current = collaboration ?: return
        scope.launch {
            cancellingParticipationId = participant.id
            error = null
            notice = null
            runCatching { client.cancelParticipation(session, order.id, participant.id, current.revision) }
                .onSuccess { result ->
                    applyServerState(result.collaboration, preserveDrafts = true)
                    notice = "${participant.workerName} 已取消参与"
                    onChanged()
                }
                .onFailure {
                    load(preserveDrafts = true, messageAfterLoad = "该员工状态已发生变化，请查看最新数据。")
                }
            cancellingParticipationId = null
        }
    }

    if (confirmDiscard) {
        AlertDialog(
            onDismissRequest = { confirmDiscard = false },
            title = { Text("放弃未保存的计划调整？") },
            text = { Text("当前有计划任务尚未保存。") },
            dismissButton = { TextButton(onClick = { confirmDiscard = false }) { Text("继续编辑") } },
            confirmButton = { Button(onClick = { confirmDiscard = false; onDismiss() }) { Text("放弃修改") } }
        )
    }

    pendingCancellation?.let { participant ->
        AlertDialog(
            onDismissRequest = { if (!busy) pendingCancellation = null },
            title = { Text("确认取消${participant.workerName}的参与？") },
            text = {
                Text("仅适用于误加入或实际未参与的情况。\n取消后，该员工手机上的本单任务将失效，且不会产生本单绩效。\n已经实际参与过的员工请勿取消，应由员工提交实际件数后，再由老板更正绩效。")
            },
            dismissButton = { TextButton(onClick = { pendingCancellation = null }, enabled = !busy) { Text("返回") } },
            confirmButton = {
                Button(onClick = { pendingCancellation = null; cancel(participant) }, enabled = !busy) { Text("确认取消参与") }
            }
        )
    }

    Dialog(
        onDismissRequest = { if (!busy && pendingCancellation == null) requestClose() },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)
    ) {
        Box(
            modifier = Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            contentAlignment = Alignment.Center
        ) {
            Card(
                shape = RoundedCornerShape(28.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                modifier = Modifier.fillMaxWidth().fillMaxHeight(0.95f).widthIn(max = 560.dp)
            ) {
                Column(Modifier.fillMaxSize()) {
                    CollaborationHeader(order = order, onClose = ::requestClose, enabled = !busy)
                    LazyColumn(
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        if (loading && collaboration == null) item { Text("正在加载…", color = CollaborationMuted) }
                        error?.let { message -> item { Text(message, color = CollaborationDanger, fontSize = 13.sp) } }
                        notice?.let { message -> item { Text(message, color = CollaborationGreen, fontSize = 13.sp) } }

                        collaboration?.let { current ->
                            item {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    CompactSummary("订单", current.quantity, "件", Icons.AutoMirrored.Filled.Assignment, CollaborationBlue, CollaborationBlueSoft)
                                    CompactSummary("已申报", current.completedPieces, "件", Icons.Default.CheckCircle, CollaborationGreen, CollaborationGreenSoft)
                                    CompactSummary("进行中", current.activeParticipantCount, "人", Icons.Default.Person, CollaborationOrange, CollaborationOrangeSoft)
                                }
                            }
                            item {
                                Column(
                                    Modifier.fillMaxWidth().background(Color(0xFFF7F9FC), RoundedCornerShape(12.dp))
                                        .clickable { expansion = expansion.copy(planningHelpExpanded = !expansion.planningHelpExpanded) }
                                        .padding(horizontal = 12.dp, vertical = 10.dp)
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Default.Info, null, tint = CollaborationBlue, modifier = Modifier.size(18.dp))
                                        Spacer(Modifier.width(8.dp))
                                        Text("计划分配：${current.plannedPieces}件，仅用于生产协调", color = CollaborationMuted, fontSize = 13.sp)
                                    }
                                    AnimatedVisibility(expansion.planningHelpExpanded) {
                                        Text(
                                            "计划任务仅供生产协调，不影响订单阶段和员工最终绩效。",
                                            color = CollaborationMuted,
                                            fontSize = 12.sp,
                                            modifier = Modifier.padding(top = 7.dp, start = 26.dp)
                                        )
                                    }
                                }
                            }
                            if (plannerPerformanceNeedsReview(current)) {
                                item {
                                    PerformanceWarning(current.completedPieces, current.activeParticipantCount, expansion.warningExpanded) {
                                        expansion = expansion.copy(warningExpanded = !expansion.warningExpanded)
                                    }
                                }
                            }
                            item {
                                CollapsibleHeader("进行中 ${activeParticipants.size}人", expansion.ongoingExpanded) {
                                    expansion = expansion.copy(ongoingExpanded = !expansion.ongoingExpanded)
                                }
                            }
                            if (expansion.ongoingExpanded) {
                                if (activeParticipants.isEmpty()) item { EmptyGroupText("当前没有进行中的员工") }
                                else items(activeParticipants, key = { "active-${it.id}" }) { participant ->
                                    ActiveParticipantCard(
                                        participant = participant,
                                        target = targets[participant.id],
                                        busy = busy,
                                        cancelling = cancellingParticipationId == participant.id,
                                        onDecrease = {
                                            val value = targets[participant.id]
                                            if (value != null && value > 1) targets[participant.id] = value - 1
                                        },
                                        onIncrease = {
                                            val value = targets[participant.id] ?: 0
                                            if (value < Int.MAX_VALUE) targets[participant.id] = value + 1
                                        },
                                        onCancel = { pendingCancellation = participant }
                                    )
                                }
                            }
                            item {
                                CollapsibleHeader("已完成 ${completedParticipants.size}人", expansion.completedExpanded) {
                                    expansion = expansion.copy(completedExpanded = !expansion.completedExpanded)
                                }
                            }
                            if (expansion.completedExpanded) {
                                if (completedParticipants.isEmpty()) item { EmptyGroupText("当前没有已完成的员工") }
                                else items(completedParticipants, key = { "completed-${it.id}" }) { participant ->
                                    CompletedParticipantRow(participant)
                                }
                            }
                        }
                    }
                    Surface(shadowElevation = 8.dp, color = Color.White) {
                        Button(
                            onClick = ::saveTargets,
                            enabled = dirtyTargets.isNotEmpty() && !busy,
                            colors = ButtonDefaults.buttonColors(containerColor = CollaborationBlue),
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp).height(54.dp),
                            shape = RoundedCornerShape(14.dp)
                        ) {
                            Text(
                                when {
                                    saving -> "保存中…"
                                    saveConfirmed -> "已保存"
                                    dirtyTargets.isNotEmpty() -> "保存 ${dirtyTargets.size} 处修改"
                                    else -> "保存分配"
                                },
                                fontSize = 17.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CollaborationHeader(order: MobileOrder, onClose: () -> Unit, enabled: Boolean) {
    Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 10.dp, top = 16.dp, bottom = 14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("协作分配", color = CollaborationText, fontSize = 26.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            IconButton(onClick = onClose, enabled = enabled, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Default.Close, "关闭协作分配", tint = CollaborationMuted, modifier = Modifier.size(28.dp))
            }
        }
        Text(
            order.styleName,
            color = CollaborationText,
            fontSize = 19.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 10.dp, end = 10.dp)
        )
        Text(order.styleNo, color = CollaborationMuted, fontSize = 15.sp, modifier = Modifier.padding(top = 4.dp))
    }
}

@Composable
private fun RowScope.CompactSummary(
    label: String,
    value: Int,
    suffix: String,
    icon: ImageVector,
    accent: Color,
    iconBackground: Color
) {
    Card(
        border = BorderStroke(1.dp, CollaborationBorder),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.weight(1f)
    ) {
        Row(Modifier.padding(horizontal = 8.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(36.dp).background(iconBackground, CircleShape), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = accent, modifier = Modifier.size(21.dp))
            }
            Spacer(Modifier.width(7.dp))
            Column {
                Text(label, color = CollaborationMuted, fontSize = 11.sp, maxLines = 1)
                Text("$value$suffix", color = CollaborationText, fontSize = 17.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            }
        }
    }
}

@Composable
private fun PerformanceWarning(completedPieces: Int, activeCount: Int, expanded: Boolean, onToggle: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().background(CollaborationOrangeSoft, RoundedCornerShape(14.dp))
            .clickable(onClick = onToggle).padding(13.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Warning, null, tint = CollaborationOrange, modifier = Modifier.size(21.dp))
            Spacer(Modifier.width(8.dp))
            Text(
                "已申报${completedPieces}件，但仍有${activeCount}人在缝制",
                color = CollaborationOrange,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f)
            )
            Text(if (expanded) "收起说明" else "查看说明", color = CollaborationOrange, fontSize = 13.sp)
            Icon(if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null, tint = CollaborationOrange)
        }
        AnimatedVisibility(expanded) {
            Text(
                "若员工仍在制作，请保持不变；若误加入且未实际参与，请取消参与；若已完成人员件数填写错误，请由老板更正绩效。",
                color = CollaborationMuted,
                fontSize = 13.sp,
                lineHeight = 20.sp,
                modifier = Modifier.padding(top = 10.dp)
            )
        }
    }
}

@Composable
private fun CollapsibleHeader(title: String, expanded: Boolean, onToggle: () -> Unit) {
    val groupName = title.substringBefore(" ")
    Row(
        Modifier.fillMaxWidth().height(48.dp).clickable(onClick = onToggle)
            .semantics { contentDescription = if (expanded) "收起${groupName}员工列表" else "展开${groupName}员工列表" },
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(title, color = CollaborationText, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        Icon(if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null, tint = CollaborationMuted)
    }
}

@Composable
private fun ActiveParticipantCard(
    participant: PlannerSewingParticipation,
    target: Int?,
    busy: Boolean,
    cancelling: Boolean,
    onDecrease: () -> Unit,
    onIncrease: () -> Unit,
    onCancel: () -> Unit
) {
    Card(
        border = BorderStroke(1.dp, CollaborationBorder),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).background(Color(0xFF6F9FF5), CircleShape), contentAlignment = Alignment.Center) {
                    Icon(Icons.Default.Person, null, tint = Color.White, modifier = Modifier.size(32.dp))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(participant.workerName, color = CollaborationText, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    Text("${formatParticipationTime(participant.joinedAt)}加入", color = CollaborationMuted, fontSize = 13.sp)
                }
                Surface(color = CollaborationBlueSoft, shape = RoundedCornerShape(8.dp)) {
                    Text("缝制中", color = CollaborationBlue, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp))
                }
            }
            Row(
                Modifier.fillMaxWidth().background(Color(0xFFFAFBFD), RoundedCornerShape(13.dp))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("计划任务", color = CollaborationText, fontSize = 14.sp, modifier = Modifier.weight(1f))
                OutlinedIconButton(
                    onClick = onDecrease,
                    enabled = !busy && (target ?: 0) > 1,
                    modifier = Modifier.size(46.dp).semantics { contentDescription = "减少${participant.workerName}计划任务" }
                ) { Icon(Icons.Default.Remove, null) }
                Text(
                    target?.toString() ?: "—",
                    color = CollaborationText,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.width(56.dp),
                    textAlign = TextAlign.Center
                )
                OutlinedIconButton(
                    onClick = onIncrease,
                    enabled = !busy,
                    modifier = Modifier.size(46.dp).semantics { contentDescription = "增加${participant.workerName}计划任务" }
                ) { Icon(Icons.Default.Add, null) }
                Text("件", color = CollaborationText, fontSize = 14.sp, modifier = Modifier.padding(start = 8.dp))
            }
            TextButton(onClick = onCancel, enabled = !busy, modifier = Modifier.align(Alignment.End).height(44.dp)) {
                Text(if (cancelling) "正在取消…" else "取消参与", color = CollaborationDanger, fontSize = 15.sp)
            }
        }
    }
}

@Composable
private fun CompletedParticipantRow(participant: PlannerSewingParticipation) {
    Column(
        Modifier.fillMaxWidth().background(Color(0xFFFAFBFD), RoundedCornerShape(14.dp)).padding(14.dp)
    ) {
        Text(participant.workerName, color = CollaborationText, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        Text(
            "已申报${participant.completedPieces ?: 0}件 · ${formatParticipationTime(participant.completedAt)}完成",
            color = CollaborationMuted,
            fontSize = 13.sp,
            modifier = Modifier.padding(top = 5.dp)
        )
        Text("绩效件数仅老板可更正", color = Color(0xFF98A2B3), fontSize = 12.sp, modifier = Modifier.padding(top = 5.dp))
        HorizontalDivider(color = CollaborationBorder, modifier = Modifier.padding(top = 12.dp))
    }
}

@Composable
private fun EmptyGroupText(message: String) {
    Text(
        message,
        color = CollaborationMuted,
        fontSize = 13.sp,
        modifier = Modifier.fillMaxWidth().background(Color(0xFFFAFBFD), RoundedCornerShape(12.dp)).padding(14.dp)
    )
}

private fun formatParticipationTime(value: String): String = value.replace("T", " ")
    .substringAfter(" ", value).take(5).ifBlank { "-" }
