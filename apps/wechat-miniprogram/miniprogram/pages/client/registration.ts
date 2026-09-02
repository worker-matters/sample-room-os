import type { MiniappGlobalData } from "../../app";
import {
  closeClientBusinessUserRegistration,
  getClientBusinessUserRegistration,
  openClientBusinessUserRegistration
} from "../../services/apiClient";
import { isClientAdminIdentity, requireClientApiContext } from "../../services/clientSession";
import type { ClientBusinessUserRegistration, ClientBusinessUserRequest } from "../../types/contracts";

const statusLabels = { pending: "待审批", approved: "已通过", rejected: "已拒绝" } as const;

Page({
  data: {
    loading: false,
    message: "",
    registration: { enabled: false } as ClientBusinessUserRegistration,
    registrationUrl: "",
    requests: [] as Array<ClientBusinessUserRequest & { statusLabel: string }>
  },
  async onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (!isClientAdminIdentity(app.globalData.identity)) {
      void wx.reLaunch({ url: app.globalData.identity.homeRoute });
      return;
    }
    await this.load();
  },
  async api() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    return requireClientApiContext(app.globalData);
  },
  setRegistration(registration: ClientBusinessUserRegistration) {
    const registrationUrl = registration.code?.absoluteUrl ?? registration.code?.recommendedUrl ?? "";
    this.setData({ registration, registrationUrl });
  },
  async load() {
    this.setData({ loading: true, message: "" });
    try {
      const api = await this.api();
      const result = await getClientBusinessUserRegistration(api.baseUrl, api.sessionToken);
      this.setRegistration(result.registration);
      this.setData({ requests: result.requests.map((request) => ({ ...request, statusLabel: statusLabels[request.status] })) });
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "注册信息加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },
  async openRegistration() {
    try {
      const api = await this.api();
      this.setRegistration((await openClientBusinessUserRegistration(api.baseUrl, api.sessionToken)).registration);
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "开启注册码失败" });
    }
  },
  async closeRegistration() {
    const confirmed = await wx.showModal({ title: "关闭注册码", content: "关闭后当前注册链接立即失效，下次开启会生成新码。", confirmText: "关闭" });
    if (!confirmed.confirm) return;
    try {
      const api = await this.api();
      this.setRegistration((await closeClientBusinessUserRegistration(api.baseUrl, api.sessionToken)).registration);
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "关闭注册码失败" });
    }
  },
  copyRegistrationUrl() {
    if (!this.data.registrationUrl) return;
    void wx.setClipboardData({ data: this.data.registrationUrl });
  }
});
