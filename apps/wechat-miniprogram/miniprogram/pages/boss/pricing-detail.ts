import type { MiniappGlobalData } from "../../app";
import {
  beginBossQuotationUpdate,
  confirmBossOrderCharge,
  confirmBossQuotation,
  createBossCustomerCharge,
  createBossInternalCost,
  createBossOrderCharge,
  deleteBossCustomerCharge,
  deleteBossInternalCost,
  deleteBossOrderCharge,
  getBossPricing,
  initializeBossPricing,
  listBossOrderCharges,
  updateBossCustomerCharge,
  updateBossInternalCost
} from "../../services/apiClient";
import { requireMobileApiContext } from "../../services/mobileSession";
import type {
  BossCustomerChargeItem,
  BossInternalCostCategory,
  BossInternalCostItem,
  BossOrderCharge,
  BossPricingDetail,
  BossPricingMethod
} from "../../types/contracts";

type Option<T extends string = string> = { label: string; value: T };
type CustomerDraft = BossCustomerChargeItem & {
  nameIndex: number;
  methodIndex: number;
  sourceIndex: number;
};
type InternalDraft = BossInternalCostItem & {
  categoryIndex: number;
  sourceIndex: number;
};
type DisplayOrderCharge = BossOrderCharge & {
  statusLabel: string;
  creatorLabel: string;
  createdDate: string;
};

const customerNameOptions: Option[] = [
  { label: "样衣费", value: "样衣费" },
  { label: "小样费", value: "小样费" },
  { label: "版费", value: "版费" }
];
const pricingMethodOptions: Option<BossPricingMethod>[] = [
  { label: "固定金额", value: "fixed" },
  { label: "单价 × 数量", value: "unit_quantity" }
];
const categoryOptions: Option<BossInternalCostCategory>[] = [
  { label: "版师成本", value: "pattern" },
  { label: "裁剪成本", value: "cutting" },
  { label: "缝制成本", value: "sewing" },
  { label: "后整成本", value: "finishing" },
  { label: "其他成本", value: "other" }
];
const roleLabels: Record<string, string> = {
  boss: "老板",
  system_owner: "System Owner",
  receiver: "接单员",
  planner: "计划员",
  pattern_maker: "版师"
};
const statusLabels: Record<BossOrderCharge["status"], string> = {
  pending: "待确认",
  confirmed: "已确认",
  effective: "已确认",
  rejected: "已驳回",
  cancelled: "已取消",
  void: "已归档"
};

const optionIndex = <T extends string>(options: Option<T>[], value: string | undefined) => {
  const index = options.findIndex((option) => option.value === value);
  return index < 0 ? 0 : index;
};

