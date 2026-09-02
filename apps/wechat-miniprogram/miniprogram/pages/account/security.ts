import type { MiniappGlobalData } from "../../app";
import { changeOwnPassword, getAccountSecurity, updateAccountSecurity } from "../../services/apiClient";
import { requireMobileApiContext } from "../../services/mobileSession";
import type { AccountSecurityProfile } from "../../types/contracts";

const SESSION_STORAGE_KEY = "sample-room-miniapp-session";

Page({
  data: {
    profile: null as AccountSecurityProfile | null,
    username: "", displayName: "", phoneNumber: "", currentPasswordForProfile: "",
    currentPassword: "", newPassword: "", confirmPassword: "",
    loading: false, message: "", successMessage: ""
  },
  onShow() { if (!this.data.profile) void this.load(); },
  async context() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    return requireMobileApiContext(app.globalData);
  },
  async load() {
    this.setData({ loading: true, message: "" });
    try {
      const context = await this.context();
      const { profile } = await getAccountSecurity(context.baseUrl, context.sessionToken);
      this.setData({ profile, username: profile.username ?? "", displayName: profile.displayName, phoneNumber: profile.phoneNumber ?? "" });
    } catch (error) { this.setData({ message: error instanceof Error ? error.message : "账号信息加载失败" }); }
    finally { this.setData({ loading: false }); }
  },
  field(event: WechatMiniprogram.Input) { this.setData({ [String(event.currentTarget.dataset.field)]: event.detail.value }); },
  async saveProfile() {
    if (!this.data.profile || this.data.loading) return;
    this.setData({ loading: true, message: "", successMessage: "" });
    try {
      const context = await this.context();
      const payload: WechatMiniprogram.IAnyObject = {
        displayName: this.data.displayName.trim(),
        phoneNumber: this.data.phoneNumber.trim()
      };
      if (this.data.profile.accountType === "business") payload.username = this.data.username.trim();
      if (this.data.currentPasswordForProfile) payload.currentPassword = this.data.currentPasswordForProfile;
      const { profile, signedOut } = await updateAccountSecurity(context.baseUrl, context.sessionToken, payload);
      if (signedOut) {
        const app = getApp<{ globalData: MiniappGlobalData }>();
        delete app.globalData.sessionToken;
        wx.removeStorageSync(SESSION_STORAGE_KEY);
        app.globalData.identity = { status: "unbound", homeRoute: "/pages/identity/identity", canScanOrder: false };
        void wx.reLaunch({ url: "/pages/identity/identity?notice=credentials-updated" });
        return;
      }
      this.setData({
        profile,
        username: profile.username ?? "",
        displayName: profile.displayName,
        phoneNumber: profile.phoneNumber ?? "",
        currentPasswordForProfile: "",
        successMessage: "账号资料已保存"
      });
    } catch (error) { this.setData({ message: error instanceof Error ? error.message : "保存失败" }); }
    finally { this.setData({ loading: false }); }
  },
  async savePassword() {
    if (this.data.loading) return;
    this.setData({ loading: true, message: "", successMessage: "" });
    try {
      const context = await this.context();
      await changeOwnPassword(context.baseUrl, context.sessionToken, {
        currentPassword: this.data.currentPassword,
        newPassword: this.data.newPassword,
        confirmPassword: this.data.confirmPassword
      });
      const app = getApp<{ globalData: MiniappGlobalData }>();
      delete app.globalData.sessionToken;
      wx.removeStorageSync(SESSION_STORAGE_KEY);
      app.globalData.identity = { status: "unbound", homeRoute: "/pages/identity/identity", canScanOrder: false };
      void wx.reLaunch({ url: "/pages/identity/identity?notice=password-updated" });
    } catch (error) { this.setData({ message: error instanceof Error ? error.message : "密码修改失败" }); }
    finally { this.setData({ loading: false }); }
  }
});
