import type { OrderAttachment, OrderRecord } from "../../api/sampleRoomApi";

const preferredThumbnailCategories = [
  "style_thumbnail",
  "receiver_quick_photo",
  "client_quick_photo",
  "client_reference"
];

function isImageAttachment(attachment: OrderAttachment) {
  return attachment.hasFile === true && attachment.mimeType.startsWith("image/");
}

export function getOrderThumbnailAttachment<TAttachment extends OrderAttachment>(
  order: { attachments?: TAttachment[] }
): TAttachment | undefined {
  const attachments = order.attachments ?? [];
  for (const category of preferredThumbnailCategories) {
    const preferred = attachments.find(
      (attachment) => isImageAttachment(attachment) && attachment.category === category
    );
    if (preferred) {
      return preferred;
    }
  }
  return attachments.find(isImageAttachment);
}
