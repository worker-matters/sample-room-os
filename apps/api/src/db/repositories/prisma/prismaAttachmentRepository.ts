import type { Prisma } from "@prisma/client";
import type { AttachmentRepository } from "../contracts/index.js";
import type {
  AttachmentAuditLogCreateInput,
  AttachmentAuditLogRecord,
  OrderAttachmentCreateInput,
  OrderAttachmentRecord,
  OrderAttachmentUpdateInput
} from "../../../modules/orders/orderTypes.js";
import type { SampleRoomPrismaClient } from "./prismaClient.js";
import { mapAttachment, mapAttachmentAuditLog } from "./prismaMappers.js";
import { isClientRole } from "@sample-room/shared";

export class PrismaAttachmentRepository implements AttachmentRepository {
  constructor(private readonly prisma: SampleRoomPrismaClient) {}

  async createOrderAttachment(input: OrderAttachmentCreateInput): Promise<OrderAttachmentRecord> {
    const data: Prisma.OrderAttachmentUncheckedCreateInput = {
      orderId: input.orderId,
      fileName: input.fileName,
      contentType: input.mimeType,
      sizeBytes: input.size,
      storageKey: input.storageKey ?? null,
      checksum: input.checksum ?? null,
      category: input.category,
      uploadedBy: input.uploadedBy,
      uploadedByRole: input.uploadedByRole,
      uploadedByName: input.uploadedByName ?? null,
      patternTaskId: input.patternTaskId ?? null,
      patternTaskCategory: input.patternTaskCategory ?? null,
      orderChargeId: input.orderChargeId ?? null,
      visibility: input.visibility
    };

    const attachment = await this.prisma.orderAttachment.create({ data });
    await this.appendAttachmentAuditLog({
      orderId: attachment.orderId,
      attachmentId: attachment.id,
      originalFileName: attachment.fileName,
      action: "upload",
      actorId: input.uploadedBy,
      actorName: input.uploadedByName,
      actorRole: input.uploadedByRole,
      originalUploaderId: input.uploadedBy,
      originalUploaderName: input.uploadedByName,
      originalUploaderRole: input.uploadedByRole,
      attachmentCategory: input.category,
      sourceCategory: input.sourceCategory ?? (
        isClientRole(input.uploadedByRole)
          ? "client_upload"
          : input.uploadedByRole === "pattern_maker"
            ? "pattern_maker_upload"
            : "sample_room_upload"
      ),
      patternTaskId: input.patternTaskId,
      patternTaskCategory: input.patternTaskCategory,
      orderChargeId: input.orderChargeId
    });
    return mapAttachment(attachment);
  }

  async listOrderAttachments(orderId: string): Promise<OrderAttachmentRecord[]> {
    const attachments = await this.prisma.orderAttachment.findMany({
      where: { orderId },
      orderBy: {
        createdAt: "asc"
      }
    });

    return attachments.map(mapAttachment);
  }

  async appendAttachmentAuditLog(input: AttachmentAuditLogCreateInput): Promise<AttachmentAuditLogRecord> {
    return mapAttachmentAuditLog(await this.prisma.attachmentAuditLog.create({
      data: {
        orderId: input.orderId,
        attachmentId: input.attachmentId,
        originalFileName: input.originalFileName,
        newFileName: input.newFileName ?? null,
        action: input.action,
        actorId: input.actorId,
        actorName: input.actorName ?? null,
        actorRole: input.actorRole,
        originalUploaderId: input.originalUploaderId,
        originalUploaderName: input.originalUploaderName ?? null,
        originalUploaderRole: input.originalUploaderRole,
        attachmentCategory: input.attachmentCategory,
        sourceCategory: input.sourceCategory ?? null,
        patternTaskId: input.patternTaskId ?? null,
        patternTaskCategory: input.patternTaskCategory ?? null,
        orderChargeId: input.orderChargeId ?? null
      }
    }));
  }

  async listAttachmentAuditLogs(orderId: string): Promise<AttachmentAuditLogRecord[]> {
    return (await this.prisma.attachmentAuditLog.findMany({
      where: { orderId },
      orderBy: { createdAt: "desc" }
    })).map(mapAttachmentAuditLog);
  }

  async updateOrderAttachment(
    orderId: string,
    attachmentId: string,
    input: OrderAttachmentUpdateInput
  ): Promise<OrderAttachmentRecord | undefined> {
    const attachment = await this.prisma.orderAttachment.findFirst({
      where: {
        id: attachmentId,
        orderId
      }
    });
    if (!attachment) {
      return undefined;
    }

    const data: Prisma.OrderAttachmentUncheckedUpdateInput = {};
    if (input.fileName !== undefined) data.fileName = input.fileName;
    if (input.category !== undefined) data.category = input.category;
    if (input.visibility !== undefined) data.visibility = input.visibility;
    if (input.storageKey !== undefined) data.storageKey = input.storageKey;

    const updated = await this.prisma.orderAttachment.update({
      where: { id: attachment.id },
      data
    });
    return mapAttachment(updated);
  }

  async deleteOrderAttachment(
    orderId: string,
    attachmentId: string,
    actor?: { id: string; name?: string | undefined; role: OrderAttachmentRecord["uploadedByRole"] }
  ): Promise<OrderAttachmentRecord | undefined> {
    const attachment = await this.prisma.orderAttachment.findFirst({
      where: {
        id: attachmentId,
        orderId
      }
    });
    if (!attachment) {
      return undefined;
    }

    if (actor) {
      await this.appendAttachmentAuditLog({
        orderId,
        attachmentId: attachment.id,
        originalFileName: attachment.fileName,
        action: "delete",
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        originalUploaderId: attachment.uploadedBy ?? "",
        originalUploaderName: attachment.uploadedByName ?? undefined,
        originalUploaderRole: (attachment.uploadedByRole ?? actor.role) as OrderAttachmentRecord["uploadedByRole"],
        attachmentCategory: attachment.category,
        patternTaskId: attachment.patternTaskId ?? undefined,
        patternTaskCategory: attachment.patternTaskCategory ?? undefined,
        orderChargeId: attachment.orderChargeId ?? undefined
      });
    }
    await this.prisma.orderAttachment.delete({ where: { id: attachment.id } });
    return mapAttachment(attachment);
  }
}
