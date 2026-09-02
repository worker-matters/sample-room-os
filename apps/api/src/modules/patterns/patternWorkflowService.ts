import path from "node:path";
import {
  ATTACHMENT_VISIBILITY,
  firstPhysicalOrderStage,
  INTAKE_STATUSES,
  hasPatternTaskRequirements,
  ORDER_STAGES,
  PATTERN_STATUSES,
  PATTERN_TASK_REQUIREMENTS,
  patternTaskRequirementsFromItems,
  ROLES
} from "@sample-room/shared";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import type {
  AccountRepository,
  OperationLogRepository
} from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import {
  canManagePatternLibrary,
  canUseCuttingRoomWorkflow,
  canUsePatternMakerWorkflow
} from "../auth/permissionPolicy.js";
import type {
  AttachmentAuditLogRecord,
  OrderAttachmentCreateInput,
  OrderAttachmentRecord,
  OrderCorrectionLogEntry,
  OrderRecord
} from "../orders/orderTypes.js";
import {
  FileStorageNotFoundError,
  type FileStorageAdapter
} from "../files/fileStorageAdapter.js";
import {
  attachmentAuditLogForWebResponseWithAccountNames,
  attachmentForWebResponse,
  attachmentForWebResponseWithAccountNames
} from "../files/attachmentDto.js";
import {
  currentAccountDisplayName,
  loadAccountDisplayNames,
  type AccountDisplayNameMap
} from "../accounts/accountDisplayName.js";
import { attachmentVisibilityFromInput, normalizeAttachmentVisibility } from "../files/attachmentVisibility.js";
import { auditAttachmentVisibilityChange } from "../files/attachmentVisibilityAudit.js";
import { renamedDisplayFileName } from "../files/attachmentDisplayName.js";
import { isQcAttachmentCategory, ordinaryOrderAttachments } from "../files/qcAttachmentCategories.js";
import { createLocalFileStorageAdapter } from "../files/localFileStorageAdapter.js";
import type { AttachmentDownload } from "../orders/orderService.js";
import {
  buildSubmittedCuttingVersionPaths,
  ensureSubmittedCuttingFolders,
  getPatternFileRoots,
  sanitizePathSegment
} from "./localPatternFileWorkflow.js";
import { ensureOrderFolder } from "./orderFolderService.js";
import {
  CUTTING_INBOX_STATUSES,
  PATTERN_DELIVERABLE_TYPES,
  PATTERN_TASK_STATUSES,
  type CuttingInboxStatus,
  type OrderFolderRecord,
  type PatternOrderFolderDto,
  type PatternDeliverableRecord,
  type PatternLibraryEntryDto,
  type PatternLibraryEntryRecord,
  type PatternTaskDto,
  type PatternTaskRecord,
  type PatternWorkbenchDto,
  type CuttingInboxSubmissionDto,
  type SubmittedCuttingVersionCreateInput,
  type SubmittedCuttingVersionDto,
  type SubmittedCuttingVersionRecord
} from "./patternTypes.js";
import {
  completedPatternRequirementsFromDeliverables,
  isPatternProductionGateSatisfiedByDeliverables,
  isValidPatternRequirementDeliverable
} from "./patternCompletionRules.js";

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requireText(value: unknown, field: string) {
  const text = optionalText(value);
  if (!text) {
    throw new HttpError(400, `${field} is required.`);
  }

  return text;
}

function requireNonNegativeInteger(value: unknown, field: string) {
  const numberValue = typeof value === "string" ? Number(value) : value;
  if (typeof numberValue !== "number" || !Number.isInteger(numberValue) || numberValue < 0) {
    throw new HttpError(400, `${field} must be a non-negative integer.`);
  }

  return numberValue;
}

function requirePositiveNumber(value: unknown, field: string) {
  const numberValue = typeof value === "string" ? Number(value) : value;
  if (typeof numberValue !== "number" || !Number.isFinite(numberValue) || numberValue <= 0) {
    throw new HttpError(400, `${field} must be a positive number.`);
  }

  return numberValue;
}

function nowIso() {
  return new Date().toISOString();
}

function formatVersion(sequence: number) {
  return `V${sequence}`;
}

function safeLocalFilePath(folderPath: string, fileName: string) {
  return path.join(folderPath, sanitizePathSegment(fileName, "cutting-file"));
}

function orderSummary(order: OrderRecord): PatternTaskDto["order"] {
  return {
    id: order.id,
    orderNo: order.orderNo,
    folderCode: order.folderCode,
    customerName: order.customerName,
    salespersonName: order.salespersonName,
    styleNo: order.styleNo,
    styleName: order.styleName,
    quantity: order.quantity,
    sampleType: order.sampleType,
    sampleRound: order.sampleRound,
    stage: order.stage,
    patternStatus: order.patternStatus,
    patternSourceType: order.patternSourceType,
    sourceOrderId: order.sourceOrderId,
    sourcePatternVersionId: order.sourcePatternVersionId,
    sampleRequestItems: order.sampleRequestItems,
    sampleGarmentRequired: order.sampleGarmentRequired,
    taskInstructionNote: order.taskInstructionNote,
    latestPatternVersion: order.latestPatternVersion,
    cuttingUsedPatternVersion: order.cuttingUsedPatternVersion,
    deliveryDate: order.deliveryDate,
    createdAt: order.createdAt,
    terminated: order.terminated
  };
}

function canBecomePatternTask(order: OrderRecord) {
  return (
    !order.terminated &&
    order.intakeStatus === INTAKE_STATUSES.received &&
    hasPatternTaskRequirements(order.sampleRequestItems)
  );
}

function isReceivedPatternOrder(order: OrderRecord) {
  return order.intakeStatus === INTAKE_STATUSES.received;
}

function isActivePatternTask(task: PatternTaskRecord) {
  return (
    task.status === PATTERN_TASK_STATUSES.active ||
    task.status === PATTERN_TASK_STATUSES.inProgress
  );
}

function isFinalPatternTask(task: PatternTaskRecord) {
  return (
    task.status === PATTERN_TASK_STATUSES.completed ||
    task.status === PATTERN_TASK_STATUSES.submitted ||
    task.status === PATTERN_TASK_STATUSES.submittedToCutting
  );
}

function versionNumber(value: string | undefined) {
  const match = /^V(\d+)$/i.exec(value ?? "");
  return match ? Number(match[1]) : 0;
}

type LibraryPayload = {
  customerId?: unknown;
  customerName?: unknown;
  styleNo?: unknown;
  styleName?: unknown;
  patternVersion?: unknown;
  fileName?: unknown;
  localPath?: unknown;
  storageKey?: unknown;
  note?: unknown;
};

type SubmitPayload = {
  note?: unknown;
  workHours?: unknown;
  files?: unknown;
  attachments?: unknown;
  deliverableType?: unknown;
  textValue?: unknown;
  structuredData?: unknown;
  flowDecision?: unknown;
  flowDecisionReason?: unknown;
  sampleQuantity?: unknown;
  completedRequirements?: unknown;
  taskCategory?: unknown;
};

type PatternOperationPayload = {
  operation?: unknown;
  note?: unknown;
};

