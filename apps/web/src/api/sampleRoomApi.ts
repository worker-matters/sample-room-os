import type { DevRole, DevSession } from "../app/DevSessionContext";
import type { ClientAccessScope, ReceiverQrPrintSettings, Role } from "@sample-room/shared";
import {
  authRequest,
  bodyForAttachmentList,
  bodyForExcelFile,
  bodyForOrderPayload,
  bodyForReceiverQuickPhoto,
  downloadAttachment,
  downloadFile,
  request
} from "./request";

export type IntakeStatus = "pending_receive" | "received" | "needs_client_supplement";
export type PatternStatus = "none" | "has";
export type PatternSourceType =
  | "none"
  | "customer_provided"
  | "previous_order"
  | "same_order_revision";
export type SampleRequestItem =
  | "sample_garment"
  | "sample_small"
  | "cutting"
  | "pattern_making"
  | "material_check"
  | "quote_material_check"
  | "bulk_material_check"
  | "process_instruction"
  | "pattern_padding_amount"
  | "pattern_zipper_length"
  | "pattern_full_size"
  | "pattern_full_size_inkjet"
  | "pattern_full_size_cutting"
  | "pattern_revision"
  | "pattern_print_position"
  | "pattern_embroidery_position"
  | "pattern_sample_cut"
  | "material_layout_diagram"
  | "material_marker"
  | "render_3d"
  | "rotation_video_3d";
export type MaterialStatus = "missing" | "partial" | "complete";
export type OrderStage =
  | "pending_receive"
  | "pattern_waiting"
  | "pattern_doing"
  | "cutting_handoff_waiting"
  | "cutting_waiting"
  | "cutting_doing"
  | "sewing_waiting"
  | "sewing_doing"
  | "qc_delivery_waiting"
  | "done";

export type OrderPatternTaskSummary = {
  status: PatternTaskStatus;
  patternMakerId?: string;
  patternMakerName?: string;
  requirements?: string[];
  completedRequirements?: string[];
  totalWorkHours?: number;
  completionNote?: string;
  completedAt?: string;
  note?: string;
  internalName?: string;
  pausedAt?: string;
  pausedReason?: string;
  deliverables?: PatternDeliverableSummary[];
};

export type PatternDeliverableSummary = {
  id: string;
  version: string;
  type: PatternDeliverableType | string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  textValue?: string;
  uploadedByName?: string;
  uploadedBy?: string;
  taskCategory?: string;
  visibility?: "client_visible" | "internal_only";
  createdAt: string;
  hasFile?: boolean;
};

export type OrderAttachment = {
  id: string;
  orderId: string;
  fileName: string;
  mimeType: string;
  size: number;
  category: string;
  uploadedBy?: string;
  uploadedByRole?: string;
  uploadedByName?: string;
  createdAt: string;
  visibility: "client_visible" | "internal_only";
  hasFile?: boolean;
  sourceCategory?: "client_upload" | "sample_room_upload" | "pattern_maker_upload";
  note?: string;
  patternTaskId?: string;
  patternTaskCategory?: string;
};

export type AttachmentAuditLog = {
  id: string;
  orderId: string;
  attachmentId: string;
  originalFileName: string;
  action: "upload" | "rename" | "visibility_change" | "delete";
  newFileName?: string;
  actorId: string;
  actorName?: string;
  actorRole: string;
  originalUploaderId: string;
  originalUploaderName?: string;
  originalUploaderRole: string;
  attachmentCategory: string;
  sourceCategory?: string;
  patternTaskId?: string;
  patternTaskCategory?: string;
  createdAt: string;
};

export type AuthenticatedUser = {
  id: string;
  accountId: string;
  accountType: "business" | "worker";
  role: DevRole;
  homeRoute: string;
  activeWorkerProfileId?: string;
  activeWorkerType?: "cutting" | "sewing" | "qc_delivery";
  displayName?: string;
  phoneNumber?: string;
  customerId?: string;
  clientUserId?: string;
  clientAccessScope?: ClientAccessScope;
  mustChangePassword?: boolean;
};

export type LoginPayload = (
  | { username: string; phoneNumber?: never }
  | { phoneNumber: string; username?: never }
) & { password: string };

export function loginPayloadForAccount(account: string, password: string): LoginPayload {
  const normalizedAccount = account.trim();
  return /^1[3-9]\d{9}$/.test(normalizedAccount)
    ? { phoneNumber: normalizedAccount, password }
    : { username: normalizedAccount, password };
}

export type LoginResponse = {
  token: string;
  user: AuthenticatedUser;
};

export type SampleTypeOption = { value: string; label: string };
export type SampleTypeDefinition = { code: string; name: string };

export type AccountSecurityProfile = {
  userId: string;
  accountId: string;
  accountType: "business" | "worker";
  username: string | null;
  phoneNumber: string | null;
  displayName: string;
  contact?: string;
  customerId?: string;
  customerName?: string;
  clientUserId?: string;
  clientAccessScope?: ClientAccessScope;
  roleLabel: string;
  status: "active" | "archived";
  mustChangePassword: boolean;
};

export type UpdateOwnAccountProfilePayload = {
  username?: string;
  phoneNumber?: string;
  displayName?: string;
  contact?: string;
  currentPassword?: string;
};

export type ChangeOwnPasswordPayload = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type ProductionStage = "pattern" | "cutting" | "sewing" | "qc_delivery";

