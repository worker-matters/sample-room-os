import type { MiniappGlobalData } from "../../app";
import {
  createBossStatement,
  downloadBossOrderAttachment,
  listBossPricingRows
} from "../../services/apiClient";
import { requireMobileApiContext } from "../../services/mobileSession";
import type { BossPricingRow } from "../../types/contracts";

type PricingStatus = "all" | "unpriced" | "priced";
type DisplayRow = BossPricingRow & {
  selected: boolean;
  statusLabel: "已定价" | "未定价";
  eligibilityLabel: string;
  thumbnailPath?: string;
};

const priced = (row: BossPricingRow) =>
  (row.summary.quotationStatus ?? row.pricing?.quotationStatus) === "confirmed" &&
  !row.quotationHasUnconfirmedChanges;

Page({
  data: {
    rows: [] as DisplayRow[],
    allRows: [] as BossPricingRow[],
    selectedIds: [] as string[],
    search: "",
    status: "all" as PricingStatus,
    statusOptions: ["全部", "未定价", "已定价"],
    statusIndex: 0,
    customerOptions: ["全部客户"],
    customerIndex: 0,
    salespersonOptions: ["全部客户业务员"],
    salespersonIndex: 0,
    loading: false,
    message: ""
  },

  onShow() {
    void this.load();
  },

  async context() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    return requireMobileApiContext(app.globalData, ["boss", "system_owner"]);
  },

  async load() {
    this.setData({ loading: true, message: "" });
    try {
      const context = await this.context();
      const pricing = await listBossPricingRows(context.baseUrl, context.sessionToken);
      const rowsWithThumbnails = await Promise.all(
        pricing.rows.map(async (row) => {
          const attachments = row.order.attachments ?? [];
          const thumbnail =
            attachments.find((item) => item.id === row.order.thumbnailAttachmentId) ??
            attachments.find((item) => item.category === "style_thumbnail" && item.mimeType.startsWith("image/")) ??
            attachments.find((item) => item.mimeType.startsWith("image/"));
          if (!thumbnail?.hasFile) return row;
          try {
            const thumbnailPath = await downloadBossOrderAttachment(
              context.baseUrl,
              context.sessionToken,
              row.order.id,
              thumbnail.id
            );
            return { ...row, thumbnailPath };
          } catch {
            return row;
          }
        })
      );
      this.setData({
        allRows: rowsWithThumbnails,
        customerOptions: [
          "全部客户",
          ...new Set(rowsWithThumbnails.map((row) => row.order.customerName).filter(Boolean))
        ]
      });
      this.refreshSalespeople();
      this.applyFilters();
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "待对账加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  refreshSalespeople() {
    const selectedCustomer = this.data.customerOptions[this.data.customerIndex];
    const source = selectedCustomer === "全部客户"
      ? this.data.allRows
      : this.data.allRows.filter((row) => row.order.customerName === selectedCustomer);
    this.setData({
      salespersonOptions: [
        "全部客户业务员",
        ...new Set(source.map((row) => row.order.salespersonName).filter(Boolean))
      ],
      salespersonIndex: 0
    });
  },

  onSearch(event: WechatMiniprogram.Input) {
    this.setData({ search: event.detail.value });
    this.applyFilters();
  },

  onStatusChange(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.detail.value);
    this.setData({
      statusIndex: index,
      status: (["all", "unpriced", "priced"] as const)[index] ?? "all"
    });
    this.applyFilters();
  },

  onCustomerChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ customerIndex: Number(event.detail.value) });
    this.refreshSalespeople();
    this.applyFilters();
  },

  onSalespersonChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ salespersonIndex: Number(event.detail.value) });
    this.applyFilters();
  },

  applyFilters() {
    const query = this.data.search.trim().toLowerCase();
    const customer = this.data.customerOptions[this.data.customerIndex];
    const salesperson = this.data.salespersonOptions[this.data.salespersonIndex];
    const selected = new Set(this.data.selectedIds);
    const rows = this.data.allRows
      .filter((row) => {
        const isPriced = priced(row);
        if (this.data.status === "priced" && !isPriced) return false;
        if (this.data.status === "unpriced" && isPriced) return false;
        if (customer !== "全部客户" && row.order.customerName !== customer) return false;
        if (salesperson !== "全部客户业务员" && row.order.salespersonName !== salesperson) {
          return false;
        }
        return !query || [
          row.order.orderNo,
          row.order.styleNo,
          row.order.styleName,
          row.order.customerName,
          row.order.salespersonName
        ].some((value) => String(value ?? "").toLowerCase().includes(query));
      })
      .map((row) => ({
        ...row,
        selected: selected.has(row.order.id),
        statusLabel: priced(row) ? "已定价" as const : "未定价" as const,
        eligibilityLabel: row.reconciliationEligibility.eligible
          ? "选择加入对账"
          : "确认最新报价后可对账"
      }));
    this.setData({ rows });
  },

  toggleRow(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id);
    const row = this.data.allRows.find((candidate) => candidate.order.id === id);
    if (!row?.reconciliationEligibility.eligible) return;
    const selected = new Set(this.data.selectedIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    this.setData({ selectedIds: [...selected] });
    this.applyFilters();
  },

  openPricing(event: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({
      url: `/pages/boss/pricing-detail?id=${encodeURIComponent(String(event.currentTarget.dataset.id))}`
    });
  },

  async createStatement() {
    if (!this.data.selectedIds.length || this.data.loading) return;
    const selectedRows = this.data.allRows.filter((row) => this.data.selectedIds.includes(row.order.id));
    const first = selectedRows[0]?.order;
    if (
      first &&
      selectedRows.some(
        (row) =>
          row.order.customerName !== first.customerName ||
          row.order.salespersonName !== first.salespersonName
      )
    ) {
      void wx.showToast({ title: "请选择同一客户和业务员的订单", icon: "none" });
      return;
    }
    this.setData({ loading: true, message: "" });
    try {
      const context = await this.context();
      await createBossStatement(context.baseUrl, context.sessionToken, this.data.selectedIds);
      this.setData({ selectedIds: [] });
      await this.load();
      void wx.showToast({ title: "对账单已生成", icon: "success" });
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "生成对账单失败" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
