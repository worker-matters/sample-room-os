import type { MiniappGlobalData } from "../../app";
import { environment } from "../../config/environment";
import { restoreMiniappSession } from "../../services/apiClient";
import { ensureSessionEndpoint } from "../../services/endpointSession";

const apiModeLabels = {
  undetected: "未检测",
  lan: "局域网",
  public: "公网",
  unavailable: "不可用"
} as const;
const SESSION_STORAGE_KEY = "sample-room-miniapp-session";

Page({
  data: {
    identityLabel: "未登录",
    apiModeLabel: "未检测",
    version: environment.version as string,
    canScanOrder: false,
    loading: false
  },

  async onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    this.setData({ loading: true });
    try {
      const endpoint = await ensureSessionEndpoint(app.globalData);
      const storedToken = app.globalData.sessionToken || wx.getStorageSync<string>(SESSION_STORAGE_KEY);
      if (storedToken) {
        try {
          const restored = await restoreMiniappSession(endpoint.baseUrl, storedToken);
          app.globalData.sessionToken = storedToken;
          app.globalData.identity = restored.identity;
          if (restored.identity.homeRoute !== "/pages/index/index") {
            await wx.reLaunch({ url: restored.identity.homeRoute });
            return;
          }
        } catch {
          wx.removeStorageSync(SESSION_STORAGE_KEY);
          delete app.globalData.sessionToken;
        }
      }

      this.refresh(app.globalData);
      if (app.globalData.identity.status !== "active") {
        await wx.reLaunch({ url: "/pages/identity/identity" });
      }
    } catch (error) {
      app.globalData.apiMode = "unavailable";
      this.refresh(app.globalData);
      void wx.showToast({ title: error instanceof Error ? error.message : "连接失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  refresh(globalData: MiniappGlobalData) {
    this.setData({
      apiModeLabel: apiModeLabels[globalData.apiMode],
      identityLabel: globalData.identity.status === "active"
        ? `${globalData.identity.displayName ?? globalData.identity.role ?? "已登录"}`
        : "未登录",
      canScanOrder: globalData.identity.status === "active" &&
        globalData.identity.canScanOrder &&
        !globalData.identityPreviewActive,
      version: globalData.version
    });
  },

  openScanner() { void wx.navigateTo({ url: "/pages/scan/scan" }); },
  openIdentity() { void wx.navigateTo({ url: "/pages/identity/identity" }); }
});
