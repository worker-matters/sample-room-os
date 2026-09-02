import {
  ATTACHMENT_VISIBILITY,
  CLIENT_ACCESS_SCOPES,
  createClientSubmissionInitialState,
  deriveOrderCompletionStatus,
  INTAKE_STATUSES,
  MATERIAL_STATUSES,
  PATTERN_STATUSES,
  type MaterialStatus,
  type PatternStatus,
  sampleRoundOptions
} from "@sample-room/shared";
import { readSheet } from "read-excel-file/node";
import { assertSafeXlsxImport } from "./xlsxImportSafety.js";
import type { CurrentUser } from "../auth/currentUser.js";
import {
  canClientViewAttachment,
  canClientAddOrderAttachment,
  canClientCreateOrder,
  canClientReadOrder,
  canClientSupplementOrder,
  hasActiveClientBinding,
  isActiveOwnScopeClientUserForCustomer
} from "../auth/permissionPolicy.js";
import {
  FileStorageNotFoundError,
  type FileStorageAdapter
} from "../files/fileStorageAdapter.js";
import { attachmentForWebResponse } from "../files/attachmentDto.js";
import { attachmentVisibilityFromInput } from "../files/attachmentVisibility.js";
import { ordinaryOrderAttachments } from "../files/qcAttachmentCategories.js";
import { createLocalFileStorageAdapter } from "../files/localFileStorageAdapter.js";
import { ensureOrderFolder } from "../patterns/orderFolderService.js";
import { completedPatternRequirementsFromDeliverables } from "../patterns/patternCompletionRules.js";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { SampleTypeService } from "../sample-types/sampleTypeService.js";
import type {
  ClientOrderDto,
  ClientOrderAttachmentDto,
  ClientPatternTaskSummary,
  ClientUserRecord,
  CustomerRecord,
  OrderAttachmentCreateInput,
  OrderAttachmentRecord,
  OrderRecord
} from "./orderTypes.js";
import { lockActiveOrderForBusinessWrite } from "./orderWriteBoundary.js";

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

export type AttachmentDownload = {
  fileName: string;
  mimeType: string;
  size: number;
  content: Buffer;
};

type ClientOrderPayload = {
  styleNo?: unknown;
  styleName?: unknown;
  quantity?: unknown;
  sampleType?: unknown;
  sampleRound?: unknown;
  patternStatus?: unknown;
  deliveryDate?: unknown;
  remark?: unknown;
  attachments?: unknown;
};

type ClientSupplementPayload = Partial<ClientOrderPayload>;

const legacyExcelImportHeaders = [
  "款号",
  "款名",
  "样品类别",
  "样品轮次",
  "数量",
  "期望交期",
  "\u7248\u5b50\u72b6\u6001",
  "面里料状态",
  "辅料状态",
  "备注"
] as const;

const excelImportHeaders = legacyExcelImportHeaders.filter(
  (header) => header !== "\u7248\u5b50\u72b6\u6001"
);

export type ClientExcelImportRowInput = {
  styleNo: string;
  styleName: string;
  sampleType: string;
  sampleRound: string;
  quantity: number;
  deliveryDate: string;
  patternStatus: PatternStatus;
  fabricStatus: MaterialStatus;
  trimStatus: MaterialStatus;
  remark?: string;
};

export type ClientExcelImportPreviewRow = {
  rowNumber: number;
  valid: boolean;
  errors: string[];
  data?: ClientExcelImportRowInput;
};

type ClientExcelImportPayload = {
  rows?: unknown;
};

function valueText(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
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

function displayNameSegment(value: string | undefined, fallback: string) {
  const segment = (value ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return segment || fallback;
}

function normalizeDateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatLocalDate(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }

  const text = valueText(value);
  const match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) {
    return "";
  }

  return `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`;
}

function optionAlias<T extends string>(entries: Array<[string, T]>) {
  return new Map(entries.flatMap(([label, value]) => [[label, value], [value, value]]));
}

const sampleTypeAliases = optionAlias([
  ["初样", "first_sample"],
  ["试身样", "fit_sample"],
  ["修改样", "revision_sample"],
  ["产前样", "pre_production_sample"]
] as const);

const sampleRoundAliases = optionAlias([
  ["第 1 轮", "round_1"],
  ["第1轮", "round_1"],
  ["1", "round_1"],
  ["第 2 轮", "round_2"],
  ["第2轮", "round_2"],
  ["2", "round_2"],
  ["第 3 轮", "round_3"],
  ["第3轮", "round_3"],
  ["3", "round_3"],
  ["第 4 轮", "round_4"],
  ["第4轮", "round_4"],
  ["4", "round_4"]
] as const);

const materialStatusAliases = optionAlias([
  ["未齐", MATERIAL_STATUSES.missing],
  ["部分齐", MATERIAL_STATUSES.partial],
  ["齐全", MATERIAL_STATUSES.complete],
  ["全齐", MATERIAL_STATUSES.complete]
] as const);

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

