import {
  ATTACHMENT_VISIBILITY,
  ORDER_STAGES,
  ROLES
} from "@sample-room/shared";
import type {
  AccountRepository,
  WorkerProfileRepository
} from "../../db/repositories/contracts/index.js";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { attachmentForWebResponse } from "../files/attachmentDto.js";
import { renamedDisplayFileName } from "../files/attachmentDisplayName.js";
import {
  FileStorageNotFoundError,
  type FileStorageAdapter
} from "../files/fileStorageAdapter.js";
import { attachmentVisibilityFromInput } from "../files/attachmentVisibility.js";
import { isQcAttachmentCategory, type QcAttachmentCategory } from "../files/qcAttachmentCategories.js";
import { ensureOrderFolder } from "../patterns/orderFolderService.js";
import type { PerformanceService } from "../pricing/performanceService.js";
import { ScanActorResolver, type WorkerScanActor } from "../scan/scanActor.js";
import type { CompleteScanPayload } from "../scan/scanService.js";
import type { ScanWorkflowService } from "../scan/scanService.js";
import type { ScanRecord } from "../scan/scanTypes.js";
import type { AttachmentDownload } from "../orders/orderService.js";
import type { OrderAttachmentRecord, OrderRecord } from "../orders/orderTypes.js";
import { lockActiveOrderForBusinessWrite } from "../orders/orderWriteBoundary.js";
import type {
  QcOrderDetail,
  QcOrderFilters,
  QcOrderListItem,
  QcOrderListResponse
} from "./qcTabletTypes.js";

type UploadedPhoto = {
  fileName: string;
  mimeType: string;
  size: number;
  category?: string | undefined;
  visibility?: string | undefined;
  buffer?: Buffer | undefined;
  temporaryPath?: string | undefined;
  checksum?: string | undefined;
};

function normalQcRecords(records: readonly ScanRecord[]) {
  return records
    .filter((record) => record.stage === "qc_delivery" && record.action === "complete")
    .sort((left, right) => left.eventTime.localeCompare(right.eventTime));
}

function dateMatches(value: string, filters: QcOrderFilters) {
  const date = value.slice(0, 10);
  return (!filters.dateFrom || date >= filters.dateFrom) && (!filters.dateTo || date <= filters.dateTo);
}

