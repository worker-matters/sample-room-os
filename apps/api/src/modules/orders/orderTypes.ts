import type {
  AttachmentVisibility,
  ClientAccessScope,
  IntakeStatus,
  MaterialStatus,
  OrderCompletionStatus,
  OrderStage,
  PatternSourceType,
  PatternStatus,
  Role,
  SampleRequestItem
} from "@sample-room/shared";
import type { OrderFolderRecord } from "../patterns/patternTypes.js";

export type RecordStatus = "active" | "archived";
export type SourceType = "client_submission" | "receiver_self_entry" | "internal_manual";

export type CustomerRecord = {
  id: string;
  name: string;
  status: RecordStatus;
  archivedAt?: string | undefined;
  archivedBy?: string | undefined;
};

export type CustomerCreateInput = {
  name: string;
  status?: RecordStatus | undefined;
};

export type ClientUserRecord = {
  id: string;
  customerId: string;
  accountId?: string | undefined;
  displayName: string;
  contact?: string | undefined;
  status: RecordStatus;
  clientAccessScope: ClientAccessScope;
  archivedAt?: string | undefined;
  archivedBy?: string | undefined;
};

export type ClientUserCreateInput = {
  customerId: string;
  accountId?: string | undefined;
  displayName: string;
  contact?: string | undefined;
  status?: RecordStatus | undefined;
  clientAccessScope?: ClientAccessScope | undefined;
};

export type ClientUserUpdateInput = Partial<
  Pick<
    ClientUserRecord,
    | "displayName"
    | "contact"
    | "status"
    | "clientAccessScope"
    | "accountId"
    | "archivedAt"
    | "archivedBy"
  >
>;

export type OrderAttachmentRecord = {
  id: string;
  orderId: string;
  fileName: string;
  mimeType: string;
  size: number;
  category: string;
  uploadedBy: string;
  uploadedByRole: Role;
  uploadedByName?: string | undefined;
  createdAt: string;
  visibility: AttachmentVisibility;
  storageKey?: string | undefined;
  checksum?: string | undefined;
  hasFile?: boolean | undefined;
  sourceCategory?: string | undefined;
  patternTaskId?: string | undefined;
  patternTaskCategory?: string | undefined;
  orderChargeId?: string | undefined;
  canRename?: boolean | undefined;
  canDelete?: boolean | undefined;
};

export type OrderAttachmentCreateInput = {
  orderId: string;
  fileName: string;
  mimeType: string;
  size: number;
  category: string;
  uploadedBy: string;
  uploadedByRole: Role;
  uploadedByName?: string | undefined;
  visibility: AttachmentVisibility;
  storageKey?: string | undefined;
  checksum?: string | undefined;
  patternTaskId?: string | undefined;
  patternTaskCategory?: string | undefined;
  orderChargeId?: string | undefined;
  sourceCategory?: string | undefined;
};

export type AttachmentAuditAction = "upload" | "rename" | "visibility_change" | "delete";

export type AttachmentAuditLogRecord = {
  id: string;
  orderId: string;
  attachmentId: string;
  originalFileName: string;
  newFileName?: string | undefined;
  action: AttachmentAuditAction;
  actorId: string;
  actorName?: string | undefined;
  actorRole: Role;
  originalUploaderId: string;
  originalUploaderName?: string | undefined;
  originalUploaderRole: Role;
  attachmentCategory: string;
  sourceCategory?: string | undefined;
  patternTaskId?: string | undefined;
  patternTaskCategory?: string | undefined;
  orderChargeId?: string | undefined;
  createdAt: string;
};

export type AttachmentAuditLogCreateInput = Omit<AttachmentAuditLogRecord, "id" | "createdAt">;

export type OrderAttachmentUpdateInput = Partial<
  Pick<OrderAttachmentRecord, "fileName" | "category" | "visibility" | "storageKey">
>;

export type OrderCorrectionLogEntry = {
  id: string;
  changedAt: string;
  changedByRole: Role;
  changedByAccountId: string;
  changedByName?: string | undefined;
  fieldName: string;
  oldValue: string | number | null;
  newValue: string | number | null;
  reason?: string | undefined;
};

export type OrderRecord = {
  id: string;
  orderNo: string;
  folderCode: string;
  sourceType: SourceType;
  sourceOrderId?: string | undefined;
  sourcePatternVersionId?: string | undefined;
  customerId: string;
  clientUserId: string;
  customerName: string;
  salespersonId: string;
  salespersonName: string;
  customerSnapshot: Pick<CustomerRecord, "id" | "name">;
  clientUserSnapshot: Pick<ClientUserRecord, "id" | "displayName">;
  styleNo: string;
  styleName: string;
  quantity: number;
  sampleType: string;
  sampleRound: string;
  deliveryDate: string;
  remark?: string | undefined;
  taskInstructionNote?: string | undefined;
  intakeStatus: IntakeStatus;
  stage: OrderStage | null;
  patternStatus: PatternStatus;
  patternSourceType: PatternSourceType;
  sampleRequestItems: SampleRequestItem[];
  sampleGarmentRequired: boolean;
  fabricStatus: MaterialStatus;
  trimStatus: MaterialStatus;
  latestPatternVersion?: string | undefined;
  cuttingUsedPatternVersion?: string | undefined;
  receivedAt?: string | undefined;
  receivedBy?: string | undefined;
  returnReason?: string | undefined;
  returnedAt?: string | undefined;
  returnedBy?: string | undefined;
  supplementCount: number;
  supplementedAt?: string | undefined;
  terminated: boolean;
  terminatedAt?: string | undefined;
  terminatedBy?: string | undefined;
  terminatedByName?: string | undefined;
  terminationReason?: string | undefined;
  statusBeforeTermination?: string | undefined;
  stageAtTermination?: OrderStage | null | undefined;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  correctionLogs: OrderCorrectionLogEntry[];
};

