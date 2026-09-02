import type { OrderStage, Role } from "@sample-room/shared";

export type ProductionStage = "pattern" | "cutting" | "sewing" | "qc_delivery";
export type ScanActorType = "production_worker" | "internal_account";
export type QualityResult = "qualified" | "rework" | "rejected";
export type TerminationSettlementStatus = "pending" | "accepted" | "historical";

export type ScanAction =
  | "pattern_start"
  | "pattern_finish"
  | "cutting_start"
  | "cutting_finish"
  | "sewing_start"
  | "sewing_finish"
  | "qc_delivery_start"
  | "qc_delivery_finish"
  | "termination_complete";

export type ScanRecordAction = "start" | "complete" | "termination_complete";

export type OrderScanTokenRecord = {
  id: string;
  orderId: string;
  token: string;
  stage?: OrderStage | null | undefined;
  createdAt: string;
  expiresAt?: string | undefined;
  revokedAt?: string | undefined;
};

export type OrderScanTokenCreateInput = {
  orderId: string;
  token: string;
  stage?: OrderStage | null | undefined;
  expiresAt?: string | undefined;
};

export type ScanRecord = {
  id: string;
  orderId: string;
  actorAccountId: string;
  workerProfileId?: string | undefined;
  stage: ProductionStage;
  orderStage: OrderStage;
  action: ScanRecordAction;
  scanAction: ScanAction;
  workerId: string;
  workerName: string;
  actorType: ScanActorType;
  actorRole?: Role | undefined;
  eventTime: string;
  workHours?: number | undefined;
  pieces?: number | undefined;
  note?: string | undefined;
  collaborationJoin?: boolean | undefined;
  takeoverFromWorkerId?: string | undefined;
  takeoverFromWorkerName?: string | undefined;
  takeoverReason?: string | undefined;
  qualityResult?: QualityResult | undefined;
  qualityScore?: number | undefined;
  samplePhotoAttachmentIds?: string[] | undefined;
  measurementPhotoAttachmentIds?: string[] | undefined;
  /** Legacy ScanRecord payload compatibility. New records use measurementPhotoAttachmentIds. */
  measurementPhotoAttachmentId?: string | undefined;
  terminationCycleAt?: string | undefined;
  terminationSettlementStatus?: TerminationSettlementStatus | undefined;
  source: "scan";
};

export type ScanRecordCreateInput = Omit<
  ScanRecord,
  "id" | "eventTime" | "source" | "actorType" | "actorAccountId" | "workerProfileId"
> & {
  eventTime?: string | undefined;
  actorType?: ScanActorType | undefined;
  actorAccountId?: string | undefined;
  workerProfileId?: string | undefined;
};

export type WorkerScanOrderSummary = {
  styleNo: string;
  styleName: string;
  quantity: number;
  customerName: string;
  salespersonName: string;
  sampleType?: string | undefined;
  sampleRound?: string | undefined;
  thumbnailUrl?: string | undefined;
  recordSubmittedAt?: string | undefined;
  remark?: string | undefined;
  taskInstructionNote?: string | undefined;
};

export type AccountScanOrderSummary = WorkerScanOrderSummary;
export type SafeScanOrderSummary = WorkerScanOrderSummary;

export type SewingTaskListItem = {
  orderId: string;
  styleNo: string;
  styleName: string;
  sampleType: string;
  sampleRound: string;
  quantity: number;
  startedAt: string;
  thumbnailUrl: string;
  previousReworkReason?: string | undefined;
  collaboration?: boolean | undefined;
  participationId?: string | undefined;
  targetPieces?: number | undefined;
  collaborationRevision?: string | undefined;
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
  | "workflow_invalid"
  | "other_worker_started"
  | "not_scannable"
  | "SEWING_ROUND_ALREADY_COMPLETED";

export type ScanPageState = {
  order: SafeScanOrderSummary;
  worker?: {
    id: string;
    name: string;
    stage: ProductionStage;
    stageLabel: string;
  } | undefined;
  allowedAction: ScanAllowedAction;
  message?: string | undefined;
  blockedReason?: ScanBlockedReason | undefined;
  stage: ProductionStage | null;
  stageLabel?: string | undefined;
  startedByCurrentWorker?: boolean | undefined;
  defaultPieces?: number | undefined;
  collaboration?: {
    participationId?: string | undefined;
    targetPieces?: number | undefined;
    completedPieces: number;
    orderQuantity: number;
    activeParticipantCount: number;
    currentParticipantCount: number;
    plannedPieces: number;
    unallocatedPieces: number;
    revision?: string | undefined;
    expectedActiveWorkerIds?: string[] | undefined;
  } | undefined;
  patternTaskWarning?: {
    status: string;
    patternMakerName?: string | undefined;
    unclaimed: boolean;
    unfinishedRequirements: string[];
  } | undefined;
  activeTask?: {
    stage: ProductionStage;
    stageLabel: string;
    workerId: string;
    workerName: string;
    startedAt: string;
  } | undefined;
  latestRework?: {
    note?: string | undefined;
    eventTime: string;
    workerName?: string | undefined;
    photos: Array<{
      id: string;
      fileName: string;
      previewUrl: string;
    }>;
  } | undefined;
};

export type OrderScanLinkDto = {
  order: SafeScanOrderSummary;
  token: string;
  urlPath: string;
  qrFormat: "legacy_url" | "plain_text";
  qrPayload: string;
  recommendedUrl?: string | undefined;
  absoluteUrl?: string | undefined;
};

export type ScanRecordDto = {
  id: string;
  orderId: string;
  actorAccountId: string;
  workerProfileId?: string | undefined;
  stage: ProductionStage;
  stageLabel: string;
  orderStage: OrderStage;
  action: ScanRecordAction;
  actionLabel: string;
  workerId: string;
  workerName: string;
  actorType: ScanActorType;
  actorRole?: Role | undefined;
  eventTime: string;
  workHours?: number | undefined;
  pieces?: number | undefined;
  note?: string | undefined;
  takeoverFromWorkerId?: string | undefined;
  takeoverFromWorkerName?: string | undefined;
  takeoverReason?: string | undefined;
  qualityResult?: QualityResult | undefined;
  qualityScore?: number | undefined;
  samplePhotoAttachmentIds?: string[] | undefined;
  measurementPhotoAttachmentIds?: string[] | undefined;
  /** Legacy ScanRecord payload compatibility. */
  measurementPhotoAttachmentId?: string | undefined;
  terminationCycleAt?: string | undefined;
  terminationSettlementStatus?: TerminationSettlementStatus | undefined;
  source: "scan";
};

export function measurementPhotoIds(
  record: Pick<ScanRecord, "measurementPhotoAttachmentIds" | "measurementPhotoAttachmentId">
): string[] {
  if (record.measurementPhotoAttachmentIds?.length) {
    return record.measurementPhotoAttachmentIds;
  }
  return record.measurementPhotoAttachmentId ? [record.measurementPhotoAttachmentId] : [];
}

export type ScanManagementRole = Extract<Role, "receiver" | "boss" | "system_owner">;
