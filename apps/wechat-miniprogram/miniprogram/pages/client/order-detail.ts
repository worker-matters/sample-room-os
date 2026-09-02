import type { MiniappGlobalData } from "../../app";
import { downloadClientOrderAttachment, downloadClientPatternDeliverable } from "../../services/apiClient";
import { isActiveClientIdentity, isClientAdminIdentity, requireClientApiContext } from "../../services/clientSession";
import type { ClientOrderSummary } from "../../types/contracts";
import { optionLabel, sampleRoundOptions, sampleTypeOptions } from "../../utils/receiverPresentation";

type DetailOrder = ClientOrderSummary & {
  sampleTypeLabel: string;
  sampleRoundLabel: string;
  quotationLabel: string;
  patternDeliverables: NonNullable<ClientOrderSummary["patternDeliverables"]>;
};

async function openFile(filePath: string, mimeType?: string) {
  if (mimeType?.startsWith("image/")) {
    await wx.previewImage({ current: filePath, urls: [filePath] });
    return;
  }
  await wx.openDocument({ filePath, showMenu: true });
}

Page({
  data: {
    order: null as DetailOrder | null,
    role: "client_business_user",
    isAdmin: false,
    message: "",
    openingFileId: ""
  },

  onLoad(query: Record<string, string | undefined>) {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (!isActiveClientIdentity(app.globalData.identity)) {
      void wx.reLaunch({ url: app.globalData.identity.homeRoute });
      return;
    }
    const order = wx.getStorageSync("client:order-detail") as ClientOrderSummary | undefined;
    if (!order || order.id !== query.id) {
      this.setData({ message: "订单详情已失效，请返回订单列表重试" });
      return;
    }
    this.setData({
      role: isClientAdminIdentity(app.globalData.identity) ? "client_admin" : "client_business_user",
      isAdmin: isClientAdminIdentity(app.globalData.identity),
      order: {
        ...order,
        sampleTypeLabel: optionLabel(sampleTypeOptions, order.sampleType),
        sampleRoundLabel: optionLabel(sampleRoundOptions, order.sampleRound),
        quotationLabel: order.quotation ? `¥${order.quotation.receivableTotal.toFixed(2)}` : "暂无已确认报价",
        patternDeliverables: order.patternDeliverables ?? []
      }
    });
  },

  async openAttachment(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.order) return;
    const attachmentId = String(event.currentTarget.dataset.id ?? "");
    const mimeType = String(event.currentTarget.dataset.mime ?? "");
    if (!attachmentId) return;
    this.setData({ openingFileId: attachmentId, message: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const api = await requireClientApiContext(app.globalData);
      await openFile(await downloadClientOrderAttachment(
        api.baseUrl,
        api.sessionToken,
        this.data.order.id,
        attachmentId
      ), mimeType);
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "附件打开失败" });
    } finally {
      this.setData({ openingFileId: "" });
    }
  },

  async openDeliverable(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.order) return;
    const deliverableId = String(event.currentTarget.dataset.id ?? "");
    const mimeType = String(event.currentTarget.dataset.mime ?? "");
    if (!deliverableId) return;
    this.setData({ openingFileId: deliverableId, message: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const api = await requireClientApiContext(app.globalData);
      await openFile(await downloadClientPatternDeliverable(
        api.baseUrl,
        api.sessionToken,
        this.data.order.id,
        deliverableId
      ), mimeType);
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "交付文件打开失败" });
    } finally {
      this.setData({ openingFileId: "" });
    }
  },

  goSupplement() {
    if (!this.data.order || this.data.isAdmin) return;
    wx.setStorageSync("client:supplement-order", this.data.order);
    void wx.navigateTo({ url: `/pages/client/supplement?id=${encodeURIComponent(this.data.order.id)}` });
  }
});
