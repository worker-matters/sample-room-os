import { randomUUID } from "node:crypto";
import { ROLES } from "@sample-room/shared";
import type { OperationLogRepository } from "../../db/repositories/contracts/index.js";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import type { ScanRecord } from "../scan/scanTypes.js";
import { collaborativeSewingRoundStates } from "../scan/collaborativeSewing.js";
import { effectiveProcessPieces } from "../scan/processPiecesCorrections.js";
import {
  effectiveQcCheckedPieces,
  originalQcCheckedPieces,
  qcCheckedPiecesCorrectionFieldName,
  qcCheckedPiecesCorrections
} from "./qcCheckedPiecesCorrections.js";

type CorrectionPayload = {
  pieces?: unknown;
  reason?: unknown;
};

function requirePieces(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, "实际检验件数必须是大于等于 0 的整数。");
  }
  return value;
}

function requireReason(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "请填写修改原因。");
  }
  const reason = value.trim();
  if (reason.length > 500) {
    throw new HttpError(400, "修改原因不能超过 500 个字符。");
  }
  return reason;
}

function latestQcCompletion(records: readonly ScanRecord[]) {
  return [...records]
    .filter((record) => record.stage === "qc_delivery" && record.action === "complete")
    .sort((left, right) => left.eventTime.localeCompare(right.eventTime))
    .at(-1);
}

function latestCompletedPieces(
  order: Parameters<typeof effectiveProcessPieces>[0],
  records: readonly ScanRecord[],
  stage: "cutting" | "sewing"
) {
  const latest = [...records]
    .filter((record) =>
      record.stage === stage &&
      record.action === "complete" &&
      typeof record.pieces === "number"
    )
    .sort((left, right) => left.eventTime.localeCompare(right.eventTime))
    .at(-1);
  return latest ? effectiveProcessPieces(order, latest) : undefined;
}

function latestQualifiedQcPieces(records: readonly ScanRecord[]) {
  const latest = latestQcCompletion(records);
  return latest?.qualityResult === "qualified" && typeof latest.pieces === "number"
    ? latest.pieces
    : undefined;
}

export class QcCheckedPiecesCorrectionService {
  constructor(
    private readonly repository: SampleRoomRepository,
    private readonly operationLogs: OperationLogRepository
  ) {}

  private ensureManager(currentUser: CurrentUser) {
    if (currentUser.role !== ROLES.boss && currentUser.role !== ROLES.systemOwner) {
      throw new HttpError(403, "forbidden");
    }
  }

  async processPieces(orderId: string, currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    const order = await this.repository.findOrderById(orderId);
    if (!order) throw new HttpError(404, "order not found.");
    const records = await this.repository.listScanRecordsByOrderId(order.id);
    const sewingRounds = collaborativeSewingRoundStates(order, records);
    const collaborativePieces = sewingRounds.reduce((sum, round) => sum + round.completedPieces, 0);
    return {
      result: {
        orderId: order.id,
        cutting: latestCompletedPieces(order, records, "cutting"),
        sewing: sewingRounds.some((round) => round.usesParticipationWorkflow)
          ? collaborativePieces || undefined
          : latestCompletedPieces(order, records, "sewing"),
        qc: latestQualifiedQcPieces(records)
      }
    };
  }

  async latest(orderId: string, currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    const order = await this.repository.findOrderById(orderId);
    if (!order) throw new HttpError(404, "order not found.");
    const record = latestQcCompletion(await this.repository.listScanRecordsByOrderId(order.id));
    if (!record) return { result: null };

    const corrections = qcCheckedPiecesCorrections(order, record.id);
    return {
      result: {
        orderId: order.id,
        orderNo: order.orderNo,
        styleNo: order.styleNo,
        styleName: order.styleName,
        scanRecordId: record.id,
        pieces: effectiveQcCheckedPieces(order, record),
        originalPieces: originalQcCheckedPieces(order, record),
        correctionCount: corrections.length,
        qualityResult: record.qualityResult,
        qualityScore: record.qualityScore,
        workerName: record.workerName,
        eventTime: record.eventTime,
        lastCorrectedAt: corrections.at(-1)?.changedAt,
        lastCorrectedBy: corrections.at(-1)?.changedByName
      }
    };
  }

  async correct(
    orderId: string,
    rawPayload: CorrectionPayload,
    currentUser: CurrentUser
  ) {
    this.ensureManager(currentUser);
    const pieces = requirePieces(rawPayload.pieces);
    const reason = requireReason(rawPayload.reason);
    const actorId = currentUser.accountId ?? currentUser.id;
    const changedAt = new Date().toISOString();

    const correction = await this.repository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(orderId);
      const order = await repository.findOrderById(orderId);
      if (!order) throw new HttpError(404, "order not found.");
      if (order.terminated) throw new HttpError(409, "订单已终止，无法修改组检记录。");

      const record = latestQcCompletion(await repository.listScanRecordsByOrderId(order.id));
      if (!record) throw new HttpError(409, "当前订单没有可修改的组检完成记录。");

      const previousPieces = effectiveQcCheckedPieces(order, record);
      if (previousPieces === pieces) {
        throw new HttpError(409, "实际检验件数没有发生变化。");
      }

      const log = {
        id: randomUUID(),
        changedAt,
        changedByRole: currentUser.role,
        changedByAccountId: actorId,
        ...(currentUser.displayName ? { changedByName: currentUser.displayName } : {}),
        fieldName: qcCheckedPiecesCorrectionFieldName(record.id),
        oldValue: previousPieces ?? null,
        newValue: pieces
      };

      await repository.updateOrder(order.id, {
        correctionLogs: [...order.correctionLogs, log]
      });

      return {
        orderId: order.id,
        orderNo: order.orderNo,
        scanRecordId: record.id,
        previousPieces: previousPieces ?? null,
        pieces,
        reason,
        changedAt
      };
    });

    await this.operationLogs.appendOperationLog({
      actorId,
      actorRole: currentUser.role,
      action: "qc_checked_pieces_corrected",
      targetType: "scan_record",
      targetId: correction.scanRecordId,
      before: {
        orderId: correction.orderId,
        orderNo: correction.orderNo,
        pieces: correction.previousPieces
      },
      after: {
        orderId: correction.orderId,
        orderNo: correction.orderNo,
        pieces: correction.pieces
      },
      payload: { reason }
    });

    return correction;
  }
}
