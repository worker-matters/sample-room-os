import { Prisma } from "@prisma/client";
import type { OrderStage } from "@sample-room/shared";
import type { SampleRoomPrismaClient } from "./prismaClient.js";
import { isProductionStage, recordActionForScanAction, stageForOrderStage } from "../../../modules/scan/scanWorkflow.js";
import type {
  OrderScanTokenCreateInput,
  OrderScanTokenRecord,
  ProductionStage,
  QualityResult,
  ScanRecord,
  ScanRecordCreateInput
} from "../../../modules/scan/scanTypes.js";

const optionalText = (value: string | null): string | undefined => value ?? undefined;
const iso = (value: Date | null): string | undefined => value?.toISOString();

function mapScanToken(record: { id: string; orderId: string; token: string; stage: OrderStage | null; createdAt: Date; expiresAt: Date | null; revokedAt: Date | null }): OrderScanTokenRecord {
  return { id: record.id, orderId: record.orderId, token: record.token, stage: record.stage, createdAt: record.createdAt.toISOString(), expiresAt: iso(record.expiresAt), revokedAt: iso(record.revokedAt) };
}

function productionStageFromPayload(payload: Prisma.JsonValue | null, orderStage: OrderStage): ProductionStage {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const value = (payload as Record<string, unknown>).productionStage;
    if (isProductionStage(value)) return value;
  }
  return stageForOrderStage(orderStage) ?? "pattern";
}

function mapScanRecord(record: {
  id: string;
  orderId: string;
  actorAccountId: string;
  workerProfileId: string | null;
  actorNameSnapshot: string | null;
  actorType: "production_worker" | "internal_account";
  actorRole: ScanRecord["actorRole"];
  action: ScanRecord["scanAction"];
  stage: OrderStage;
  scannedAt: Date;
  workHours: number | null;
  pieces: number | null;
  note: string | null;
  source: string;
  payload: Prisma.JsonValue | null;
}): ScanRecord {
  const payload = record.payload && typeof record.payload === "object" && !Array.isArray(record.payload) ? record.payload as Record<string, unknown> : {};
  const text = (key: string) => typeof payload[key] === "string" ? payload[key] as string : undefined;
  const number = (key: string) => typeof payload[key] === "number" && Number.isFinite(payload[key]) ? payload[key] as number : undefined;
  const boolean = (key: string) => typeof payload[key] === "boolean" ? payload[key] as boolean : undefined;
  const textArray = (key: string) => Array.isArray(payload[key]) ? (payload[key] as unknown[]).filter((value): value is string => typeof value === "string") : undefined;
  const qualityResult = text("qualityResult");
  const terminationSettlementStatus = text("terminationSettlementStatus");
  const legacyMeasurementPhotoAttachmentId = text("measurementPhotoAttachmentId");
  const storedMeasurementPhotoAttachmentIds = textArray("measurementPhotoAttachmentIds");
  const measurementPhotoAttachmentIds = storedMeasurementPhotoAttachmentIds?.length
    ? storedMeasurementPhotoAttachmentIds
    : legacyMeasurementPhotoAttachmentId
      ? [legacyMeasurementPhotoAttachmentId]
      : storedMeasurementPhotoAttachmentIds;
  return {
    id: record.id,
    orderId: record.orderId,
    actorAccountId: record.actorAccountId,
    workerProfileId: record.workerProfileId ?? undefined,
    stage: productionStageFromPayload(record.payload, record.stage),
    orderStage: record.stage,
    action: recordActionForScanAction(record.action),
    scanAction: record.action,
    workerId: record.workerProfileId ?? record.actorAccountId,
    workerName: record.actorNameSnapshot ?? "Unknown actor",
    actorType: record.actorType,
    actorRole: record.actorRole,
    eventTime: record.scannedAt.toISOString(),
    workHours: record.workHours ?? undefined,
    pieces: record.pieces ?? undefined,
    note: optionalText(record.note),
    collaborationJoin: boolean("collaborationJoin"),
    takeoverFromWorkerId: text("takeoverFromWorkerId"),
    takeoverFromWorkerName: text("takeoverFromWorkerName"),
    takeoverReason: text("takeoverReason"),
    qualityResult: qualityResult === "qualified" || qualityResult === "rework" || qualityResult === "rejected" ? qualityResult as QualityResult : undefined,
    qualityScore: number("qualityScore"),
    samplePhotoAttachmentIds: textArray("samplePhotoAttachmentIds"),
    measurementPhotoAttachmentIds,
    measurementPhotoAttachmentId: legacyMeasurementPhotoAttachmentId,
    terminationCycleAt: text("terminationCycleAt"),
    terminationSettlementStatus:
      terminationSettlementStatus === "pending" ||
      terminationSettlementStatus === "accepted" ||
      terminationSettlementStatus === "historical"
        ? terminationSettlementStatus
        : undefined,
    source: "scan"
  };
}

