import type { AttachmentVisibility, OrderStage, PatternTaskRequirement } from "@sample-room/shared";
import type { OrderAttachmentRecord, OrderRecord } from "../orders/orderTypes.js";

export const PATTERN_TASK_STATUSES = {
  pending: "pending",
  active: "active",
  paused: "paused",
  submitted: "submitted",
  // Legacy values are kept readable for old persisted data.
  inProgress: "in_progress",
  completed: "completed",
  submittedToCutting: "submitted_to_cutting"
} as const;

export type PatternTaskStatus =
  (typeof PATTERN_TASK_STATUSES)[keyof typeof PATTERN_TASK_STATUSES];

export const PATTERN_DELIVERABLE_TYPES = {
  patternFile: "pattern_file",
  cuttingPatternFile: "cutting_pattern_file",
  paddingConsumption: "padding_consumption",
  materialConsumption: "material_consumption",
  zipperLength: "zipper_length",
  fullSizePattern: "full_size_pattern",
  layoutDiagram: "layout_diagram",
  printPosition: "print_position",
  embroideryPosition: "embroidery_position",
  processNote: "process_note",
  revisionNote: "revision_note",
  render3d: "render_3d",
  rotationVideo3d: "rotation_video_3d",
  other: "other"
} as const;

export type PatternDeliverableType =
  (typeof PATTERN_DELIVERABLE_TYPES)[keyof typeof PATTERN_DELIVERABLE_TYPES];

export const CUTTING_INBOX_STATUSES = {
  pendingPrint: "pending_print",
  printed: "printed",
  cut: "cut"
} as const;

export type CuttingInboxStatus =
  (typeof CUTTING_INBOX_STATUSES)[keyof typeof CUTTING_INBOX_STATUSES];

