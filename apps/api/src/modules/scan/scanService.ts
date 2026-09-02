import { randomBytes } from "node:crypto";
import {
  ATTACHMENT_VISIBILITY,
  formatOrderQrPayload,
  isPatternTaskComplete,
  nextOrderStageAfterPhysicalCompletion,
  ORDER_STAGES,
  physicalProductionRoute,
  ROLES,
  isClientRole,
  SAMPLE_REQUEST_ITEMS,
  type OrderStage
} from "@sample-room/shared";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import type {
  AccountRepository,
  WorkerProfileRepository
} from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import { publicUrlForPath } from "../../shared/urls/publicUrl.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { canReceiverViewOrder, canUsePlannerWorkflow } from "../auth/permissionPolicy.js";
import type { OrderRecord } from "../orders/orderTypes.js";
import type { AttachmentDownload } from "../orders/orderService.js";
import { FileStorageNotFoundError, type FileStorageAdapter } from "../files/fileStorageAdapter.js";
import { attachmentForWebResponse } from "../files/attachmentDto.js";
import { isQcAttachmentCategory } from "../files/qcAttachmentCategories.js";
import { createLocalFileStorageAdapter } from "../files/localFileStorageAdapter.js";
import { ensureOrderFolder } from "../patterns/orderFolderService.js";
import { CUTTING_INBOX_STATUSES } from "../patterns/patternTypes.js";
import {
  completedPatternRequirementsFromDeliverables,
  isPatternProductionGateSatisfiedByDeliverables
} from "../patterns/patternCompletionRules.js";
import {
  actionLabel,
  isProductionStage,
  normalizeOrderStageForWorkflow,
  productionStageLabels,
  stageConfig,
  stageForOrderStage
} from "./scanWorkflow.js";
import { orderQrFormat } from "./orderQrFormat.js";
import { ScanActorResolver, type WorkerScanActor } from "./scanActor.js";
import type {
  OrderScanTokenRecord,
  AccountScanOrderSummary,
  ProductionStage,
  QualityResult,
  WorkerScanOrderSummary,
  ScanPageState,
  ScanRecord,
  ScanRecordDto,
  SewingTaskListItem
} from "./scanTypes.js";
import { measurementPhotoIds } from "./scanTypes.js";

export type CompleteScanPayload = {
  workHours?: unknown;
  pieces?: unknown;
  note?: unknown;
  qualityResult?: unknown;
  qualityScore?: unknown;
  attachments?: unknown;
  expectedParticipationId?: unknown;
  expectedCollaborationRevision?: unknown;
};

const publicThumbnailCategories = [
  "style_thumbnail",
  "receiver_quick_photo",
  "client_quick_photo",
  "client_reference"
] as const;

type SewingTakeoverPayload = {
  reason?: unknown;
  expectedActiveWorkerId?: unknown;
};

type UploadedScanAttachment = {
  fileName: string;
  mimeType: string;
  size: number;
  category?: string | undefined;
  buffer?: Buffer | undefined;
  temporaryPath?: string | undefined;
  checksum?: string | undefined;
};

type BoundWorker = WorkerScanActor & { state: "active" };
type WorkerBinding = BoundWorker | undefined;

const managementRoles = new Set<string>([ROLES.receiver, ROLES.boss, ROLES.systemOwner]);
const missingPrerequisiteMessage = "流程异常：缺少前置工序完成记录，请联系接单员或老板处理。";
const cuttingTaskCancelledMessage = "裁剪任务已取消";

