import type {
  AttachmentAuditLogCreateInput,
  AttachmentAuditLogRecord,
  OrderAttachmentCreateInput,
  OrderAttachmentRecord,
  OrderAttachmentUpdateInput
} from "../../../modules/orders/orderTypes.js";

export interface AttachmentRepository {
  createOrderAttachment(input: OrderAttachmentCreateInput): Promise<OrderAttachmentRecord>;
  listOrderAttachments(orderId: string): Promise<OrderAttachmentRecord[]>;
  appendAttachmentAuditLog(input: AttachmentAuditLogCreateInput): Promise<AttachmentAuditLogRecord>;
  listAttachmentAuditLogs(orderId: string): Promise<AttachmentAuditLogRecord[]>;
  updateOrderAttachment(
    orderId: string,
    attachmentId: string,
    input: OrderAttachmentUpdateInput
  ): Promise<OrderAttachmentRecord | undefined>;
  deleteOrderAttachment(
    orderId: string,
    attachmentId: string,
    actor?: { id: string; name?: string | undefined; role: OrderAttachmentRecord["uploadedByRole"] }
  ): Promise<OrderAttachmentRecord | undefined>;
}
