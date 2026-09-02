import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type {
  OrderFolderCreateInput,
  OrderFolderRecord,
  PatternDeliverableCreateInput,
  PatternDeliverableRecord,
  PatternDeliverableUpdateInput,
  PatternLibraryEntryCreateInput,
  PatternLibraryEntryRecord,
  PatternLibraryEntryUpdateInput,
  PatternTaskCreateInput,
  PatternTaskClaimInput,
  PatternTaskRecord,
  PatternTaskUpdateInput,
  SubmittedCuttingVersionCreateInput,
  SubmittedCuttingVersionRecord,
  SubmittedCuttingVersionUpdateInput
} from "../../../modules/patterns/patternTypes.js";
import { createPrismaClient } from "./prismaClient.js";

type PrismaOrderFolder = Awaited<
  ReturnType<PrismaClient["orderFolder"]["findFirst"]>
>;
type PrismaPatternTask = Awaited<
  ReturnType<PrismaClient["patternTask"]["findFirst"]>
>;
type PrismaPatternDeliverable = Awaited<
  ReturnType<PrismaClient["patternDeliverable"]["findFirst"]>
>;
type PrismaPatternLibraryEntry = Awaited<
  ReturnType<PrismaClient["patternLibraryEntry"]["findFirst"]>
>;
type PrismaSubmittedCuttingVersion = Awaited<
  ReturnType<PrismaClient["submittedCuttingVersion"]["findFirst"]>
>;

