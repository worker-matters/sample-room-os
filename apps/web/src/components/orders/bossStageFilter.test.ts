import { describe, expect, it } from "vitest";
import { ORDER_STAGES } from "@sample-room/shared";
import {
  BOSS_STAGE_GROUPS,
  bossStageFilterOptions,
  matchesBossStageFilter
} from "./bossStageFilter";

const order = (intakeStatus: string, stage: string | null) => ({ intakeStatus, stage }) as never;

describe("boss stage filter", () => {
  it("shows all active orders when no stage is selected", () => {
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.sewingDoing), [])).toBe(true);
  });

  it("uses OR semantics for multiple selected stages", () => {
    const selected = [ORDER_STAGES.patternDoing, ORDER_STAGES.sewingDoing];
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.patternDoing), selected)).toBe(true);
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.sewingDoing), selected)).toBe(true);
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.cuttingDoing), selected)).toBe(false);
  });

  it("maps the visible pending cutting option to both internal waiting stages", () => {
    const selected = [ORDER_STAGES.cuttingWaiting];
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.cuttingHandoffWaiting), selected)).toBe(true);
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.cuttingWaiting), selected)).toBe(true);
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.cuttingDoing), selected)).toBe(false);
  });

  it("treats pending receive as intake status rather than requiring an order stage", () => {
    expect(matchesBossStageFilter(order("pending_receive", null), [ORDER_STAGES.pendingReceive])).toBe(true);
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.patternWaiting), [ORDER_STAGES.pendingReceive])).toBe(false);
  });

  it("supports boss summary groups without removing the granular stage filters", () => {
    expect(matchesBossStageFilter(order("pending_receive", null), [BOSS_STAGE_GROUPS.allOrders])).toBe(true);
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.done), [BOSS_STAGE_GROUPS.allOrders])).toBe(true);

    expect(matchesBossStageFilter(order("pending_receive", null), [BOSS_STAGE_GROUPS.activeOrders])).toBe(true);
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.sewingDoing), [BOSS_STAGE_GROUPS.activeOrders])).toBe(true);
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.done), [BOSS_STAGE_GROUPS.activeOrders])).toBe(false);

    expect(matchesBossStageFilter(order("received", ORDER_STAGES.patternWaiting), [BOSS_STAGE_GROUPS.pattern])).toBe(true);
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.patternDoing), [BOSS_STAGE_GROUPS.pattern])).toBe(true);
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.cuttingDoing), [BOSS_STAGE_GROUPS.pattern])).toBe(false);

    expect(matchesBossStageFilter(order("received", ORDER_STAGES.cuttingHandoffWaiting), [BOSS_STAGE_GROUPS.cutting])).toBe(true);
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.cuttingWaiting), [BOSS_STAGE_GROUPS.cutting])).toBe(true);
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.cuttingDoing), [BOSS_STAGE_GROUPS.cutting])).toBe(true);

    expect(matchesBossStageFilter(order("received", ORDER_STAGES.sewingWaiting), [BOSS_STAGE_GROUPS.sewing])).toBe(true);
    expect(matchesBossStageFilter(order("received", ORDER_STAGES.sewingDoing), [BOSS_STAGE_GROUPS.sewing])).toBe(true);
  });

  it("offers summary groups together with the original process filters", () => {
    expect(bossStageFilterOptions.map((option) => option.label)).toEqual([
      "全部订单",
      "活跃订单",
      "版师阶段",
      "裁剪阶段",
      "缝制阶段",
      "待接单",
      "待完成版师任务",
      "制版中",
      "待裁剪",
      "裁剪中",
      "待缝制",
      "缝制中",
      "待组检/出库",
      "已完成"
    ]);
  });
});
