import { ATTACHMENT_VISIBILITY, ROLES } from "@sample-room/shared";
import type { OperationLogRepository } from "../../db/repositories/contracts/index.js";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { renamedDisplayFileName } from "../files/attachmentDisplayName.js";
import { attachmentForWebResponse } from "../files/attachmentDto.js";
import type { FileStorageAdapter } from "../files/fileStorageAdapter.js";
import { FileStorageNotFoundError } from "../files/fileStorageAdapter.js";
import { ensureOrderFolder } from "../patterns/orderFolderService.js";
import { lockActiveOrderForBusinessWrite } from "../orders/orderWriteBoundary.js";
import {
  ORDER_CHARGE_STATUSES,
  RECONCILIATION_STATEMENT_STATUSES,
  type OrderChargeRecord
} from "./pricingTypes.js";

type ChargePayload = {
  name?: unknown;
  amount?: unknown;
  explanation?: unknown;
  sourceScene?: unknown;
};

type ChargeAttachmentPayload = { attachments?: unknown };

function requireText(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} is required.`);
  }
  return value.trim();
}

function requireAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, "amount must be a positive number.");
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export class OrderChargeService {
  constructor(
    private readonly repository: SampleRoomRepository,
    private readonly fileStorage?: FileStorageAdapter,
    private readonly operationLogs?: OperationLogRepository
  ) {}

  private ensureCreator(currentUser: CurrentUser) {
    if (
      currentUser.role !== ROLES.receiver &&
      currentUser.role !== ROLES.planner &&
      currentUser.role !== ROLES.boss &&
      currentUser.role !== ROLES.systemOwner
    ) {
      throw new HttpError(403, "forbidden");
    }
  }

  private ensureMobileChargeRole(currentUser: CurrentUser) {
    if (currentUser.role !== ROLES.planner && currentUser.role !== ROLES.receiver) {
      throw new HttpError(403, "forbidden");
    }
  }

  private ensureManager(currentUser: CurrentUser) {
    if (currentUser.role !== ROLES.boss && currentUser.role !== ROLES.systemOwner) {
      throw new HttpError(403, "forbidden");
    }
  }

  private isManager(currentUser: CurrentUser) {
    return currentUser.role === ROLES.boss || currentUser.role === ROLES.systemOwner;
  }

  private async audit(
    action: string,
    charge: OrderChargeRecord,
    currentUser: CurrentUser,
    before?: OrderChargeRecord
  ) {
    await this.operationLogs?.appendOperationLog({
      actorId: currentUser.id,
      actorRole: currentUser.role,
      action,
      targetType: "order_charge",
      targetId: charge.id,
      ...(before ? { before: { ...before } } : {}),
      after: { ...charge }
    });
  }

  private async requireOrder(orderId: string) {
    const order = await this.repository.findOrderById(orderId);
    if (!order) throw new HttpError(404, "order not found.");
    return order;
  }

  private async requireScanOrder(token: string) {
    const scanToken = await this.repository.findOrderScanToken(token);
    const expiryTime = scanToken?.expiresAt ? Date.parse(scanToken.expiresAt) : undefined;
    const expired =
      expiryTime !== undefined && (!Number.isFinite(expiryTime) || expiryTime <= Date.now());
    if (!scanToken || scanToken.revokedAt || expired) {
      throw new HttpError(404, "scan token not found.");
    }
    const order = await this.requireOrder(scanToken.orderId);
    if (order.terminated) throw new HttpError(409, "terminated order cannot accept charges.");
    return order;
  }

  private async chargeLocked(
    orderId: string,
    repository: SampleRoomRepository = this.repository
  ) {
    const statements = await repository.listReconciliationStatements();
    return statements.some(
      (statement) =>
        statement.status !== RECONCILIATION_STATEMENT_STATUSES.returned &&
        statement.items.some((item) => item.orderId === orderId && !item.returnedAt)
    );
  }

  private async assertChargeWritable(
    orderId: string,
    repository: SampleRoomRepository = this.repository
  ) {
    if (await this.chargeLocked(orderId, repository)) {
      throw new HttpError(
        409,
        "The order is included in an active reconciliation statement and its other charges are locked."
      );
    }
  }

  private async withAttachments(
    charge: OrderChargeRecord,
    repository: SampleRoomRepository = this.repository
  ) {
    const attachments = (await repository.listOrderAttachments(charge.orderId))
      .filter((attachment) => attachment.orderChargeId === charge.id)
      .map(attachmentForWebResponse);
    return { ...charge, attachments };
  }

  private async requireCharge(
    orderId: string,
    chargeId: string,
    repository: SampleRoomRepository = this.repository
  ) {
    const charge = await repository.findOrderChargeById(chargeId);
    if (!charge || charge.orderId !== orderId || charge.archivedAt) {
      throw new HttpError(404, "order charge not found.");
    }
    return charge;
  }

  private assertEditable(charge: OrderChargeRecord, currentUser: CurrentUser) {
    if (this.isManager(currentUser)) return;
    if (
      charge.creatorId !== currentUser.id ||
      (charge.status !== ORDER_CHARGE_STATUSES.pending &&
        charge.status !== ORDER_CHARGE_STATUSES.effective)
    ) {
      throw new HttpError(403, "only the creator can edit an effective or legacy pending other charge.");
    }
  }

  private async withWritableCharge<T>(
    orderId: string,
    chargeId: string,
    operation: (
      repository: SampleRoomRepository,
      charge: OrderChargeRecord
    ) => Promise<T>
  ) {
    return this.repository.withTransaction(async (repository) => {
      await lockActiveOrderForBusinessWrite(repository, orderId);
      await this.assertChargeWritable(orderId, repository);
      const charge = await this.requireCharge(orderId, chargeId, repository);
      return operation(repository, charge);
    });
  }

  async create(orderId: string, payload: ChargePayload, currentUser: CurrentUser) {
    this.ensureCreator(currentUser);
    const managerCreated = this.isManager(currentUser);
    const createdAt = new Date().toISOString();
    const charge = await this.repository.withTransaction(async (repository) => {
      await lockActiveOrderForBusinessWrite(repository, orderId);
      await this.assertChargeWritable(orderId, repository);
      return repository.createOrderCharge({
        orderId,
        name: requireText(payload.name, "name"),
        amount: requireAmount(payload.amount),
        explanation:
          typeof payload.explanation === "string" ? payload.explanation.trim() : "",
        sourceScene:
          typeof payload.sourceScene === "string" && payload.sourceScene.trim()
            ? payload.sourceScene.trim()
            : "manual",
        creatorId: currentUser.id,
        creatorName: currentUser.displayName,
        creatorRole: currentUser.role,
        ...(managerCreated
          ? {
              status: ORDER_CHARGE_STATUSES.confirmed,
              reviewedAt: createdAt,
              reviewedBy: currentUser.id,
              reviewedByName: currentUser.displayName,
              reviewedByRole: currentUser.role
            }
          : { status: ORDER_CHARGE_STATUSES.effective })
      });
    });
    await this.audit(
      managerCreated ? "order_charge.create_and_confirm" : "order_charge.create",
      charge,
      currentUser
    );
    return this.withAttachments(charge);
  }

  async list(orderId: string, currentUser: CurrentUser) {
    this.ensureCreator(currentUser);
    await this.requireOrder(orderId);
    const charges = (await this.repository.listOrderChargesByOrderId(orderId)).filter(
      (charge) => !charge.archivedAt
    );
    const visible = this.isManager(currentUser)
      ? charges
      : charges.filter(
          (charge) =>
            charge.creatorId === currentUser.id ||
            charge.status === ORDER_CHARGE_STATUSES.confirmed ||
            charge.status === ORDER_CHARGE_STATUSES.effective
        );
    return Promise.all(visible.map((charge) => this.withAttachments(charge)));
  }

  async summary(orderId: string, currentUser: CurrentUser) {
    return {
      chargeLocked: await this.chargeLocked(orderId),
      charges: await this.list(orderId, currentUser)
    };
  }

  async update(
    orderId: string,
    chargeId: string,
    payload: ChargePayload,
    currentUser: CurrentUser
  ) {
    this.ensureCreator(currentUser);
    const coreChanged =
      payload.name !== undefined ||
      payload.amount !== undefined;
    let charge!: OrderChargeRecord;
    let managerOwnCharge = false;
    let creatorPromotesLegacyPending = false;
    const updated = await this.repository.withTransaction(async (repository) => {
      await lockActiveOrderForBusinessWrite(repository, orderId);
      await this.assertChargeWritable(orderId, repository);
      charge = await this.requireCharge(orderId, chargeId, repository);
      this.assertEditable(charge, currentUser);
      managerOwnCharge = this.isManager(currentUser) && charge.creatorId === currentUser.id;
      creatorPromotesLegacyPending =
        !this.isManager(currentUser) && charge.status === ORDER_CHARGE_STATUSES.pending;
      return repository.updateOrderCharge(chargeId, {
        ...(payload.name !== undefined ? { name: requireText(payload.name, "name") } : {}),
        ...(payload.amount !== undefined ? { amount: requireAmount(payload.amount) } : {}),
        ...(payload.explanation !== undefined
          ? { explanation: typeof payload.explanation === "string" ? payload.explanation.trim() : "" }
          : {}),
        ...(coreChanged && charge.status === ORDER_CHARGE_STATUSES.confirmed && !managerOwnCharge
          ? {
              status: ORDER_CHARGE_STATUSES.pending,
              reviewedAt: null,
              reviewedBy: null,
              reviewedByName: null,
              reviewedByRole: undefined
            }
          : {}),
        ...(coreChanged && managerOwnCharge
          ? {
              status: ORDER_CHARGE_STATUSES.confirmed,
              reviewedAt: new Date().toISOString(),
              reviewedBy: currentUser.id,
              reviewedByName: currentUser.displayName,
              reviewedByRole: currentUser.role
            }
          : {}),
        ...(creatorPromotesLegacyPending
          ? {
              status: ORDER_CHARGE_STATUSES.effective,
              reviewedAt: null,
              reviewedBy: null,
              reviewedByName: null,
              reviewedByRole: undefined
            }
          : {})
      });
    });
    await this.audit(
      coreChanged &&
      charge.status === ORDER_CHARGE_STATUSES.confirmed &&
      !managerOwnCharge
        ? "order_charge.update_and_require_reconfirmation"
        : coreChanged && managerOwnCharge
          ? "order_charge.update_and_confirm"
          : creatorPromotesLegacyPending
            ? "order_charge.update_and_activate"
        : "order_charge.update",
      updated,
      currentUser,
      charge
    );
    return this.withAttachments(updated);
  }

  async remove(orderId: string, chargeId: string, currentUser: CurrentUser) {
    this.ensureCreator(currentUser);
    let charge!: OrderChargeRecord;
    const updated = await this.repository.withTransaction(async (repository) => {
      await lockActiveOrderForBusinessWrite(repository, orderId);
      await this.assertChargeWritable(orderId, repository);
      charge = await this.requireCharge(orderId, chargeId, repository);
      this.assertEditable(charge, currentUser);
      return repository.updateOrderCharge(charge.id, {
        status: ORDER_CHARGE_STATUSES.cancelled,
        archivedAt: new Date().toISOString(),
        cancelledAt: new Date().toISOString(),
        cancelledBy: currentUser.id,
        cancelledByName: currentUser.displayName,
        cancelledByRole: currentUser.role,
        cancelReason: "deleted"
      });
    });
    await this.audit("order_charge.delete", updated, currentUser, charge);
    return updated;
  }

  async scanSummary(token: string, currentUser: CurrentUser) {
    this.ensureMobileChargeRole(currentUser);
    const order = await this.requireScanOrder(token);
    const attachments = await this.repository.listOrderAttachments(order.id);
    const thumbnail = attachments.find((item) => item.mimeType.startsWith("image/"));
    return {
      order: {
        id: order.id,
        orderNo: order.orderNo,
        styleNo: order.styleNo,
        styleName: order.styleName,
        customerName: order.customerName,
        salespersonName: order.salespersonName,
        ...(thumbnail ? { thumbnail: attachmentForWebResponse(thumbnail) } : {})
      },
      chargeLocked: await this.chargeLocked(order.id),
      charges: await this.list(order.id, currentUser)
    };
  }

  async createFromScanToken(token: string, payload: ChargePayload, currentUser: CurrentUser) {
    this.ensureMobileChargeRole(currentUser);
    const order = await this.requireScanOrder(token);
    return { orderId: order.id, charge: await this.create(order.id, payload, currentUser) };
  }

  async addAttachments(
    orderId: string,
    chargeId: string,
    payload: ChargeAttachmentPayload,
    currentUser: CurrentUser
  ) {
    this.ensureCreator(currentUser);
    const values = Array.isArray(payload.attachments) ? payload.attachments : [];
    if (values.length === 0) throw new HttpError(400, "at least one attachment is required.");
    if (!this.fileStorage) throw new HttpError(503, "file storage is not available.");
    const storedKeys: string[] = [];
    let charge!: OrderChargeRecord;
    try {
      await this.repository.withTransaction(async (repository) => {
        const order = await lockActiveOrderForBusinessWrite(repository, orderId);
        await this.assertChargeWritable(orderId, repository);
        charge = await this.requireCharge(orderId, chargeId, repository);
        if (!this.isManager(currentUser) && charge.creatorId !== currentUser.id) {
          throw new HttpError(403, "only the charge creator can add attachments.");
        }
        const folder = await ensureOrderFolder(repository, order, currentUser);
        for (const value of values) {
          if (!value || typeof value !== "object") {
            throw new HttpError(400, "attachment metadata is required.");
          }
          const input = value as Record<string, unknown>;
          const fileName = requireText(input.fileName, "fileName");
          const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : undefined;
          const temporaryPath = typeof input.temporaryPath === "string" ? input.temporaryPath : undefined;
          if (!buffer && !temporaryPath) throw new HttpError(400, "attachment file is required.");
          const contentType = typeof input.mimeType === "string" ? input.mimeType : "application/octet-stream";
          const stored = await this.fileStorage!.saveFile({
            orderId,
            folderCode: order.folderCode,
            orderFolderRelativePath: folder.relativePath,
            category: "order_charge",
            uploaderRole: currentUser.role,
            originalName: fileName,
            contentType,
            buffer,
            temporaryPath,
            checksum: typeof input.checksum === "string" ? input.checksum : undefined
          });
          storedKeys.push(stored.storageKey);
          await repository.createOrderAttachment({
            orderId,
            orderChargeId: charge.id,
            fileName: stored.originalName,
            mimeType: stored.contentType,
            size: stored.sizeBytes,
            category: "order_charge",
            uploadedBy: currentUser.id,
            uploadedByRole: currentUser.role,
            uploadedByName: currentUser.displayName,
            visibility: ATTACHMENT_VISIBILITY.internalOnly,
            storageKey: stored.storageKey,
            checksum: stored.checksum,
            sourceCategory: "sample_room_upload"
          });
        }
      });
    } catch (error) {
      await Promise.allSettled(storedKeys.map((key) => this.fileStorage!.deleteFile(key)));
      throw error;
    }
    await this.audit("order_charge.attachments.add", charge, currentUser);
    return this.withAttachments(charge);
  }

  async deleteAttachment(
    orderId: string,
    chargeId: string,
    attachmentId: string,
    currentUser: CurrentUser
  ) {
    this.ensureCreator(currentUser);
    const charge = await this.withWritableCharge(orderId, chargeId, async (repository, currentCharge) => {
      const attachment = (await repository.listOrderAttachments(orderId)).find(
        (item) => item.id === attachmentId && item.orderChargeId === chargeId
      );
      if (!attachment) throw new HttpError(404, "charge attachment not found.");
      if (!this.isManager(currentUser) && attachment.uploadedBy !== currentUser.id) {
        throw new HttpError(403, "only the original uploader can delete this attachment.");
      }
      if (attachment.storageKey && this.fileStorage) {
        try {
          await this.fileStorage.deleteFile(attachment.storageKey);
        } catch (error) {
          if (!(error instanceof FileStorageNotFoundError)) throw error;
        }
      }
      await repository.deleteOrderAttachment(orderId, attachmentId, {
        id: currentUser.id,
        name: currentUser.displayName,
        role: currentUser.role
      });
      return currentCharge;
    });
    await this.audit("order_charge.attachments.delete", charge, currentUser);
    return this.withAttachments(charge);
  }

  async renameAttachment(
    orderId: string,
    chargeId: string,
    attachmentId: string,
    payload: { displayName?: unknown },
    currentUser: CurrentUser
  ) {
    this.ensureCreator(currentUser);
    const charge = await this.withWritableCharge(orderId, chargeId, async (repository, currentCharge) => {
      const attachment = (await repository.listOrderAttachments(orderId)).find(
        (item) => item.id === attachmentId && item.orderChargeId === chargeId
      );
      if (!attachment) throw new HttpError(404, "charge attachment not found.");
      if (!this.isManager(currentUser) && attachment.uploadedBy !== currentUser.id) {
        throw new HttpError(403, "only the original uploader can rename this attachment.");
      }
      const fileName = renamedDisplayFileName(attachment.fileName, payload.displayName);
      const updated = await repository.updateOrderAttachment(orderId, attachmentId, { fileName });
      if (!updated) throw new HttpError(404, "charge attachment not found.");
      await repository.appendAttachmentAuditLog({
        orderId,
        attachmentId,
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
      return currentCharge;
    });
    await this.audit("order_charge.attachments.rename", charge, currentUser);
    return this.withAttachments(charge);
  }

  async downloadAttachment(
    orderId: string,
    chargeId: string,
    attachmentId: string,
    currentUser: CurrentUser
  ) {
    this.ensureCreator(currentUser);
    const visibleCharge = (await this.list(orderId, currentUser)).find(
      (charge) => charge.id === chargeId
    );
    if (!visibleCharge) throw new HttpError(404, "order charge not found.");
    const attachment = (await this.repository.listOrderAttachments(orderId)).find(
      (item) => item.id === attachmentId && item.orderChargeId === chargeId
    );
    if (!attachment?.storageKey || !this.fileStorage) {
      throw new HttpError(404, "charge attachment file is not available.");
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
        throw new HttpError(404, "charge attachment file is not available.");
      }
      throw error;
    }
  }

  async confirm(orderId: string, chargeId: string, currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    return this.withWritableCharge(orderId, chargeId, async (repository, charge) => {
      if (charge.status === ORDER_CHARGE_STATUSES.confirmed) return charge;
      if (
        charge.status === ORDER_CHARGE_STATUSES.rejected ||
        charge.status === ORDER_CHARGE_STATUSES.cancelled ||
        charge.status === ORDER_CHARGE_STATUSES.void
      ) {
        throw new HttpError(409, "rejected or cancelled other charge cannot be confirmed.");
      }
      const reviewed = await repository.reviewEffectiveOrderCharge(charge.id, {
        status: ORDER_CHARGE_STATUSES.confirmed,
        reviewedAt: new Date().toISOString(),
        reviewedBy: currentUser.id,
        reviewedByName: currentUser.displayName,
        reviewedByRole: currentUser.role
      });
      if (!reviewed) throw new HttpError(409, "other charge was already reviewed.");
      await this.audit("order_charge.confirm", reviewed, currentUser, charge);
      return reviewed;
    });
  }

  async reject(
    orderId: string,
    chargeId: string,
    payload: { reason?: unknown },
    currentUser: CurrentUser
  ) {
    this.ensureManager(currentUser);
    return this.withWritableCharge(orderId, chargeId, async (repository, charge) => {
      const rejected = await repository.updateOrderCharge(charge.id, {
        status: ORDER_CHARGE_STATUSES.rejected,
        rejectedAt: new Date().toISOString(),
        rejectedBy: currentUser.id,
        rejectedByName: currentUser.displayName,
        rejectedByRole: currentUser.role,
        rejectionReason: requireText(payload.reason, "reason"),
        reviewedAt: null,
        reviewedBy: null,
        reviewedByName: null
      });
      await this.audit("order_charge.reject", rejected, currentUser, charge);
      return rejected;
    });
  }

  async cancelConfirmation(
    orderId: string,
    chargeId: string,
    payload: { reason?: unknown },
    currentUser: CurrentUser
  ) {
    this.ensureManager(currentUser);
    return this.withWritableCharge(orderId, chargeId, async (repository, charge) => {
      if (charge.status !== ORDER_CHARGE_STATUSES.confirmed) {
        throw new HttpError(409, "only a confirmed other charge can be unconfirmed.");
      }
      const updated = await repository.updateOrderCharge(charge.id, {
        status: ORDER_CHARGE_STATUSES.pending,
        cancelledAt: new Date().toISOString(),
        cancelledBy: currentUser.id,
        cancelledByName: currentUser.displayName,
        cancelledByRole: currentUser.role,
        cancelReason: requireText(payload.reason, "reason"),
        reviewedAt: null,
        reviewedBy: null,
        reviewedByName: null
      });
      await this.audit("order_charge.cancel_confirmation", updated, currentUser, charge);
      return updated;
    });
  }

  // Legacy aliases remain for existing clients.
  async review(orderId: string, chargeId: string, currentUser: CurrentUser) {
    return this.confirm(orderId, chargeId, currentUser);
  }

  async void(
    orderId: string,
    chargeId: string,
    payload: { reason?: unknown },
    currentUser: CurrentUser
  ) {
    return this.withWritableCharge(orderId, chargeId, async (repository, charge) => {
      this.assertEditable(charge, currentUser);
      const updated = await repository.updateOrderCharge(charge.id, {
        status: ORDER_CHARGE_STATUSES.void,
        archivedAt: new Date().toISOString(),
        voidedAt: new Date().toISOString(),
        voidedBy: currentUser.id,
        voidedByName: currentUser.displayName,
        voidedByRole: currentUser.role,
        voidReason: this.isManager(currentUser)
          ? requireText(payload.reason, "reason")
          : "creator_void"
      });
      await this.audit("order_charge.void", updated, currentUser, charge);
      return updated;
    });
  }

  async listVoidHistory(orderId: string, currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    await this.requireOrder(orderId);
    return (await this.repository.listOrderChargesByOrderId(orderId)).filter(
      (charge) =>
        charge.status === ORDER_CHARGE_STATUSES.void ||
        charge.status === ORDER_CHARGE_STATUSES.cancelled ||
        Boolean(charge.archivedAt)
    );
  }
}
