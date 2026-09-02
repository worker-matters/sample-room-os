import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { isActivePlannerIdentity, plannerHomeRedirect } from "../miniprogram/services/plannerSession";
import type { PlannerOrderSummary } from "../miniprogram/types/contracts";
import { emptyPlannerFilters, filterPlannerOrders } from "../miniprogram/utils/plannerPresentation";

const source = (relativePath: string) => readFileSync(path.resolve(__dirname, "../miniprogram", relativePath), "utf8");

const order = (patch: Partial<PlannerOrderSummary> = {}): PlannerOrderSummary => ({
  id: "order-1",
  orderNo: "SRS-001",
  customerName: "客户一",
  salespersonName: "业务员一",
  styleNo: "ST-001",
  styleName: "测试款",
  quantity: 3,
  sampleType: "first_sample",
  sampleRound: "round_1",
  deliveryDate: "2026-07-30",
  stage: "sewing_waiting",
  stageLabel: "待缝制",
  patternStatus: "无需版师",
  fabricStatus: "全齐",
  trimStatus: "部分到",
  createdAt: "2026-07-17T08:00:00.000Z",
  updatedAt: "2026-07-17T08:00:00.000Z",
  sampleRequestItems: ["sample_garment"],
  completionStatus: "in_progress",
  attachments: [],
  scanRecords: [],
  ...patch
});

describe("planner mini-program migration", () => {
  it("accepts only an active planner Account and uses the planner home route", () => {
    const planner = { status: "active", identityType: "account", role: "planner", homeRoute: "/pages/planner/home", canScanOrder: true } as const;
    expect(isActivePlannerIdentity(planner)).toBe(true);
    expect(plannerHomeRedirect(planner)).toBe("/pages/planner/home");
    expect(isActivePlannerIdentity({ status: "active", identityType: "account", role: "receiver", homeRoute: "/pages/receiver/home", canScanOrder: true })).toBe(false);
    expect(isActivePlannerIdentity({ status: "disabled", identityType: "account", role: "planner", homeRoute: "/pages/identity/disabled", canScanOrder: false })).toBe(false);
  });

  it("uses the Android-style planner home as the only navigation entry", () => {
    const home = source("pages/planner/home.wxml");
    const homeLogic = source("pages/planner/home.ts");
    expect(home).toContain("entry-card");
    expect(home).toContain(">订单<");
    expect(home).toContain("生产计划");
    expect(home).toContain("扫描费用");
    expect(home).toContain("账号与退出");
    expect(homeLogic).toContain("openOrders()");
    expect(homeLogic).not.toContain("redirectTo");
    expect(source("pages/planner/orders.wxml")).not.toContain("<planner-tabs");
    expect(source("pages/planner/production-plan.wxml")).not.toContain("<planner-tabs");
    expect(source("pages/planner/scan-charge.wxml")).not.toContain("<planner-tabs");
  });

  it("filters all orders and limits production plan to waiting/active sewing", () => {
    const orders = [
      order(),
      order({ id: "order-2", styleNo: "ST-002", stage: "sewing_doing", stageLabel: "缝制中", customerName: "客户二" }),
      order({ id: "order-3", styleNo: "ST-003", stage: "cutting_waiting", stageLabel: "待裁剪" })
    ];
    const before = JSON.stringify(orders);
    expect(filterPlannerOrders(orders, { ...emptyPlannerFilters(), customerName: "客户二" })).toEqual([orders[1]]);
    expect(filterPlannerOrders(orders, emptyPlannerFilters(), true)).toEqual([orders[0], orders[1]]);
    expect(JSON.stringify(orders)).toBe(before);
  });

  it("keeps order detail read-only while exposing attachments and necessary scan records", () => {
    const detail = source("pages/planner/order-detail.wxml");
    expect(detail).toContain("资料与附件");
    expect(detail).toContain("版师交付物");
    expect(detail).toContain("流转记录");
    expect(detail).not.toContain("分配员工");
    expect(detail).not.toContain("修改生产");
    expect(detail).not.toContain("上传附件");
  });

  it("uses the existing ORDER payload and planner thin-adapter endpoints", () => {
    const page = source("pages/planner/scan-charge.ts");
    const api = source("services/apiClient.ts");
    expect(page).toContain("parseMiniappOrderQrPayload");
    expect(page).toContain("createPlannerScanCharge");
    expect(page).toContain('sourceScene: "planner_mobile_scan"');
    expect(api).toContain("/api/miniapp/planner/orders");
    expect(api).toContain("/api/miniapp/planner/scan-charge/charges");
    expect(api).not.toContain("account_device_key");
  });
});
