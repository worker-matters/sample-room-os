import type { MiniappGlobalData } from "../../app";
import {
  deleteMobileOrderCharge,
  deleteOrderAttachment,
  downloadOrderAttachment,
  downloadPlannerOrderAttachment,
  downloadPlannerPatternDeliverable,
  listMobileOrderCharges,
  listOrderAttachments,
  renameMobileOrderCharge,
  renameOrderAttachment
} from "../../services/apiClient";
import { isActivePlannerIdentity, requirePlannerApiContext } from "../../services/plannerSession";
import type { PlannerOrderSummary, PlannerPatternDeliverable, ReceiverCharge } from "../../types/contracts";
import {
  formatEntryDate,
  optionLabel,
  sampleRequestItemOptions,
  sampleRoundOptions,
  sampleTypeOptions,
  splitDisplayFileName,
  validateDisplayFileBaseName
} from "../../utils/receiverPresentation";

type DetailOrder = PlannerOrderSummary & {
  entryDateLabel: string;
  sampleTypeLabel: string;
  sampleRoundLabel: string;
  requestLabels: string;
  patternTaskStatusLabel: string;
  patternMakerName: string;
  deliverables: PlannerPatternDeliverable[];
};
type DisplayCharge = ReceiverCharge & { creatorRoleLabel: string; createdDate: string };
const creatorRoleLabel = (role: string) =>
  role === "receiver" ? "接单员"
    : role === "planner" ? "计划员"
      : role === "boss" ? "老板"
        : role === "system_owner" ? "System Owner"
          : role;

const patternTaskLabels: Record<string, string> = {
  pending: "待领取",
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
  submitted: "已提交",
  in_progress: "进行中",
  submitted_to_cutting: "已提交裁剪"
};

async function openDownloadedFile(filePath: string, mimeType?: string) {
  if (mimeType?.startsWith("image/")) {
    await wx.previewImage({ urls: [filePath], current: filePath });
    return;
  }
  await wx.openDocument({ filePath, showMenu: true });
}

