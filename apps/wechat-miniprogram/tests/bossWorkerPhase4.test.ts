import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { completeWorkerQcScan } from "../miniprogram/services/apiClient";

const root = path.resolve(__dirname, "../miniprogram");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("boss and worker mobile workbench", () => {
  it("uses the boss home for navigation and provides an explicit logout", () => {
    const home = read("pages/account/boss.wxml");
    expect(home).toContain("待对账");
    expect(home).toContain("对账单");
    expect(home).toContain("账号与安全");
    expect(home).toContain("退出登录");
    expect(home).not.toContain("tab-bar");
    expect(read("pages/account/boss.ts")).toContain("logoutMiniapp");
  });

  it("keeps pricing sections separated and uses the compact mobile internal-cost row", () => {
    const view = read("pages/boss/pricing-detail.wxml");
    expect(view).toContain("本单任务");
    expect(view).toContain("客户报价");
    expect(view).toContain("内部成本（客户不可见）");
    expect(view).toContain("其他费用");
    expect(view).toContain("保存草稿");
    expect(view).toContain("确认客户报价");
    const internalSection = view.slice(
      view.indexOf("内部成本（客户不可见）"),
      view.indexOf('id="boss-other-charges"')
    );
    expect(internalSection).toContain("金额");
    expect(internalSection).toContain("其他费用");
    expect(internalSection).not.toContain("sourceOptions");
    expect(internalSection).not.toContain("说明（可选）");
  });

  it("supports statement filters, payment state changes and returns", () => {
    const list = read("pages/boss/statements.wxml");
    const detail = read("pages/boss/statement-detail.wxml");
    expect(list).toContain("customerOptions");
    expect(list).toContain("salespersonOptions");
    expect(detail).toContain("退回此订单");
    expect(detail).toContain("退回整单");
    expect(detail).toContain("下载对账单");
    expect(detail).toContain("标记已收款");
    expect(detail).toContain("取消确认收款");
  });

  it("shows style thumbnails in pending reconciliation cards", () => {
    expect(read("pages/boss/pending.wxml")).toContain("style-thumbnail");
    expect(read("pages/boss/pending.ts")).toContain("downloadBossOrderAttachment");
    expect(read("pages/boss/pending.wxml")).toContain("客户业务员");
    expect(read("pages/boss/pending.wxml")).toContain("生成对账单");
  });

  it("opens the camera directly and renders role-specific personal performance", () => {
    const home = read("pages/worker/home.ts");
    const scanController = read("pages/scan/scan.ts");
    const scanView = read("pages/scan/scan.wxml");
    const performance = read("pages/worker/performance.wxml");
    expect(home).toContain("wx.scanCode");
    expect(home).toContain("/pages/scan/scan?payload=");
    expect(scanController).toContain('requireMobileApiContext(app.globalData, ["worker"])');
    expect(scanController).toContain("resolveOrderScan");
    expect(scanController).toContain("completeWorkerScan");
    expect(scanController).toContain("completeWorkerQcScan");
    expect(scanController).toContain("expectedActiveWorkerId");
    expect(scanController).toContain("qcPhotos: [] as QcPhoto[]");
    expect(scanController).toContain("Math.min(9, remaining)");
    expect(scanController).toContain("...this.data.qcPhotos");
    expect(scanController).toContain("filePath: photo.path");
    expect(scanController).toContain("displayName: photo.displayName");
    expect(scanController).toContain('message === "订单已终止"');
    expect(scanController).toContain("this.returnToRoleHome(), 5000");
    expect(scanView).toContain("扫描订单流转码");
    expect(scanView).toContain('wx:if="{{!state}}"');
    expect(scanView).toContain("state.allowedAction === 'complete'");
    expect(scanView).toContain("登记工序完成");
    expect(scanView).toContain("qcPhotoCountLabel");
    expect(scanView).toContain('wx:for="{{qcPhotos}}"');
    expect(scanView).toContain("修改名称");
    expect(scanView).toContain("5 秒后自动返回当前角色界面");
    expect(scanView).toContain("state.blockedReason === 'terminated'");
    expect(performance).toContain("workerType === 'sewing'");
    expect(performance).toContain("workerType !== 'qc_delivery'");
    expect(performance).toContain("平均组检评分");
    expect(performance).toContain("客诉比例");
    expect(performance).toContain("item.styleNo");
    expect(performance).not.toContain("item.orderNo");
  });

  it("uploads every selected QC photo before sending one final completion request", async () => {
    const request = vi.fn((options: WechatMiniprogram.RequestOption) => {
      const isBatchCreation = options.url.endsWith("/qc-evidence-batches");
      options.success?.({
        data: isBatchCreation
          ? { batchId: "batch-1" }
          : { state: { allowedAction: "blocked" } },
        statusCode: isBatchCreation ? 201 : 200,
        header: {},
        cookies: [],
        profile: {}
      } as never);
      return {} as WechatMiniprogram.RequestTask;
    });
    const uploadFile = vi.fn((options: WechatMiniprogram.UploadFileOption) => {
      options.success?.({
        data: JSON.stringify({ count: 1, maxFiles: 10 }),
        statusCode: 201
      } as WechatMiniprogram.UploadFileSuccessCallbackResult);
      return {} as WechatMiniprogram.UploadTask;
    });
    const progress = vi.fn();
    vi.stubGlobal("getApp", () => ({ globalData: { identityPreviewActive: false } }));
    vi.stubGlobal("wx", { request, uploadFile });

    await completeWorkerQcScan(
      "http://192.0.2.1:3001",
      "miniapp-session",
      "scan-token",
      [
        { filePath: "tmp/front.jpg", displayName: "样衣正面" },
        { filePath: "tmp/back.jpg", displayName: "样衣背面" }
      ],
      {
        pieces: "3",
        qualityScore: "95",
        qualityResult: "qualified",
        note: ""
      },
      progress
    );

    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadFile.mock.calls[0]?.[0]).toMatchObject({
      filePath: "tmp/front.jpg",
      formData: { displayName: "样衣正面" }
    });
    expect(uploadFile.mock.calls[1]?.[0]).toMatchObject({
      filePath: "tmp/back.jpg",
      formData: { displayName: "样衣背面" }
    });
    expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toMatchObject({
      method: "POST",
      data: expect.objectContaining({ qcEvidenceBatchId: "batch-1" })
    });
    vi.unstubAllGlobals();
  });

  it("does not complete the QC scan when one staged photo fails to upload", async () => {
    const request = vi.fn((options: WechatMiniprogram.RequestOption) => {
      options.success?.({
        data: { batchId: "batch-1" },
        statusCode: 201,
        header: {},
        cookies: [],
        profile: {}
      } as never);
      return {} as WechatMiniprogram.RequestTask;
    });
    const uploadFile = vi.fn((options: WechatMiniprogram.UploadFileOption) => {
      options.fail?.({ errMsg: "uploadFile:fail network error" });
      return {} as WechatMiniprogram.UploadTask;
    });
    vi.stubGlobal("getApp", () => ({ globalData: { identityPreviewActive: false } }));
    vi.stubGlobal("wx", { request, uploadFile });

    await expect(completeWorkerQcScan(
      "http://192.0.2.1:3001",
      "miniapp-session",
      "scan-token",
      [{ filePath: "tmp/front.jpg", displayName: "样衣正面" }],
      {
        pieces: "3",
        qualityScore: "95",
        qualityResult: "qualified",
        note: ""
      }
    )).rejects.toThrow("network error");

    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("uses the receiver home as navigation without repeating the legacy top tabs", () => {
    for (const page of ["orders", "intake", "scan-charge"]) {
      expect(read(`pages/receiver/${page}.wxml`)).not.toContain("<receiver-tabs");
      expect(read(`pages/receiver/${page}.json`)).not.toContain("receiver-tabs");
    }
    expect(read("pages/receiver/home.wxml")).toContain("现场录入");
    expect(read("pages/receiver/home.wxml")).toContain("扫描费用");
  });

  it("uses server-authoritative attachment permissions", () => {
    const api = read("services/apiClient.ts");
    expect(api).toContain("/display-name");
    expect(api).not.toContain('method?: "PATCH"');
    expect(read("types/contracts.ts")).toContain("canRename");
    expect(read("pages/planner/order-detail.wxml")).toContain("修改名称");
    expect(read("pages/receiver/order-detail.wxml")).toContain("下载");
    expect(read("pages/planner/order-detail.wxml")).toContain("item.canDelete");
    expect(read("pages/receiver/order-detail.wxml")).toContain("item.canDelete");
  });

  it("keeps receiver and planner order pages aligned with the Android information hierarchy", () => {
    const receiverOrders = read("pages/receiver/orders.wxml");
    const receiverDetail = read("pages/receiver/order-detail.wxml");
    const plannerOrders = read("pages/planner/orders.wxml");
    const plannerDetail = read("pages/planner/order-detail.wxml");
    expect(receiverOrders).toContain("查看详情");
    expect(receiverOrders).toContain("面辅料记录");
    expect(receiverOrders).toContain("打样要求");
    expect(receiverOrders).toContain("order-thumbnail");
    expect(receiverDetail).toContain("资料与附件");
    expect(receiverDetail).toContain("其他费用");
    expect(plannerOrders).toContain("查看详情");
    expect(plannerOrders).toContain("面里料 / 辅料");
    expect(plannerOrders).toContain("打样要求");
    expect(plannerDetail).toContain("资料与附件");
    expect(plannerDetail).toContain("流转记录");
  });
});
