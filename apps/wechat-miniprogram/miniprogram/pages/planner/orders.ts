import type { MiniappGlobalData } from "../../app";
import {
  downloadPlannerOrderAttachment,
  listPlannerOrders
} from "../../services/apiClient";
import { isActivePlannerIdentity, requirePlannerApiContext } from "../../services/plannerSession";
import type { PlannerOrderSummary } from "../../types/contracts";
import {
  formatEntryDate,
  materialStatusOptions,
  optionLabel,
  sampleRoundOptions,
  sampleRequestItemOptions,
  sampleTypeOptions,
  stageLabels
} from "../../utils/receiverPresentation";
import {
  emptyPlannerFilters,
  filterPlannerOrders,
  plannerDateRange,
  uniquePlannerOptions,
  type PlannerFilters
} from "../../utils/plannerPresentation";

type FilterOption = { label: string; value: string };
type DisplayPlannerOrder = PlannerOrderSummary & {
  entryDateLabel: string;
  sampleTypeLabel: string;
  sampleRoundLabel: string;
  fabricStatusLabel: string;
  trimStatusLabel: string;
  requestLabels: string;
  thumbnailPath: string;
};

const allOption = (label: string): FilterOption => ({ label, value: "" });
const monthFilters = (): PlannerFilters => ({
  ...emptyPlannerFilters(),
  ...plannerDateRange("month")
});
const displayOrder = (order: PlannerOrderSummary, thumbnailPath = ""): DisplayPlannerOrder => ({
  ...order,
  entryDateLabel: formatEntryDate(order.createdAt),
  sampleTypeLabel: optionLabel(sampleTypeOptions, order.sampleType),
  sampleRoundLabel: optionLabel(sampleRoundOptions, order.sampleRound),
  fabricStatusLabel: optionLabel(materialStatusOptions, order.fabricStatus),
  trimStatusLabel: optionLabel(materialStatusOptions, order.trimStatus),
  requestLabels: order.sampleRequestItems.map((value) => optionLabel(sampleRequestItemOptions, value)).join("、"),
  thumbnailPath
});

Page({
  data: {
    loading: false,
    message: "",
    orders: [] as DisplayPlannerOrder[],
    filteredOrders: [] as DisplayPlannerOrder[],
    filters: monthFilters(),
    advancedOpen: false,
    customerOptions: [allOption("全部客户")] as FilterOption[],
    salespersonOptions: [allOption("全部业务员")] as FilterOption[],
    stageOptions: [allOption("全部状态"), ...Object.entries(stageLabels).map(([value, label]) => ({ value, label }))] as FilterOption[],
    sampleTypeOptions: [allOption("全部样品类型"), ...sampleTypeOptions] as FilterOption[],
    sampleRoundOptions: [allOption("全部轮次"), ...sampleRoundOptions] as FilterOption[],
    materialStatusOptions: [allOption("全部状态"), ...materialStatusOptions] as FilterOption[]
  },

  async onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (!isActivePlannerIdentity(app.globalData.identity)) {
      void wx.reLaunch({ url: app.globalData.identity.homeRoute });
      return;
    }
    await this.loadOrders();
  },

  async onPullDownRefresh() {
    await this.loadOrders();
    wx.stopPullDownRefresh();
  },

  async loadOrders() {
    this.setData({ loading: true, message: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const context = await requirePlannerApiContext(app.globalData);
      const result = await listPlannerOrders(context.baseUrl, context.sessionToken);
      const orders = await Promise.all(result.orders.map(async (order) => {
        if (!order.thumbnailAttachmentId) return displayOrder(order);
        try {
          const path = await downloadPlannerOrderAttachment(
            context.baseUrl,
            context.sessionToken,
            order.id,
            order.thumbnailAttachmentId
          );
          return displayOrder(order, path);
        } catch {
          return displayOrder(order);
        }
      }));
      this.setData({
        orders,
        customerOptions: [allOption("全部客户"), ...uniquePlannerOptions(result.orders, "customerName")],
        salespersonOptions: [allOption("全部业务员"), ...uniquePlannerOptions(result.orders, "salespersonName")]
      });
      this.applyFilters();
    } catch (error) {
      this.setData({
        message: error instanceof Error ? error.message : "计划员订单加载失败",
        orders: [],
        filteredOrders: []
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyFilters() {
    this.setData({ filteredOrders: filterPlannerOrders(this.data.orders, this.data.filters) as DisplayPlannerOrder[] });
  },

  patchFilters(patch: Partial<PlannerFilters>) {
    this.setData({ filters: { ...this.data.filters, ...patch } });
    this.applyFilters();
  },

  onKeywordInput(event: WechatMiniprogram.Input) { this.patchFilters({ keyword: event.detail.value }); },
  onStageChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ stage: this.data.stageOptions[Number(event.detail.value)]?.value ?? "" }); },
  onCustomerChange(event: WechatMiniprogram.PickerChange) {
    const customerName = this.data.customerOptions[Number(event.detail.value)]?.value ?? "";
    const source = customerName ? this.data.orders.filter((order) => order.customerName === customerName) : this.data.orders;
    this.setData({ salespersonOptions: [allOption("全部业务员"), ...uniquePlannerOptions(source, "salespersonName")] });
    this.patchFilters({ customerName, salespersonName: "" });
  },
  onSalespersonChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ salespersonName: this.data.salespersonOptions[Number(event.detail.value)]?.value ?? "" }); },
  onSampleTypeChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ sampleType: this.data.sampleTypeOptions[Number(event.detail.value)]?.value ?? "" }); },
  onRoundChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ sampleRound: this.data.sampleRoundOptions[Number(event.detail.value)]?.value ?? "" }); },
  onFabricChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ fabricStatus: this.data.materialStatusOptions[Number(event.detail.value)]?.value ?? "" }); },
  onTrimChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ trimStatus: this.data.materialStatusOptions[Number(event.detail.value)]?.value ?? "" }); },
  onStartDateChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ startDate: String(event.detail.value) }); },
  onEndDateChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ endDate: String(event.detail.value) }); },
  onDeliveryStartChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ deliveryStartDate: String(event.detail.value) }); },
  onDeliveryEndChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ deliveryEndDate: String(event.detail.value) }); },
  useWeek() { this.patchFilters(plannerDateRange("week")); },
  useMonth() { this.patchFilters(plannerDateRange("month")); },
  useQuarter() { this.patchFilters(plannerDateRange("quarter")); },
  toggleAdvanced() { this.setData({ advancedOpen: !this.data.advancedOpen }); },
  resetFilters() { this.setData({ filters: monthFilters(), advancedOpen: false }); this.applyFilters(); },

  openDetail(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const order = this.data.orders.find((item) => item.id === id);
    if (!order) return;
    wx.setStorageSync("planner:order-detail", order);
    void wx.navigateTo({ url: `/pages/planner/order-detail?id=${encodeURIComponent(id)}` });
  }
});
