import {
  intakeStatusOptions,
  orderStageOptions,
  sampleRoundOptions
} from "@sample-room/shared";
import type { OrderStage, ProductionStage, ScanRecord } from "../../api/sampleRoomApi";

const productionStageLabels: Record<ProductionStage, string> = {
  pattern: "制版",
  cutting: "裁剪",
  sewing: "缝制",
  qc_delivery: "组检/出库"
};

const scanActionLabels: Record<ScanRecord["action"], string> = {
  start: "开始",
  complete: "完成",
  termination_complete: "终止完成"
};

function optionLabel(options: Array<{ label: string; value: string }>, value?: string | null) {
  if (!value) {
    return "-";
  }

  return options.find((option) => option.value === value)?.label ?? value;
}

export function orderStageLabel(value: OrderStage | null | undefined) {
  return optionLabel(orderStageOptions, value);
}

export function orderOrIntakeStatusLabel(value: string | null | undefined) {
  return optionLabel([...orderStageOptions, ...intakeStatusOptions], value);
}

export function sampleRoundLabel(value: string | undefined) {
  return optionLabel(sampleRoundOptions, value);
}

export function productionStageLabel(value: ProductionStage | null | undefined) {
  return value ? productionStageLabels[value] : "未到工序";
}

export function scanRecordActionLabel(value: ScanRecord["action"]) {
  return scanActionLabels[value] ?? value;
}

export function isNormalQcCompletion(record: ScanRecord) {
  return record.stage === "qc_delivery" && record.action === "complete";
}

export function scanRecordTitle(record: ScanRecord) {
  if (isNormalQcCompletion(record)) {
    if (record.qualityResult === "rework") {
      return "组检退回返工";
    }
    if (record.qualityResult === "qualified") {
      return "组检合格并完成";
    }
  }

  return `${record.stageLabel}${scanRecordActionLabel(record.action)}`;
}

export function scanRecordNoteLabel(record: ScanRecord) {
  if (!record.note) {
    return undefined;
  }
  return isNormalQcCompletion(record) && record.qualityResult === "rework"
    ? `返工原因：${record.note}`
    : `备注：${record.note}`;
}

export function scanRecordQualityScoreLabel(record: ScanRecord) {
  return isNormalQcCompletion(record) &&
    record.qualityResult === "qualified" &&
    record.qualityScore !== undefined
    ? `质量评分：${record.qualityScore}`
    : undefined;
}

export function scanActionButtonLabel(stage: ProductionStage | null | undefined, action: ScanRecord["action"]) {
  const stageLabel = productionStageLabel(stage);
  return `${scanRecordActionLabel(action)}${stageLabel}`;
}
