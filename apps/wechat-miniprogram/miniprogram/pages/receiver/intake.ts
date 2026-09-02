import type { MiniappGlobalData } from "../../app";
import {
  createReceiverIntake,
  createReceiverQuickPhoto,
  listReceiverSelfEntryOptions,
  uploadReceiverOrderAttachment,
  type ReceiverIntakeUploadFields,
  type ReceiverQuickPhotoUploadFields
} from "../../services/apiClient";
import { isActiveReceiverIdentity, requireReceiverApiContext } from "../../services/receiverSession";
import type { ReceiverSelfEntryCustomer } from "../../types/contracts";
import {
  defaultSampleRequestItems,
  materialStatusOptions,
  sampleRequestItemOptions,
  sampleRoundOptions,
  sampleTypeOptions
} from "../../utils/receiverPresentation";

type IntakeMode = "quick" | "full";
type LocalFile = { path: string; name: string; size: number; source: "image" | "file" };

const dateAfterDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const initialForm = () => ({
  customerId: "",
  clientUserId: "",
  styleNo: "",
  styleName: "",
  quantity: "1",
  sampleType: "first_sample",
  sampleRound: "round_1",
  deliveryDate: dateAfterDays(7),
  remark: "",
  fabricStatus: "missing",
  trimStatus: "missing",
  sampleRequestItems: [...defaultSampleRequestItems]
});

const leafName = (path: string, fallback: string) =>
  path.replace(/\\/g, "/").split("/").pop() || fallback;

