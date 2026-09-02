import { ORDER_STAGE_LABELS, ORDER_STAGES, type OrderStage } from "@sample-room/shared";
import type { ScanRecord } from "../scan/scanTypes.js";

function recordTime(record: ScanRecord) {
  return new Date(record.eventTime).getTime();
}

export function orderStageDisplayLabel(
  stage: OrderStage | null,
  records: readonly ScanRecord[]
) {
  if (stage === ORDER_STAGES.qcDeliveryWaiting) {
    const latestNormalQc = records
      .filter(
        (record) =>
          record.stage === "qc_delivery" &&
          record.action === "complete"
      )
      .sort((left, right) => recordTime(left) - recordTime(right))
      .at(-1);

    if (latestNormalQc?.qualityResult === "rework") {
      return "待返工";
    }
  }

  return stage ? ORDER_STAGE_LABELS[stage] : "未进入流转";
}
