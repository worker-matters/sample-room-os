import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import type { AccountRepository, OperationLogRepository } from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import {
  ATTACHMENT_VISIBILITY,
  ORDER_STAGES,
  ROLES,
  deriveOrderCompletionStatus
} from "@sample-room/shared";
import type { CurrentUser } from "../auth/currentUser.js";
import { canManageOrderTermination } from "../auth/permissionPolicy.js";
import {
  actionLabel,
  productionStageLabels
} from "../scan/scanWorkflow.js";
import { measurementPhotoIds, type ScanRecord, type ScanRecordDto } from "../scan/scanTypes.js";
import {
  collaborativeSewingRoundStates,
  collaborativeSewingState
} from "../scan/collaborativeSewing.js";
import type {
  OrderAttachmentRecord,
  OrderComplaintRecord,
  OrderPatternTaskSummary,
  OrderRecord,
  ReceiverOrderDto
} from "./orderTypes.js";
import { ensureOrderFolder } from "../patterns/orderFolderService.js";
import {
  completedPatternRequirementsFromDeliverables,
  currentOrderStageFromPatternGate
} from "../patterns/patternCompletionRules.js";
import {
  attachmentAuditLogForWebResponseWithAccountNames,
  attachmentForWebResponseWithAccountNames
} from "../files/attachmentDto.js";
import { renamedDisplayFileName } from "../files/attachmentDisplayName.js";
import { attachmentVisibilityFromInput, normalizeAttachmentVisibility } from "../files/attachmentVisibility.js";
import { isQcAttachmentCategory, ordinaryOrderAttachments } from "../files/qcAttachmentCategories.js";
import { auditAttachmentVisibilityChange } from "../files/attachmentVisibilityAudit.js";
import {
  FileStorageNotFoundError,
  type FileStorageAdapter
} from "../files/fileStorageAdapter.js";
import type { AttachmentDownload } from "./orderService.js";
import {
  currentAccountDisplayName,
  loadAccountDisplayNames,
  type AccountDisplayNameMap
} from "../accounts/accountDisplayName.js";
import { orderStageDisplayLabel } from "./orderDisplayStatus.js";
import { lockActiveOrderForBusinessWrite } from "./orderWriteBoundary.js";

type TerminatePayload = {
  reason?: unknown;
};

type ComplaintPayload = {
  description?: unknown;
};

export type AdminOrderDetailDto = {
  order: ReceiverOrderDto;
  scanRecords: ScanRecordDto[];
  qcReworkRecords: Array<{
    scanRecordId: string;
    photos: OrderAttachmentRecord[];
  }>;
  complaints: OrderComplaintRecord[];
};

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requiredText(value: unknown, field: string) {
  const text = optionalText(value);
  if (!text) throw new HttpError(400, `${field} is required.`);
  return text;
}

function requiredComplaintDescription(value: unknown) {
  const description = optionalText(value);
  if (!description) throw new HttpError(400, "complaint description is required.");
  if (description.length > 1000) throw new HttpError(400, "complaint description is too long.");
  return description;
}

function patternTaskForResponse(
  task: Awaited<ReturnType<SampleRoomRepository["findPatternTaskByOrderId"]>>,
  deliverables: Awaited<ReturnType<SampleRoomRepository["listPatternDeliverablesByOrderId"]>> = [],
  accountNames: AccountDisplayNameMap = new Map()
): OrderPatternTaskSummary | undefined {
  if (!task) {
    return undefined;
  }

  return {
    status: task.status,
    requirements: [...task.requirements],
    completedRequirements: completedPatternRequirementsFromDeliverables(
      task.requirements,
      deliverables
    ),
    ...(task.totalWorkHours !== undefined ? { totalWorkHours: task.totalWorkHours } : {}),
    ...(task.completionNote ? { completionNote: task.completionNote } : {}),
    ...(task.patternMakerName ? { patternMakerName: task.patternMakerName } : {}),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    ...(task.note ? { note: task.note } : {}),
    ...(deliverables.length > 0
      ? {
          deliverables: deliverables.map((deliverable) => ({
            id: deliverable.id,
            version: deliverable.version,
            type: deliverable.type,
            ...(deliverable.fileName ? { fileName: deliverable.fileName } : {}),
            ...(deliverable.textValue ? { textValue: deliverable.textValue } : {}),
            ...(currentAccountDisplayName(
              accountNames,
              deliverable.uploadedBy,
              deliverable.uploadedByName
            )
              ? {
                  uploadedByName: currentAccountDisplayName(
                    accountNames,
                    deliverable.uploadedBy,
                    deliverable.uploadedByName
                  )
                }
              : {}),
            ...(deliverable.uploadedBy ? { uploadedBy: deliverable.uploadedBy } : {}),
            ...(deliverable.taskCategory ? { taskCategory: deliverable.taskCategory } : {}),
            visibility: normalizeAttachmentVisibility(deliverable.visibility),
            hasFile: Boolean(deliverable.storageKey),
            createdAt: deliverable.createdAt
          }))
        }
      : {})
  };
}