const draftId = (kind: string) =>
  `draft-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

Page({
  data: {
    orderId: "",
    detail: null as BossPricingDetail | null,
    customerDrafts: [] as CustomerDraft[],
    internalDrafts: [] as InternalDraft[],
    deletedCustomerIds: [] as string[],
    deletedInternalIds: [] as string[],
    otherCharges: [] as DisplayOrderCharge[],
    sourceOptions: [{ label: "人工新增", value: "" }] as Option[],
    customerNameOptions,
    pricingMethodOptions,
    categoryOptions,
    otherName: "",
    otherAmount: "",
    locked: false,
    hasConfirmedSnapshot: false,
    dirty: false,
    loading: false,
    message: ""
  },

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ orderId: query.id ?? "" });
    void this.load();
  },

  async context() {
    const app = getApp<{ globalData: MiniappGlobalData }>();
    return requireMobileApiContext(app.globalData, ["boss", "system_owner"]);
  },

  async load() {
    if (!this.data.orderId) return;
    this.setData({ loading: true, message: "" });
    try {
      const context = await this.context();
      let detail = await getBossPricing(
        context.baseUrl,
        context.sessionToken,
        this.data.orderId
      );
      if (
        detail.pricing?.quotationStatus !== "confirmed" &&
        !detail.pricing?.recommendationsInitializedAt
      ) {
        detail = await initializeBossPricing(
          context.baseUrl,
          context.sessionToken,
          this.data.orderId
        );
      }
      const chargeResult = await listBossOrderCharges(
        context.baseUrl,
        context.sessionToken,
        this.data.orderId
      );
      const sourceLabels = [
        ...detail.orderTasks.map((task) => task.label),
        ...(detail.pricing?.customerChargeItems ?? []).map((item) => item.sourceTask ?? ""),
        ...(detail.pricing?.internalCostItems ?? []).map((item) => item.sourceTask ?? "")
      ].filter(Boolean);
      const sourceOptions: Option[] = [
        { label: "人工新增", value: "" },
        ...[...new Set(sourceLabels)].map((label) => ({ label, value: label }))
      ];
      const customerDrafts = (detail.pricing?.customerChargeItems ?? [])
        .filter((item) => !item.archivedAt)
        .map((item) => this.customerDraft(item, sourceOptions));
      const internalDrafts = (detail.pricing?.internalCostItems ?? [])
        .filter((item) => !item.archivedAt)
        .map((item) => this.internalDraft(item, sourceOptions));
      const otherCharges = chargeResult.charges
        .filter((item) => !item.archivedAt)
        .map((item) => ({
          ...item,
          statusLabel: statusLabels[item.status],
          creatorLabel: `${roleLabels[item.creatorRole] ?? item.creatorRole} · ${item.creatorName || item.creatorId}`,
          createdDate: item.createdAt.slice(0, 10)
        }));
      this.setData({
        detail,
        sourceOptions,
        customerDrafts,
        internalDrafts,
        otherCharges,
        locked: detail.pricing?.quotationStatus === "confirmed",
        hasConfirmedSnapshot: Boolean(detail.confirmedQuotation),
        deletedCustomerIds: [],
        deletedInternalIds: [],
        dirty: false
      });
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "定价加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  customerDraft(item: BossCustomerChargeItem, sourceOptions: Option[]): CustomerDraft {
    return {
      ...item,
      nameIndex: optionIndex(customerNameOptions, item.name),
      methodIndex: optionIndex(pricingMethodOptions, item.pricingMethod),
      sourceIndex: optionIndex(sourceOptions, item.sourceTask)
    };
  },

  internalDraft(item: BossInternalCostItem, sourceOptions: Option[]): InternalDraft {
    return {
      ...item,
      categoryIndex: optionIndex(categoryOptions, item.category),
      sourceIndex: optionIndex(sourceOptions, item.sourceTask)
    };
  },

  updateCustomer(event: WechatMiniprogram.Input) {
    const id = String(event.currentTarget.dataset.id);
    const field = String(event.currentTarget.dataset.field);
    const value = event.detail.value;
    const customerDrafts = this.data.customerDrafts.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, [field]: field === "note" ? value : Number(value || 0) };
      return {
        ...next,
        amount: next.pricingMethod === "unit_quantity"
          ? Number(next.unitPrice ?? 0) * Number(next.quantity ?? 0)
          : Number(next.amount ?? 0)
      };
    });
    this.setData({ customerDrafts, dirty: true });
  },

  pickCustomer(event: WechatMiniprogram.PickerChange) {
    const id = String(event.currentTarget.dataset.id);
    const field = String(event.currentTarget.dataset.field);
    const index = Number(event.detail.value);
    const customerDrafts = this.data.customerDrafts.map((item) => {
      if (item.id !== id) return item;
      if (field === "name") {
        return { ...item, name: customerNameOptions[index]?.value ?? "样衣费", nameIndex: index };
      }
      if (field === "method") {
        const pricingMethod = pricingMethodOptions[index]?.value ?? "fixed";
        return {
          ...item,
          pricingMethod,
          methodIndex: index,
          unitPrice: item.unitPrice ?? 0,
          quantity: item.quantity ?? 1,
          amount: pricingMethod === "unit_quantity"
            ? Number(item.unitPrice ?? 0) * Number(item.quantity ?? 1)
            : Number(item.amount ?? 0)
        };
      }
      const sourceTask = this.data.sourceOptions[index]?.value ?? "";
      return { ...item, sourceTask, sourceIndex: index };
    });
    this.setData({ customerDrafts, dirty: true });
  },

  addCustomer() {
    if (this.data.locked) return;
    const item: BossCustomerChargeItem = {
      id: draftId("customer"),
      name: "样衣费",
      pricingMethod: "fixed",
      amount: 0,
      sourceType: "manual"
    };
    this.setData({
      customerDrafts: [
        ...this.data.customerDrafts,
        this.customerDraft(item, this.data.sourceOptions)
      ],
      dirty: true
    });
  },

  removeCustomer(event: WechatMiniprogram.TouchEvent) {
    if (this.data.locked) return;
    const id = String(event.currentTarget.dataset.id);
    const deletedCustomerIds = id.startsWith("draft-")
      ? this.data.deletedCustomerIds
      : [...this.data.deletedCustomerIds, id];
    this.setData({
      customerDrafts: this.data.customerDrafts.filter((item) => item.id !== id),
      deletedCustomerIds,
      dirty: true
    });
  },

  updateInternal(event: WechatMiniprogram.Input) {
    const id = String(event.currentTarget.dataset.id);
    const field = String(event.currentTarget.dataset.field);
    const value = event.detail.value;
    this.setData({
      internalDrafts: this.data.internalDrafts.map((item) =>
        item.id === id
          ? { ...item, [field]: field === "note" || field === "sourceTask" ? value : Number(value || 0) }
          : item
      ),
      dirty: true
    });
  },

  pickInternal(event: WechatMiniprogram.PickerChange) {
    const id = String(event.currentTarget.dataset.id);
    const field = String(event.currentTarget.dataset.field);
    const index = Number(event.detail.value);
    const internalDrafts = this.data.internalDrafts.map((item) => {
      if (item.id !== id) return item;
      if (field === "category") {
        const option = categoryOptions[index] ?? categoryOptions[4]!;
        return { ...item, category: option.value, name: option.label, categoryIndex: index };
      }
      const sourceTask = this.data.sourceOptions[index]?.value ?? "";
      return { ...item, sourceTask, sourceIndex: index };
    });
    this.setData({ internalDrafts, dirty: true });
  },

  addInternal() {
    if (this.data.locked) return;
    const item: BossInternalCostItem = {
      id: draftId("internal"),
      name: "其他成本",
      category: "other",
      amount: 0,
      sourceType: "manual"
    };
    this.setData({
      internalDrafts: [
        ...this.data.internalDrafts,
        this.internalDraft(item, this.data.sourceOptions)
      ],
      dirty: true
    });
  },

  removeInternal(event: WechatMiniprogram.TouchEvent) {
    if (this.data.locked) return;
    const id = String(event.currentTarget.dataset.id);
    const deletedInternalIds = id.startsWith("draft-")
      ? this.data.deletedInternalIds
      : [...this.data.deletedInternalIds, id];
    this.setData({
      internalDrafts: this.data.internalDrafts.filter((item) => item.id !== id),
      deletedInternalIds,
      dirty: true
    });
  },

  otherField(event: WechatMiniprogram.Input) {
    this.setData({ [String(event.currentTarget.dataset.field)]: event.detail.value });
  },

  async addOtherCharge() {
    const amount = Number(this.data.otherAmount);
    if (!this.data.otherName.trim() || !Number.isFinite(amount) || amount <= 0) {
      void wx.showToast({ title: "请填写费用名称和大于零的金额", icon: "none" });
      return;
    }
    await this.run(async () => {
      const context = await this.context();
      await createBossOrderCharge(context.baseUrl, context.sessionToken, this.data.orderId, {
        name: this.data.otherName.trim(),
        amount
      });
      this.setData({ otherName: "", otherAmount: "" });
      await this.load();
      void wx.showToast({ title: "其他费用已登记", icon: "success" });
    });
  },

  confirmOtherCharge(event: WechatMiniprogram.TouchEvent) {
    const chargeId = String(event.currentTarget.dataset.id);
    void this.run(async () => {
      const context = await this.context();
      await confirmBossOrderCharge(
        context.baseUrl,
        context.sessionToken,
        this.data.orderId,
        chargeId
      );
      await this.load();
    });
  },

  deleteOtherCharge(event: WechatMiniprogram.TouchEvent) {
    const chargeId = String(event.currentTarget.dataset.id);
    void wx.showModal({
      title: "删除这笔其他费用？",
      content: "费用会退出金额合计，历史审计记录仍保留。",
      confirmColor: "#c24444"
    }).then(async ({ confirm }) => {
      if (!confirm) return;
      await this.run(async () => {
        const context = await this.context();
        await deleteBossOrderCharge(
          context.baseUrl,
          context.sessionToken,
          this.data.orderId,
          chargeId
        );
        await this.load();
      });
    });
  },

  validateDrafts() {
    const customerValid = this.data.customerDrafts.every((item) =>
      customerNameOptions.some((option) => option.value === item.name) &&
      Number.isFinite(item.amount) &&
      item.amount >= 0 &&
      (item.pricingMethod === "fixed" ||
        (Number.isFinite(Number(item.unitPrice)) &&
          Number(item.unitPrice) >= 0 &&
          Number.isFinite(Number(item.quantity)) &&
          Number(item.quantity) >= 0))
    );
    const internalValid = this.data.internalDrafts.every(
      (item) => Number.isFinite(item.amount) && item.amount >= 0
    );
    if (!customerValid || !internalValid) {
      void wx.showToast({ title: "请完整填写报价与成本金额", icon: "none" });
      return false;
    }
    return true;
  },

  async persistDrafts(showToast = true) {
    if (this.data.locked || !this.validateDrafts()) return false;
    if (!this.data.dirty) {
      if (showToast) void wx.showToast({ title: "草稿已保存", icon: "success" });
      return true;
    }
    const context = await this.context();
    for (const id of this.data.deletedInternalIds) {
      await deleteBossInternalCost(context.baseUrl, context.sessionToken, this.data.orderId, id);
    }
    for (const item of this.data.internalDrafts) {
      const payload = {
        name: categoryOptions[item.categoryIndex]?.label ?? item.name,
        category: item.category,
        amount: Number(item.amount),
        sourceTask: item.sourceTask ?? "",
        note: item.note ?? ""
      };
      if (item.id.startsWith("draft-")) {
        await createBossInternalCost(context.baseUrl, context.sessionToken, this.data.orderId, payload);
      } else {
        await updateBossInternalCost(
          context.baseUrl,
          context.sessionToken,
          this.data.orderId,
          item.id,
          payload
        );
      }
    }
    for (const id of this.data.deletedCustomerIds) {
      await deleteBossCustomerCharge(context.baseUrl, context.sessionToken, this.data.orderId, id);
    }
    for (const item of this.data.customerDrafts) {
      const payload = {
        name: item.name,
        pricingMethod: item.pricingMethod,
        ...(item.pricingMethod === "unit_quantity"
          ? {
              unitPrice: Number(item.unitPrice ?? 0),
              quantity: Number(item.quantity ?? 0)
            }
          : { amount: Number(item.amount) }),
        sourceTask: item.sourceTask ?? "",
        note: item.note ?? ""
      };
      if (item.id.startsWith("draft-")) {
        await createBossCustomerCharge(
          context.baseUrl,
          context.sessionToken,
          this.data.orderId,
          payload
        );
      } else {
        await updateBossCustomerCharge(
          context.baseUrl,
          context.sessionToken,
          this.data.orderId,
          item.id,
          payload
        );
      }
    }
    await this.load();
    if (showToast) void wx.showToast({ title: "草稿已保存", icon: "success" });
    return true;
  },

  saveDraft() {
    void this.run(() => this.persistDrafts());
  },

  confirmPricing() {
    if (!this.data.customerDrafts.length) {
      void wx.showToast({ title: "请至少保留一个客户报价项目", icon: "none" });
      return;
    }
    const updating = this.data.hasConfirmedSnapshot;
    void this.run(async () => {
      if (!(await this.persistDrafts(false))) return;
      const context = await this.context();
      await confirmBossQuotation(context.baseUrl, context.sessionToken, this.data.orderId);
      await this.load();
      void wx.showToast({
        title: updating ? "更新报价已确认" : "客户报价已确认",
        icon: "success"
      });
    });
  },

  beginUpdate() {
    void this.run(async () => {
      const context = await this.context();
      await beginBossQuotationUpdate(context.baseUrl, context.sessionToken, this.data.orderId);
      await this.load();
      void wx.showToast({ title: "已进入报价更新", icon: "success" });
    });
  },

  async run(action: () => Promise<unknown>) {
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
