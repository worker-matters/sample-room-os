import { describe, expect, it } from "vitest";
import { ORDER_STAGES } from "@sample-room/shared";
import { BOSS_STAGE_GROUPS } from "./bossStageFilter";
import {
  bossQuickStageCards,
  countBossQuickStageOrders,
  isSingleBossQuickStageSelected
} from "./bossQuickFilter";

const order = (intakeStatus: string, stage: string | null) => ({ intakeStatus, stage }) as never;

describe("boss quick status filters", () => {
  it("uses grouped business-stage counts while preserving granular stage matching", () => {
    const orders = [
      order("pending_receive", null),
      order("received", ORDER_STAGES.patternWaiting),
      order("received", ORDER_STAGES.patternDoing),
      order("received", ORDER_STAGES.cuttingHandoffWaiting),
      order("received", ORDER_STAGES.cuttingWaiting),
      order("received", ORDER_STAGES.cuttingDoing),
      order("received", ORDER_STAGES.sewingWaiting),
      order("received", ORDER_STAGES.sewingDoing),
      order("received", ORDER_STAGES.qcDeliveryWaiting),
      order("received", ORDER_STAGES.done)
    ];

    expect(countBossQuickStageOrders(orders, BOSS_STAGE_GROUPS.allOrders)).toBe(10);
    expect(countBossQuickStageOrders(orders, BOSS_STAGE_GROUPS.activeOrders)).toBe(9);
    expect(countBossQuickStageOrders(orders, BOSS_STAGE_GROUPS.pattern)).toBe(2);
    expect(countBossQuickStageOrders(orders, BOSS_STAGE_GROUPS.cutting)).toBe(3);
    expect(countBossQuickStageOrders(orders, BOSS_STAGE_GROUPS.sewing)).toBe(2);
    expect(countBossQuickStageOrders(orders, ORDER_STAGES.qcDeliveryWaiting)).toBe(1);
    expect(countBossQuickStageOrders(orders, ORDER_STAGES.done)).toBe(1);

    expect(countBossQuickStageOrders(orders, ORDER_STAGES.patternWaiting)).toBe(1);
    expect(countBossQuickStageOrders(orders, ORDER_STAGES.patternDoing)).toBe(1);
    expect(countBossQuickStageOrders(orders, ORDER_STAGES.cuttingWaiting)).toBe(2);
  });

  it("exposes the simplified owner overview cards with active orders as the top-level total", () => {
    expect(bossQuickStageCards.map(({ label, stage }) => [label, stage])).toEqual([
      ["活跃订单", BOSS_STAGE_GROUPS.activeOrders],
      ["版师阶段", BOSS_STAGE_GROUPS.pattern],
      ["裁剪阶段", BOSS_STAGE_GROUPS.cutting],
      ["待缝制", ORDER_STAGES.sewingWaiting],
      ["缝制中", ORDER_STAGES.sewingDoing],
      ["待组检/出库", ORDER_STAGES.qcDeliveryWaiting],
      ["已完成", ORDER_STAGES.done]
    ]);
    expect(bossQuickStageCards.some((card) => card.stage === BOSS_STAGE_GROUPS.allOrders)).toBe(false);
    expect(bossQuickStageCards.some((card) => card.stage === ORDER_STAGES.pendingReceive)).toBe(false);
  });

  it("marks a quick stage selected only when it is the sole stage filter", () => {
    expect(isSingleBossQuickStageSelected([BOSS_STAGE_GROUPS.sewing], BOSS_STAGE_GROUPS.sewing)).toBe(true);
    expect(isSingleBossQuickStageSelected(
      [BOSS_STAGE_GROUPS.sewing, ORDER_STAGES.cuttingDoing],
      BOSS_STAGE_GROUPS.sewing
    )).toBe(false);
    expect(isSingleBossQuickStageSelected([], BOSS_STAGE_GROUPS.sewing)).toBe(false);
  });
});
