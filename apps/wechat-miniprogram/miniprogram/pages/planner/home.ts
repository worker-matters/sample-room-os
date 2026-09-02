import type { MiniappGlobalData } from "../../app";
import { isActivePlannerIdentity } from "../../services/plannerSession";

Page({
  data: {
    displayName: "",
    roleLabel: "计划员",
    apiModeLabel: ""
  },

  onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (!isActivePlannerIdentity(app.globalData.identity)) {
      void wx.reLaunch({ url: app.globalData.identity.homeRoute });
      return;
    }
    this.setData({
      displayName: app.globalData.identity.displayName || "计划员",
      apiModeLabel: app.globalData.apiMode === "public" ? "公网" : "开发局域网"
    });
  },

  openOrders() { void wx.navigateTo({ url: "/pages/planner/orders" }); },
  openProductionPlan() { void wx.navigateTo({ url: "/pages/planner/production-plan" }); },
  openScanCharge() { void wx.navigateTo({ url: "/pages/planner/scan-charge" }); },
  openAccount() { void wx.navigateTo({ url: "/pages/identity/identity" }); }
});