export type OrderFolderRecord = {
  id: string;
  orderId: string;
  year: string;
  customerSegment: string;
  folderName: string;
  rootPath: string;
  relativePath: string;
  displayPath: string;
  patternWorkPath: string;
  markerWorkPath: string;
  submittedCuttingPath: string;
  measurementPath: string;
  samplePhotoPath: string;
  outboundPhotoPath: string;
  oldVersionPath: string;
  readmePath: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type OrderFolderCreateInput = Omit<OrderFolderRecord, "id" | "createdAt" | "updatedAt">;

export type PatternTaskRecord = {
  id: string;
  orderId: string;
  status: PatternTaskStatus;
  requirements: PatternTaskRequirement[];
  completedRequirements: PatternTaskRequirement[];
  totalWorkHours?: number | undefined;
  completionNote?: string | undefined;
  patternMakerId?: string | undefined;
  patternMakerName?: string | undefined;
  internalName?: string | undefined;
  linkedPatternLibraryEntryId?: string | undefined;
  orderFolderId?: string | undefined;
  note?: string | undefined;
  pausedAt?: string | undefined;
  pausedReason?: string | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  submittedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

export type PatternTaskCreateInput = {
  orderId: string;
  status?: PatternTaskStatus | undefined;
  requirements?: PatternTaskRequirement[] | undefined;
  completedRequirements?: PatternTaskRequirement[] | undefined;
  totalWorkHours?: number | undefined;
  completionNote?: string | undefined;
  patternMakerId?: string | undefined;
  patternMakerName?: string | undefined;
  internalName?: string | undefined;
  linkedPatternLibraryEntryId?: string | undefined;
  orderFolderId?: string | undefined;
  note?: string | undefined;
  pausedAt?: string | undefined;
  pausedReason?: string | undefined;
};

export type PatternTaskClaimInput = {
  patternMakerId: string;
  patternMakerName?: string | undefined;
  startedAt: string;
};

export type PatternTaskUpdateInput = Partial<
  Pick<
    PatternTaskRecord,
    | "status"
    | "requirements"
    | "completedRequirements"
    | "totalWorkHours"
    | "completionNote"
    | "patternMakerId"
    | "patternMakerName"
    | "internalName"
    | "linkedPatternLibraryEntryId"
    | "orderFolderId"
    | "note"
    | "pausedAt"
    | "pausedReason"
    | "startedAt"
    | "completedAt"
    | "submittedAt"
  >
>;

export type PatternDeliverableRecord = {
  id: string;
  orderId: string;
  patternTaskId: string;
  version: string;
  type: PatternDeliverableType;
  fileName?: string | undefined;
  mimeType?: string | undefined;
  size?: number | undefined;
  storageKey?: string | undefined;
  textValue?: string | undefined;
  structuredData?: Record<string, unknown> | undefined;
  visibility: AttachmentVisibility;
  uploadedBy: string;
  uploadedByName?: string | undefined;
  taskCategory?: PatternTaskRequirement | "other" | undefined;
  archivedAt?: string | undefined;
  createdAt: string;
};

export type PatternDeliverableCreateInput = Omit<
  PatternDeliverableRecord,
  "id" | "createdAt"
>;

export type PatternDeliverableUpdateInput = Partial<
  Pick<PatternDeliverableRecord, "fileName" | "visibility">
>;

export type PatternLibraryEntryRecord = {
  id: string;
  customerId?: string | undefined;
  customerName?: string | undefined;
  styleNo: string;
  styleName?: string | undefined;
  patternVersion: string;
  fileName: string;
  localPath?: string | undefined;
  storageKey?: string | undefined;
  note?: string | undefined;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type PatternLibraryEntryCreateInput = Omit<
  PatternLibraryEntryRecord,
  "id" | "createdAt" | "updatedAt"
>;

export type PatternLibraryEntryUpdateInput = Partial<
  Pick<
    PatternLibraryEntryRecord,
    | "customerId"
    | "customerName"
    | "styleNo"
    | "styleName"
    | "patternVersion"
    | "fileName"
    | "localPath"
    | "storageKey"
    | "note"
  >
>;

export type SubmittedCuttingFileRecord = {
  id: string;
  submissionId: string;
  fileName: string;
  localPath: string;
  sizeBytes?: number | undefined;
  createdAt: string;
};

export type SubmittedCuttingVersionRecord = {
  id: string;
  orderId: string;
  patternTaskId: string;
  version: string;
  submittedBy: string;
  submittedByName?: string | undefined;
  submittedAt: string;
  purpose: "cutting_handoff" | "supplemental_revision";
  orderFolderPath: string;
  submittedCuttingPath: string;
  cuttingInboxPath: string;
  status: CuttingInboxStatus;
  statusUpdatedAt?: string | undefined;
  printedAt?: string | undefined;
  cutAt?: string | undefined;
  note?: string | undefined;
  workHours?: number | undefined;
  files: SubmittedCuttingFileRecord[];
  order?: Pick<
    OrderRecord,
    "id" | "styleNo" | "styleName" | "quantity" | "stage" | "sampleType" | "sampleRound"
  > & {
    patternTaskNote?: string | undefined;
  };
};

export type SubmittedCuttingVersionCreateInput = Omit<
  SubmittedCuttingVersionRecord,
  "id" | "files"
> & {
  files: Array<Omit<SubmittedCuttingFileRecord, "id" | "submissionId" | "createdAt">>;
};

export type SubmittedCuttingVersionUpdateInput = Partial<
  Pick<
    SubmittedCuttingVersionRecord,
    "status" | "statusUpdatedAt" | "printedAt" | "cutAt" | "note"
  >
>;

export type PatternTaskDto = PatternTaskRecord & {
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
  > & { attachments?: OrderAttachmentRecord[] | undefined };
  orderFolder?: PatternOrderFolderDto | undefined;
  linkedPattern?: PatternLibraryEntryDto | undefined;
  submissions: SubmittedCuttingVersionDto[];
  deliverables: PatternDeliverableDto[];
};

export type PatternOrderFolderDto = Pick<
  OrderFolderRecord,
  "id" | "orderId" | "folderName" | "createdAt" | "updatedAt"
>;

export type PatternLibraryEntryDto = Omit<PatternLibraryEntryRecord, "localPath" | "storageKey"> & {
  hasFile: boolean;
};

export type PatternDeliverableDto = Omit<PatternDeliverableRecord, "storageKey"> & {
  hasFile: boolean;
};

export type SubmittedCuttingVersionDto = Omit<
  SubmittedCuttingVersionRecord,
  "orderFolderPath" | "submittedCuttingPath" | "cuttingInboxPath" | "files"
> & {
  files: Array<Omit<SubmittedCuttingFileRecord, "localPath">>;
};

export type CuttingInboxSubmissionDto = SubmittedCuttingVersionDto & {
  order?: {
    id: string;
    styleNo: string;
    styleName: string;
    quantity: number;
    stage: OrderStage | null;
    sampleType: string;
    sampleRound: string;
    patternTaskNote?: string | undefined;
  } | undefined;
};

export type PatternWorkbenchDto = {
  current?: PatternTaskDto | undefined;
  pending: PatternTaskDto[];
  paused: PatternTaskDto[];
  history: PatternTaskDto[];
};
