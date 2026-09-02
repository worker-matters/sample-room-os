import type { MiniappGlobalData } from "../../app";
import { listBossStatements } from "../../services/apiClient";
import { requireMobileApiContext } from "../../services/mobileSession";
import type { ReconciliationStatement } from "../../types/contracts";

type StatementStatus = "all" | "pending_payment" | "paid" | "returned";
type DisplayStatement = ReconciliationStatement & {
  statusLabel: string;
  generatedDate: string;
};

const statusLabel = (status: ReconciliationStatement["status"]) =>
  status === "paid" ? "已收款" : status === "returned" ? "已退回" : "待付款";

Page({
  data: {
    allStatements: [] as ReconciliationStatement[],
    statements: [] as DisplayStatement[],
    status: "all" as StatementStatus,
    search: "",
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
      const result = await listBossStatements(context.baseUrl, context.sessionToken);
      this.setData({
        allStatements: result.statements,
        customerOptions: [
          "全部客户",
          ...new Set(result.statements.map((statement) => statement.customerName).filter(Boolean))
        ],
        customerIndex: 0
      });
      this.refreshSalespeople();
      this.applyFilters();
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "对账单加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.status);
    const status: StatementStatus =
      value === "pending_payment" || value === "paid" || value === "returned" ? value : "all";
    this.setData({ status });
    this.applyFilters();
  },

  onSearch(event: WechatMiniprogram.Input) {
    this.setData({ search: event.detail.value });
    this.applyFilters();
  },

  refreshSalespeople() {
    const selectedCustomer = this.data.customerOptions[this.data.customerIndex];
    const source = selectedCustomer === "全部客户"
      ? this.data.allStatements
      : this.data.allStatements.filter(
          (statement) => statement.customerName === selectedCustomer
        );
    this.setData({
      salespersonOptions: [
        "全部客户业务员",
        ...new Set(source.map((statement) => statement.salespersonName).filter(Boolean))
      ],
      salespersonIndex: 0
    });
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
    const statements = this.data.allStatements
      .filter((statement) => {
        if (this.data.status !== "all" && statement.status !== this.data.status) return false;
        if (customer !== "全部客户" && statement.customerName !== customer) return false;
        if (
          salesperson !== "全部客户业务员" &&
          statement.salespersonName !== salesperson
        ) return false;
        return !query || [
          statement.statementNo,
          statement.customerName,
          statement.salespersonName
        ].some((value) => value.toLowerCase().includes(query));
      })
      .map((statement) => ({
        ...statement,
        statusLabel: statusLabel(statement.status),
        generatedDate: statement.generatedAt.slice(0, 10)
      }));
    this.setData({ statements });
  },

  openStatement(event: WechatMiniprogram.TouchEvent) {
    const statement = this.data.allStatements.find(
      (item) => item.id === String(event.currentTarget.dataset.id)
    );
    if (!statement) return;
    wx.setStorageSync("boss:statement-detail", statement);
    void wx.navigateTo({
      url: `/pages/boss/statement-detail?id=${encodeURIComponent(statement.id)}`
    });
  }
});
