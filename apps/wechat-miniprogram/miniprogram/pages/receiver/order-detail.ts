import type { MiniappGlobalData } from "../../app";
import {
  deleteMobileOrderCharge,
  deleteOrderAttachment,
  downloadOrderAttachment,
  listMobileOrderCharges,
  listOrderAttachments,
  renameMobileOrderCharge,
  renameOrderAttachment
} from "../../services/apiClient";
import { isActiveReceiverIdentity, requireReceiverApiContext } from "../../services/receiverSession";
import type { ReceiverAttachment, ReceiverCharge, ReceiverOrderSummary } from "../../types/contracts";
import {
  formatEntryDate,
  materialStatusOptions,
  optionLabel,
  sampleRequestItemOptions,
  sampleRoundOptions,
  sampleTypeOptions,
  splitDisplayFileName,
  stageLabels,
  validateDisplayFileBaseName
} from "../../utils/receiverPresentation";

type DetailOrder = ReceiverOrderSummary & {
  entryDateLabel: string;
  sampleTypeLabel: string;
  sampleRoundLabel: string;
  fabricStatusLabel: string;
  trimStatusLabel: string;
  stageLabel: string;
  requestLabels: string;
  thumbnailPath: string;
};

type DisplayCharge = ReceiverCharge & { creatorRoleLabel: string; createdDate: string };
const creatorRoleLabel = (role: string) =>
  role === "receiver" ? "接单员"
    : role === "planner" ? "计划员"
      : role === "boss" ? "老板"
        : role === "system_owner" ? "System Owner"
          : role;

