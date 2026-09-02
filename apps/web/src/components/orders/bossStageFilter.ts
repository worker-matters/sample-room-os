import { ORDER_STAGES, type OrderStage } from "@sample-room/shared";
import type { OrderRecord } from "../../api/sampleRoomApi";

export const BOSS_STAGE_GROUPS = {
  allOrders: "boss_all_orders",
  activeOrders: "boss_active_orders",
  pattern: "boss_pattern_stage",
  cutting: "boss_cutting_stage",
  sewing: "boss_sewing_stage"
} as const;

type BossStageGroupValue = (typeof BOSS_STAGE_GROUPS)[keyof typeof BOSS_STAGE_GROUPS];

export type BossStageFilterValue = OrderStage | BossStageGroupValue;

export const bossStageFilterOptions: Array<{ label: string; value: BossStageFilterValue }> = [
  { label: "全部订单", value: BOSS_STAGE_GROUPS.allOrders },
  { label: "活跃订单", value: BOSS_STAGE_GROUPS.activeOrders },
  { label: "版师阶段", value: BOSS_STAGE_GROUPS.pattern },
  { label: "裁剪阶段", value: BOSS_STAGE_GROUPS.cutting },
  { label: "缝制阶段", value: BOSS_STAGE_GROUPS.sewing },
  { label: "待接单", value: ORDER_STAGES.pendingReceive },
  { label: "待完成版师任务", value: ORDER_STAGES.patternWaiting },
  { label: "制版中", value: ORDER_STAGES.patternDoing },
  { label: "待裁剪", value: ORDER_STAGES.cuttingWaiting },
  { label: "裁剪中", value: ORDER_STAGES.cuttingDoing },
  { label: "待缝制", value: ORDER_STAGES.sewingWaiting },
  { label: "缝制中", value: ORDER_STAGES.sewingDoing },
  { label: "待组检/出库", value: ORDER_STAGES.qcDeliveryWaiting },
  { label: "已完成", value: ORDER_STAGES.done }
];

function matchesOneStage(
  order: Pick<OrderRecord, "intakeStatus" | "stage">,
  stage: BossStageFilterValue
) {
  if (stage === BOSS_STAGE_GROUPS.allOrders) {
    return true;
  }

  if (stage === BOSS_STAGE_GROUPS.activeOrders) {
    return order.stage !== ORDER_STAGES.done;
  }

  if (stage === BOSS_STAGE_GROUPS.pattern) {
    return order.stage === ORDER_STAGES.patternWaiting || order.stage === ORDER_STAGES.patternDoing;
  }

  if (stage === BOSS_STAGE_GROUPS.cutting) {
    return (
      order.stage === ORDER_STAGES.cuttingHandoffWaiting ||
      order.stage === ORDER_STAGES.cuttingWaiting ||
      order.stage === ORDER_STAGES.cuttingDoing
    );
  }

  if (stage === BOSS_STAGE_GROUPS.sewing) {
    return order.stage === ORDER_STAGES.sewingWaiting || order.stage === ORDER_STAGES.sewingDoing;
  }

  if (stage === ORDER_STAGES.pendingReceive) {
    return order.intakeStatus === "pending_receive";
  }

  if (stage === ORDER_STAGES.cuttingWaiting) {
    return (
      order.stage === ORDER_STAGES.cuttingHandoffWaiting ||
      order.stage === ORDER_STAGES.cuttingWaiting
    );
  }

  return order.stage === stage;
}

export function matchesBossStageFilter(
  order: Pick<OrderRecord, "intakeStatus" | "stage">,
  stages?: readonly BossStageFilterValue[]
) {
  if (!stages?.length) {
    return true;
  }

  return stages.some((stage) => matchesOneStage(order, stage));
}
