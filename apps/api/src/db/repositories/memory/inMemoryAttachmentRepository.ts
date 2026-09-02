import type { AttachmentRepository } from "../contracts/index.js";
import type {
  AttachmentAuditLogCreateInput,
  AttachmentAuditLogRecord,
  OrderAttachmentCreateInput,
  OrderAttachmentRecord,
  OrderAttachmentUpdateInput
} from "../../../modules/orders/orderTypes.js";
import type { InMemorySampleRoomStore } from "./inMemoryStore.js";

export class InMemoryAttachmentRepository implements AttachmentRepository {
  constructor(private readonly store: InMemorySampleRoomStore) {}

  async createOrderAttachment(
    input: OrderAttachmentCreateInput
  ): Promise<OrderAttachmentRecord> {
    return this.store.createOrderAttachment(input);
  }

  async listOrderAttachments(orderId: string): Promise<OrderAttachmentRecord[]> {
    return this.store.listOrderAttachments(orderId);
  }

  async appendAttachmentAuditLog(input: AttachmentAuditLogCreateInput): Promise<AttachmentAuditLogRecord> {
    return this.store.appendAttachmentAuditLog(input);
  }

  async listAttachmentAuditLogs(orderId: string): Promise<AttachmentAuditLogRecord[]> {
    return this.store.listAttachmentAuditLogs(orderId);
  }

  async updateOrderAttachment(
    orderId: string,
    attachmentId: string,
    input: OrderAttachmentUpdateInput
  ): Promise<OrderAttachmentRecord | undefined> {
    return this.store.updateOrderAttachment(orderId, attachmentId, input);
  }

  async deleteOrderAttachment(
    orderId: string,
    attachmentId: string,
    actor?: { id: string; name?: string | undefined; role: OrderAttachmentRecord["uploadedByRole"] }
  ): Promise<OrderAttachmentRecord | undefined> {
    return this.store.deleteOrderAttachment(orderId, attachmentId, actor);
  }
}
