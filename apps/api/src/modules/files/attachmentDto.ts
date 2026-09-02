import { isClientRole } from "@sample-room/shared";
import type {
  AttachmentAuditLogRecord,
  OrderAttachmentRecord
} from "../orders/orderTypes.js";
import {
  currentAccountDisplayName,
  type AccountDisplayNameMap
} from "../accounts/accountDisplayName.js";
import { normalizeAttachmentVisibility } from "./attachmentVisibility.js";

export function attachmentSourceCategory(
  attachment: Pick<OrderAttachmentRecord, "uploadedByRole">
): NonNullable<OrderAttachmentRecord["sourceCategory"]> {
  if (isClientRole(attachment.uploadedByRole)) return "client_upload";
  if (attachment.uploadedByRole === "pattern_maker") return "pattern_maker_upload";
  return "sample_room_upload";
}

export function attachmentForWebResponse(
  attachment: OrderAttachmentRecord
): OrderAttachmentRecord {
  return attachmentResponse(attachment, attachment.uploadedByName);
}

export function attachmentForWebResponseWithAccountNames(
  attachment: OrderAttachmentRecord,
  accountNames: AccountDisplayNameMap
): OrderAttachmentRecord {
  return attachmentResponse(
    attachment,
    currentAccountDisplayName(accountNames, attachment.uploadedBy, attachment.uploadedByName)
  );
}

export function attachmentAuditLogForWebResponseWithAccountNames(
  log: AttachmentAuditLogRecord,
  accountNames: AccountDisplayNameMap
): AttachmentAuditLogRecord {
  const {
    actorName: _historicalActorName,
    originalUploaderName: _historicalOriginalUploaderName,
    ...safeLog
  } = log;
  const actorName = currentAccountDisplayName(accountNames, log.actorId, log.actorName);
  const originalUploaderName = currentAccountDisplayName(
    accountNames,
    log.originalUploaderId,
    log.originalUploaderName
  );
  return {
    ...safeLog,
    ...(actorName ? { actorName } : {}),
    ...(originalUploaderName ? { originalUploaderName } : {})
  };
}

function attachmentResponse(
  attachment: OrderAttachmentRecord,
  uploadedByName?: string
): OrderAttachmentRecord {
  const {
    storageKey: _storageKey,
    checksum: _checksum,
    uploadedByName: _historicalUploadedByName,
    ...safeAttachment
  } = attachment;
  return {
    ...safeAttachment,
    visibility: normalizeAttachmentVisibility(attachment.visibility),
    ...(uploadedByName ? { uploadedByName } : {}),
    sourceCategory: attachmentSourceCategory(attachment),
    hasFile: Boolean(attachment.storageKey) || attachment.hasFile === true
  };
}