function randomToken(prefix: string) {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

function requireText(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} is required.`);
  }

  return value.trim();
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requireWorkHours(value: unknown) {
  const parsed = typeof value === "string" && value.trim().length > 0 ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, "workHours is required.");
  }

  return parsed;
}

function optionalPieces(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = typeof value === "string" && value.trim().length > 0 ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, "pieces must be a non-negative integer.");
  }

  return parsed;
}

function requirePieces(value: unknown, field = "pieces") {
  const pieces = optionalPieces(value);
  if (pieces === undefined) {
    throw new HttpError(400, `${field} is required.`);
  }
  return pieces;
}

function requireQualityResult(value: unknown): QualityResult {
  if (value !== "qualified" && value !== "rework" && value !== "rejected") {
    throw new HttpError(400, "qualityResult must be qualified, rework, or rejected.");
  }

  return value;
}

function requireNormalQcQualityResult(value: unknown): Exclude<QualityResult, "rejected"> {
  if (value !== "qualified" && value !== "rework") {
    throw new HttpError(400, "qualityResult must be qualified or rework.");
  }

  return value;
}

function requireMissingQualityScore(value: unknown) {
  if (
    value !== undefined &&
    value !== null &&
    !(typeof value === "string" && value.trim().length === 0)
  ) {
    throw new HttpError(400, "qualityScore must not be provided when QC result is rework.");
  }
}

function requireQualityScore(value: unknown) {
  const parsed = typeof value === "string" && value.trim().length > 0 ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new HttpError(400, "qualityScore must be an integer between 0 and 100.");
  }
  return parsed;
}

function normalizeUploadedScanAttachments(value: unknown): UploadedScanAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((attachment) => {
    if (!attachment || typeof attachment !== "object") {
      return [];
    }

    const input = attachment as Record<string, unknown>;
    if (
      typeof input.fileName !== "string" ||
      typeof input.mimeType !== "string" ||
      typeof input.size !== "number" ||
      (!Buffer.isBuffer(input.buffer) && typeof input.temporaryPath !== "string")
    ) {
      return [];
    }

    return [{
      fileName: input.fileName,
      mimeType: input.mimeType,
      size: input.size,
      category: typeof input.category === "string" ? input.category : undefined,
      buffer: Buffer.isBuffer(input.buffer) ? input.buffer : undefined,
      temporaryPath: typeof input.temporaryPath === "string" ? input.temporaryPath : undefined,
      checksum: typeof input.checksum === "string" ? input.checksum : undefined
    }];
  });
}

function workerOrderSummary(order: OrderRecord, thumbnailUrl?: string): WorkerScanOrderSummary {
  return {
    styleNo: order.styleNo,
    styleName: order.styleName,
    quantity: order.quantity,
    customerName: order.customerName,
    salespersonName: order.salespersonName,
    ...(order.remark ? { remark: order.remark } : {}),
    ...(order.taskInstructionNote ? { taskInstructionNote: order.taskInstructionNote } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {})
  };
}

function accountOrderSummary(order: OrderRecord, thumbnailUrl?: string): AccountScanOrderSummary {
  return workerOrderSummary(order, thumbnailUrl);
}

function recordTime(record: ScanRecord) {
  return new Date(record.eventTime).getTime();
}

function openStartRecord(records: ScanRecord[], stage: ProductionStage) {
  const stageRecords = records
    .filter((record) => record.stage === stage)
    .sort((a, b) => recordTime(a) - recordTime(b));
  const lastStart = stageRecords.filter((record) => record.action === "start").at(-1);
  if (!lastStart) {
    return undefined;
  }

  const completedAfterStart = stageRecords.some(
    (record) =>
      (record.action === "complete" || record.action === "termination_complete") &&
      recordTime(record) >= recordTime(lastStart)
  );

  return completedAfterStart ? undefined : lastStart;
}

function normalQcCompletions(records: ScanRecord[]) {
  return records
    .filter((record) => record.stage === "qc_delivery" && record.action === "complete")
    .sort((a, b) => recordTime(a) - recordTime(b));
}

function activeTaskDto(record: ScanRecord) {
  return {
    stage: record.stage,
    stageLabel: productionStageLabels[record.stage],
    workerId: record.workerId,
    workerName: record.workerName,
    startedAt: record.eventTime
  };
}

function stageLabel(stage: ProductionStage | null) {
  return stage ? productionStageLabels[stage] : undefined;
}

function currentOrderWaitingMessage(stage: ProductionStage) {
  const label = stage === "qc_delivery" ? "组检" : productionStageLabels[stage];
  return `当前订单待${label}`;
}

function hasCompletedStage(records: ScanRecord[], stage: ProductionStage) {
  return records.some((record) => record.stage === stage && record.action === "complete");
}

function validateStagePrerequisites(
  currentStage: ProductionStage,
  records: ScanRecord[],
  order: OrderRecord
) {
  if (
    currentStage === "sewing" &&
    order.sampleRequestItems.includes(SAMPLE_REQUEST_ITEMS.cutting) &&
    !hasCompletedStage(records, "cutting")
  ) {
    return missingPrerequisiteMessage;
  }

  if (currentStage === "qc_delivery" && !hasCompletedStage(records, "sewing")) {
    return missingPrerequisiteMessage;
  }

  return undefined;
}

function defaultPiecesForStage(stage: ProductionStage, order: OrderRecord) {
  return stage === "cutting" || stage === "sewing" || stage === "qc_delivery"
    ? order.quantity
    : undefined;
}

function scanRecordDto(record: ScanRecord): ScanRecordDto {
  return {
    id: record.id,
    orderId: record.orderId,
    actorAccountId: record.actorAccountId,
    workerProfileId: record.workerProfileId,
    stage: record.stage,
    stageLabel: productionStageLabels[record.stage],
    orderStage: record.orderStage,
    action: record.action,
    actionLabel:
      record.action === "termination_complete" ? "终止完成" : actionLabel(record.scanAction),
    workerId: record.workerId,
    workerName: record.workerName,
    actorType: record.actorType,
    actorRole: record.actorRole,
    eventTime: record.eventTime,
    workHours: record.workHours,
    pieces: record.pieces,
    note: record.note,
    takeoverFromWorkerId: record.takeoverFromWorkerId,
    takeoverFromWorkerName: record.takeoverFromWorkerName,
    takeoverReason: record.takeoverReason,
    qualityResult: record.qualityResult,
    qualityScore: record.qualityScore,
    samplePhotoAttachmentIds: record.samplePhotoAttachmentIds,
    measurementPhotoAttachmentIds: measurementPhotoIds(record),
    measurementPhotoAttachmentId: record.measurementPhotoAttachmentId,
    source: record.source
  };
}

export class ScanWorkflowService {
  private readonly orderMutationTails = new Map<string, Promise<void>>();
  private readonly workerMutationTails = new Map<string, Promise<void>>();
  private readonly scanActors: ScanActorResolver;

  constructor(
    private readonly repository: SampleRoomRepository,
    private readonly accounts: AccountRepository,
    private readonly workerProfiles: WorkerProfileRepository,
    private readonly fileStorage: FileStorageAdapter = createLocalFileStorageAdapter(),
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {
    this.scanActors = new ScanActorResolver(accounts, workerProfiles);
  }

  private async withOrderMutationLock<T>(orderId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.orderMutationTails.get(orderId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.orderMutationTails.set(orderId, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.orderMutationTails.get(orderId) === tail) {
        this.orderMutationTails.delete(orderId);
      }
    }
  }

  private async withWorkerMutationLock<T>(workerProfileId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.workerMutationTails.get(workerProfileId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.workerMutationTails.set(workerProfileId, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.workerMutationTails.get(workerProfileId) === tail) {
        this.workerMutationTails.delete(workerProfileId);
      }
    }
  }

  private async withPatternTaskWarning(
    order: OrderRecord,
    state: ScanPageState
  ): Promise<ScanPageState> {
    const [task, deliverables] = await Promise.all([
      this.repository.findPatternTaskByOrderId(order.id),
      this.repository.listPatternDeliverablesByOrderId(order.id)
    ]);
    if (!task || isPatternTaskComplete(task.status)) return state;
    const completed = new Set(
      completedPatternRequirementsFromDeliverables(task.requirements, deliverables)
    );
    return {
      ...state,
      patternTaskWarning: {
        status: task.status,
        patternMakerName: task.patternMakerName,
        unclaimed: !task.patternMakerId,
        unfinishedRequirements: task.requirements.filter(
          (requirement) => !completed.has(requirement)
        )
      }
    };
  }

  private async publicThumbnail(orderId: string) {
    const attachments = await this.repository.listOrderAttachments(orderId);
    for (const category of publicThumbnailCategories) {
      const attachment = attachments.find(
        (item) => item.category === category && item.storageKey && item.mimeType.startsWith("image/")
      );
      if (attachment) return attachment;
    }
    return undefined;
  }

  private async withScanPresentation(
    token: string,
    order: OrderRecord,
    state: ScanPageState
  ): Promise<ScanPageState> {
    const [thumbnail, records, attachments] = await Promise.all([
      this.publicThumbnail(order.id),
      this.repository.listScanRecordsByOrderId(order.id),
      this.repository.listOrderAttachments(order.id)
    ]);
    const latestQc = normalQcCompletions(records).at(-1);
    const latestRework = latestQc?.qualityResult === "rework" ? latestQc : undefined;
    const photoIds = new Set(latestRework?.samplePhotoAttachmentIds ?? []);
    return {
      ...state,
      order: {
        ...workerOrderSummary(
          order,
          thumbnail ? `/api/scan/${encodeURIComponent(token)}/thumbnail` : undefined
        ),
        ...(state.stage === "sewing"
          ? { sampleType: order.sampleType, sampleRound: order.sampleRound }
          : state.stage === "qc_delivery"
            ? { sampleType: order.sampleType }
            : {}),
        ...(records.at(-1)?.eventTime ? { recordSubmittedAt: records.at(-1)!.eventTime } : {})
      },
      ...(latestRework ? {
        latestRework: {
          ...(latestRework.note ? { note: latestRework.note } : {}),
          eventTime: latestRework.eventTime,
          ...(latestRework.workerName ? { workerName: latestRework.workerName } : {}),
          photos: attachments.filter((attachment) => photoIds.has(attachment.id)).map((attachment) => ({
            id: attachment.id,
            fileName: attachment.fileName,
            previewUrl: `/api/scan/${encodeURIComponent(token)}/attachments/${encodeURIComponent(attachment.id)}/download`
          }))
        }
      } : {})
    };
  }

  async getPublicThumbnail(token: string): Promise<AttachmentDownload> {
    const { order } = await this.requireScanToken(token);
    const attachment = await this.publicThumbnail(order.id);
    if (!attachment?.storageKey) throw new HttpError(404, "thumbnail not found.");
    try {
      return {
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        content: await this.fileStorage.readFile(attachment.storageKey)
      };
    } catch (error) {
      if (error instanceof FileStorageNotFoundError) throw new HttpError(404, "thumbnail not found.");
      throw error;
    }
  }

  private ensureManagementUser(currentUser: CurrentUser) {
    if (!managementRoles.has(currentUser.role)) {
      throw new HttpError(403, "forbidden");
    }
  }

  private async requireOrder(orderId: string): Promise<OrderRecord> {
    const order = await this.repository.findOrderById(orderId);
    if (!order) {
      throw new HttpError(404, "order not found.");
    }

    return order;
  }

  private async requireScanToken(token: string): Promise<{
    scanToken: OrderScanTokenRecord;
    order: OrderRecord;
  }> {
    const scanToken = await this.repository.findOrderScanToken(token);
    const expiryTime = scanToken?.expiresAt ? Date.parse(scanToken.expiresAt) : undefined;
    const expired =
      expiryTime !== undefined && (!Number.isFinite(expiryTime) || expiryTime <= Date.now());
    if (!scanToken || scanToken.revokedAt || expired) {
      throw new HttpError(404, "scan token not found.");
    }

    return {
      scanToken,
      order: await this.requireOrder(scanToken.orderId)
    };
  }

  private async boundWorker(currentUser: CurrentUser): Promise<BoundWorker> {
    return { state: "active", ...(await this.scanActors.requireWorkerActor(currentUser)) };
  }

  private async ownOpenSewingTasks(binding: BoundWorker): Promise<Array<{
    order: OrderRecord;
    start: ScanRecord;
    records: ScanRecord[];
  }>> {
    if (binding.worker.stage !== "sewing") {
      throw new HttpError(403, "SEWING_WORKER_REQUIRED");
    }
    const rows = await Promise.all((await this.repository.listOrders()).map(async (order) => {
      const records = await this.repository.listScanRecordsByOrderId(order.id);
      const start = openStartRecord(records, "sewing");
      return start?.workerProfileId === binding.workerProfile.id || start?.workerId === binding.worker.id
        ? { order, start, records }
        : undefined;
    }));
    return rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
  }

  private async ensureSewingCapacity(binding: BoundWorker) {
    if ((await this.ownOpenSewingTasks(binding)).length >= 3) {
      throw new HttpError(409, "当前已超过最大接单数量");
    }
  }

  private async ownedOpenSewingTask(orderId: string, currentUser: CurrentUser) {
    const binding = await this.boundWorker(currentUser);
    const row = (await this.ownOpenSewingTasks(binding)).find(({ order }) => order.id === orderId);
    if (!row) throw new HttpError(403, "SEWING_TASK_NOT_OWNED");
    return { binding, ...row };
  }

  async listOwnSewingTasks(currentUser: CurrentUser): Promise<SewingTaskListItem[]> {
    const binding = await this.boundWorker(currentUser);
    const rows = await this.ownOpenSewingTasks(binding);
    return rows.filter(({ order }) => !order.terminated).map(({ order, start, records }) => {
      const latestRework = normalQcCompletions(records)
        .filter((record) => record.qualityResult === "rework")
        .at(-1);
      return {
        orderId: order.id,
        styleNo: order.styleNo,
        styleName: order.styleName,
        sampleType: order.sampleType,
        sampleRound: order.sampleRound,
        quantity: order.quantity,
        startedAt: start.eventTime,
        thumbnailUrl: `/api/miniapp/me/sewing-tasks/${encodeURIComponent(order.id)}/thumbnail`,
        ...(latestRework?.note ? { previousReworkReason: latestRework.note } : {})
      };
    }).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async getOwnSewingTaskState(orderId: string, currentUser: CurrentUser): Promise<ScanPageState> {
    const { binding, order } = await this.ownedOpenSewingTask(orderId, currentUser);
    const state = await this.withPatternTaskWarning(order, await this.scanPageState(order, binding));
    if (state.allowedAction !== "complete") {
      throw new HttpError(409, state.message ?? "sewing completion is not allowed.");
    }
    const thumbnail = await this.publicThumbnail(order.id);
    return {
      ...state,
      order: {
        ...workerOrderSummary(
          order,
          thumbnail ? `/api/miniapp/me/sewing-tasks/${encodeURIComponent(order.id)}/thumbnail` : undefined
        ),
        sampleType: order.sampleType,
        sampleRound: order.sampleRound
      }
    };
  }

  async getOwnSewingTaskThumbnail(orderId: string, currentUser: CurrentUser): Promise<AttachmentDownload> {
    const { order } = await this.ownedOpenSewingTask(orderId, currentUser);
    const attachment = await this.publicThumbnail(order.id);
    if (!attachment?.storageKey) throw new HttpError(404, "thumbnail not found.");
    try {
      return {
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        content: await this.fileStorage.readFile(attachment.storageKey)
      };
    } catch (error) {
      if (error instanceof FileStorageNotFoundError) throw new HttpError(404, "thumbnail not found.");
      throw error;
    }
  }

  async completeOwnSewingTask(
    orderId: string,
    currentUser: CurrentUser,
    payload: CompleteScanPayload
  ): Promise<ScanPageState> {
    const { order } = await this.ownedOpenSewingTask(orderId, currentUser);
    const token = (await this.repository.listOrderScanTokensByOrderId(order.id))
      .filter((item) => !item.revokedAt && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (!token) throw new HttpError(404, "scan token not found.");
    return this.completeScan(token.token, currentUser, payload);
  }

  private async scanPageState(
    order: OrderRecord,
    binding: WorkerBinding
  ): Promise<ScanPageState> {
    const currentStage = stageForOrderStage(order.stage);
    const normalizedOrderStage = normalizeOrderStageForWorkflow(order.stage);
    const orderSummary = workerOrderSummary(order);
    const boundWorker = binding?.state === "active" ? binding : undefined;

    const [records, deliverables] = await Promise.all([
      this.repository.listScanRecordsByOrderId(order.id),
      this.repository.listPatternDeliverablesByOrderId(order.id)
    ]);
    const physicalRoute = physicalProductionRoute(order.sampleRequestItems);
    const openStart = currentStage ? openStartRecord(records, currentStage) : undefined;
    const prerequisiteError = currentStage
      ? validateStagePrerequisites(currentStage, records, order)
      : undefined;
    const workerInfo = boundWorker
      ? {
          id: boundWorker.worker.id,
          name: boundWorker.worker.name,
          stage: boundWorker.worker.stage,
          stageLabel: productionStageLabels[boundWorker.worker.stage]
        }
      : undefined;

    if (order.terminated) {
      return {
        order: orderSummary,
        worker: workerInfo,
        allowedAction: "blocked",
        message: "订单已终止",
        blockedReason: "terminated",
        stage: currentStage,
        stageLabel: stageLabel(currentStage),
        ...(openStart ? { activeTask: activeTaskDto(openStart) } : {})
      };
    }

    if (!boundWorker) {
      return {
        order: orderSummary,
        allowedAction: "blocked",
        message: "请先登录有效的生产员工账号",
        blockedReason: "worker_disabled",
        stage: currentStage,
        stageLabel: stageLabel(currentStage)
      };
    }

    if (currentStage && boundWorker.worker.stage !== currentStage) {
      return {
        order: orderSummary,
        worker: workerInfo,
        allowedAction: "blocked",
        message: currentOrderWaitingMessage(currentStage),
        blockedReason: "wrong_stage",
        stage: currentStage,
        stageLabel: stageLabel(currentStage),
        ...(openStart ? { activeTask: activeTaskDto(openStart) } : {})
      };
    }

    if (
      !isPatternProductionGateSatisfiedByDeliverables(
        order.sampleRequestItems,
        deliverables
      )
    ) {
      return {
        order: orderSummary,
        worker: boundWorker
          ? {
              id: boundWorker.worker.id,
              name: boundWorker.worker.name,
              stage: boundWorker.worker.stage,
              stageLabel: productionStageLabels[boundWorker.worker.stage]
            }
          : undefined,
        allowedAction: "blocked",
        message: "等待版师任务：制版/改版有效交付物尚未齐全。",
        blockedReason: "workflow_invalid",
        stage: currentStage,
        stageLabel: stageLabel(currentStage)
      };
    }

    if (
      boundWorker?.worker.stage === "cutting" &&
      !physicalRoute.includes("cutting") &&
      !hasCompletedStage(records, "cutting")
    ) {
      return {
        order: orderSummary,
        worker: {
          id: boundWorker.worker.id,
          name: boundWorker.worker.name,
          stage: boundWorker.worker.stage,
          stageLabel: productionStageLabels[boundWorker.worker.stage]
        },
        allowedAction: "blocked",
        message: cuttingTaskCancelledMessage,
        blockedReason: "workflow_invalid",
        stage: currentStage,
        stageLabel: stageLabel(currentStage)
      };
    }

    if (!currentStage || order.stage === ORDER_STAGES.done) {
      const physicalProductionCompleted =
        order.stage === ORDER_STAGES.done && physicalRoute.length > 0;
      return {
        order: orderSummary,
        worker: boundWorker
          ? {
              id: boundWorker.worker.id,
              name: boundWorker.worker.name,
              stage: boundWorker.worker.stage,
              stageLabel: productionStageLabels[boundWorker.worker.stage]
            }
          : undefined,
        allowedAction: "blocked",
        message: physicalProductionCompleted
          ? "实体生产已完成"
          : "当前订单没有可由生产员工处理的实体工序",
        blockedReason: physicalProductionCompleted ? "done" : "not_production",
        stage: currentStage,
        stageLabel: stageLabel(currentStage)
      };
    }

    if (!physicalRoute.includes(currentStage)) {
      return {
        order: orderSummary,
        worker: boundWorker
          ? {
              id: boundWorker.worker.id,
              name: boundWorker.worker.name,
              stage: boundWorker.worker.stage,
              stageLabel: productionStageLabels[boundWorker.worker.stage]
            }
          : undefined,
        allowedAction: "blocked",
        message: "当前订单生产路线不包含该扫码工序。",
        blockedReason: "workflow_invalid",
        stage: currentStage,
        stageLabel: stageLabel(currentStage)
      };
    }

    if (prerequisiteError) {
      return {
        order: orderSummary,
        worker: workerInfo,
        allowedAction: "blocked",
        message: prerequisiteError,
        blockedReason: "workflow_invalid",
        stage: currentStage,
        stageLabel: stageLabel(currentStage),
        ...(openStart ? { activeTask: activeTaskDto(openStart) } : {})
      };
    }

    const config = stageConfig[currentStage];

    if (currentStage === "qc_delivery" && normalizedOrderStage === config.waiting && !openStart) {
      const latestQc = normalQcCompletions(records).at(-1);
      if (
        latestQc?.qualityResult === "rework" &&
        latestQc.workerProfileId !== boundWorker.workerProfile.id
      ) {
        return {
          order: orderSummary,
          worker: workerInfo,
          allowedAction: "blocked",
          message: "该订单正在由原组检员工跟进返工复检。",
          blockedReason: "other_worker_started",
          stage: currentStage,
          stageLabel: stageLabel(currentStage)
        };
      }
    }

    if (normalizedOrderStage === config.waiting && !openStart) {
      return {
        order: orderSummary,
        worker: workerInfo,
        allowedAction:
          config.interactionMode === "completion_only" ? "complete" : "start",
        stage: currentStage,
        stageLabel: stageLabel(currentStage),
        ...(config.interactionMode === "completion_only"
          ? { defaultPieces: defaultPiecesForStage(currentStage, order) }
          : {})
      };
    }

    if (openStart?.workerId === boundWorker.worker.id) {
      return {
        order: orderSummary,
        worker: workerInfo,
        allowedAction: "complete",
        startedByCurrentWorker: true,
        stage: currentStage,
        stageLabel: stageLabel(currentStage),
        defaultPieces: defaultPiecesForStage(currentStage, order)
      };
    }

    if (openStart) {
      if (currentStage === "sewing" && boundWorker.worker.stage === "sewing") {
        return {
          order: orderSummary,
          worker: workerInfo,
          allowedAction: "takeover",
          message: "该缝制任务已由其他员工开始，确认并填写原因后可替换负责人。",
          stage: currentStage,
          stageLabel: stageLabel(currentStage),
          activeTask: activeTaskDto(openStart)
        };
      }
      return {
        order: orderSummary,
        worker: workerInfo,
        allowedAction: "blocked",
        message: "该工序已由其他员工开始",
        blockedReason: "other_worker_started",
        stage: currentStage,
        stageLabel: stageLabel(currentStage),
        activeTask: activeTaskDto(openStart)
      };
    }

    return {
      order: orderSummary,
      worker: workerInfo,
      allowedAction: "blocked",
      message: "当前订单不在可扫码状态",
      blockedReason: "not_scannable",
      stage: currentStage,
      stageLabel: stageLabel(currentStage)
    };
  }

  private async markLatestCuttingSubmissionCut(orderId: string) {
    const submissions = await this.repository.listSubmittedCuttingVersionsByOrderId(orderId);
    const latest = submissions
      .filter((submission) => submission.status !== CUTTING_INBOX_STATUSES.cut)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())[0];

    if (!latest) {
      return;
    }

    const at = new Date().toISOString();
    await this.repository.updateSubmittedCuttingVersion(latest.id, {
      status: CUTTING_INBOX_STATUSES.cut,
      statusUpdatedAt: at,
      cutAt: at
    });
  }

  async ensureOrderScanLink(orderId: string, currentUser: CurrentUser) {
    this.ensureManagementUser(currentUser);

    const order = await this.requireOrder(orderId);
    if (currentUser.role !== ROLES.systemOwner && !canReceiverViewOrder(currentUser, order).allowed) {
      throw new HttpError(403, "forbidden");
    }

    const existing = (await this.repository.listOrderScanTokensByOrderId(order.id)).find(
      (token) => !token.revokedAt
    );

    const scanToken =
      existing ??
      (await this.repository.createOrderScanToken({
        orderId: order.id,
        token: randomToken("order_scan"),
        stage: order.stage
      }));

    const urlPath = `/scan/${scanToken.token}`;
    const publicUrl = publicUrlForPath(urlPath, this.env);
    const qrFormat = orderQrFormat();
    const qrPayload = formatOrderQrPayload(scanToken.token, qrFormat, publicUrl ?? urlPath);

    const thumbnail = await this.publicThumbnail(order.id);
    return {
      order: accountOrderSummary(order, thumbnail ? `/api/scan/${encodeURIComponent(scanToken.token)}/thumbnail` : undefined),
      token: scanToken.token,
      urlPath,
      qrFormat,
      qrPayload,
      ...(publicUrl ? { recommendedUrl: publicUrl, absoluteUrl: publicUrl } : {})
    };
  }

  async listOrderScanRecords(orderId: string, currentUser: CurrentUser): Promise<ScanRecordDto[]> {
    this.ensureManagementUser(currentUser);

    const order = await this.requireOrder(orderId);
    if (currentUser.role !== ROLES.systemOwner && !canReceiverViewOrder(currentUser, order).allowed) {
      throw new HttpError(403, "forbidden");
    }

    return (await this.repository.listScanRecordsByOrderId(order.id)).map(scanRecordDto);
  }

  async getScanState(token: string, currentUser: CurrentUser): Promise<ScanPageState> {
    const { order } = await this.requireScanToken(token);
    const binding = await this.boundWorker(currentUser);
    const state = await this.scanPageState(order, binding);
    return this.withScanPresentation(token, order, await this.withPatternTaskWarning(order, state));
  }

  async getQcOrderState(orderId: string, currentUser: CurrentUser): Promise<ScanPageState> {
    const order = await this.requireOrder(orderId);
    const binding = await this.boundWorker(currentUser);
    if (binding.worker.stage !== "qc_delivery") {
      throw new HttpError(403, "QC_DELIVERY_WORKER_REQUIRED");
    }
    const state = await this.withPatternTaskWarning(order, await this.scanPageState(order, binding));
    const thumbnail = await this.publicThumbnail(order.id);
    return {
      ...state,
      order: {
        ...workerOrderSummary(
          order,
          thumbnail ? `/api/qc/me/orders/${encodeURIComponent(order.id)}/thumbnail` : undefined
        ),
        sampleType: order.sampleType
      }
    };
  }

  async completeQcOrder(
    orderId: string,
    currentUser: CurrentUser,
    payload: CompleteScanPayload
  ): Promise<ScanPageState> {
    const order = await this.requireOrder(orderId);
    const binding = await this.boundWorker(currentUser);
    if (binding.worker.stage !== "qc_delivery") {
      throw new HttpError(403, "QC_DELIVERY_WORKER_REQUIRED");
    }
    const tokens = (await this.repository.listOrderScanTokensByOrderId(order.id))
      .filter((item) => !item.revokedAt && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const token = tokens[0];
    if (!token) throw new HttpError(404, "scan token not found.");
    return this.completeScan(token.token, currentUser, payload);
  }

  async getMiniappReadOnlyState(token: string) {
    const { order } = await this.requireScanToken(token);
    const state = await this.withPatternTaskWarning(
      order,
      await this.scanPageState(order, undefined)
    );

    return {
      order: {
        orderNo: order.orderNo,
        styleNo: order.styleNo,
        ...(order.styleName ? { styleName: order.styleName } : {}),
        quantity: order.quantity,
        customerName: order.customerName
      },
      currentStage: state.stage,
      ...(state.stageLabel ? { currentStageLabel: state.stageLabel } : {}),
      ...(state.message ? { statusMessage: state.message } : {}),
      ...(state.blockedReason ? { blockedReason: state.blockedReason } : {}),
      ...(state.patternTaskWarning ? { patternTaskWarning: state.patternTaskWarning } : {})
    };
  }

  async getAccountScanState(token: string, currentUser: CurrentUser) {
    const account = await this.scanActors.requireActiveAccount(currentUser);
    if (isClientRole(account.role) || account.role === ROLES.patternMaker || account.role === ROLES.worker) {
      throw new HttpError(403, "forbidden");
    }

    const { order } = await this.requireScanToken(token);
    const canLocate =
      account.role === ROLES.systemOwner ||
      canReceiverViewOrder({ ...currentUser, role: account.role }, order).allowed ||
      canUsePlannerWorkflow({ ...currentUser, role: account.role }).allowed;
    if (!canLocate) throw new HttpError(403, "forbidden");

    const allowedActions =
      account.role === ROLES.receiver || account.role === ROLES.planner
        ? order.terminated
          ? []
          : ["record_charge"]
        : ["view_order"];

    return {
      order: accountOrderSummary(order),
      allowedActions
    };
  }

  async startScan(token: string, currentUser: CurrentUser): Promise<ScanPageState> {
    const { order: initialOrder } = await this.requireScanToken(token);
    const initialBinding = await this.boundWorker(currentUser);
    const operation = () => this.withOrderMutationLock(initialOrder.id, async () =>
      this.repository.withTransaction(async (repository) => {
        const service = new ScanWorkflowService(repository, this.accounts, this.workerProfiles, this.fileStorage, this.env);
        const { order } = await service.requireScanToken(token);
        await repository.lockOrderForWorkflow(order.id);
        const latestOrder = await service.requireOrder(order.id);
        if (latestOrder.terminated) {
          throw new HttpError(409, "订单已终止");
        }
        const binding = await service.boundWorker(currentUser);
        const state = await service.scanPageState(latestOrder, binding);

        if (
          state.allowedAction !== "start" ||
          !binding ||
          binding.state !== "active" ||
          !state.stage
        ) {
          throw new HttpError(409, state.message ?? "scan start is not allowed.");
        }

        if (state.stage === "sewing") {
          await repository.lockWorkerForWorkflow(binding.workerProfile.id);
          await service.ensureSewingCapacity(binding);
        }

        const config = stageConfig[state.stage];
        const nextStage = config.doing;
        const updatedOrder = await repository.updateOrder(latestOrder.id, { stage: nextStage });

        await repository.createScanRecord({
          orderId: latestOrder.id,
          actorAccountId: binding.account.id,
          workerProfileId: binding.workerProfile.id,
          actorType: "production_worker",
          actorRole: ROLES.worker,
          stage: state.stage,
          orderStage: nextStage,
          action: "start",
          scanAction: config.startAction,
          workerId: binding.worker.id,
          workerName: binding.worker.name
        });

        return service.withScanPresentation(
          token,
          updatedOrder,
          await service.withPatternTaskWarning(
            updatedOrder,
            await service.scanPageState(updatedOrder, binding)
          )
        );
      })
    );
    return initialBinding.worker.stage === "sewing"
      ? this.withWorkerMutationLock(initialBinding.workerProfile.id, operation)
      : operation();
  }

  async deleteOwnQcAttachment(token: string, currentUser: CurrentUser, attachmentId: string) {
    const { order: initialOrder } = await this.requireScanToken(token);
    return this.withOrderMutationLock(initialOrder.id, async () =>
      await this.repository.withTransaction(async (repository) => {
        await repository.lockOrderForWorkflow(initialOrder.id);
        const service = new ScanWorkflowService(
          repository,
          this.accounts,
          this.workerProfiles,
          this.fileStorage,
          this.env
        );
        const { order } = await service.requireScanToken(token);
        if (order.terminated) throw new HttpError(409, "订单已终止，无法继续修改。");
        const binding = await service.boundWorker(currentUser);
        if (!binding || binding.state !== "active" || binding.worker.stage !== "qc_delivery") {
          throw new HttpError(403, "only the bound QC/delivery worker can delete this attachment.");
        }
        const attachment = (await repository.listOrderAttachments(order.id)).find((item) => item.id === attachmentId);
        if (!attachment || !isQcAttachmentCategory(attachment.category) || attachment.uploadedBy !== binding.worker.id) {
          throw new HttpError(403, "only the original uploader can delete this attachment.");
        }
        if (attachment.storageKey) {
          try {
            await this.fileStorage.deleteFile(attachment.storageKey);
          } catch (error) {
            if (!(error instanceof FileStorageNotFoundError)) throw error;
          }
        }
        await repository.deleteOrderAttachment(order.id, attachment.id, {
          id: binding.worker.id,
          name: binding.worker.name,
          role: ROLES.worker
        });
        return (await repository.listOrderAttachments(order.id))
          .filter((item) => isQcAttachmentCategory(item.category) && item.uploadedBy === binding.worker.id)
          .map(attachmentForWebResponse);
      })
    );
  }

  async downloadOwnQcAttachment(token: string, currentUser: CurrentUser, attachmentId: string): Promise<AttachmentDownload> {
    const { order } = await this.requireScanToken(token);
    const binding = await this.boundWorker(currentUser);
    if (binding.worker.stage !== "qc_delivery") throw new HttpError(403, "QC_DELIVERY_WORKER_REQUIRED");
    const attachment = (await this.repository.listOrderAttachments(order.id)).find((item) => item.id === attachmentId);
    if (!attachment || !isQcAttachmentCategory(attachment.category) || attachment.uploadedBy !== binding.worker.id || !attachment.storageKey) {
      throw new HttpError(404, "attachment not found.");
    }
    try {
      return {
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        content: await this.fileStorage.readFile(attachment.storageKey)
      };
    } catch (error) {
      if (error instanceof FileStorageNotFoundError) throw new HttpError(404, "attachment not found.");
      throw error;
    }
  }

  async authorizeCompletionUpload(token: string, currentUser: CurrentUser): Promise<void> {
    const { order } = await this.requireScanToken(token);
    if (order.terminated) throw new HttpError(409, "订单已终止");
    const binding = await this.boundWorker(currentUser);
    const state = await this.scanPageState(order, binding);
    if (
      state.allowedAction !== "complete" ||
      !binding ||
      binding.state !== "active"
    ) {
      throw new HttpError(409, state.message ?? "scan completion is not allowed.");
    }
  }

  async completeScan(
    token: string,
    currentUser: CurrentUser,
    payload: CompleteScanPayload
  ): Promise<ScanPageState> {
    const { order: initialOrder } = await this.requireScanToken(token);
    return this.withOrderMutationLock(initialOrder.id, async () => {
      let storedKeys: string[] = [];
      try {
        return await this.repository.withTransaction(async (repository) => {
          const service = new ScanWorkflowService(repository, this.accounts, this.workerProfiles, this.fileStorage, this.env);
          const { order } = await service.requireScanToken(token);
          await repository.lockOrderForWorkflow(order.id);
          const latestOrder = await service.requireOrder(order.id);
          if (latestOrder.terminated) {
            throw new HttpError(409, "订单已终止");
          }
          const binding = await service.boundWorker(currentUser);
          const state = await service.scanPageState(latestOrder, binding);

        if (
          state.allowedAction !== "complete" ||
          !binding ||
          binding.state !== "active" ||
          !state.stage
        ) {
          throw new HttpError(
            409,
            binding?.worker.stage === "cutting" &&
              !physicalProductionRoute(latestOrder.sampleRequestItems).includes("cutting")
              ? cuttingTaskCancelledMessage
              : state.message ?? "scan completion is not allowed."
          );
        }

        const config = stageConfig[state.stage];
        const workHours =
          state.stage === "qc_delivery" ? undefined : requireWorkHours(payload.workHours);
        const pieces = state.stage === "qc_delivery"
          ? requirePieces(payload.pieces, "receivedPieces")
          : requirePieces(payload.pieces);
        const note = optionalText(payload.note);
        let qualityResult: QualityResult | undefined;
        let qualityScore: number | undefined;
        let samplePhotoAttachmentIds: string[] | undefined;
        let measurementPhotoAttachmentIds: string[] | undefined;

        if (state.stage === "qc_delivery") {
          qualityResult = requireNormalQcQualityResult(payload.qualityResult);
          if (qualityResult === "qualified") {
            qualityScore = requireQualityScore(payload.qualityScore);
          } else {
            requireMissingQualityScore(payload.qualityScore);
          }
          if (qualityResult === "rework" && !note) {
            throw new HttpError(400, "note is required when QC result is rework.");
          }

          const evidence = await service.createQcEvidenceAttachments(
            latestOrder,
            binding,
            normalizeUploadedScanAttachments(payload.attachments),
            qualityResult
          );
          storedKeys = evidence.storedKeys;
          samplePhotoAttachmentIds = evidence.samplePhotoAttachmentIds;
          measurementPhotoAttachmentIds = evidence.measurementPhotoAttachmentIds;
        }

        const eventStage: OrderStage = latestOrder.stage ?? config.doing;
        const nextStage = state.stage === "qc_delivery" && qualityResult === "rework"
          ? ORDER_STAGES.qcDeliveryWaiting
          : state.stage === "pattern"
            ? config.next
            : nextOrderStageAfterPhysicalCompletion(latestOrder.sampleRequestItems, state.stage);
        const updatedOrder = await repository.updateOrder(latestOrder.id, { stage: nextStage });

        await repository.createScanRecord({
          orderId: latestOrder.id,
          actorAccountId: binding.account.id,
          workerProfileId: binding.workerProfile.id,
          actorType: "production_worker",
          actorRole: ROLES.worker,
          stage: state.stage,
          orderStage: eventStage,
          action: "complete",
          scanAction: config.completeAction,
          workerId: binding.worker.id,
          workerName: binding.worker.name,
          ...(workHours !== undefined ? { workHours } : {}),
          ...(pieces !== undefined ? { pieces } : {}),
          note,
          ...(qualityResult ? { qualityResult } : {}),
          ...(qualityScore !== undefined ? { qualityScore } : {}),
          ...(samplePhotoAttachmentIds ? { samplePhotoAttachmentIds } : {}),
          ...(measurementPhotoAttachmentIds?.length ? { measurementPhotoAttachmentIds } : {})
        });

        if (state.stage === "cutting") {
          await service.markLatestCuttingSubmissionCut(latestOrder.id);
        }

        return service.withScanPresentation(
          token,
          updatedOrder,
          await service.withPatternTaskWarning(
            updatedOrder,
            await service.scanPageState(updatedOrder, binding)
          )
        );
        });
      } catch (error) {
        await Promise.allSettled(storedKeys.map((storageKey) => this.fileStorage.deleteFile(storageKey)));
        throw error;
      }
    });
  }

  async takeoverSewing(
    token: string,
    currentUser: CurrentUser,
    payload: SewingTakeoverPayload
  ): Promise<ScanPageState> {
    const reason = requireText(payload.reason, "reason");
    const expectedActiveWorkerId = requireText(
      payload.expectedActiveWorkerId,
      "expectedActiveWorkerId"
    );
    const { order: initialOrder } = await this.requireScanToken(token);
    const initialBinding = await this.boundWorker(currentUser);
    const operation = () => this.withOrderMutationLock(initialOrder.id, async () =>
      this.repository.withTransaction(async (repository) => {
        const service = new ScanWorkflowService(repository, this.accounts, this.workerProfiles, this.fileStorage, this.env);
        const { order } = await service.requireScanToken(token);
        await repository.lockOrderForWorkflow(order.id);
        const latestOrder = await service.requireOrder(order.id);
        if (latestOrder.terminated) {
          throw new HttpError(409, "订单已终止");
        }
        const binding = await service.boundWorker(currentUser);
        const state = await service.scanPageState(latestOrder, binding);
        if (!state.activeTask || state.activeTask.workerId !== expectedActiveWorkerId) {
          throw new HttpError(409, "sewing task owner changed; refresh and confirm again.");
        }
        if (
          state.allowedAction !== "takeover" ||
          !binding ||
          binding.state !== "active" ||
          state.stage !== "sewing" ||
          !state.activeTask
        ) {
          throw new HttpError(409, state.message ?? "sewing takeover is not allowed.");
        }

        await repository.lockWorkerForWorkflow(binding.workerProfile.id);
        await service.ensureSewingCapacity(binding);

        await repository.createScanRecord({
          orderId: latestOrder.id,
          actorAccountId: binding.account.id,
          workerProfileId: binding.workerProfile.id,
          actorType: "production_worker",
          actorRole: ROLES.worker,
          stage: "sewing",
          orderStage: ORDER_STAGES.sewingDoing,
          action: "start",
          scanAction: "sewing_start",
          workerId: binding.worker.id,
          workerName: binding.worker.name,
          note: `替换缝制负责人：${reason}`,
          takeoverFromWorkerId: state.activeTask.workerId,
          takeoverFromWorkerName: state.activeTask.workerName,
          takeoverReason: reason
        });

        return service.withScanPresentation(
          token,
          latestOrder,
          await service.withPatternTaskWarning(
            latestOrder,
            await service.scanPageState(latestOrder, binding)
          )
        );
      })
    );
    return this.withWorkerMutationLock(initialBinding.workerProfile.id, operation);
  }

  private async createQcEvidenceAttachments(
    order: OrderRecord,
    binding: BoundWorker,
    attachments: UploadedScanAttachment[],
    qualityResult: QualityResult
  ): Promise<{
    samplePhotoAttachmentIds: string[];
    measurementPhotoAttachmentIds: string[];
    storedKeys: string[];
  }> {
    const nonImage = attachments.find((attachment) => !attachment.mimeType.startsWith("image/"));
    if (nonImage) {
      throw new HttpError(400, "QC evidence files must be images.");
    }

    const measurementPhotos = attachments.filter(
      (attachment) => attachment.category === "qc_measurement_photo"
    );
    if (qualityResult !== "qualified" && measurementPhotos.length > 0) {
      throw new HttpError(400, "QC rework accepts issue photos only.");
    }
    const evidencePhotos = attachments.filter(
      (attachment) => attachment.category !== "qc_measurement_photo"
    );
    if (qualityResult === "qualified" && evidencePhotos.length === 0) {
      throw new HttpError(400, "at least one QC sample photo is required.");
    }
    const folder = await ensureOrderFolder(this.repository, order, binding.worker.id);
    const storedKeys: string[] = [];
    const samplePhotoAttachmentIds: string[] = [];
    const measurementPhotoAttachmentIds: string[] = [];

    try {
      for (const attachment of [...evidencePhotos, ...measurementPhotos]) {
        const category = measurementPhotos.includes(attachment)
          ? "qc_measurement_photo"
          : qualityResult === "rework"
            ? "qc_issue_photo"
            : "qc_sample_photo";
        const stored = await this.fileStorage.saveFile({
          orderId: order.id,
          folderCode: order.folderCode,
          orderFolderRelativePath: folder.relativePath,
          category,
          uploaderRole: ROLES.worker,
          originalName: attachment.fileName,
          contentType: attachment.mimeType,
          buffer: attachment.buffer,
          temporaryPath: attachment.temporaryPath,
          checksum: attachment.checksum
        });
        storedKeys.push(stored.storageKey);
        const metadata = await this.repository.createOrderAttachment({
          orderId: order.id,
          fileName: stored.originalName,
          mimeType: stored.contentType,
          size: stored.sizeBytes,
          category,
          uploadedBy: binding.worker.id,
          uploadedByRole: ROLES.worker,
          uploadedByName: binding.worker.name,
          visibility: ATTACHMENT_VISIBILITY.internalOnly,
          storageKey: stored.storageKey,
          checksum: stored.checksum
        });

        if (category === "qc_measurement_photo") {
          measurementPhotoAttachmentIds.push(metadata.id);
        } else {
          samplePhotoAttachmentIds.push(metadata.id);
        }
      }
    } catch (error) {
      await Promise.allSettled(storedKeys.map((storageKey) => this.fileStorage.deleteFile(storageKey)));
      throw error;
    }

    return {
      samplePhotoAttachmentIds,
      measurementPhotoAttachmentIds,
      storedKeys
    };
  }

}
