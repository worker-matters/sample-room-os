import { ORDER_STAGES } from "@sample-room/shared";
import type { OrderRecord } from "../../api/sampleRoomApi";
import {
  BOSS_STAGE_GROUPS,
  matchesBossStageFilter,
  type BossStageFilterValue
} from "./bossStageFilter";

export type BossQuickStageCard = {
  label: string;
  stage: BossStageFilterValue;
  tone: string;
};

export const bossQuickStageCards: BossQuickStageCard[] = [
  { label: "活跃订单", stage: BOSS_STAGE_GROUPS.activeOrders, tone: "cyan" },
  { label: "版师阶段", stage: BOSS_STAGE_GROUPS.pattern, tone: "purple" },
  { label: "裁剪阶段", stage: BOSS_STAGE_GROUPS.cutting, tone: "blue" },
  { label: "待缝制", stage: ORDER_STAGES.sewingWaiting, tone: "geekblue" },
  { label: "缝制中", stage: ORDER_STAGES.sewingDoing, tone: "geekblue" },
  { label: "待组检/出库", stage: ORDER_STAGES.qcDeliveryWaiting, tone: "orange" },
  { label: "已完成", stage: ORDER_STAGES.done, tone: "green" }
];

export function countBossQuickStageOrders(
  orders: readonly Pick<OrderRecord, "intakeStatus" | "stage">[],
  stage: BossStageFilterValue
) {
  return orders.filter((order) => matchesBossStageFilter(order, [stage])).length;
}

export function isSingleBossQuickStageSelected(
  stages: readonly BossStageFilterValue[] | undefined,
  stage: BossStageFilterValue
) {
  return stages?.length === 1 && stages[0] === stage;
}
