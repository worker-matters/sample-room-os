import {
  acceptPendingReceive,
  ATTACHMENT_VISIBILITY,
  createReceiverSelfEntryInitialState,
  deriveOrderCompletionStatus,
  initialPhysicalOrderStage,
  INTAKE_STATUSES,
  MATERIAL_STATUSES,
  ORDER_STAGES,
  PATTERN_SOURCE_TYPES,
  PATTERN_STATUSES,
  patternTaskRequirementsFromItems,
  ROLES,
  SAMPLE_REQUEST_ITEMS,
  sampleRoundOptions,
  updateTrackingPatternStatus,
  type MaterialStatus,
  type PatternStatus
} from "@sample-room/shared";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import type { AccountRepository, OperationLogRepository } from "../../db/repositories/contracts/index.js";
import type { SampleTypeService } from "../sample-types/sampleTypeService.js";
import { HttpError } from "../../shared/errors/httpError.js";
import { isQcAttachmentCategory, ordinaryOrderAttachments } from "../files/qcAttachmentCategories.js";
import {
  completedPatternRequirementsFromDeliverables,
  currentOrderStageFromPatternGate
} from "../patterns/patternCompletionRules.js";
import type { CurrentUser } from "../auth/currentUser.js";
import {
  canReceiverAcceptOrder,
  canReceiverAddInternalAttachment,
  canReceiverAddMaterialRecord,
  canReceiverCorrectOrder,
  canReceiverCreateSelfEntry,
  canReceiverMaintainTracking,
  canReceiverReturnOrder,
  canReceiverViewOrder
} from "../auth/permissionPolicy.js";
import {
  FileStorageNotFoundError,
  type FileStorageAdapter
} from "../files/fileStorageAdapter.js";
import { renamedDisplayFileName } from "../files/attachmentDisplayName.js";
import {
  attachmentAuditLogForWebResponseWithAccountNames,
  attachmentForWebResponseWithAccountNames
} from "../files/attachmentDto.js";
import { attachmentVisibilityFromInput, normalizeAttachmentVisibility } from "../files/attachmentVisibility.js";
import { auditAttachmentVisibilityChange } from "../files/attachmentVisibilityAudit.js";
import { createLocalFileStorageAdapter } from "../files/localFileStorageAdapter.js";
import type { AttachmentDownload } from "../orders/orderService.js";
import type { ScanRecord } from "../scan/scanTypes.js";
import type {
  OrderAttachmentCreateInput,
  OrderAttachmentRecord,
  OrderCorrectionLogEntry,
  OrderPatternTaskSummary,
  OrderRecord,
  ReceiverOrderDto
} from "../orders/orderTypes.js";
import {
  normalizeSampleRequestItems,
  patternSourceTypeFromPatternStatus,
  sampleGarmentRequired
} from "../orders/patternTaskFlowRules.js";
import { ensureOrderFolder } from "../patterns/orderFolderService.js";
import { maintainOrderIdentityMarkers } from "../patterns/localPatternFileWorkflow.js";
import {
  currentAccountDisplayName,
  loadAccountDisplayNames,
  type AccountDisplayNameMap
} from "../accounts/accountDisplayName.js";
import { orderStageDisplayLabel } from "../orders/orderDisplayStatus.js";
import { lockActiveOrderForBusinessWrite } from "../orders/orderWriteBoundary.js";
import {
  assertPatternRequirementsCanChange,
  syncPatternTaskForOrder
} from "../patterns/patternTaskSync.js";

type SelfEntryPayload = {
  customerId?: unknown;
  clientUserId?: unknown;
  patternStatus?: unknown;
  styleNo?: unknown;
  styleName?: unknown;
  quantity?: unknown;
  sampleType?: unknown;
  sampleRound?: unknown;
  deliveryDate?: unknown;
  remark?: unknown;
  fabricStatus?: unknown;
  trimStatus?: unknown;
  sampleRequestItems?: unknown;
  attachments?: unknown;
  thumbnailAttachmentIndex?: unknown;
};

type QuickPhotoPayload = {
  customerId?: unknown;
  clientUserId?: unknown;
  styleNo?: unknown;
  styleName?: unknown;
  quantity?: unknown;
  sampleType?: unknown;
  sampleRound?: unknown;
  deliveryDate?: unknown;
  remark?: unknown;
  sampleRequestItems?: unknown;
  attachments?: unknown;
  thumbnailAttachmentIndex?: unknown;
};

type TrackingPatchPayload = {
  fabricStatus?: unknown;
  trimStatus?: unknown;
  patternStatus?: unknown;
  remark?: unknown;
};

type CorrectionPayload = {
  styleNo?: unknown;
  styleName?: unknown;
  quantity?: unknown;
  sampleType?: unknown;
  sampleRound?: unknown;
  deliveryDate?: unknown;
  remark?: unknown;
  patternStatus?: unknown;
  fabricStatus?: unknown;
  trimStatus?: unknown;
  sampleRequestItems?: unknown;
};

function patternTaskForReceiverResponse(
  task: Awaited<ReturnType<SampleRoomRepository["findPatternTaskByOrderId"]>>,
  deliverables: Awaited<ReturnType<SampleRoomRepository["listPatternDeliverablesByOrderId"]>> = [],
  accountNames: AccountDisplayNameMap = new Map()
): OrderPatternTaskSummary | undefined {
  if (!task) return undefined;
  return {
    status: task.status,
    requirements: [...task.requirements],
    completedRequirements: completedPatternRequirementsFromDeliverables(
      task.requirements,
      deliverables
    ),
    ...(task.totalWorkHours !== undefined ? { totalWorkHours: task.totalWorkHours } : {}),
    ...(task.completionNote ? { completionNote: task.completionNote } : {}),
    ...(task.patternMakerName ? { patternMakerName: task.patternMakerName } : {}),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    ...(task.note ? { note: task.note } : {}),
    ...(deliverables.length > 0
      ? {
          deliverables: deliverables.map((deliverable) => ({
            id: deliverable.id,
            version: deliverable.version,
            type: deliverable.type,
            ...(deliverable.fileName ? { fileName: deliverable.fileName } : {}),
            ...(deliverable.textValue ? { textValue: deliverable.textValue } : {}),
            ...(currentAccountDisplayName(
              accountNames,
              deliverable.uploadedBy,
              deliverable.uploadedByName
            )
              ? {
                  uploadedByName: currentAccountDisplayName(
                    accountNames,
                    deliverable.uploadedBy,
                    deliverable.uploadedByName
                  )
                }
              : {}),
            uploadedBy: deliverable.uploadedBy,
            ...(deliverable.taskCategory ? { taskCategory: deliverable.taskCategory } : {}),
            visibility: normalizeAttachmentVisibility(deliverable.visibility),
            hasFile: Boolean(deliverable.storageKey),
            createdAt: deliverable.createdAt
          }))
        }
      : {})
  };
}

type AcceptPayload = {
  patternStatus?: unknown;
  fabricStatus?: unknown;
  trimStatus?: unknown;
  sampleRequestItems?: unknown;
};

type ReturnPayload = {
  returnReason?: unknown;
};

