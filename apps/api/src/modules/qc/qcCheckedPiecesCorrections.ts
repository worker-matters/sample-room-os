import type { OrderCorrectionLogEntry, OrderRecord } from "../orders/orderTypes.js";
import type { ScanRecord } from "../scan/scanTypes.js";

export const QC_CHECKED_PIECES_CORRECTION_PREFIX = "qc_checked_pieces:";

export function qcCheckedPiecesCorrectionFieldName(scanRecordId: string) {
  return `${QC_CHECKED_PIECES_CORRECTION_PREFIX}${scanRecordId}`;
}

export function qcCheckedPiecesCorrections(
  order: Pick<OrderRecord, "correctionLogs">,
  scanRecordId: string
): OrderCorrectionLogEntry[] {
  const fieldName = qcCheckedPiecesCorrectionFieldName(scanRecordId);
  return order.correctionLogs
    .filter((log) => log.fieldName === fieldName)
    .sort((left, right) => left.changedAt.localeCompare(right.changedAt));
}

export function effectiveQcCheckedPieces(
  order: Pick<OrderRecord, "correctionLogs">,
  record: Pick<ScanRecord, "id" | "pieces">
): number | undefined {
  const latest = qcCheckedPiecesCorrections(order, record.id).at(-1);
  return typeof latest?.newValue === "number" ? latest.newValue : record.pieces;
}

export function originalQcCheckedPieces(
  order: Pick<OrderRecord, "correctionLogs">,
  record: Pick<ScanRecord, "id" | "pieces">
): number | undefined {
  const first = qcCheckedPiecesCorrections(order, record.id)[0];
  return typeof first?.oldValue === "number" ? first.oldValue : record.pieces;
}

export function withEffectiveQcCheckedPieces(
  order: Pick<OrderRecord, "correctionLogs">,
  record: ScanRecord
): ScanRecord {
  const pieces = effectiveQcCheckedPieces(order, record);
  if (pieces === record.pieces) return record;
  return pieces === undefined ? record : { ...record, pieces };
}
