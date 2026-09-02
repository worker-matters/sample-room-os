import type { MiniappGlobalData } from "../../app";
import {
  createPlannerScanCharge,
  deletePlannerChargeAttachment,
  downloadPlannerOrderAttachment,
  resolvePlannerScanCharge,
  uploadPlannerChargeAttachment,
  voidPlannerCharge
} from "../../services/apiClient";
import { isActivePlannerIdentity, requirePlannerApiContext } from "../../services/plannerSession";
import type { PlannerScanChargeContext, ReceiverCharge } from "../../types/contracts";
import { OrderQrPayloadError, parseMiniappOrderQrPayload } from "../../utils/orderQrPayload";

type LocalFile = { path: string; name: string };
type DisplayCharge = ReceiverCharge & { creatorRoleLabel: string; createdDate: string };
type DisplayContext = Omit<PlannerScanChargeContext, "charges"> & { charges: DisplayCharge[] };
const leafName = (path: string, fallback: string) => path.replace(/\\/g, "/").split("/").pop() || fallback;
const creatorRoleLabel = (role: string) =>
  role === "receiver" ? "接单员"
    : role === "planner" ? "计划员"
      : role === "boss" ? "老板"
        : role === "system_owner" ? "System Owner"
          : role;
const presentContext = (context: PlannerScanChargeContext): DisplayContext => ({
  ...context,
  charges: context.charges.map((charge) => ({
    ...charge,
    creatorRoleLabel: creatorRoleLabel(charge.creatorRole),
    createdDate: charge.createdAt.slice(0, 10)
  }))
});

Page({
  data: {
    loading: false,
    submitting: false,
    message: "",
    token: "",
    context: null as DisplayContext | null,
    charge: { name: "", amount: "", explanation: "" },
    chargeFiles: [] as LocalFile[]
  },

  onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (!isActivePlannerIdentity(app.globalData.identity)) {
      void wx.reLaunch({ url: app.globalData.identity.homeRoute });
    }
  },

  async scanOrderQr() {
    try {
      const scanned = await wx.scanCode({ onlyFromCamera: true, scanType: ["qrCode"] });
      await this.load(parseMiniappOrderQrPayload(scanned.result).token);
    } catch (error) {
      const message = error instanceof OrderQrPayloadError
        ? "请扫描 SRS2|ORDER|... 订单流转码"
        : error instanceof Error ? error.message : "二维码读取失败";
      this.setData({ message });
      void wx.showToast({ title: message, icon: "none" });
    }
  },

  async load(providedToken?: string) {
    const token = providedToken ?? this.data.token;
    this.setData({ loading: true, message: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const api = await requirePlannerApiContext(app.globalData);
      const context = await resolvePlannerScanCharge(api.baseUrl, api.sessionToken, token);
      this.setData({ token, context: presentContext(context) });
    } catch (error) {
      this.setData({ context: null, token: "", message: error instanceof Error ? error.message : "订单费用读取失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  resetScan() { this.setData({ token: "", context: null, charge: { name: "", amount: "", explanation: "" }, chargeFiles: [], message: "" }); },
  onChargeInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field ?? "") as "name" | "amount" | "explanation";
    if (!field) return;
    this.setData({ charge: { ...this.data.charge, [field]: event.detail.value } });
  },
  async chooseChargeImages() {
    const result = await wx.chooseImage({ count: 1, sourceType: ["camera", "album"], sizeType: ["compressed", "original"] });
    this.setData({ chargeFiles: result.tempFiles.map((file) => ({ path: file.path, name: leafName(file.path, "费用照片.jpg") })) });
  },
  removeChargeFile(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ chargeFiles: this.data.chargeFiles.filter((_file, itemIndex) => itemIndex !== index) });
  },

  async submitCharge() {
    if (this.data.submitting || !this.data.context || this.data.context.chargeLocked) return;
    const amount = Number(this.data.charge.amount);
    if (!this.data.charge.name.trim() || !Number.isFinite(amount) || amount <= 0) {
      void wx.showToast({ title: "请填写费用名称和正数金额", icon: "none" });
      return;
    }
    this.setData({ submitting: true, message: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const api = await requirePlannerApiContext(app.globalData);
      const created = await createPlannerScanCharge(api.baseUrl, api.sessionToken, this.data.token, {
        name: this.data.charge.name.trim(),
        amount,
        explanation: this.data.charge.explanation.trim(),
        sourceScene: "planner_mobile_scan"
      });
      let failed = 0;
      for (const file of this.data.chargeFiles) {
        try {
          await uploadPlannerChargeAttachment(api.baseUrl, api.sessionToken, created.orderId, created.charge.id, file.path);
        } catch {
          failed += 1;
        }
      }
      this.setData({ charge: { name: "", amount: "", explanation: "" }, chargeFiles: [] });
      await this.load(this.data.token);
      if (failed) void wx.showToast({ title: `${failed} 个费用附件上传失败`, icon: "none" });
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "费用登记失败" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async voidCharge(event: WechatMiniprogram.TouchEvent) {
    const chargeId = String(event.currentTarget.dataset.chargeId ?? "");
    const orderId = String(event.currentTarget.dataset.orderId ?? "");
    if (!chargeId || !orderId) return;
    const confirmed = await wx.showModal({ title: "作废费用", content: "仅可作废本人登记的费用，是否继续？", confirmText: "作废" });
    if (!confirmed.confirm) return;
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const api = await requirePlannerApiContext(app.globalData);
      await voidPlannerCharge(api.baseUrl, api.sessionToken, orderId, chargeId);
      await this.load(this.data.token);
    } catch (error) {
      void wx.showToast({ title: error instanceof Error ? error.message : "费用作废失败", icon: "none" });
    }
  },

  async openChargeAttachment(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.context) return;
    const attachmentId = String(event.currentTarget.dataset.attachmentId ?? "");
    if (!attachmentId) return;
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const api = await requirePlannerApiContext(app.globalData);
      const filePath = await downloadPlannerOrderAttachment(api.baseUrl, api.sessionToken, this.data.context.order.id, attachmentId);
      await wx.openDocument({ filePath, showMenu: true });
    } catch (error) {
      void wx.showToast({ title: error instanceof Error ? error.message : "附件打开失败", icon: "none" });
    }
  },

  async deleteChargeAttachment(event: WechatMiniprogram.TouchEvent) {
    const orderId = String(event.currentTarget.dataset.orderId ?? "");
    const chargeId = String(event.currentTarget.dataset.chargeId ?? "");
    const attachmentId = String(event.currentTarget.dataset.attachmentId ?? "");
    const confirmed = await wx.showModal({ title: "删除费用附件", content: "删除后当前页面不再显示该文件，审计记录仍保留。", confirmText: "删除" });
    if (!confirmed.confirm) return;
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const api = await requirePlannerApiContext(app.globalData);
      await deletePlannerChargeAttachment(api.baseUrl, api.sessionToken, orderId, chargeId, attachmentId);
      await this.load(this.data.token);
    } catch (error) {
      void wx.showToast({ title: error instanceof Error ? error.message : "费用附件删除失败", icon: "none" });
    }
  }
});
