import type { Prisma } from "@prisma/client";
import type { Role } from "@sample-room/shared";
import type { BusinessUserRequestRecord } from "../../../modules/accounts/businessUserRequestTypes.js";
import type {
  AttachmentAuditLogRecord,
  ClientUserRecord,
  CustomerRecord,
  OrderAttachmentRecord,
  OrderCorrectionLogEntry,
  OrderRecord,
  RecordStatus
} from "../../../modules/orders/orderTypes.js";

export const orderInclude = {
  customer: true,
  clientUser: true,
  correctionLogs: {
    orderBy: {
      changedAt: "asc"
    }
  }
} satisfies Prisma.OrderInclude;

export type PrismaOrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
export type PrismaOrderCorrectionLogRecord = Prisma.OrderCorrectionLogGetPayload<object>;
export type PrismaAttachmentRecord = Prisma.OrderAttachmentGetPayload<object>;
export type PrismaAttachmentAuditLogRecord = Prisma.AttachmentAuditLogGetPayload<object>;
export type PrismaBusinessUserRequestRecord = Prisma.BusinessUserRequestGetPayload<object>;
export type PrismaClientUserRecord = Prisma.ClientUserGetPayload<object>;
export type PrismaCustomerRecord = Prisma.CustomerGetPayload<object>;

function recordStatus(status: string): RecordStatus {
  return status === "active" ? "active" : "archived";
}

function optionalText(value: string | null): string | undefined {
  return value ?? undefined;
}

function jsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function textFromJson(value: Prisma.JsonValue | null | undefined, key: string): string | undefined {
  const objectValue = jsonObject(value);
  const fieldValue = objectValue?.[key];
  return typeof fieldValue === "string" ? fieldValue : undefined;
}

function customerSnapshot(
  order: Pick<PrismaOrderWithRelations, "customerId" | "customerName" | "customerSnapshot" | "customer">
): Pick<CustomerRecord, "id" | "name"> {
  return {
    id: textFromJson(order.customerSnapshot, "id") ?? order.customerId,
    name: textFromJson(order.customerSnapshot, "name") ?? order.customerName ?? order.customer.name
  };
}

function clientUserSnapshot(
  order: Pick<
    PrismaOrderWithRelations,
    "clientUserId" | "salespersonName" | "clientUserSnapshot" | "clientUser"
  >
): Pick<ClientUserRecord, "id" | "displayName"> {
  return {
    id: textFromJson(order.clientUserSnapshot, "id") ?? order.clientUserId,
    displayName:
      textFromJson(order.clientUserSnapshot, "displayName") ??
      order.salespersonName ??
      order.clientUser.displayName
  };
}

