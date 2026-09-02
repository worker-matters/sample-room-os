import type { MiniappGlobalData } from "../../app";
import { logoutMiniapp } from "../../services/apiClient";
import { requireMobileApiContext } from "../../services/mobileSession";
import {
  OrderQrPayloadError,
  parseMiniappOrderQrPayload
} from "../../utils/orderQrPayload";

const SESSION_STORAGE_KEY = "sample-room-miniapp-session";
const TEST_MODE_STORAGE_KEY = "sample-room-miniapp-test-mode";
const workerTypeLabels = {
  cutting: "裁剪",
  sewing: "缝制",
  qc_delivery: "组检 / 出库"
} as const;

Page({
  data: {
    displayName: "",
    workerType: "",
    busy: false
  },

  onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    this.setData({
      displayName: app.globalData.identity.displayName || "工序员工",
      workerType: app.globalData.identity.workerType
        ? workerTypeLabels[app.globalData.identity.workerType]
        : "当前工序由服务端确认"
    });
  },

  async openScanner() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (app.globalData.identityPreviewActive) {
      void wx.showToast({ title: "安全预览模式不能扫描订单", icon: "none" });
      return;
    }
    if (this.data.busy) return;
    try {
      this.setData({ busy: true });
      const scanned = await wx.scanCode({
        onlyFromCamera: true,
        scanType: ["qrCode"]
      });
      parseMiniappOrderQrPayload(scanned.result);
      await wx.navigateTo({
        url: `/pages/scan/scan?payload=${encodeURIComponent(scanned.result)}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("cancel")) return;
      void wx.showToast({
        title: error instanceof OrderQrPayloadError ? error.message : "二维码解析失败",
        icon: "none"
      });
    } finally {
      this.setData({ busy: false });
    }
  },

  openPerformance() {
    void wx.navigateTo({ url: "/pages/worker/performance" });
  },

  openAccount() {
    void wx.navigateTo({ url: "/pages/account/security" });
  },

  logout() {
    void wx.showModal({
      title: "退出登录？",
      content: "退出后需要重新输入手机号和密码。",
      confirmText: "退出"
    }).then(async ({ confirm }) => {
      if (!confirm || this.data.busy) return;
      this.setData({ busy: true });
      const app = getApp<{ globalData: MiniappGlobalData }>();
      try {
        if (app.globalData.sessionToken && !app.globalData.identityPreviewActive) {
          const context = await requireMobileApiContext(app.globalData, ["worker"]);
          await logoutMiniapp(context.baseUrl, context.sessionToken);
        }
      } catch {
        // Expired or unreachable sessions are still cleared locally.
      } finally {
        delete app.globalData.sessionToken;
        delete app.globalData.developmentPersonaKey;
        delete app.globalData.developmentTestModeToken;
        delete app.globalData.developmentTestMode;
        app.globalData.identityPreviewActive = false;
        app.globalData.identity = {
          status: "unbound",
          homeRoute: "/pages/identity/identity",
          canScanOrder: false
        };
        wx.removeStorageSync(SESSION_STORAGE_KEY);
        wx.removeStorageSync(TEST_MODE_STORAGE_KEY);
        this.setData({ busy: false });
        await wx.reLaunch({ url: "/pages/identity/identity" });
      }
    });
  }
});
