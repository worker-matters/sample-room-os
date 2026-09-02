import type { MiniappGlobalData } from "../../app";
import { isActiveReceiverIdentity } from "../../services/receiverSession";

Page({
  data: {
    displayName: "",
    roleLabel: "接单员",
    apiModeLabel: ""
  },

  onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (!isActiveReceiverIdentity(app.globalData.identity)) {
      void wx.reLaunch({ url: app.globalData.identity.homeRoute });
      return;
    }
    this.setData({
      displayName: app.globalData.identity.displayName || "接单员",
      apiModeLabel: app.globalData.apiMode === "public" ? "公网" : "开发局域网"
    });
  },

  openOrders() { void wx.navigateTo({ url: "/pages/receiver/orders" }); },
  openIntake() { void wx.navigateTo({ url: "/pages/receiver/intake" }); },
  openScanCharge() { void wx.navigateTo({ url: "/pages/receiver/scan-charge" }); },
  openAccount() { void wx.navigateTo({ url: "/pages/identity/identity" }); }
});
