import type { OrderAttachmentRecord } from "../orders/orderTypes.js";

export const QC_ATTACHMENT_CATEGORIES = [
  "qc_issue_photo",
  "qc_sample_photo",
  "qc_measurement_photo"
] as const;

export type QcAttachmentCategory = (typeof QC_ATTACHMENT_CATEGORIES)[number];

const qcAttachmentCategorySet = new Set<string>(QC_ATTACHMENT_CATEGORIES);

export function isQcAttachmentCategory(category: string): category is QcAttachmentCategory {
  return qcAttachmentCategorySet.has(category);
}

export function ordinaryOrderAttachments(attachments: readonly OrderAttachmentRecord[]) {
  return attachments.filter(
    (attachment) =>
      !isQcAttachmentCategory(attachment.category) &&
      attachment.category !== "order_charge" &&
      !attachment.orderChargeId
  );
}