export class PrismaScanWorkflowRepository {
  constructor(private readonly prisma: SampleRoomPrismaClient) {}

  async createOrderScanToken(input: OrderScanTokenCreateInput): Promise<OrderScanTokenRecord> {
    const record = await this.prisma.scanToken.create({ data: { orderId: input.orderId, token: input.token, stage: input.stage ?? null, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } });
    return mapScanToken(record);
  }
  async findOrderScanToken(token: string): Promise<OrderScanTokenRecord | undefined> { const record = await this.prisma.scanToken.findUnique({ where: { token } }); return record ? mapScanToken(record) : undefined; }
  async listOrderScanTokensByOrderId(orderId: string): Promise<OrderScanTokenRecord[]> { return (await this.prisma.scanToken.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } })).map(mapScanToken); }

  async createScanRecord(input: ScanRecordCreateInput): Promise<ScanRecord> {
    if (!input.actorAccountId) {
      throw new Error("ScanRecord requires actorAccountId.");
    }
    if (input.actorType === "production_worker" && !input.workerProfileId) {
      throw new Error("production worker ScanRecord requires workerProfileId.");
    }
    if (input.actorType === "internal_account" && input.workerProfileId) {
      throw new Error("internal account ScanRecord cannot set workerProfileId.");
    }
    const payload: Prisma.InputJsonObject = {
      productionStage: input.stage,
      ...(input.collaborationJoin ? { collaborationJoin: true } : {}),
      ...(input.takeoverFromWorkerId
        ? { takeoverFromWorkerId: input.takeoverFromWorkerId }
        : {}),
      ...(input.takeoverFromWorkerName
        ? { takeoverFromWorkerName: input.takeoverFromWorkerName }
        : {}),
      ...(input.takeoverReason ? { takeoverReason: input.takeoverReason } : {}),
      ...(input.qualityResult ? { qualityResult: input.qualityResult } : {}),
      ...(input.qualityScore !== undefined ? { qualityScore: input.qualityScore } : {}),
      ...(input.samplePhotoAttachmentIds
        ? { samplePhotoAttachmentIds: input.samplePhotoAttachmentIds }
        : {}),
      ...(input.measurementPhotoAttachmentIds?.length
        ? { measurementPhotoAttachmentIds: input.measurementPhotoAttachmentIds }
        : {}),
      ...(input.terminationCycleAt ? { terminationCycleAt: input.terminationCycleAt } : {}),
      ...(input.terminationSettlementStatus
        ? { terminationSettlementStatus: input.terminationSettlementStatus }
        : {})
    };
    const record = await this.prisma.scanRecord.create({
      data: {
        orderId: input.orderId,
        actorAccountId: input.actorAccountId,
        workerProfileId: input.workerProfileId ?? null,
        actorNameSnapshot: input.workerName,
        actorType: input.actorType ?? "production_worker",
        actorRole: input.actorRole ?? "worker",
        action: input.scanAction,
        stage: input.orderStage,
        scannedAt: input.eventTime ? new Date(input.eventTime) : new Date(),
        workHours: input.workHours ?? null,
        pieces: input.pieces ?? null,
        note: input.note ?? null,
        source: "scan",
        payload
      }
    });
    return mapScanRecord(record);
  }
  async listScanRecordsByOrderId(orderId: string): Promise<ScanRecord[]> { return (await this.prisma.scanRecord.findMany({ where: { orderId }, orderBy: { scannedAt: "asc" } })).map(mapScanRecord); }

}
