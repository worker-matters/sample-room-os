import { ORDER_STAGES, type OrderStage } from "@sample-room/shared";
import type { ProductionStage, ScanAction, ScanRecordAction } from "./scanTypes.js";

export const productionStages: ProductionStage[] = [
  "pattern",
  "cutting",
  "sewing",
  "qc_delivery"
];

export const productionStageLabels: Record<ProductionStage, string> = {
  pattern: "制版",
  cutting: "裁剪",
  sewing: "缝制",
  qc_delivery: "组检/出库"
};

export const stageConfig: Record<
  ProductionStage,
  {
    waiting: OrderStage;
    doing: OrderStage;
    next: OrderStage;
    interactionMode: "completion_only" | "start_and_complete";
    startAction: ScanAction;
    completeAction: ScanAction;
  }
> = {
  pattern: {
    waiting: ORDER_STAGES.patternWaiting,
    doing: ORDER_STAGES.patternDoing,
    next: ORDER_STAGES.cuttingWaiting,
    interactionMode: "start_and_complete",
    startAction: "pattern_start",
    completeAction: "pattern_finish"
  },
  cutting: {
    waiting: ORDER_STAGES.cuttingWaiting,
    doing: ORDER_STAGES.cuttingDoing,
    next: ORDER_STAGES.sewingWaiting,
    interactionMode: "completion_only",
    startAction: "cutting_start",
    completeAction: "cutting_finish"
  },
  sewing: {
    waiting: ORDER_STAGES.sewingWaiting,
    doing: ORDER_STAGES.sewingDoing,
    next: ORDER_STAGES.qcDeliveryWaiting,
    interactionMode: "start_and_complete",
    startAction: "sewing_start",
    completeAction: "sewing_finish"
  },
  qc_delivery: {
    waiting: ORDER_STAGES.qcDeliveryWaiting,
    doing: ORDER_STAGES.qcDeliveryWaiting,
    next: ORDER_STAGES.done,
    interactionMode: "completion_only",
    startAction: "qc_delivery_start",
    completeAction: "qc_delivery_finish"
  }
};

export function isProductionStage(value: unknown): value is ProductionStage {
  return typeof value === "string" && productionStages.includes(value as ProductionStage);
}

export function normalizeOrderStageForWorkflow(
  stage: OrderStage | null | undefined
): OrderStage | null | undefined {
  return stage === ORDER_STAGES.cuttingHandoffWaiting ? ORDER_STAGES.cuttingWaiting : stage;
}

export function stageForOrderStage(stage: OrderStage | null | undefined): ProductionStage | null {
  const normalizedStage = normalizeOrderStageForWorkflow(stage);
  if (!normalizedStage) {
    return null;
  }

  if (normalizedStage === ORDER_STAGES.cuttingDoing) {
    return "cutting";
  }

  return (
    productionStages.find((productionStage) => {
      const config = stageConfig[productionStage];
      return normalizedStage === config.waiting || normalizedStage === config.doing;
    }) ?? null
  );
}

export function recordActionForScanAction(action: ScanAction): ScanRecordAction {
  if (action === "termination_complete") {
    return "termination_complete";
  }

  return action.endsWith("_start") ? "start" : "complete";
}

export function actionLabel(action: ScanAction) {
  if (action === "termination_complete") {
    return "终止完成";
  }

  const stage =
    productionStages.find((candidate) => {
      const config = stageConfig[candidate];
      return config.startAction === action || config.completeAction === action;
    }) ?? "pattern";
  return `${productionStageLabels[stage]}${recordActionForScanAction(action) === "start" ? "开始" : "完成"}`;
}
