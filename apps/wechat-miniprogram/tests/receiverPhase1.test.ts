import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createReceiverIntake,
  createReceiverQuickPhoto,
  uploadReceiverOrderAttachment
} from "../miniprogram/services/apiClient";
import { isActiveReceiverIdentity, receiverHomeRedirect } from "../miniprogram/services/receiverSession";
import type { ReceiverOrderSummary } from "../miniprogram/types/contracts";
import { emptyReceiverOrderFilters, filterReceiverOrders } from "../miniprogram/utils/receiverPresentation";

const source = (relativePath: string) => readFileSync(path.resolve(__dirname, "../miniprogram", relativePath), "utf8");

const order = (patch: Partial<ReceiverOrderSummary> = {}): ReceiverOrderSummary => ({
  id: "order-1",
  orderNo: "SRS-001",
  customerId: "customer-1",
  customerName: "客户一",
  salespersonId: "sales-1",
  salespersonName: "业务员一",
  styleNo: "ST-001",
  styleName: "测试款",
  quantity: 3,
  sampleType: "first_sample",
  sampleRound: "round_1",
  deliveryDate: "2026-07-30",
  intakeStatus: "received",
  stage: "cutting_waiting",
  patternStatus: "none",
  fabricStatus: "complete",
  trimStatus: "partial",
  sampleRequestItems: ["sample_garment", "cutting"],
  createdAt: "2026-07-17T08:00:00.000Z",
  completionStatus: "in_progress",
  scanRecords: [],
  ...patch
});