Page({
  data: {
    activeTab: "overview" as "overview" | "attachments" | "charges" | "records",
    order: null as DetailOrder | null,
    attachments: [] as ReceiverAttachment[],
    charges: [] as DisplayCharge[],
    chargeTotal: "0.00",
    message: "",
  },

  changeDetailTab(event: WechatMiniprogram.TouchEvent) {
    const activeTab = String(event.currentTarget.dataset.tab) as "overview" | "attachments" | "charges" | "records";
    if (!["overview", "attachments", "charges", "records"].includes(activeTab)) return;
    this.setData({ activeTab });
  },

  onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (!isActiveReceiverIdentity(app.globalData.identity)) {
      void wx.reLaunch({ url: app.globalData.identity.homeRoute });
    }
  },

  onLoad(query: Record<string, string | undefined>) {
    const order = wx.getStorageSync("receiver:order-detail") as ReceiverOrderSummary | undefined;
    if (!order || order.id !== query.id) {
      void wx.showToast({ title: "订单详情已失效，请返回列表重试", icon: "none" });
      return;
    }
    this.setData({
      activeTab: query.tab === "attachments" ? "attachments" : "overview",
      order: {
        ...order,
        entryDateLabel: formatEntryDate(order.createdAt),
        sampleTypeLabel: optionLabel(sampleTypeOptions, order.sampleType),
        sampleRoundLabel: optionLabel(sampleRoundOptions, order.sampleRound),
        fabricStatusLabel: optionLabel(materialStatusOptions, order.fabricStatus),
        trimStatusLabel: optionLabel(materialStatusOptions, order.trimStatus),
        stageLabel: order.stage ? stageLabels[order.stage] ?? order.stage : "暂无工序",
        requestLabels: order.sampleRequestItems.map((value) => optionLabel(sampleRequestItemOptions, value)).join("、"),
        thumbnailPath: (order as ReceiverOrderSummary & { thumbnailPath?: string }).thumbnailPath ?? ""
      }
    });
    void Promise.all([this.refreshAttachments(), this.refreshCharges()]);
  },

  async context() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    return requireReceiverApiContext(app.globalData);
  },

  async refreshAttachments() {
    if (!this.data.order) return;
    try {
      const context = await this.context();
      const result = await listOrderAttachments(context.baseUrl, context.sessionToken, "receiver", this.data.order.id);
      this.setData({ attachments: result.attachments });
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "附件加载失败" });
    }
  },

  async refreshCharges() {
    if (!this.data.order) return;
    try {
      const context = await this.context();
      const result = await listMobileOrderCharges(
        context.baseUrl,
        context.sessionToken,
        "receiver",
        this.data.order.id
      );
      this.setData({
        charges: result.charges.map((charge) => ({
          ...charge,
          creatorRoleLabel: creatorRoleLabel(charge.creatorRole),
          createdDate: charge.createdAt.slice(0, 10)
        })),
        chargeTotal: result.charges.reduce((sum, charge) => sum + charge.amount, 0).toFixed(2)
      });
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "其他费用加载失败" });
    }
  },

  async downloadAttachment(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.order) return;
    try {
      const context = await this.context();
      const filePath = await downloadOrderAttachment(context.baseUrl, context.sessionToken, "receiver", this.data.order.id, String(event.currentTarget.dataset.id));
      const mime = String(event.currentTarget.dataset.mime);
      if (mime.startsWith("image/")) await wx.previewImage({ urls: [filePath], current: filePath });
      else await wx.openDocument({ filePath, showMenu: true });
    } catch (error) { this.setData({ message: error instanceof Error ? error.message : "下载失败" }); }
  },

  renameAttachment(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id);
    const { baseName, extension } = splitDisplayFileName(String(event.currentTarget.dataset.name));
    void wx.showModal({ title: `修改附件名称${extension ? `（${extension} 已锁定）` : ""}`, editable: true, content: baseName, placeholderText: "只修改文件名主体" }).then(async ({ confirm, content }) => {
      if (!confirm || !this.data.order) return;
      const validationMessage = validateDisplayFileBaseName(content, extension);
      if (validationMessage) {
        void wx.showToast({ title: validationMessage, icon: "none" });
        return;
      }
      try {
        const context = await this.context();
        const result = await renameOrderAttachment(context.baseUrl, context.sessionToken, "receiver", this.data.order.id, id, content.trim());
        this.setData({ attachments: result.attachments });
      } catch (error) { this.setData({ message: error instanceof Error ? error.message : "名称修改失败" }); }
    });
  },

  deleteAttachment(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id);
    void wx.showModal({ title: "删除附件？", content: "只可删除当前账号有权限的附件。", confirmColor: "#c24444" }).then(async ({ confirm }) => {
      if (!confirm || !this.data.order) return;
      try {
        const context = await this.context();
        const result = await deleteOrderAttachment(context.baseUrl, context.sessionToken, "receiver", this.data.order.id, id);
        this.setData({ attachments: result.attachments });
      } catch (error) { this.setData({ message: error instanceof Error ? error.message : "附件删除失败" }); }
    });
  },

  renameCharge(event: WechatMiniprogram.TouchEvent) {
    const chargeId = String(event.currentTarget.dataset.id);
    const currentName = String(event.currentTarget.dataset.name);
    void wx.showModal({
      title: "修改费用名称",
      editable: true,
      content: currentName,
      placeholderText: "请输入费用名称"
    }).then(async ({ confirm, content }) => {
      if (!confirm || !this.data.order || !content.trim()) return;
      try {
        const context = await this.context();
        await renameMobileOrderCharge(
          context.baseUrl,
          context.sessionToken,
          "receiver",
          this.data.order.id,
          chargeId,
          content.trim()
        );
        await this.refreshCharges();
      } catch (error) {
        this.setData({ message: error instanceof Error ? error.message : "费用名称修改失败" });
      }
    });
  },

  deleteCharge(event: WechatMiniprogram.TouchEvent) {
    const chargeId = String(event.currentTarget.dataset.id);
    void wx.showModal({
      title: "删除这笔费用？",
      content: "仅可删除本人登记且仍待确认的费用，操作记录会保留。",
      confirmText: "删除",
      confirmColor: "#c24444"
    }).then(async ({ confirm }) => {
      if (!confirm || !this.data.order) return;
      try {
        const context = await this.context();
        await deleteMobileOrderCharge(
          context.baseUrl,
          context.sessionToken,
          "receiver",
          this.data.order.id,
          chargeId
        );
        await this.refreshCharges();
      } catch (error) {
        this.setData({ message: error instanceof Error ? error.message : "费用删除失败" });
      }
    });
  }
});
