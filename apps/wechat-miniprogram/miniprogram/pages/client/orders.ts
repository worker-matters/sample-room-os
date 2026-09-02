import type { MiniappGlobalData } from "../../app";
import { downloadClientOrderAttachment, listClientOrders } from "../../services/apiClient";
import { isActiveClientIdentity, isClientAdminIdentity, requireClientApiContext } from "../../services/clientSession";
import type { ClientBusinessUserSummary, ClientOrderSummary } from "../../types/contracts";
import { emptyClientOrderFilters, filterClientOrders, type ClientOrderFilters } from "../../utils/clientPresentation";

type FilterOption = { label: string; value: string };
type DisplayOrder = ClientOrderSummary & { thumbnailPath: string; quotationLabel: string };

const taskOptions: FilterOption[] = [
  { label: "全部订单任务", value: "all" },
  { label: "含未完成任务", value: "incomplete" },
  { label: "全部任务已完成", value: "complete" }
];

const displayOrder = (order: ClientOrderSummary, thumbnailPath = ""): DisplayOrder => ({
  ...order,
  thumbnailPath,
  quotationLabel: order.quotation ? `¥${order.quotation.receivableTotal.toFixed(2)}` : "未确认"
});

Page({
  data: {
    role: "client_business_user",
    isAdmin: false,
    loading: false,
    message: "",
    orders: [] as DisplayOrder[],
    filteredOrders: [] as DisplayOrder[],
    filters: emptyClientOrderFilters(),
    salespersonOptions: [{ label: "全部业务员", value: "" }] as FilterOption[],
    salespersonFilterLabel: "全部业务员",
    taskOptions,
    taskFilterLabel: "全部订单任务"
  },

  async onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (!isActiveClientIdentity(app.globalData.identity)) {
      void wx.reLaunch({ url: app.globalData.identity.homeRoute });
      return;
    }
    const isAdmin = isClientAdminIdentity(app.globalData.identity);
    const storedSalespersonId = String(wx.getStorageSync("client:orders-salesperson") ?? "");
    if (storedSalespersonId) wx.removeStorageSync("client:orders-salesperson");
    this.setData({
      role: isAdmin ? "client_admin" : "client_business_user",
      isAdmin,
      filters: { ...this.data.filters, salespersonId: storedSalespersonId }
    });
    await this.loadOrders();
  },

  async onPullDownRefresh() { await this.loadOrders(); wx.stopPullDownRefresh(); },

  async loadOrders() {
    this.setData({ loading: true, message: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const api = await requireClientApiContext(app.globalData);
      const result = await listClientOrders(api.baseUrl, api.sessionToken);
      const orders = await Promise.all(result.orders.map(async (order) => {
        if (!order.thumbnailAttachmentId) return displayOrder(order);
        try {
          return displayOrder(order, await downloadClientOrderAttachment(
            api.baseUrl,
            api.sessionToken,
            order.id,
            order.thumbnailAttachmentId
          ));
        } catch {
          return displayOrder(order);
        }
      }));
      this.setData({
        orders,
        salespersonOptions: [
          { label: "全部业务员", value: "" },
          ...result.clientUsers.map((user: ClientBusinessUserSummary) => ({ label: user.displayName, value: user.id }))
        ]
      });
      wx.setStorageSync("client:orders", result);
      this.applyFilters();
    } catch (error) {
      this.setData({ orders: [], filteredOrders: [], message: error instanceof Error ? error.message : "客户订单加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyFilters() {
    this.setData({ filteredOrders: filterClientOrders(this.data.orders, this.data.filters as ClientOrderFilters) as DisplayOrder[] });
  },
  patchFilters(patch: Partial<ClientOrderFilters>) {
    this.setData({ filters: { ...this.data.filters, ...patch } });
    this.applyFilters();
  },
  onKeywordInput(event: WechatMiniprogram.Input) { this.patchFilters({ keyword: event.detail.value }); },
  onSalespersonChange(event: WechatMiniprogram.PickerChange) {
    const option = this.data.salespersonOptions[Number(event.detail.value)] ?? this.data.salespersonOptions[0]!;
    this.setData({ salespersonFilterLabel: option.label });
    this.patchFilters({ salespersonId: option.value });
  },
  onTaskStateChange(event: WechatMiniprogram.PickerChange) {
    const option = this.data.taskOptions[Number(event.detail.value)] ?? this.data.taskOptions[0]!;
    this.setData({ taskFilterLabel: option.label });
    this.patchFilters({ taskState: option.value as ClientOrderFilters["taskState"] });
  },
  openDetail(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const order = this.data.orders.find((item) => item.id === id);
    if (!order) return;
    wx.setStorageSync("client:order-detail", order);
    void wx.navigateTo({ url: `/pages/client/order-detail?id=${encodeURIComponent(id)}` });
  }
});