export type WorkerIdentityProfileSummary = {
  id: string;
  accountId: string;
  workerType: "cutting" | "sewing" | "qc_delivery";
  workerTypeLabel: string;
  status: "active" | "inactive" | "ended";
  effectiveAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkerIdentityManagementItem = {
  account: {
    id: string;
    displayName: string;
    phoneNumber: string | null;
    accountType: "worker";
    role: "worker";
    status: "active" | "suspended" | "pending" | "archived";
    createdAt: string;
  };
  currentWorkerProfile: WorkerIdentityProfileSummary | null;
  workerProfiles: WorkerIdentityProfileSummary[];
};

export type IdentityQrTokenSummary = {
  id: string;
  purpose: "REGISTER_WORKER";
  workerType: "cutting" | "sewing" | "qc_delivery";
  workerTypeLabel: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type IdentityQrIssueResult = {
  token: IdentityQrTokenSummary;
  registrationUrls?: { public: string | null; lan: string | null };
};

export type WorkerAccountRegistrationInfo = {
  enabled: boolean;
  workerType: "cutting" | "sewing" | "qc_delivery";
  workerTypeLabel: string;
  expiresAt: string;
};

export type ScanAllowedAction =
  | "start"
  | "choose_sewing_assignment"
  | "join_collaboration"
  | "complete"
  | "takeover"
  | "blocked";
export type ScanBlockedReason =
  | "worker_disabled"
  | "done"
  | "terminated"
  | "not_production"
  | "wrong_stage"
  | "previous_unfinished"
  | "other_worker_started"
  | "not_scannable"
  | "SEWING_ROUND_ALREADY_COMPLETED";

export type ScanPageState = {
  order: {
    styleNo: string;
    styleName: string;
    quantity: number;
    customerName: string;
    salespersonName: string;
    thumbnailUrl?: string;
    remark?: string;
    taskInstructionNote?: string;
  };
  worker?: {
    id: string;
    name: string;
    stage: ProductionStage;
    stageLabel: string;
    deviceLabel?: string;
  };
  allowedAction: ScanAllowedAction;
  message?: string;
  blockedReason?: ScanBlockedReason;
  stage: ProductionStage | null;
  stageLabel?: string;
  startedByCurrentWorker?: boolean;
  defaultPieces?: number;
  collaboration?: {
    participationId?: string;
    targetPieces?: number;
    completedPieces: number;
    orderQuantity: number;
    activeParticipantCount: number;
    currentParticipantCount: number;
    plannedPieces: number;
    unallocatedPieces: number;
    revision?: string;
    expectedActiveWorkerIds?: string[];
  };
  activeTask?: {
    stage: ProductionStage;
    stageLabel: string;
    workerId: string;
    workerName: string;
    startedAt: string;
  };
  patternTaskWarning?: {
    status: PatternTaskStatus;
    patternMakerName?: string;
    unclaimed: boolean;
    unfinishedRequirements: string[];
  };
  latestRework?: {
    note?: string;
    eventTime: string;
    workerName?: string;
    photos: Array<{ id: string; fileName: string; previewUrl: string }>;
  };
};

export type ScanTestIdentity =
  | "cutting"
  | "sewing"
  | "qc_delivery"
  | "receiver"
  | "planner"
  | "boss"
  | "client_supervisor"
  | "client_salesperson";

export type ScanResolveResponse = {
  parsed: {
    version: "SRS2" | "legacy";
    type: "ORDER";
    sourceFormat: "plain_text" | "legacy_url" | "relative_path" | "bare_token";
  };
  actor: {
    kind: "worker" | "unbound_worker" | "account";
    role?: string;
    workerId?: string;
  };
  order: ScanPageState["order"];
  allowedActions: string[];
  state?: ScanPageState;
};

export type ScanRecord = {
  id: string;
  orderId: string;
  stage: ProductionStage;
  stageLabel: string;
  orderStage: OrderStage;
  action: "start" | "complete" | "termination_complete";
  actionLabel: string;
  workerId: string;
  workerName: string;
  eventTime: string;
  workHours?: number;
  pieces?: number;
  note?: string;
  takeoverFromWorkerId?: string;
  takeoverFromWorkerName?: string;
  takeoverReason?: string;
  qualityResult?: "qualified" | "rework" | "rejected";
  qualityScore?: number;
  samplePhotoAttachmentIds?: string[];
  measurementPhotoAttachmentIds?: string[];
  measurementPhotoAttachmentId?: string;
  terminationCycleAt?: string;
  terminationSettlementStatus?: "pending" | "accepted" | "historical";
};

export type QcTabletOrder = {
  orderId: string;
  orderNo: string;
  styleNo: string;
  styleName: string;
  sampleType: string;
  sampleRound: string;
  quantity: number;
  customerId: string;
  customerName: string;
  clientUserId: string;
  salespersonName: string;
  eventTime: string;
  qualityResult: "qualified" | "rework";
  qualityScore?: number;
  note?: string;
  pieces?: number;
  thumbnailUrl?: string;
  remark?: string;
  taskInstructionNote?: string;
  workerName?: string;
};

export type QcTabletOrderList = {
  orders: QcTabletOrder[];
  filterOptions: {
    customers: Array<{ id: string; name: string }>;
    salespersons: Array<{ id: string; name: string }>;
  };
};

export type QcTabletOrderDetail = QcTabletOrder & {
  state: ScanPageState;
  attachments: OrderAttachment[];
  latestRework?: {
    note?: string;
    eventTime: string;
    workerName?: string;
    photos: OrderAttachment[];
  };
};

export type AdminQcResult = {
  qualityResult: "qualified" | "rework";
  qualityScore?: number;
  pieces?: number;
  note?: string;
  workerName?: string;
  eventTime: string;
  photos: OrderAttachment[];
};

export type QcOwnPerformance = {
  worker: { displayName: string; workerType: "qc_delivery" };
  summary: {
    completedOrders: number;
    completedPieces: number;
    checkedPieces?: number;
    complaintOrders?: number;
    complaintRate?: number;
  };
  records: Array<{
    customerName: string;
    salespersonName: string;
    styleNo: string;
    styleName: string;
    completedAt: string;
    pieces: number | null;
    qualityScore?: number | null;
    reworkCount?: number;
    complaintCount?: number;
  }>;
};

export type QcTabletFilters = {
  q?: string | undefined;
  customerId?: string | undefined;
  clientUserId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
};

export type OrderComplaint = {
  id: string;
  orderId: string;
  description: string;
  qcScanRecordId?: string;
  qcWorkerProfileId?: string;
  qcWorkerNameSnapshot?: string;
  registeredByAccountId: string;
  registeredByName: string;
  createdAt: string;
};

export type AdminOrderDetail = {
  order: OrderRecord;
  scanRecords: ScanRecord[];
  qcReworkRecords: Array<{
    scanRecordId: string;
    photos: OrderAttachment[];
  }>;
  complaints: OrderComplaint[];
};

export type PlannerOrder = {
  id: string;
  orderNo: string;
  sourceType: "client_submission" | "receiver_self_entry" | "internal_manual";
  createdByName?: string;
  customerName: string;
  salespersonName: string;
  styleNo: string;
  styleName: string;
  quantity: number;
  sampleType: string;
  sampleRound: string;
  deliveryDate: string;
  remark?: string;
  terminated: boolean;
  terminatedAt?: string;
  stage: OrderStage | null;
  stageLabel: string;
  patternStatus: string;
  fabricStatus: string;
  trimStatus: string;
  createdAt: string;
  updatedAt: string;
  sampleRequestItems?: SampleRequestItem[];
  attachmentCount?: number;
  chargeCount?: number;
  materialRecordCount?: number;
  thumbnailUrl?: string;
  completionStatus?: "in_progress" | "pattern_only_pending" | "production_completed_pattern_pending" | "completed";
  sewingWorkforce?: {
    mode: "single" | "collaboration";
    workerNames: string[];
  };
  attachments?: OrderAttachment[];
  attachmentLogs?: AttachmentAuditLog[];
  patternTask?: OrderPatternTaskSummary;
  scanRecords?: ScanRecord[];
  activeWorker?: {
    stage: ProductionStage;
    stageLabel: string;
    workerName: string;
    startedAt: string;
  };
};

export type PatternTaskStatus =
  | "pending"
  | "active"
  | "paused"
  | "completed"
  | "submitted"
  | "in_progress"
  | "submitted_to_cutting";
export type CuttingInboxStatus = "pending_print" | "printed" | "cut";
export type PatternDeliverableType =
  | "pattern_file"
  | "cutting_pattern_file"
  | "padding_consumption"
  | "material_consumption"
  | "zipper_length"
  | "full_size_pattern"
  | "layout_diagram"
  | "print_position"
  | "embroidery_position"
  | "process_note"
  | "revision_note"
  | "render_3d"
  | "rotation_video_3d"
  | "other";

export type OrderFolder = {
  id: string;
  orderId: string;
  folderName: string;
  createdAt: string;
  updatedAt: string;
};

export type PatternLibraryEntry = {
  id: string;
  customerId?: string;
  customerName?: string;
  styleNo: string;
  styleName?: string;
  patternVersion: string;
  fileName: string;
  hasFile?: boolean;
  note?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type SubmittedCuttingVersion = {
  id: string;
  orderId: string;
  patternTaskId: string;
  version: string;
  submittedBy: string;
  submittedByName?: string;
  submittedAt: string;
  purpose: "cutting_handoff" | "supplemental_revision";
  status: CuttingInboxStatus;
  printedAt?: string;
  cutAt?: string;
  note?: string;
  workHours?: number;
  files: Array<{
    id: string;
    submissionId: string;
    fileName: string;
    sizeBytes?: number;
    createdAt: string;
  }>;
  order?: {
    id: string;
    styleNo: string;
    styleName: string;
    quantity: number;
    stage: OrderStage | null;
    sampleType: string;
    sampleRound: string;
    patternTaskNote?: string;
  };
};

export type PatternDeliverable = {
  id: string;
  orderId: string;
  patternTaskId: string;
  version: string;
  type: PatternDeliverableType;
  fileName?: string;
  mimeType?: string;
  size?: number;
  textValue?: string;
  structuredData?: Record<string, unknown>;
  visibility: "client_visible" | "internal_only";
  uploadedBy: string;
  uploadedByName?: string;
  taskCategory?: string;
  createdAt: string;
  hasFile?: boolean;
};

export type PatternTask = {
  id: string;
  orderId: string;
  status: PatternTaskStatus;
  patternMakerId?: string;
  patternMakerName?: string;
  internalName?: string;
  linkedPatternLibraryEntryId?: string;
  orderFolderId?: string;
  note?: string;
  pausedAt?: string;
  pausedReason?: string;
  startedAt?: string;
  completedAt?: string;
  submittedAt?: string;
  requirements?: string[];
  completedRequirements?: string[];
  totalWorkHours?: number;
  completionNote?: string;
  createdAt: string;
  updatedAt: string;
  order: Pick<
    OrderRecord,
    | "id"
    | "orderNo"
    | "folderCode"
    | "customerName"
    | "salespersonName"
    | "styleNo"
    | "styleName"
    | "quantity"
    | "sampleType"
    | "sampleRound"
    | "stage"
    | "patternStatus"
    | "patternSourceType"
    | "sourceOrderId"
    | "sourcePatternVersionId"
    | "sampleRequestItems"
    | "sampleGarmentRequired"
    | "taskInstructionNote"
    | "latestPatternVersion"
    | "cuttingUsedPatternVersion"
    | "deliveryDate"
    | "createdAt"
    | "terminated"
  > & { attachments?: OrderAttachment[] };
  orderFolder?: OrderFolder;
  linkedPattern?: PatternLibraryEntry;
  submissions: SubmittedCuttingVersion[];
  deliverables: PatternDeliverable[];
};

export type PatternWorkbench = {
  current?: PatternTask;
  pending: PatternTask[];
  paused: PatternTask[];
  history: PatternTask[];
};

export type OrderCorrectionLogEntry = {
  id: string;
  changedAt: string;
  changedByRole: string;
  changedByUserId: string;
  changedByName?: string;
  fieldName: string;
  oldValue: string | number | null;
  newValue: string | number | null;
};

export type AttachmentMetadataInput = {
  fileName: string;
  mimeType: string;
  size: number;
  category?: string;
  visibility?: OrderAttachment["visibility"] | undefined;
  file?: File;
};

export type OrderRecord = {
  id: string;
  orderNo: string;
  folderCode?: string;
  sourceType?: "client_submission" | "receiver_self_entry" | "internal_manual";
  sourceOrderId?: string;
  sourcePatternVersionId?: string;
  customerId?: string;
  clientUserId?: string;
  customerName?: string;
  salespersonId?: string;
  salespersonName?: string;
  customerSnapshot?: { id: string; name: string };
  clientUserSnapshot?: { id: string; displayName: string };
  styleNo: string;
  styleName: string;
  quantity: number;
  sampleType: string;
  sampleRound: string;
  deliveryDate: string;
  remark?: string;
  taskInstructionNote?: string;
  intakeStatus: IntakeStatus;
  stage: OrderStage | null;
  stageLabel?: string;
  patternStatus: PatternStatus;
  patternSourceType?: PatternSourceType;
  sampleRequestItems: SampleRequestItem[];
  sampleGarmentRequired?: boolean;
  fabricStatus: MaterialStatus;
  trimStatus: MaterialStatus;
  latestPatternVersion?: string;
  cuttingUsedPatternVersion?: string;
  receivedAt?: string;
  receivedBy?: string;
  receivedByName?: string;
  returnReason?: string;
  returnedAt?: string;
  returnedBy?: string;
  supplementCount: number;
  supplementedAt?: string;
  terminated?: boolean;
  terminatedAt?: string;
  terminatedBy?: string;
  terminatedByName?: string;
  terminationReason?: string;
  statusBeforeTermination?: string;
  stageAtTermination?: OrderStage | null;
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  attachmentCount: number;
  chargeCount?: number;
  materialRecordCount?: number;
  quantityCorrectionLocked?: boolean;
  complaintCount?: number;
  qcRecordStatus?: "none" | "rework" | "completed";
  attachments?: OrderAttachment[];
  attachmentLogs?: AttachmentAuditLog[];
  correctionLogs?: OrderCorrectionLogEntry[];
  patternTask?: OrderPatternTaskSummary;
  completionStatus?: "in_progress" | "pattern_only_pending" | "production_completed_pattern_pending" | "completed";
  sewingWorkforce?: {
    mode: "single" | "collaboration";
    workerNames: string[];
  };
  orderFolder?: OrderFolder;
};

export type ClientOrderAttachment = Pick<
  OrderAttachment,
  | "id"
  | "orderId"
  | "fileName"
  | "mimeType"
  | "size"
  | "category"
  | "createdAt"
  | "visibility"
  | "hasFile"
  | "sourceCategory"
> & { canDelete: boolean };

export type ClientOrderPatternTask = Pick<
  OrderPatternTaskSummary,
  "status" | "completedAt" | "requirements" | "completedRequirements"
> & {
  deliverables: Array<
    Pick<
      PatternDeliverableSummary,
      "id" | "version" | "type" | "fileName" | "mimeType" | "size" | "createdAt" | "hasFile"
    >
  >;
};

export type ClientOrder = Pick<
  OrderRecord,
  | "id"
  | "orderNo"
  | "sourceType"
  | "customerId"
  | "clientUserId"
  | "customerName"
  | "salespersonId"
  | "salespersonName"
  | "customerSnapshot"
  | "clientUserSnapshot"
  | "styleNo"
  | "styleName"
  | "quantity"
  | "sampleType"
  | "sampleRound"
  | "deliveryDate"
  | "remark"
  | "intakeStatus"
  | "stage"
  | "patternStatus"
  | "fabricStatus"
  | "trimStatus"
  | "createdAt"
  | "updatedAt"
  | "returnReason"
  | "returnedAt"
  | "supplementCount"
  | "supplementedAt"
  | "sampleRequestItems"
> & {
  attachmentCount: number;
  attachments: ClientOrderAttachment[];
  completionStatus: NonNullable<OrderRecord["completionStatus"]>;
  patternTask?: ClientOrderPatternTask;
};

export type ExtraChargeRecord = {
  id: string;
  pricingRecordId: string;
  label: string;
  amount: number;
  note?: string;
  createdAt: string;
};

export type PricingRecord = {
  id: string;
  orderId: string;
  quotedPrice?: number;
  customerPatternFee?: number;
  internalPatternCost?: number;
  internalCuttingCost?: number;
  internalSewingCost?: number;
  internalFinishingCost?: number;
  finishingPiecesSnapshot?: number | null;
  finishingNote?: string;
  quotationStatus?: "draft" | "confirmed";
  confirmedAt?: string;
  confirmedByName?: string;
  costAmount?: number;
  note?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  extraCharges: ExtraChargeRecord[];
  recommendationsInitializedAt?: string;
  internalCostItems?: InternalCostItem[];
  customerChargeItems?: CustomerChargeItem[];
  confirmedCustomerChargeSnapshot?: CustomerChargeItem[];
  confirmedInternalCostSnapshot?: InternalCostItem[];
  confirmedOtherChargeSnapshot?: Array<{
    id: string;
    name: string;
    amount: number;
    explanation: string;
  }>;
  confirmedCustomerQuoteSubtotal?: number;
  confirmedBaseInternalCost?: number;
  confirmedOtherChargeTotal?: number;
  confirmedReceivableTotal?: number;
  confirmedInternalCostTotal?: number;
  confirmedGrossProfit?: number;
  confirmedGrossMargin?: number;
};

export type PricingItemSourceType =
  | "system_recommended"
  | "manual"
  | "evidence"
  | "legacy";

export type InternalCostCategory =
  | "pattern"
  | "cutting"
  | "sewing"
  | "finishing"
  | "material"
  | "other";

export type InternalCostItem = {
  id: string;
  pricingRecordId: string;
  name: string;
  category: InternalCostCategory;
  sourceType: PricingItemSourceType;
  sourceTask?: string;
  amount: number;
  note?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomerChargeItem = {
  id: string;
  pricingRecordId: string;
  name: string;
  pricingMethod: "fixed" | "unit_quantity";
  unitPrice?: number;
  quantity?: number;
  amount: number;
  sourceType: PricingItemSourceType;
  sourceTask?: string;
  note?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type PricingSummary = {
  orderId: string;
  quotedPrice?: number;
  sampleUnitPrice?: number;
  sampleAmount: number;
  customerPatternFee?: number;
  effectiveCustomerOtherCharges?: number;
  internalPatternCost?: number;
  internalCuttingCost?: number;
  internalSewingCost?: number;
  internalFinishingCost?: number;
  internalTotalCost?: number;
  quotationStatus?: "draft" | "confirmed";
  stageCostTotal: number;
  patternFeeTotal: number;
  otherChargeTotal: number;
  costAmount?: number;
  extraChargeTotal: number;
  receivableTotal: number;
  grossProfit?: number;
  grossMargin?: number;
  customerQuoteSubtotal: number;
  confirmedOtherChargeTotal: number;
  baseInternalCost: number;
};

export type PricingFinishingSummary = {
  visible: boolean;
  pieces: number | null;
  amount: number | null;
  note?: string;
  anomaly:
    | null
    | "sewing_completion_pending"
    | "sewing_pieces_missing"
    | "finishing_evidence_pending"
    | "finishing_pieces_missing";
};

export type PricingCostApplicability = {
  pattern: boolean;
  cutting: boolean;
  sewing: boolean;
  finishing: boolean;
};

export type OrderChargeRecord = {
  id: string;
  orderId: string;
  name: string;
  amount: number;
  explanation: string;
  sourceScene: string;
  creatorId: string;
  creatorName?: string;
  creatorRole: Role;
  status: "pending" | "confirmed" | "rejected" | "cancelled" | "effective" | "void";
  reviewedAt?: string;
  reviewedByName?: string;
  reviewedByRole?: Role;
  voidedAt?: string;
  voidedByName?: string;
  voidedByRole?: Role;
  voidReason?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  cancelledAt?: string;
  cancelReason?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  attachments?: OrderAttachment[];
};

export type OrderChargeCreatePayload = {
  name: string;
  amount: number;
  explanation?: string;
  sourceScene: string;
};

export type MobileScanChargeContext = {
  order: Pick<
    OrderRecord,
    "id" | "styleNo" | "styleName" | "customerName" | "salespersonName"
  >;
  charges: OrderChargeRecord[];
  chargeLocked: boolean;
  chargeLockReason?: "reconciled" | "paid";
};

export type ClientQuotation = {
  sampleUnitPrice: number;
  sampleAmount: number;
  customerPatternFee: number;
  effectiveCustomerOtherCharges: number;
  receivableTotal: number;
  otherCharges?: Array<{ name: string; amount: number; note?: string }>;
  status: "confirmed";
  confirmedAt?: string;
  customerChargeItems?: CustomerChargeItem[];
  customerQuoteSubtotal?: number;
};

export type PerformanceStageSummary = {
  completedStyles?: number;
  completedOrders?: number;
  completedPieces?: number;
  totalHours: number;
  averageHoursPerStyle?: number;
  averageHoursPerPiece?: number;
  internalCost: number;
};

export type PerformanceReport = {
  filters?: {
    dateFrom?: string;
    dateTo?: string;
    stage?: string;
    accountId?: string;
    workerProfileId?: string;
    q?: string;
  };
  overview: {
    pattern: PerformanceStageSummary;
    cutting: PerformanceStageSummary;
    sewing: PerformanceStageSummary;
    finishing: { pieces: number | null; amount: number | null };
  };
  employees: Array<{
    accountId: string;
    role: Role;
    workerProfileId?: string;
    workerType?: "cutting" | "sewing" | "qc_delivery";
    employeeName: string;
    stage: "pattern" | "cutting" | "sewing" | "receiver" | "qc_delivery";
    completedStyles?: number;
    completedOrders?: number;
    completedPieces?: number;
    totalHours?: number;
    averageHoursPerStyle?: number;
    averageHoursPerOrder?: number;
    averageHoursPerPiece?: number;
    internalStageAmount: number;
    unallocatedInternalStageAmount: number;
    completedPatternTasks?: number;
    involvedOrders?: number;
    hourlyOutput?: number | null;
    averageQualityScore?: number | null;
    unratedOrders?: number;
    reworkRate?: number;
    formalOrders?: number;
    checkedPieces?: number;
    complaintOrders?: number;
    complaintRate?: number;
  }>;
  roleSummary: {
    pattern: { completedPatternTasks: number; involvedOrders: number };
    cutting: { completedOrders: number; completedPieces: number };
    sewing: {
      completedOrders: number;
      completedPieces: number;
      totalHours: number;
      hourlyOutput: number | null;
      averageQualityScore: number | null;
      unratedOrders: number;
      reworkRate: number;
    };
    receiver: { formalOrders: number };
    finishing: {
      completedOrders: number;
      completedPieces: number | null;
      amount: number | null;
      averageAmountPerPricedOrder: number | null;
      averageAmountPerPricedPiece: number | null;
      missingAmountOrders: number;
    };
    qcDelivery: {
      completedOrders: number;
      checkedPieces: number;
      complaintOrders: number;
      complaintRate: number;
    };
  };
  orders?: Array<{
    orderId: string;
    orderNo?: string;
    styleNo?: string;
    styleName?: string;
    customerName?: string;
    salespersonName?: string;
    stage?: string;
    employeeName?: string;
    pieces?: number | null;
    workHours?: number | null;
    qualityScore?: number | null;
    reworkCount?: number;
    complaintCount?: number;
    internalStageAmount?: number | null;
    internalCost?: number | null;
    completedAt?: string;
  }>;
  anomalies?: Array<{
    orderId: string;
    orderNo: string;
    stage: "pattern" | "cutting" | "sewing" | "finishing";
    code: "multiple_completion_records" | "sewing_pieces_missing" | "sewing_completion_pending";
    recordCount?: number;
  }>;
};

export type PricingStageWorkSummary = {
  stage: "cutting" | "pattern" | "sewing";
  stageLabel: string;
  workHours: number;
  pieces?: number;
  workerNames: string[];
  completedAt: string;
  note?: string;
};

export type PricingPatternTaskSummary = {
  status: PatternTaskStatus;
  requirements?: string[];
  completedRequirements?: string[];
  patternMakerName?: string;
  completedAt?: string;
  note?: string;
  deliverables?: PatternDeliverableSummary[];
};

export type PricingRow = {
  order: OrderRecord;
  pricing?: PricingRecord;
  summary: PricingSummary;
  stageWork?: PricingStageWorkSummary[];
  patternTask?: PricingPatternTaskSummary;
  confirmedQuotation?: ClientQuotation | null;
  quotationHasUnconfirmedChanges?: boolean;
  orderTasks?: Array<{ key: string; label: string; source: "order_task" }>;
};

export type ReconciliationStatementStatus = "pending_payment" | "paid" | "returned";

export type ReconciliationStatementExportColumn =
  | "orderCreatedDate"
  | "deliveryDate"
  | "thumbnail"
  | "orderNo"
  | "styleNo"
  | "styleName"
  | "sampleType"
  | "sampleRound"
  | "folderCode"
  | "quantity"
  | "quotedPrice"
  | "sampleAmount"
  | "customerPatternFee"
  | "otherChargeTotal"
  | "otherChargeNote"
  | "receivableTotal";

export type ReconciliationStatementItemSnapshot = {
  id: string;
  statementId: string;
  orderId: string;
  orderNo: string;
  orderCreatedAt?: string;
  folderCode?: string;
  styleNo: string;
  styleName: string;
  customerName: string;
  salespersonName: string;
  quantity: number;
  sampleRequestItems?: SampleRequestItem[];
  quotedPrice: number;
  sampleAmount: number;
  patternFeeTotal?: number;
  otherChargeTotal: number;
  otherChargeNote?: string;
  customerChargeSnapshot?: CustomerChargeItem[];
  receivableTotal: number;
  internalPatternCost?: number;
  internalCuttingCost?: number;
  internalSewingCost?: number;
  internalFinishingCost?: number;
  internalCostSnapshot?: InternalCostItem[];
  internalBaseCost?: number;
  internalTotalCost?: number;
  remark?: string;
  orderStatusLabel?: string;
  generatedAt: string;
  returnedAt?: string;
  returnedBy?: string;
  attachments?: OrderAttachment[];
};

export type ReconciliationStatement = {
  id: string;
  statementNo: string;
  customerId?: string;
  clientUserId?: string;
  customerName: string;
  salespersonName: string;
  billingPeriod: string;
  orderCount: number;
  receivableAmount: number;
  paidAmount: number;
  status: ReconciliationStatementStatus;
  generatedAt: string;
  generatedBy?: string;
  paidAt?: string;
  paidBy?: string;
  returnedAt?: string;
  returnedBy?: string;
  items: ReconciliationStatementItemSnapshot[];
};

export type ReconciliationStatementListOptions = {
  q?: string;
  customerId?: string;
  customerBusinessUserId?: string;
  paymentStatus?: "pending" | "paid";
  dateFrom?: string;
  dateTo?: string;
  includeReturned?: boolean;
};

export type SystemOwnerMaintenanceSnapshot = {
  generatedAt: string;
  mode: {
    authMode: string;
    persistenceMode: string;
  };
  counts: {
    orders: {
      total: number;
      active: number;
      terminated: number;
      pendingReceive: number;
      inProduction: number;
      completed: number;
    };
    accounts: {
      customers: number;
      activeCustomers: number;
      archivedCustomers: number;
      clientUsers: number;
      activeClientUsers: number;
      archivedClientUsers: number;
      businessUserRequests: number;
      pendingBusinessUserRequests: number;
    };
    workers: {
      workerAccounts: number;
      activeWorkerAccounts: number;
      suspendedWorkerAccounts: number;
      workerProfiles: number;
      activeWorkerProfiles: number;
      inactiveWorkerProfiles: number;
      endedWorkerProfiles: number;
      identityQrTokens: number;
      usableIdentityQrTokens: number;
    };
    scan: {
      records: number;
      ordersWithRecords: number;
    };
    patternAndCutting: {
      patternTasks: number;
      patternLibraryEntries: number;
      submittedCuttingVersions: number;
      pendingCuttingPrints: number;
    };
    pricing: {
      pricingRecords: number;
      recordsWithQuotedPrice: number;
      recordsWithCost: number;
      extraChargeRows: number;
    };
  };
  safety: {
    containsDatabaseUrl: false;
    containsStorageRoot: false;
    containsScanTokens: false;
    containsStorageKeys: false;
    containsPricingAmounts: false;
  };
  limitations: string[];
};

export type RuntimeConfigStatus = "configured_https" | "configured_http" | "configured_other" | "not_configured";
export type DatabaseConfigStatus = "postgresql_configured" | "configured_other" | "not_configured";
export type StorageRootStatus = "configured" | "not_configured";
export type RuntimeCheckStatus = "pass" | "warn" | "fail" | "skipped";

export type SystemOwnerRuntimeStatus = {
  generatedAt: string;
  appName: "sample-room-operation-cockpit-v2";
  mode: {
    nodeEnv: string;
    authMode: string;
    viteAuthMode: {
      available: boolean;
      value?: string;
      safeMessage?: string;
    };
    persistenceMode: string;
    port: {
      configured: boolean;
      value?: string;
    };
  };
  configuration: {
    publicBaseUrl: RuntimeConfigStatus;
    internalLanBaseUrl: RuntimeConfigStatus;
    databaseUrl: DatabaseConfigStatus;
    storageRoots: Array<{
      key: string;
      status: StorageRootStatus;
    }>;
  };
  safety: {
    redacted: true;
    containsDatabaseUrl: false;
    containsStorageRoot: false;
    containsPublicDomain: false;
    containsIpAddress: false;
    containsToken: false;
    containsStorageKey: false;
    containsCustomerData: false;
    containsAttachmentData: false;
  };
};

export type SystemOwnerRuntimeCheck = {
  key: string;
  label: string;
  status: RuntimeCheckStatus;
  safeMessage: string;
  checkedAt: string;
};

export type SystemOwnerRuntimeChecksResult = {
  generatedAt: string;
  checks: SystemOwnerRuntimeCheck[];
  safety: SystemOwnerRuntimeStatus["safety"];
};

export type RuntimeEndpointConfig = {
  publicWebBaseUrl: string;
  lanWebBaseUrl: string;
  publicApiBaseUrl: string;
  lanApiBaseUrl: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type LanEndpointCandidate = {
  address: string;
  lanWebBaseUrl: string;
  lanApiBaseUrl: string;
};

export type RecoveryPointSummary = { id: string; kind: string; status: string; requestReason: string; appVersion: string; totalSizeBytes: string; createdAt: string; verifiedAt?: string; failedAt?: string; failureReason?: string; createdBy: { actorName: string }; artifacts: Array<{ kind: string; relativeName: string; sizeBytes: string }> };
export type LifecycleMaintenanceJob = { id: string; status: string; action: string; createdAt: string; updateArtifactId?: string; errorCode?: string; errorMessage?: string };
export type LifecycleOperationHistoryItem = {
  id: string;
  operation: string;
  result: "in_progress" | "success" | "failed" | "needs_review" | "cancelled";
  requestedBy: string;
  requestReason: string;
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  subject?: string;
  dataSafety: string;
  nextStep: string;
  technicalCode?: string;
};
export type BackupReadiness = { estimatedSizeBytes: string; availableSpaceBytes: string; canStart: boolean; calculatedAt: string };
export type LifecycleMaintenanceEvent = { id: string; phase?: string; progress?: number; createdAt: string };
export type RestorePreflight = { recoveryPointId: string; canRestore: boolean; database: string; files: string; configuration: string; version: string; diskSpace: string; estimatedDowntime: string; confirmationText: string; message: string };
export type StorageLocationSummary = { status: "normal" | "unavailable"; displayName: string; detailedPath?: string };
export type StorageChangeSummary = { id: string; targetDisplayName: string; status: "prepared" | "running" | "completed" | "failed" | "manual_review_required"; createdAt: string; completedAt?: string; failureReason?: string };
export type StorageManagementOverview = { data: StorageLocationSummary; backup: StorageLocationSummary; recent: StorageChangeSummary[] };
export type SystemUpdatePackage = {
  id: string;
  version: string;
  displayVersion: string;
  status: "checking" | "ready" | "rejected";
  title: string;
  changes: string[];
  databaseImpact: string;
  attachmentImpact: string;
  configurationImpact: string;
  riskLevel: "低" | "中" | "高" | "待检查";
  estimatedDowntime: string;
  compatible?: boolean;
  discoveredAt: string;
  failure?: { whatHappened: string; dataSafety: string; nextStep: string; technicalCode: string };
};
export type SystemUpdateOverview = {
  currentVersion: string;
  packages: SystemUpdatePackage[];
  currentTask?: LifecycleMaintenanceJob;
  latestUpdate?: LifecycleMaintenanceJob;
  updateHistory: Array<{ id: string; displayVersion: string; status: string; startedAt: string; completedAt?: string; errorCode?: string }>;
  maintenanceInProgress: boolean;
  maintenanceServiceOnline: boolean;
};

export type MiniappReleasePreviewConfig = {
  enabled: boolean;
  configured: boolean;
  username: string;
  expiresAt: string | null;
  updatedAt?: string;
  updatedBy?: string;
};

export type PricingUpdatePayload = {
  quotedPrice?: number | null;
  customerPatternFee?: number | null;
  internalPatternCost?: number | null;
  internalCuttingCost?: number | null;
  internalSewingCost?: number | null;
  internalFinishingCost?: number | null;
  finishingNote?: string | null;
  costAmount?: number | null;
  note?: string | null;
  extraCharges?: Array<{
    label: string;
    amount: number;
    note?: string;
  }>;
};

export type AdminOrderPricingDetail = {
  order: OrderRecord;
  pricing?: PricingRecord;
  summary: PricingSummary;
  stageWork?: PricingStageWorkSummary[];
  finishing?: PricingFinishingSummary;
  costApplicability: PricingCostApplicability;
  patternTask?: PricingPatternTaskSummary;
  orderTasks?: Array<{ key: string; label: string; source: "order_task" }>;
  confirmedQuotation?: ClientQuotation | null;
  quotationHasUnconfirmedChanges?: boolean;
};

export type InternalCostItemPayload = {
  name: string;
  category: InternalCostCategory;
  amount: number;
  sourceTask?: string | null;
  note?: string | null;
};

export type CustomerChargeItemPayload = {
  name: string;
  pricingMethod: "fixed" | "unit_quantity";
  unitPrice?: number | null;
  quantity?: number | null;
  amount?: number | null;
  sourceTask?: string | null;
  note?: string | null;
};

export type ClientBusinessUser = {
  id: string;
  customerId: string;
  displayName: string;
  contact?: string;
  clientAccessScope: ClientAccessScope;
  status?: "active" | "archived";
  userId?: string;
  hasLoginAccount?: boolean;
  loginUsername?: string;
  loginStatus?: string;
  loginRole?: Extract<Role, "client_admin" | "client_business_user">;
  archivedAt?: string;
  archivedBy?: string;
};

export type ReceiverSelfEntryCustomer = {
  id: string;
  name: string;
  clientUsers: Array<{
    id: string;
    customerId: string;
    displayName: string;
  }>;
};

export type BusinessUserRequestStatus = "pending" | "approved" | "rejected";
export type BusinessUserRequestSource = "supervisor_request" | "supervisor_registration_code";

export type BusinessUserRequestRecord = {
  id: string;
  customerId: string;
  customerName: string;
  requestedByClientUserId: string;
  requestedByName: string;
  businessUserName: string;
  contact: string;
  roleNote?: string;
  note?: string;
  source?: BusinessUserRequestSource;
  requestedUsername?: string;
  status: BusinessUserRequestStatus;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewedByRole?: string;
  reviewNote?: string;
  createdClientUserId?: string;
};

export type BusinessUserLoginCredential = {
  username: string;
  temporaryPassword: string;
};

export type ClientUserAccountSummary = ClientBusinessUser & {
  contact?: string;
  status: "active" | "archived";
  userId?: string;
  hasLoginAccount: boolean;
  loginUsername?: string;
  loginStatus?: string;
  loginRole?: Extract<Role, "client_admin" | "client_business_user">;
  historicalOrderCount?: number;
};

export type CustomerAccountSummary = {
  id: string;
  name: string;
  status: "active" | "archived";
  archivedAt?: string;
  archivedBy?: string;
  clientUsers: ClientUserAccountSummary[];
};

export type InternalAccountSummary = {
  id: string;
  username: string;
  phoneNumber?: string;
  displayName: string;
  accountType?: "business";
  role: Role;
  status: "active" | "disabled" | "archived";
};

export type UpdateInternalAccountPayload = {
  username?: string;
  displayName?: string;
  status?: "active" | "disabled";
  password?: string;
};

export type CreateInternalAccountPayload = {
  username: string;
  displayName: string;
  role: Extract<Role, "boss" | "receiver" | "planner" | "pattern_maker">;
  password?: string;
};

export type CreateBusinessUserRequestPayload = {
  businessUserName: string;
  contact: string;
  roleNote?: string;
  note?: string;
};

export type SubmitBusinessUserRegistrationPayload = CreateBusinessUserRequestPayload & {
  username: string;
  password: string;
};

export type BusinessUserRegistrationInfo = {
  enabled: boolean;
  message?: string;
  code?: {
    token: string;
    urlPath: string;
    recommendedUrl?: string;
    absoluteUrl?: string;
    customerId: string;
    customerName: string;
    createdByClientUserId: string;
    createdByName: string;
    createdAt: string;
  };
};

export type CreateCustomerPayload = {
  customerName: string;
};

export type UpdateCustomerAccountPayload = {
  name: string;
};

export type UpdateClientUserAccountPayload = {
  displayName?: string;
  username?: string;
  contact?: string;
  clientAccessScope?: ClientAccessScope;
};

export type ReviewBusinessUserRequestPayload = {
  status: Exclude<BusinessUserRequestStatus, "pending">;
  reviewNote?: string;
  targetClientUserId?: string;
};

export type BulkRowResult<T> = {
  index: number;
  status: "valid" | "created" | "failed";
  data?: T;
  error?: string;
};

export type CreateOrderPayload = {
  styleNo: string;
  styleName: string;
  quantity: number;
  sampleType: string;
  sampleRound: string;
  patternStatus: PatternStatus;
  deliveryDate: string;
  remark?: string;
  sampleRequestItems?: SampleRequestItem[];
  attachments?: AttachmentMetadataInput[];
};

export type ClientExcelImportRowInput = {
  styleNo: string;
  styleName: string;
  sampleType: string;
  sampleRound: string;
  quantity: number;
  deliveryDate: string;
  patternStatus: PatternStatus;
  fabricStatus: MaterialStatus;
  trimStatus: MaterialStatus;
  remark?: string;
};

export type ClientExcelImportPreviewRow = {
  rowNumber: number;
  valid: boolean;
  errors: string[];
  data?: ClientExcelImportRowInput;
};

export type ClientExcelImportPreviewResult = {
  totalRows: number;
  validRows: ClientExcelImportRowInput[];
  invalidRows: ClientExcelImportPreviewRow[];
  rows: ClientExcelImportPreviewRow[];
};

export type SupplementOrderPayload = Partial<CreateOrderPayload>;

export type SelfEntryPayload = CreateOrderPayload & {
  customerId: string;
  clientUserId: string;
  fabricStatus: MaterialStatus;
  trimStatus: MaterialStatus;
  attachments?: AttachmentMetadataInput[];
  thumbnailAttachmentIndex?: number | undefined;
};

export type ReceiverQuickPhotoPayload = {
  customerId: string;
  clientUserId: string;
  quantity: number;
  sampleRequestItems: SampleRequestItem[];
  remark?: string;
  attachments: AttachmentMetadataInput[];
  thumbnailAttachmentIndex?: number | undefined;
};

export type SubmitPatternDeliverablePayload = {
  note?: string;
  workHours: number;
  deliverableType?: PatternDeliverableType;
  textValue?: string;
  structuredData?: Record<string, unknown>;
  attachments?: AttachmentMetadataInput[];
  taskCategory?: string;
  completedRequirements?: string[];
  flowDecision?: "follow_requirement" | "requires_cutting" | "no_cutting";
  flowDecisionReason?: string;
  sampleQuantity?: number;
};

export type TrackingPatchPayload = {
  fabricStatus?: MaterialStatus;
  trimStatus?: MaterialStatus;
  patternStatus?: PatternStatus;
  remark?: string;
};

export type ReceiverCorrectionPayload = {
  styleNo?: string | undefined;
  styleName?: string | undefined;
  quantity?: number | undefined;
  sampleType?: string | undefined;
  sampleRound?: string | undefined;
  deliveryDate?: string | undefined;
  remark?: string | undefined;
  patternStatus?: PatternStatus | undefined;
  fabricStatus?: MaterialStatus | undefined;
  trimStatus?: MaterialStatus | undefined;
  sampleRequestItems?: SampleRequestItem[] | undefined;
};

export type AcceptOrderPayload = {
  patternStatus: PatternStatus;
  fabricStatus: MaterialStatus;
  trimStatus: MaterialStatus;
};

export type ReturnOrderPayload = {
  returnReason: string;
};

export type AndroidClientType = "phone" | "pad";

export type AndroidAppRelease = {
  id: string;
  clientType: AndroidClientType;
  packageName: string;
  versionCode: number;
  versionName: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  signerSha256: string[];
  releaseNotes?: string;
  publishedAt: string;
  downloadUrl: string;
};

export const sampleRoomApi = {
  async listSampleTypeOptions(session: DevSession) {
    return request<{ items: SampleTypeOption[] }>(session, "/api/form-options/sample-types");
  },

  async createSampleType(session: DevSession, name: string) {
    return request<{ items: SampleTypeDefinition[] }>(session, "/api/admin/sample-types", {
      method: "POST",
      body: JSON.stringify({ name })
    });
  },

  async renameSampleType(session: DevSession, code: string, name: string) {
    return request<{ items: SampleTypeDefinition[] }>(session, `/api/admin/sample-types/${code}`, {
      method: "PATCH",
      body: JSON.stringify({ name })
    });
  },

  async moveSampleType(session: DevSession, code: string, direction: "up" | "down") {
    return request<{ items: SampleTypeDefinition[] }>(session, `/api/admin/sample-types/${code}/move`, {
      method: "POST",
      body: JSON.stringify({ direction })
    });
  },
  async login(payload: LoginPayload) {
    return authRequest<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async getCurrentUser() {
    try {
      const result = await authRequest<{ user: AuthenticatedUser }>("/api/auth/me");
      return result.user;
    } catch (error) {
      if (error instanceof Error && error.message === "unauthenticated") {
        return null;
      }

      throw error;
    }
  },

  async logout() {
    return authRequest<{ ok: true }>("/api/auth/logout", {
      method: "POST"
    });
  },

  async getAccountSecurityProfile() {
    return authRequest<{ profile: AccountSecurityProfile }>("/api/auth/account-security");
  },

  async updateOwnAccountProfile(payload: UpdateOwnAccountProfilePayload) {
    return authRequest<{ profile: AccountSecurityProfile }>("/api/auth/account-security/profile", {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },

  async changeOwnPassword(payload: ChangeOwnPasswordPayload) {
    return authRequest<{ ok: true }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async listClientOrders(session: DevSession, filters: { clientUserId?: string } = {}) {
    const searchParams = new URLSearchParams();
    if (filters.clientUserId) {
      searchParams.set("clientUserId", filters.clientUserId);
    }

    const queryString = searchParams.toString();
    const query = queryString ? `?${queryString}` : "";
    return request<{
      orders: ClientOrder[];
      clientAccessScope: ClientAccessScope;
      clientUsers: ClientBusinessUser[];
    }>(session, `/api/client/orders${query}`);
  },

  async createClientOrder(session: DevSession, payload: CreateOrderPayload) {
    return request<{ order: ClientOrder }>(session, "/api/client/orders", {
      method: "POST",
      body: bodyForOrderPayload(payload)
    });
  },

  async createClientQuickPhotoOrder(session: DevSession, attachments: AttachmentMetadataInput[]) {
    return request<{ order: ClientOrder }>(session, "/api/client/orders/quick-photo", {
      method: "POST",
      body: bodyForAttachmentList(attachments)
    });
  },

  async previewClientExcelImport(session: DevSession, file: File) {
    return request<ClientExcelImportPreviewResult>(session, "/api/client/orders/excel-import/preview", {
      method: "POST",
      body: bodyForExcelFile(file)
    });
  },

  async confirmClientExcelImport(session: DevSession, rows: ClientExcelImportRowInput[]) {
    return request<{
      orders: ClientOrder[];
      invalidRows: ClientExcelImportPreviewRow[];
      createdCount: number;
    }>(session, "/api/client/orders/excel-import/confirm", {
      method: "POST",
      body: JSON.stringify({ rows })
    });
  },

  async listClientBusinessUserRequests(session: DevSession) {
    return request<{ requests: BusinessUserRequestRecord[] }>(
      session,
      "/api/client/business-user-requests"
    );
  },

  async createClientBusinessUserRequest(
    session: DevSession,
    payload: CreateBusinessUserRequestPayload
  ) {
    return request<{ request: BusinessUserRequestRecord }>(
      session,
      "/api/client/business-user-requests",
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );
  },

  async listClientManagedBusinessUsers(session: DevSession) {
    return request<{ clientUsers: ClientUserAccountSummary[] }>(
      session,
      "/api/client/business-users"
    );
  },

  async updateClientManagedBusinessUserStatus(
    session: DevSession,
    clientUserId: string,
    status: ClientUserAccountSummary["status"]
  ) {
    return request<{ clientUser: ClientUserAccountSummary }>(
      session,
      `/api/client/business-users/${clientUserId}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status })
      }
    );
  },

  async updateClientManagedBusinessUserAccount(
    session: DevSession,
    clientUserId: string,
    payload: UpdateClientUserAccountPayload
  ) {
    return request<{ clientUser: ClientUserAccountSummary }>(
      session,
      `/api/client/business-users/${clientUserId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload)
      }
    );
  },

  async resetClientManagedBusinessUserPassword(
    session: DevSession,
    clientUserId: string,
    password?: string
  ) {
    return request<{
      clientUser: ClientUserAccountSummary;
      loginCredential?: BusinessUserLoginCredential;
    }>(
      session,
      `/api/client/business-users/${clientUserId}/reset-password`,
      {
        method: "POST",
        body: JSON.stringify(password ? { password } : {})
      }
    );
  },

  async getClientBusinessUserRegistrationCode(session: DevSession) {
    return request<{ registration: BusinessUserRegistrationInfo }>(
      session,
      "/api/client/business-user-registration-code"
    );
  },

  async openClientBusinessUserRegistrationCode(session: DevSession) {
    return request<{ registration: BusinessUserRegistrationInfo }>(
      session,
      "/api/client/business-user-registration-code/open",
      { method: "POST" }
    );
  },

  async closeClientBusinessUserRegistrationCode(session: DevSession) {
    return request<{ registration: BusinessUserRegistrationInfo }>(
      session,
      "/api/client/business-user-registration-code/close",
      { method: "POST" }
    );
  },

  async getPublicBusinessUserRegistrationCode(token: string) {
    return authRequest<{ registration: BusinessUserRegistrationInfo }>(
      `/api/client/business-user-registration/${encodeURIComponent(token)}`
    );
  },

  async submitPublicBusinessUserRegistration(
    token: string,
    payload: SubmitBusinessUserRegistrationPayload
  ) {
    return authRequest<{ request: BusinessUserRequestRecord }>(
      `/api/client/business-user-registration/${encodeURIComponent(token)}`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );
  },

  async listAllBusinessUserRequests(session: DevSession) {
    return request<{ requests: BusinessUserRequestRecord[] }>(
      session,
      "/api/system-owner/business-user-requests"
    );
  },

  async listCustomerAccounts(session: DevSession) {
    return request<{ customers: CustomerAccountSummary[] }>(
      session,
      "/api/system-owner/customer-accounts"
    );
  },

  async createCustomer(
    session: DevSession,
    payload: CreateCustomerPayload
  ) {
    return request<{ customer: CustomerAccountSummary }>(session, "/api/system-owner/customer-accounts", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async previewBulkCustomers(session: DevSession, rows: CreateCustomerPayload[]) {
    return request<{ results: BulkRowResult<CreateCustomerPayload>[] }>(
      session,
      "/api/system-owner/customer-accounts/bulk-preview",
      { method: "POST", body: JSON.stringify({ rows }) }
    );
  },

  async bulkCreateCustomers(session: DevSession, rows: CreateCustomerPayload[]) {
    return request<{ results: BulkRowResult<CustomerAccountSummary>[] }>(
      session,
      "/api/system-owner/customer-accounts/bulk",
      { method: "POST", body: JSON.stringify({ rows }) }
    );
  },

  async createClientUserProfile(
    session: DevSession,
    customerId: string,
    payload: { displayName: string; contact?: string }
  ) {
    return request<{ clientUser: ClientUserAccountSummary }>(
      session,
      `/api/system-owner/customer-accounts/${customerId}/client-users`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  async previewBulkClientUsers(
    session: DevSession,
    customerId: string,
    rows: Array<{ displayName: string; contact?: string }>
  ) {
    return request<{ results: BulkRowResult<{ displayName: string; contact?: string }>[] }>(
      session,
      `/api/system-owner/customer-accounts/${customerId}/client-users/bulk-preview`,
      { method: "POST", body: JSON.stringify({ rows }) }
    );
  },

  async bulkCreateClientUsers(
    session: DevSession,
    customerId: string,
    rows: Array<{ displayName: string; contact?: string }>
  ) {
    return request<{ results: BulkRowResult<ClientUserAccountSummary>[] }>(
      session,
      `/api/system-owner/customer-accounts/${customerId}/client-users/bulk`,
      { method: "POST", body: JSON.stringify({ rows }) }
    );
  },

  async updateCustomerAccount(
    session: DevSession,
    customerId: string,
    payload: UpdateCustomerAccountPayload
  ) {
    return request<{ customer: CustomerAccountSummary }>(
      session,
      `/api/system-owner/customer-accounts/${customerId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload)
      }
    );
  },

  async updateCustomerAccountStatus(
    session: DevSession,
    customerId: string,
    status: CustomerAccountSummary["status"]
  ) {
    return request<{ customer: CustomerAccountSummary }>(
      session,
      `/api/system-owner/customer-accounts/${customerId}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status })
      }
    );
  },

  async updateClientUserAccountStatus(
    session: DevSession,
    clientUserId: string,
    status: ClientUserAccountSummary["status"]
  ) {
    return request<{ clientUser: ClientUserAccountSummary }>(
      session,
      `/api/system-owner/client-users/${clientUserId}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status })
      }
    );
  },

  async updateClientUserAccount(
    session: DevSession,
    clientUserId: string,
    payload: UpdateClientUserAccountPayload
  ) {
    return request<{ clientUser: ClientUserAccountSummary }>(
      session,
      `/api/system-owner/client-users/${clientUserId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload)
      }
    );
  },

  async resetClientUserAccountPassword(
    session: DevSession,
    clientUserId: string,
    password?: string
  ) {
    return request<{
      clientUser: ClientUserAccountSummary;
      loginCredential?: BusinessUserLoginCredential;
    }>(
      session,
      `/api/system-owner/client-users/${clientUserId}/reset-password`,
      {
        method: "POST",
        body: JSON.stringify(password ? { password } : {})
      }
    );
  },

  async listInternalAccounts(session: DevSession) {
    return request<{ accounts: InternalAccountSummary[] }>(
      session,
      "/api/system-owner/internal-accounts"
    );
  },

  async createInternalAccount(session: DevSession, payload: CreateInternalAccountPayload) {
    return request<{ account: InternalAccountSummary; temporaryPassword: string }>(
      session,
      "/api/system-owner/internal-accounts",
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );
  },

  async updateInternalAccount(
    session: DevSession,
    id: string,
    payload: UpdateInternalAccountPayload
  ) {
    return request<{ account: InternalAccountSummary }>(
      session,
      `/api/system-owner/internal-accounts/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload)
      }
    );
  },

  async resetInternalAccountPassword(
    session: DevSession,
    id: string,
    password?: string
  ) {
    return request<{ account: InternalAccountSummary; temporaryPassword: string }>(
      session,
      `/api/system-owner/internal-accounts/${id}/reset-password`,
      {
        method: "POST",
        body: JSON.stringify(password ? { password } : {})
      }
    );
  },

  async listWorkerIdentityAccounts(session: DevSession) {
    return request<{ workers: WorkerIdentityManagementItem[] }>(session, "/api/workers");
  },

  async createWorkerRegistrationToken(
    session: DevSession,
    workerType: "cutting" | "sewing" | "qc_delivery"
  ) {
    return request<IdentityQrIssueResult>(session, "/api/workers/registration-tokens", {
      method: "POST",
      body: JSON.stringify({ workerType })
    });
  },

  async getWorkerAccountRegistration(token: string) {
    return authRequest<{ registration: WorkerAccountRegistrationInfo }>(
      `/api/workers/registration/${encodeURIComponent(token)}`
    );
  },

  async completeWorkerAccountRegistration(
    token: string,
    payload: { name: string; phoneNumber: string; password: string }
  ) {
    return authRequest<{ restored: boolean }>(
      `/api/workers/registration/${encodeURIComponent(token)}/complete`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  async revokeWorkerIdentityToken(session: DevSession, tokenId: string) {
    return request<{ token: IdentityQrTokenSummary }>(session, `/api/workers/identity-tokens/${tokenId}`, {
      method: "DELETE"
    });
  },

  async restoreWorkerIdentityProfile(
    session: DevSession,
    accountId: string,
    profileId: string
  ) {
    return request<{ workerProfile: WorkerIdentityProfileSummary }>(
      session,
      `/api/workers/${accountId}/worker-profiles/${profileId}/restore`,
      { method: "POST" }
    );
  },

  async changeWorkerIdentityStage(
    session: DevSession,
    accountId: string,
    workerType: "cutting" | "sewing" | "qc_delivery"
  ) {
    return request<{ workerProfile: WorkerIdentityProfileSummary }>(
      session,
      `/api/workers/${accountId}/change-stage`,
      { method: "POST", body: JSON.stringify({ workerType }) }
    );
  },

  async archiveWorkerIdentityAccounts(session: DevSession, accountIds: string[]) {
    return request<{ archivedAccountIds: string[] }>(session, "/api/workers/archive", {
      method: "POST",
      body: JSON.stringify({ accountIds })
    });
  },

  async updateWorkerIdentityAccount(
    session: DevSession,
    accountId: string,
    input: {
      displayName?: string;
      phoneNumber?: string;
      password?: string;
      status?: "active" | "suspended";
    }
  ) {
    return request<{
      account: WorkerIdentityManagementItem["account"];
      currentWorkerProfile: WorkerIdentityProfileSummary | null;
    }>(session, `/api/workers/${accountId}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  },

  async listAdminActiveOrders(session: DevSession) {
    return request<{ orders: OrderRecord[] }>(session, "/api/admin/orders");
  },

  async listAdminTerminatedOrders(session: DevSession) {
    return request<{ orders: OrderRecord[] }>(session, "/api/admin/orders/terminated");
  },

  async getAdminOrderDetail(session: DevSession, orderId: string) {
    return request<AdminOrderDetail>(session, `/api/admin/orders/${orderId}/detail`);
  },

  async downloadAdminOrderAttachment(session: DevSession, orderId: string, attachmentId: string) {
    return downloadAttachment(
      session,
      `/api/admin/orders/${orderId}/attachments/${attachmentId}/download`
    );
  },

  async registerAdminOrderComplaint(
    session: DevSession,
    orderId: string,
    payload: { description: string }
  ) {
    return request<{ complaint: OrderComplaint }>(session, `/api/admin/orders/${orderId}/complaints`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async deleteAdminOrderComplaint(session: DevSession, orderId: string, complaintId: string) {
    return request<{ complaint: OrderComplaint }>(
      session,
      `/api/admin/orders/${orderId}/complaints/${complaintId}`,
      { method: "DELETE" }
    );
  },

  async listAdminPricingRows(session: DevSession) {
    return request<{ rows: PricingRow[] }>(session, "/api/admin/pricing/orders");
  },

  async listAdminReconciliationStatements(
    session: DevSession,
    options: ReconciliationStatementListOptions = {}
  ) {
    const params = new URLSearchParams();
    if (options.includeReturned) {
      params.set("includeReturned", "true");
    }
    if (options.q?.trim()) {
      params.set("q", options.q.trim());
    }
    if (options.customerId) {
      params.set("customerId", options.customerId);
    }
    if (options.customerBusinessUserId) {
      params.set("customerBusinessUserId", options.customerBusinessUserId);
    }
    if (options.paymentStatus) {
      params.set("paymentStatus", options.paymentStatus);
    }
    if (options.dateFrom) {
      params.set("dateFrom", options.dateFrom);
    }
    if (options.dateTo) {
      params.set("dateTo", options.dateTo);
    }
    const query = params.toString();
    const path = `/api/admin/reconciliation-statements${query ? `?${query}` : ""}`;
    return request<{ statements: ReconciliationStatement[] }>(
      session,
      path
    );
  },

  async downloadAdminReconciliationStatements(
    session: DevSession,
    statementIds: string[],
    columns?: ReconciliationStatementExportColumn[]
  ) {
    return downloadFile(session, "/api/admin/reconciliation-statements/bulk-download", {
      method: "POST",
      body: JSON.stringify({ statementIds, ...(columns ? { columns } : {}) })
    });
  },

  async createAdminReconciliationStatement(session: DevSession, orderIds: string[]) {
    return request<{ statement: ReconciliationStatement }>(
      session,
      "/api/admin/reconciliation-statements",
      {
        method: "POST",
        body: JSON.stringify({ orderIds })
      }
    );
  },

  async returnAdminReconciliationStatement(session: DevSession, statementId: string) {
    return request<{ statement: ReconciliationStatement }>(
      session,
      `/api/admin/reconciliation-statements/${statementId}/return`,
      { method: "POST" }
    );
  },

  async markAdminReconciliationStatementPaid(session: DevSession, statementId: string) {
    return request<{ statement: ReconciliationStatement }>(
      session,
      `/api/admin/reconciliation-statements/${statementId}/mark-paid`,
      { method: "POST" }
    );
  },

  async getSystemOwnerMaintenanceSnapshot(session: DevSession) {
    return request<{ snapshot: SystemOwnerMaintenanceSnapshot }>(
      session,
      "/api/system-owner/maintenance/snapshot"
    );
  },

  async getSystemOwnerRuntimeStatus(session: DevSession) {
    return request<{ runtimeStatus: SystemOwnerRuntimeStatus }>(
      session,
      "/api/system-owner/maintenance/runtime-status"
    );
  },

  async runSystemOwnerRuntimeChecks(session: DevSession) {
    return request<SystemOwnerRuntimeChecksResult>(
      session,
      "/api/system-owner/maintenance/runtime-checks",
      { method: "POST" }
    );
  },

  async downloadSystemOwnerMaintenanceSummaryMarkdown(session: DevSession) {
    return downloadFile(session, "/api/system-owner/maintenance/summary-markdown", {
      method: "POST"
    });
  },

  async getRuntimeEndpointConfig(session: DevSession) {
    return request<{ config: RuntimeEndpointConfig }>(session, "/api/system-owner/maintenance/endpoint-config");
  },

  async updateRuntimeEndpointConfig(session: DevSession, config: RuntimeEndpointConfig) {
    return request<{ config: RuntimeEndpointConfig }>(session, "/api/system-owner/maintenance/endpoint-config", {
      method: "PUT",
      body: JSON.stringify(config)
    });
  },

  async detectLanEndpointCandidates(session: DevSession) {
    return request<{ candidates: LanEndpointCandidate[] }>(session, "/api/system-owner/maintenance/lan-candidates");
  },

  async downloadRuntimeEndpointGuide(session: DevSession) {
    return downloadFile(session, "/api/system-owner/maintenance/endpoint-guide", { method: "POST" });
  },

  async getMiniappReleasePreviewConfig(session: DevSession) {
    return request<{ config: MiniappReleasePreviewConfig }>(
      session,
      "/api/system-owner/maintenance/miniapp-release-preview"
    );
  },

  async updateMiniappReleasePreviewConfig(
    session: DevSession,
    payload: { enabled: boolean; username: string; password?: string; expiresInHours?: number }
  ) {
    return request<{ config: MiniappReleasePreviewConfig }>(
      session,
      "/api/system-owner/maintenance/miniapp-release-preview",
      { method: "PUT", body: JSON.stringify(payload) }
    );
  },

  async getAdminOrderPricing(session: DevSession, orderId: string) {
    return request<AdminOrderPricingDetail>(session, `/api/admin/orders/${orderId}/pricing`);
  },

  async saveAdminOrderPricing(
    session: DevSession,
    orderId: string,
    payload: PricingUpdatePayload
  ) {
    return request<{
      pricing: PricingRecord;
      summary: PricingSummary;
      finishing?: PricingFinishingSummary;
      costApplicability: PricingCostApplicability;
    }>(session, `/api/admin/orders/${orderId}/pricing`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  async renameAdminOrderAttachment(
    session: DevSession,
    orderId: string,
    attachmentId: string,
    displayName: string
  ) {
    return request<{ attachment: OrderAttachment }>(
      session,
      `/api/admin/orders/${orderId}/attachments/${attachmentId}/display-name`,
      { method: "PATCH", body: JSON.stringify({ displayName }) }
    );
  },

  async addAdminOrderAttachments(
    session: DevSession,
    orderId: string,
    attachments: AttachmentMetadataInput[]
  ) {
    return request<{ attachments: OrderAttachment[] }>(
      session,
      `/api/admin/orders/${orderId}/attachments`,
      { method: "POST", body: bodyForAttachmentList(attachments) }
    );
  },

  async changeAdminOrderAttachmentVisibility(
    session: DevSession,
    orderId: string,
    attachmentId: string,
    visibility: OrderAttachment["visibility"]
  ) {
    return request<{ attachment: OrderAttachment }>(
      session,
      `/api/admin/orders/${orderId}/attachments/${attachmentId}/visibility`,
      { method: "PATCH", body: JSON.stringify({ visibility }) }
    );
  },

  async undoAdminReconciliationStatementPaid(session: DevSession, statementId: string) {
    return request<{ statement: ReconciliationStatement }>(
      session,
      `/api/admin/reconciliation-statements/${statementId}/undo-paid`,
      { method: "POST" }
    );
  },

  async deleteAdminOrderAttachment(session: DevSession, orderId: string, attachmentId: string) {
    return request<{ attachment: OrderAttachment }>(
      session,
      `/api/admin/orders/${orderId}/attachments/${attachmentId}`,
      { method: "DELETE" }
    );
  },

  async initializeAdminOrderPricing(session: DevSession, orderId: string) {
    return request<PricingRow & {
      costApplicability: PricingCostApplicability;
      finishing?: PricingFinishingSummary;
      orderTasks?: Array<{ key: string; label: string; source: "order_task" }>;
    }>(session, `/api/admin/orders/${orderId}/pricing/initialize`, { method: "POST" });
  },

  async addAdminInternalCost(
    session: DevSession,
    orderId: string,
    payload: InternalCostItemPayload
  ) {
    return request<PricingRow>(
      session,
      `/api/admin/orders/${orderId}/pricing/internal-costs`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  async updateAdminInternalCost(
    session: DevSession,
    orderId: string,
    itemId: string,
    payload: Partial<InternalCostItemPayload>
  ) {
    return request<PricingRow>(
      session,
      `/api/admin/orders/${orderId}/pricing/internal-costs/${itemId}`,
      { method: "PATCH", body: JSON.stringify(payload) }
    );
  },

  async deleteAdminInternalCost(session: DevSession, orderId: string, itemId: string) {
    return request<PricingRow>(
      session,
      `/api/admin/orders/${orderId}/pricing/internal-costs/${itemId}`,
      { method: "DELETE" }
    );
  },

  async addAdminCustomerCharge(
    session: DevSession,
    orderId: string,
    payload: CustomerChargeItemPayload
  ) {
    return request<PricingRow>(
      session,
      `/api/admin/orders/${orderId}/pricing/customer-charges`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  async updateAdminCustomerCharge(
    session: DevSession,
    orderId: string,
    itemId: string,
    payload: Partial<CustomerChargeItemPayload>
  ) {
    return request<PricingRow>(
      session,
      `/api/admin/orders/${orderId}/pricing/customer-charges/${itemId}`,
      { method: "PATCH", body: JSON.stringify(payload) }
    );
  },

  async deleteAdminCustomerCharge(session: DevSession, orderId: string, itemId: string) {
    return request<PricingRow>(
      session,
      `/api/admin/orders/${orderId}/pricing/customer-charges/${itemId}`,
      { method: "DELETE" }
    );
  },

  async returnAdminReconciliationStatementItem(
    session: DevSession,
    statementId: string,
    itemId: string
  ) {
    return request<{ statement: ReconciliationStatement }>(
      session,
      `/api/admin/reconciliation-statements/${statementId}/items/${itemId}/return`,
      { method: "POST" }
    );
  },

  async confirmAdminOrderPricing(session: DevSession, orderId: string) {
    return request<{ pricing: PricingRecord; summary: PricingSummary }>(
      session,
      `/api/admin/orders/${orderId}/pricing/confirm`,
      { method: "POST" }
    );
  },

  async addOrderCharge(
    session: DevSession,
    role: "receiver" | "planner" | "admin",
    orderId: string,
    payload: OrderChargeCreatePayload
  ) {
    return request<{ charge: OrderChargeRecord }>(session, `/api/${role}/orders/${orderId}/charges`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async listAdminOrderCharges(session: DevSession, orderId: string) {
    return request<{ charges: OrderChargeRecord[] }>(session, `/api/admin/orders/${orderId}/charges`);
  },

  async listOrderCharges(
    session: DevSession,
    role: "receiver" | "planner" | "admin",
    orderId: string
  ) {
    return request<{ charges: OrderChargeRecord[] }>(session, `/api/${role}/orders/${orderId}/charges`);
  },

  async beginAdminOrderPricingUpdate(session: DevSession, orderId: string) {
    return request<AdminOrderPricingDetail>(
      session,
      `/api/admin/orders/${orderId}/pricing/begin-update`,
      { method: "POST" }
    );
  },

  async updateOrderCharge(
    session: DevSession,
    role: "receiver" | "planner" | "admin",
    orderId: string,
    chargeId: string,
    payload: Partial<OrderChargeCreatePayload>
  ) {
    return request<{ charge: OrderChargeRecord }>(
      session,
      `/api/${role}/orders/${orderId}/charges/${chargeId}`,
      { method: "PATCH", body: JSON.stringify(payload) }
    );
  },

  async deleteOrderCharge(
    session: DevSession,
    role: "receiver" | "planner" | "admin",
    orderId: string,
    chargeId: string
  ) {
    return request<{ charge: OrderChargeRecord }>(
      session,
      `/api/${role}/orders/${orderId}/charges/${chargeId}`,
      { method: "DELETE" }
    );
  },

  async addPlannerOrderChargeByScanToken(
    session: DevSession,
    token: string,
    payload: OrderChargeCreatePayload
  ) {
    return request<{ charge: OrderChargeRecord; order?: PlannerOrder }>(
      session,
      `/api/planner/orders/by-scan-token/${encodeURIComponent(token)}/charges`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  async getMobileScanChargeContext(
    session: DevSession,
    role: "receiver" | "planner" | "admin",
    token: string
  ) {
    return request<MobileScanChargeContext>(
      session,
      `/api/${role}/orders/by-scan-token/${encodeURIComponent(token)}/charges`
    );
  },

  async addMobileOrderChargeByScanToken(
    session: DevSession,
    role: "receiver" | "planner" | "admin",
    token: string,
    payload: OrderChargeCreatePayload
  ) {
    return request<{ charge: OrderChargeRecord; context?: MobileScanChargeContext }>(
      session,
      `/api/${role}/orders/by-scan-token/${encodeURIComponent(token)}/charges`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  async addOrderChargeAttachments(
    session: DevSession,
    role: "receiver" | "planner" | "admin",
    orderId: string,
    chargeId: string,
    attachments: AttachmentMetadataInput[]
  ) {
    return request<{ charge: OrderChargeRecord }>(
      session,
      `/api/${role}/orders/${orderId}/charges/${chargeId}/attachments`,
      { method: "POST", body: bodyForAttachmentList(attachments) }
    );
  },

  async deleteOrderChargeAttachment(
    session: DevSession,
    role: "receiver" | "planner" | "admin",
    orderId: string,
    chargeId: string,
    attachmentId: string
  ) {
    return request<{ charge: OrderChargeRecord }>(
      session,
      `/api/${role}/orders/${orderId}/charges/${chargeId}/attachments/${attachmentId}`,
      { method: "DELETE" }
    );
  },

  async renameOrderChargeAttachment(
    session: DevSession,
    role: "receiver" | "planner" | "admin",
    orderId: string,
    chargeId: string,
    attachmentId: string,
    displayName: string
  ) {
    return request<{ charge: OrderChargeRecord }>(
      session,
      `/api/${role}/orders/${orderId}/charges/${chargeId}/attachments/${attachmentId}/display-name`,
      { method: "PATCH", body: JSON.stringify({ displayName }) }
    );
  },

  async voidOwnOrderCharge(
    session: DevSession,
    role: "receiver" | "planner",
    orderId: string,
    chargeId: string
  ) {
    return request<{ charge: OrderChargeRecord }>(
      session,
      `/api/${role}/orders/${orderId}/charges/${chargeId}/void`,
      { method: "POST", body: JSON.stringify({}) }
    );
  },

  async reviewAdminOrderCharge(session: DevSession, orderId: string, chargeId: string) {
    return request<{ charge: OrderChargeRecord }>(
      session,
      `/api/admin/orders/${orderId}/charges/${chargeId}/review`,
      { method: "POST" }
    );
  },

  async updateAdminOrderCharge(
    session: DevSession,
    orderId: string,
    chargeId: string,
    payload: Partial<OrderChargeCreatePayload>
  ) {
    return request<{ charge: OrderChargeRecord }>(
      session,
      `/api/admin/orders/${orderId}/charges/${chargeId}`,
      { method: "PATCH", body: JSON.stringify(payload) }
    );
  },

  async deleteAdminOrderCharge(session: DevSession, orderId: string, chargeId: string) {
    return request<{ charge: OrderChargeRecord }>(
      session,
      `/api/admin/orders/${orderId}/charges/${chargeId}`,
      { method: "DELETE" }
    );
  },

  async confirmAdminOrderCharge(session: DevSession, orderId: string, chargeId: string) {
    return request<{ charge: OrderChargeRecord }>(
      session,
      `/api/admin/orders/${orderId}/charges/${chargeId}/confirm`,
      { method: "POST" }
    );
  },

  async rejectAdminOrderCharge(
    session: DevSession,
    orderId: string,
    chargeId: string,
    reason: string
  ) {
    return request<{ charge: OrderChargeRecord }>(
      session,
      `/api/admin/orders/${orderId}/charges/${chargeId}/reject`,
      { method: "POST", body: JSON.stringify({ reason }) }
    );
  },

  async cancelAdminOrderChargeConfirmation(
    session: DevSession,
    orderId: string,
    chargeId: string,
    reason: string
  ) {
    return request<{ charge: OrderChargeRecord }>(
      session,
      `/api/admin/orders/${orderId}/charges/${chargeId}/cancel-confirmation`,
      { method: "POST", body: JSON.stringify({ reason }) }
    );
  },

  async voidAdminOrderCharge(
    session: DevSession,
    orderId: string,
    chargeId: string,
    reason: string
  ) {
    return request<{ charge: OrderChargeRecord }>(
      session,
      `/api/admin/orders/${orderId}/charges/${chargeId}/void`,
      { method: "POST", body: JSON.stringify({ reason }) }
    );
  },

  async getAdminPerformance(
    session: DevSession,
    filters: {
      dateFrom?: string;
      dateTo?: string;
      stage?: string;
      accountId?: string;
      workerProfileId?: string;
      q?: string;
      includeOrderDetails?: boolean;
    } = {}
  ) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== "") params.set(key, String(value));
    });
    const query = params.toString();
    return request<PerformanceReport>(session, `/api/admin/performance${query ? `?${query}` : ""}`);
  },

  async listPatternTasks(session: DevSession) {
    return request<{ tasks: PatternTask[] }>(session, "/api/pattern-maker/tasks");
  },

  async listPatternArchive(session: DevSession) {
    return request<{ tasks: PatternTask[] }>(session, "/api/pattern-maker/archive");
  },

  async generatePatternOrderFolder(session: DevSession, orderId: string) {
    return request<{ folder: OrderFolder }>(
      session,
      `/api/pattern-maker/orders/${orderId}/folder/generate`,
      { method: "POST" }
    );
  },

  async listPatternOrderAttachments(session: DevSession, orderId: string) {
    return request<{ attachments: OrderAttachment[]; logs: AttachmentAuditLog[] }>(
      session,
      `/api/pattern-maker/orders/${orderId}/attachments`
    );
  },

  async appendPatternDeliverableVersion(
    session: DevSession,
    taskId: string,
    payload: {
      attachments: AttachmentMetadataInput[];
      note?: string;
      textValue?: string;
      deliverableType: PatternDeliverableType;
      taskCategory?: string;
    }
  ) {
    return request<{ task: PatternTask }>(
      session,
      `/api/pattern-maker/tasks/${taskId}/deliverable-versions`,
      {
        method: "POST",
        body: bodyForOrderPayload(payload)
      }
    );
  },

  async deleteOwnPatternDeliverable(session: DevSession, orderId: string, deliverableId: string) {
    return request<{ task: PatternTask }>(
      session,
      `/api/pattern-maker/orders/${orderId}/pattern-deliverables/${deliverableId}`,
      { method: "DELETE" }
    );
  },

  async getPatternWorkbench(session: DevSession) {
    return request<PatternWorkbench>(session, "/api/pattern-maker/workbench");
  },

  async startPatternTask(session: DevSession, taskId: string) {
    return request<{ task: PatternTask }>(session, `/api/pattern-maker/tasks/${taskId}/start`, {
      method: "POST"
    });
  },

  async updatePatternOrderAttachment(
    session: DevSession,
    orderId: string,
    attachmentId: string,
    payload: {
      fileName?: string;
      category?: string;
      visibility?: OrderAttachment["visibility"];
      note?: string;
    }
  ) {
    return request<{ attachments: OrderAttachment[] }>(
      session,
      `/api/pattern-maker/orders/${orderId}/attachments/${attachmentId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload)
      }
    );
  },

  async deletePatternOrderAttachment(
    session: DevSession,
    orderId: string,
    attachmentId: string,
    note?: string
  ) {
    return request<{ attachments: OrderAttachment[] }>(
      session,
      `/api/pattern-maker/orders/${orderId}/attachments/${attachmentId}`,
      {
        method: "DELETE",
        body: JSON.stringify(note ? { note } : {})
      }
    );
  },

  async downloadPatternOrderAttachment(session: DevSession, orderId: string, attachmentId: string) {
    return downloadAttachment(
      session,
      `/api/pattern-maker/orders/${orderId}/attachments/${attachmentId}/download`
    );
  },

  async downloadPatternDeliverable(session: DevSession, orderId: string, deliverableId: string) {
    return downloadAttachment(
      session,
      `/api/pattern-maker/orders/${orderId}/pattern-deliverables/${deliverableId}/download`
    );
  },

  async downloadAdminPatternDeliverable(session: DevSession, orderId: string, deliverableId: string) {
    return downloadAttachment(
      session,
      `/api/admin/orders/${orderId}/pattern-deliverables/${deliverableId}/download`
    );
  },

  async renameOwnPatternDeliverable(
    session: DevSession,
    orderId: string,
    deliverableId: string,
    displayName: string
  ) {
    return request<{ task: PatternTask }>(
      session,
      `/api/pattern-maker/orders/${orderId}/pattern-deliverables/${deliverableId}/display-name`,
      { method: "PATCH", body: JSON.stringify({ displayName }) }
    );
  },

  async renameAdminPatternDeliverable(
    session: DevSession,
    orderId: string,
    deliverableId: string,
    displayName: string
  ) {
    return request<{ task: PatternTask }>(
      session,
      `/api/admin/orders/${orderId}/pattern-deliverables/${deliverableId}/display-name`,
      { method: "PATCH", body: JSON.stringify({ displayName }) }
    );
  },

  async changeAdminPatternDeliverableVisibility(
    session: DevSession,
    orderId: string,
    deliverableId: string,
    visibility: OrderAttachment["visibility"]
  ) {
    return request<{ task: PatternTask }>(
      session,
      `/api/admin/orders/${orderId}/pattern-deliverables/${deliverableId}/visibility`,
      { method: "PATCH", body: JSON.stringify({ visibility }) }
    );
  },

  async changeOwnPatternDeliverableVisibility(
    session: DevSession,
    orderId: string,
    deliverableId: string,
    visibility: OrderAttachment["visibility"]
  ) {
    return request<{ task: PatternTask }>(
      session,
      `/api/pattern-maker/orders/${orderId}/pattern-deliverables/${deliverableId}/visibility`,
      { method: "PATCH", body: JSON.stringify({ visibility }) }
    );
  },

  async deleteAdminPatternDeliverable(
    session: DevSession,
    orderId: string,
    deliverableId: string
  ) {
    return request<{ task: PatternTask }>(
      session,
      `/api/admin/orders/${orderId}/pattern-deliverables/${deliverableId}`,
      { method: "DELETE" }
    );
  },

  async downloadReceiverPatternDeliverable(session: DevSession, orderId: string, deliverableId: string) {
    return downloadAttachment(
      session,
      `/api/receiver/orders/${orderId}/pattern-deliverables/${deliverableId}/download`
    );
  },

  async linkPatternLibraryEntry(session: DevSession, taskId: string, libraryEntryId: string) {
    return request<{ task: PatternTask }>(session, `/api/pattern-maker/tasks/${taskId}/link-pattern`, {
      method: "POST",
      body: JSON.stringify({ libraryEntryId })
    });
  },

  async completePatternTask(
    session: DevSession,
    taskId: string,
    payload: SubmitPatternDeliverablePayload
  ) {
    return request<{ task: PatternTask }>(session, `/api/pattern-maker/tasks/${taskId}/complete`, {
      method: "POST",
      body: bodyForOrderPayload(payload)
    });
  },

  async recordPatternTaskOperation(
    session: DevSession,
    taskId: string,
    payload: { operation: "grade" | "material_check" | "adjust_pattern"; note?: string }
  ) {
    return request<{ task: PatternTask }>(session, `/api/pattern-maker/tasks/${taskId}/operation`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async submitPatternCuttingVersion(
    session: DevSession,
    taskId: string,
    payload: SubmitPatternDeliverablePayload & {
      files?: Array<{ fileName: string; sizeBytes?: number }>;
    }
  ) {
    return request<{ submission: SubmittedCuttingVersion }>(
      session,
      `/api/pattern-maker/tasks/${taskId}/submit-cutting-version`,
      {
        method: "POST",
        body: bodyForOrderPayload(payload)
      }
    );
  },

  async resumePatternTask(session: DevSession, taskId: string) {
    return request<{ task: PatternTask }>(session, `/api/pattern-maker/tasks/${taskId}/resume`, {
      method: "POST"
    });
  },

  async supplementPatternVersion(
    session: DevSession,
    taskId: string,
    payload: SubmitPatternDeliverablePayload & {
      files?: Array<{ fileName: string; sizeBytes?: number }>;
    }
  ) {
    return request<{ submission: SubmittedCuttingVersion }>(
      session,
      `/api/pattern-maker/tasks/${taskId}/supplement-version`,
      {
        method: "POST",
        body: bodyForOrderPayload(payload)
      }
    );
  },

  async listPatternLibraryEntries(session: DevSession) {
    return request<{ entries: PatternLibraryEntry[] }>(session, "/api/pattern-library");
  },

  async createPatternLibraryEntry(
    session: DevSession,
    payload: {
      customerId?: string;
      customerName?: string;
      styleNo: string;
      styleName?: string;
      patternVersion: string;
      fileName: string;
      note?: string;
    }
  ) {
    return request<{ entry: PatternLibraryEntry }>(session, "/api/pattern-library", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async listCuttingRoomSubmissions(session: DevSession) {
    return request<{ submissions: SubmittedCuttingVersion[] }>(
      session,
      "/api/cutting-room/submissions"
    );
  },

  async markCuttingSubmissionPrinted(session: DevSession, submissionId: string) {
    return request<{ submission: SubmittedCuttingVersion }>(
      session,
      `/api/cutting-room/submissions/${submissionId}/mark-printed`,
      { method: "POST" }
    );
  },

  async markCuttingSubmissionCut(session: DevSession, submissionId: string) {
    return request<{ submission: SubmittedCuttingVersion }>(
      session,
      `/api/cutting-room/submissions/${submissionId}/mark-cut`,
      { method: "POST" }
    );
  },

  async terminateAdminOrder(session: DevSession, orderId: string, payload: { reason?: string }) {
    return request<{ order: OrderRecord }>(session, `/api/admin/orders/${orderId}/terminate`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async restoreAdminOrder(session: DevSession, orderId: string) {
    return request<{ order: OrderRecord }>(session, `/api/admin/orders/${orderId}/restore`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },

  async listPlannerOrders(session: DevSession) {
    return request<{ orders: PlannerOrder[] }>(session, "/api/planner/orders");
  },

  async reviewBusinessUserRequest(
    session: DevSession,
    id: string,
    payload: ReviewBusinessUserRequestPayload
  ) {
    return request<{
      request: BusinessUserRequestRecord;
      loginCredential?: BusinessUserLoginCredential;
    }>(
      session,
      `/api/system-owner/business-user-requests/${id}/review`,
      {
        method: "PATCH",
        body: JSON.stringify(payload)
      }
    );
  },

  async supplementClientOrder(session: DevSession, id: string, payload: SupplementOrderPayload) {
    return request<{ order: ClientOrder }>(session, `/api/client/orders/${id}/supplement`, {
      method: "PATCH",
      body: bodyForOrderPayload(payload)
    });
  },

  async listClientOrderAttachments(session: DevSession, id: string) {
    return request<{ attachments: ClientOrderAttachment[] }>(
      session,
      `/api/client/orders/${id}/attachments`
    );
  },

  async downloadPlannerOrderAttachment(session: DevSession, orderId: string, attachmentId: string) {
    return downloadAttachment(session, `/api/planner/orders/${orderId}/attachments/${attachmentId}/download`);
  },

  async addPlannerOrderAttachments(session: DevSession, orderId: string, attachments: AttachmentMetadataInput[]) {
    return request<{ attachments: OrderAttachment[] }>(session, `/api/planner/orders/${orderId}/attachments`, {
      method: "POST",
      body: bodyForAttachmentList(attachments)
    });
  },

  async deletePlannerOrderAttachment(session: DevSession, orderId: string, attachmentId: string) {
    return request<{ attachments: OrderAttachment[] }>(
      session,
      `/api/planner/orders/${orderId}/attachments/${attachmentId}`,
      { method: "DELETE" }
    );
  },

  async renamePlannerOrderAttachment(
    session: DevSession,
    orderId: string,
    attachmentId: string,
    displayName: string
  ) {
    return request<{ attachments: OrderAttachment[] }>(
      session,
      `/api/planner/orders/${orderId}/attachments/${attachmentId}/display-name`,
      { method: "PATCH", body: JSON.stringify({ displayName }) }
    );
  },

  async changePlannerOrderAttachmentVisibility(
    session: DevSession,
    orderId: string,
    attachmentId: string,
    visibility: OrderAttachment["visibility"]
  ) {
    return request<{ attachments: OrderAttachment[] }>(
      session,
      `/api/planner/orders/${orderId}/attachments/${attachmentId}/visibility`,
      { method: "PATCH", body: JSON.stringify({ visibility }) }
    );
  },

  async downloadPlannerPatternDeliverable(session: DevSession, orderId: string, deliverableId: string) {
    return downloadAttachment(session, `/api/planner/orders/${orderId}/pattern-deliverables/${deliverableId}/download`);
  },

  async getClientOrderQuotation(session: DevSession, id: string) {
    return request<{ quotation: ClientQuotation | null }>(session, `/api/client/orders/${id}/quotation`);
  },

  async downloadClientPatternDeliverable(session: DevSession, orderId: string, deliverableId: string) {
    return downloadAttachment(session, `/api/client/orders/${orderId}/pattern-deliverables/${deliverableId}/download`);
  },

  async addClientOrderAttachments(
    session: DevSession,
    id: string,
    attachments: AttachmentMetadataInput[]
  ) {
    return request<{ attachments: ClientOrderAttachment[] }>(
      session,
      `/api/client/orders/${id}/attachments`,
      {
        method: "POST",
        body: bodyForAttachmentList(attachments)
      }
    );
  },

  async downloadClientOrderAttachment(session: DevSession, orderId: string, attachmentId: string) {
    return downloadAttachment(session, `/api/client/orders/${orderId}/attachments/${attachmentId}/download`);
  },

  async listReceiverOrderAttachments(session: DevSession, id: string) {
    return request<{ attachments: OrderAttachment[] }>(
      session,
      `/api/receiver/orders/${id}/attachments`
    );
  },

  async addReceiverOrderAttachments(
    session: DevSession,
    id: string,
    attachments: AttachmentMetadataInput[]
  ) {
    return request<{ attachments: OrderAttachment[] }>(
      session,
      `/api/receiver/orders/${id}/attachments`,
      {
        method: "POST",
        body: bodyForAttachmentList(attachments)
      }
    );
  },

  async downloadReceiverOrderAttachment(session: DevSession, orderId: string, attachmentId: string) {
    return downloadAttachment(session, `/api/receiver/orders/${orderId}/attachments/${attachmentId}/download`);
  },

  async deleteReceiverOrderAttachment(session: DevSession, orderId: string, attachmentId: string) {
    return request<{ attachments: OrderAttachment[] }>(
      session,
      `/api/receiver/orders/${orderId}/attachments/${attachmentId}`,
      { method: "DELETE" }
    );
  },

  async renameReceiverOrderAttachment(
    session: DevSession,
    orderId: string,
    attachmentId: string,
    displayName: string
  ) {
    return request<{ attachments: OrderAttachment[] }>(
      session,
      `/api/receiver/orders/${orderId}/attachments/${attachmentId}/display-name`,
      { method: "PATCH", body: JSON.stringify({ displayName }) }
    );
  },

  async changeReceiverOrderAttachmentVisibility(
    session: DevSession,
    orderId: string,
    attachmentId: string,
    visibility: OrderAttachment["visibility"]
  ) {
    return request<{ attachments: OrderAttachment[] }>(
      session,
      `/api/receiver/orders/${orderId}/attachments/${attachmentId}/visibility`,
      { method: "PATCH", body: JSON.stringify({ visibility }) }
    );
  },

  async ensureReceiverOrderScanLink(session: DevSession, orderId: string) {
    return request<{
      scanLink: {
        order: ScanPageState["order"];
        token: string;
        urlPath: string;
        qrFormat: "legacy_url" | "plain_text";
        qrPayload: string;
        recommendedUrl?: string;
        absoluteUrl?: string;
      };
    }>(session, `/api/receiver/orders/${orderId}/scan-link`);
  },

  async getReceiverPrintSettings(session: DevSession) {
    return request<{ settings: ReceiverQrPrintSettings }>(session, "/api/receiver/print-settings");
  },

  async updateReceiverPrintSettings(session: DevSession, settings: ReceiverQrPrintSettings) {
    return request<{ settings: ReceiverQrPrintSettings }>(session, "/api/receiver/print-settings", {
      method: "PUT",
      body: JSON.stringify(settings)
    });
  },

  async listReceiverOrderScanRecords(session: DevSession, orderId: string) {
    return request<{ records: ScanRecord[] }>(session, `/api/receiver/orders/${orderId}/scan-records`);
  },

  async getScanState(token: string) {
    return authRequest<{ state: ScanPageState }>(`/api/scan/${token}`);
  },

  async getAdminQcResult(session: DevSession, orderId: string) {
    return request<{ result: AdminQcResult | null }>(session, `/api/admin/orders/${orderId}/qc-result`);
  },

  async downloadAdminQcResultPhoto(session: DevSession, orderId: string, attachmentId: string) {
    return downloadAttachment(session, `/api/admin/orders/${orderId}/qc-result/photos/${attachmentId}/download`);
  },

  async downloadAdminQcReworkPhoto(
    session: DevSession,
    orderId: string,
    scanRecordId: string,
    attachmentId: string
  ) {
    return downloadAttachment(
      session,
      `/api/admin/orders/${orderId}/qc-rework-records/${scanRecordId}/photos/${attachmentId}/download`
    );
  },

  async listQcReworkOrders(session: DevSession, filters: QcTabletFilters = {}) {
    const query = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
    return request<QcTabletOrderList>(session, `/api/qc/me/rework-orders${query ? `?${query}` : ""}`);
  },

  async listQcCompletedOrders(session: DevSession, filters: QcTabletFilters = {}) {
    const query = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
    return request<QcTabletOrderList>(session, `/api/qc/me/completed-orders${query ? `?${query}` : ""}`);
  },

  async getQcOrder(session: DevSession, orderId: string) {
    return request<{ order: QcTabletOrderDetail }>(session, `/api/qc/me/orders/${encodeURIComponent(orderId)}`);
  },

  async reinspectQcOrder(
    session: DevSession,
    orderId: string,
    payload: {
      pieces: number;
      note?: string;
      qualityResult: "qualified" | "rework";
      qualityScore?: number;
      attachments: AttachmentMetadataInput[];
    }
  ) {
    return request<{ state: ScanPageState }>(session, `/api/qc/me/orders/${encodeURIComponent(orderId)}/reinspect`, {
      method: "POST",
      body: bodyForOrderPayload(payload)
    });
  },

  async addQcOrderPhotos(session: DevSession, orderId: string, attachments: AttachmentMetadataInput[]) {
    return request<{ attachments: OrderAttachment[] }>(session, `/api/qc/me/orders/${encodeURIComponent(orderId)}/photos`, {
      method: "POST",
      body: bodyForAttachmentList(attachments)
    });
  },

  async updateQcOrderPhoto(
    session: DevSession,
    orderId: string,
    attachmentId: string,
    payload: { displayName?: string; visibility?: "internal_only" | "client_visible"; category?: "qc_issue_photo" | "qc_sample_photo" | "qc_measurement_photo" }
  ) {
    return request<{ attachments: OrderAttachment[] }>(session, `/api/qc/me/orders/${encodeURIComponent(orderId)}/photos/${encodeURIComponent(attachmentId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },

  async deleteQcOrderPhoto(session: DevSession, orderId: string, attachmentId: string) {
    return request<{ attachments: OrderAttachment[] }>(session, `/api/qc/me/orders/${encodeURIComponent(orderId)}/photos/${encodeURIComponent(attachmentId)}`, { method: "DELETE" });
  },

  async downloadQcOrderPhoto(session: DevSession, orderId: string, attachmentId: string) {
    return downloadAttachment(session, `/api/qc/me/orders/${encodeURIComponent(orderId)}/photos/${encodeURIComponent(attachmentId)}/download`);
  },

  async getQcOwnPerformance(session: DevSession, filters: Pick<QcTabletFilters, "dateFrom" | "dateTo"> = {}) {
    const query = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
    return request<QcOwnPerformance>(session, `/api/qc/me/performance${query ? `?${query}` : ""}`);
  },

  async createClientUserLoginAccount(
    session: DevSession,
    clientUserId: string,
    payload: {
      username: string;
      password?: string;
      role: Extract<Role, "client_admin" | "client_business_user">;
    }
  ) {
    return request<{
      clientUser: ClientUserAccountSummary;
      loginCredential: BusinessUserLoginCredential;
    }>(session, `/api/system-owner/client-users/${clientUserId}/account`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async updateClientUserLoginRole(
    session: DevSession,
    clientUserId: string,
    role: Extract<Role, "client_admin" | "client_business_user">
  ) {
    return request<{ clientUser: ClientUserAccountSummary }>(
      session,
      `/api/system-owner/client-users/${clientUserId}/account/role`,
      { method: "PATCH", body: JSON.stringify({ role }) }
    );
  },

  async updateClientUserLoginStatus(
    session: DevSession,
    clientUserId: string,
    status: "active" | "archived"
  ) {
    return request<{ clientUser: ClientUserAccountSummary }>(
      session,
      `/api/system-owner/client-users/${clientUserId}/account/status`,
      { method: "PATCH", body: JSON.stringify({ status }) }
    );
  },

  async getAndroidAppReleases(session: DevSession) {
    return request<{
      releases: {
        phone: AndroidAppRelease | null;
        pad: AndroidAppRelease | null;
      };
    }>(session, "/api/system-owner/app-releases");
  },

  async publishAndroidAppRelease(
    session: DevSession,
    clientType: AndroidClientType,
    apk: File,
    releaseNotes?: string
  ) {
    const formData = new FormData();
    formData.append("clientType", clientType);
    formData.append("apk", apk, apk.name);
    if (releaseNotes?.trim()) formData.append("releaseNotes", releaseNotes.trim());
    return request<{ release: AndroidAppRelease }>(
      session,
      "/api/system-owner/app-releases",
      { method: "POST", body: formData }
    );
  },

  async getRecoveryPointOverview(session: DevSession) {
    return request<{ recentRecoveryPoint?: RecoveryPointSummary; currentTask?: LifecycleMaintenanceJob; latestTask?: LifecycleMaintenanceJob; recoveryPoints: RecoveryPointSummary[]; runner: { online: boolean }; backupReadiness?: BackupReadiness }>(session, "/api/system-owner/lifecycle/overview");
  },

  async getLifecycleOperationHistory(session: DevSession) {
    return request<{ records: LifecycleOperationHistoryItem[] }>(session, "/api/system-owner/lifecycle/history");
  },

  async createRecoveryPoint(session: DevSession, payload: { requestReason: string; idempotencyKey: string }) {
    return request<{ recoveryPoint: RecoveryPointSummary; job: LifecycleMaintenanceJob }>(session, "/api/system-owner/recovery-points", { method: "POST", body: JSON.stringify({ ...payload, confirmed: true }) });
  },

  async getLifecycleJobEvents(session: DevSession, id: string) {
    return request<{ events: LifecycleMaintenanceEvent[] }>(session, `/api/system-owner/lifecycle-jobs/${id}/events`);
  },

  async preflightSystemRestore(session: DevSession, recoveryPointId: string) {
    return request<{ plan: RestorePreflight }>(session, "/api/system-owner/restores/preflight", { method: "POST", body: JSON.stringify({ recoveryPointId }) });
  },

  async executeSystemRestore(session: DevSession, payload: { recoveryPointId: string; password: string; requestReason: string; confirmationText: string; idempotencyKey: string }) {
    return request<{ job: LifecycleMaintenanceJob }>(session, "/api/system-owner/restores/execute", { method: "POST", body: JSON.stringify(payload) });
  },

  async getStorageManagementOverview(session: DevSession) {
    return request<StorageManagementOverview>(session, "/api/system-owner/storage/overview");
  },

  async preflightStorageChange(session: DevSession, targetPath: string) {
    return request<{ plan: StorageChangeSummary; canContinue: boolean; message: string }>(session, "/api/system-owner/storage/preflight", { method: "POST", body: JSON.stringify({ targetPath }) });
  },

  async executeStorageChange(session: DevSession, payload: { planId: string; password: string; requestReason: string; confirmationText: string; idempotencyKey: string }) {
    return request<{ job: LifecycleMaintenanceJob }>(session, "/api/system-owner/storage/execute", { method: "POST", body: JSON.stringify(payload) });
  },

  async getSystemUpdateOverview(session: DevSession) {
    return request<SystemUpdateOverview>(session, "/api/system-owner/updates/overview");
  },

  async uploadSystemUpdatePackage(session: DevSession, file: File) {
    const formData = new FormData();
    formData.append("package", file, file.name);
    return request<{ updatePackage: SystemUpdatePackage; job?: LifecycleMaintenanceJob; duplicate: boolean }>(session, "/api/system-owner/updates/packages", { method: "POST", body: formData });
  },

  async executeSystemUpdate(session: DevSession, payload: { updatePackageId: string; password: string; requestReason: string; confirmationText: string; idempotencyKey: string }) {
    return request<{ job: LifecycleMaintenanceJob }>(session, "/api/system-owner/updates/execute", { method: "POST", body: JSON.stringify(payload) });
  },

  async startScan(token: string) {
    return authRequest<{ state: ScanPageState }>(`/api/scan/${token}/start`, {
      method: "POST"
    });
  },

  async completeScan(
    token: string,
    payload: {
      workHours?: number;
      pieces?: number;
      note?: string;
      qualityResult?: "qualified" | "rework" | "rejected";
      qualityScore?: number;
      attachments?: AttachmentMetadataInput[];
      expectedParticipationId?: string;
      expectedCollaborationRevision?: string;
    }
  ) {
    return authRequest<{ state: ScanPageState }>(`/api/scan/${token}/complete`, {
      method: "POST",
      body: bodyForOrderPayload(payload)
    });
  },

  async resolveScanForTest(payload: string, identity: ScanTestIdentity) {
    return authRequest<ScanResolveResponse>("/api/scan/resolve", {
      method: "POST",
      headers: { "x-test-scan-identity": identity },
      body: JSON.stringify({ payload })
    });
  },

  async startScanForTest(token: string, identity: ScanTestIdentity) {
    return authRequest<{ state: ScanPageState }>(`/api/scan/${encodeURIComponent(token)}/start`, {
      method: "POST",
      headers: { "x-test-scan-identity": identity }
    });
  },

  async completeScanForTest(
    token: string,
    identity: ScanTestIdentity,
    payload: {
      workHours?: number;
      pieces?: number;
      note?: string;
      qualityResult?: "qualified" | "rework" | "rejected";
      qualityScore?: number;
      attachments?: AttachmentMetadataInput[];
    }
  ) {
    return authRequest<{ state: ScanPageState }>(
      `/api/scan/${encodeURIComponent(token)}/complete`,
      {
        method: "POST",
        headers: { "x-test-scan-identity": identity },
        body: bodyForOrderPayload(payload)
      }
    );
  },

  async selectReceiverSampleSheetAttachment(
    session: DevSession,
    orderId: string,
    attachmentId: string
  ) {
    return request<{ attachments: OrderAttachment[] }>(
      session,
      `/api/receiver/orders/${orderId}/sample-sheet-attachment`,
      {
        method: "PATCH",
        body: JSON.stringify({ attachmentId })
      }
    );
  },

  async deleteClientOrderAttachment(session: DevSession, orderId: string, attachmentId: string) {
    return request<{ attachments: ClientOrderAttachment[] }>(
      session,
      `/api/client/orders/${orderId}/attachments/${attachmentId}`,
      { method: "DELETE" }
    );
  },

  async takeoverSewingScan(
    token: string,
    reason: string,
    expectedActiveWorkerId: string
  ) {
    return authRequest<{ state: ScanPageState }>(`/api/scan/${token}/sewing-takeover`, {
      method: "POST",
      body: JSON.stringify({ reason, expectedActiveWorkerId })
    });
  },

  async joinCollaborativeSewingScan(
    token: string,
    expectedCollaborationRevision: string
  ) {
    return authRequest<{ state: ScanPageState }>(`/api/scan/${token}/sewing-collaboration`, {
      method: "POST",
      body: JSON.stringify({ expectedCollaborationRevision })
    });
  },

  async listPendingReceive(session: DevSession) {
    return request<{ orders: OrderRecord[] }>(session, "/api/receiver/pending-receive");
  },

  async acceptOrder(session: DevSession, id: string, payload: AcceptOrderPayload) {
    return request<{ order: OrderRecord }>(session, `/api/receiver/orders/${id}/accept`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async returnOrder(session: DevSession, id: string, payload: ReturnOrderPayload) {
    return request<{ order: OrderRecord }>(session, `/api/receiver/orders/${id}/return`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async listTracking(session: DevSession) {
    return request<{ orders: OrderRecord[] }>(session, "/api/receiver/tracking");
  },

  async updateTracking(session: DevSession, id: string, payload: TrackingPatchPayload) {
    return request<{ order: OrderRecord }>(session, `/api/receiver/orders/${id}/tracking`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },

  async correctReceiverOrder(session: DevSession, id: string, payload: ReceiverCorrectionPayload) {
    return request<{ order: OrderRecord }>(session, `/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },

  async createSelfEntry(session: DevSession, payload: SelfEntryPayload) {
    return request<{ order: OrderRecord }>(session, "/api/receiver/orders/self-entry", {
      method: "POST",
      body: bodyForOrderPayload(payload)
    });
  },

  async createReceiverQuickPhotoOrder(session: DevSession, payload: ReceiverQuickPhotoPayload) {
    return request<{ order: OrderRecord }>(session, "/api/receiver/orders/quick-photo", {
      method: "POST",
      body: bodyForReceiverQuickPhoto(payload)
    });
  },

  async listReceiverSelfEntryOptions(session: DevSession) {
    return request<{ customers: ReceiverSelfEntryCustomer[] }>(
      session,
      "/api/receiver/self-entry-options"
    );
  },

  async listReceiverOrders(session: DevSession) {
    return request<{ orders: OrderRecord[] }>(session, "/api/receiver/orders");
  }
};