function iso(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapOrderFolder(record: NonNullable<PrismaOrderFolder>): OrderFolderRecord {
  return {
    id: record.id,
    orderId: record.orderId,
    year: record.year,
    customerSegment: record.customerSegment,
    folderName: record.folderName,
    rootPath: record.rootPath,
    relativePath: record.relativePath,
    displayPath: record.displayPath,
    patternWorkPath: record.patternWorkPath,
    markerWorkPath: record.markerWorkPath,
    submittedCuttingPath: record.submittedCuttingPath,
    measurementPath: record.measurementPath,
    samplePhotoPath: record.samplePhotoPath,
    outboundPhotoPath: record.outboundPhotoPath,
    oldVersionPath: record.oldVersionPath,
    readmePath: record.readmePath,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function mapPatternTask(record: NonNullable<PrismaPatternTask>): PatternTaskRecord {
  return {
    id: record.id,
    orderId: record.orderId,
    status: record.status,
    requirements: record.requirements as PatternTaskRecord["requirements"],
    completedRequirements:
      record.completedRequirements as PatternTaskRecord["completedRequirements"],
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(record.totalWorkHours !== null ? { totalWorkHours: record.totalWorkHours } : {}),
    ...(record.completionNote ? { completionNote: record.completionNote } : {}),
      ...(record.patternMakerAccountId ? { patternMakerId: record.patternMakerAccountId } : {}),
    ...(record.patternMakerName ? { patternMakerName: record.patternMakerName } : {}),
    ...(record.internalName ? { internalName: record.internalName } : {}),
    ...(record.linkedPatternLibraryEntryId
      ? { linkedPatternLibraryEntryId: record.linkedPatternLibraryEntryId }
      : {}),
    ...(record.orderFolderId ? { orderFolderId: record.orderFolderId } : {}),
    ...(record.note ? { note: record.note } : {}),
    ...(iso(record.pausedAt) ? { pausedAt: iso(record.pausedAt) } : {}),
    ...(record.pausedReason ? { pausedReason: record.pausedReason } : {}),
    ...(iso(record.startedAt) ? { startedAt: iso(record.startedAt) } : {}),
    ...(iso(record.completedAt) ? { completedAt: iso(record.completedAt) } : {}),
    ...(iso(record.submittedAt) ? { submittedAt: iso(record.submittedAt) } : {})
  };
}

function mapPatternDeliverable(
  record: NonNullable<PrismaPatternDeliverable>
): PatternDeliverableRecord {
  return {
    id: record.id,
    orderId: record.orderId,
    patternTaskId: record.patternTaskId,
    version: record.version,
    type: record.type,
    visibility: record.visibility,
    uploadedBy: record.uploadedBy,
    createdAt: record.createdAt.toISOString(),
    ...(record.fileName ? { fileName: record.fileName } : {}),
    ...(record.mimeType ? { mimeType: record.mimeType } : {}),
    ...(record.size !== null ? { size: record.size } : {}),
    ...(record.storageKey ? { storageKey: record.storageKey } : {}),
    ...(record.textValue ? { textValue: record.textValue } : {}),
    ...(record.structuredData
      ? { structuredData: record.structuredData as Record<string, unknown> }
      : {}),
    ...(record.uploadedByName ? { uploadedByName: record.uploadedByName } : {}),
    ...(record.taskCategory ? { taskCategory: record.taskCategory as PatternDeliverableRecord["taskCategory"] } : {}),
    ...(iso(record.archivedAt) ? { archivedAt: iso(record.archivedAt) } : {})
  };
}

function mapPatternLibraryEntry(
  record: NonNullable<PrismaPatternLibraryEntry>
): PatternLibraryEntryRecord {
  return {
    id: record.id,
    styleNo: record.styleNo,
    patternVersion: record.patternVersion,
    fileName: record.fileName,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(record.customerId ? { customerId: record.customerId } : {}),
    ...(record.customerName ? { customerName: record.customerName } : {}),
    ...(record.styleName ? { styleName: record.styleName } : {}),
    ...(record.localPath ? { localPath: record.localPath } : {}),
    ...(record.storageKey ? { storageKey: record.storageKey } : {}),
    ...(record.note ? { note: record.note } : {})
  };
}

function mapSubmittedCuttingVersion(
  record: NonNullable<PrismaSubmittedCuttingVersion> & {
    files?: Array<{
      id: string;
      submissionId: string;
      fileName: string;
      localPath: string;
      sizeBytes: number | null;
      createdAt: Date;
    }>;
  }
): SubmittedCuttingVersionRecord {
  return {
    id: record.id,
    orderId: record.orderId,
    patternTaskId: record.patternTaskId,
    version: record.version,
    submittedBy: record.submittedBy,
    submittedAt: record.submittedAt.toISOString(),
    purpose: (record.purpose as SubmittedCuttingVersionRecord["purpose"]) ?? "cutting_handoff",
    orderFolderPath: record.orderFolderPath,
    submittedCuttingPath: record.submittedCuttingPath,
    cuttingInboxPath: record.cuttingInboxPath,
    status: record.status,
    files:
      record.files?.map((file) => ({
        id: file.id,
        submissionId: file.submissionId,
        fileName: file.fileName,
        localPath: file.localPath,
        createdAt: file.createdAt.toISOString(),
        ...(file.sizeBytes !== null ? { sizeBytes: file.sizeBytes } : {})
      })) ?? [],
    ...(record.submittedByName ? { submittedByName: record.submittedByName } : {}),
    ...(iso(record.statusUpdatedAt) ? { statusUpdatedAt: iso(record.statusUpdatedAt) } : {}),
    ...(iso(record.printedAt) ? { printedAt: iso(record.printedAt) } : {}),
    ...(iso(record.cutAt) ? { cutAt: iso(record.cutAt) } : {}),
    ...(record.note ? { note: record.note } : {}),
    ...(record.workHours !== null ? { workHours: record.workHours } : {})
  };
}

function dateOrNull(value: string | undefined) {
  return value ? new Date(value) : null;
}

function withOptionalString(
  data: object,
  key: string,
  value: string | undefined
) {
  if (value !== undefined) {
    (data as Record<string, unknown>)[key] = value;
  }
}

export class PrismaPatternWorkflowRepository {
  constructor(private readonly prisma: PrismaClient = createPrismaClient()) {}

  async createOrderFolder(input: OrderFolderCreateInput): Promise<OrderFolderRecord> {
    const record = await this.prisma.orderFolder.upsert({
      where: { orderId: input.orderId },
      create: input,
      update: {}
    });
    return mapOrderFolder(record);
  }

  async findOrderFolderByOrderId(orderId: string): Promise<OrderFolderRecord | undefined> {
    const record = await this.prisma.orderFolder.findUnique({ where: { orderId } });
    return record ? mapOrderFolder(record) : undefined;
  }

  async createPatternTask(input: PatternTaskCreateInput): Promise<PatternTaskRecord> {
    const createData: Prisma.PatternTaskUncheckedCreateInput = {
      orderId: input.orderId,
      status: input.status ?? "pending",
      requirements: input.requirements ?? [],
      completedRequirements: input.completedRequirements ?? []
    };
    if (input.totalWorkHours !== undefined) createData.totalWorkHours = input.totalWorkHours;
    withOptionalString(createData, "completionNote", input.completionNote);
    withOptionalString(createData, "patternMakerAccountId", input.patternMakerId);
    withOptionalString(createData, "patternMakerName", input.patternMakerName);
    withOptionalString(createData, "internalName", input.internalName);
    withOptionalString(createData, "linkedPatternLibraryEntryId", input.linkedPatternLibraryEntryId);
    withOptionalString(createData, "orderFolderId", input.orderFolderId);
    withOptionalString(createData, "note", input.note);
    withOptionalString(createData, "pausedReason", input.pausedReason);
    if (input.pausedAt !== undefined) createData.pausedAt = dateOrNull(input.pausedAt);

    const record = await this.prisma.patternTask.upsert({
      where: { orderId: input.orderId },
      create: createData,
      update: {}
    });
    return mapPatternTask(record);
  }

  async updatePatternTask(
    id: string,
    input: PatternTaskUpdateInput
  ): Promise<PatternTaskRecord> {
    const data: Prisma.PatternTaskUncheckedUpdateInput = {};
    if (input.status !== undefined) data.status = input.status;
    if (input.requirements !== undefined) data.requirements = input.requirements;
    if (input.completedRequirements !== undefined) {
      data.completedRequirements = input.completedRequirements;
    }
    if (input.totalWorkHours !== undefined) data.totalWorkHours = input.totalWorkHours;
    if (input.completionNote !== undefined) data.completionNote = input.completionNote;
    if (input.patternMakerId !== undefined) data.patternMakerAccountId = input.patternMakerId;
    if (input.patternMakerName !== undefined) data.patternMakerName = input.patternMakerName;
    if (input.internalName !== undefined) data.internalName = input.internalName;
    if (input.linkedPatternLibraryEntryId !== undefined) {
      data.linkedPatternLibraryEntryId = input.linkedPatternLibraryEntryId;
    }
    if (input.orderFolderId !== undefined) data.orderFolderId = input.orderFolderId;
    if (input.note !== undefined) data.note = input.note;
    if (input.pausedAt !== undefined) data.pausedAt = dateOrNull(input.pausedAt);
    if (input.pausedReason !== undefined) data.pausedReason = input.pausedReason;
    if (input.startedAt !== undefined) data.startedAt = dateOrNull(input.startedAt);
    if (input.completedAt !== undefined) data.completedAt = dateOrNull(input.completedAt);
    if (input.submittedAt !== undefined) data.submittedAt = dateOrNull(input.submittedAt);

    const record = await this.prisma.patternTask.update({
      where: { id },
      data
    });
    return mapPatternTask(record);
  }

  async claimPendingPatternTask(
    id: string,
    input: PatternTaskClaimInput
  ): Promise<PatternTaskRecord | undefined> {
    const claimed = await this.prisma.patternTask.updateMany({
      where: { id, status: "pending", patternMakerAccountId: null },
      data: {
        status: "active",
        patternMakerAccountId: input.patternMakerId,
        patternMakerName: input.patternMakerName ?? null,
        startedAt: new Date(input.startedAt),
        pausedAt: null,
        pausedReason: null
      }
    });
    if (claimed.count !== 1) return undefined;
    return this.findPatternTaskById(id);
  }

  async deletePendingPatternTask(id: string): Promise<boolean> {
    const deleted = await this.prisma.patternTask.deleteMany({
      where: { id, status: "pending", patternMakerAccountId: null }
    });
    return deleted.count === 1;
  }

  async findPatternTaskById(id: string): Promise<PatternTaskRecord | undefined> {
    const record = await this.prisma.patternTask.findUnique({ where: { id } });
    return record ? mapPatternTask(record) : undefined;
  }

  async findPatternTaskByOrderId(orderId: string): Promise<PatternTaskRecord | undefined> {
    const record = await this.prisma.patternTask.findUnique({ where: { orderId } });
    return record ? mapPatternTask(record) : undefined;
  }

  async listPatternTasks(): Promise<PatternTaskRecord[]> {
    const records = await this.prisma.patternTask.findMany({ orderBy: { createdAt: "desc" } });
    return records.map(mapPatternTask);
  }

  async createPatternDeliverable(input: PatternDeliverableCreateInput): Promise<PatternDeliverableRecord> {
    const record = await this.prisma.patternDeliverable.create({
      data: {
        orderId: input.orderId,
        patternTaskId: input.patternTaskId,
        version: input.version,
        type: input.type,
        fileName: input.fileName ?? null,
        mimeType: input.mimeType ?? null,
        size: input.size ?? null,
        storageKey: input.storageKey ?? null,
        textValue: input.textValue ?? null,
        structuredData: input.structuredData
          ? (input.structuredData as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        visibility: input.visibility,
        uploadedBy: input.uploadedBy,
        uploadedByName: input.uploadedByName ?? null,
        taskCategory: input.taskCategory ?? null,
        archivedAt: input.archivedAt ? new Date(input.archivedAt) : null
      }
    });
    return mapPatternDeliverable(record);
  }

  async listPatternDeliverablesByOrderId(orderId: string): Promise<PatternDeliverableRecord[]> {
    const records = await this.prisma.patternDeliverable.findMany({
      where: { orderId, archivedAt: null },
      orderBy: { createdAt: "desc" }
    });
    return records.map(mapPatternDeliverable);
  }

  async updatePatternDeliverable(
    id: string,
    input: PatternDeliverableUpdateInput
  ): Promise<PatternDeliverableRecord | undefined> {
    const existing = await this.prisma.patternDeliverable.findUnique({ where: { id } });
    if (!existing || existing.archivedAt) return undefined;
    return mapPatternDeliverable(
      await this.prisma.patternDeliverable.update({
        where: { id },
        data: {
          ...(input.fileName !== undefined ? { fileName: input.fileName } : {})
        }
      })
    );
  }

  async archivePatternDeliverable(id: string, archivedAt: string): Promise<PatternDeliverableRecord | undefined> {
    const existing = await this.prisma.patternDeliverable.findUnique({ where: { id } });
    if (!existing || existing.archivedAt) return undefined;
    return mapPatternDeliverable(await this.prisma.patternDeliverable.update({
      where: { id },
      data: { archivedAt: new Date(archivedAt) }
    }));
  }

  async createPatternLibraryEntry(
    input: PatternLibraryEntryCreateInput
  ): Promise<PatternLibraryEntryRecord> {
    const data: Prisma.PatternLibraryEntryUncheckedCreateInput = {
      styleNo: input.styleNo,
      patternVersion: input.patternVersion,
      fileName: input.fileName,
      createdBy: input.createdBy
    };
    withOptionalString(data, "customerId", input.customerId);
    withOptionalString(data, "customerName", input.customerName);
    withOptionalString(data, "styleName", input.styleName);
    withOptionalString(data, "localPath", input.localPath);
    withOptionalString(data, "storageKey", input.storageKey);
    withOptionalString(data, "note", input.note);
    const record = await this.prisma.patternLibraryEntry.create({ data });
    return mapPatternLibraryEntry(record);
  }

  async updatePatternLibraryEntry(
    id: string,
    input: PatternLibraryEntryUpdateInput
  ): Promise<PatternLibraryEntryRecord> {
    const data: Prisma.PatternLibraryEntryUncheckedUpdateInput = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) {
        (data as Record<string, unknown>)[key] = value;
      }
    }
    const record = await this.prisma.patternLibraryEntry.update({ where: { id }, data });
    return mapPatternLibraryEntry(record);
  }

  async findPatternLibraryEntryById(
    id: string
  ): Promise<PatternLibraryEntryRecord | undefined> {
    const record = await this.prisma.patternLibraryEntry.findUnique({ where: { id } });
    return record ? mapPatternLibraryEntry(record) : undefined;
  }

  async listPatternLibraryEntries(): Promise<PatternLibraryEntryRecord[]> {
    const records = await this.prisma.patternLibraryEntry.findMany({
      orderBy: { createdAt: "desc" }
    });
    return records.map(mapPatternLibraryEntry);
  }

  async createSubmittedCuttingVersion(
    input: SubmittedCuttingVersionCreateInput
  ): Promise<SubmittedCuttingVersionRecord> {
    const data: Prisma.SubmittedCuttingVersionUncheckedCreateInput = {
      orderId: input.orderId,
      patternTaskId: input.patternTaskId,
      version: input.version,
      submittedBy: input.submittedBy,
      submittedAt: new Date(input.submittedAt),
      purpose: input.purpose,
      orderFolderPath: input.orderFolderPath,
      submittedCuttingPath: input.submittedCuttingPath,
      cuttingInboxPath: input.cuttingInboxPath,
      status: input.status,
      workHours: input.workHours ?? null,
      files: {
        create: input.files.map((file) => ({
          fileName: file.fileName,
          localPath: file.localPath,
          ...(file.sizeBytes !== undefined ? { sizeBytes: file.sizeBytes } : {})
        }))
      }
    };
    withOptionalString(data, "submittedByName", input.submittedByName);
    if (input.statusUpdatedAt !== undefined) data.statusUpdatedAt = dateOrNull(input.statusUpdatedAt);
    if (input.printedAt !== undefined) data.printedAt = dateOrNull(input.printedAt);
    if (input.cutAt !== undefined) data.cutAt = dateOrNull(input.cutAt);
    withOptionalString(data, "note", input.note);

    const record = await this.prisma.submittedCuttingVersion.create({
      data,
      include: { files: true }
    });
    return mapSubmittedCuttingVersion(record);
  }

  async updateSubmittedCuttingVersion(
    id: string,
    input: SubmittedCuttingVersionUpdateInput
  ): Promise<SubmittedCuttingVersionRecord> {
    const data: Prisma.SubmittedCuttingVersionUncheckedUpdateInput = {};
    if (input.status !== undefined) data.status = input.status;
    if (input.statusUpdatedAt !== undefined) data.statusUpdatedAt = dateOrNull(input.statusUpdatedAt);
    if (input.printedAt !== undefined) data.printedAt = dateOrNull(input.printedAt);
    if (input.cutAt !== undefined) data.cutAt = dateOrNull(input.cutAt);
    if (input.note !== undefined) data.note = input.note;

    const record = await this.prisma.submittedCuttingVersion.update({
      where: { id },
      data,
      include: { files: true }
    });
    return mapSubmittedCuttingVersion(record);
  }

  async findSubmittedCuttingVersionById(
    id: string
  ): Promise<SubmittedCuttingVersionRecord | undefined> {
    const record = await this.prisma.submittedCuttingVersion.findUnique({
      where: { id },
      include: { files: true }
    });
    return record ? mapSubmittedCuttingVersion(record) : undefined;
  }

  async listSubmittedCuttingVersions(): Promise<SubmittedCuttingVersionRecord[]> {
    const records = await this.prisma.submittedCuttingVersion.findMany({
      include: { files: true },
      orderBy: { submittedAt: "desc" }
    });
    return records.map(mapSubmittedCuttingVersion);
  }

  async listSubmittedCuttingVersionsByOrderId(
    orderId: string
  ): Promise<SubmittedCuttingVersionRecord[]> {
    const records = await this.prisma.submittedCuttingVersion.findMany({
      where: { orderId },
      include: { files: true },
      orderBy: { submittedAt: "desc" }
    });
    return records.map(mapSubmittedCuttingVersion);
  }
}