function requireNonNegativeInteger(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, `${field} must be a non-negative integer.`);
  }

  return value;
}

function normalizeAttachmentPayload(
  value: unknown,
  currentUser: CurrentUser,
  orderId: string,
  defaultCategory = "client_reference"
): NormalizedAttachmentInput {
  if (typeof value !== "object" || value === null) {
    throw new HttpError(400, "attachment metadata must be an object.");
  }

  const payload = value as AttachmentMetadataPayload;
  attachmentVisibilityFromInput(
    typeof payload.visibility === "string" ? payload.visibility : undefined,
    ATTACHMENT_VISIBILITY.clientVisible
  );
  return {
    orderId,
    fileName: requireText(payload.fileName, "fileName"),
    mimeType: optionalText(payload.mimeType) ?? "application/octet-stream",
    size: requireNonNegativeInteger(payload.size, "size"),
    category: optionalText(payload.category) ?? defaultCategory,
    uploadedBy: currentUser.id,
    uploadedByRole: currentUser.role,
    uploadedByName: currentUser.displayName,
    visibility: ATTACHMENT_VISIBILITY.clientVisible,
    ...(Buffer.isBuffer(payload.buffer) ? { buffer: payload.buffer } : {}),
    ...(typeof payload.temporaryPath === "string" ? { temporaryPath: payload.temporaryPath } : {}),
    ...(typeof payload.checksum === "string" ? { checksum: payload.checksum } : {})
  };
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

function clientAttachmentForResponse(
  attachment: OrderAttachmentRecord,
  currentUserId?: string
): ClientOrderAttachmentDto {
  const safe = attachmentForWebResponse(attachment);
  return {
    id: safe.id,
    orderId: safe.orderId,
    fileName: safe.fileName,
    mimeType: safe.mimeType,
    size: safe.size,
    category: safe.category,
    createdAt: safe.createdAt,
    visibility: safe.visibility,
    hasFile: safe.hasFile,
    sourceCategory: safe.sourceCategory,
    canDelete: Boolean(currentUserId && attachment.uploadedBy === currentUserId)
  };
}

function clientVisibleAttachments(attachments: OrderAttachmentRecord[], currentUserId?: string) {
  return ordinaryOrderAttachments(attachments)
    .filter((attachment) => attachment.visibility === ATTACHMENT_VISIBILITY.clientVisible)
    .map((attachment) => clientAttachmentForResponse(attachment, currentUserId));
}

function clientPatternTaskForResponse(
  task: Awaited<ReturnType<SampleRoomRepository["findPatternTaskByOrderId"]>>,
  deliverables: Awaited<ReturnType<SampleRoomRepository["listPatternDeliverablesByOrderId"]>> = []
): ClientPatternTaskSummary | undefined {
  if (!task) return undefined;
  return {
    status: task.status,
    requirements: [...task.requirements],
    completedRequirements: completedPatternRequirementsFromDeliverables(
      task.requirements,
      deliverables
    ),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    deliverables: deliverables
      .filter((deliverable) => deliverable.visibility === ATTACHMENT_VISIBILITY.clientVisible)
      .map((deliverable) => ({
        id: deliverable.id,
        version: deliverable.version,
        type: deliverable.type,
        ...(deliverable.fileName ? { fileName: deliverable.fileName } : {}),
        ...(deliverable.mimeType ? { mimeType: deliverable.mimeType } : {}),
        ...(deliverable.size !== undefined ? { size: deliverable.size } : {}),
        createdAt: deliverable.createdAt,
        hasFile: Boolean(deliverable.storageKey)
      }))
  };
}

type ClientBinding = {
  customer: CustomerRecord;
  clientUser: ClientUserRecord;
};

export type ClientOrderListFilters = {
  clientUserId?: unknown;
};

export type ClientBusinessUserDto = Pick<
  ClientUserRecord,
  "id" | "customerId" | "displayName" | "clientAccessScope"
>;

export type ClientOrderListDto = {
  orders: ClientOrderDto[];
  clientAccessScope: ClientUserRecord["clientAccessScope"];
  clientUsers: ClientBusinessUserDto[];
};

export function sanitizeOrderForClient(
  order: OrderRecord,
  attachments: OrderAttachmentRecord[] = [],
  patternTask?: Awaited<ReturnType<SampleRoomRepository["findPatternTaskByOrderId"]>>,
  deliverables: Awaited<ReturnType<SampleRoomRepository["listPatternDeliverablesByOrderId"]>> = [],
  currentUserId?: string
): ClientOrderDto {
  const visibleAttachments = clientVisibleAttachments(attachments, currentUserId);
  const safePatternTask = clientPatternTaskForResponse(patternTask, deliverables);
  return {
    id: order.id,
    orderNo: order.orderNo,
    sourceType: order.sourceType,
    customerId: order.customerId,
    clientUserId: order.clientUserId,
    customerName: order.customerName,
    salespersonId: order.salespersonId,
    salespersonName: order.salespersonName,
    customerSnapshot: order.customerSnapshot,
    clientUserSnapshot: order.clientUserSnapshot,
    styleNo: order.styleNo,
    styleName: order.styleName,
    quantity: order.quantity,
    sampleType: order.sampleType,
    sampleRound: order.sampleRound,
    deliveryDate: order.deliveryDate,
    remark: order.remark,
    intakeStatus: order.intakeStatus,
    stage: order.stage,
    patternStatus: order.patternStatus,
    fabricStatus: order.fabricStatus,
    trimStatus: order.trimStatus,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    returnReason: order.returnReason,
    returnedAt: order.returnedAt,
    supplementCount: order.supplementCount,
    supplementedAt: order.supplementedAt,
    sampleRequestItems: order.sampleRequestItems,
    attachmentCount: visibleAttachments.length,
    attachments: visibleAttachments,
    completionStatus: deriveOrderCompletionStatus({
      sampleRequestItems: order.sampleRequestItems,
      orderStage: order.stage,
      patternTaskStatus: patternTask?.status
    }),
    ...(safePatternTask ? { patternTask: safePatternTask } : {})
  };
}

export class OrderService {
  constructor(
    private readonly repository: SampleRoomRepository,
    private readonly sampleTypeService: SampleTypeService,
    private readonly fileStorage: FileStorageAdapter = createLocalFileStorageAdapter(),
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  private readonly sampleRoundValues = new Set(sampleRoundOptions.map((option) => option.value));
  private readonly patternStatusValues = new Set<string>(Object.values(PATTERN_STATUSES));

  private async clientOrderDto(order: OrderRecord, currentUserId?: string): Promise<ClientOrderDto> {
    const [attachments, patternTask, deliverables] = await Promise.all([
      this.repository.listOrderAttachments(order.id),
      this.repository.findPatternTaskByOrderId(order.id),
      this.repository.listPatternDeliverablesByOrderId(order.id)
    ]);
    return sanitizeOrderForClient(order, attachments, patternTask, deliverables, currentUserId);
  }

  private async requireActiveClientBinding(currentUser: CurrentUser): Promise<ClientBinding> {
    if (!currentUser.customerId || !currentUser.clientUserId) {
      throw new HttpError(403, "client user session is missing customer binding.");
    }

    const customer = await this.repository.findCustomerById(currentUser.customerId);
    const clientUser = await this.repository.findClientUserById(currentUser.clientUserId);

    if (!customer || !clientUser || !hasActiveClientBinding(currentUser, customer, clientUser).allowed) {
      throw new HttpError(403, "client user is not bound to an active customer.");
    }

    return { customer, clientUser };
  }

  private async requireOwnScopeClientCreator(currentUser: CurrentUser): Promise<ClientBinding> {
    const binding = await this.requireActiveClientBinding(currentUser);
    if (!canClientCreateOrder(currentUser, binding.customer.id, binding.clientUser.id, binding.clientUser).allowed) {
      throw new HttpError(403, "customer admin accounts cannot create sample requests in this phase.");
    }

    return binding;
  }

  private async listActiveClientBusinessUsers(customerId: string): Promise<ClientBusinessUserDto[]> {
    const clientUsers = await this.repository.listClientUsersByCustomerId(customerId);
    return clientUsers
      .filter((clientUser) => isActiveOwnScopeClientUserForCustomer(customerId, clientUser).allowed)
      .map((clientUser) => ({
        id: clientUser.id,
        customerId: clientUser.customerId,
        displayName: clientUser.displayName,
        clientAccessScope: clientUser.clientAccessScope
      }));
  }

  private async optionalClientUserFilter(
    value: unknown,
    binding: ClientBinding
  ): Promise<string | undefined> {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (Array.isArray(value)) {
      throw new HttpError(400, "clientUserId filter must be a string.");
    }

    const clientUserId = requireText(value, "clientUserId");
    const clientUser = await this.repository.findClientUserById(clientUserId);
    if (!isActiveOwnScopeClientUserForCustomer(binding.customer.id, clientUser).allowed) {
      throw new HttpError(400, "clientUserId filter is not available for this customer.");
    }

    return clientUserId;
  }

  private canReadOrder(currentUser: CurrentUser, binding: ClientBinding, order: OrderRecord) {
    return canClientReadOrder(currentUser, binding.clientUser, order).allowed;
  }

  private async createAttachmentMetadata(
    attachment: NormalizedAttachmentInput
  ): Promise<OrderAttachmentRecord> {
    if (!attachment.buffer && !attachment.temporaryPath) {
      return attachmentForWebResponse(await this.repository.createOrderAttachment(attachment));
    }

    const order = await this.repository.findOrderById(attachment.orderId);
    const folder = order
      ? await ensureOrderFolder(this.repository, order, attachment.uploadedBy, this.env)
      : undefined;
    const stored = await this.fileStorage.saveFile({
      orderId: attachment.orderId,
      folderCode: order?.folderCode,
      orderFolderRelativePath: folder?.relativePath,
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
      return attachmentForWebResponse(
        await this.repository.createOrderAttachment({
          ...metadata,
          fileName: stored.originalName,
          mimeType: stored.contentType,
          size: stored.sizeBytes,
          storageKey: stored.storageKey,
          checksum: stored.checksum
        })
      );
    } catch (error) {
      await this.fileStorage.deleteFile(stored.storageKey);
      throw error;
    }
  }

  private async requireClientReadableOrder(currentUser: CurrentUser, orderId: string): Promise<OrderRecord> {
    const binding = await this.requireActiveClientBinding(currentUser);

    const order = await this.repository.findOrderById(orderId);
    if (!order || !this.canReadOrder(currentUser, binding, order)) {
      throw new HttpError(404, "order not found.");
    }

    return order;
  }

  private async createClientSubmissionOrder(
    currentUser: CurrentUser,
    binding: ClientBinding,
    payload: {
      styleNo: string;
      styleName: string;
      quantity: number;
      sampleType: string;
      sampleRound: string;
      deliveryDate: string;
      patternStatus: PatternStatus;
      fabricStatus?: MaterialStatus;
      trimStatus?: MaterialStatus;
      remark?: string | undefined;
      attachments?: unknown;
      defaultAttachmentCategory?: string;
      sampleRequestItems?: OrderRecord["sampleRequestItems"];
    }
  ): Promise<ClientOrderDto> {
    const state = createClientSubmissionInitialState();
    const order = await this.repository.createOrder({
      customerId: binding.customer.id,
      clientUserId: binding.clientUser.id,
      sourceType: "client_submission",
      createdBy: currentUser.id,
      styleNo: payload.styleNo,
      styleName: payload.styleName,
      quantity: payload.quantity,
      sampleType: payload.sampleType,
      sampleRound: payload.sampleRound,
      deliveryDate: payload.deliveryDate,
      remark: payload.remark,
      intakeStatus: state.intakeStatus,
      stage: state.stage,
      patternStatus: payload.patternStatus,
      fabricStatus: payload.fabricStatus ?? MATERIAL_STATUSES.missing,
      trimStatus: payload.trimStatus ?? MATERIAL_STATUSES.missing,
      ...(payload.sampleRequestItems !== undefined
        ? { sampleRequestItems: payload.sampleRequestItems }
        : {})
    });

    await ensureOrderFolder(this.repository, order, currentUser, this.env);

    for (const attachment of normalizeAttachmentList(payload.attachments)) {
      await this.createAttachmentMetadata(
        normalizeAttachmentPayload(
          attachment,
          currentUser,
          order.id,
          payload.defaultAttachmentCategory
        )
      );
    }

    return this.clientOrderDto(order, currentUser.id);
  }

  async createClientOrder(currentUser: CurrentUser, payload: ClientOrderPayload): Promise<ClientOrderDto> {
    const binding = await this.requireOwnScopeClientCreator(currentUser);

    return this.createClientSubmissionOrder(currentUser, binding, {
      styleNo: requireText(payload.styleNo, "styleNo"),
      styleName: requireText(payload.styleName, "styleName"),
      quantity: requireQuantity(payload.quantity),
      sampleType: await this.sampleTypeService.requireWritableCode(payload.sampleType),
      sampleRound: requireKnownOption(payload.sampleRound, this.sampleRoundValues, "sampleRound"),
      deliveryDate: requireText(payload.deliveryDate, "deliveryDate"),
      remark: optionalText(payload.remark),
      patternStatus: requireKnownOption(
        payload.patternStatus,
        this.patternStatusValues,
        "patternStatus"
      ) as PatternStatus,
      attachments: payload.attachments
    });
  }

  private async nextQuickPhotoDisplayName(binding: ClientBinding) {
    const dateKey = formatLocalDate(new Date()).replaceAll("-", "");
    const prefix = [
      displayNameSegment(binding.customer.name, "CUSTOMER"),
      displayNameSegment(binding.clientUser.displayName, "USER"),
      dateKey
    ].join("_");
    const existing = (await this.repository.listOrders()).filter(
      (order) =>
        order.customerId === binding.customer.id &&
        order.clientUserId === binding.clientUser.id &&
        order.styleNo.startsWith(`${prefix}_`)
    );
    const sequence =
      existing.reduce((max, order) => {
        const suffix = Number(order.styleNo.slice(`${prefix}_`.length));
        return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
      }, 0) + 1;

    return `${prefix}_${String(sequence).padStart(3, "0")}`;
  }

  async createClientQuickPhotoOrder(
    currentUser: CurrentUser,
    payload: Pick<ClientOrderPayload, "attachments">
  ): Promise<ClientOrderDto> {
    const binding = await this.requireOwnScopeClientCreator(currentUser);
    const attachments = normalizeAttachmentList(payload.attachments);
    if (attachments.length === 0) {
      throw new HttpError(400, "at least one photo or screenshot is required.");
    }

    const displayName = await this.nextQuickPhotoDisplayName(binding);
    return this.createClientSubmissionOrder(currentUser, binding, {
      styleNo: displayName,
      styleName: displayName,
      quantity: 1,
      sampleType: "first_sample",
      sampleRound: "round_1",
      deliveryDate: dateAfterDays(7),
      patternStatus: PATTERN_STATUSES.none,
      remark: "客户通过截图/照片快速录入，接单员后续根据图片补齐订单资料。",
      attachments,
      defaultAttachmentCategory: "client_quick_photo",
      sampleRequestItems: []
    });
  }

  private normalizeImportOption<T extends string>(
    value: unknown,
    aliases: Map<string, T>,
    field: string
  ): T {
    const text = valueText(value);
    const option = aliases.get(text);
    if (!option) {
      throw new HttpError(400, `${field} is not an allowed option.`);
    }

    return option;
  }

  private async parseExcelImportRows(buffer: Buffer): Promise<unknown[][]> {
    assertSafeXlsxImport(buffer);
    try {
      return await readSheet(buffer, 1);
    } catch {
      throw new HttpError(400, "uploaded file is not a readable Excel workbook.");
    }
  }

  private validateExcelHeaders(headers: unknown[]) {
    const normalized = headers.map(valueText);
    const matches = (expected: readonly string[]) =>
      expected.every((header, index) => normalized[index] === header);
    if (matches(excelImportHeaders)) {
      return false;
    }
    if (matches(legacyExcelImportHeaders)) {
      return true;
    }
    throw new HttpError(400, "uploaded Excel does not match the fixed customer order template.");
  }

  private previewExcelDataRow(
    rowNumber: number,
    row: unknown[],
    hasLegacyPatternStatusColumn = false
  ): ClientExcelImportPreviewRow | undefined {
    if (row.every((cell) => valueText(cell).length === 0)) {
      return undefined;
    }

    const errors: string[] = [];
    const normalizedRow = hasLegacyPatternStatusColumn
      ? row
      : [...row.slice(0, 6), PATTERN_STATUSES.none, ...row.slice(6)];
    const [styleNoValue, styleNameValue, sampleTypeValue, sampleRoundValue, quantityValue, deliveryDateValue, , fabricStatusValue, trimStatusValue, remarkValue] = normalizedRow;
    const styleNo = valueText(styleNoValue);
    const styleName = valueText(styleNameValue);
    const quantity = typeof quantityValue === "number" ? quantityValue : Number(valueText(quantityValue));
    const deliveryDate = normalizeDateValue(deliveryDateValue);
    let sampleType = "";
    let sampleRound = "";
    const patternStatus: PatternStatus = PATTERN_STATUSES.none;
    let fabricStatus: MaterialStatus = MATERIAL_STATUSES.missing;
    let trimStatus: MaterialStatus = MATERIAL_STATUSES.missing;

    if (!styleNo) {
      errors.push("款号不能为空");
    }
    if (!styleName) {
      errors.push("款名不能为空");
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      errors.push("数量必须是正整数");
    }
    if (!deliveryDate) {
      errors.push("期望交期必须使用 YYYY-MM-DD 日期");
    }

    try {
      sampleType = this.normalizeImportOption(sampleTypeValue, sampleTypeAliases, "sampleType");
    } catch {
      errors.push("样品类别不在固定选项内");
    }
    try {
      sampleRound = this.normalizeImportOption(sampleRoundValue, sampleRoundAliases, "sampleRound");
    } catch {
      errors.push("样品轮次不在固定选项内");
    }
    try {
      fabricStatus = this.normalizeImportOption(fabricStatusValue, materialStatusAliases, "fabricStatus");
    } catch {
      errors.push("面里料状态不在固定选项内");
    }
    try {
      trimStatus = this.normalizeImportOption(trimStatusValue, materialStatusAliases, "trimStatus");
    } catch {
      errors.push("辅料状态不在固定选项内");
    }

    const preview: ClientExcelImportPreviewRow = {
      rowNumber,
      valid: errors.length === 0,
      errors
    };

    if (preview.valid) {
      const data: ClientExcelImportRowInput = {
        styleNo,
        styleName,
        sampleType,
        sampleRound,
        quantity,
        deliveryDate,
        patternStatus,
        fabricStatus,
        trimStatus
      };
      const remark = optionalText(remarkValue);
      if (remark) {
        data.remark = remark;
      }
      preview.data = data;
    }

    return preview;
  }

  async previewClientExcelImport(
    currentUser: CurrentUser,
    payload: Pick<ClientOrderPayload, "attachments">
  ): Promise<{
    totalRows: number;
    validRows: ClientExcelImportRowInput[];
    invalidRows: ClientExcelImportPreviewRow[];
    rows: ClientExcelImportPreviewRow[];
  }> {
    await this.requireOwnScopeClientCreator(currentUser);
    const attachments = normalizeAttachmentList(payload.attachments).filter((attachment) =>
      typeof attachment === "object" &&
      attachment !== null &&
      Buffer.isBuffer((attachment as AttachmentMetadataPayload).buffer)
    ) as (AttachmentMetadataPayload & { buffer: Buffer })[];
    if (attachments.length !== 1) {
      throw new HttpError(400, "Excel file is required.");
    }
    const file = attachments[0]!;

    const rows = await this.parseExcelImportRows(file.buffer);
    if (rows.length - 1 > 1000) {
      throw new HttpError(413, "Excel import supports at most 1000 data rows.");
    }
    const hasLegacyPatternStatusColumn = this.validateExcelHeaders(rows[0] ?? []);
    const previewRows = rows
      .slice(1)
      .map((row, index) => this.previewExcelDataRow(index + 2, row, hasLegacyPatternStatusColumn))
      .filter((row): row is ClientExcelImportPreviewRow => Boolean(row));

    return {
      totalRows: previewRows.length,
      validRows: previewRows.flatMap((row) => (row.data ? [row.data] : [])),
      invalidRows: previewRows.filter((row) => !row.valid),
      rows: previewRows
    };
  }

  private validateConfirmImportRow(row: unknown, index: number): ClientExcelImportPreviewRow {
    if (typeof row !== "object" || row === null) {
      return {
        rowNumber: index + 1,
        valid: false,
        errors: ["导入行必须是固定模板预览返回的数据"]
      };
    }

    const source = row as Record<string, unknown>;
    return this.previewExcelDataRow(index + 1, [
      source.styleNo,
      source.styleName,
      source.sampleType,
      source.sampleRound,
      source.quantity,
      source.deliveryDate,
      source.fabricStatus,
      source.trimStatus,
      source.remark
    ]) ?? {
      rowNumber: index + 1,
      valid: false,
      errors: ["导入行不能为空"]
    };
  }

  async confirmClientExcelImport(
    currentUser: CurrentUser,
    payload: ClientExcelImportPayload
  ): Promise<{
    orders: ClientOrderDto[];
    invalidRows: ClientExcelImportPreviewRow[];
    createdCount: number;
  }> {
    const binding = await this.requireOwnScopeClientCreator(currentUser);
    if (!Array.isArray(payload.rows)) {
      throw new HttpError(400, "rows must be an array from the Excel preview result.");
    }
    if (payload.rows.length > 1000) {
      throw new HttpError(413, "Excel import supports at most 1000 data rows.");
    }

    const previewRows = payload.rows.map((row, index) => this.validateConfirmImportRow(row, index));
    const validRows = previewRows.flatMap((row) => (row.data ? [row.data] : []));
    const invalidRows = previewRows.filter((row) => !row.valid);
    const orders: ClientOrderDto[] = [];

    for (const row of validRows) {
      orders.push(
        await this.createClientSubmissionOrder(currentUser, binding, {
          styleNo: row.styleNo,
          styleName: row.styleName,
          quantity: row.quantity,
          sampleType: row.sampleType,
          sampleRound: row.sampleRound,
          deliveryDate: row.deliveryDate,
          patternStatus: row.patternStatus,
          fabricStatus: row.fabricStatus,
          trimStatus: row.trimStatus,
          remark: row.remark
        })
      );
    }

    return { orders, invalidRows, createdCount: orders.length };
  }

  async listClientOrders(
    currentUser: CurrentUser,
    filters: ClientOrderListFilters = {}
  ): Promise<ClientOrderListDto> {
    const binding = await this.requireActiveClientBinding(currentUser);
    const filterClientUserId =
      binding.clientUser.clientAccessScope === CLIENT_ACCESS_SCOPES.customerAll
        ? await this.optionalClientUserFilter(filters.clientUserId, binding)
        : undefined;

    const allOrders = await this.repository.listOrders();
    const orders = await Promise.all(
      allOrders
      .filter((order) => this.canReadOrder(currentUser, binding, order))
      .filter((order) => !filterClientUserId || order.clientUserId === filterClientUserId)
      .map((order) => this.clientOrderDto(order, currentUser.id))
    );

    return {
      orders,
      clientAccessScope: binding.clientUser.clientAccessScope,
      clientUsers:
        binding.clientUser.clientAccessScope === CLIENT_ACCESS_SCOPES.customerAll
          ? await this.listActiveClientBusinessUsers(binding.customer.id)
          : []
    };
  }

  async listClientOrderAttachments(currentUser: CurrentUser, orderId: string): Promise<ClientOrderAttachmentDto[]> {
    const order = await this.requireClientReadableOrder(currentUser, orderId);
    return clientVisibleAttachments(await this.repository.listOrderAttachments(order.id), currentUser.id);
  }

  async addClientOrderAttachments(
    currentUser: CurrentUser,
    orderId: string,
    payload: { attachments?: unknown }
  ): Promise<ClientOrderAttachmentDto[]> {
    const binding = await this.requireActiveClientBinding(currentUser);
    if (binding.clientUser.clientAccessScope !== CLIENT_ACCESS_SCOPES.own) {
      throw new HttpError(403, "customer admin accounts cannot change orders in this phase.");
    }
    const attachments = normalizeAttachmentList(payload.attachments);
    const normalized = attachments.map((attachment) =>
      normalizeAttachmentPayload(attachment, currentUser, orderId)
    );
    const storedKeys: string[] = [];
    try {
      const created = await this.repository.withTransaction(async (repository) => {
        const order = await lockActiveOrderForBusinessWrite(repository, orderId);
        if (!canClientAddOrderAttachment(currentUser, binding.clientUser, order).allowed) {
          throw new HttpError(404, "order not found.");
        }
        const folder = await ensureOrderFolder(repository, order, currentUser.id, this.env);
        const records: OrderAttachmentRecord[] = [];
        for (const attachment of normalized) {
          let stored: Awaited<ReturnType<FileStorageAdapter["saveFile"]>> | undefined;
          if (attachment.buffer || attachment.temporaryPath) {
            stored = await this.fileStorage.saveFile({
              orderId: order.id,
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
            storedKeys.push(stored.storageKey);
          }
          const { buffer: _buffer, temporaryPath: _temporaryPath, checksum: _checksum, ...metadata } = attachment;
          records.push(attachmentForWebResponse(await repository.createOrderAttachment({
            ...metadata,
            fileName: stored?.originalName ?? metadata.fileName,
            mimeType: stored?.contentType ?? metadata.mimeType,
            size: stored?.sizeBytes ?? metadata.size,
            storageKey: stored?.storageKey,
            checksum: stored?.checksum
          })));
        }
        return records;
      });
      return clientVisibleAttachments(created, currentUser.id);
    } catch (error) {
      await Promise.allSettled(storedKeys.map((key) => this.fileStorage.deleteFile(key)));
      throw error;
    }
  }

  async deleteClientOrderAttachment(
    currentUser: CurrentUser,
    orderId: string,
    attachmentId: string
  ): Promise<ClientOrderAttachmentDto[]> {
    const binding = await this.requireActiveClientBinding(currentUser);
    return this.repository.withTransaction(async (repository) => {
      const order = await lockActiveOrderForBusinessWrite(repository, orderId);
      if (!this.canReadOrder(currentUser, binding, order)) throw new HttpError(404, "order not found.");
      const attachment = (await repository.listOrderAttachments(order.id)).find(
        (item) => item.id === attachmentId
      );
      if (!attachment || !ordinaryOrderAttachments([attachment]).length || attachment.uploadedBy !== currentUser.id) {
        throw new HttpError(403, "only the original uploader can delete this attachment.");
      }
      if (attachment.storageKey) {
        try {
          await this.fileStorage.deleteFile(attachment.storageKey);
        } catch (error) {
          if (!(error instanceof FileStorageNotFoundError)) throw error;
        }
      }
      const deleted = await repository.deleteOrderAttachment(order.id, attachment.id, {
        id: currentUser.id,
        name: currentUser.displayName,
        role: currentUser.role
      });
      if (!deleted) throw new HttpError(404, "attachment not found.");
      return clientVisibleAttachments(await repository.listOrderAttachments(order.id), currentUser.id);
    });
  }

  async supplementClientOrder(
    currentUser: CurrentUser,
    orderId: string,
    payload: ClientSupplementPayload
  ): Promise<ClientOrderDto> {
    const binding = await this.requireActiveClientBinding(currentUser);
    if (binding.clientUser.clientAccessScope !== CLIENT_ACCESS_SCOPES.own) {
      throw new HttpError(403, "customer admin accounts cannot change orders in this phase.");
    }
    const normalizedAttachments = normalizeAttachmentList(payload.attachments).map((attachment) =>
      normalizeAttachmentPayload(attachment, currentUser, orderId)
    );
    const storedKeys: string[] = [];
    let updated: OrderRecord;
    try {
      updated = await this.repository.withTransaction(async (repository) => {
        const order = await lockActiveOrderForBusinessWrite(repository, orderId);
        if (!canClientAddOrderAttachment(currentUser, binding.clientUser, order).allowed) {
          throw new HttpError(404, "order not found.");
        }
        if (!canClientSupplementOrder(currentUser, binding.clientUser, order).allowed) {
          throw new HttpError(409, "only orders waiting for client supplement can be updated.");
        }
        const next = await repository.updateOrder(order.id, {
          styleNo: payload.styleNo === undefined ? order.styleNo : requireText(payload.styleNo, "styleNo"),
          styleName:
            payload.styleName === undefined ? order.styleName : requireText(payload.styleName, "styleName"),
          quantity: payload.quantity === undefined ? order.quantity : requireQuantity(payload.quantity),
          sampleType:
            payload.sampleType === undefined
              ? order.sampleType
              : await this.sampleTypeService.requireWritableCodeForUpdate(payload.sampleType, order.sampleType),
          sampleRound:
            payload.sampleRound === undefined
              ? order.sampleRound
              : requireKnownOption(payload.sampleRound, this.sampleRoundValues, "sampleRound"),
          deliveryDate:
            payload.deliveryDate === undefined
              ? order.deliveryDate
              : requireText(payload.deliveryDate, "deliveryDate"),
          patternStatus:
            payload.patternStatus === undefined
              ? order.patternStatus
              : (requireKnownOption(payload.patternStatus, this.patternStatusValues, "patternStatus") as PatternStatus),
          remark: payload.remark === undefined ? order.remark : optionalText(payload.remark),
          intakeStatus: INTAKE_STATUSES.pendingReceive,
          stage: null,
          supplementCount: order.supplementCount + 1,
          supplementedAt: new Date().toISOString()
        });
        if (normalizedAttachments.length > 0) {
          const folder = await ensureOrderFolder(repository, order, currentUser.id, this.env);
          for (const attachment of normalizedAttachments) {
            let stored: Awaited<ReturnType<FileStorageAdapter["saveFile"]>> | undefined;
            if (attachment.buffer || attachment.temporaryPath) {
              stored = await this.fileStorage.saveFile({
                orderId: order.id,
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
              storedKeys.push(stored.storageKey);
            }
            const { buffer: _buffer, temporaryPath: _temporaryPath, checksum: _checksum, ...metadata } = attachment;
            await repository.createOrderAttachment({
              ...metadata,
              fileName: stored?.originalName ?? metadata.fileName,
              mimeType: stored?.contentType ?? metadata.mimeType,
              size: stored?.sizeBytes ?? metadata.size,
              storageKey: stored?.storageKey,
              checksum: stored?.checksum
            });
          }
        }
        return next;
      });
    } catch (error) {
      await Promise.allSettled(storedKeys.map((key) => this.fileStorage.deleteFile(key)));
      throw error;
    }

    return this.clientOrderDto(updated, currentUser.id);
  }

  private async requireClientWritableOrder(currentUser: CurrentUser, orderId: string): Promise<OrderRecord> {
    const binding = await this.requireActiveClientBinding(currentUser);

    if (binding.clientUser.clientAccessScope !== CLIENT_ACCESS_SCOPES.own) {
      throw new HttpError(403, "customer admin accounts cannot change orders in this phase.");
    }

    const order = await this.repository.findOrderById(orderId);
    if (!order || !canClientAddOrderAttachment(currentUser, binding.clientUser, order).allowed) {
      throw new HttpError(404, "order not found.");
    }

    return order;
  }

  async downloadClientOrderAttachment(
    currentUser: CurrentUser,
    orderId: string,
    attachmentId: string
  ): Promise<AttachmentDownload> {
    const binding = await this.requireActiveClientBinding(currentUser);
    const order = await this.repository.findOrderById(orderId);
    if (!order || !this.canReadOrder(currentUser, binding, order)) {
      throw new HttpError(404, "order not found.");
    }

    const attachment = (await this.repository.listOrderAttachments(order.id)).find(
      (item) => item.id === attachmentId
    );
    if (
      !attachment ||
      !ordinaryOrderAttachments([attachment]).length ||
      !canClientViewAttachment(currentUser, binding.clientUser, order, attachment).allowed
    ) {
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

  async downloadClientPatternDeliverable(
    currentUser: CurrentUser,
    orderId: string,
    deliverableId: string
  ): Promise<AttachmentDownload> {
    const order = await this.requireClientReadableOrder(currentUser, orderId);
    const deliverable = (await this.repository.listPatternDeliverablesByOrderId(order.id)).find(
      (item) =>
        item.id === deliverableId &&
        item.visibility === ATTACHMENT_VISIBILITY.clientVisible
    );
    if (!deliverable?.storageKey || !deliverable.fileName) {
      throw new HttpError(404, "pattern deliverable not found.");
    }

    try {
      const content = await this.fileStorage.readFile(deliverable.storageKey);
      return {
        fileName: deliverable.fileName,
        mimeType: deliverable.mimeType ?? "application/octet-stream",
        size: deliverable.size ?? content.length,
        content
      };
    } catch (error) {
      if (error instanceof FileStorageNotFoundError) {
        throw new HttpError(404, "pattern deliverable not found.");
      }
      throw error;
    }
  }
}
