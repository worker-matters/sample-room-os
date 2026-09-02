import type { MiniappGlobalData } from "../../app";
import {
  downloadOrderAttachment,
  listOrderAttachments,
  listReceiverOrders,
  renameOrderAttachment,
  uploadReceiverOrderAttachment
} from "../../services/apiClient";
import { isActiveReceiverIdentity, requireReceiverApiContext } from "../../services/receiverSession";
import type { ReceiverOrderSummary } from "../../types/contracts";
import {
  emptyReceiverOrderFilters,
  filterReceiverOrders,
  formatEntryDate,
  materialStatusOptions,
  optionLabel,
  receiverDateRange,
  sampleRoundOptions,
  sampleRequestItemOptions,
  sampleTypeOptions,
  splitDisplayFileName,
  stageLabels,
  validateDisplayFileBaseName,
  type ReceiverOrderFilters
} from "../../utils/receiverPresentation";

type FilterOption = { label: string; value: string };
type DisplayOrder = ReceiverOrderSummary & {
  entryDateLabel: string;
  sampleTypeLabel: string;
  sampleRoundLabel: string;
  fabricStatusLabel: string;
  trimStatusLabel: string;
  stageLabel: string;
  requestLabels: string;
  thumbnailPath: string;
};

const allOption = (label: string): FilterOption => ({ label, value: "" });
const monthFilters = (): ReceiverOrderFilters => ({
  ...emptyReceiverOrderFilters(),
  ...receiverDateRange("month")
});

const displayOrder = (order: ReceiverOrderSummary, thumbnailPath = ""): DisplayOrder => ({
  ...order,
  entryDateLabel: formatEntryDate(order.createdAt),
  sampleTypeLabel: optionLabel(sampleTypeOptions, order.sampleType),
  sampleRoundLabel: optionLabel(sampleRoundOptions, order.sampleRound),
  fabricStatusLabel: optionLabel(materialStatusOptions, order.fabricStatus),
  trimStatusLabel: optionLabel(materialStatusOptions, order.trimStatus),
  stageLabel: order.stage ? stageLabels[order.stage] ?? order.stage : "暂无工序",
  requestLabels: order.sampleRequestItems.map((value) => optionLabel(sampleRequestItemOptions, value)).join("、"),
  thumbnailPath
});

const uniqueOptions = (orders: ReceiverOrderSummary[], id: "customerId" | "salespersonId", name: "customerName" | "salespersonName") => {
  const values = new Map<string, string>();
  orders.forEach((order) => values.set(order[id], order[name]));
  return [...values.entries()].map(([value, label]) => ({ value, label }));
};