function textFilter(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export class QcTabletService {
  private readonly scanActors: ScanActorResolver;

  constructor(
    private readonly repository: SampleRoomRepository,
    accounts: AccountRepository,
    workerProfiles: WorkerProfileRepository,
    private readonly fileStorage: FileStorageAdapter,
    private readonly scanWorkflow: ScanWorkflowService,
    private readonly performance: PerformanceService
  ) {
    this.scanActors = new ScanActorResolver(accounts, workerProfiles);
  }

  private async qcWorker(currentUser: CurrentUser): Promise<WorkerScanActor> {
    if (
      currentUser.role !== ROLES.worker ||
      currentUser.accountType !== "worker" ||
      currentUser.activeWorkerType !== "qc_delivery" ||
      !currentUser.activeWorkerProfileId
    ) {
      throw new HttpError(403, "QC_DELIVERY_WORKER_REQUIRED");
    }
    const actor = await this.scanActors.requireWorkerActor(currentUser);
    if (
      actor.workerProfile.workerType !== "qc_delivery" ||
      actor.workerProfile.id !== currentUser.activeWorkerProfileId
    ) {
      throw new HttpError(403, "QC_DELIVERY_WORKER_REQUIRED");
    }
    return actor;
  }

  private async ownedOrders(currentUser: CurrentUser) {
    const actor = await this.qcWorker(currentUser);
    const rows = await Promise.all(
      (await this.repository.listOrders())
        .filter((order) => !order.terminated)
        .map(async (order) => ({
          order,
          records: normalQcRecords(await this.repository.listScanRecordsByOrderId(order.id))
        }))
    );
    return { actor, rows: rows.filter(({ records }) => records.some((record) => record.workerProfileId === actor.workerProfile.id)) };
  }

  private item(order: OrderRecord, record: ScanRecord): QcOrderListItem {
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      styleNo: order.styleNo,
      styleName: order.styleName,
      sampleType: order.sampleType,
      sampleRound: order.sampleRound,
      quantity: order.quantity,
      customerId: order.customerId,
      customerName: order.customerName,
      clientUserId: order.clientUserId,
      salespersonName: order.salespersonName,
      eventTime: record.eventTime,
      qualityResult: record.qualityResult === "rework" ? "rework" : "qualified",
      ...(record.qualityScore !== undefined ? { qualityScore: record.qualityScore } : {}),
      ...(record.note ? { note: record.note } : {}),
      ...(record.pieces !== undefined ? { pieces: record.pieces } : {}),
      ...(record.workerName ? { workerName: record.workerName } : {}),
      ...(order.remark ? { remark: order.remark } : {}),
      ...(order.taskInstructionNote ? { taskInstructionNote: order.taskInstructionNote } : {}),
      thumbnailUrl: `/api/qc/me/orders/${encodeURIComponent(order.id)}/thumbnail`
    };
  }

  private filteredResponse(
    rows: Array<{ order: OrderRecord; record: ScanRecord }>,
    filters: QcOrderFilters
  ): QcOrderListResponse {
    const filterOptions = {
      customers: [...new Map(rows.map(({ order }) => [order.customerId, { id: order.customerId, name: order.customerName }])).values()],
      salespersons: [...new Map(rows.map(({ order }) => [order.clientUserId, { id: order.clientUserId, name: order.salespersonName }])).values()]
    };
    const q = textFilter(filters.q)?.toLocaleLowerCase();
    const orders = rows.filter(({ order, record }) =>
      (!q || `${order.styleNo} ${order.styleName}`.toLocaleLowerCase().includes(q)) &&
      (!filters.customerId || order.customerId === filters.customerId) &&
      (!filters.clientUserId || order.clientUserId === filters.clientUserId) &&
      dateMatches(record.eventTime, filters)
    ).map(({ order, record }) => this.item(order, record))
      .sort((left, right) => right.eventTime.localeCompare(left.eventTime));
    return { orders, filterOptions };
  }

  async listReworkOrders(filters: QcOrderFilters, currentUser: CurrentUser) {
    const { actor, rows } = await this.ownedOrders(currentUser);
    return this.filteredResponse(rows.flatMap(({ order, records }) => {
      const latest = records.at(-1);
      return order.stage === ORDER_STAGES.qcDeliveryWaiting &&
        latest?.qualityResult === "rework" &&
        latest.workerProfileId === actor.workerProfile.id
        ? [{ order, record: latest }]
        : [];
    }), filters);
  }

  async listCompletedOrders(filters: QcOrderFilters, currentUser: CurrentUser) {
    const { actor, rows } = await this.ownedOrders(currentUser);
    return this.filteredResponse(rows.flatMap(({ order, records }) => {
      const latest = records.at(-1);
      return order.stage === ORDER_STAGES.done &&
        latest?.qualityResult === "qualified" &&
        latest.workerProfileId === actor.workerProfile.id
        ? [{ order, record: latest }]
        : [];
    }), filters);
  }

  private async ownedOrder(orderId: string, currentUser: CurrentUser) {
    const actor = await this.qcWorker(currentUser);
    const order = await this.repository.findOrderById(orderId);
    if (!order) throw new HttpError(404, "order not found.");
    if (order.terminated) throw new HttpError(409, "订单已终止，无法继续操作。");
    const records = normalQcRecords(await this.repository.listScanRecordsByOrderId(order.id));
    if (!records.some((record) => record.workerProfileId === actor.workerProfile.id)) {
      throw new HttpError(403, "QC_ORDER_NOT_OWNED");
    }
    return { actor, order, records };
  }

  private async ownPhotos(orderId: string, actor: WorkerScanActor) {
    return (await this.repository.listOrderAttachments(orderId))
      .filter((attachment) => isQcAttachmentCategory(attachment.category) && attachment.uploadedBy === actor.workerProfile.id)
      .map(attachmentForWebResponse);
  }

  async getOrder(orderId: string, currentUser: CurrentUser): Promise<QcOrderDetail> {
    const { actor, order, records } = await this.ownedOrder(orderId, currentUser);
    const latest = records.at(-1)!;
    const reworkPhotoIds = new Set(
      records
        .filter((record) => record.qualityResult === "rework")
        .flatMap((record) => record.samplePhotoAttachmentIds ?? [])
    );
    const attachments = (await this.ownPhotos(order.id, actor)).map((attachment) => ({
      ...attachment,
      ...(reworkPhotoIds.has(attachment.id) ? { category: "qc_issue_photo" as const } : {}),
      canRename: true,
      canDelete: true
    }));
    const latestRework = [...records].reverse().find((record) => record.qualityResult === "rework");
    const photoIds = new Set(latestRework?.samplePhotoAttachmentIds ?? []);
    return {
      ...this.item(order, latest),
      state: await this.scanWorkflow.getQcOrderState(order.id, currentUser),
      attachments,
      ...(latestRework ? {
        latestRework: {
          ...(latestRework.note ? { note: latestRework.note } : {}),
          eventTime: latestRework.eventTime,
          ...(latestRework.workerName ? { workerName: latestRework.workerName } : {}),
          photos: attachments.filter((attachment) => photoIds.has(attachment.id)).map((attachment) => (
            attachment.category === "qc_sample_photo"
              ? { ...attachment, category: "qc_issue_photo" }
              : attachment
          ))
        }
      } : {})
    };
  }

  async reinspect(orderId: string, payload: CompleteScanPayload, currentUser: CurrentUser) {
    await this.ownedOrder(orderId, currentUser);
    return this.scanWorkflow.completeQcOrder(orderId, currentUser, payload);
  }

  private normalizePhotos(payload: unknown): UploadedPhoto[] {
    if (!payload || typeof payload !== "object" || !("attachments" in payload) || !Array.isArray(payload.attachments)) {
      throw new HttpError(400, "attachments are required.");
    }
    return payload.attachments.map((value) => {
      if (!value || typeof value !== "object") throw new HttpError(400, "invalid attachment.");
      const item = value as Record<string, unknown>;
      if (typeof item.fileName !== "string" || typeof item.mimeType !== "string" || typeof item.size !== "number") {
        throw new HttpError(400, "invalid attachment.");
      }
      if (!item.mimeType.startsWith("image/")) throw new HttpError(400, "QC photos must be images.");
      const category: QcAttachmentCategory =
        item.category === "qc_issue_photo" || item.category === "qc_measurement_photo"
          ? item.category
          : "qc_sample_photo";
      const visibility = attachmentVisibilityFromInput(
        typeof item.visibility === "string" ? item.visibility : undefined,
        ATTACHMENT_VISIBILITY.internalOnly
      );
      return {
        fileName: item.fileName,
        mimeType: item.mimeType,
        size: item.size,
        category,
        visibility,
        ...(Buffer.isBuffer(item.buffer) ? { buffer: item.buffer } : {}),
        ...(typeof item.temporaryPath === "string" ? { temporaryPath: item.temporaryPath } : {}),
        ...(typeof item.checksum === "string" ? { checksum: item.checksum } : {})
      };
    });
  }

  async addPhotos(orderId: string, payload: unknown, currentUser: CurrentUser) {
    const actor = await this.qcWorker(currentUser);
    const photos = this.normalizePhotos(payload);
    if (photos.length === 0) throw new HttpError(400, "at least one photo is required.");
    const storedKeys: string[] = [];
    try {
      await this.repository.withTransaction(async (repository) => {
        const order = await lockActiveOrderForBusinessWrite(repository, orderId);
        const records = normalQcRecords(
          await repository.listScanRecordsByOrderId(order.id)
        );
        if (!records.some((record) => record.workerProfileId === actor.workerProfile.id)) {
          throw new HttpError(403, "QC_ORDER_NOT_OWNED");
        }
        const folder = await ensureOrderFolder(repository, order, actor.workerProfile.id);
        for (const photo of photos) {
          const stored = await this.fileStorage.saveFile({
            orderId: order.id,
            folderCode: order.folderCode,
            orderFolderRelativePath: folder.relativePath,
            category: photo.category,
            uploaderRole: ROLES.worker,
            originalName: photo.fileName,
            contentType: photo.mimeType,
            buffer: photo.buffer,
            temporaryPath: photo.temporaryPath,
            checksum: photo.checksum
          });
          storedKeys.push(stored.storageKey);
          await repository.createOrderAttachment({
            orderId: order.id,
            fileName: stored.originalName,
            mimeType: stored.contentType,
            size: stored.sizeBytes,
            category: photo.category!,
            uploadedBy: actor.workerProfile.id,
            uploadedByRole: ROLES.worker,
            uploadedByName: actor.account.displayName,
            visibility: photo.visibility as "internal_only" | "client_visible",
            storageKey: stored.storageKey,
            checksum: stored.checksum
          });
        }
      });
    } catch (error) {
      await Promise.allSettled(storedKeys.map((storageKey) => this.fileStorage.deleteFile(storageKey)));
      throw error;
    }
    return this.ownPhotos(orderId, actor);
  }

  private async ownPhoto(orderId: string, attachmentId: string, currentUser: CurrentUser) {
    const { actor, order } = await this.ownedOrder(orderId, currentUser);
    const attachment = (await this.repository.listOrderAttachments(order.id)).find((item) => item.id === attachmentId);
    if (!attachment || !isQcAttachmentCategory(attachment.category)) throw new HttpError(404, "attachment not found.");
    if (attachment.uploadedBy !== actor.workerProfile.id) throw new HttpError(403, "attachment_operation_forbidden");
    return { actor, order, attachment };
  }

  async updatePhoto(orderId: string, attachmentId: string, payload: { displayName?: unknown; visibility?: unknown; category?: unknown }, currentUser: CurrentUser) {
    const actor = await this.qcWorker(currentUser);
    return this.repository.withTransaction(async (repository) => {
      const order = await lockActiveOrderForBusinessWrite(repository, orderId);
      const records = normalQcRecords(await repository.listScanRecordsByOrderId(order.id));
      if (!records.some((record) => record.workerProfileId === actor.workerProfile.id)) {
        throw new HttpError(403, "QC_ORDER_NOT_OWNED");
      }
      const attachment = (await repository.listOrderAttachments(order.id)).find(
        (item) => item.id === attachmentId
      );
      if (!attachment || !isQcAttachmentCategory(attachment.category)) {
        throw new HttpError(404, "attachment not found.");
      }
      if (attachment.uploadedBy !== actor.workerProfile.id) {
        throw new HttpError(403, "attachment_operation_forbidden");
      }
      const patch: Partial<Pick<OrderAttachmentRecord, "fileName" | "visibility" | "category">> = {};
      if (payload.displayName !== undefined) patch.fileName = renamedDisplayFileName(attachment.fileName, payload.displayName);
      if (payload.visibility !== undefined) patch.visibility = attachmentVisibilityFromInput(
        typeof payload.visibility === "string" ? payload.visibility : undefined,
        ATTACHMENT_VISIBILITY.internalOnly
      );
      if (payload.category !== undefined) {
        if (typeof payload.category !== "string" || !isQcAttachmentCategory(payload.category)) {
          throw new HttpError(400, "invalid QC photo category.");
        }
        patch.category = payload.category;
      }
      if (!patch.fileName && !patch.visibility && !patch.category) throw new HttpError(400, "displayName, visibility, or category is required.");
      const updated = await repository.updateOrderAttachment(order.id, attachment.id, patch);
      if (!updated) throw new HttpError(404, "attachment not found.");
      if (patch.fileName && patch.fileName !== attachment.fileName) {
        await repository.appendAttachmentAuditLog({
          orderId: order.id,
          attachmentId: attachment.id,
          originalFileName: attachment.fileName,
          newFileName: patch.fileName,
          action: "rename",
          actorId: actor.workerProfile.id,
          actorName: actor.account.displayName,
          actorRole: ROLES.worker,
          originalUploaderId: attachment.uploadedBy,
          originalUploaderName: attachment.uploadedByName,
          originalUploaderRole: attachment.uploadedByRole,
          attachmentCategory: attachment.category,
          sourceCategory: attachment.sourceCategory
        });
      }
      if (patch.visibility && patch.visibility !== attachment.visibility) {
        await repository.appendAttachmentAuditLog({
          orderId: order.id,
          attachmentId: attachment.id,
          originalFileName: updated.fileName,
          action: "visibility_change",
          actorId: actor.workerProfile.id,
          actorName: actor.account.displayName,
          actorRole: ROLES.worker,
          originalUploaderId: attachment.uploadedBy,
          originalUploaderName: attachment.uploadedByName,
          originalUploaderRole: attachment.uploadedByRole,
          attachmentCategory: attachment.category,
          sourceCategory: attachment.sourceCategory
        });
      }
      return (await repository.listOrderAttachments(order.id))
        .filter((item) => isQcAttachmentCategory(item.category) && item.uploadedBy === actor.workerProfile.id)
        .map(attachmentForWebResponse);
    });
  }

  async deletePhoto(orderId: string, attachmentId: string, currentUser: CurrentUser) {
    const actor = await this.qcWorker(currentUser);
    return this.repository.withTransaction(async (repository) => {
      const order = await lockActiveOrderForBusinessWrite(repository, orderId);
      const records = normalQcRecords(await repository.listScanRecordsByOrderId(order.id));
      if (!records.some((record) => record.workerProfileId === actor.workerProfile.id)) {
        throw new HttpError(403, "QC_ORDER_NOT_OWNED");
      }
      const attachment = (await repository.listOrderAttachments(order.id)).find(
        (item) => item.id === attachmentId
      );
      if (!attachment || !isQcAttachmentCategory(attachment.category)) {
        throw new HttpError(404, "attachment not found.");
      }
      if (attachment.uploadedBy !== actor.workerProfile.id) {
        throw new HttpError(403, "attachment_operation_forbidden");
      }
      if (attachment.storageKey) {
        try { await this.fileStorage.deleteFile(attachment.storageKey); }
        catch (error) { if (!(error instanceof FileStorageNotFoundError)) throw error; }
      }
      await repository.deleteOrderAttachment(order.id, attachment.id, {
        id: actor.workerProfile.id,
        name: actor.account.displayName,
        role: ROLES.worker
      });
      return (await repository.listOrderAttachments(order.id))
        .filter((item) => isQcAttachmentCategory(item.category) && item.uploadedBy === actor.workerProfile.id)
        .map(attachmentForWebResponse);
    });
  }

  async downloadPhoto(orderId: string, attachmentId: string, currentUser: CurrentUser): Promise<AttachmentDownload> {
    const { attachment } = await this.ownPhoto(orderId, attachmentId, currentUser);
    if (!attachment.storageKey) throw new HttpError(404, "attachment file is not available.");
    try {
      return { fileName: attachment.fileName, mimeType: attachment.mimeType, size: attachment.size, content: await this.fileStorage.readFile(attachment.storageKey) };
    } catch (error) {
      if (error instanceof FileStorageNotFoundError) throw new HttpError(404, "attachment file is not available.");
      throw error;
    }
  }

  async thumbnail(orderId: string, currentUser: CurrentUser): Promise<AttachmentDownload> {
    const { order } = await this.ownedOrder(orderId, currentUser);
    const attachments = await this.repository.listOrderAttachments(order.id);
    const attachment = attachments.find((item) =>
      ["style_thumbnail", "receiver_quick_photo", "client_quick_photo", "client_reference"].includes(item.category) &&
      item.mimeType.startsWith("image/") && item.storageKey
    ) ?? attachments.find((item) =>
      !isQcAttachmentCategory(item.category) &&
      item.category !== "order_charge" &&
      !item.orderChargeId &&
      item.mimeType.startsWith("image/") &&
      item.storageKey
    );
    if (!attachment?.storageKey) throw new HttpError(404, "thumbnail not found.");
    return { fileName: attachment.fileName, mimeType: attachment.mimeType, size: attachment.size, content: await this.fileStorage.readFile(attachment.storageKey) };
  }

  async ownPerformance(filters: QcOrderFilters, currentUser: CurrentUser) {
    const actor = await this.qcWorker(currentUser);
    return this.performance.getOwnWorkerReport({
      ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
      ...(filters.dateTo ? { dateTo: filters.dateTo } : {})
    }, {
      ...currentUser,
      activeWorkerProfileId: actor.workerProfile.id,
      activeWorkerType: "qc_delivery"
    });
  }
}