function scanRecordForResponse(record: ScanRecord): ScanRecordDto {
  return {
    id: record.id,
    orderId: record.orderId,
    stage: record.stage,
    stageLabel: productionStageLabels[record.stage],
    orderStage: record.orderStage,
    action: record.action,
    actionLabel:
      record.action === "termination_complete" ? "缝制终止结算" : actionLabel(record.scanAction),
    workerId: record.workerId,
    workerName: record.workerName,
    actorAccountId: record.actorAccountId,
    workerProfileId: record.workerProfileId,
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
    terminationCycleAt: record.terminationCycleAt,
    terminationSettlementStatus: record.terminationSettlementStatus,
    source: record.source
  };
}

function qcRecordStatus(scanRecords: ScanRecord[]): "none" | "rework" | "completed" {
  const latest = [...scanRecords]
    .filter((record) => record.stage === "qc_delivery" && record.action === "complete")
    .sort((left, right) => left.eventTime.localeCompare(right.eventTime))
    .at(-1);
  if (latest?.qualityResult === "rework") return "rework";
  if (latest?.qualityResult === "qualified" && latest.qualityScore !== undefined) return "completed";
  return "none";
}

export class OrderManagementService {
  constructor(
    private readonly repository: SampleRoomRepository,
    private readonly fileStorage: FileStorageAdapter,
    private readonly accounts: AccountRepository,
    private readonly operationLogs?: OperationLogRepository
  ) {}