Page({
  data: {
    loading: false,
    message: "",
    orders: [] as DisplayOrder[],
    filteredOrders: [] as DisplayOrder[],
    uploadingMaterialOrderId: "",
    filters: monthFilters(),
    advancedOpen: false,
    customerOptions: [allOption("全部客户")] as FilterOption[],
    salespersonOptions: [allOption("全部业务员")] as FilterOption[],
    statusOptions: [
      allOption("全部状态"),
      { label: "进行中 / 待跟踪", value: "receiverActiveTracking" },
      ...Object.entries(stageLabels).map(([value, label]) => ({ value, label }))
    ] as FilterOption[],
    sampleRoundOptions: [allOption("全部轮次"), ...sampleRoundOptions] as FilterOption[],
    sampleTypeOptions: [allOption("全部样品类型"), ...sampleTypeOptions] as FilterOption[],
    materialStatusOptions: [allOption("全部状态"), ...materialStatusOptions] as FilterOption[]
  },

  async onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (!isActiveReceiverIdentity(app.globalData.identity)) {
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
      const context = await requireReceiverApiContext(app.globalData);
      const result = await listReceiverOrders(context.baseUrl, context.sessionToken);
      const orders = await Promise.all(result.orders.map(async (order) => {
        if (!order.thumbnailAttachmentId) return displayOrder(order);
        try {
          return displayOrder(order, await downloadOrderAttachment(
            context.baseUrl,
            context.sessionToken,
            "receiver",
            order.id,
            order.thumbnailAttachmentId
          ));
        } catch {
          return displayOrder(order);
        }
      }));
      orders.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      this.setData({
        orders,
        customerOptions: [allOption("全部客户"), ...uniqueOptions(result.orders, "customerId", "customerName")],
        salespersonOptions: [allOption("全部业务员"), ...uniqueOptions(result.orders, "salespersonId", "salespersonName")]
      });
      this.applyFilters();
    } catch (error) {
      const message = error instanceof Error ? error.message : "订单加载失败";
      this.setData({ message, orders: [], filteredOrders: [] });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyFilters() {
    this.setData({ filteredOrders: filterReceiverOrders(this.data.orders, this.data.filters) as DisplayOrder[] });
  },

  patchFilters(patch: Partial<ReceiverOrderFilters>) {
    this.setData({ filters: { ...this.data.filters, ...patch } });
    this.applyFilters();
  },

  onKeywordInput(event: WechatMiniprogram.Input) { this.patchFilters({ keyword: event.detail.value }); },
  onStatusChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ status: this.data.statusOptions[Number(event.detail.value)]?.value ?? "" }); },
  onRoundChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ sampleRound: this.data.sampleRoundOptions[Number(event.detail.value)]?.value ?? "" }); },
  onCustomerChange(event: WechatMiniprogram.PickerChange) {
    const customerId = this.data.customerOptions[Number(event.detail.value)]?.value ?? "";
    const source = customerId ? this.data.orders.filter((order) => order.customerId === customerId) : this.data.orders;
    this.setData({ salespersonOptions: [allOption("全部业务员"), ...uniqueOptions(source, "salespersonId", "salespersonName")] });
    this.patchFilters({ customerId, salespersonId: "" });
  },
  onSalespersonChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ salespersonId: this.data.salespersonOptions[Number(event.detail.value)]?.value ?? "" }); },
  onSampleTypeChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ sampleType: this.data.sampleTypeOptions[Number(event.detail.value)]?.value ?? "" }); },
  onFabricChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ fabricStatus: this.data.materialStatusOptions[Number(event.detail.value)]?.value ?? "" }); },
  onTrimChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ trimStatus: this.data.materialStatusOptions[Number(event.detail.value)]?.value ?? "" }); },
  onStartDateChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ startDate: String(event.detail.value) }); },
  onEndDateChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ endDate: String(event.detail.value) }); },
  onDeliveryStartChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ deliveryStartDate: String(event.detail.value) }); },
  onDeliveryEndChange(event: WechatMiniprogram.PickerChange) { this.patchFilters({ deliveryEndDate: String(event.detail.value) }); },
  useWeek() { this.patchFilters(receiverDateRange("week")); },
  useMonth() { this.patchFilters(receiverDateRange("month")); },
  useQuarter() { this.patchFilters(receiverDateRange("quarter")); },
  toggleAdvanced() { this.setData({ advancedOpen: !this.data.advancedOpen }); },
  resetFilters() { this.setData({ filters: monthFilters(), advancedOpen: false }); this.applyFilters(); },

  openDetail(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const order = this.data.orders.find((item) => item.id === id);
    if (!order) return;
    wx.setStorageSync("receiver:order-detail", order);
    void wx.navigateTo({ url: `/pages/receiver/order-detail?id=${encodeURIComponent(id)}` });
  },

  async openMaterialRecord(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const order = this.data.orders.find((item) => item.id === id);
    if (!order || this.data.uploadingMaterialOrderId) return;

    try {
      const action = await wx.showActionSheet({
        itemList: ["拍照", "从相册选择", "选择微信文件"]
      });
      let selected: { path: string; name: string } | undefined;
      if (action.tapIndex === 0 || action.tapIndex === 1) {
        const result = await wx.chooseImage({
          count: 1,
          sourceType: [action.tapIndex === 0 ? "camera" : "album"],
          sizeType: ["compressed", "original"]
        });
        const path = result.tempFilePaths[0];
        if (path) {
          selected = {
            path,
            name: path.replace(/\\/g, "/").split("/").pop() || "面辅料记录.jpg"
          };
        }
      } else {
        const result = await wx.chooseMessageFile({ count: 1, type: "file" });
        const file = result.tempFiles[0];
        if (file) selected = { path: file.path, name: file.name };
      }
      if (!selected) return;

      const { baseName, extension } = splitDisplayFileName(selected.name);
      const confirmation = await wx.showModal({
        title: "确认上传面辅料记录",
        content: baseName,
        editable: true,
        placeholderText: "请输入文件名",
        confirmText: "上传"
      });
      if (!confirmation.confirm) return;
      const displayName = confirmation.content.trim();
      const validationMessage = validateDisplayFileBaseName(displayName, extension);
      if (validationMessage) {
        void wx.showToast({ title: validationMessage, icon: "none" });
        return;
      }

      this.setData({ uploadingMaterialOrderId: id, message: "" });
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const context = await requireReceiverApiContext(app.globalData);
      const previous = await listOrderAttachments(context.baseUrl, context.sessionToken, "receiver", id);
      const uploaded = await uploadReceiverOrderAttachment(
        context.baseUrl,
        context.sessionToken,
        id,
        selected.path,
        { category: "receiver_material_record", visibility: "internal_only" }
      );
      const previousIds = new Set(previous.attachments.map((attachment) => attachment.id));
      const created = uploaded.attachments.find((attachment) => !previousIds.has(attachment.id));
      if (!created) throw new Error("附件已上传，但无法确认新附件，请在订单详情中检查");
      await renameOrderAttachment(
        context.baseUrl,
        context.sessionToken,
        "receiver",
        id,
        created.id,
        displayName
      );
      void wx.showToast({ title: "面辅料记录已上传", icon: "success" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message && !message.includes("cancel")) {
        this.setData({ message });
      }
    } finally {
      this.setData({ uploadingMaterialOrderId: "" });
    }
  }
});
