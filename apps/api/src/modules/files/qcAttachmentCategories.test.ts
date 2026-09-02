import { ATTACHMENT_VISIBILITY, ROLES } from "@sample-room/shared";
import { describe, expect, it } from "vitest";
import type { OrderAttachmentRecord } from "../orders/orderTypes.js";
import { ordinaryOrderAttachments } from "./qcAttachmentCategories.js";

function attachment(
  id: string,
  category: string,
  orderChargeId?: string
): OrderAttachmentRecord {
  return {
    id,
    orderId: "order-1",
    fileName: `${id}.jpg`,
    mimeType: "image/jpeg",
    size: 10,
    category,
    uploadedBy: "planner-1",
    uploadedByRole: ROLES.planner,
    createdAt: "2026-08-12T10:00:00.000Z",
    visibility: ATTACHMENT_VISIBILITY.internalOnly,
    ...(orderChargeId ? { orderChargeId } : {})
  };
}

describe("ordinary order attachments", () => {
  it("excludes QC evidence and charge attachments from the ordinary list", () => {
    const rows = ordinaryOrderAttachments([
      attachment("ordinary", "style_thumbnail"),
      attachment("qc", "qc_issue_photo"),
      attachment("charge-category", "order_charge"),
      attachment("charge-linked", "sample_room_upload", "charge-1")
    ]);

    expect(rows.map((item) => item.id)).toEqual(["ordinary"]);
  });
});
