import type { MiniappGlobalData } from "../../app";
import {
  supplementClientOrder,
  supplementClientOrderWithoutFile,
  uploadClientOrderAttachment,
  type ClientSupplementUploadFields
} from "../../services/apiClient";
import { isClientBusinessIdentity, requireClientApiContext } from "../../services/clientSession";
import type { ClientOrderSummary } from "../../types/contracts";
import { optionLabel, sampleRoundOptions, sampleTypeOptions } from "../../utils/receiverPresentation";

type LocalImage = { path: string; name: string; size: number };
type SupplementForm = Omit<ClientSupplementUploadFields, "category" | "visibility">;

const leafName = (path: string, fallback: string) =>
  path.replace(/\\/g, "/").split("/").pop() || fallback;

Page({
  data: {
    order: null as ClientOrderSummary | null,
    form: null as SupplementForm | null,
    sampleTypeLabels: sampleTypeOptions.map((item) => item.label),
    sampleRoundLabels: sampleRoundOptions.map((item) => item.label),
    sampleTypeLabel: "",
    sampleRoundLabel: "",
    files: [] as LocalImage[],
    submitting: false,
    message: ""
  },

  onLoad(query: Record<string, string | undefined>) {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (!isClientBusinessIdentity(app.globalData.identity)) {
      void wx.reLaunch({ url: app.globalData.identity.homeRoute });
      return;
    }
    const order = wx.getStorageSync("client:supplement-order") as ClientOrderSummary | undefined;
    if (!order || order.id !== query.id || order.intakeStatus !== "needs_client_supplement") {
      this.setData({ message: "该订单当前不能补充资料，请返回订单列表刷新。" });
      return;
    }
    this.setData({
      order,
      form: {
        styleNo: order.styleNo,
        styleName: order.styleName,
        quantity: String(order.quantity),
        sampleType: order.sampleType,
        sampleRound: order.sampleRound,
        deliveryDate: order.deliveryDate,
        remark: order.remark ?? ""
      },
      sampleTypeLabel: optionLabel(sampleTypeOptions, order.sampleType),
      sampleRoundLabel: optionLabel(sampleRoundOptions, order.sampleRound)
    });
  },

  onInput(event: WechatMiniprogram.Input) {
    if (!this.data.form) return;
    const field = String(event.currentTarget.dataset.field ?? "") as keyof SupplementForm;
    if (!field) return;
    this.setData({ form: { ...this.data.form, [field]: event.detail.value } });
  },
  onSampleTypeChange(event: WechatMiniprogram.PickerChange) {
    if (!this.data.form) return;
    const option = sampleTypeOptions[Number(event.detail.value)] ?? sampleTypeOptions[0]!;
    this.setData({ sampleTypeLabel: option.label, form: { ...this.data.form, sampleType: option.value } });
  },
  onSampleRoundChange(event: WechatMiniprogram.PickerChange) {
    if (!this.data.form) return;
    const option = sampleRoundOptions[Number(event.detail.value)] ?? sampleRoundOptions[0]!;
    this.setData({ sampleRoundLabel: option.label, form: { ...this.data.form, sampleRound: option.value } });
  },
  onDeliveryDateChange(event: WechatMiniprogram.PickerChange) {
    if (!this.data.form) return;
    this.setData({ form: { ...this.data.form, deliveryDate: String(event.detail.value) } });
  },
  async chooseImages(sourceType: Array<"camera" | "album">) {
    const result = await wx.chooseImage({ count: 9, sourceType, sizeType: ["compressed", "original"] });
    const files = result.tempFiles.map((file, index) => ({
      path: file.path,
      name: leafName(file.path, `补充资料-${index + 1}.jpg`),
      size: file.size
    }));
    this.setData({ files: [...this.data.files, ...files] });
  },
  chooseCamera() { void this.chooseImages(["camera"]).catch(() => undefined); },
  chooseAlbum() { void this.chooseImages(["album"]).catch(() => undefined); },
  removeFile(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ files: this.data.files.filter((_file, current) => current !== index) });
  },

  validate() {
    const form = this.data.form;
    if (!form || !form.styleNo.trim() || !form.styleName.trim() || !form.deliveryDate) return "请完整填写款号、款名和交期";
    if (!/^\d+$/.test(form.quantity) || Number(form.quantity) <= 0) return "数量必须为正整数";
    return "";
  },
  async submit() {
    if (!this.data.order || !this.data.form || this.data.submitting) return;
    const validation = this.validate();
    if (validation) {
      void wx.showToast({ title: validation, icon: "none" });
      return;
    }
    this.setData({ submitting: true, message: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const api = await requireClientApiContext(app.globalData);
      const orderId = this.data.order.id;
      if (this.data.files.length) {
        const first = this.data.files[0]!;
        await supplementClientOrder(api.baseUrl, api.sessionToken, orderId, first.path, {
          ...this.data.form,
          category: "client_upload",
          visibility: "client_visible"
        });
        for (const file of this.data.files.slice(1)) {
          await uploadClientOrderAttachment(api.baseUrl, api.sessionToken, orderId, file.path);
        }
      } else {
        await supplementClientOrderWithoutFile(api.baseUrl, api.sessionToken, orderId, this.data.form);
      }
      wx.removeStorageSync("client:supplement-order");
      void wx.redirectTo({ url: "/pages/client/orders" });
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "补充资料提交失败" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
