import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isActiveClientIdentity,
  isClientAdminIdentity,
  isClientBusinessIdentity
} from "../miniprogram/services/clientSession";
import type { ClientOrderSummary } from "../miniprogram/types/contracts";
import {
  clientOrderTaskSummary,
  emptyClientOrderFilters,
  filterClientOrders
} from "../miniprogram/utils/clientPresentation";
import { identityPreviewAt } from "../miniprogram/utils/identityPreview";

const source = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, "../miniprogram", relativePath), "utf8");

const order = (patch: Partial<ClientOrderSummary> = {}): ClientOrderSummary => ({
  id: "order-1",
  orderNo: "SRS-001",
  customerName: "客户一",
  salespersonId: "client-user-1",
  salespersonName: "业务员一",
  styleNo: "ST-001",
  styleName: "测试款",
  quantity: 3,
  sampleType: "first_sample",
  sampleRound: "round_1",
  deliveryDate: "2026-07-30",
  intakeStatus: "received",
  createdAt: "2026-07-17T08:00:00.000Z",
  updatedAt: "2026-07-17T08:00:00.000Z",
  orderTasks: [
    { item: "paper_pattern", label: "纸样", completed: true },
    { item: "sample_garment", label: "样衣", completed: false }
  ],
  attachments: [],
  quotation: null,
  ...patch
});

describe("client mini-program migration", () => {
  it("routes both active client Account roles to orders without scan permission", () => {
    const admin = identityPreviewAt(5);
    const business = identityPreviewAt(6);
    expect(admin).toMatchObject({ role: "client_admin", homeRoute: "/pages/client/orders", canScanOrder: false });
    expect(business).toMatchObject({ role: "client_business_user", homeRoute: "/pages/client/orders", canScanOrder: false });
    expect(isActiveClientIdentity(admin)).toBe(true);
    expect(isClientAdminIdentity(admin)).toBe(true);
    expect(isClientBusinessIdentity(business)).toBe(true);
    expect(isActiveClientIdentity({ status: "disabled", identityType: "account", role: "client_admin", homeRoute: "/pages/identity/disabled", canScanOrder: false })).toBe(false);
  });

  it("searches order number, style number and style name and filters server-provided task facts", () => {
    const orders = [
      order(),
      order({ id: "order-2", orderNo: "SRS-002", styleNo: "ST-002", salespersonId: "client-user-2", orderTasks: [{ item: "sample_garment", label: "样衣", completed: true }] })
    ];
    expect(filterClientOrders(orders, { ...emptyClientOrderFilters(), keyword: "ST-002" })).toEqual([orders[1]]);
    expect(filterClientOrders(orders, { ...emptyClientOrderFilters(), salespersonId: "client-user-1" })).toEqual([orders[0]]);
    expect(filterClientOrders(orders, { ...emptyClientOrderFilters(), taskState: "incomplete" })).toEqual([orders[0]]);
    expect(clientOrderTaskSummary(orders[1]!)).toEqual({ completed: 1, total: 1, complete: true });
  });

  it("keeps confirmed role-specific tabs and top search on both order views", () => {
    const tabs = source("components/client-tabs/index.wxml");
    const orders = source("pages/client/orders.wxml");
    expect(tabs).toContain("业务员统计");
    expect(tabs).toContain("业务员注册");
    expect(tabs).toContain("我的订单");
    expect(tabs).toContain("拍照录入");
    expect(orders).toContain("搜索订单号 / 款号 / 款名");
    expect(orders).toContain("订单任务");
    expect(orders).toContain("item.completed");
    expect(orders).not.toContain("›");
  });

  it("keeps client order details safe and read-only except the existing supplement flow", () => {
    const detail = source("pages/client/order-detail.wxml");
    expect(detail).toContain("客户可见");
    expect(detail).toContain("获准版师交付物");
    expect(detail).toContain("已确认报价");
    expect(detail).toContain("补充资料");
    expect(detail).not.toContain("扫码");
    expect(detail).not.toContain("工序员工");
    expect(detail).not.toContain("内部成本");
  });

  it("uses the existing quick-photo, supplement, attachment and registration adapters", () => {
    const intake = source("pages/client/intake.ts");
    const supplement = source("pages/client/supplement.ts");
    const api = source("services/apiClient.ts");
    expect(intake).toContain("wx.chooseImage");
    expect(intake).toContain("createClientQuickPhoto");
    expect(supplement).toContain("supplementClientOrder");
    expect(api).toContain("/api/miniapp/client/orders/quick-photo");
    expect(api).toContain("/api/miniapp/client/business-user-registration");
    expect(api).not.toContain("client/order-scan");
  });

  it("never presents a relative customer registration path as a shareable public URL", () => {
    const registration = source("pages/client/registration.ts");
    expect(registration).toContain("registration.code?.absoluteUrl ?? registration.code?.recommendedUrl ?? \"\"");
    expect(registration).not.toContain("registration.code?.urlPath ?? \"\"");
  });
});
