package com.sampleroom.mobile.data

enum class ApiMode(val label: String) {
    UNDETECTED("未检测"), LAN("局域网"), PUBLIC("公网"), UNAVAILABLE("不可用")
}

data class SelectedEndpoint(val baseUrl: String, val mode: ApiMode)

data class AccountIdentity(
    val accountId: String,
    val accountType: String,
    val role: String,
    val homeRoute: String,
    val displayName: String,
    val activeWorkerProfileId: String? = null,
    val activeWorkerType: String? = null,
    val mustChangePassword: Boolean = false
)

data class Session(
    val token: String,
    val expiresAt: String,
    val identity: AccountIdentity,
    val endpoint: SelectedEndpoint
)

data class OrderTask(val label: String, val completed: Boolean)

data class PlannerSewingCollaborationSummary(
    val plannedPieces: Int,
    val completedPieces: Int,
    val activeParticipantCount: Int,
    val effectiveParticipantCount: Int,
    val participantCount: Int,
    val sewingGateSatisfied: Boolean
)

data class MobileOrder(
    val id: String,
    val orderNo: String,
    val styleNo: String,
    val styleName: String,
    val customerName: String,
    val salespersonName: String,
    val quantity: Int,
    val deliveryDate: String,
    val stageLabel: String,
    val sampleType: String,
    val sampleRound: String,
    val remark: String,
    val createdAt: String = "",
    val fabricStatus: String = "",
    val trimStatus: String = "",
    val sampleRequestItems: List<String> = emptyList(),
    val completionStatus: String = "",
    val tasks: List<OrderTask> = emptyList(),
    val stage: String = "",
    val patternTaskStatus: String = "",
    val patternMakerName: String = "",
    val attachments: List<MobileAttachment> = emptyList(),
    val deliverables: List<PlannerDeliverable> = emptyList(),
    val scanRecords: List<PlannerScanRecord> = emptyList(),
    val activeWorkerName: String = "",
    val activeWorkerStartedAt: String = "",
    val thumbnailAttachmentId: String = "",
    val thumbnailUrl: String = "",
    val recordSubmittedAt: String = "",
    val chargeCount: Int = 0,
    val sewingMode: String = "single",
    val sewingCollaboration: PlannerSewingCollaborationSummary? = null
)

data class PlannerDeliverable(
    val id: String,
    val fileName: String,
    val type: String,
    val version: String,
    val uploadedByName: String,
    val createdAt: String
)

data class PlannerScanRecord(
    val id: String,
    val stageLabel: String,
    val actionLabel: String,
    val workerName: String,
    val eventTime: String,
    val pieces: Int? = null,
    val workHours: Double? = null,
    val qualityResult: String = ""
)

data class MobileAttachment(
    val id: String,
    val orderId: String,
    val fileName: String,
    val mimeType: String,
    val category: String,
    val uploadedByName: String,
    val uploadedByRole: String,
    val createdAt: String,
    val size: Long = 0,
    val visibility: String = "internal_only",
    val orderChargeId: String = "",
    val hasFile: Boolean = true,
    val canRename: Boolean = false,
    val canDelete: Boolean = false
)

data class BossPricingRow(
    val order: MobileOrder,
    val receivableTotal: Double,
    val customerQuoteSubtotal: Double,
    val confirmedOtherChargeTotal: Double,
    val internalTotalCost: Double,
    val quotationStatus: String,
    val quotationChanged: Boolean,
    val eligible: Boolean,
    val tasks: List<String>
)

data class BossPricingDetail(
    val row: BossPricingRow,
    val customerCharges: List<BossCustomerChargeItem>,
    val internalCosts: List<BossInternalCostItem>,
    val otherCharges: List<BossOrderCharge> = emptyList(),
    val recommendationsInitialized: Boolean = false,
    val hasConfirmedQuotation: Boolean = false
)

data class BossCustomerChargeItem(
    val id: String,
    val name: String,
    val pricingMethod: String,
    val unitPrice: Double? = null,
    val quantity: Double? = null,
    val amount: Double,
    val sourceType: String = "manual",
    val sourceTask: String = "",
    val note: String = "",
    val archivedAt: String = ""
)

data class BossInternalCostItem(
    val id: String,
    val name: String,
    val category: String,
    val amount: Double,
    val sourceType: String = "manual",
    val sourceTask: String = "",
    val note: String = "",
    val archivedAt: String = ""
)

data class BossOrderCharge(
    val id: String,
    val name: String,
    val amount: Double,
    val creatorName: String,
    val creatorRole: String,
    val status: String,
    val archivedAt: String = "",
    val createdAt: String
)

data class StatementItem(
    val id: String,
    val orderId: String,
    val orderNo: String,
    val styleNo: String,
    val styleName: String,
    val customerName: String,
    val salespersonName: String,
    val quantity: Int,
    val sampleAmount: Double,
    val patternFeeTotal: Double,
    val otherChargeTotal: Double,
    val receivableTotal: Double,
    val returnedAt: String = ""
)

data class ReconciliationStatement(
    val id: String,
    val statementNo: String,
    val customerName: String,
    val salespersonName: String,
    val billingPeriod: String,
    val orderCount: Int,
    val receivableAmount: Double,
    val paidAmount: Double,
    val status: String,
    val generatedAt: String,
    val items: List<StatementItem>
)