export function toDateOnlyString(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

export function fromDateOnlyString(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return new Date(Date.UTC(year, month - 1, day));
}

function correctionValue(value: Prisma.JsonValue | null): string | number | null {
  if (typeof value === "string" || typeof value === "number" || value === null) {
    return value;
  }

  return JSON.stringify(value);
}

export function mapCustomer(record: PrismaCustomerRecord): CustomerRecord {
  return {
    id: record.id,
    name: record.name,
    status: recordStatus(record.status),
    archivedAt: record.archivedAt?.toISOString(),
    archivedBy: optionalText(record.archivedBy)
  };
}

export function mapClientUser(record: PrismaClientUserRecord): ClientUserRecord {
  return {
    id: record.id,
    customerId: record.customerId,
    accountId: optionalText(record.accountId),
    displayName: record.displayName,
    contact: optionalText(record.contact),
    status: recordStatus(record.status),
    clientAccessScope: record.clientAccessScope,
    archivedAt: record.archivedAt?.toISOString(),
    archivedBy: optionalText(record.archivedBy)
  };
}

export function mapOrderCorrectionLog(record: PrismaOrderCorrectionLogRecord): OrderCorrectionLogEntry {
  return {
    id: record.id,
    changedAt: record.changedAt.toISOString(),
    changedByRole: record.changedByRole as Role,
    changedByAccountId: record.changedByAccountId,
    changedByName: optionalText(record.changedByName),
    fieldName: record.fieldName,
    oldValue: correctionValue(record.oldValue),
    newValue: correctionValue(record.newValue)
  };
}

export function mapOrder(record: PrismaOrderWithRelations): OrderRecord {
  const customer = customerSnapshot(record);
  const clientUser = clientUserSnapshot(record);

  return {
    id: record.id,
    orderNo: record.orderNo,
    folderCode: record.folderCode,
    sourceType: record.sourceType,
    sourceOrderId: optionalText(record.sourceOrderId),
    sourcePatternVersionId: optionalText(record.sourcePatternVersionId),
    customerId: record.customerId,
    clientUserId: record.clientUserId,
    customerName: record.customerName ?? customer.name,
    salespersonId: record.salespersonId ?? clientUser.id,
    salespersonName: record.salespersonName ?? clientUser.displayName,
    customerSnapshot: customer,
    clientUserSnapshot: clientUser,
    styleNo: record.styleNo,
    styleName: record.styleName,
    quantity: record.quantity,
    sampleType: record.sampleType,
    sampleRound: record.sampleRound,
    deliveryDate: toDateOnlyString(record.deliveryDate),
    remark: optionalText(record.remark),
    taskInstructionNote: optionalText(record.taskInstructionNote),
    intakeStatus: record.intakeStatus,
    stage: record.stage,
    patternStatus: record.patternStatus,
    patternSourceType: record.patternSourceType,
    sampleRequestItems: record.sampleRequestItems as OrderRecord["sampleRequestItems"],
    sampleGarmentRequired: record.sampleGarmentRequired,
    fabricStatus: record.fabricStatus,
    trimStatus: record.trimStatus,
    latestPatternVersion: optionalText(record.latestPatternVersion),
    cuttingUsedPatternVersion: optionalText(record.cuttingUsedPatternVersion),
    receivedAt: record.receivedAt?.toISOString(),
    receivedBy: optionalText(record.receivedBy),
    returnReason: optionalText(record.returnReason),
    returnedAt: record.returnedAt?.toISOString(),
    returnedBy: optionalText(record.returnedBy),
    supplementCount: record.supplementCount,
    supplementedAt: record.supplementedAt?.toISOString(),
    terminated: record.terminated,
    terminatedAt: record.terminatedAt?.toISOString(),
    terminatedBy: optionalText(record.terminatedBy),
    terminatedByName: optionalText(record.terminatedByName),
    terminationReason: optionalText(record.terminationReason),
    statusBeforeTermination: optionalText(record.statusBeforeTermination),
    stageAtTermination: record.stageAtTermination,
    createdBy: record.createdBy ?? "",
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    correctionLogs: record.correctionLogs.map(mapOrderCorrectionLog)
  };
}

export function mapAttachment(record: PrismaAttachmentRecord): OrderAttachmentRecord {
  return {
    id: record.id,
    orderId: record.orderId,
    fileName: record.fileName,
    mimeType: record.contentType ?? "application/octet-stream",
    size: record.sizeBytes ?? 0,
    category: record.category,
    uploadedBy: record.uploadedBy ?? "",
    uploadedByRole: (record.uploadedByRole ?? "receiver") as Role,
    uploadedByName: optionalText(record.uploadedByName),
    patternTaskId: optionalText(record.patternTaskId),
    patternTaskCategory: optionalText(record.patternTaskCategory),
    orderChargeId: optionalText(record.orderChargeId),
    createdAt: record.createdAt.toISOString(),
    visibility: record.visibility,
    storageKey: optionalText(record.storageKey),
    checksum: optionalText(record.checksum),
    hasFile: Boolean(record.storageKey)
  };
}

export function mapAttachmentAuditLog(record: PrismaAttachmentAuditLogRecord): AttachmentAuditLogRecord {
  return {
    id: record.id,
    orderId: record.orderId,
    attachmentId: record.attachmentId,
    originalFileName: record.originalFileName,
    newFileName: optionalText(record.newFileName),
    action: record.action as AttachmentAuditLogRecord["action"],
    actorId: record.actorId,
    actorName: optionalText(record.actorName),
    actorRole: record.actorRole as Role,
    originalUploaderId: record.originalUploaderId,
    originalUploaderName: optionalText(record.originalUploaderName),
    originalUploaderRole: record.originalUploaderRole as Role,
    attachmentCategory: record.attachmentCategory,
    sourceCategory: optionalText(record.sourceCategory),
    patternTaskId: optionalText(record.patternTaskId),
    patternTaskCategory: optionalText(record.patternTaskCategory),
    orderChargeId: optionalText(record.orderChargeId),
    createdAt: record.createdAt.toISOString()
  };
}

export function mapBusinessUserRequest(
  record: PrismaBusinessUserRequestRecord
): BusinessUserRequestRecord {
  return {
    id: record.id,
    customerId: record.customerId,
    customerName: record.customerName,
    requestedByClientUserId: record.requestedByClientUserId,
    requestedByName: record.requestedByName,
    businessUserName: record.businessUserName,
    contact: record.contact,
    roleNote: optionalText(record.roleNote),
    note: optionalText(record.note),
    source:
      record.source === "supervisor_registration_code"
        ? "supervisor_registration_code"
        : "supervisor_request",
    requestedUsername: optionalText(record.requestedUsername),
    requestedPasswordHash: optionalText(record.requestedPasswordHash),
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    reviewedAt: record.reviewedAt?.toISOString(),
    reviewedBy: optionalText(record.reviewedBy),
    reviewedByRole: optionalText(record.reviewedByRole),
    reviewNote: optionalText(record.reviewNote),
    createdClientUserId: optionalText(record.createdClientUserId)
  };
}
