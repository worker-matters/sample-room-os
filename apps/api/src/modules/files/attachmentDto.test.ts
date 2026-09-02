import { describe, expect, it } from "vitest";
import type {
  AttachmentAuditLogRecord,
  OrderAttachmentRecord
} from "../orders/orderTypes.js";
import {
  attachmentAuditLogForWebResponseWithAccountNames,
  attachmentForWebResponseWithAccountNames
} from "./attachmentDto.js";

function attachment(fields: Partial<OrderAttachmentRecord>): OrderAttachmentRecord {
  return {
    id: "attachment-uploader-name",
    orderId: "order-uploader-name",
    fileName: "sample.pdf",
    mimeType: "application/pdf",
    size: 10,
    category: "receiver_upload",
    uploadedBy: "formal-account-receiver",
    uploadedByRole: "receiver",
    visibility: "internal_only",
    createdAt: "2026-08-02T00:00:00.000Z",
    ...fields
  };
}

describe("attachment response uploader names", () => {
  it("prefers the current account name over the historical snapshot", () => {
    const response = attachmentForWebResponseWithAccountNames(
      attachment({ uploadedByName: "Receiver" }),
      new Map([["formal-account-receiver", "里与"]])
    );

    expect(response.uploadedByName).toBe("里与");
  });

  it("falls back to the historical snapshot without using the internal account ID as a name", () => {
    expect(
      attachmentForWebResponseWithAccountNames(attachment({ uploadedByName: "Receiver" }), new Map())
        .uploadedByName
    ).toBe("Receiver");
    expect(
      attachmentForWebResponseWithAccountNames(attachment({ uploadedByName: undefined }), new Map())
    ).not.toHaveProperty("uploadedByName");
  });

  it("normalizes historical client_upload_allowed records to internal_only", () => {
    const response = attachmentForWebResponseWithAccountNames(
      attachment({ visibility: "client_upload_allowed" }),
      new Map()
    );
    expect(response.visibility).toBe("internal_only");
    expect(JSON.stringify(response)).not.toContain("client_upload_allowed");
  });
});

describe("attachment audit-log response names", () => {
  const historicalLog: AttachmentAuditLogRecord = {
    id: "attachment-log-name",
    orderId: "order-uploader-name",
    attachmentId: "attachment-uploader-name",
    originalFileName: "sample.pdf",
    action: "upload",
    actorId: "formal-account-receiver",
    actorName: "Receiver",
    actorRole: "receiver",
    originalUploaderId: "formal-account-receiver",
    originalUploaderName: "Receiver",
    originalUploaderRole: "receiver",
    attachmentCategory: "receiver_attachment",
    createdAt: "2026-08-02T00:00:00.000Z"
  };

  it("uses current account names without mutating historical log snapshots", () => {
    const response = attachmentAuditLogForWebResponseWithAccountNames(
      historicalLog,
      new Map([["formal-account-receiver", "里与"]])
    );

    expect(response).not.toBe(historicalLog);
    expect(response).toMatchObject({ actorName: "里与", originalUploaderName: "里与" });
    expect(historicalLog).toMatchObject({ actorName: "Receiver", originalUploaderName: "Receiver" });
  });

  it("falls back to snapshots and never substitutes internal account IDs", () => {
    expect(
      attachmentAuditLogForWebResponseWithAccountNames(historicalLog, new Map())
    ).toMatchObject({ actorName: "Receiver", originalUploaderName: "Receiver" });

    const withoutNames = attachmentAuditLogForWebResponseWithAccountNames(
      { ...historicalLog, actorName: undefined, originalUploaderName: undefined },
      new Map()
    );
    expect(withoutNames).not.toHaveProperty("actorName");
    expect(withoutNames).not.toHaveProperty("originalUploaderName");
    expect(JSON.stringify(withoutNames)).not.toContain('"actorName":"formal-account-receiver"');
    expect(JSON.stringify(withoutNames)).not.toContain('"originalUploaderName":"formal-account-receiver"');
  });
});
