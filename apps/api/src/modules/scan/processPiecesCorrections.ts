import type { OrderCorrectionLogEntry, OrderRecord } from "../orders/orderTypes.js";
import type { ScanRecord } from "./scanTypes.js";

export type CorrectableProcessStage = "cutting" | "sewing";

export const PROCESS_PIECES_CORRECTION_PREFIX = "process_pieces:";

export function isCorrectableProcessRecord(
  record: Pick<ScanRecord, "stage" | "action">
): record is Pick<ScanRecord, "stage" | "action"> & { stage: CorrectableProcessStage } {
  return (record.stage === "cutting" || record.stage === "sewing") && record.action === "complete";
}

export function processPiecesCorrectionFieldName(
  stage: CorrectableProcessStage,
  scanRecordId: string
) {
  return `${PROCESS_PIECES_CORRECTION_PREFIX}${stage}:${scanRecordId}`;
}

export function processPiecesCorrections(
  order: Pick<OrderRecord, "correctionLogs">,
  record: Pick<ScanRecord, "id" | "stage">
): OrderCorrectionLogEntry[] {
  if (record.stage !== "cutting" && record.stage !== "sewing") return [];
  const fieldName = processPiecesCorrectionFieldName(record.stage, record.id);
  return order.correctionLogs
    .filter((log) => log.fieldName === fieldName)
    .sort((left, right) => left.changedAt.localeCompare(right.changedAt));
}

export function effectiveProcessPieces(
  order: Pick<OrderRecord, "correctionLogs">,
  record: Pick<ScanRecord, "id" | "stage" | "pieces">
): number | undefined {
  if (record.stage !== "cutting" && record.stage !== "sewing") return record.pieces;
  const latest = processPiecesCorrections(order, record).at(-1);
  return typeof latest?.newValue === "number" ? latest.newValue : record.pieces;
}

export function originalProcessPieces(
  order: Pick<OrderRecord, "correctionLogs">,
  record: Pick<ScanRecord, "id" | "stage" | "pieces">
): number | undefined {
  if (record.stage !== "cutting" && record.stage !== "sewing") return record.pieces;
  const first = processPiecesCorrections(order, record)[0];
  return typeof first?.oldValue === "number" ? first.oldValue : record.pieces;
}

export function withEffectiveProcessPieces(
  order: Pick<OrderRecord, "correctionLogs">,
  record: ScanRecord
): ScanRecord {
  if (!isCorrectableProcessRecord(record)) return record;
  const pieces = effectiveProcessPieces(order, record);
  if (pieces === undefined || pieces === record.pieces) return record;
  return { ...record, pieces };
}
