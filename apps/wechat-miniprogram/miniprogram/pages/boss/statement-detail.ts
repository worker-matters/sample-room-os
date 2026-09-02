import type { MiniappGlobalData } from "../../app";
import {
  downloadBossStatement,
  listBossStatements,
  markBossStatementPaid,
  returnBossStatement,
  returnBossStatementItem,
  undoBossStatementPaid
} from "../../services/apiClient";
import { requireMobileApiContext } from "../../services/mobileSession";
import type { ReconciliationStatement } from "../../types/contracts";

Page({
  data: {
    statementId: "",
    statement: null as ReconciliationStatement | null,
    loading: false,
    message: ""
  },

  onLoad(query: Record<string, string | undefined>) {
    const statementId = query.id ?? "";
    const cached = wx.getStorageSync("boss:statement-detail") as ReconciliationStatement | undefined;
    this.setData({
      statementId,
      statement: cached?.id === statementId ? cached : null
    });
    void this.load();
  },

  async context() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    return requireMobileApiContext(app.globalData, ["boss", "system_owner"]);
  },

  async load() {
    if (!this.data.statementId) return;
    await this.run(async () => {
      const context = await this.context();
      const result = await listBossStatements(context.baseUrl, context.sessionToken);
      const statement = result.statements.find((item) => item.id === this.data.statementId);
      if (!statement) throw new Error("对账单不存在或已无权查看");
      this.updateStatement(statement);
    });
  },

  updateStatement(statement: ReconciliationStatement) {
    this.setData({ statement });
    wx.setStorageSync("boss:statement-detail", statement);
  },

  returnItem(event: WechatMiniprogram.TouchEvent) {
    const itemId = String(event.currentTarget.dataset.id);
    const item = this.data.statement?.items.find((candidate) => candidate.id === itemId);
    if (!item || !this.data.statement) return;
    void wx.showModal({
      title: "退回这个订单？",
      content: `款号：${item.styleNo}\n本单应收：¥${item.receivableTotal}\n\n确认后订单回到待对账，本对账单其余订单和历史记录不受影响。`,
      confirmText: "确认退回",
      confirmColor: "#c24444"
    }).then(async ({ confirm }) => {
      if (!confirm || !this.data.statement) return;
      await this.run(async () => {
        const context = await this.context();
        const result = await returnBossStatementItem(
          context.baseUrl,
          context.sessionToken,
          this.data.statement!.id,
          itemId
        );
        this.updateStatement(result.statement);
        void wx.showToast({ title: "订单已退回待对账", icon: "success" });
      });
    });
  },

  returnAll() {
    if (!this.data.statement) return;
    void wx.showModal({
      title: "退回整张对账单？",
      content: "所有未退回订单会回到待对账；对账单历史记录保留。已收款对账单不能退回。",
      confirmText: "确认退回",
      confirmColor: "#c24444"
    }).then(async ({ confirm }) => {
      if (!confirm || !this.data.statement) return;
      await this.run(async () => {
        const context = await this.context();
        const result = await returnBossStatement(
          context.baseUrl,
          context.sessionToken,
          this.data.statement!.id
        );
        this.updateStatement(result.statement);
        void wx.showToast({ title: "对账单已退回", icon: "success" });
      });
    });
  },

  markPaid() {
    if (!this.data.statement) return;
    void wx.showModal({
      title: "标记为已收款？",
      content: `应收金额：¥${this.data.statement.receivableAmount}\n确认实际收款后再执行此操作。`,
      confirmText: "确认收款"
    }).then(async ({ confirm }) => {
      if (!confirm || !this.data.statement) return;
      await this.run(async () => {
        const context = await this.context();
        const result = await markBossStatementPaid(
          context.baseUrl,
          context.sessionToken,
          this.data.statement!.id
        );
        this.updateStatement(result.statement);
        void wx.showToast({ title: "已标记收款", icon: "success" });
      });
    });
  },

  undoPaid() {
    if (!this.data.statement) return;
    void wx.showModal({
      title: "取消确认收款？",
      content: "对账单会恢复为待付款，金额快照和订单明细不会改变。",
      confirmText: "确认取消",
      confirmColor: "#c24444"
    }).then(async ({ confirm }) => {
      if (!confirm || !this.data.statement) return;
      await this.run(async () => {
        const context = await this.context();
        const result = await undoBossStatementPaid(
          context.baseUrl,
          context.sessionToken,
          this.data.statement!.id
        );
        this.updateStatement(result.statement);
      });
    });
  },

  download() {
    if (!this.data.statement) return;
    void this.run(async () => {
      const context = await this.context();
      const filePath = await downloadBossStatement(
        context.baseUrl,
        context.sessionToken,
        this.data.statement!.id
      );
      await wx.openDocument({ filePath, showMenu: true });
    });
  },

  async run(action: () => Promise<void>) {
    if (this.data.loading) return;
    this.setData({ loading: true, message: "" });
    try {
      await action();
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "操作失败" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
