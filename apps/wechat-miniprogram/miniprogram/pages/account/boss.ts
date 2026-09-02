import type { MiniappGlobalData } from "../../app";
import {
  listBossPricingRows,
  listBossStatements,
  logoutMiniapp
} from "../../services/apiClient";
import { requireMobileApiContext } from "../../services/mobileSession";

const SESSION_STORAGE_KEY = "sample-room-miniapp-session";
const TEST_MODE_STORAGE_KEY = "sample-room-miniapp-test-mode";

Page({
  data: {
    displayName: "老板",
    pendingCount: 0,
    statementCount: 0,
    loading: false,
    busy: false,
    message: ""
  },

  onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    this.setData({ displayName: app.globalData.identity.displayName || "老板" });
    void this.loadCounts();
  },

  async loadCounts() {
    this.setData({ loading: true, message: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const context = await requireMobileApiContext(app.globalData, ["boss", "system_owner"]);
      const [pricing, statements] = await Promise.all([
        listBossPricingRows(context.baseUrl, context.sessionToken),
        listBossStatements(context.baseUrl, context.sessionToken)
      ]);
      this.setData({
        pendingCount: pricing.rows.length,
        statementCount: statements.statements.filter((item) => item.status !== "returned").length
      });
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "数据加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  openPending() {
    void wx.navigateTo({ url: "/pages/boss/pending" });
  },

  openStatements() {
    void wx.navigateTo({ url: "/pages/boss/statements" });
  },

  openAccount() {
    void wx.navigateTo({ url: "/pages/account/security" });
  },

  logout() {
    void wx.showModal({
      title: "退出登录？",
      content: "退出后需要重新输入账号和密码。",
      confirmText: "退出"
    }).then(async ({ confirm }) => {
      if (!confirm || this.data.busy) return;
      this.setData({ busy: true });
      const app = getApp<{ globalData: MiniappGlobalData }>();
      try {
        if (app.globalData.sessionToken && !app.globalData.identityPreviewActive) {
          const context = await requireMobileApiContext(
            app.globalData,
            ["boss", "system_owner"]
          );
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