Page({
  data: {
    mode: "quick" as IntakeMode,
    optionalOpen: false,
    loading: false,
    submitting: false,
    message: "",
    successMessage: "",
    customers: [] as ReceiverSelfEntryCustomer[],
    customerLabels: [] as string[],
    clientUserLabels: [] as string[],
    selectedCustomerLabel: "请选择客户",
    selectedClientUserLabel: "请选择业务员",
    selectedSampleTypeLabel: sampleTypeOptions[0].label as string,
    selectedSampleRoundLabel: sampleRoundOptions[0].label as string,
    selectedFabricLabel: materialStatusOptions[0].label as string,
    selectedTrimLabel: materialStatusOptions[0].label as string,
    form: initialForm(),
    files: [] as LocalFile[],
    sampleTypeLabels: sampleTypeOptions.map((item) => item.label),
    sampleRoundLabels: sampleRoundOptions.map((item) => item.label),
    materialStatusLabels: materialStatusOptions.map((item) => item.label),
    sampleRequestChoices: sampleRequestItemOptions.map((item) => ({
      ...item,
      checked: defaultSampleRequestItems.includes(item.value)
    }))
  },

  async onShow() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    if (!isActiveReceiverIdentity(app.globalData.identity)) {
      void wx.reLaunch({ url: app.globalData.identity.homeRoute });
      return;
    }
    if (!this.data.customers.length) await this.loadOptions();
  },

  async loadOptions() {
    this.setData({ loading: true, message: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const context = await requireReceiverApiContext(app.globalData);
      const result = await listReceiverSelfEntryOptions(context.baseUrl, context.sessionToken);
      const first = result.customers[0];
      this.setData({
        customers: result.customers,
        customerLabels: result.customers.map((item) => item.name),
        clientUserLabels: first?.clientUsers.map((item) => item.displayName) ?? [],
        selectedCustomerLabel: first?.name ?? "请选择客户",
        selectedClientUserLabel: first?.clientUsers[0]?.displayName ?? "请选择业务员",
        form: {
          ...this.data.form,
          customerId: first?.id ?? "",
          clientUserId: first?.clientUsers[0]?.id ?? ""
        }
      });
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "现场录入选项加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  changeMode(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset.mode ?? "quick") as IntakeMode;
    if (mode !== "quick" && mode !== "full") return;
    this.setData({ mode, optionalOpen: mode === "full", message: "", successMessage: "" });
  },

  toggleOptional() {
    this.setData({ optionalOpen: !this.data.optionalOpen });
  },

  onCustomerChange(event: WechatMiniprogram.PickerChange) {
    const customer = this.data.customers[Number(event.detail.value)];
    this.setData({
      clientUserLabels: customer?.clientUsers.map((item) => item.displayName) ?? [],
      selectedCustomerLabel: customer?.name ?? "请选择客户",
      selectedClientUserLabel: customer?.clientUsers[0]?.displayName ?? "请选择业务员",
      form: {
        ...this.data.form,
        customerId: customer?.id ?? "",
        clientUserId: customer?.clientUsers[0]?.id ?? ""
      }
    });
  },

  onClientUserChange(event: WechatMiniprogram.PickerChange) {
    const customer = this.data.customers.find((item) => item.id === this.data.form.customerId);
    const user = customer?.clientUsers[Number(event.detail.value)];
    this.setData({
      selectedClientUserLabel: user?.displayName ?? "请选择业务员",
      form: { ...this.data.form, clientUserId: user?.id ?? "" }
    });
  },

  onTextInput(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field ?? "") as
      | "styleNo"
      | "styleName"
      | "quantity"
      | "remark";
    if (!field) return;
    this.setData({ form: { ...this.data.form, [field]: event.detail.value } });
  },

  onSampleTypeChange(event: WechatMiniprogram.PickerChange) {
    const option = sampleTypeOptions[Number(event.detail.value)] ?? sampleTypeOptions[0];
    this.setData({
      selectedSampleTypeLabel: option.label,
      form: { ...this.data.form, sampleType: option.value }
    });
  },

  onSampleRoundChange(event: WechatMiniprogram.PickerChange) {
    const option = sampleRoundOptions[Number(event.detail.value)] ?? sampleRoundOptions[0];
    this.setData({
      selectedSampleRoundLabel: option.label,
      form: { ...this.data.form, sampleRound: option.value }
    });
  },

  onFabricChange(event: WechatMiniprogram.PickerChange) {
    const option = materialStatusOptions[Number(event.detail.value)] ?? materialStatusOptions[0];
    this.setData({
      selectedFabricLabel: option.label,
      form: { ...this.data.form, fabricStatus: option.value }
    });
  },

  onTrimChange(event: WechatMiniprogram.PickerChange) {
    const option = materialStatusOptions[Number(event.detail.value)] ?? materialStatusOptions[0];
    this.setData({
      selectedTrimLabel: option.label,
      form: { ...this.data.form, trimStatus: option.value }
    });
  },

  onDeliveryDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ form: { ...this.data.form, deliveryDate: String(event.detail.value) } });
  },

  onSampleRequestChange(event: WechatMiniprogram.CheckboxGroupChange) {
    const values = event.detail.value;
    this.setData({
      sampleRequestChoices: this.data.sampleRequestChoices.map((item) => ({
        ...item,
        checked: values.includes(item.value)
      })),
      form: { ...this.data.form, sampleRequestItems: values }
    });
  },

  addImageFiles(result: WechatMiniprogram.ChooseImageSuccessCallbackResult) {
    const files = result.tempFiles.map((file, index) => ({
      path: file.path,
      name: leafName(file.path, `现场照片-${index + 1}.jpg`),
      size: file.size,
      source: "image" as const
    }));
    this.setData({ files: [...this.data.files, ...files] });
  },

  async chooseImages(sourceType: Array<"camera" | "album">) {
    const result = await wx.chooseImage({ count: 9, sourceType, sizeType: ["compressed", "original"] });
    this.addImageFiles(result);
  },

  chooseCamera() {
    void this.chooseImages(["camera"]).catch(() => undefined);
  },

  chooseLibrary() {
    void wx.showActionSheet({ itemList: ["从相册选择", "选择微信文件"] }).then((result) => {
      if (result.tapIndex === 0) {
        return this.chooseImages(["album"]);
      }
      return this.chooseAttachments();
    }).catch(() => undefined);
  },

  async chooseAttachments() {
    const result = await wx.chooseMessageFile({ count: 9, type: "file" });
    const files = result.tempFiles.map((file) => ({
      path: file.path,
      name: file.name,
      size: file.size,
      source: "file" as const
    }));
    this.setData({ files: [...this.data.files, ...files] });
  },

  removeFile(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ files: this.data.files.filter((_item, itemIndex) => itemIndex !== index) });
  },

  validateQuick() {
    if (!this.data.form.customerId || !this.data.form.clientUserId) return "请选择客户和业务员";
    if (!this.data.files.length) return "请先拍照或选择打样单附件";
    if (
      this.data.optionalOpen &&
      (!/^\d+$/.test(this.data.form.quantity) || Number(this.data.form.quantity) <= 0)
    ) return "数量必须为正整数";
    return "";
  },

  validateFull() {
    const form = this.data.form;
    if (!form.customerId || !form.clientUserId || !form.styleNo.trim() || !form.styleName.trim() || !form.deliveryDate) {
      return "请填写客户、业务员、款号、款名和交期";
    }
    if (!/^\d+$/.test(form.quantity) || Number(form.quantity) <= 0) return "数量必须为正整数";
    if (!form.sampleRequestItems.length) return "至少选择一个打样要求";
    if (!this.data.files.length) return "请先拍照或选择打样单附件";
    return "";
  },

  resetAfterSubmit() {
    const customerId = this.data.form.customerId;
    const clientUserId = this.data.form.clientUserId;
    this.setData({
      form: { ...initialForm(), customerId, clientUserId },
      files: [],
      optionalOpen: false,
      selectedSampleTypeLabel: sampleTypeOptions[0].label,
      selectedSampleRoundLabel: sampleRoundOptions[0].label,
      selectedFabricLabel: materialStatusOptions[0].label,
      selectedTrimLabel: materialStatusOptions[0].label,
      sampleRequestChoices: sampleRequestItemOptions.map((item) => ({
        ...item,
        checked: defaultSampleRequestItems.includes(item.value)
      }))
    });
  },

  async submitQuickPhoto() {
    const validation = this.validateQuick();
    if (validation) {
      void wx.showToast({ title: validation, icon: "none" });
      return;
    }
    this.setData({ submitting: true, message: "", successMessage: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const context = await requireReceiverApiContext(app.globalData);
      const form = this.data.form;
      const optionalFields = this.data.optionalOpen
        ? {
            ...(form.styleNo.trim() ? { styleNo: form.styleNo.trim() } : {}),
            ...(form.styleName.trim() ? { styleName: form.styleName.trim() } : {}),
            quantity: form.quantity,
            sampleType: form.sampleType,
            sampleRound: form.sampleRound,
            deliveryDate: form.deliveryDate,
            ...(form.remark.trim() ? { remark: form.remark.trim() } : {})
          }
        : {};
      const fields: ReceiverQuickPhotoUploadFields = {
        customerId: form.customerId,
        clientUserId: form.clientUserId,
        ...optionalFields,
        category: "receiver_quick_photo",
        visibility: "client_visible"
      };
      const firstFile = this.data.files[0]!;
      const created = await createReceiverQuickPhoto(
        context.baseUrl,
        context.sessionToken,
        firstFile.path,
        fields
      );
      let failedUploads = 0;
      for (const file of this.data.files.slice(1)) {
        try {
          await uploadReceiverOrderAttachment(
            context.baseUrl,
            context.sessionToken,
            created.order.id,
            file.path,
            { category: "receiver_quick_photo", visibility: "client_visible" }
          );
        } catch {
          failedUploads += 1;
        }
      }
      this.resetAfterSubmit();
      this.setData({
        successMessage: failedUploads
          ? `已生成待校对订单 ${created.order.styleNo}，${failedUploads} 个补充附件上传失败`
          : `已生成待校对订单 ${created.order.styleNo}`
      });
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "拍照简录失败" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async submitFullIntake() {
    const validation = this.validateFull();
    if (validation) {
      void wx.showToast({ title: validation, icon: "none" });
      return;
    }
    this.setData({ submitting: true, message: "", successMessage: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const context = await requireReceiverApiContext(app.globalData);
      const form = this.data.form;
      const fields: ReceiverIntakeUploadFields = {
        customerId: form.customerId,
        clientUserId: form.clientUserId,
        styleNo: form.styleNo.trim(),
        styleName: form.styleName.trim(),
        quantity: form.quantity,
        sampleType: form.sampleType,
        sampleRound: form.sampleRound,
        deliveryDate: form.deliveryDate,
        remark: form.remark.trim(),
        patternStatus: "none",
        fabricStatus: form.fabricStatus,
        trimStatus: form.trimStatus,
        sampleRequestItems: JSON.stringify(form.sampleRequestItems),
        category: "receiver_quick_photo",
        visibility: "client_visible"
      };
      const firstFile = this.data.files[0]!;
      const created = await createReceiverIntake(
        context.baseUrl,
        context.sessionToken,
        firstFile.path,
        fields
      );
      let failedUploads = 0;
      for (const file of this.data.files.slice(1)) {
        try {
          await uploadReceiverOrderAttachment(
            context.baseUrl,
            context.sessionToken,
            created.order.id,
            file.path,
            { category: "receiver_quick_photo", visibility: "client_visible" }
          );
        } catch {
          failedUploads += 1;
        }
      }
      this.resetAfterSubmit();
      this.setData({
        successMessage: failedUploads
          ? `完整订单 ${created.order.styleNo} 已创建，${failedUploads} 个补充附件上传失败`
          : `完整订单 ${created.order.styleNo} 已创建`
      });
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "常规录入失败" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  submitCurrentMode() {
    if (this.data.submitting) return;
    if (this.data.mode === "quick") {
      void this.submitQuickPhoto();
      return;
    }
    void this.submitFullIntake();
  }
});
