import type { MiniappGlobalData } from "../../app";
import { loginMiniapp, logoutMiniapp } from "../../services/apiClient";
import { ensureSessionEndpoint } from "../../services/endpointSession";

const SESSION_STORAGE_KEY = "sample-room-miniapp-session";
const TEST_MODE_STORAGE_KEY = "sample-room-miniapp-test-mode";

Page({
  data: {
    accountType: "business" as "business" | "worker",
    username: "",
    phoneNumber: "",
    password: "",
    loggedIn: false,
    identityLabel: "",
    busy: false
  },

  onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    this.setData({
      loggedIn: Boolean(app.globalData.sessionToken && app.globalData.identity.status === "active"),
      identityLabel: app.globalData.identity.displayName ?? app.globalData.identity.role ?? "已登录"
    });
  },

  onAccountTypeChange(event: WechatMiniprogram.RadioGroupChange) {
    this.setData({ accountType: event.detail.value as "business" | "worker" });
  },
  onUsernameInput(event: WechatMiniprogram.Input) {
    this.setData({ username: event.detail.value });
  },
  onPhoneInput(event: WechatMiniprogram.Input) {
    this.setData({ phoneNumber: event.detail.value });
  },
  onPasswordInput(event: WechatMiniprogram.Input) {
    this.setData({ password: event.detail.value });
  },

  async submitLogin() {
    if (this.data.busy) return;
    const username = this.data.username.trim();
    const phoneNumber = this.data.phoneNumber.trim();
    if (this.data.accountType === "business" && !username) {
      void wx.showToast({ title: "请输入登录用户名", icon: "none" });
      return;
    }
    if (this.data.accountType === "worker" && !phoneNumber) {
      void wx.showToast({ title: "请输入登录手机号", icon: "none" });
      return;
    }
    if (!this.data.password) {
      void wx.showToast({ title: "请输入密码", icon: "none" });
      return;
    }

    const app = getApp<{ globalData: MiniappGlobalData }>();
    this.setData({ busy: true });
    try {
      const endpoint = await ensureSessionEndpoint(app.globalData);
      const response = await loginMiniapp(endpoint.baseUrl, {
        ...(this.data.accountType === "business" ? { username } : { phoneNumber }),
        password: this.data.password
      });
      if ("testMode" in response) {
        app.globalData.developmentTestModeToken = response.testModeToken;
        app.globalData.developmentTestMode = response.mode;
        wx.setStorageSync(TEST_MODE_STORAGE_KEY, response.testModeToken);
        this.setData({ password: "" });
        await wx.reLaunch({ url: response.homeRoute });
        return;
      }
      app.globalData.sessionToken = response.sessionToken;
      app.globalData.identity = response.identity;
      app.globalData.identityPreviewActive = false;
      delete app.globalData.developmentPersonaKey;
      delete app.globalData.developmentTestModeToken;
      delete app.globalData.developmentTestMode;
      wx.setStorageSync(SESSION_STORAGE_KEY, response.sessionToken);
      wx.removeStorageSync(TEST_MODE_STORAGE_KEY);
      this.setData({ password: "" });
      await wx.reLaunch({ url: response.identity.homeRoute });
    } catch (error) {
      void wx.showToast({
        title: error instanceof Error ? error.message : "登录失败",
        icon: "none"
      });
    } finally {
      this.setData({ busy: false });
    }
  },

  async logout() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      if (app.globalData.sessionToken) {
        const endpoint = await ensureSessionEndpoint(app.globalData);
        await logoutMiniapp(endpoint.baseUrl, app.globalData.sessionToken);
      }
    } catch {
      // Local logout still clears an expired or unreachable session.
    } finally {
      delete app.globalData.sessionToken;
      delete app.globalData.developmentPersonaKey;
      delete app.globalData.developmentTestModeToken;
      delete app.globalData.developmentTestMode;
      app.globalData.identity = {
        status: "unbound",
        homeRoute: "/pages/identity/identity",
        canScanOrder: false
      };
      wx.removeStorageSync(SESSION_STORAGE_KEY);
      wx.removeStorageSync(TEST_MODE_STORAGE_KEY);
      this.setData({ busy: false, loggedIn: false, password: "" });
      await wx.reLaunch({ url: "/pages/index/index" });
    }
  }
});
