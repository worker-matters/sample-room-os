import {
  INTAKE_STATUSES,
  ATTACHMENT_VISIBILITY,
  deriveOrderCompletionStatus,
  MATERIAL_STATUS_LABELS,
  ORDER_STAGES,
  PATTERN_STATUS_LABELS,
  ROLES
} from "@sample-room/shared";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import type { AccountRepository, OperationLogRepository } from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { canUsePlannerWorkflow } from "../auth/permissionPolicy.js";
import type { OrderAttachmentRecord, OrderPatternTaskSummary, OrderRecord } from "../orders/orderTypes.js";
import type { AttachmentDownload } from "../orders/orderService.js";
import {
  attachmentAuditLogForWebResponseWithAccountNames,
  attachmentForWebResponseWithAccountNames
} from "../files/attachmentDto.js";
import { attachmentVisibilityFromInput, normalizeAttachmentVisibility } from "../files/attachmentVisibility.js";
import { auditAttachmentVisibilityChange } from "../files/attachmentVisibilityAudit.js";
import {
  FileStorageNotFoundError,
  type FileStorageAdapter
} from "../files/fileStorageAdapter.js";
import { renamedDisplayFileName } from "../files/attachmentDisplayName.js";
import { isQcAttachmentCategory, ordinaryOrderAttachments } from "../files/qcAttachmentCategories.js";
import { createLocalFileStorageAdapter } from "../files/localFileStorageAdapter.js";
import { ensureOrderFolder } from "../patterns/orderFolderService.js";
import {
  completedPatternRequirementsFromDeliverables,
  currentOrderStageFromPatternGate
} from "../patterns/patternCompletionRules.js";
import { actionLabel, productionStageLabels } from "../scan/scanWorkflow.js";
import { measurementPhotoIds, type ScanRecord, type ScanRecordDto } from "../scan/scanTypes.js";
import type { PlannerOrderDto } from "./plannerTypes.js";
import {
  currentAccountDisplayName,
  loadAccountDisplayNames,
  type AccountDisplayNameMap
} from "../accounts/accountDisplayName.js";
import { orderStageDisplayLabel } from "../orders/orderDisplayStatus.js";
import { lockActiveOrderForBusinessWrite } from "../orders/orderWriteBoundary.js";

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requireText(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} is required.`);
  }

  return value.trim();
}

function recordTime(record: ScanRecord) {
  return new Date(record.eventTime).getTime();
}

function latestOpenStart(records: ScanRecord[]) {
  const sorted = [...records].sort((a, b) => recordTime(a) - recordTime(b));
  const lastStart = sorted.filter((record) => record.action === "start").at(-1);
  if (!lastStart) {
    return undefined;
  }

  const completedAfterStart = sorted.some(
    (record) =>
      (record.action === "complete" || record.action === "termination_complete") &&
      recordTime(record) >= recordTime(lastStart)
  );

  return completedAfterStart ? undefined : lastStart;
}

function plannerScanRecordDto(record: ScanRecord): ScanRecordDto {
  return {
    id: record.id,
    orderId: record.orderId,
    stage: record.stage,
    stageLabel: productionStageLabels[record.stage],
    orderStage: record.orderStage,
    action: record.action,
    actionLabel:
      record.action === "termination_complete" ? "终止完成" : actionLabel(record.scanAction),
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
    source: record.source
  };
}

function plannerPatternTaskDto(
  task: Awaited<ReturnType<SampleRoomRepository["findPatternTaskByOrderId"]>>,
  deliverables: Awaited<ReturnType<SampleRoomRepository["listPatternDeliverablesByOrderId"]>>,
  accountNames: AccountDisplayNameMap
): OrderPatternTaskSummary | undefined {
  if (!task) return undefined;
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
            uploadedBy: deliverable.uploadedBy,
            ...(deliverable.taskCategory ? { taskCategory: deliverable.taskCategory } : {}),
            visibility: normalizeAttachmentVisibility(deliverable.visibility),
            hasFile: Boolean(deliverable.storageKey),
            createdAt: deliverable.createdAt
          }))
        }
      : {})
  };
}

export class PlannerService {
  constructor(
    private readonly repository: SampleRoomRepository,
    private readonly accounts: AccountRepository,
    private readonly fileStorage: FileStorageAdapter = createLocalFileStorageAdapter(),
    private readonly operationLogs?: OperationLogRepository
  ) {}

  private ensurePlanner(currentUser: CurrentUser) {
    const decision = canUsePlannerWorkflow(currentUser);
    if (!decision.allowed) {
      throw new HttpError(403, "forbidden");
    }
  }

  private async plannerOrderDto(
    order: OrderRecord,
    accountNames: AccountDisplayNameMap
  ): Promise<PlannerOrderDto> {
    const [records, attachments, attachmentLogs, patternTask, deliverables, charges] = await Promise.all([
      this.repository.listScanRecordsByOrderId(order.id),
      this.repository.listOrderAttachments(order.id),
      this.repository.listAttachmentAuditLogs(order.id),
      this.repository.findPatternTaskByOrderId(order.id),
      this.repository.listPatternDeliverablesByOrderId(order.id),
      this.repository.listOrderChargesByOrderId(order.id)
    ]);
    const activeStart = latestOpenStart(records);
    const currentStage = currentOrderStageFromPatternGate({
      sampleRequestItems: order.sampleRequestItems,
      storedStage: order.stage,
      deliverables
    });
    const ordinaryAttachments = ordinaryOrderAttachments(attachments);
    const safeAttachments = ordinaryAttachments.map((attachment) =>
      attachmentForWebResponseWithAccountNames(attachment, accountNames)
    );
    const thumbnail = ordinaryAttachments.find(
      (attachment) => attachment.mimeType.startsWith("image/") && Boolean(attachment.storageKey)
    );
    const createdByName = currentAccountDisplayName(
      accountNames,
      order.createdBy,
      order.sourceType === "client_submission"
        ? order.clientUserSnapshot.displayName
        : undefined
    );

    const dto: PlannerOrderDto = {
      id: order.id,
      orderNo: order.orderNo,
      sourceType: order.sourceType,
      ...(createdByName ? { createdByName } : {}),
      customerName: order.customerName,
      salespersonName: order.salespersonName,
      styleNo: order.styleNo,
      styleName: order.styleName,
      quantity: order.quantity,
      sampleType: order.sampleType,
      sampleRound: order.sampleRound,
      deliveryDate: order.deliveryDate,
      remark: order.remark,
      terminated: order.terminated,
      terminatedAt: order.terminatedAt,
      stage: currentStage,
      stageLabel: order.terminated ? "已终止" : orderStageDisplayLabel(currentStage, records),
      patternStatus: PATTERN_STATUS_LABELS[order.patternStatus],
      fabricStatus: MATERIAL_STATUS_LABELS[order.fabricStatus],
      trimStatus: MATERIAL_STATUS_LABELS[order.trimStatus],
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      sampleRequestItems: order.sampleRequestItems,
      completionStatus: deriveOrderCompletionStatus({
        sampleRequestItems: order.sampleRequestItems,
        orderStage: currentStage,
        patternTaskStatus: patternTask?.status
      }),
      attachmentCount: safeAttachments.length,
      chargeCount: charges.filter((charge) => !charge.archivedAt).length,
      materialRecordCount: ordinaryAttachments.filter((attachment) => attachment.category === "receiver_material_record").length,
      ...(thumbnail
        ? { thumbnailUrl: `/api/planner/orders/${order.id}/attachments/${thumbnail.id}/download` }
        : {}),
      attachments: safeAttachments,
      attachmentLogs: attachmentLogs.filter((log) => !isQcAttachmentCategory(log.attachmentCategory)).map((log) =>
        attachmentAuditLogForWebResponseWithAccountNames(log, accountNames)
      ),
      ...(patternTask
        ? { patternTask: plannerPatternTaskDto(patternTask, deliverables, accountNames) }
        : {}),
      scanRecords: records.map(plannerScanRecordDto),
      activeWorker: activeStart
        ? {
            stage: activeStart.stage,
            stageLabel: productionStageLabels[activeStart.stage],
            workerName: activeStart.workerName,
            startedAt: activeStart.eventTime
          }
        : undefined
    };
    return order.terminated
      ? {
          ...dto,
          attachments: [],
          attachmentLogs: [],
          scanRecords: [],
          activeWorker: undefined,
          thumbnailUrl: undefined,
          patternTask: undefined
        }
      : dto;
  }

  async listOrders(currentUser: CurrentUser): Promise<PlannerOrderDto[]> {
    this.ensurePlanner(currentUser);

    const [allOrders, accountNames] = await Promise.all([
      this.repository.listOrders(),
      loadAccountDisplayNames(this.accounts)
    ]);
    const orders = allOrders.filter((order) => order.intakeStatus === INTAKE_STATUSES.received);
    const dtos = await Promise.all(
      orders.map((order) => this.plannerOrderDto(order, accountNames))
    );

    return dtos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async addOrderAttachments(
    orderId: string,
    payload: { attachments?: unknown },
    currentUser: CurrentUser
  ): Promise<OrderAttachmentRecord[]> {
    this.ensurePlanner(currentUser);
    const values = Array.isArray(payload.attachments) ? payload.attachments : [];
    const storedKeys: string[] = [];
    try {
      return await this.repository.withTransaction(async (repository) => {
        const order = await lockActiveOrderForBusinessWrite(repository, orderId);
        if (
          !canUsePlannerWorkflow(currentUser).allowed ||
          order.intakeStatus !== INTAKE_STATUSES.received
        ) {
          throw new HttpError(403, "forbidden");
        }
        const folder = await ensureOrderFolder(repository, order, currentUser);
        for (const value of values) {
          if (!value || typeof value !== "object") throw new HttpError(400, "attachment metadata is required.");
          const input = value as Record<string, unknown>;
          const fileName = requireText(input.fileName, "fileName");
          const mimeType = optionalText(input.mimeType) ?? "application/octet-stream";
          const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : undefined;
          const temporaryPath = typeof input.temporaryPath === "string" ? input.temporaryPath : undefined;
          let stored: Awaited<ReturnType<FileStorageAdapter["saveFile"]>> | undefined;
          if (buffer || temporaryPath) {
            stored = await this.fileStorage.saveFile({
              orderId: order.id,
              folderCode: order.folderCode,
              orderFolderRelativePath: folder.relativePath,
              category: "planner_upload",
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
            category: "planner_upload",
            uploadedBy: currentUser.id,
            uploadedByRole: currentUser.role,
            uploadedByName: currentUser.displayName,
            visibility: attachmentVisibilityFromInput(
              typeof input.visibility === "string" ? input.visibility : undefined,
              ATTACHMENT_VISIBILITY.internalOnly
            ),
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
      await Promise.allSettled(storedKeys.map((key) => this.fileStorage.deleteFile(key)));
      throw error;
    }
  }

  async listOrderAttachments(
    orderId: string,
    currentUser: CurrentUser
  ): Promise<OrderAttachmentRecord[]> {
    const order = await this.requirePlannerOrder(orderId, currentUser);
    const [attachments, accountNames] = await Promise.all([
      this.repository.listOrderAttachments(order.id),
      loadAccountDisplayNames(this.accounts)
    ]);
    return ordinaryOrderAttachments(attachments).map((attachment) =>
      attachmentForWebResponseWithAccountNames(attachment, accountNames)
    );
  }

  async deleteOrderAttachment(
    orderId: string,
    attachmentId: string,
    currentUser: CurrentUser
  ): Promise<OrderAttachmentRecord[]> {
    this.ensurePlanner(currentUser);
    await this.repository.withTransaction(async (repository) => {
      const order = await lockActiveOrderForBusinessWrite(repository, orderId);
      if (order.intakeStatus !== INTAKE_STATUSES.received) throw new HttpError(404, "order not found.");
      const attachment = ordinaryOrderAttachments(await repository.listOrderAttachments(order.id)).find((item) => item.id === attachmentId);
      if (!attachment || attachment.uploadedBy !== currentUser.id) {
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
        id: currentUser.id,
        name: currentUser.displayName,
        role: currentUser.role
      });
    });
    const [remainingAttachments, accountNames] = await Promise.all([
      this.repository.listOrderAttachments(orderId),
      loadAccountDisplayNames(this.accounts)
    ]);
    return ordinaryOrderAttachments(remainingAttachments).map((attachment) =>
      attachmentForWebResponseWithAccountNames(attachment, accountNames)
    );
  }

  async renameOrderAttachment(
    orderId: string,
    attachmentId: string,
    payload: { displayName?: unknown },
    currentUser: CurrentUser
  ): Promise<OrderAttachmentRecord[]> {
    this.ensurePlanner(currentUser);
    await this.repository.withTransaction(async (repository) => {
      const order = await lockActiveOrderForBusinessWrite(repository, orderId);
      if (order.intakeStatus !== INTAKE_STATUSES.received) throw new HttpError(404, "order not found.");
      const attachment = ordinaryOrderAttachments(await repository.listOrderAttachments(order.id)).find(
        (item) => item.id === attachmentId
      );
      if (!attachment) throw new HttpError(404, "attachment not found.");
      if (attachment.uploadedBy !== currentUser.id) {
        throw new HttpError(403, "only the original uploader can rename this attachment.");
      }
      const fileName = renamedDisplayFileName(attachment.fileName, payload.displayName);
      const updated = await repository.updateOrderAttachment(order.id, attachment.id, { fileName });
      if (!updated) throw new HttpError(404, "attachment not found.");
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
    });
    const [updatedAttachments, accountNames] = await Promise.all([
      this.repository.listOrderAttachments(orderId),
      loadAccountDisplayNames(this.accounts)
    ]);
    return ordinaryOrderAttachments(updatedAttachments).map((attachment) =>
      attachmentForWebResponseWithAccountNames(attachment, accountNames)
    );
  }

  async changeOrderAttachmentVisibility(
    orderId: string,
    attachmentId: string,
    payload: { visibility?: unknown },
    currentUser: CurrentUser
  ): Promise<OrderAttachmentRecord[]> {
    const visibility = attachmentVisibilityFromInput(
      typeof payload.visibility === "string" ? payload.visibility : undefined,
      ATTACHMENT_VISIBILITY.internalOnly
    );
    this.ensurePlanner(currentUser);
    await this.repository.withTransaction(async (repository) => {
      const order = await lockActiveOrderForBusinessWrite(repository, orderId);
      if (order.intakeStatus !== INTAKE_STATUSES.received) throw new HttpError(404, "order not found.");
      const attachment = ordinaryOrderAttachments(await repository.listOrderAttachments(order.id)).find(
        (item) => item.id === attachmentId
      );
      if (!attachment) throw new HttpError(404, "attachment not found.");
      if (attachment.uploadedBy !== currentUser.id) {
        throw new HttpError(403, "attachment_operation_forbidden");
      }
      const updated = await repository.updateOrderAttachment(order.id, attachment.id, { visibility });
      if (!updated) throw new HttpError(404, "attachment not found.");
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
    });
    const [updatedAttachments, accountNames] = await Promise.all([
      this.repository.listOrderAttachments(orderId),
      loadAccountDisplayNames(this.accounts)
    ]);
    return ordinaryOrderAttachments(updatedAttachments).map((item) =>
      attachmentForWebResponseWithAccountNames(item, accountNames)
    );
  }

  private async requirePlannerOrder(orderId: string, currentUser: CurrentUser) {
    this.ensurePlanner(currentUser);
    const order = await this.repository.findOrderById(orderId);
    if (!order || order.intakeStatus !== INTAKE_STATUSES.received) {
      throw new HttpError(404, "order not found.");
    }
    if (order.terminated) throw new HttpError(409, "订单已终止");
    return order;
  }

  async downloadOrderAttachment(
    orderId: string,
    attachmentId: string,
    currentUser: CurrentUser
  ): Promise<AttachmentDownload> {
    const order = await this.requirePlannerOrder(orderId, currentUser);
    const attachment = ordinaryOrderAttachments(await this.repository.listOrderAttachments(order.id)).find(
      (item) => item.id === attachmentId
    );
    if (!attachment?.storageKey) throw new HttpError(404, "attachment not found.");
    try {
      const content = await this.fileStorage.readFile(attachment.storageKey);
      return {
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        content
      };
    } catch (error) {
      if (error instanceof FileStorageNotFoundError) {
        throw new HttpError(404, "attachment not found.");
      }
      throw error;
    }
  }

  async downloadPatternDeliverable(
    orderId: string,
    deliverableId: string,
    currentUser: CurrentUser
  ): Promise<AttachmentDownload> {
    const order = await this.requirePlannerOrder(orderId, currentUser);
    const deliverable = (await this.repository.listPatternDeliverablesByOrderId(order.id)).find(
      (item) => item.id === deliverableId
    );
    if (!deliverable?.storageKey || !deliverable.fileName) {
      throw new HttpError(404, "pattern deliverable not found.");
    }
    try {
      const content = await this.fileStorage.readFile(deliverable.storageKey);
      return {
        fileName: deliverable.fileName,
        mimeType: deliverable.mimeType ?? "application/octet-stream",
        size: deliverable.size ?? content.length,
        content
      };
    } catch (error) {
      if (error instanceof FileStorageNotFoundError) {
        throw new HttpError(404, "pattern deliverable not found.");
      }
      throw error;
    }
  }

}