Page({
  data: {
    activeTab: "overview" as "overview" | "attachments" | "charges" | "records",
    order: null as DetailOrder | null,
    charges: [] as DisplayCharge[],
    chargeTotal: "0.00",
    message: "",
    openingFileId: ""
  },

  changeDetailTab(event: WechatMiniprogram.TouchEvent) {
    const activeTab = String(event.currentTarget.dataset.tab) as "overview" | "attachments" | "charges" | "records";
    if (!["overview", "attachments", "charges", "records"].includes(activeTab)) return;
    this.setData({ activeTab });
  },

  onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (!isActivePlannerIdentity(app.globalData.identity)) {
      void wx.reLaunch({ url: app.globalData.identity.homeRoute });
    }
  },

  onLoad(query: Record<string, string | undefined>) {
    const order = wx.getStorageSync("planner:order-detail") as PlannerOrderSummary | undefined;
    if (!order || order.id !== query.id) {
      void wx.showToast({ title: "订单详情已失效，请返回列表重试", icon: "none" });
      return;
    }
    this.setData({
      order: {
        ...order,
        entryDateLabel: formatEntryDate(order.createdAt),
        sampleTypeLabel: optionLabel(sampleTypeOptions, order.sampleType),
        sampleRoundLabel: optionLabel(sampleRoundOptions, order.sampleRound),
        requestLabels: order.sampleRequestItems.map((value) => optionLabel(sampleRequestItemOptions, value)).join("、"),
        patternTaskStatusLabel: order.patternTask ? patternTaskLabels[order.patternTask.status] ?? order.patternTask.status : "无版师任务",
        patternMakerName: order.patternTask?.patternMakerName ?? "-",
        deliverables: order.patternTask?.deliverables ?? []
      }
    });
    void Promise.all([this.refreshAttachments(), this.refreshCharges()]);
  },

  async refreshAttachments() {
    if (!this.data.order) return;
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const context = await requirePlannerApiContext(app.globalData);
      const result = await listOrderAttachments(context.baseUrl, context.sessionToken, "planner", this.data.order.id);
      this.setData({ "order.attachments": result.attachments });
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "附件加载失败" });
    }
  },

  async refreshCharges() {
    if (!this.data.order) return;
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const context = await requirePlannerApiContext(app.globalData);
      const result = await listMobileOrderCharges(
        context.baseUrl,
        context.sessionToken,
        "planner",
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

  async openAttachment(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.order) return;
    const attachmentId = String(event.currentTarget.dataset.id ?? "");
    const mimeType = String(event.currentTarget.dataset.mime ?? "");
    if (!attachmentId) return;
    this.setData({ openingFileId: attachmentId, message: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const context = await requirePlannerApiContext(app.globalData);
      const filePath = await downloadPlannerOrderAttachment(
        context.baseUrl,
        context.sessionToken,
        this.data.order.id,
        attachmentId
      );
      await openDownloadedFile(filePath, mimeType);
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "附件打开失败" });
    } finally {
      this.setData({ openingFileId: "" });
    }
  },

  async openDeliverable(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.order) return;
    const deliverableId = String(event.currentTarget.dataset.id ?? "");
    if (!deliverableId) return;
    this.setData({ openingFileId: deliverableId, message: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const context = await requirePlannerApiContext(app.globalData);
      const filePath = await downloadPlannerPatternDeliverable(
        context.baseUrl,
        context.sessionToken,
        this.data.order.id,
        deliverableId
      );
      await openDownloadedFile(filePath);
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "版师交付物打开失败" });
    } finally {
      this.setData({ openingFileId: "" });
    }
  },

  renameAttachment(event: WechatMiniprogram.TouchEvent) {
    const attachmentId = String(event.currentTarget.dataset.id);
    const { baseName, extension } = splitDisplayFileName(String(event.currentTarget.dataset.name));
    void wx.showModal({ title: `修改附件名称${extension ? `（${extension} 已锁定）` : ""}`, editable: true, placeholderText: "只修改文件名主体", content: baseName })
      .then(async ({ confirm, content }) => {
        if (!confirm || !this.data.order) return;
        const validationMessage = validateDisplayFileBaseName(content, extension);
        if (validationMessage) {
          void wx.showToast({ title: validationMessage, icon: "none" });
          return;
        }
        try {
          const app = getApp<{ globalData: MiniappGlobalData }>();
          const context = await requirePlannerApiContext(app.globalData);
          const result = await renameOrderAttachment(context.baseUrl, context.sessionToken, "planner", this.data.order.id, attachmentId, content.trim());
          this.setData({ "order.attachments": result.attachments });
        } catch (error) { this.setData({ message: error instanceof Error ? error.message : "名称修改失败" }); }
      });
  },

  deleteAttachment(event: WechatMiniprogram.TouchEvent) {
    const attachmentId = String(event.currentTarget.dataset.id);
    void wx.showModal({ title: "删除附件？", content: "删除后会保留操作日志。", confirmColor: "#c24444" }).then(async ({ confirm }) => {
      if (!confirm || !this.data.order) return;
      try {
        const app = getApp<{ globalData: MiniappGlobalData }>();
        const context = await requirePlannerApiContext(app.globalData);
        const result = await deleteOrderAttachment(context.baseUrl, context.sessionToken, "planner", this.data.order.id, attachmentId);
        this.setData({ "order.attachments": result.attachments });
      } catch (error) { this.setData({ message: error instanceof Error ? error.message : "附件删除失败" }); }
    });
  },

  async downloadAttachment(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.order) return;
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const context = await requirePlannerApiContext(app.globalData);
      const filePath = await downloadOrderAttachment(context.baseUrl, context.sessionToken, "planner", this.data.order.id, String(event.currentTarget.dataset.id));
      await openDownloadedFile(filePath, String(event.currentTarget.dataset.mime));
    } catch (error) { this.setData({ message: error instanceof Error ? error.message : "下载失败" }); }
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
        const app = getApp<{ globalData: MiniappGlobalData }>();
        const context = await requirePlannerApiContext(app.globalData);
        await renameMobileOrderCharge(
          context.baseUrl,
          context.sessionToken,
          "planner",
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
        const app = getApp<{ globalData: MiniappGlobalData }>();
        const context = await requirePlannerApiContext(app.globalData);
        await deleteMobileOrderCharge(
          context.baseUrl,
          context.sessionToken,
          "planner",
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