describe("receiver mini-program Phase 1", () => {
  it("accepts only an active receiver Account for receiver routes", () => {
    const receiver = { status: "active", identityType: "account", role: "receiver", homeRoute: "/pages/receiver/home", canScanOrder: true } as const;
    expect(isActiveReceiverIdentity(receiver)).toBe(true);
    expect(receiverHomeRedirect(receiver)).toBe("/pages/receiver/home");
    expect(isActiveReceiverIdentity({ status: "unbound", homeRoute: "/pages/identity/identity", canScanOrder: false })).toBe(false);
    expect(isActiveReceiverIdentity({ status: "disabled", identityType: "account", role: "receiver", homeRoute: "/pages/identity/disabled", canScanOrder: false })).toBe(false);
  });

  it("uses the Android-style three-entry home and keeps material recording on the order card", () => {
    const home = source("pages/receiver/home.wxml");
    const homeLogic = source("pages/receiver/home.ts");
    const intake = source("pages/receiver/intake.wxml");
    expect(homeLogic).toContain("openIntake()");
    expect(homeLogic).not.toContain("redirectTo");
    expect(home).toContain("entry-card");
    expect(home).toContain("账号与退出");
    expect(intake).not.toContain("<receiver-tabs");
    expect(intake).toContain("拍照简录");
    expect(intake).toContain("常规录入");
    expect(intake).toContain("完整订单信息（选填）");
    expect(intake).toContain("保存为待校对订单，不推进生产工序");
    expect(home).not.toContain("bindtap=\"openCorrection\"");
    expect(home).not.toContain("bindtap=\"openQrPrint\"");
    const detail = source("pages/receiver/order-detail.wxml");
    expect(detail).toContain('data-tab="attachments"');
    expect(detail).toContain('data-tab="records"');
    expect(detail).not.toContain("上传面辅料记录");
    expect(detail).toContain("item.canRename");
    expect(detail).toContain("item.canDelete");
    const orders = source("pages/receiver/orders.wxml");
    const orderLogic = source("pages/receiver/orders.ts");
    expect(orders).toContain("查看详情");
    expect(orders).toContain("面辅料记录");
    expect(orderLogic).toContain("wx.showActionSheet");
    expect(orderLogic).toContain("确认上传面辅料记录");
    expect(orderLogic).toContain("renameOrderAttachment");
    expect(detail).not.toContain("修改订单状态");
    expect(detail).not.toContain("提交生产");
  });

  it("filters the receiver order list without mutating order data", () => {
    const orders = [order(), order({ id: "order-2", styleNo: "ST-002", customerId: "customer-2", createdAt: "2026-06-01T00:00:00.000Z" })];
    const before = JSON.stringify(orders);
    expect(filterReceiverOrders(orders, { ...emptyReceiverOrderFilters(), keyword: "ST-001" })).toEqual([orders[0]]);
    expect(filterReceiverOrders(orders, { ...emptyReceiverOrderFilters(), customerId: "customer-2" })).toEqual([orders[1]]);
    expect(JSON.stringify(orders)).toBe(before);
  });

  it("uses wx.chooseImage and wx.uploadFile with the existing attachment adapter", async () => {
    const uploadFile = vi.fn((options: WechatMiniprogram.UploadFileOption) => {
      options.success?.({ data: JSON.stringify({ order: order() }), statusCode: 201 } as WechatMiniprogram.UploadFileSuccessCallbackResult);
      return {} as WechatMiniprogram.UploadTask;
    });
    vi.stubGlobal("getApp", () => ({ globalData: { identityPreviewActive: false } }));
    vi.stubGlobal("wx", { uploadFile });
    await createReceiverIntake("http://192.0.2.1:3000", "miniapp-session", "tmp/intake.jpg", {
      customerId: "customer-1",
      clientUserId: "sales-1",
      styleNo: "ST-001",
      styleName: "测试款",
      quantity: "3",
      sampleType: "first_sample",
      sampleRound: "round_1",
      deliveryDate: "2026-07-30",
      remark: "",
      patternStatus: "none",
      fabricStatus: "missing",
      trimStatus: "missing",
      sampleRequestItems: "[\"sample_garment\"]",
      category: "receiver_quick_photo",
      visibility: "client_visible"
    });
    await createReceiverQuickPhoto("http://192.0.2.1:3000", "miniapp-session", "tmp/quick.jpg", {
      customerId: "customer-1",
      clientUserId: "sales-1",
      styleNo: "ST-QUICK",
      quantity: "2",
      category: "receiver_quick_photo",
      visibility: "client_visible"
    });
    await uploadReceiverOrderAttachment("http://192.0.2.1:3000", "miniapp-session", "order-1", "tmp/file.pdf", {
      category: "receiver_material_record",
      visibility: "internal_only"
    });
    expect(uploadFile).toHaveBeenCalledTimes(3);
    expect(uploadFile.mock.calls[0]?.[0]).toMatchObject({ name: "files", filePath: "tmp/intake.jpg", header: { authorization: "Bearer miniapp-session" } });
    expect(uploadFile.mock.calls[1]?.[0]).toMatchObject({
      filePath: "tmp/quick.jpg",
      formData: expect.objectContaining({
        category: "receiver_quick_photo",
        visibility: "client_visible"
      })
    });
    expect(JSON.parse(uploadFile.mock.calls[1]?.[0]?.formData?.multipartPayload ?? "{}")).toMatchObject({
      styleNo: "ST-QUICK",
      quantity: "2"
    });
    expect(uploadFile.mock.calls[2]?.[0]).toMatchObject({
      filePath: "tmp/file.pdf",
      formData: { category: "receiver_material_record", visibility: "internal_only" }
    });
    expect(source("pages/receiver/intake.ts")).toContain("wx.chooseImage");
    expect(source("pages/receiver/intake.ts")).toContain("wx.chooseMessageFile");
    expect(source("pages/receiver/intake.ts")).toContain("createReceiverQuickPhoto");
  });

  it("keeps scan-charge on the existing ORDER payload and does not request account_device_key", () => {
    const page = source("pages/receiver/scan-charge.ts");
    const api = source("services/apiClient.ts");
    expect(page).toContain("parseMiniappOrderQrPayload");
    expect(page).toContain("createReceiverScanCharge");
    expect(api).toContain("/api/miniapp/receiver/scan-charge/charges");
    expect(api).not.toContain("account_device_key");
  });
});