  private ensureManager(currentUser: CurrentUser) {
    if (!canManageOrderTermination(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }
  }

  private async requireOrder(id: string): Promise<OrderRecord> {
    const order = await this.repository.findOrderById(id);
    if (!order) {
      throw new HttpError(404, "order not found.");
    }

    return order;
  }

  private async withAttachments(
    order: OrderRecord,
    accountNames: AccountDisplayNameMap
  ): Promise<ReceiverOrderDto> {
    const [attachments, attachmentLogs, patternTask, patternDeliverables, existingFolder, scanRecords, charges] = await Promise.all([
      this.repository.listOrderAttachments(order.id),
      this.repository.listAttachmentAuditLogs(order.id),
      this.repository.findPatternTaskByOrderId(order.id),
      this.repository.listPatternDeliverablesByOrderId(order.id),
      this.repository.findOrderFolderByOrderId(order.id),
      this.repository.listScanRecordsByOrderId(order.id),
      this.repository.listOrderChargesByOrderId(order.id)
    ]);
    const ordinaryAttachments = ordinaryOrderAttachments(attachments);
    const ordinaryAttachmentLogs = attachmentLogs.filter((log) => !isQcAttachmentCategory(log.attachmentCategory));
    const orderFolder = existingFolder ?? (await ensureOrderFolder(this.repository, order, order.createdBy));
    const currentStage = currentOrderStageFromPatternGate({
      sampleRequestItems: order.sampleRequestItems,
      storedStage: order.stage,
      deliverables: patternDeliverables
    });
    const sewingState = collaborativeSewingState(order, scanRecords);
    const sewingWorkerNames = [...new Map(
      sewingState.currentParticipations.map((item) => [
        item.workerProfileId ?? item.workerId,
        item.workerName
      ])
    ).values()];
    return {
      ...order,
      stage: currentStage,
      stageLabel: orderStageDisplayLabel(currentStage, scanRecords),
      attachmentCount: ordinaryAttachments.length,
      chargeCount: charges.filter((charge) => !charge.archivedAt).length,
      materialRecordCount: ordinaryAttachments.filter((attachment) => attachment.category === "receiver_material_record").length,
      quantityCorrectionLocked: scanRecords.some(
        (record) =>
          (record.stage === "cutting" &&
            (record.action === "complete" || record.action === "termination_complete")) ||
          (record.stage === "sewing" && record.action === "start")
      ),
      qcRecordStatus: qcRecordStatus(scanRecords),
      attachments: ordinaryAttachments.map((attachment) =>
        attachmentForWebResponseWithAccountNames(attachment, accountNames)
      ),
      attachmentLogs: ordinaryAttachmentLogs.map((log) =>
        attachmentAuditLogForWebResponseWithAccountNames(log, accountNames)
      ),
      completionStatus: deriveOrderCompletionStatus({
        sampleRequestItems: order.sampleRequestItems,
        orderStage: currentStage,
        patternTaskStatus: patternTask?.status
      }),
      ...(sewingWorkerNames.length > 0
        ? {
            sewingWorkforce: {
              mode: sewingState.mode,
              workerNames: sewingWorkerNames
            }
          }
        : {}),
      ...(patternTask
        ? { patternTask: patternTaskForResponse(patternTask, patternDeliverables, accountNames) }
        : {}),
      orderFolder: {
        id: orderFolder.id,
        orderId: orderFolder.orderId,
        folderName: orderFolder.folderName,
        createdAt: orderFolder.createdAt,
        updatedAt: orderFolder.updatedAt
      }
    };
  }

  private withAccountNames(
    order: ReceiverOrderDto,
    accountNames: ReadonlyMap<string, string>
  ): ReceiverOrderDto {
    const createdByName = currentAccountDisplayName(accountNames, order.createdBy);
    const receivedByName = currentAccountDisplayName(accountNames, order.receivedBy);
    return {
      ...order,
      ...(createdByName ? { createdByName } : {}),
      ...(receivedByName ? { receivedByName } : {})
    };
  }

  async listActiveOrders(currentUser: CurrentUser): Promise<ReceiverOrderDto[]> {
    this.ensureManager(currentUser);
    const [orders, accountNames] = await Promise.all([
      this.repository.listOrders(),
      loadAccountDisplayNames(this.accounts)
    ]);
    return Promise.all(
      orders
        .filter((order) => !order.terminated)
        .map(async (order) => {
          const [orderWithAttachments, complaints] = await Promise.all([
            this.withAttachments(order, accountNames),
            this.repository.listOrderComplaintsByOrderId(order.id)
          ]);
          return {
            ...this.withAccountNames(orderWithAttachments, accountNames),
            complaintCount: complaints.length
          };
        })
    );
  }

  async listTerminatedOrders(currentUser: CurrentUser): Promise<ReceiverOrderDto[]> {
    this.ensureManager(currentUser);
    const [orders, accountNames] = await Promise.all([
      this.repository.listOrders(),
      loadAccountDisplayNames(this.accounts)
    ]);
    return Promise.all(
      orders
        .filter((order) => order.terminated)
        .map(async (order) =>
          this.withAccountNames(await this.withAttachments(order, accountNames), accountNames)
        )
    );
  }

  async getOrderDetail(id: string, currentUser: CurrentUser): Promise<AdminOrderDetailDto> {
    this.ensureManager(currentUser);
    const order = await this.requireOrder(id);
    const accountNames = await loadAccountDisplayNames(this.accounts);
    const [orderWithAttachments, scanRecords, complaints, allAttachments] = await Promise.all([
      this.withAttachments(order, accountNames),
      this.repository.listScanRecordsByOrderId(order.id),
      this.repository.listOrderComplaintsByOrderId(order.id),
      this.repository.listOrderAttachments(order.id)
    ]);
    const qcReworkRecords = scanRecords
      .filter((record) => record.stage === "qc_delivery" && record.action === "complete" && record.qualityResult === "rework")
      .map((record) => {
        const linkedIds = new Set(record.samplePhotoAttachmentIds ?? []);
        return {
          scanRecordId: record.id,
          photos: allAttachments
            .filter((attachment) => linkedIds.has(attachment.id) && isQcAttachmentCategory(attachment.category))
            .map((attachment) => ({
              ...attachmentForWebResponseWithAccountNames(attachment, accountNames),
              category: "qc_issue_photo"
            }))
        };
      });
    const hiddenScanRecordIds = new Set(
      collaborativeSewingRoundStates(order, scanRecords)
        .flatMap((round) => round.hiddenAuditScanRecordIds)
    );

    return {
      order: this.withAccountNames(orderWithAttachments, accountNames),
      scanRecords: scanRecords
        .filter((record) => !hiddenScanRecordIds.has(record.id))
        .map(scanRecordForResponse)
        .sort(
          (left, right) =>
            new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime()
        ),
      qcReworkRecords,
      complaints
    };
  }

  private ensureQcResultViewer(currentUser: CurrentUser) {
    if (currentUser.role !== ROLES.boss && currentUser.role !== ROLES.systemOwner) {
      throw new HttpError(403, "forbidden");
    }
  }

  async getQcResult(id: string, currentUser: CurrentUser) {
    this.ensureQcResultViewer(currentUser);
    const order = await this.requireOrder(id);
    const records = (await this.repository.listScanRecordsByOrderId(order.id))
      .filter((record) => record.stage === "qc_delivery" && record.action === "complete")
      .sort((left, right) => left.eventTime.localeCompare(right.eventTime));
    const latest = records.at(-1);
    if (!latest || (latest.qualityResult !== "qualified" && latest.qualityResult !== "rework")) {
      return { result: null };
    }
    const linkedIds = new Set([
      ...(latest.samplePhotoAttachmentIds ?? []),
      ...measurementPhotoIds(latest)
    ]);
    const photos = (await this.repository.listOrderAttachments(order.id))
      .filter((attachment) => linkedIds.has(attachment.id) && isQcAttachmentCategory(attachment.category))
      .map((attachment) => {
        const response = attachmentForWebResponseWithAccountNames(attachment, new Map());
        return latest.qualityResult === "rework" && response.category === "qc_sample_photo"
          ? { ...response, category: "qc_issue_photo" }
          : response;
      });
    return {
      result: {
        qualityResult: latest.qualityResult,
        ...(latest.qualityScore !== undefined ? { qualityScore: latest.qualityScore } : {}),
        ...(latest.pieces !== undefined ? { pieces: latest.pieces } : {}),
        ...(latest.note ? { note: latest.note } : {}),
        ...(latest.workerName ? { workerName: latest.workerName } : {}),
        eventTime: latest.eventTime,
        photos
      }
    };
  }

  async downloadQcResultPhoto(id: string, attachmentId: string, currentUser: CurrentUser): Promise<AttachmentDownload> {
    this.ensureQcResultViewer(currentUser);
    const order = await this.requireOrder(id);
    const records = (await this.repository.listScanRecordsByOrderId(order.id))
      .filter((record) => record.stage === "qc_delivery" && record.action === "complete")
      .sort((left, right) => left.eventTime.localeCompare(right.eventTime));
    const latest = records.at(-1);
    const linkedIds = new Set([
      ...(latest?.samplePhotoAttachmentIds ?? []),
      ...measurementPhotoIds(latest ?? {})
    ]);
    const attachment = (await this.repository.listOrderAttachments(order.id)).find(
      (item) => item.id === attachmentId && linkedIds.has(item.id) && isQcAttachmentCategory(item.category)
    );
    if (!attachment?.storageKey) throw new HttpError(404, "attachment not found.");
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

  async downloadQcReworkPhoto(
    id: string,
    scanRecordId: string,
    attachmentId: string,
    currentUser: CurrentUser
  ): Promise<AttachmentDownload> {
    this.ensureQcResultViewer(currentUser);
    const order = await this.requireOrder(id);
    const record = (await this.repository.listScanRecordsByOrderId(order.id)).find(
      (item) => item.id === scanRecordId &&
        item.stage === "qc_delivery" &&
        item.action === "complete" &&
        item.qualityResult === "rework"
    );
    const linkedIds = new Set(record?.samplePhotoAttachmentIds ?? []);
    const attachment = (await this.repository.listOrderAttachments(order.id)).find(
      (item) => item.id === attachmentId && linkedIds.has(item.id) && isQcAttachmentCategory(item.category)
    );
    if (!record || !attachment?.storageKey) throw new HttpError(404, "attachment not found.");
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

  async downloadOrderAttachment(
    id: string,
    attachmentId: string,
    currentUser: CurrentUser
  ): Promise<AttachmentDownload> {
    this.ensureManager(currentUser);
    const order = await this.requireOrder(id);
    const attachment = ordinaryOrderAttachments(await this.repository.listOrderAttachments(order.id)).find(
      (item) => item.id === attachmentId
    );
    if (!attachment) {
      throw new HttpError(404, "attachment not found.");
    }
    if (!attachment.storageKey) {
      throw new HttpError(404, "attachment file is not available.");
    }

    try {
      return {
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        content: await this.fileStorage.readFile(attachment.storageKey)
      };
    } catch (error) {
      if (error instanceof FileStorageNotFoundError) {
        throw new HttpError(404, "attachment file is not available.");
      }
      throw error;
    }
  }

  async addOrderAttachments(
    id: string,
    payload: { attachments?: unknown },
    currentUser: CurrentUser
  ): Promise<OrderAttachmentRecord[]> {
    this.ensureManager(currentUser);
    const values = Array.isArray(payload.attachments) ? payload.attachments : [];
    const storedKeys: string[] = [];
    try {
      return await this.repository.withTransaction(async (repository) => {
        const order = await lockActiveOrderForBusinessWrite(repository, id);
        const folder = await ensureOrderFolder(repository, order, currentUser);
        for (const value of values) {
          if (!value || typeof value !== "object") {
            throw new HttpError(400, "attachment metadata is required.");
          }
          const input = value as Record<string, unknown>;
          const fileName = requiredText(input.fileName, "fileName");
          const mimeType = optionalText(input.mimeType) ?? "application/octet-stream";
          const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : undefined;
          const temporaryPath = typeof input.temporaryPath === "string" ? input.temporaryPath : undefined;
          const visibility = attachmentVisibilityFromInput(
            typeof input.visibility === "string" ? input.visibility : undefined,
            ATTACHMENT_VISIBILITY.internalOnly
          );
          let stored: Awaited<ReturnType<FileStorageAdapter["saveFile"]>> | undefined;
          if (buffer || temporaryPath) {
            stored = await this.fileStorage.saveFile({
              orderId: order.id,
              folderCode: order.folderCode,
              orderFolderRelativePath: folder.relativePath,
              category: "other",
              uploaderRole: currentUser.role,
              originalName: fileName,
              contentType: mimeType,
              buffer,
              temporaryPath,
              checksum: typeof input.checksum === "string" ? input.checksum : undefined
            });
            storedKeys.push(stored.storageKey);
          }
          await repository.createOrderAttachment({
            orderId: order.id,
            fileName: stored?.originalName ?? fileName,
            mimeType: stored?.contentType ?? mimeType,
            size: stored?.sizeBytes ?? (typeof input.size === "number" ? input.size : 0),
            category: "other",
            uploadedBy: currentUser.id,
            uploadedByRole: currentUser.role,
            uploadedByName: currentUser.displayName,
            visibility,
            storageKey: stored?.storageKey,
            checksum: stored?.checksum,
            sourceCategory: "sample_room_upload"
          });
        }
        const [attachments, accountNames] = await Promise.all([
          repository.listOrderAttachments(order.id),
          loadAccountDisplayNames(this.accounts)
        ]);
        return ordinaryOrderAttachments(attachments).map((attachment) =>
          attachmentForWebResponseWithAccountNames(attachment, accountNames)
        );
      });
    } catch (error) {
      await Promise.allSettled(
        storedKeys.map((storageKey) => this.fileStorage.deleteFile(storageKey))
      );
      throw error;
    }
  }

  async renameOrderAttachment(
    id: string,
    attachmentId: string,
    payload: { displayName?: unknown },
    currentUser: CurrentUser
  ) {
    this.ensureManager(currentUser);
    const updated = await this.repository.withTransaction(async (repository) => {
      const order = await lockActiveOrderForBusinessWrite(repository, id);
      const attachment = ordinaryOrderAttachments(await repository.listOrderAttachments(order.id)).find(
        (item) => item.id === attachmentId
      );
      if (!attachment) throw new HttpError(404, "attachment not found.");
      const fileName = renamedDisplayFileName(attachment.fileName, payload.displayName);
      const next = await repository.updateOrderAttachment(order.id, attachment.id, { fileName });
      if (!next) throw new HttpError(404, "attachment not found.");
      await repository.appendAttachmentAuditLog({
        orderId: order.id,
        attachmentId: attachment.id,
        originalFileName: attachment.fileName,
        newFileName: fileName,
        action: "rename",
        actorId: currentUser.id,
        actorName: currentUser.displayName,
        actorRole: currentUser.role,
        originalUploaderId: attachment.uploadedBy,
        originalUploaderName: attachment.uploadedByName,
        originalUploaderRole: attachment.uploadedByRole,
        attachmentCategory: attachment.category,
        sourceCategory: attachment.sourceCategory,
        patternTaskId: attachment.patternTaskId,
        patternTaskCategory: attachment.patternTaskCategory,
        orderChargeId: attachment.orderChargeId
      });
      return next;
    });
    const accountNames = await loadAccountDisplayNames(this.accounts);
    return { attachment: attachmentForWebResponseWithAccountNames(updated, accountNames) };
  }

  async changeOrderAttachmentVisibility(
    id: string,
    attachmentId: string,
    payload: { visibility?: unknown },
    currentUser: CurrentUser
  ) {
    this.ensureManager(currentUser);
    const visibility = attachmentVisibilityFromInput(
      typeof payload.visibility === "string" ? payload.visibility : undefined,
      ATTACHMENT_VISIBILITY.internalOnly
    );
    const updated = await this.repository.withTransaction(async (repository) => {
      const order = await lockActiveOrderForBusinessWrite(repository, id);
      const attachment = ordinaryOrderAttachments(await repository.listOrderAttachments(order.id)).find(
        (item) => item.id === attachmentId
      );
      if (!attachment) throw new HttpError(404, "attachment not found.");
      const next = await repository.updateOrderAttachment(order.id, attachment.id, { visibility });
      if (!next) throw new HttpError(404, "attachment not found.");
      await auditAttachmentVisibilityChange({
        repository,
        operationLogs: this.operationLogs,
        orderId: order.id,
        resourceId: attachment.id,
        source: "order_attachment",
        originalFileName: attachment.fileName,
        originalVisibility: attachment.visibility,
        newVisibility: visibility,
        currentUser,
        originalUploaderId: attachment.uploadedBy,
        originalUploaderName: attachment.uploadedByName,
        originalUploaderRole: attachment.uploadedByRole,
        attachmentCategory: attachment.category,
        sourceCategory: attachment.sourceCategory,
        patternTaskId: attachment.patternTaskId,
        patternTaskCategory: attachment.patternTaskCategory
      });
      return next;
    });
    const accountNames = await loadAccountDisplayNames(this.accounts);
    return { attachment: attachmentForWebResponseWithAccountNames(updated, accountNames) };
  }

  async deleteOrderAttachment(
    id: string,
    attachmentId: string,
    currentUser: CurrentUser
  ) {
    this.ensureManager(currentUser);
    const deleted = await this.repository.withTransaction(async (repository) => {
      const order = await lockActiveOrderForBusinessWrite(repository, id);
      const attachment = ordinaryOrderAttachments(await repository.listOrderAttachments(order.id)).find(
        (item) => item.id === attachmentId
      );
      if (!attachment) throw new HttpError(404, "attachment not found.");
      if (attachment.storageKey) {
        try {
          await this.fileStorage.deleteFile(attachment.storageKey);
        } catch (error) {
          if (!(error instanceof FileStorageNotFoundError)) throw error;
        }
      }
      const next = await repository.deleteOrderAttachment(order.id, attachment.id, {
        id: currentUser.id,
        name: currentUser.displayName,
        role: currentUser.role
      });
      if (!next) throw new HttpError(404, "attachment not found.");
      return next;
    });
    const accountNames = await loadAccountDisplayNames(this.accounts);
    return { attachment: attachmentForWebResponseWithAccountNames(deleted, accountNames) };
  }

  async registerComplaint(
    id: string,
    payload: ComplaintPayload,
    currentUser: CurrentUser
  ): Promise<OrderComplaintRecord> {
    this.ensureManager(currentUser);
    const description = requiredComplaintDescription(payload.description);
    return this.repository.withTransaction(async (repository) => {
      const order = await lockActiveOrderForBusinessWrite(repository, id);
      const scanRecords = await repository.listScanRecordsByOrderId(order.id);
      const qcCompletion = [...scanRecords]
        .filter(
          (record) =>
            record.stage === "qc_delivery" &&
            (record.action === "complete" || record.action === "termination_complete")
        )
        .sort(
          (left, right) =>
            new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime()
        )[0];
      return repository.createOrderComplaint({
        orderId: order.id,
        description,
        ...(qcCompletion
          ? {
              qcScanRecordId: qcCompletion.id,
              ...(qcCompletion.workerProfileId
                ? { qcWorkerProfileId: qcCompletion.workerProfileId }
                : {}),
              qcWorkerNameSnapshot: qcCompletion.workerName
            }
          : {}),
        registeredByAccountId: currentUser.accountId ?? currentUser.id,
        registeredByName: currentUser.displayName ?? currentUser.id
      });
    });
  }

  async deleteComplaint(
    orderId: string,
    complaintId: string,
    currentUser: CurrentUser
  ): Promise<OrderComplaintRecord> {
    this.ensureManager(currentUser);
    return this.repository.withTransaction(async (repository) => {
      await lockActiveOrderForBusinessWrite(repository, orderId);
      const complaint = (await repository.listOrderComplaintsByOrderId(orderId))
        .find((record) => record.id === complaintId);
      if (!complaint) throw new HttpError(404, "complaint not found.");
      if (!await repository.deleteOrderComplaint(orderId, complaintId)) {
        throw new HttpError(404, "complaint not found.");
      }
      return complaint;
    });
  }

  async terminateOrder(
    id: string,
    payload: TerminatePayload,
    currentUser: CurrentUser
  ): Promise<ReceiverOrderDto> {
    this.ensureManager(currentUser);
    const accountNames = await loadAccountDisplayNames(this.accounts);
    const updated = await this.repository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(id);
      const order = await repository.findOrderById(id);
      if (!order) throw new HttpError(404, "order not found.");
      if (order.terminated) return order;
      if (order.stage === ORDER_STAGES.done) {
        throw new HttpError(409, "已完成订单不允许终止");
      }
      return repository.updateOrder(id, {
        terminated: true,
        terminatedAt: new Date().toISOString(),
        terminatedBy: currentUser.id,
        terminatedByName: currentUser.displayName,
        terminationReason: optionalText(payload.reason),
        statusBeforeTermination: order.stage ?? order.intakeStatus,
        stageAtTermination: order.stage
      });
    });

    return this.withAttachments(updated, accountNames);
  }

  async restoreOrder(
    id: string,
    currentUser: CurrentUser
  ): Promise<ReceiverOrderDto> {
    this.ensureManager(currentUser);
    const accountNames = await loadAccountDisplayNames(this.accounts);
    const updated = await this.repository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(id);
      const order = await repository.findOrderById(id);
      if (!order) throw new HttpError(404, "order not found.");
      if (!order.terminated) return order;
      return repository.updateOrder(id, { terminated: false });
    });

    return this.withAttachments(updated, accountNames);
  }
}