data class WorkerPerformance(
    val workerName: String,
    val workerType: String,
    val completedOrders: Int,
    val completedPieces: Int,
    val totalHours: Double,
    val averageHoursPerPiece: Double,
    val hourlyOutput: Double,
    val averageQualityScore: Double? = null,
    val unratedOrders: Int = 0,
    val checkedPieces: Int = 0,
    val complaintOrders: Int = 0,
    val complaintRate: Double = 0.0,
    val records: List<WorkerPerformanceRecord>
)

data class WorkerPerformanceRecord(
    val orderId: String,
    val scanRecordId: String = "",
    val styleNo: String,
    val styleName: String,
    val completedAt: String,
    val pieces: Int,
    val workHours: Double,
    val qualityScore: Double? = null,
    val complaintCount: Int = 0
)

data class QcPerformanceRecord(
    val orderId: String,
    val styleNo: String,
    val styleName: String,
    val status: String,
    val quantity: Int,
    val score: Double?,
    val eventTime: String,
    val thumbnailUrl: String,
    val sampleType: String = "",
    val reworkReason: String = ""
)

data class QcRecordPhoto(
    val id: String,
    val fileName: String,
    val mimeType: String,
    val category: String,
    val createdAt: String,
    val previewUrl: String,
    val canRename: Boolean = true,
    val canDelete: Boolean = true
)

data class QcRecordDetail(
    val record: QcPerformanceRecord,
    val photos: List<QcRecordPhoto>
)

data class SewingTask(
    val orderId: String,
    val styleNo: String,
    val styleName: String,
    val sampleType: String,
    val sampleRound: String,
    val quantity: Int,
    val startedAt: String,
    val thumbnailUrl: String,
    val previousReworkReason: String = "",
    val collaboration: Boolean = false,
    val participationId: String = "",
    val targetPieces: Int? = null,
    val collaborationRevision: String = ""
)

data class PlannerSewingParticipation(
    val id: String,
    val workerName: String,
    val joinedAt: String,
    val targetPieces: Int? = null,
    val status: String,
    val completedPieces: Int? = null,
    val completedAt: String = "",
    val cancelledAt: String = ""
)

data class PlannerSewingCollaboration(
    val orderId: String,
    val quantity: Int,
    val revision: String,
    val plannedPieces: Int,
    val unallocatedPieces: Int,
    val completedPieces: Int,
    val activeParticipantCount: Int,
    val effectiveParticipantCount: Int,
    val sewingGateSatisfied: Boolean,
    val participants: List<PlannerSewingParticipation>
)

data class PlannerParticipationCancellation(
    val sewingMode: String,
    val collaboration: PlannerSewingCollaboration
)

data class AccountSecurityProfile(
    val accountType: String,
    val username: String,
    val phoneNumber: String,
    val displayName: String,
    val roleLabel: String
)

data class ReceiverClientUser(
    val id: String,
    val customerId: String,
    val displayName: String
)

data class ReceiverCustomer(
    val id: String,
    val name: String,
    val clientUsers: List<ReceiverClientUser>
)

data class ReceiverIntakeDraft(
    val customerId: String,
    val clientUserId: String,
    val styleNo: String = "",
    val styleName: String = "",
    val quantity: String = "1",
    val sampleType: String = "first_sample",
    val sampleRound: String = "round_1",
    val deliveryDate: String,
    val remark: String = "",
    val fabricStatus: String = "missing",
    val trimStatus: String = "missing",
    val sampleRequestItems: List<String> = listOf("sample_garment", "pattern_making", "cutting")
)

data class ReceiverChargeAttachment(
    val id: String,
    val fileName: String,
    val mimeType: String = "",
    val size: Long = 0,
    val visibility: String = "internal_only",
    val canRename: Boolean = false,
    val canDelete: Boolean = false
)

data class ReceiverCharge(
    val id: String,
    val orderId: String,
    val name: String,
    val amount: Double,
    val explanation: String,
    val creatorName: String,
    val creatorRole: String,
    val createdAt: String,
    val canRename: Boolean,
    val canVoid: Boolean,
    val attachments: List<ReceiverChargeAttachment>
)

data class ReceiverScanChargeContext(
    val order: MobileOrder,
    val chargeLocked: Boolean,
    val charges: List<ReceiverCharge>
)

data class ScanResult(
    val token: String,
    val orderId: String = "",
    val entrySource: String = "scan",
    val order: MobileOrder,
    val currentStageLabel: String,
    val statusMessage: String,
    val stage: String?,
    val allowedAction: String,
    val blockedReason: String?,
    val defaultPieces: Int?,
    val activeTaskWorkerId: String?,
    val activeTaskWorkerName: String?,
    val collaborationTargetPieces: Int? = null,
    val collaborationCurrentParticipantCount: Int = 0,
    val collaborationUnallocatedPieces: Int = 0,
    val collaborationParticipationId: String = "",
    val collaborationRevision: String = "",
    val collaborationExpectedActiveWorkerIds: List<String> = emptyList(),
    val latestRework: QcReworkRecord? = null
)

data class QcReworkRecord(
    val note: String,
    val eventTime: String,
    val workerName: String,
    val photos: List<QcReworkPhoto>
)

data class QcReworkPhoto(
    val id: String,
    val fileName: String,
    val previewUrl: String
)

data class WorkerScanCompletion(
    val pieces: Int,
    val workHours: Double? = null,
    val note: String,
    val qualityResult: String? = null,
    val qualityScore: Int? = null,
    val photos: List<UploadPayload> = emptyList()
)

data class UploadPayload(
    val bytes: ByteArray,
    val fileName: String,
    val mimeType: String,
    val category: String? = null
)
