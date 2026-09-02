import type { MiniappGlobalData } from "../../app";
import { listClientOrders } from "../../services/apiClient";
import { isClientAdminIdentity, requireClientApiContext } from "../../services/clientSession";
import type { ClientOrdersResponse } from "../../types/contracts";

type BusinessUserStat = { id: string; name: string; total: number; incomplete: number; complete: number };

function statistics(result: ClientOrdersResponse): BusinessUserStat[] {
  return result.clientUsers.map((user) => {
    const orders = result.orders.filter((order) => order.salespersonId === user.id);
    const complete = orders.filter((order) => order.orderTasks.length > 0 && order.orderTasks.every((task) => task.completed)).length;
    return { id: user.id, name: user.displayName, total: orders.length, incomplete: orders.length - complete, complete };
  });
}

Page({
  data: { loading: false, message: "", stats: [] as BusinessUserStat[] },
  async onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (!isClientAdminIdentity(app.globalData.identity)) {
      void wx.reLaunch({ url: app.globalData.identity.homeRoute });
      return;
    }
    this.setData({ loading: true, message: "" });
    try {
      const api = await requireClientApiContext(app.globalData);
      this.setData({ stats: statistics(await listClientOrders(api.baseUrl, api.sessionToken)) });
    } catch (error) {
      this.setData({ stats: [], message: error instanceof Error ? error.message : "业务员统计加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },
  openOrders(event: WechatMiniprogram.TouchEvent) {
    wx.setStorageSync("client:orders-salesperson", String(event.currentTarget.dataset.id ?? ""));
    void wx.redirectTo({ url: "/pages/client/orders" });
  }
});