type PatternCompletionPayload = {
  note?: unknown;
  workHours?: unknown;
  files?: unknown;
  attachments?: unknown;
  deliverableType?: unknown;
  textValue?: unknown;
  structuredData?: unknown;
  flowDecision?: unknown;
  flowDecisionReason?: unknown;
  sampleQuantity?: unknown;
  completedRequirements?: unknown;
  taskCategory?: unknown;
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

type PatternAttachmentPatchPayload = {
  fileName?: unknown;
  category?: unknown;
  visibility?: unknown;
  note?: unknown;
};

const patternDeliverableTypeValues = new Set<string>(Object.values(PATTERN_DELIVERABLE_TYPES));

type CuttingStatusPayload = {
  note?: unknown;
};

const patternOperationLabels = {
  grade: "推码",
  material_check: "核料",
  adjust_pattern: "调板"
} as const;

type PatternOperation = keyof typeof patternOperationLabels;

function requirePatternOperation(value: unknown): PatternOperation {
  if (
    value === "grade" ||
    value === "material_check" ||
    value === "adjust_pattern"
  ) {
    return value;
  }

  throw new HttpError(400, "operation is required.");
}

function appendTaskNote(currentNote: string | undefined, operation: PatternOperation, note: string | undefined) {
  const line = `[${new Date().toLocaleString("zh-CN")}] ${patternOperationLabels[operation]}${
    note ? `：${note}` : ""
  }`;
  return currentNote ? `${currentNote}\n${line}` : line;
}

function appendPatternTaskCompletionNote(currentNote: string | undefined, note: string | undefined) {
  const line = `[${new Date().toLocaleString("zh-CN")}] 综合版师任务完成${
    note ? `：${note}` : ""
  }`;
  return currentNote ? `${currentNote}\n${line}` : line;
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

function optionalAttachmentVisibility(value: unknown) {
  return attachmentVisibilityFromInput(
    typeof value === "string" ? value : undefined,
    ATTACHMENT_VISIBILITY.clientVisible
  );
}

function normalizePatternAttachmentPayload(
  value: unknown,
  currentUser: CurrentUser,
  orderId: string
): NormalizedAttachmentInput {
  if (typeof value !== "object" || value === null) {
    throw new HttpError(400, "attachment metadata must be an object.");
  }

  const payload = value as AttachmentMetadataPayload;
  return {
    orderId,
    fileName: requireText(payload.fileName, "fileName"),
    mimeType: optionalText(payload.mimeType) ?? "application/octet-stream",
    size: requireNonNegativeInteger(payload.size, "size"),
    category: optionalText(payload.category) ?? "pattern_maker_attachment",
    uploadedBy: currentUser.id,
    uploadedByRole: currentUser.role,
    uploadedByName: currentUser.displayName,
    visibility: optionalAttachmentVisibility(payload.visibility),
    ...(Buffer.isBuffer(payload.buffer) ? { buffer: payload.buffer } : {}),
    ...(typeof payload.temporaryPath === "string" ? { temporaryPath: payload.temporaryPath } : {}),
    ...(typeof payload.checksum === "string" ? { checksum: payload.checksum } : {})
  };
}

function optionalPatternDeliverableType(value: unknown) {
  const text = optionalText(value);
  if (!text) {
    return PATTERN_DELIVERABLE_TYPES.other;
  }

  if (!patternDeliverableTypeValues.has(text)) {
    throw new HttpError(400, "deliverableType is not supported.");
  }

  return text as PatternDeliverableRecord["type"];
}

const patternSubmissionContentRequiredMessage = "请至少提交一种内容：版子文件或交付物。";

function isPlaceholderSubmittedFileName(fileName: string) {
  return /\.placeholder$/i.test(fileName) || /_package\.placeholder$/i.test(fileName);
}

function hasValidSubmittedFile(value: unknown) {
  return Array.isArray(value) && value.some((file) => {
    if (typeof file !== "object" || file === null) {
      return false;
    }

    const fileName = optionalText((file as Record<string, unknown>).fileName);
    return Boolean(fileName && !isPlaceholderSubmittedFileName(fileName));
  });
}

function hasValidAttachmentDeliverable(value: unknown) {
  return Array.isArray(value) && value.some((attachment) => {
    if (typeof attachment !== "object" || attachment === null) {
      return false;
    }

    const payload = attachment as Record<string, unknown>;
    const fileName = optionalText(payload.fileName);
    const size = typeof payload.size === "string" ? Number(payload.size) : payload.size;
    return Boolean(
      fileName &&
        (Buffer.isBuffer(payload.buffer) ||
          (typeof size === "number" && Number.isFinite(size) && size > 0))
    );
  });
}

function hasValidStructuredData(value: unknown) {
  return typeof value === "object" && value !== null && Object.keys(value).length > 0;
}

function hasPatternSubmissionContent(payload: SubmitPayload | PatternCompletionPayload) {
  return (
    hasValidSubmittedFile(payload.files) ||
    hasValidAttachmentDeliverable(payload.attachments) ||
    Boolean(optionalText(payload.textValue)) ||
    hasValidStructuredData(payload.structuredData)
  );
}

function hasValidPatternDeliverable(deliverable: PatternDeliverableRecord) {
  return Boolean(
    optionalText(deliverable.fileName) ||
      optionalText(deliverable.textValue) ||
      hasValidStructuredData(deliverable.structuredData)
  );
}

function hasNewPatternDeliverableContent(payload: SubmitPayload | PatternCompletionPayload) {
  return (
    hasValidSubmittedFile(payload.files) ||
    hasValidAttachmentDeliverable(payload.attachments) ||
    Boolean(optionalText(payload.textValue)) ||
    hasValidStructuredData(payload.structuredData)
  );
}

function requirePatternSubmissionContent(
  payload: SubmitPayload | PatternCompletionPayload,
  existingDeliverables: PatternDeliverableRecord[] = []
) {
  if (!hasPatternSubmissionContent(payload) && !existingDeliverables.some(hasValidPatternDeliverable)) {
    throw new HttpError(400, patternSubmissionContentRequiredMessage);
  }
}

function completedRequirementsForTask(
  task: PatternTaskRecord,
  value: unknown
): PatternTaskRecord["completedRequirements"] {
  if (value === undefined) {
    throw new HttpError(400, "completedRequirements is required.");
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, "completedRequirements must be an array.");
  }
  const selected = new Set(value);
  if (task.requirements.some(
    (requirement) =>
      (requirement === "pattern_making" || requirement === "pattern_revision") &&
      !selected.has(requirement)
  )) {
    throw new HttpError(409, "pattern making and revision requirements must be completed before submission.");
  }
  return task.requirements.filter((requirement) => selected.has(requirement));
}

function deliveredRequirementsForTask(
  task: PatternTaskRecord,
  deliverables: PatternDeliverableRecord[]
): PatternTaskRecord["completedRequirements"] {
  return completedPatternRequirementsFromDeliverables(task.requirements, deliverables);
}

function requireAllTaskDeliverables(
  task: PatternTaskRecord,
  completedRequirements: PatternTaskRecord["completedRequirements"]
) {
  const completed = new Set(completedRequirements);
  const missing = task.requirements.filter(
    (requirement) =>
      (requirement === "pattern_making" || requirement === "pattern_revision") &&
      !completed.has(requirement)
  );
  if (missing.length > 0) {
    throw new HttpError(409, "pattern making and revision requirements need matching uploaded files before completion.");
  }
}

function hasAllBlockingTaskDeliverables(
  task: PatternTaskRecord,
  completedRequirements: PatternTaskRecord["completedRequirements"]
) {
  const completed = new Set(completedRequirements);
  return task.requirements
    .filter((requirement) => requirement === "pattern_making" || requirement === "pattern_revision")
    .every((requirement) => completed.has(requirement));
}

function rejectLegacyFlowDecision(payload: SubmitPayload | PatternCompletionPayload) {
  if (
    payload.flowDecision !== undefined ||
    payload.flowDecisionReason !== undefined ||
    payload.sampleQuantity !== undefined
  ) {
    throw new HttpError(400, "flowDecision and production-route overrides are no longer supported.");
  }
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function submittedFilesFromPayload(
  value: unknown,
  version: string,
  submittedCuttingPath: string
): SubmittedCuttingVersionCreateInput["files"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((file) => {
    const filePayload = typeof file === "object" && file !== null ? file as Record<string, unknown> : {};
    const fileName = optionalText(filePayload.fileName);
    if (!fileName || isPlaceholderSubmittedFileName(fileName)) {
      return [];
    }

    return [
      {
        fileName,
        localPath: safeLocalFilePath(submittedCuttingPath, fileName),
        ...(typeof filePayload.sizeBytes === "number" && filePayload.sizeBytes >= 0
          ? { sizeBytes: Math.floor(filePayload.sizeBytes) }
          : {})
      }
    ];
  });
}

function patternAttachmentLog(
  order: OrderRecord,
  currentUser: CurrentUser,
  action: "create" | "update" | "delete",
  attachment: Pick<OrderAttachmentRecord, "id" | "fileName">,
  note?: string
): OrderCorrectionLogEntry {
  return {
    id: `${order.id}-pattern-attachment-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    changedAt: nowIso(),
    changedByRole: currentUser.role,
    changedByAccountId: currentUser.id,
    changedByName: currentUser.displayName,
    fieldName: `patternAttachment:${action}`,
    oldValue: action === "create" ? null : `${attachment.id} / ${attachment.fileName}`,
    newValue: `${attachment.id} / ${attachment.fileName}${note ? ` / ${note}` : ""}`
  };
}

function patternTaskCompletionLog(
  order: OrderRecord,
  currentUser: CurrentUser,
  note?: string
): OrderCorrectionLogEntry {
  return {
    id: `${order.id}-pattern-task-complete-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    changedAt: nowIso(),
    changedByRole: currentUser.role,
    changedByAccountId: currentUser.id,
    changedByName: currentUser.displayName,
    fieldName: "patternTask:complete",
    oldValue: order.stage,
    newValue: `综合版师任务完成${note ? ` / ${note}` : ""}`
  };
}

function orderFolderForResponse(
  folder: OrderFolderRecord
): NonNullable<PatternTaskDto["orderFolder"]> {
  return {
    id: folder.id,
    orderId: folder.orderId,
    folderName: folder.folderName,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt
  };
}

function linkedPatternForResponse(
  entry: PatternLibraryEntryRecord
): NonNullable<PatternTaskDto["linkedPattern"]> {
  const { localPath: _localPath, storageKey: _storageKey, ...safeEntry } = entry;
  return { ...safeEntry, hasFile: Boolean(entry.localPath || entry.storageKey) };
}

function deliverableForResponse(
  deliverable: PatternDeliverableRecord,
  accountNames: AccountDisplayNameMap
): PatternTaskDto["deliverables"][number] {
  const {
    storageKey: _storageKey,
    uploadedByName: _historicalUploadedByName,
    ...safeDeliverable
  } = deliverable;
  const uploadedByName = currentAccountDisplayName(
    accountNames,
    deliverable.uploadedBy,
    deliverable.uploadedByName
  );
  return {
    ...safeDeliverable,
    ...(uploadedByName ? { uploadedByName } : {}),
    visibility: normalizeAttachmentVisibility(deliverable.visibility),
    hasFile: Boolean(deliverable.storageKey)
  };
}

function submissionForResponse(
  submission: SubmittedCuttingVersionRecord
): SubmittedCuttingVersionDto {
  const {
    orderFolderPath: _orderFolderPath,
    submittedCuttingPath: _submittedCuttingPath,
    cuttingInboxPath: _cuttingInboxPath,
    files,
    ...safeSubmission
  } = submission;
  return {
    ...safeSubmission,
    files: files.map(({ localPath: _localPath, ...file }) => file)
  };
}

export class PatternWorkflowService {
  private readonly patternMakerMutationTails = new Map<string, Promise<void>>();
  private readonly patternTaskMutationTails = new Map<string, Promise<void>>();

  constructor(
    private readonly repository: SampleRoomRepository,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fileStorage: FileStorageAdapter = createLocalFileStorageAdapter(),
    private readonly operationLogs: OperationLogRepository | undefined,
    private readonly accounts: AccountRepository
  ) {}

  private ensurePatternMaker(currentUser: CurrentUser) {
    if (!canUsePatternMakerWorkflow(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }
  }

  private async withWorkflowTransaction<T>(
    operation: (service: PatternWorkflowService) => Promise<T>
  ): Promise<T> {
    return this.repository.withTransaction((repository) =>
      operation(new PatternWorkflowService(
        repository,
        this.env,
        this.fileStorage,
        this.operationLogs,
        this.accounts
      ))
    );
  }

  private async withPatternMakerMutationLock<T>(
    patternMakerId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.patternMakerMutationTails.get(patternMakerId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.patternMakerMutationTails.set(patternMakerId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.patternMakerMutationTails.get(patternMakerId) === tail) {
        this.patternMakerMutationTails.delete(patternMakerId);
      }
    }
  }

  private async withPatternTaskMutationLock<T>(
    taskId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.patternTaskMutationTails.get(taskId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.patternTaskMutationTails.set(taskId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.patternTaskMutationTails.get(taskId) === tail) {
        this.patternTaskMutationTails.delete(taskId);
      }
    }
  }

  private ensurePatternLibraryManager(currentUser: CurrentUser) {
    if (!canManagePatternLibrary(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }
  }

  private ensureCuttingRoomUser(currentUser: CurrentUser) {
    if (!canUseCuttingRoomWorkflow(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }
  }

  private async requireOrder(orderId: string): Promise<OrderRecord> {
    const order = await this.repository.findOrderById(orderId);
    if (!order) {
      throw new HttpError(404, "order not found.");
    }

    return order;
  }

  private async requireTask(taskId: string): Promise<PatternTaskRecord> {
    const task = await this.repository.findPatternTaskById(taskId);
    if (!task) {
      throw new HttpError(404, "pattern task not found.");
    }

    return task;
  }

  private taskStatusForOrder(order: OrderRecord): PatternTaskRecord["status"] {
    void order;
    return PATTERN_TASK_STATUSES.pending;
  }

  private async ensureTaskForOrder(order: OrderRecord): Promise<PatternTaskRecord> {
    const existing = await this.repository.findPatternTaskByOrderId(order.id);
    if (existing) {
      return existing;
    }

    const requirements = patternTaskRequirementsFromItems(order.sampleRequestItems);
    if (requirements.length === 0) {
      throw new HttpError(409, "order has no pattern requirements.");
    }

    try {
      return await this.repository.createPatternTask({
        orderId: order.id,
        status: this.taskStatusForOrder(order),
        requirements
      });
    } catch (error) {
      const concurrentlyCreated = await this.repository.findPatternTaskByOrderId(order.id);
      if (concurrentlyCreated) {
        return concurrentlyCreated;
      }
      throw error;
    }
  }

  private async ensureFolderForOrder(
    order: OrderRecord,
    currentUser: CurrentUser
  ): Promise<OrderFolderRecord> {
    const folder = await ensureOrderFolder(this.repository, order, currentUser, this.env);
    const task = await this.ensureTaskForOrder(order);
    if (!task.orderFolderId) {
      await this.repository.updatePatternTask(task.id, { orderFolderId: folder.id });
    }
    return folder;
  }

  private async pauseOtherActiveTasks(
    currentUser: CurrentUser,
    exceptTaskId: string
  ) {
    const tasks = await this.repository.listPatternTasks();
    const activeTasks = tasks.filter(
      (task) =>
        task.id !== exceptTaskId &&
        task.patternMakerId === currentUser.id &&
        isActivePatternTask(task) &&
        !isFinalPatternTask(task)
    );
    const pausedAt = nowIso();
    for (const task of activeTasks) {
      await this.repository.updatePatternTask(task.id, {
        status: PATTERN_TASK_STATUSES.paused,
        pausedAt,
        pausedReason: ""
      });
    }
  }

  private async nextPatternVersion(orderId: string, taskCategory?: string) {
    const [submissions, deliverables] = await Promise.all([
      this.repository.listSubmittedCuttingVersionsByOrderId(orderId),
      this.repository.listPatternDeliverablesByOrderId(orderId)
    ]);
    const maxVersion = Math.max(
      0,
      ...(taskCategory ? [] : submissions.map((submission) => versionNumber(submission.version))),
      ...deliverables
        .filter((deliverable) => !taskCategory || deliverable.taskCategory === taskCategory)
        .map((deliverable) => versionNumber(deliverable.version))
    );
    return formatVersion(maxVersion + 1);
  }

  private async latestExistingPatternVersion(orderId: string) {
    const [submissions, deliverables] = await Promise.all([
      this.repository.listSubmittedCuttingVersionsByOrderId(orderId),
      this.repository.listPatternDeliverablesByOrderId(orderId)
    ]);
    const maxVersion = Math.max(
      0,
      ...submissions.map((submission) => versionNumber(submission.version)),
      ...deliverables.map((deliverable) => versionNumber(deliverable.version))
    );
    return maxVersion > 0 ? formatVersion(maxVersion) : undefined;
  }

  private async currentPatternWorkVersion(orderId: string) {
    return (await this.latestExistingPatternVersion(orderId)) ?? "V1";
  }

  private async taskDto(
    task: PatternTaskRecord,
    accountNames?: AccountDisplayNameMap
  ): Promise<PatternTaskDto> {
    const order = await this.requireOrder(task.orderId);
    const [orderFolder, linkedPattern, submissions, deliverables, attachments, resolvedAccountNames] = await Promise.all([
      this.repository.findOrderFolderByOrderId(order.id),
      task.linkedPatternLibraryEntryId
        ? this.repository.findPatternLibraryEntryById(task.linkedPatternLibraryEntryId)
        : undefined,
      this.repository.listSubmittedCuttingVersionsByOrderId(order.id),
      this.repository.listPatternDeliverablesByOrderId(order.id),
      this.repository.listOrderAttachments(order.id),
      accountNames ?? loadAccountDisplayNames(this.accounts)
    ]);

    return {
      ...task,
      order: {
        ...orderSummary(order),
        attachments: ordinaryOrderAttachments(attachments).map((attachment) =>
          attachmentForWebResponseWithAccountNames(attachment, resolvedAccountNames)
        )
      },
      completedRequirements: deliveredRequirementsForTask(task, deliverables),
      ...(orderFolder ? { orderFolder: orderFolderForResponse(orderFolder) } : {}),
      ...(linkedPattern ? { linkedPattern: linkedPatternForResponse(linkedPattern) } : {}),
      submissions: submissions.map(submissionForResponse),
      deliverables: deliverables.map((deliverable) =>
        deliverableForResponse(deliverable, resolvedAccountNames)
      )
    };
  }

  private async ensureCurrentPatternTasks(currentUser: CurrentUser): Promise<OrderRecord[]> {
    void currentUser;
    return this.repository.listOrders();
  }

  private async ensureAllReceivedPatternOrders(currentUser: CurrentUser): Promise<OrderRecord[]> {
    void currentUser;
    const orders = await this.repository.listOrders();
    for (const order of orders) {
      if (isReceivedPatternOrder(order) && canBecomePatternTask(order)) {
        await this.ensureTaskForOrder(order);
      }
    }
    return orders;
  }

  async listPatternTasks(currentUser: CurrentUser): Promise<PatternTaskDto[]> {
    const workbench = await this.getPatternWorkbench(currentUser);
    return [...(workbench.current ? [workbench.current] : []), ...workbench.paused];
  }

  async listPatternArchive(currentUser: CurrentUser): Promise<PatternTaskDto[]> {
    return (await this.getPatternWorkbench(currentUser)).history;
  }

  async getPatternWorkbench(currentUser: CurrentUser): Promise<PatternWorkbenchDto> {
    this.ensurePatternMaker(currentUser);
    const [orders, listedTasks, accountNames] = await Promise.all([
      this.ensureAllReceivedPatternOrders(currentUser),
      this.repository.listPatternTasks(),
      loadAccountDisplayNames(this.accounts)
    ]);
    const tasks: PatternTaskRecord[] = [];
    for (const task of listedTasks) {
      if (task.patternMakerId === currentUser.id && isFinalPatternTask(task)) {
        const deliverables = await this.repository.listPatternDeliverablesByOrderId(task.orderId);
        const completedRequirements = deliveredRequirementsForTask(task, deliverables);
        if (!hasAllBlockingTaskDeliverables(task, completedRequirements)) {
          tasks.push(await this.repository.updatePatternTask(task.id, {
            status: PATTERN_TASK_STATUSES.paused,
            completedRequirements,
            completedAt: "",
            submittedAt: "",
            pausedAt: nowIso(),
            pausedReason: ""
          }));
          continue;
        }
      }
      tasks.push(task);
    }
    const visibleOrderIds = new Set(
      orders.filter((order) => isReceivedPatternOrder(order) && canBecomePatternTask(order)).map((order) => order.id)
    );
    const visibleTasks = tasks.filter((task) => visibleOrderIds.has(task.orderId));
    const currentTask = visibleTasks.find(
      (task) => task.patternMakerId === currentUser.id && isActivePatternTask(task)
    );
    const pendingTasks = visibleTasks.filter(
      (task) => task.status === PATTERN_TASK_STATUSES.pending && !task.patternMakerId
    );
    const pausedTasks = visibleTasks.filter(
      (task) =>
        task.patternMakerId === currentUser.id && task.status === PATTERN_TASK_STATUSES.paused
    );
    const historicalTasks = visibleTasks.filter(
      (task) => task.patternMakerId === currentUser.id && isFinalPatternTask(task)
    );

    const [current, pending, paused, history] = await Promise.all([
      currentTask ? this.taskDto(currentTask, accountNames) : undefined,
      Promise.all(pendingTasks.map((task) => this.taskDto(task, accountNames))),
      Promise.all(pausedTasks.map((task) => this.taskDto(task, accountNames))),
      Promise.all(historicalTasks.map((task) => this.taskDto(task, accountNames)))
    ]);
    return { ...(current ? { current } : {}), pending, paused, history };
  }

  async startTask(taskId: string, currentUser: CurrentUser): Promise<PatternTaskDto> {
    try {
      return await this.withPatternMakerMutationLock(currentUser.id, () =>
        this.withWorkflowTransaction((service) =>
          service.claimPendingTaskInTransaction(taskId, currentUser)
        )
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new HttpError(409, "another active pattern task changed concurrently; refresh and retry.");
      }
      throw error;
    }
  }

  private async claimPendingTaskInTransaction(
    taskId: string,
    currentUser: CurrentUser
  ): Promise<PatternTaskDto> {
    this.ensurePatternMaker(currentUser);
    const taskBeforeLock = await this.requireTask(taskId);
    await this.repository.lockOrderForWorkflow(taskBeforeLock.orderId);
    const task = await this.requireTask(taskId);
    const order = await this.requireOrder(task.orderId);
    if (order.terminated || !isReceivedPatternOrder(order) || !canBecomePatternTask(order)) {
      throw new HttpError(409, "only active received pattern tasks can be started.");
    }
    if (task.status !== PATTERN_TASK_STATUSES.pending || task.patternMakerId) {
      throw new HttpError(409, "该任务已由其他版师领取，请刷新列表。");
    }

    const startedAt = nowIso();
    await this.pauseOtherActiveTasks(currentUser, task.id);
    const updated = await this.repository.claimPendingPatternTask(task.id, {
      patternMakerId: currentUser.id,
      patternMakerName: currentUser.displayName,
      startedAt
    });
    if (!updated) {
      throw new HttpError(409, "该任务已由其他版师领取，请刷新列表。");
    }
    return this.taskDto(updated);
  }

  async resumePausedTask(taskId: string, currentUser: CurrentUser): Promise<PatternTaskDto> {
    try {
      return await this.withPatternMakerMutationLock(currentUser.id, () =>
        this.withWorkflowTransaction((service) =>
          service.resumePausedTaskInTransaction(taskId, currentUser)
        )
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new HttpError(409, "another active pattern task changed concurrently; refresh and retry.");
      }
      throw error;
    }
  }

  private async resumePausedTaskInTransaction(
    taskId: string,
    currentUser: CurrentUser
  ): Promise<PatternTaskDto> {
    this.ensurePatternMaker(currentUser);
    const taskBeforeLock = await this.requireTask(taskId);
    await this.repository.lockOrderForWorkflow(taskBeforeLock.orderId);
    const task = await this.requireTask(taskId);
    const order = await this.requireOrder(task.orderId);
    if (order.terminated) {
      throw new HttpError(409, "order is terminated.");
    }
    if (!canBecomePatternTask(order)) {
      throw new HttpError(409, "该制版任务已被接单员取消，请返回任务列表。");
    }
    if (isFinalPatternTask(task)) {
      throw new HttpError(409, "completed or handed-off tasks cannot be resumed.");
    }
    if (task.patternMakerId !== currentUser.id) {
      throw new HttpError(403, "only the assigned pattern maker can resume this task.");
    }
    if (task.status !== PATTERN_TASK_STATUSES.paused) {
      return this.taskDto(task);
    }

    await this.pauseOtherActiveTasks(currentUser, task.id);
    const updated = await this.repository.updatePatternTask(task.id, {
      status: PATTERN_TASK_STATUSES.active,
      pausedAt: "",
      pausedReason: ""
    });
    return this.taskDto(updated);
  }

  async generateOrderFolder(
    orderId: string,
    currentUser: CurrentUser
  ): Promise<PatternOrderFolderDto> {
    const order = await this.requirePatternReadableOrder(orderId, currentUser);
    if (order.terminated || !isReceivedPatternOrder(order) || !canBecomePatternTask(order)) {
      throw new HttpError(409, "order is not available for pattern workflow.");
    }

    return orderFolderForResponse(await this.ensureFolderForOrder(order, currentUser));
  }

  async getOrderFolder(orderId: string, currentUser: CurrentUser): Promise<PatternOrderFolderDto> {
    const order = await this.requirePatternReadableOrder(orderId, currentUser);
    return orderFolderForResponse(
      await ensureOrderFolder(this.repository, order, currentUser, this.env)
    );
  }

  private async createAttachmentMetadata(
    attachment: NormalizedAttachmentInput
  ): Promise<OrderAttachmentRecord> {
    if (!attachment.buffer && !attachment.temporaryPath) {
      return attachmentForWebResponse(await this.repository.createOrderAttachment(attachment));
    }

    const order = await this.requireOrder(attachment.orderId);
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

  private async createPatternDeliverables(
    order: OrderRecord,
    task: PatternTaskRecord,
    currentUser: CurrentUser,
    version: string,
    payload: SubmitPayload,
    defaultType: PatternDeliverableRecord["type"]
  ): Promise<PatternDeliverableRecord[]> {
    const deliverableType = optionalPatternDeliverableType(payload.deliverableType ?? defaultType);
    const created: PatternDeliverableRecord[] = [];
    const folder = await ensureOrderFolder(this.repository, order, currentUser, this.env);
    const attachments = normalizeAttachmentList(payload.attachments);
    const taskCategory = attachments.length > 0 ? requireText(payload.taskCategory, "taskCategory") : undefined;
    if (
      taskCategory &&
      taskCategory !== "other" &&
      !(PATTERN_TASK_REQUIREMENTS as readonly string[]).includes(taskCategory)
    ) {
      throw new HttpError(400, "taskCategory must be a supported pattern task category or other.");
    }

    for (const attachment of attachments) {
      const normalized = normalizePatternAttachmentPayload(
        {
          ...(typeof attachment === "object" && attachment !== null ? attachment : {}),
          category: deliverableType
        },
        currentUser,
        order.id
      );
      if (normalized.buffer || normalized.temporaryPath) {
        const stored = await this.fileStorage.saveFile({
          orderId: order.id,
          folderCode: order.folderCode,
          orderFolderRelativePath: folder.relativePath,
          category: deliverableType,
          uploaderRole: currentUser.role,
          businessLabel: taskCategory,
          originalName: normalized.fileName,
          contentType: normalized.mimeType,
          buffer: normalized.buffer,
          temporaryPath: normalized.temporaryPath,
          checksum: normalized.checksum
        });
        let deliverable: PatternDeliverableRecord;
        try {
          deliverable = await this.repository.createPatternDeliverable({
            orderId: order.id,
            patternTaskId: task.id,
            version,
            type: deliverableType,
            fileName: stored.originalName,
            mimeType: stored.contentType,
            size: stored.sizeBytes,
            storageKey: stored.storageKey,
            visibility: normalized.visibility,
            uploadedBy: currentUser.id,
            uploadedByName: currentUser.displayName,
            taskCategory: taskCategory as PatternDeliverableRecord["taskCategory"]
          });
        } catch (error) {
          await this.fileStorage.deleteFile(stored.storageKey);
          throw error;
        }
        created.push(deliverable);
        await this.repository.appendAttachmentAuditLog({
          orderId: order.id,
          attachmentId: deliverable.id,
          originalFileName: deliverable.fileName ?? normalized.fileName,
          action: "upload",
          actorId: currentUser.id,
          actorName: currentUser.displayName,
          actorRole: currentUser.role,
          originalUploaderId: currentUser.id,
          originalUploaderName: currentUser.displayName,
          originalUploaderRole: currentUser.role,
          attachmentCategory: deliverable.type,
          sourceCategory: "pattern_maker_upload",
          patternTaskId: task.id,
          patternTaskCategory: taskCategory
        });
      } else {
        const deliverable = await this.repository.createPatternDeliverable({
            orderId: order.id,
            patternTaskId: task.id,
            version,
            type: deliverableType,
            fileName: normalized.fileName,
            mimeType: normalized.mimeType,
            size: normalized.size,
            visibility: normalized.visibility,
            uploadedBy: currentUser.id,
            uploadedByName: currentUser.displayName,
            taskCategory: taskCategory as PatternDeliverableRecord["taskCategory"]
          });
        created.push(deliverable);
        await this.repository.appendAttachmentAuditLog({
          orderId: order.id,
          attachmentId: deliverable.id,
          originalFileName: deliverable.fileName ?? normalized.fileName,
          action: "upload",
          actorId: currentUser.id,
          actorName: currentUser.displayName,
          actorRole: currentUser.role,
          originalUploaderId: currentUser.id,
          originalUploaderName: currentUser.displayName,
          originalUploaderRole: currentUser.role,
          attachmentCategory: deliverable.type,
          sourceCategory: "pattern_maker_upload",
          patternTaskId: task.id,
          patternTaskCategory: taskCategory
        });
      }
    }

    const textValue = optionalText(payload.textValue) ?? optionalText(payload.note);
    if (textValue) {
      created.push(
        await this.repository.createPatternDeliverable({
          orderId: order.id,
          patternTaskId: task.id,
          version,
          type: attachments.length > 0 ? PATTERN_DELIVERABLE_TYPES.processNote : deliverableType,
          textValue,
          visibility: "internal_only",
          uploadedBy: currentUser.id,
          uploadedByName: currentUser.displayName
        })
      );
    }

    if (typeof payload.structuredData === "object" && payload.structuredData !== null) {
      created.push(
        await this.repository.createPatternDeliverable({
          orderId: order.id,
          patternTaskId: task.id,
          version,
          type: deliverableType,
          structuredData: payload.structuredData as Record<string, unknown>,
          visibility: "internal_only",
          uploadedBy: currentUser.id,
          uploadedByName: currentUser.displayName
        })
      );
    }

    const allDeliverables = [
      ...(await this.repository.listPatternDeliverablesByOrderId(order.id)),
      ...created
    ];
    if (
      (order.stage === ORDER_STAGES.patternWaiting || order.stage === ORDER_STAGES.patternDoing) &&
      isPatternProductionGateSatisfiedByDeliverables(
        order.sampleRequestItems,
        allDeliverables
      )
    ) {
      await this.repository.updateOrder(order.id, {
        stage: firstPhysicalOrderStage(order.sampleRequestItems)
      });
    }

    return created;
  }

  private async requirePatternReadableOrder(
    orderId: string,
    currentUser: CurrentUser
  ): Promise<OrderRecord> {
    this.ensurePatternMaker(currentUser);
    const order = await this.requireOrder(orderId);
    if (order.terminated) {
      throw new HttpError(409, "order is terminated.");
    }
    if (!isReceivedPatternOrder(order)) {
      throw new HttpError(409, "order is not available for pattern attachments.");
    }

    const task = await this.repository.findPatternTaskByOrderId(order.id);
    if (!task) {
      throw new HttpError(404, "pattern task not found.");
    }
    if (task.patternMakerId && task.patternMakerId !== currentUser.id) {
      throw new HttpError(403, "only the assigned pattern maker can view this task.");
    }

    return order;
  }

  private async requirePatternWritableOrder(
    orderId: string,
    currentUser: CurrentUser
  ): Promise<OrderRecord> {
    const order = await this.requirePatternReadableOrder(orderId, currentUser);
    const task = await this.repository.findPatternTaskByOrderId(order.id);
    if (!task || task.patternMakerId !== currentUser.id || !task.startedAt) {
      throw new HttpError(409, "pattern maker must claim the task before uploading deliverables.");
    }
    return order;
  }

  private async appendPatternAttachmentLog(
    order: OrderRecord,
    currentUser: CurrentUser,
    action: "create" | "update" | "delete",
    attachment: Pick<OrderAttachmentRecord, "id" | "fileName">,
    note?: string
  ) {
    await this.repository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(order.id);
      const latest = await repository.findOrderById(order.id);
      if (!latest) throw new HttpError(404, "order not found.");
      await repository.updateOrder(order.id, {
        correctionLogs: [
          ...latest.correctionLogs,
          patternAttachmentLog(latest, currentUser, action, attachment, note)
        ]
      });
    });
  }

  private async recordPatternWorkHours(
    order: OrderRecord,
    task: PatternTaskRecord,
    currentUser: CurrentUser,
    workHours: number,
    note?: string
  ) {
    await this.repository.createScanRecord({
      orderId: order.id,
      actorAccountId: currentUser.accountId ?? currentUser.id,
      stage: "pattern",
      orderStage: order.stage ?? ORDER_STAGES.patternDoing,
      action: "complete",
      scanAction: "pattern_finish",
      workerId: task.patternMakerId ?? currentUser.id,
      workerName: task.patternMakerName ?? currentUser.displayName ?? currentUser.id,
      actorType: "internal_account",
      actorRole: currentUser.role,
      workHours,
      note
    });
  }

  async listPatternOrderAttachments(
    orderId: string,
    currentUser: CurrentUser
  ): Promise<{
    attachments: OrderAttachmentRecord[];
    logs: AttachmentAuditLogRecord[];
  }> {
    const order = await this.requirePatternReadableOrder(orderId, currentUser);
    const [attachments, logs, accountNames] = await Promise.all([
      this.repository.listOrderAttachments(order.id),
      this.repository.listAttachmentAuditLogs(order.id),
      loadAccountDisplayNames(this.accounts)
    ]);
    return {
      attachments: ordinaryOrderAttachments(attachments).map((attachment) =>
        attachmentForWebResponseWithAccountNames(attachment, accountNames)
      ),
      logs: logs.filter((log) =>
        !isQcAttachmentCategory(log.attachmentCategory) && log.attachmentCategory !== "order_charge"
      ).map((log) =>
        attachmentAuditLogForWebResponseWithAccountNames(log, accountNames)
      )
    };
  }

  async addPatternOrderAttachments(
    orderId: string,
    payload: { attachments?: unknown; note?: unknown; deliverableType?: unknown; textValue?: unknown; structuredData?: unknown },
    currentUser: CurrentUser
  ): Promise<OrderAttachmentRecord[]> {
    const note = requireText(payload.note, "note");
    const rawAttachments = normalizeAttachmentList(payload.attachments);
    const storedKeys: string[] = [];
    try {
      return await this.withWorkflowTransaction(async (service) => {
        await service.repository.lockOrderForWorkflow(orderId);
        const order = await service.requirePatternWritableOrder(orderId, currentUser);
        const task = await service.repository.findPatternTaskByOrderId(order.id);
        if (!task) throw new HttpError(404, "pattern task not found.");
        await service.ensureFolderForOrder(order, currentUser);
        const created = await Promise.all(
          rawAttachments.map((attachment) =>
            service.createAttachmentMetadata(
              normalizePatternAttachmentPayload(
                {
                  ...(typeof attachment === "object" && attachment !== null ? attachment : {}),
                  category: "pattern_maker_attachment",
                  visibility: ATTACHMENT_VISIBILITY.internalOnly
                },
                currentUser,
                order.id
              )
            )
          )
        );
        storedKeys.push(...created.flatMap((attachment) => attachment.storageKey ? [attachment.storageKey] : []));
        const version = await service.currentPatternWorkVersion(order.id);
        await service.createPatternDeliverables(
          order,
          task,
          currentUser,
          version,
          {
            attachments: rawAttachments,
            deliverableType: payload.deliverableType,
            textValue: payload.textValue,
            structuredData: payload.structuredData
          },
          PATTERN_DELIVERABLE_TYPES.patternFile
        );
        await service.repository.updateOrder(order.id, { latestPatternVersion: version });
        for (const attachment of created) {
          await service.appendPatternAttachmentLog(order, currentUser, "create", attachment, note);
        }
        return (await service.listPatternOrderAttachments(order.id, currentUser)).attachments;
      });
    } catch (error) {
      await Promise.allSettled(storedKeys.map((key) => this.fileStorage.deleteFile(key)));
      throw error;
    }
  }

  async appendPatternDeliverableVersion(
    taskId: string,
    payload: SubmitPayload,
    currentUser: CurrentUser
  ): Promise<PatternTaskDto> {
    return this.withPatternTaskMutationLock(taskId, () => this.withWorkflowTransaction(async (service) => {
      service.ensurePatternMaker(currentUser);
      const taskBeforeLock = await service.requireTask(taskId);
      await service.repository.lockOrderForWorkflow(taskBeforeLock.orderId);
      const task = await service.requireTask(taskId);
      const order = await service.requireOrder(task.orderId);
      if (order.terminated) {
        throw new HttpError(409, "order is terminated.");
      }
      if (!isFinalPatternTask(task) && !isActivePatternTask(task)) {
        throw new HttpError(409, "deliverable versions require an active or completed task.");
      }
      if (task.patternMakerId !== currentUser.id) {
        throw new HttpError(403, "only the assigned pattern maker can append a deliverable version.");
      }
      rejectLegacyFlowDecision(payload);
      requirePatternSubmissionContent(payload);

      const taskCategory = requireText(payload.taskCategory, "taskCategory");
      const version = await service.nextPatternVersion(order.id, taskCategory);
      await service.createPatternDeliverables(
        order,
        task,
        currentUser,
        version,
        payload,
        PATTERN_DELIVERABLE_TYPES.patternFile
      );
      const latestPatternVersion = await service.latestExistingPatternVersion(order.id);
      await service.repository.updateOrder(order.id, {
        latestPatternVersion: latestPatternVersion ?? version,
        patternStatus: PATTERN_STATUSES.has
      });
      return service.taskDto(await service.requireTask(task.id));
    }));
  }

  async updatePatternOrderAttachment(
    orderId: string,
    attachmentId: string,
    payload: PatternAttachmentPatchPayload,
    currentUser: CurrentUser
  ): Promise<OrderAttachmentRecord[]> {
    void orderId;
    void attachmentId;
    void payload;
    this.ensurePatternMaker(currentUser);
    throw new HttpError(410, "pattern source materials and deliverable history are read-only.");
  }

  async deletePatternOrderAttachment(
    orderId: string,
    attachmentId: string,
    payload: { note?: unknown },
    currentUser: CurrentUser
  ): Promise<OrderAttachmentRecord[]> {
    void orderId;
    void attachmentId;
    void payload;
    this.ensurePatternMaker(currentUser);
    throw new HttpError(410, "pattern source materials and deliverable history are read-only.");
  }

  async downloadPatternOrderAttachment(
    orderId: string,
    attachmentId: string,
    currentUser: CurrentUser
  ): Promise<AttachmentDownload> {
    const order = await this.requirePatternReadableOrder(orderId, currentUser);
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

  async downloadPatternDeliverable(
    orderId: string,
    deliverableId: string,
    currentUser: CurrentUser
  ): Promise<AttachmentDownload> {
    const order = await this.requireOrder(orderId);
    const deliverable = (await this.repository.listPatternDeliverablesByOrderId(order.id)).find(
      (item) => item.id === deliverableId
    );
    if (!deliverable) {
      throw new HttpError(404, "pattern deliverable not found.");
    }

    if (
      currentUser.role !== ROLES.boss &&
      currentUser.role !== ROLES.systemOwner &&
      currentUser.role !== ROLES.receiver
    ) {
      this.ensurePatternMaker(currentUser);
      const task = await this.repository.findPatternTaskById(deliverable.patternTaskId);
      if (deliverable.uploadedBy !== currentUser.id && task?.patternMakerId !== currentUser.id) {
        throw new HttpError(403, "forbidden");
      }
    }

    if (!deliverable.storageKey || !deliverable.fileName) {
      throw new HttpError(404, "pattern deliverable file is not available.");
    }

    try {
      return {
        fileName: deliverable.fileName,
        mimeType: deliverable.mimeType ?? "application/octet-stream",
        size: deliverable.size ?? 0,
        content: await this.fileStorage.readFile(deliverable.storageKey)
      };
    } catch (error) {
      if (error instanceof FileStorageNotFoundError) {
        throw new HttpError(404, "pattern deliverable file is not available.");
      }

      throw error;
    }
  }

  async deleteOwnPatternDeliverable(
    orderId: string,
    deliverableId: string,
    currentUser: CurrentUser
  ): Promise<PatternTaskDto> {
    return this.withWorkflowTransaction(async (service) => {
      const manager = currentUser.role === ROLES.boss || currentUser.role === ROLES.systemOwner;
      await service.repository.lockOrderForWorkflow(orderId);
      const order = await service.requireOrder(orderId);
      if (order.terminated) throw new HttpError(409, "订单已终止，无法继续修改。");
      if (!manager) service.ensurePatternMaker(currentUser);
      const deliverable = (await service.repository.listPatternDeliverablesByOrderId(order.id)).find(
        (item) => item.id === deliverableId
      );
      if (!deliverable) throw new HttpError(404, "pattern deliverable not found.");
      if (!manager && deliverable.uploadedBy !== currentUser.id) {
        throw new HttpError(403, "only the original uploader can delete this attachment.");
      }
      const task = await service.repository.findPatternTaskById(deliverable.patternTaskId);
      const requiredCategory = Boolean(
        deliverable.taskCategory &&
        deliverable.taskCategory !== "other" &&
        task?.requirements.includes(deliverable.taskCategory)
      );
      if (requiredCategory && isValidPatternRequirementDeliverable(deliverable)) {
        const hasAnotherValidDeliverable = (
          await service.repository.listPatternDeliverablesByOrderId(order.id)
        ).some(
          (item) =>
            item.id !== deliverable.id &&
            item.patternTaskId === deliverable.patternTaskId &&
            item.taskCategory === deliverable.taskCategory &&
            isValidPatternRequirementDeliverable(item)
        );
        if (!hasAnotherValidDeliverable) {
          throw new HttpError(409, "pattern_deliverable_minimum_required");
        }
      }
      if (deliverable.storageKey) {
        try {
          await service.fileStorage.deleteFile(deliverable.storageKey);
        } catch (error) {
          if (!(error instanceof FileStorageNotFoundError)) throw error;
        }
      }
      await service.repository.appendAttachmentAuditLog({
        orderId: order.id,
        attachmentId: deliverable.id,
        originalFileName: deliverable.fileName ?? `${deliverable.version}-${deliverable.type}`,
        action: "delete",
        actorId: currentUser.id,
        actorName: currentUser.displayName,
        actorRole: currentUser.role,
        originalUploaderId: deliverable.uploadedBy,
        originalUploaderName: deliverable.uploadedByName,
        originalUploaderRole: ROLES.patternMaker,
        attachmentCategory: deliverable.type,
        sourceCategory: "pattern_maker_upload",
        patternTaskId: deliverable.patternTaskId,
        patternTaskCategory: deliverable.taskCategory
      });
      const archived = await service.repository.archivePatternDeliverable(deliverable.id, new Date().toISOString());
      if (!archived) throw new HttpError(404, "pattern deliverable not found.");
      if (!task) throw new HttpError(404, "pattern task not found.");
      return service.taskDto(task);
    });
  }

  async changePatternDeliverableVisibility(
    orderId: string,
    deliverableId: string,
    payload: { visibility?: unknown },
    currentUser: CurrentUser
  ): Promise<PatternTaskDto> {
    const visibility = attachmentVisibilityFromInput(
      typeof payload.visibility === "string" ? payload.visibility : undefined,
      ATTACHMENT_VISIBILITY.internalOnly
    );
    return this.withWorkflowTransaction(async (service) => {
      const manager = currentUser.role === ROLES.boss || currentUser.role === ROLES.systemOwner;
      await service.repository.lockOrderForWorkflow(orderId);
      const order = await service.requireOrder(orderId);
      if (order.terminated) throw new HttpError(409, "订单已终止，无法继续修改。");
      if (!manager) service.ensurePatternMaker(currentUser);
      const deliverable = (await service.repository.listPatternDeliverablesByOrderId(order.id)).find(
        (item) => item.id === deliverableId
      );
      if (!deliverable?.storageKey || !deliverable.fileName) {
        throw new HttpError(404, "pattern deliverable file is not available.");
      }
      if (!manager && deliverable.uploadedBy !== currentUser.id) {
        throw new HttpError(403, "attachment_operation_forbidden");
      }
      const updated = await service.repository.updatePatternDeliverable(deliverable.id, { visibility });
      if (!updated) throw new HttpError(404, "pattern deliverable not found.");
      await auditAttachmentVisibilityChange({
        repository: service.repository,
        operationLogs: service.operationLogs,
        orderId: order.id,
        resourceId: deliverable.id,
        source: "pattern_deliverable",
        originalFileName: deliverable.fileName,
        originalVisibility: deliverable.visibility,
        newVisibility: visibility,
        currentUser,
        originalUploaderId: deliverable.uploadedBy,
        originalUploaderName: deliverable.uploadedByName,
        originalUploaderRole: ROLES.patternMaker,
        attachmentCategory: deliverable.type,
        sourceCategory: "pattern_maker_upload",
        patternTaskId: deliverable.patternTaskId,
        patternTaskCategory: deliverable.taskCategory
      });
      const task = await service.repository.findPatternTaskById(deliverable.patternTaskId);
      if (!task) throw new HttpError(404, "pattern task not found.");
      return service.taskDto(task);
    });
  }

  async renamePatternDeliverable(
    orderId: string,
    deliverableId: string,
    payload: { displayName?: unknown },
    currentUser: CurrentUser
  ): Promise<PatternTaskDto> {
    return this.withWorkflowTransaction(async (service) => {
      const manager = currentUser.role === ROLES.boss || currentUser.role === ROLES.systemOwner;
      await service.repository.lockOrderForWorkflow(orderId);
      const order = await service.requireOrder(orderId);
      if (order.terminated) throw new HttpError(409, "订单已终止，无法继续修改。");
      if (!manager) service.ensurePatternMaker(currentUser);
      const deliverable = (await service.repository.listPatternDeliverablesByOrderId(order.id)).find(
        (item) => item.id === deliverableId
      );
      if (!deliverable?.fileName) throw new HttpError(404, "pattern deliverable not found.");
      if (!manager && deliverable.uploadedBy !== currentUser.id) {
        throw new HttpError(403, "only the original uploader can rename this attachment.");
      }
      const fileName = renamedDisplayFileName(deliverable.fileName, payload.displayName);
      const updated = await service.repository.updatePatternDeliverable(deliverable.id, { fileName });
      if (!updated) throw new HttpError(404, "pattern deliverable not found.");
      await service.repository.appendAttachmentAuditLog({
        orderId: order.id,
        attachmentId: deliverable.id,
        originalFileName: deliverable.fileName!,
        newFileName: fileName,
        action: "rename",
        actorId: currentUser.id,
        actorName: currentUser.displayName,
        actorRole: currentUser.role,
        originalUploaderId: deliverable.uploadedBy,
        originalUploaderName: deliverable.uploadedByName,
        originalUploaderRole: ROLES.patternMaker,
        attachmentCategory: deliverable.type,
        sourceCategory: "pattern_maker_upload",
        patternTaskId: deliverable.patternTaskId,
        patternTaskCategory: deliverable.taskCategory
      });
      const task = await service.repository.findPatternTaskById(deliverable.patternTaskId);
      if (!task) throw new HttpError(404, "pattern task not found.");
      return service.taskDto(task);
    });
  }

  async listPatternLibraryEntries(
    currentUser: CurrentUser
  ): Promise<PatternLibraryEntryDto[]> {
    this.ensurePatternLibraryManager(currentUser);
    return (await this.repository.listPatternLibraryEntries()).map(linkedPatternForResponse);
  }

  async createPatternLibraryEntry(
    payload: LibraryPayload,
    currentUser: CurrentUser
  ): Promise<PatternLibraryEntryDto> {
    this.ensurePatternLibraryManager(currentUser);
    const created = await this.repository.createPatternLibraryEntry({
      styleNo: requireText(payload.styleNo, "styleNo"),
      patternVersion: requireText(payload.patternVersion, "patternVersion"),
      fileName: requireText(payload.fileName, "fileName"),
      createdBy: currentUser.id,
      ...(optionalText(payload.customerId) ? { customerId: optionalText(payload.customerId) } : {}),
      ...(optionalText(payload.customerName)
        ? { customerName: optionalText(payload.customerName) }
        : {}),
      ...(optionalText(payload.styleName) ? { styleName: optionalText(payload.styleName) } : {}),
      ...(optionalText(payload.note) ? { note: optionalText(payload.note) } : {})
    });
    return linkedPatternForResponse(created);
  }

  async linkPatternLibraryEntry(
    taskId: string,
    libraryEntryId: string,
    currentUser: CurrentUser
  ): Promise<PatternTaskDto> {
    return this.withPatternTaskMutationLock(taskId, () =>
      this.withWorkflowTransaction(async (service) => {
        service.ensurePatternMaker(currentUser);
        const beforeLock = await service.requireTask(taskId);
        await service.repository.lockOrderForWorkflow(beforeLock.orderId);
        const task = await service.requireTask(taskId);
        const order = await service.requireOrder(task.orderId);
        if (order.terminated) throw new HttpError(409, "订单已终止，无法继续修改。");
        const libraryEntry = await service.repository.findPatternLibraryEntryById(libraryEntryId);
        if (!libraryEntry) throw new HttpError(404, "pattern library entry not found.");
        if (task.patternMakerId !== currentUser.id || !task.startedAt) {
          throw new HttpError(403, "only the assigned pattern maker can link a pattern entry.");
        }
        const updated = await service.repository.updatePatternTask(task.id, {
          linkedPatternLibraryEntryId: libraryEntry.id
        });
        return service.taskDto(updated);
      })
    );
  }

  async completeTask(
    taskId: string,
    payload: PatternCompletionPayload,
    currentUser: CurrentUser
  ): Promise<PatternTaskDto> {
    return this.withPatternTaskMutationLock(taskId, () =>
      this.withWorkflowTransaction((service) =>
        service.completeTaskInTransaction(taskId, payload, currentUser)
      )
    );
  }

  private async completeTaskInTransaction(
    taskId: string,
    payload: PatternCompletionPayload,
    currentUser: CurrentUser
  ): Promise<PatternTaskDto> {
    this.ensurePatternMaker(currentUser);
    const taskBeforeLock = await this.requireTask(taskId);
    await this.repository.lockOrderForWorkflow(taskBeforeLock.orderId);
    const task = await this.requireTask(taskId);
    const order = await this.requireOrder(task.orderId);
    if (order.terminated) {
      throw new HttpError(409, "order is terminated.");
    }
    if (!task.startedAt || !isActivePatternTask(task)) {
      throw new HttpError(409, "pattern maker must claim the task before completion.");
    }
    if (task.patternMakerId !== currentUser.id) {
      throw new HttpError(403, "only the assigned pattern maker can complete this task.");
    }
    rejectLegacyFlowDecision(payload);

    const note = optionalText(payload.note) ?? "";
    const workHours = requirePositiveNumber(payload.workHours, "workHours");
    completedRequirementsForTask(task, payload.completedRequirements);
    const existingDeliverables = await this.repository.listPatternDeliverablesByOrderId(order.id);
    if (task.requirements.some(
      (requirement) => requirement === "pattern_making" || requirement === "pattern_revision"
    )) {
      requirePatternSubmissionContent(payload, existingDeliverables);
    }
    const shouldCreateDeliverables = hasNewPatternDeliverableContent(payload);
    const version = shouldCreateDeliverables
      ? await this.nextPatternVersion(order.id)
      : (await this.latestExistingPatternVersion(order.id)) ?? "V1";
    if (shouldCreateDeliverables) {
      await this.createPatternDeliverables(
        order,
        task,
        currentUser,
        version,
        payload,
        PATTERN_DELIVERABLE_TYPES.processNote
      );
    }
    const completedRequirements = deliveredRequirementsForTask(
      task,
      await this.repository.listPatternDeliverablesByOrderId(order.id)
    );
    requireAllTaskDeliverables(task, completedRequirements);
    const completionNote = note;
    const updated = await this.repository.updatePatternTask(task.id, {
      status: PATTERN_TASK_STATUSES.completed,
      completedRequirements,
      totalWorkHours: workHours,
      completionNote,
      patternMakerId: task.patternMakerId ?? currentUser.id,
      patternMakerName: task.patternMakerName ?? currentUser.displayName,
      completedAt: nowIso(),
      note: appendPatternTaskCompletionNote(task.note, completionNote)
    });
    await this.recordPatternWorkHours(order, updated, currentUser, workHours, completionNote);
    const correctionLogs = [
      ...order.correctionLogs,
      patternTaskCompletionLog(order, currentUser, completionNote)
    ];
    await this.repository.updateOrder(order.id, {
      patternStatus: PATTERN_STATUSES.has,
      latestPatternVersion: version,
      correctionLogs
    });
    return this.taskDto(updated);
  }

  async recordTaskOperation(
    taskId: string,
    payload: PatternOperationPayload,
    currentUser: CurrentUser
  ): Promise<PatternTaskDto> {
    return this.withPatternTaskMutationLock(taskId, () =>
      this.withWorkflowTransaction(async (service) => {
        service.ensurePatternMaker(currentUser);
        const taskBeforeLock = await service.requireTask(taskId);
        await service.repository.lockOrderForWorkflow(taskBeforeLock.orderId);
        const task = await service.requireTask(taskId);
        const order = await service.requireOrder(task.orderId);
        if (order.terminated) {
          throw new HttpError(409, "order is terminated.");
        }
        if (!task.startedAt || !isActivePatternTask(task)) {
          throw new HttpError(409, "pattern maker must claim the task from the workbench before submitting.");
        }
        if (task.patternMakerId !== currentUser.id) {
          throw new HttpError(403, "only the assigned pattern maker can update this task.");
        }

        const operation = requirePatternOperation(payload.operation);
        const note = optionalText(payload.note);
        const nextNote = appendTaskNote(task.note, operation, note);
        const updated = await service.repository.updatePatternTask(task.id, {
          note: nextNote,
          patternMakerId: task.patternMakerId ?? currentUser.id,
          patternMakerName: task.patternMakerName ?? currentUser.displayName
        });

        return service.taskDto(updated);
      })
    );
  }

  async submitCuttingVersion(
    taskId: string,
    payload: SubmitPayload,
    currentUser: CurrentUser
  ): Promise<SubmittedCuttingVersionDto> {
    return submissionForResponse(
      await this.withPatternTaskMutationLock(taskId, () =>
        this.withWorkflowTransaction((service) =>
          service.submitCuttingVersionInTransaction(taskId, payload, currentUser)
        )
      )
    );
  }

  private async submitCuttingVersionInTransaction(
    taskId: string,
    payload: SubmitPayload,
    currentUser: CurrentUser
  ): Promise<SubmittedCuttingVersionRecord> {
    this.ensurePatternMaker(currentUser);
    const taskBeforeLock = await this.requireTask(taskId);
    await this.repository.lockOrderForWorkflow(taskBeforeLock.orderId);
    const task = await this.requireTask(taskId);
    const order = await this.requireOrder(task.orderId);
    if (order.terminated) {
      throw new HttpError(409, "order is terminated.");
    }
    if (!task.startedAt || !isActivePatternTask(task)) {
      throw new HttpError(409, "pattern maker must claim the task before submitting deliverables.");
    }
    if (task.patternMakerId !== currentUser.id) {
      throw new HttpError(403, "only the assigned pattern maker can submit this task.");
    }
    rejectLegacyFlowDecision(payload);
    const workHours = requirePositiveNumber(payload.workHours, "workHours");
    const note = requireText(payload.note, "note");
    if (payload.completedRequirements === undefined) {
      throw new HttpError(400, "completedRequirements is required.");
    }
    completedRequirementsForTask(task, payload.completedRequirements);
    const existingDeliverables = await this.repository.listPatternDeliverablesByOrderId(order.id);
    requirePatternSubmissionContent(payload, existingDeliverables);
    const shouldCreateDeliverables = hasNewPatternDeliverableContent(payload);
    const submissionNote = note;

    let folder = await this.repository.findOrderFolderByOrderId(order.id);
    if (!folder) {
      folder = await this.ensureFolderForOrder(order, currentUser);
    }

    const version = shouldCreateDeliverables
      ? await this.nextPatternVersion(order.id)
      : (await this.latestExistingPatternVersion(order.id)) ?? "V1";
    const paths = buildSubmittedCuttingVersionPaths(folder, version, getPatternFileRoots(this.env));
    await ensureSubmittedCuttingFolders(paths);
    if (shouldCreateDeliverables) {
      await this.createPatternDeliverables(
        order,
        task,
        currentUser,
        version,
        payload,
        PATTERN_DELIVERABLE_TYPES.cuttingPatternFile
      );
    }

    const files = submittedFilesFromPayload(payload.files, version, paths.submittedCuttingPath);
    const completedRequirements = deliveredRequirementsForTask(
      task,
      await this.repository.listPatternDeliverablesByOrderId(order.id)
    );
    requireAllTaskDeliverables(task, completedRequirements);

    const submittedAt = nowIso();
    const submission = await this.repository.createSubmittedCuttingVersion({
      orderId: order.id,
      patternTaskId: task.id,
      version,
      submittedBy: currentUser.id,
      submittedByName: currentUser.displayName,
      submittedAt,
      purpose: "cutting_handoff",
      orderFolderPath: folder.rootPath,
      submittedCuttingPath: paths.submittedCuttingPath,
      cuttingInboxPath: paths.cuttingInboxPath,
      status: CUTTING_INBOX_STATUSES.pendingPrint,
      statusUpdatedAt: submittedAt,
      note: submissionNote,
      workHours,
      files
    });

    await this.recordPatternWorkHours(order, task, currentUser, workHours, submissionNote);

    await Promise.all([
      this.repository.updatePatternTask(task.id, {
        status: PATTERN_TASK_STATUSES.completed,
        completedRequirements,
        totalWorkHours: workHours,
        completionNote: submissionNote,
        completedAt: submittedAt,
        submittedAt,
        orderFolderId: folder.id,
        note: submissionNote ? (task.note ? `${task.note}\n${submissionNote}` : submissionNote) : task.note
      }),
      this.repository.updateOrder(order.id, {
        patternStatus: PATTERN_STATUSES.has,
        latestPatternVersion: version,
        cuttingUsedPatternVersion: version,
        ...((order.stage === ORDER_STAGES.patternWaiting || order.stage === ORDER_STAGES.patternDoing) &&
        files.length > 0
          ? { stage: firstPhysicalOrderStage(order.sampleRequestItems) }
          : {}),
        correctionLogs: order.correctionLogs
      })
    ]);

    return submission;
  }

  async supplementPatternVersion(
    taskId: string,
    payload: SubmitPayload,
    currentUser: CurrentUser
  ): Promise<SubmittedCuttingVersionDto> {
    return submissionForResponse(
      await this.withPatternTaskMutationLock(taskId, () =>
        this.withWorkflowTransaction((service) =>
          service.supplementPatternVersionInTransaction(taskId, payload, currentUser)
        )
      )
    );
  }

  private async supplementPatternVersionInTransaction(
    taskId: string,
    payload: SubmitPayload,
    currentUser: CurrentUser
  ): Promise<SubmittedCuttingVersionRecord> {
    this.ensurePatternMaker(currentUser);
    const taskBeforeLock = await this.requireTask(taskId);
    await this.repository.lockOrderForWorkflow(taskBeforeLock.orderId);
    const task = await this.requireTask(taskId);
    const order = await this.requireOrder(task.orderId);
    if (order.terminated) {
      throw new HttpError(409, "order is terminated.");
    }
    if (!task.startedAt || task.status === PATTERN_TASK_STATUSES.pending) {
      throw new HttpError(409, "pattern maker must claim the task from the workbench before uploading revisions.");
    }
    if (!isFinalPatternTask(task)) {
      throw new HttpError(409, "supplemental versions are only allowed after the task is submitted or completed.");
    }
    if (task.patternMakerId !== currentUser.id) {
      throw new HttpError(403, "only the assigned pattern maker can upload revisions.");
    }

    const workHours = requirePositiveNumber(payload.workHours, "workHours");
    const note = requireText(payload.note, "note");
    requirePatternSubmissionContent(payload);
    let folder = await this.repository.findOrderFolderByOrderId(order.id);
    if (!folder) {
      folder = await this.ensureFolderForOrder(order, currentUser);
    }

    const version = await this.nextPatternVersion(order.id);
    const paths = buildSubmittedCuttingVersionPaths(folder, version, getPatternFileRoots(this.env));
    await ensureSubmittedCuttingFolders(paths);
    await this.createPatternDeliverables(
      order,
      task,
      currentUser,
      version,
      payload,
      PATTERN_DELIVERABLE_TYPES.revisionNote
    );

    const files = submittedFilesFromPayload(payload.files, version, paths.submittedCuttingPath);

    const submittedAt = nowIso();
    const submission = await this.repository.createSubmittedCuttingVersion({
      orderId: order.id,
      patternTaskId: task.id,
      version,
      submittedBy: currentUser.id,
      submittedByName: currentUser.displayName,
      submittedAt,
      purpose: "supplemental_revision",
      orderFolderPath: folder.rootPath,
      submittedCuttingPath: paths.submittedCuttingPath,
      cuttingInboxPath: paths.cuttingInboxPath,
      status: CUTTING_INBOX_STATUSES.pendingPrint,
      statusUpdatedAt: submittedAt,
      note,
      workHours,
      files
    });

    await Promise.all([
      this.repository.updatePatternTask(task.id, {
        totalWorkHours: (task.totalWorkHours ?? 0) + workHours,
        completionNote: task.completionNote
          ? `${task.completionNote}\n${version}: ${note}`
          : `${version}: ${note}`,
        note: task.note ? `${task.note}\n${version}: ${note}` : `${version}: ${note}`
      }),
      this.repository.updateOrder(order.id, {
        latestPatternVersion: version,
        patternStatus: PATTERN_STATUSES.has
      })
    ]);

    return submission;
  }

  async listCuttingInbox(currentUser: CurrentUser): Promise<CuttingInboxSubmissionDto[]> {
    this.ensureCuttingRoomUser(currentUser);
    const submissions = await this.repository.listSubmittedCuttingVersions();
    const visible: CuttingInboxSubmissionDto[] = [];
    for (const submission of submissions) {
      const order = await this.repository.findOrderById(submission.orderId);
      const task = await this.repository.findPatternTaskById(submission.patternTaskId);
      visible.push({
        ...submissionForResponse(submission),
        ...(order
          ? {
              order: {
                id: order.id,
                styleNo: order.styleNo,
                styleName: order.styleName,
                quantity: order.quantity,
                stage: order.stage,
                sampleType: order.sampleType,
                sampleRound: order.sampleRound,
                patternTaskNote: task?.note
              }
            }
          : {})
      });
    }

    return visible;
  }

  async updateCuttingInboxStatus(
    submissionId: string,
    status: CuttingInboxStatus,
    payload: CuttingStatusPayload,
    currentUser: CurrentUser
  ): Promise<SubmittedCuttingVersionDto> {
    this.ensureCuttingRoomUser(currentUser);
    return this.withWorkflowTransaction(async (service) => {
      const submissionBeforeLock = await service.repository.findSubmittedCuttingVersionById(submissionId);
      if (!submissionBeforeLock) {
        throw new HttpError(404, "submitted cutting version not found.");
      }
      await service.repository.lockOrderForWorkflow(submissionBeforeLock.orderId);
      const [submission, order] = await Promise.all([
        service.repository.findSubmittedCuttingVersionById(submissionId),
        service.requireOrder(submissionBeforeLock.orderId)
      ]);
      if (!submission) {
        throw new HttpError(404, "submitted cutting version not found.");
      }
      if (order.terminated) {
        throw new HttpError(409, "order is terminated.");
      }

      const at = nowIso();
      return submissionForResponse(
        await service.repository.updateSubmittedCuttingVersion(submission.id, {
          status,
          statusUpdatedAt: at,
          ...(status === CUTTING_INBOX_STATUSES.printed ? { printedAt: at } : {}),
          ...(status === CUTTING_INBOX_STATUSES.cut ? { cutAt: at } : {}),
          ...(optionalText(payload.note) ? { note: optionalText(payload.note) } : {})
        })
      );
    });
  }
}