type AttachmentMetadataPayload = {
  fileName?: unknown;
  mimeType?: unknown;
  size?: unknown;
  category?: unknown;
  visibility?: unknown;
  buffer?: unknown;
  temporaryPath?: unknown;
  checksum?: unknown;
};

type NormalizedAttachmentInput = OrderAttachmentCreateInput & {
  buffer?: Buffer | undefined;
  temporaryPath?: string | undefined;
  checksum?: string | undefined;
};

const RECEIVER_SAMPLE_SHEET_CATEGORY = "receiver_sample_sheet";
const RECEIVER_ATTACHMENT_CATEGORY = "receiver_attachment";
const RECEIVER_MATERIAL_RECORD_CATEGORY = "receiver_material_record";
const STYLE_THUMBNAIL_CATEGORY = "style_thumbnail";

function optionalAttachmentIndex(value: unknown, attachmentCount: number) {
  if (value === undefined || value === null || value === "") return undefined;
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= attachmentCount) {
    throw new HttpError(400, "thumbnailAttachmentIndex is invalid.");
  }
  return index;
}

function receiverIntakeAttachments(
  attachments: unknown[],
  thumbnailAttachmentIndex: number | undefined
) {
  const categories = attachments.map((attachment) =>
    typeof attachment === "object" && attachment !== null
      ? optionalText((attachment as AttachmentMetadataPayload).category)
      : undefined
  );
  const sampleSheetIndexes = categories
    .map((category, index) => category === RECEIVER_ATTACHMENT_CATEGORY ? -1 : index)
    .filter((index) => index >= 0);
  if (sampleSheetIndexes.length === 0) {
    throw new HttpError(400, "at least one sample-sheet attachment is required.");
  }

  if (thumbnailAttachmentIndex !== undefined) {
    const attachment = attachments[thumbnailAttachmentIndex];
    const mimeType = typeof attachment === "object" && attachment !== null
      ? optionalText((attachment as AttachmentMetadataPayload).mimeType)
      : undefined;
    if (
      categories[thumbnailAttachmentIndex] === RECEIVER_ATTACHMENT_CATEGORY ||
      !mimeType?.startsWith("image/")
    ) {
      throw new HttpError(400, "thumbnailAttachmentIndex must reference a sample-sheet image.");
    }
  }

  const sampleSheetIndex = sampleSheetIndexes.find((index) => index !== thumbnailAttachmentIndex);
  return attachments.map((attachment, index) => ({
    ...(typeof attachment === "object" && attachment !== null ? attachment : {}),
    category:
      categories[index] === RECEIVER_ATTACHMENT_CATEGORY
        ? RECEIVER_ATTACHMENT_CATEGORY
        : index === thumbnailAttachmentIndex
          ? STYLE_THUMBNAIL_CATEGORY
          : index === sampleSheetIndex
            ? RECEIVER_SAMPLE_SHEET_CATEGORY
            : "receiver_quick_photo"
  }));
}

function isReceiverSampleSheetFile(attachment: OrderAttachmentRecord) {
  const fileName = attachment.fileName.toLowerCase();
  return Boolean(attachment.storageKey) && (
    attachment.mimeType.startsWith("image/") ||
    attachment.mimeType === "application/pdf" ||
    attachment.mimeType === "application/vnd.ms-excel" ||
    attachment.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    fileName.endsWith(".xls") ||
    fileName.endsWith(".xlsx")
  );
}

export type ReceiverSelfEntryOptions = {
  customers: Array<{
    id: string;
    name: string;
    clientUsers: Array<{
      id: string;
      customerId: string;
      displayName: string;
    }>;
  }>;
};

const materialValues = new Set<string>(Object.values(MATERIAL_STATUSES));
const patternValues = new Set<string>(Object.values(PATTERN_STATUSES));
const correctionFields = new Set([
  "styleNo",
  "styleName",
  "quantity",
  "sampleType",
  "sampleRound",
  "deliveryDate",
  "remark",
  "patternStatus",
  "fabricStatus",
  "trimStatus",
  "sampleRequestItems"
]);

type QuantityLockStatement = {
  status: string;
  items: Array<{ orderId: string; returnedAt?: string | undefined }>;
};

export function canEditOrderQuantity(
  statements: ReadonlyArray<QuantityLockStatement>,
  orderId: string
) {
  return !statements.some(
    (statement) =>
      statement.status !== "returned" &&
      statement.items.some((item) => item.orderId === orderId && !item.returnedAt)
  );
}

