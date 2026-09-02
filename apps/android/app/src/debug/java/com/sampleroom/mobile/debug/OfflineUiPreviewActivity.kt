package com.sampleroom.mobile.debug

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sampleroom.mobile.AppState
import com.sampleroom.mobile.data.MobileAttachment
import com.sampleroom.mobile.data.MobileOrder
import com.sampleroom.mobile.data.PlannerDeliverable
import com.sampleroom.mobile.data.PlannerScanRecord
import com.sampleroom.mobile.ui.Navy
import com.sampleroom.mobile.ui.OrderCard
import com.sampleroom.mobile.ui.OrderDetailPageContent
import com.sampleroom.mobile.ui.SampleRoomTheme

class OfflineUiPreviewActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            SampleRoomTheme {
                OfflineUiPreviewApp()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OfflineUiPreviewApp() {
    var role by remember { mutableStateOf("receiver") }
    var detailOrder by remember { mutableStateOf<MobileOrder?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    val state = remember { AppState(orders = previewOrders) }
    val selectedOrder = detailOrder

    BackHandler {
        if (detailOrder != null) {
            detailOrder = null
        }
    }

    if (selectedOrder != null) {
        OrderDetailPageContent(
            state = state,
            order = selectedOrder,
            kind = role,
            onBack = { detailOrder = null }
        )
        return
    }

    Scaffold(
        containerColor = Color(0xFFF3F6F8),
        topBar = {
            TopAppBar(
                title = { Text("离线界面验收", color = Color.White) },
                colors = androidx.compose.material3.TopAppBarDefaults.topAppBarColors(containerColor = Navy)
            )
        }
    ) { padding ->
        LazyColumn(
            contentPadding = padding,
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp)
        ) {
            item {
                Spacer(Modifier.height(14.dp))
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("DEBUG ONLY · 不连接服务器、不执行上传", color = Color(0xFFC24444), fontWeight = FontWeight.Bold)
                    Text("切换角色后，下方直接复用正式订单卡片和只读详情组件。")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = role == "receiver",
                            onClick = { role = "receiver"; notice = null },
                            label = { Text("接单员") }
                        )
                        FilterChip(
                            selected = role == "planner",
                            onClick = { role = "planner"; notice = null },
                            label = { Text("计划员") }
                        )
                    }
                    notice?.let { Text(it, color = Color(0xFFC24444)) }
                }
            }
            items(previewOrders, key = { it.id }) { order ->
                OrderCard(
                    state = state,
                    order = order,
                    kind = role,
                    onOpen = { detailOrder = order },
                    onAddMaterial = { notice = "离线验收器只验证按钮显隐与布局，不会执行面辅料上传。" }
                )
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

private val previewOrders = listOf(
    MobileOrder(
        id = "offline-long",
        orderNo = "SR-2026-000001",
        styleNo = "LONG-STYLE-NUMBER-2026-秋冬系列-001",
        styleName = "超长款名用于验证窄屏换行与状态标签不会互相覆盖",
        customerName = "苏美达国际技术贸易有限公司超长客户名称",
        salespersonName = "张三丰（华东区域高级客户业务负责人）",
        quantity = 128,
        deliveryDate = "2026-08-31",
        stageLabel = "pattern_waiting",
        sampleType = "first_sample",
        sampleRound = "round_1",
        remark = "备注内容用于确认详情页能够完整换行显示，不会被截断。",
        createdAt = "2026-07-24T09:30:00",
        fabricStatus = "partial",
        trimStatus = "missing",
        sampleRequestItems = listOf(
            "sample_garment",
            "pattern_making",
            "pattern_revision",
            "full_size_pattern",
            "quotation_material",
            "cutting"
        ),
        stage = "pattern_waiting",
        patternTaskStatus = "active",
        patternMakerName = "李版师",
        attachments = listOf(
            MobileAttachment(
                id = "attachment-1",
                orderId = "offline-long",
                fileName = "蓝色主布到货记录.jpg",
                mimeType = "image/jpeg",
                category = "receiver_material_record",
                uploadedByName = "测试接单员",
                uploadedByRole = "receiver",
                createdAt = "2026-07-24T10:00:00"
            )
        ),
        deliverables = listOf(
            PlannerDeliverable(
                id = "deliverable-1",
                fileName = "LONG-STYLE-NUMBER-纸样-v2.dxf",
                type = "pattern",
                version = "v2",
                uploadedByName = "李版师",
                createdAt = "2026-07-24T11:00:00"
            )
        ),
        scanRecords = listOf(
            PlannerScanRecord(
                id = "scan-1",
                stageLabel = "制版",
                actionLabel = "开始",
                workerName = "李版师",
                eventTime = "2026-07-24T11:10:00"
            )
        )
    ),
    MobileOrder(
        id = "offline-normal",
        orderNo = "SR-2026-000002",
        styleNo = "JK-2407",
        styleName = "女式短夹克",
        customerName = "SUMEC",
        salespersonName = "李静",
        quantity = 12,
        deliveryDate = "2026-08-15",
        stageLabel = "sewing_doing",
        sampleType = "fit_sample",
        sampleRound = "round_2",
        remark = "",
        createdAt = "2026-07-23T14:20:00",
        fabricStatus = "ready",
        trimStatus = "ready",
        sampleRequestItems = listOf("sample_garment", "cutting"),
        stage = "sewing_doing",
        patternTaskStatus = "completed",
        patternMakerName = "王版师"
    )
)
