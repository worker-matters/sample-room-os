import type { MiniappGlobalData } from "../../app";
import {
  listDevelopmentPersonas,
  loginDevelopmentPersona,
  logoutDevelopmentTestMode,
  logoutMiniapp
} from "../../services/apiClient";
import { ensureSessionEndpoint } from "../../services/endpointSession";
import type { DevelopmentPersona } from "../../types/contracts";
import { identityPreviewForPersonaKey } from "../../utils/identityPreview";

const SESSION_STORAGE_KEY = "sample-room-miniapp-session";
const TEST_MODE_STORAGE_KEY = "sample-room-miniapp-test-mode";

Page({
  data: {
    personas: [] as DevelopmentPersona[],
    personaLabels: [] as string[],
    personaIndex: 0,
    loadError: "",
    busy: false,
    closing: false,
    modeLabel: "安全预览"
  },

  async onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    const token = app.globalData.developmentTestModeToken || wx.getStorageSync<string>(TEST_MODE_STORAGE_KEY);
    if (!token) {
      await wx.reLaunch({ url: "/pages/identity/identity" });
      return;
    }
    app.globalData.developmentTestModeToken = token;
    this.setData({ modeLabel: app.globalData.developmentTestMode === "development" ? "开发联调" : "release 安全预览" });
    try {
      const endpoint = await ensureSessionEndpoint(app.globalData);
      const result = await listDevelopmentPersonas(endpoint.baseUrl, token);
      const receiverIndex = result.personas.findIndex((item) => item.key === "receiver");
      this.setData({
        personas: result.personas,
        personaLabels: result.personas.map((item) => item.label),
        personaIndex: receiverIndex >= 0 ? receiverIndex : 0,
        loadError: ""
      });
    } catch {
      this.setData({ personas: [], personaLabels: [], loadError: "测试会话已失效，请重新登录" });
    }
  },

  onPersonaChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ personaIndex: Number(event.detail.value) });
  },

  async openSelectedPersona() {
    if (this.data.busy) return;
    const persona = this.data.personas[this.data.personaIndex];
    const app = getApp<{ globalData: MiniappGlobalData }>();
    const testModeToken = app.globalData.developmentTestModeToken;
    if (!persona || !testModeToken) return;
    this.setData({ busy: true });
    try {
      const endpoint = await ensureSessionEndpoint(app.globalData);
      if (app.globalData.sessionToken) {
        try { await logoutMiniapp(endpoint.baseUrl, app.globalData.sessionToken); } catch { /* replace expired session */ }
      }
      const response = await loginDevelopmentPersona(endpoint.baseUrl, persona.key, testModeToken);
      if (response.preview) {
        delete app.globalData.sessionToken;
        delete app.globalData.developmentPersonaKey;
        wx.removeStorageSync(SESSION_STORAGE_KEY);
        app.globalData.identity = identityPreviewForPersonaKey(response.personaKey);
        app.globalData.identityPreviewActive = true;
        await wx.navigateTo({ url: app.globalData.identity.homeRoute });
        return;
      }
      app.globalData.sessionToken = response.sessionToken;
      app.globalData.identity = response.identity;
      app.globalData.developmentPersonaKey = persona.key;
      app.globalData.identityPreviewActive = false;
      wx.setStorageSync(SESSION_STORAGE_KEY, response.sessionToken);
      await wx.navigateTo({ url: response.identity.homeRoute });
    } catch (error) {
      void wx.showToast({ title: error instanceof Error ? error.message : "测试身份登录失败", icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
  },

  async closeTestMode() {
    if (this.data.closing) return;
    const app = getApp<{ globalData: MiniappGlobalData }>();
    this.setData({ closing: true });
    try {
      const endpoint = await ensureSessionEndpoint(app.globalData);
      if (app.globalData.sessionToken) {
        try { await logoutMiniapp(endpoint.baseUrl, app.globalData.sessionToken); } catch { /* clear locally */ }
      }
      if (app.globalData.developmentTestModeToken) {
        try { await logoutDevelopmentTestMode(endpoint.baseUrl, app.globalData.developmentTestModeToken); } catch { /* clear locally */ }
      }
    } finally {
      delete app.globalData.sessionToken;
      delete app.globalData.developmentPersonaKey;
      delete app.globalData.developmentTestModeToken;
      delete app.globalData.developmentTestMode;
      app.globalData.identity = { status: "unbound", homeRoute: "/pages/identity/identity", canScanOrder: false };
      app.globalData.identityPreviewActive = false;
      wx.removeStorageSync(SESSION_STORAGE_KEY);
      wx.removeStorageSync(TEST_MODE_STORAGE_KEY);
      this.setData({ closing: false });
      await wx.reLaunch({ url: "/pages/identity/identity" });
    }
  }
});