function requireText(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} is required.`);
  }

  return value.trim();
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalKnownOption(value: unknown, allowedValues: Set<string>, field: string) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || !allowedValues.has(value)) {
    throw new HttpError(400, `${field} is not an allowed option.`);
  }

  return value;
}

function requireKnownOption(value: unknown, allowedValues: Set<string>, field: string) {
  const option = optionalKnownOption(value, allowedValues, field);
  if (!option) {
    throw new HttpError(400, `${field} is required.`);
  }

  return option;
}

function requireQuantity(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, "quantity must be a positive integer.");
  }

  return value;
}

function requireDateOnly(value: unknown, field: string) {
  const match =
    typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) {
    throw new HttpError(400, `${field} must be a valid YYYY-MM-DD date.`);
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new HttpError(400, `${field} must be a valid YYYY-MM-DD date.`);
  }

  return value;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateAfterDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

function displayNameSegment(value: string, fallback: string) {
  return (
    value
      .trim()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || fallback
  );
}

function requireNonNegativeInteger(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, `${field} must be a non-negative integer.`);
  }

  return value;
}

function normalizeAttachmentList(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new HttpError(400, "attachments must be an array.");
  }

  return value;
}

function normalizeReceiverAttachmentPayload(
  value: unknown,
  currentUser: CurrentUser,
  orderId: string
): NormalizedAttachmentInput {
  if (typeof value !== "object" || value === null) {
    throw new HttpError(400, "attachment metadata must be an object.");
  }

  const payload = value as AttachmentMetadataPayload;
  const category = optionalText(payload.category) ?? "internal_pattern";
  return {
    orderId,
    fileName: requireText(payload.fileName, "fileName"),
    mimeType: optionalText(payload.mimeType) ?? "application/octet-stream",
    size: requireNonNegativeInteger(payload.size, "size"),
    category,
    uploadedBy: currentUser.id,
    uploadedByRole: currentUser.role,
    uploadedByName: currentUser.displayName,
    visibility: attachmentVisibilityFromInput(
      typeof payload.visibility === "string" ? payload.visibility : undefined,
      ATTACHMENT_VISIBILITY.internalOnly
    ),
    ...(Buffer.isBuffer(payload.buffer) ? { buffer: payload.buffer } : {}),
    ...(typeof payload.temporaryPath === "string" ? { temporaryPath: payload.temporaryPath } : {}),
    ...(typeof payload.checksum === "string" ? { checksum: payload.checksum } : {})
  };
}

function requirePatternStatus(value: unknown): PatternStatus {
  if (typeof value !== "string" || !patternValues.has(value)) {
    throw new HttpError(400, "patternStatus must be has or none.");
  }

  return value as PatternStatus;
}

function requireMaterialStatus(value: unknown, field: string): MaterialStatus {
  if (typeof value !== "string" || !materialValues.has(value)) {
    throw new HttpError(400, `${field} must be missing, partial, or complete.`);
  }

  return value as MaterialStatus;
}

function optionalPatternStatus(value: unknown): PatternStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requirePatternStatus(value);
}

function normalizeLogValue(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  if (value === undefined || value === null) {
    return null;
  }

  return String(value);
}

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function ensureCorrectionPayload(value: unknown): CorrectionPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "correction payload must be an object.");
  }

  const payload = value as Record<string, unknown>;
  for (const field of Object.keys(payload)) {
    if (!correctionFields.has(field)) {
      throw new HttpError(400, `${field} cannot be corrected.`);
    }
  }

  return payload;
}

async function ensureActiveCustomerBinding(
  repository: SampleRoomRepository,
  customerId: string,
  clientUserId: string
) {
  const customer = await repository.findCustomerById(customerId);
  const clientUser = await repository.findClientUserById(clientUserId);

  if (!customer || customer.status !== "active") {
    throw new HttpError(400, "customer must be active.");
  }

  if (
    !clientUser ||
    clientUser.customerId !== customer.id ||
    clientUser.status !== "active"
  ) {
    throw new HttpError(
      400,
      "customer salesperson profile must be active under the selected customer."
    );
  }
}

export class ReceiverService {
  constructor(
    private readonly repository: SampleRoomRepository,
    private readonly accounts: AccountRepository,
    private readonly sampleTypeService: SampleTypeService,
    private readonly fileStorage: FileStorageAdapter = createLocalFileStorageAdapter(),
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly operationLogs?: OperationLogRepository
  ) {}

  private readonly sampleRoundValues = new Set(sampleRoundOptions.map((option) => option.value));

  private async withAttachments(
    order: OrderRecord,
    accountNames: AccountDisplayNameMap
  ): Promise<ReceiverOrderDto> {
    const [attachments, attachmentLogs, patternTask, deliverables, existingFolder, scanRecords, charges, statements] = await Promise.all([
      this.repository.listOrderAttachments(order.id),
      this.repository.listAttachmentAuditLogs(order.id),
      this.repository.findPatternTaskByOrderId(order.id),
      this.repository.listPatternDeliverablesByOrderId(order.id),
      this.repository.findOrderFolderByOrderId(order.id),
      this.repository.listScanRecordsByOrderId(order.id),
      this.repository.listOrderChargesByOrderId(order.id),
      this.repository.listReconciliationStatements()
    ]);
    const ordinaryAttachments = ordinaryOrderAttachments(attachments);
    const orderFolder = existingFolder ?? (await ensureOrderFolder(this.repository, order, order.createdBy, this.env));
    const currentStage = order.intakeStatus === INTAKE_STATUSES.pendingReceive
      ? order.stage
      : currentOrderStageFromPatternGate({
          sampleRequestItems: order.sampleRequestItems,
          storedStage: order.stage,
          deliverables
        });
    return {
      ...order,
      stage: currentStage,
      stageLabel: orderStageDisplayLabel(currentStage, scanRecords),
      attachmentCount: ordinaryAttachments.length,
      chargeCount: charges.filter((charge) => !charge.archivedAt).length,
      materialRecordCount: ordinaryAttachments.filter((attachment) => attachment.category === RECEIVER_MATERIAL_RECORD_CATEGORY).length,
      quantityCorrectionLocked: !canEditOrderQuantity(statements, order.id),
      attachments: ordinaryAttachments.map((attachment) =>
        attachmentForWebResponseWithAccountNames(attachment, accountNames)
      ),
      attachmentLogs: attachmentLogs.filter((log) => !isQcAttachmentCategory(log.attachmentCategory)).map((log) =>
        attachmentAuditLogForWebResponseWithAccountNames(log, accountNames)
      ),
      completionStatus: deriveOrderCompletionStatus({
        sampleRequestItems: order.sampleRequestItems,
        orderStage: currentStage,
        patternTaskStatus: patternTask?.status
      }),
      ...(patternTask
        ? { patternTask: patternTaskForReceiverResponse(patternTask, deliverables, accountNames) }
        : {}),
      orderFolder: {
        id: orderFolder.id,
        orderId: orderFolder.orderId,
        folderName: orderFolder.folderName,
        createdAt: orderFolder.createdAt,
        updatedAt: orderFolder.updatedAt
      }
    };
  }

  private async createAttachmentMetadata(
    attachment: NormalizedAttachmentInput
  ): Promise<OrderAttachmentRecord> {
    if (!attachment.buffer && !attachment.temporaryPath) {
      return this.repository.createOrderAttachment(attachment);
    }

    const order = await this.requireReceiverReadableOrder(attachment.orderId);
    const folder = await ensureOrderFolder(this.repository, order, attachment.uploadedBy, this.env);
    const stored = await this.fileStorage.saveFile({
      orderId: attachment.orderId,
      folderCode: order.folderCode,
      orderFolderRelativePath: folder.relativePath,
      category: attachment.category,
      uploaderRole: attachment.uploadedByRole,
      originalName: attachment.fileName,
      contentType: attachment.mimeType,
      buffer: attachment.buffer,
      temporaryPath: attachment.temporaryPath,
      checksum: attachment.checksum
    });

    try {
      const { buffer: _buffer, temporaryPath: _temporaryPath, checksum: _checksum, ...metadata } = attachment;
      return this.repository.createOrderAttachment({
          ...metadata,
          fileName: stored.originalName,
          mimeType: stored.contentType,
          size: stored.sizeBytes,
          storageKey: stored.storageKey,
          checksum: stored.checksum
        });
    } catch (error) {
      await this.fileStorage.deleteFile(stored.storageKey);
      throw error;
    }
  }

  private async requireReceiverReadableOrder(id: string, currentUser?: CurrentUser): Promise<OrderRecord> {
    const order = await this.repository.findOrderById(id);
    if (!order) {
      throw new HttpError(404, "order not found.");
    }

    if (currentUser && order.terminated) {
      throw new HttpError(409, "订单已终止");
    }

    if (currentUser && !canReceiverViewOrder(currentUser, order).allowed) {
      throw new HttpError(403, "forbidden");
    }

    return order;
  }

  private async requireReceiverAttachmentWritableOrder(id: string, currentUser: CurrentUser): Promise<OrderRecord> {
    const order = await this.requireReceiverReadableOrder(id, currentUser);
    if (!canReceiverAddInternalAttachment(currentUser, order).allowed) {
      throw new HttpError(409, "only active received tracking orders can receive receiver attachments.");
    }

    return order;
  }

  async listPendingReceive(): Promise<ReceiverOrderDto[]> {
    const [orders, accountNames] = await Promise.all([
      this.repository.listOrders(),
      loadAccountDisplayNames(this.accounts)
    ]);
    return Promise.all(
      orders
      .filter(
        (order) =>
          (order.sourceType === "client_submission" || order.sourceType === "receiver_self_entry") &&
          order.intakeStatus === INTAKE_STATUSES.pendingReceive &&
          !order.terminated
      )
      .map((order) => this.withAttachments(order, accountNames))
    );
  }

  async acceptOrder(id: string, payload: AcceptPayload, currentUser: CurrentUser): Promise<OrderRecord> {
    return this.repository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(id);
      const order = await repository.findOrderById(id);
      if (!order) {
        throw new HttpError(404, "order not found.");
      }
      if (!canReceiverAcceptOrder(currentUser, order).allowed) {
        throw new HttpError(409, "该订单状态已变化，不能重复接单。请刷新列表。");
      }

      const sampleRequestItems =
        payload.sampleRequestItems === undefined
          ? order.sampleRequestItems
          : normalizeSampleRequestItems(payload.sampleRequestItems);
      if (sampleRequestItems.length === 0) {
        throw new HttpError(400, "at least one sample request item is required before acceptance.");
      }
      const nextState = acceptPendingReceive(
        requirePatternStatus(payload.patternStatus),
        sampleRequestItems
      );
      const preserveStartedQuickPhotoStage =
        order.sourceType === "receiver_self_entry" &&
        order.intakeStatus === INTAKE_STATUSES.pendingReceive &&
        order.stage !== null &&
        order.sampleRequestItems.length > 0;
      const updated = await repository.updateOrder(id, {
        intakeStatus: nextState.intakeStatus,
        stage: preserveStartedQuickPhotoStage ? order.stage : nextState.stage,
        patternStatus: nextState.patternStatus,
        patternSourceType: patternSourceTypeFromPatternStatus(nextState.patternStatus),
        sampleRequestItems,
        sampleGarmentRequired: sampleGarmentRequired(sampleRequestItems),
        fabricStatus:
          payload.fabricStatus !== undefined
            ? requireMaterialStatus(payload.fabricStatus, "fabricStatus")
            : nextState.fabricStatus,
        trimStatus:
          payload.trimStatus !== undefined
            ? requireMaterialStatus(payload.trimStatus, "trimStatus")
            : nextState.trimStatus,
        receivedAt: new Date().toISOString(),
        receivedBy: currentUser.id
      });
      await syncPatternTaskForOrder(repository, updated);
      return updated;
    });
  }

  async returnOrder(id: string, payload: ReturnPayload, currentUser: CurrentUser): Promise<OrderRecord> {
    return this.repository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(id);
      const order = await repository.findOrderById(id);
      if (!order) {
        throw new HttpError(404, "order not found.");
      }
      if (!canReceiverReturnOrder(currentUser, order).allowed) {
        throw new HttpError(409, "该订单状态已变化，不能退回。请刷新列表。");
      }
      return repository.updateOrder(id, {
        intakeStatus: INTAKE_STATUSES.needsClientSupplement,
        stage: null,
        returnReason: optionalText(payload.returnReason) ?? "客户资料需补充",
        returnedAt: new Date().toISOString(),
        returnedBy: currentUser.id
      });
    });
  }

  async listTracking(): Promise<ReceiverOrderDto[]> {
    const [orders, accountNames] = await Promise.all([
      this.repository.listOrders(),
      loadAccountDisplayNames(this.accounts)
    ]);
    return Promise.all(
      orders
      .filter(
        (order) =>
          order.intakeStatus === INTAKE_STATUSES.received &&
          order.stage !== null &&
          !order.terminated
      )
      .map((order) => this.withAttachments(order, accountNames))
    );
  }

  async updateTracking(id: string, payload: TrackingPatchPayload, currentUser: CurrentUser): Promise<OrderRecord> {
    return this.repository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(id);
      const order = await repository.findOrderById(id);
      if (!order) {
        throw new HttpError(404, "order not found.");
      }
      if (!canReceiverMaintainTracking(currentUser, order).allowed || order.stage === null) {
        throw new HttpError(409, "订单状态已变化，本次更新未保存。请刷新列表。");
      }

      const patternStatus = optionalPatternStatus(payload.patternStatus);
      const nextStage =
        patternStatus === undefined
          ? order.stage
          : updateTrackingPatternStatus(order.stage, patternStatus);

      return repository.updateOrder(id, {
        ...(payload.fabricStatus !== undefined
          ? { fabricStatus: requireMaterialStatus(payload.fabricStatus, "fabricStatus") }
          : {}),
        ...(payload.trimStatus !== undefined
          ? { trimStatus: requireMaterialStatus(payload.trimStatus, "trimStatus") }
          : {}),
        ...(patternStatus !== undefined ? { patternStatus } : {}),
        ...(payload.remark !== undefined ? { remark: optionalText(payload.remark) } : {}),
        stage: nextStage
      });
    });
  }

  async correctOrder(id: string, rawPayload: unknown, currentUser: CurrentUser): Promise<ReceiverOrderDto> {
    const payload = ensureCorrectionPayload(rawPayload);
    const result = await this.repository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(id);
      const service = new ReceiverService(
        repository,
        this.accounts,
        this.sampleTypeService,
        this.fileStorage,
        this.env,
        this.operationLogs
      );
      return service.correctOrderInTransaction(id, payload, currentUser);
    });

    if (result.changed) {
      const folder = await ensureOrderFolder(this.repository, result.updatedOrder, currentUser, this.env);
      try {
        await maintainOrderIdentityMarkers({
          rootPath: folder.rootPath,
          previous: result.previousOrder,
          current: result.updatedOrder
        });
      } catch (error) {
        console.error("order identity marker sync after correction failed", {
          orderId: result.updatedOrder.id,
          error: error instanceof Error ? error.message : "unknown_error"
        });
      }
    }

    return this.withAttachments(
      result.updatedOrder,
      await loadAccountDisplayNames(this.accounts)
    );
  }

  private async correctOrderInTransaction(
    id: string,
    payload: CorrectionPayload,
    currentUser: CurrentUser
  ): Promise<{ previousOrder: OrderRecord; updatedOrder: OrderRecord; changed: boolean }> {
    const order = await this.requireReceiverReadableOrder(id, currentUser);
    if (!canReceiverCorrectOrder(currentUser, order).allowed) {
      throw new HttpError(
        order.terminated ? 409 : 403,
        order.terminated ? "订单已终止，不能再校正订单资料。" : "forbidden"
      );
    }

    const patch: Partial<OrderRecord> = {};
    const changes: Array<{ fieldName: string; oldValue: unknown; newValue: unknown }> = [];
    const [allProductionRecords, statements] = await Promise.all([
      this.repository.listScanRecordsByOrderId(order.id),
      this.repository.listReconciliationStatements()
    ]);
    const productionRecords = allProductionRecords.filter((record) => record.stage !== "pattern");

    const addChange = (fieldName: keyof CorrectionPayload, nextValue: unknown) => {
      const currentValue = order[fieldName as keyof OrderRecord];
      if (currentValue === nextValue) {
        return;
      }

      patch[fieldName as keyof OrderRecord] = nextValue as never;
      changes.push({ fieldName, oldValue: currentValue, newValue: nextValue });
    };

    if (payload.styleNo !== undefined) {
      addChange("styleNo", requireText(payload.styleNo, "styleNo"));
    }

    if (payload.styleName !== undefined) {
      addChange("styleName", requireText(payload.styleName, "styleName"));
    }

    if (payload.sampleType !== undefined) {
      addChange(
        "sampleType",
        await this.sampleTypeService.requireWritableCodeForUpdate(payload.sampleType, order.sampleType)
      );
    }

    if (payload.sampleRound !== undefined) {
      addChange(
        "sampleRound",
        requireKnownOption(payload.sampleRound, this.sampleRoundValues, "sampleRound")
      );
    }

    if (payload.remark !== undefined) {
      addChange("remark", optionalText(payload.remark));
    }

    const quantityEditable = canEditOrderQuantity(statements, order.id);

    if (payload.quantity !== undefined) {
      const nextQuantity = requireQuantity(payload.quantity);
      if (order.quantity !== nextQuantity && !quantityEditable) {
        throw new HttpError(409, "订单已进入对账单，件数请由老板在对账单中调整。");
      }
      addChange("quantity", nextQuantity);
    }

    if (payload.deliveryDate !== undefined) {
      const nextDeliveryDate = requireDateOnly(payload.deliveryDate, "deliveryDate");
      addChange("deliveryDate", nextDeliveryDate);
    }

    if (payload.patternStatus !== undefined) {
      const nextPatternStatus = requirePatternStatus(payload.patternStatus);
      addChange("patternStatus", nextPatternStatus);
    }

    if (payload.fabricStatus !== undefined) {
      const nextFabricStatus = requireMaterialStatus(payload.fabricStatus, "fabricStatus");
      addChange("fabricStatus", nextFabricStatus);
    }

    if (payload.trimStatus !== undefined) {
      const nextTrimStatus = requireMaterialStatus(payload.trimStatus, "trimStatus");
      addChange("trimStatus", nextTrimStatus);
    }

    if (payload.sampleRequestItems !== undefined) {
      const nextSampleRequestItems = normalizeSampleRequestItems(payload.sampleRequestItems);
      if (!sameStringArray(order.sampleRequestItems, nextSampleRequestItems)) {
        const task = await this.repository.findPatternTaskByOrderId(order.id);
        assertPatternRequirementsCanChange(
          task,
          patternTaskRequirementsFromItems(nextSampleRequestItems)
        );
        const removedItems = order.sampleRequestItems.filter(
          (item) => !nextSampleRequestItems.includes(item)
        );
        const addedItems = nextSampleRequestItems.filter(
          (item) => !order.sampleRequestItems.includes(item)
        );
        if (productionRecords.length > 0 && addedItems.length > 0) {
          throw new HttpError(
            409,
            "实体工序已经开始，不能再增加生产或打样任务。"
          );
        }
        if (
          removedItems.includes(SAMPLE_REQUEST_ITEMS.cutting) &&
          productionRecords.some((record) => record.stage === "cutting")
        ) {
          throw new HttpError(409, "裁剪记录已提交，不能删除裁剪任务。");
        }
        if (
          (removedItems.includes(SAMPLE_REQUEST_ITEMS.sampleGarment) ||
            removedItems.includes(SAMPLE_REQUEST_ITEMS.sampleSmall)) &&
          productionRecords.some(
            (record) => record.stage === "sewing" || record.stage === "qc_delivery"
          )
        ) {
          throw new HttpError(409, "缝制已经接单或完成，不能删除样衣生产任务。");
        }
        patch.sampleRequestItems = nextSampleRequestItems;
        patch.sampleGarmentRequired = sampleGarmentRequired(nextSampleRequestItems);
        patch.stage =
          productionRecords.length === 0
            ? initialPhysicalOrderStage(nextSampleRequestItems)
            : order.stage === ORDER_STAGES.sewingWaiting &&
                !sampleGarmentRequired(nextSampleRequestItems)
              ? ORDER_STAGES.done
              : order.stage;
        changes.push({
          fieldName: "sampleRequestItems",
          oldValue: order.sampleRequestItems.join(","),
          newValue: nextSampleRequestItems.join(",")
        });
      }
    }

    if (changes.length === 0) {
      return { previousOrder: order, updatedOrder: order, changed: false };
    }

    const changedAt = new Date().toISOString();
    const nextLogIndex = order.correctionLogs.length + 1;
    const correctionLogs: OrderCorrectionLogEntry[] = changes.map((change, index) => ({
      id: `${order.id}-correction-${nextLogIndex + index}`,
      changedAt,
      changedByRole: currentUser.role,
      changedByAccountId: currentUser.id,
      changedByName: currentUser.displayName,
      fieldName: change.fieldName,
      oldValue: normalizeLogValue(change.oldValue),
      newValue: normalizeLogValue(change.newValue)
    }));

    const updatedOrder = await this.repository.updateOrder(id, {
      ...patch,
      correctionLogs: [...order.correctionLogs, ...correctionLogs]
    });
    await syncPatternTaskForOrder(this.repository, updatedOrder);

    return { previousOrder: order, updatedOrder, changed: true };
  }

  async createSelfEntry(payload: SelfEntryPayload, currentUser: CurrentUser): Promise<OrderRecord> {
    if (!canReceiverCreateSelfEntry(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }

    const customerId = requireText(payload.customerId, "customerId");
    const clientUserId = requireText(payload.clientUserId, "clientUserId");
    await ensureActiveCustomerBinding(this.repository, customerId, clientUserId);
    const attachments = normalizeAttachmentList(payload.attachments);
    if (attachments.length === 0) {
      throw new HttpError(400, "at least one sample-sheet attachment is required.");
    }
    const thumbnailAttachmentIndex = optionalAttachmentIndex(
      payload.thumbnailAttachmentIndex,
      attachments.length
    );
    const intakeAttachments = receiverIntakeAttachments(attachments, thumbnailAttachmentIndex);

    const sampleRequestItems = normalizeSampleRequestItems(payload.sampleRequestItems);
    const state = createReceiverSelfEntryInitialState(
      requirePatternStatus(payload.patternStatus),
      sampleRequestItems
    );
    const order = await this.repository.withTransaction(async (repository) => {
      const created = await repository.createOrder({
        customerId,
        clientUserId,
        sourceType: "receiver_self_entry",
        createdBy: currentUser.id,
        styleNo: requireText(payload.styleNo, "styleNo"),
        styleName: requireText(payload.styleName, "styleName"),
        quantity: requireQuantity(payload.quantity),
        sampleType: await this.sampleTypeService.requireWritableCode(payload.sampleType),
        sampleRound: requireKnownOption(payload.sampleRound, this.sampleRoundValues, "sampleRound"),
        deliveryDate: requireText(payload.deliveryDate, "deliveryDate"),
        remark: optionalText(payload.remark),
        intakeStatus: state.intakeStatus,
        stage: state.stage,
        patternStatus: state.patternStatus,
        patternSourceType: patternSourceTypeFromPatternStatus(state.patternStatus),
        sampleRequestItems,
        sampleGarmentRequired: sampleGarmentRequired(sampleRequestItems),
        fabricStatus:
          payload.fabricStatus !== undefined
            ? requireMaterialStatus(payload.fabricStatus, "fabricStatus")
            : state.fabricStatus,
        trimStatus:
          payload.trimStatus !== undefined
            ? requireMaterialStatus(payload.trimStatus, "trimStatus")
            : state.trimStatus,
        receivedAt: new Date().toISOString(),
        receivedBy: currentUser.id
      });
      await syncPatternTaskForOrder(repository, created);
      return created;
    });
    await ensureOrderFolder(this.repository, order, currentUser, this.env);
    for (const attachment of intakeAttachments) {
      await this.createAttachmentMetadata(
        normalizeReceiverAttachmentPayload(
          {
            ...(typeof attachment === "object" && attachment !== null ? attachment : {}),
            visibility:
              typeof attachment === "object" && attachment !== null
                ? (attachment as AttachmentMetadataPayload).visibility
                : undefined
          },
          currentUser,
          order.id
        )
      );
    }
    return order;
  }

  private async nextReceiverQuickPhotoDisplayName(customerId: string, clientUserId: string) {
    const customer = await this.repository.findCustomerById(customerId);
    const clientUser = await this.repository.findClientUserById(clientUserId);
    const dateKey = formatLocalDate(new Date()).replaceAll("-", "");
    const prefix = [
      displayNameSegment(customer?.name ?? "CUSTOMER", "CUSTOMER"),
      displayNameSegment(clientUser?.displayName ?? "USER", "USER"),
      dateKey
    ].join("_");
    const existing = (await this.repository.listOrders()).filter(
      (order) =>
        order.customerId === customerId &&
        order.clientUserId === clientUserId &&
        order.styleNo.startsWith(`${prefix}_`)
    );
    const sequence =
      existing.reduce((max, order) => {
        const suffix = Number(order.styleNo.slice(`${prefix}_`.length));
        return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
      }, 0) + 1;

    return `${prefix}_${String(sequence).padStart(3, "0")}`;
  }

  async createQuickPhotoEntry(payload: QuickPhotoPayload, currentUser: CurrentUser): Promise<ReceiverOrderDto> {
    if (!canReceiverCreateSelfEntry(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }

    const customerId = requireText(payload.customerId, "customerId");
    const clientUserId = requireText(payload.clientUserId, "clientUserId");
    await ensureActiveCustomerBinding(this.repository, customerId, clientUserId);

    const attachments = normalizeAttachmentList(payload.attachments);
    if (attachments.length === 0) {
      throw new HttpError(400, "at least one photo or document is required.");
    }
    const thumbnailAttachmentIndex = optionalAttachmentIndex(
      payload.thumbnailAttachmentIndex,
      attachments.length
    );
    const intakeAttachments = receiverIntakeAttachments(attachments, thumbnailAttachmentIndex);
    const startsWorkflow = payload.sampleRequestItems !== undefined;
    const sampleRequestItems = startsWorkflow
      ? normalizeSampleRequestItems(payload.sampleRequestItems)
      : [];
    if (startsWorkflow && sampleRequestItems.length === 0) {
      throw new HttpError(400, "at least one sample request item is required.");
    }

    const displayName = await this.nextReceiverQuickPhotoDisplayName(customerId, clientUserId);
    const styleNo = optionalText(payload.styleNo) ?? displayName;
    const styleName = optionalText(payload.styleName) ?? styleNo;
    const quantity = startsWorkflow
      ? requireQuantity(payload.quantity)
      : payload.quantity === undefined || payload.quantity === ""
        ? 1
        : requireQuantity(Number(payload.quantity));
    const sampleType =
      payload.sampleType === undefined || payload.sampleType === null || payload.sampleType === ""
        ? "first_sample"
        : await this.sampleTypeService.requireWritableCode(payload.sampleType);
    const sampleRound =
      optionalKnownOption(payload.sampleRound, this.sampleRoundValues, "sampleRound") ??
      "round_1";
    const order = await this.repository.withTransaction(async (repository) => {
      const created = await repository.createOrder({
        customerId,
        clientUserId,
        sourceType: "receiver_self_entry",
        createdBy: currentUser.id,
        styleNo,
        styleName,
        quantity,
        sampleType,
        sampleRound,
        deliveryDate: optionalText(payload.deliveryDate) ?? dateAfterDays(7),
      remark:
        optionalText(payload.remark) ??
        "接单员通过照片/文件快速录入，后续在校正资料中补齐订单信息。",
        intakeStatus: INTAKE_STATUSES.pendingReceive,
        stage: startsWorkflow ? initialPhysicalOrderStage(sampleRequestItems) : null,
        patternStatus: PATTERN_STATUSES.none,
        patternSourceType: PATTERN_SOURCE_TYPES.none,
        sampleRequestItems,
        sampleGarmentRequired: sampleGarmentRequired(sampleRequestItems),
        fabricStatus: MATERIAL_STATUSES.missing,
        trimStatus: MATERIAL_STATUSES.missing
      });
      if (startsWorkflow) {
        await syncPatternTaskForOrder(repository, created);
      }
      return created;
    });
    await ensureOrderFolder(this.repository, order, currentUser, this.env);

    for (const attachment of intakeAttachments) {
      await this.createAttachmentMetadata(
        normalizeReceiverAttachmentPayload(
          {
            ...(typeof attachment === "object" && attachment !== null ? attachment : {}),
            visibility:
              typeof attachment === "object" && attachment !== null
                ? (attachment as AttachmentMetadataPayload).visibility
                : undefined
          },
          currentUser,
          order.id
        )
      );
    }

    return this.withAttachments(order, await loadAccountDisplayNames(this.accounts));
  }

  async listOrders(): Promise<ReceiverOrderDto[]> {
    const [orders, accountNames] = await Promise.all([
      this.repository.listOrders(),
      loadAccountDisplayNames(this.accounts)
    ]);
    return Promise.all(
      orders
        .map(async (order) => {
          const dto = await this.withAttachments(order, accountNames);
          return order.terminated
            ? {
                ...dto,
                attachments: [],
                attachmentLogs: [],
                patternTask: undefined,
                orderFolder: undefined
              }
            : dto;
        })
    );
  }

  async listOrderAttachments(id: string, currentUser: CurrentUser): Promise<OrderAttachmentRecord[]> {
    const order = await this.requireReceiverReadableOrder(id, currentUser);
    const [attachments, accountNames] = await Promise.all([
      this.repository.listOrderAttachments(order.id),
      loadAccountDisplayNames(this.accounts)
    ]);
    return ordinaryOrderAttachments(attachments).map((attachment) =>
      attachmentForWebResponseWithAccountNames(attachment, accountNames)
    );
  }

  async listOrderScanRecords(id: string, currentUser: CurrentUser) {
    const order = await this.requireReceiverReadableOrder(id, currentUser);
    return this.repository.listScanRecordsByOrderId(order.id);
  }

  async selectSampleSheetAttachment(
    id: string,
    attachmentId: string,
    currentUser: CurrentUser
  ): Promise<OrderAttachmentRecord[]> {
    const moved: Array<{ attachment: OrderAttachmentRecord; storageKey: string; category: string }> = [];
    let folderRelativePath: string | undefined;
    try {
      await this.repository.withTransaction(async (repository) => {
        const order = await lockActiveOrderForBusinessWrite(repository, id);
        if (!canReceiverAddInternalAttachment(currentUser, order).allowed) {
          throw new HttpError(409, "only active received tracking orders can receive receiver attachments.");
        }
        const attachments = await repository.listOrderAttachments(order.id);
        const target = attachments.find((attachment) => attachment.id === attachmentId);
        if (!target) throw new HttpError(404, "attachment not found.");
        if (target.uploadedBy !== currentUser.id || target.uploadedByRole !== "receiver") {
          throw new HttpError(403, "only your receiver attachments can be selected as the sample sheet.");
        }
        if (!isReceiverSampleSheetFile(target)) {
          throw new HttpError(400, "sample sheet must be an image, PDF, or Excel attachment with a stored file.");
        }
        const changes = [
          ...attachments.filter((attachment) => attachment.id !== target.id && attachment.category === RECEIVER_SAMPLE_SHEET_CATEGORY)
            .map((attachment) => ({ attachment, category: RECEIVER_ATTACHMENT_CATEGORY })),
          ...(target.category !== STYLE_THUMBNAIL_CATEGORY
            ? [{ attachment: target, category: RECEIVER_SAMPLE_SHEET_CATEGORY }]
            : [])
        ];
        if (changes.length > 0 && !this.fileStorage.moveFile) {
          throw new HttpError(503, "file move is not available.");
        }
        const folder = changes.length > 0
          ? await ensureOrderFolder(repository, order, currentUser, this.env)
          : undefined;
        folderRelativePath = folder?.relativePath;
        for (const change of changes) {
          if (!change.attachment.storageKey) continue;
          const storageKey = await this.fileStorage.moveFile!({
            storageKey: change.attachment.storageKey,
            orderFolderRelativePath: folder!.relativePath,
            category: change.category,
            uploaderRole: "receiver"
          });
          moved.push({ attachment: change.attachment, storageKey, category: change.category });
        }
        for (const change of changes) {
          const relocated = moved.find((item) => item.attachment.id === change.attachment.id);
          await repository.updateOrderAttachment(order.id, change.attachment.id, {
            category: change.category,
            ...(relocated ? { storageKey: relocated.storageKey } : {})
          });
        }
      });
    } catch (error) {
      for (const item of [...moved].reverse()) {
        try {
          await this.fileStorage.moveFile!({
            storageKey: item.storageKey,
            orderFolderRelativePath: folderRelativePath!,
            category: item.attachment.category,
            uploaderRole: "receiver"
          });
        } catch (rollbackError) {
          console.error("sample-sheet attachment move rollback failed", { attachmentId: item.attachment.id, error: rollbackError instanceof Error ? rollbackError.message : "unknown_error" });
        }
      }
      throw error;
    }

    const [updatedAttachments, accountNames] = await Promise.all([
      this.repository.listOrderAttachments(id),
      loadAccountDisplayNames(this.accounts)
    ]);
    return ordinaryOrderAttachments(updatedAttachments).map((attachment) =>
      attachmentForWebResponseWithAccountNames(attachment, accountNames)
    );
  }

  async listAttachmentLogs(id: string, currentUser: CurrentUser) {
    const order = await this.requireReceiverReadableOrder(id, currentUser);
    const [logs, accountNames] = await Promise.all([
      this.repository.listAttachmentAuditLogs(order.id),
      loadAccountDisplayNames(this.accounts)
    ]);
    return logs.map((log) =>
      attachmentAuditLogForWebResponseWithAccountNames(log, accountNames)
    );
  }

  async addOrderAttachments(
    id: string,
    payload: { attachments?: unknown },
    currentUser: CurrentUser
  ): Promise<OrderAttachmentRecord[]> {
    const order = await this.requireReceiverReadableOrder(id, currentUser);
    const attachments = normalizeAttachmentList(payload.attachments);
    const normalizedAttachments = attachments.map((attachment) => {
      const payload = typeof attachment === "object" && attachment !== null
        ? attachment as AttachmentMetadataPayload
        : {};
      return normalizeReceiverAttachmentPayload(
        {
          ...payload,
          category:
            optionalText(payload.category) === RECEIVER_MATERIAL_RECORD_CATEGORY
              ? RECEIVER_MATERIAL_RECORD_CATEGORY
              : "receiver_attachment",
          ...(optionalText(payload.category) === RECEIVER_MATERIAL_RECORD_CATEGORY
            ? { visibility: ATTACHMENT_VISIBILITY.internalOnly }
            : {})
        },
        currentUser,
        order.id
      );
    });
    const materialRecordOnly =
      normalizedAttachments.length > 0 &&
      normalizedAttachments.every(
        (attachment) => attachment.category === RECEIVER_MATERIAL_RECORD_CATEGORY
      );
    const storedKeys: string[] = [];
    let created: OrderAttachmentRecord[];
    try {
      created = await this.repository.withTransaction(async (repository) => {
        const freshOrder = await lockActiveOrderForBusinessWrite(repository, order.id);
        const decision = materialRecordOnly
          ? canReceiverAddMaterialRecord(currentUser, freshOrder)
          : canReceiverAddInternalAttachment(currentUser, freshOrder);
        if (!decision.allowed) {
          throw new HttpError(
            409,
            materialRecordOnly
              ? "only non-terminated formal orders can receive material records."
              : "only active received tracking orders can receive receiver attachments."
          );
        }
        const folder = await ensureOrderFolder(
          repository,
          freshOrder,
          currentUser.id,
          this.env
        );
        const records: OrderAttachmentRecord[] = [];
        for (const attachment of normalizedAttachments) {
          let stored: Awaited<ReturnType<FileStorageAdapter["saveFile"]>> | undefined;
          if (attachment.buffer || attachment.temporaryPath) {
            stored = await this.fileStorage.saveFile({
              orderId: freshOrder.id,
              folderCode: freshOrder.folderCode,
              orderFolderRelativePath: folder.relativePath,
              category: attachment.category,
              uploaderRole: attachment.uploadedByRole,
              originalName: attachment.fileName,
              contentType: attachment.mimeType,
              buffer: attachment.buffer,
              temporaryPath: attachment.temporaryPath,
              checksum: attachment.checksum
            });
            storedKeys.push(stored.storageKey);
          }
          const { buffer: _buffer, temporaryPath: _temporaryPath, checksum: _checksum, ...metadata } = attachment;
          records.push(await repository.createOrderAttachment({
            ...metadata,
            fileName: stored?.originalName ?? metadata.fileName,
            mimeType: stored?.contentType ?? metadata.mimeType,
            size: stored?.sizeBytes ?? metadata.size,
            storageKey: stored?.storageKey,
            checksum: stored?.checksum
          }));
        }
        return records;
      });
    } catch (error) {
      await Promise.allSettled(
        storedKeys.map((storageKey) => this.fileStorage.deleteFile(storageKey))
      );
      throw error;
    }
    const accountNames = await loadAccountDisplayNames(this.accounts);
    return created.map((attachment) =>
      attachmentForWebResponseWithAccountNames(attachment, accountNames)
    );
  }

  async deleteOrderAttachment(
    id: string,
    attachmentId: string,
    currentUser: CurrentUser
  ): Promise<OrderAttachmentRecord[]> {
    await this.repository.withTransaction(async (repository) => {
      const order = await lockActiveOrderForBusinessWrite(repository, id);
      if (!canReceiverViewOrder(currentUser, order).allowed) {
        throw new HttpError(403, "forbidden");
      }
      const attachment = ordinaryOrderAttachments(await repository.listOrderAttachments(order.id)).find(
        (item) => item.id === attachmentId
      );
      if (!attachment) throw new HttpError(404, "attachment not found.");
      const manager = currentUser.role === ROLES.boss || currentUser.role === ROLES.systemOwner;
      if (!manager && (!attachment.uploadedBy || attachment.uploadedBy !== currentUser.id)) {
        throw new HttpError(403, "only the original uploader can delete this attachment.");
      }
      if (attachment.storageKey) {
        try {
          await this.fileStorage.deleteFile(attachment.storageKey);
        } catch (error) {
          if (!(error instanceof FileStorageNotFoundError)) throw error;
        }
      }
      const deleted = await repository.deleteOrderAttachment(order.id, attachmentId, {
        id: currentUser.id,
        name: currentUser.displayName,
        role: currentUser.role
      });
      if (!deleted) throw new HttpError(404, "attachment not found.");
    });

    const [remainingAttachments, accountNames] = await Promise.all([
      this.repository.listOrderAttachments(id),
      loadAccountDisplayNames(this.accounts)
    ]);
    return ordinaryOrderAttachments(remainingAttachments).map((item) =>
      attachmentForWebResponseWithAccountNames(item, accountNames)
    );
  }

  async renameOrderAttachment(
    id: string,
    attachmentId: string,
    payload: { displayName?: unknown },
    currentUser: CurrentUser
  ): Promise<OrderAttachmentRecord[]> {
    await this.repository.withTransaction(async (repository) => {
      const order = await lockActiveOrderForBusinessWrite(repository, id);
      if (!canReceiverViewOrder(currentUser, order).allowed) throw new HttpError(403, "forbidden");
      const attachment = ordinaryOrderAttachments(await repository.listOrderAttachments(order.id)).find(
        (item) => item.id === attachmentId
      );
      if (!attachment) throw new HttpError(404, "attachment not found.");
      const manager = currentUser.role === ROLES.boss || currentUser.role === ROLES.systemOwner;
      if (!manager && attachment.uploadedBy !== currentUser.id) {
        throw new HttpError(403, "only the original uploader can rename this attachment.");
      }
      const fileName = renamedDisplayFileName(attachment.fileName, payload.displayName);
      const updated = await repository.updateOrderAttachment(order.id, attachment.id, { fileName });
      if (!updated) throw new HttpError(404, "attachment not found.");
      await repository.appendAttachmentAuditLog({
        orderId: order.id,
        attachmentId: attachment.id,
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
    });
    const [updatedAttachments, accountNames] = await Promise.all([
      this.repository.listOrderAttachments(id),
      loadAccountDisplayNames(this.accounts)
    ]);
    return ordinaryOrderAttachments(updatedAttachments).map((item) =>
      attachmentForWebResponseWithAccountNames(item, accountNames)
    );
  }

  async changeOrderAttachmentVisibility(
    id: string,
    attachmentId: string,
    payload: { visibility?: unknown },
    currentUser: CurrentUser
  ): Promise<OrderAttachmentRecord[]> {
    const visibility = attachmentVisibilityFromInput(
      typeof payload.visibility === "string" ? payload.visibility : undefined,
      ATTACHMENT_VISIBILITY.internalOnly
    );
    await this.repository.withTransaction(async (repository) => {
      const order = await lockActiveOrderForBusinessWrite(repository, id);
      if (!canReceiverViewOrder(currentUser, order).allowed) throw new HttpError(403, "forbidden");
      const attachment = ordinaryOrderAttachments(await repository.listOrderAttachments(order.id)).find(
        (item) => item.id === attachmentId
      );
      if (!attachment) throw new HttpError(404, "attachment not found.");
      const manager = currentUser.role === ROLES.boss || currentUser.role === ROLES.systemOwner;
      if (!manager && attachment.uploadedBy !== currentUser.id) {
        throw new HttpError(403, "attachment_operation_forbidden");
      }
      const updated = await repository.updateOrderAttachment(order.id, attachment.id, { visibility });
      if (!updated) throw new HttpError(404, "attachment not found.");
      await auditAttachmentVisibilityChange({
        repository,
        operationLogs: this.operationLogs,
        orderId: order.id,
        resourceId: attachment.id,
        source: "order_attachment",
        originalFileName: attachment.fileName,
        originalVisibility: attachment.visibility,
        newVisibility: visibility,
        currentUser,
        originalUploaderId: attachment.uploadedBy,
        originalUploaderName: attachment.uploadedByName,
        originalUploaderRole: attachment.uploadedByRole,
        attachmentCategory: attachment.category,
        sourceCategory: attachment.sourceCategory,
        patternTaskId: attachment.patternTaskId,
        patternTaskCategory: attachment.patternTaskCategory
      });
    });
    const [updatedAttachments, accountNames] = await Promise.all([
      this.repository.listOrderAttachments(id),
      loadAccountDisplayNames(this.accounts)
    ]);
    return ordinaryOrderAttachments(updatedAttachments).map((item) =>
      attachmentForWebResponseWithAccountNames(item, accountNames)
    );
  }

  async downloadOrderAttachment(
    id: string,
    attachmentId: string,
    currentUser: CurrentUser
  ): Promise<AttachmentDownload> {
    const order = await this.requireReceiverReadableOrder(id, currentUser);
    const attachment = ordinaryOrderAttachments(await this.repository.listOrderAttachments(order.id)).find(
      (item) => item.id === attachmentId
    );
    if (!attachment) {
      throw new HttpError(404, "attachment not found.");
    }

    if (!attachment.storageKey) {
      throw new HttpError(404, "attachment file is not available.");
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
        throw new HttpError(404, "attachment file is not available.");
      }

      throw error;
    }
  }

  async listSelfEntryOptions(): Promise<ReceiverSelfEntryOptions> {
    const allCustomers = await this.repository.listCustomers();
    const customers = await Promise.all(
      allCustomers
      .filter((customer) => customer.status === "active")
      .map(async (customer) => ({
        id: customer.id,
        name: customer.name,
        clientUsers: (await this.repository
          .listClientUsersByCustomerId(customer.id))
          .filter(
            (clientUser) =>
              clientUser.customerId === customer.id &&
              clientUser.status === "active"
          )
          .map((clientUser) => ({
            id: clientUser.id,
            customerId: clientUser.customerId,
            displayName: clientUser.displayName
          }))
      }))
    );

    return { customers: customers.filter((customer) => customer.clientUsers.length > 0) };
  }
}