export type OrderCreateInput = {
  customerId: string;
  clientUserId: string;
  sourceType: SourceType;
  sourceOrderId?: string | undefined;
  sourcePatternVersionId?: string | undefined;
  createdBy: string;
  styleNo: string;
  styleName: string;
  quantity: number;
  sampleType: string;
  sampleRound: string;
  deliveryDate: string;
  remark?: string | undefined;
  taskInstructionNote?: string | undefined;
  intakeStatus: IntakeStatus;
  stage: OrderStage | null;
  patternStatus: PatternStatus;
  patternSourceType?: PatternSourceType | undefined;
  sampleRequestItems?: SampleRequestItem[] | undefined;
  sampleGarmentRequired?: boolean | undefined;
  fabricStatus: MaterialStatus;
  trimStatus: MaterialStatus;
  latestPatternVersion?: string | undefined;
  cuttingUsedPatternVersion?: string | undefined;
  receivedAt?: string | undefined;
  receivedBy?: string | undefined;
  returnReason?: string | undefined;
  returnedAt?: string | undefined;
  returnedBy?: string | undefined;
  supplementCount?: number | undefined;
  supplementedAt?: string | undefined;
  correctionLogs?: OrderCorrectionLogEntry[] | undefined;
};

export type OrderTrackingPatch = {
  fabricStatus?: MaterialStatus | undefined;
  trimStatus?: MaterialStatus | undefined;
  patternStatus?: PatternStatus | undefined;
  patternSourceType?: PatternSourceType | undefined;
  sampleRequestItems?: SampleRequestItem[] | undefined;
  sampleGarmentRequired?: boolean | undefined;
  remark?: string | undefined;
  stage?: OrderStage | null | undefined;
};

export type OrderComplaintRecord = {
  id: string;
  orderId: string;
  description: string;
  qcScanRecordId?: string | undefined;
  qcWorkerProfileId?: string | undefined;
  qcWorkerNameSnapshot?: string | undefined;
  registeredByAccountId: string;
  registeredByName: string;
  createdAt: string;
};

export type OrderComplaintCreateInput = Pick<
  OrderComplaintRecord,
  | "orderId"
  | "description"
  | "qcScanRecordId"
  | "qcWorkerProfileId"
  | "qcWorkerNameSnapshot"
  | "registeredByAccountId"
  | "registeredByName"
>;

export type ClientOrderDto = Pick<
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
  attachments: ClientOrderAttachmentDto[];
  completionStatus: OrderCompletionStatus;
  patternTask?: ClientPatternTaskSummary | undefined;
};

export type ClientOrderAttachmentDto = Pick<
  OrderAttachmentRecord,
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

export type ClientPatternDeliverableSummary = {
  id: string;
  version: string;
  type: string;
  fileName?: string | undefined;
  mimeType?: string | undefined;
  size?: number | undefined;
  createdAt: string;
  hasFile: boolean;
  taskCategory?: string | undefined;
};

export type ClientPatternTaskSummary = {
  status: OrderPatternTaskSummary["status"];
  requirements: string[];
  completedRequirements: string[];
  completedAt?: string | undefined;
  deliverables: ClientPatternDeliverableSummary[];
};

export type OrderPatternTaskSummary = {
  status: "pending" | "active" | "paused" | "completed" | "submitted" | "in_progress" | "submitted_to_cutting";
  patternMakerName?: string | undefined;
  requirements: string[];
  completedRequirements: string[];
  totalWorkHours?: number | undefined;
  completionNote?: string | undefined;
  completedAt?: string | undefined;
  note?: string | undefined;
  internalName?: string | undefined;
  pausedAt?: string | undefined;
  pausedReason?: string | undefined;
  deliverables?: Array<{
    id: string;
    version: string;
    type: string;
    fileName?: string | undefined;
    textValue?: string | undefined;
    uploadedByName?: string | undefined;
    uploadedBy?: string | undefined;
    taskCategory?: string | undefined;
    visibility: "client_visible" | "internal_only";
    hasFile?: boolean | undefined;
    createdAt: string;
  }> | undefined;
};

export type ReceiverOrderDto = OrderRecord & {
  stageLabel: string;
  createdByName?: string | undefined;
  receivedByName?: string | undefined;
  attachmentCount: number;
  chargeCount: number;
  materialRecordCount: number;
  quantityCorrectionLocked: boolean;
  qcRecordStatus?: "none" | "rework" | "completed";
  attachments: OrderAttachmentRecord[];
  attachmentLogs?: AttachmentAuditLogRecord[] | undefined;
  completionStatus: OrderCompletionStatus;
  sewingWorkforce?: {
    mode: "single" | "collaboration";
    workerNames: string[];
  } | undefined;
  patternTask?: OrderPatternTaskSummary | undefined;
  orderFolder?: SafeOrderFolderDto | undefined;
};

export type SafeOrderFolderDto = Pick<
  OrderFolderRecord,
  "id" | "orderId" | "folderName" | "createdAt" | "updatedAt"
>;
