import {
  DeleteOutlined,
  PlusOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  sampleRoomApi,
  type CustomerChargeItem,
  type CustomerChargeItemPayload,
  type InternalCostCategory,
  type InternalCostItem,
  type InternalCostItemPayload,
  type OrderChargeRecord,
  type PricingRow
} from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";
import { viewportBoundDialogWidth } from "../dialogLayout";
import { decimalInputProps } from "../forms/numericInputProps";
import { BossOrderSummaryHeader } from "./BossOrderSummaryHeader";
import { OrderChargeList } from "./OrderChargeList";

type PricingDetail = Awaited<ReturnType<typeof sampleRoomApi.getAdminOrderPricing>>;

type DynamicPricingModalProps = {
  session: DevSession;
  row: PricingRow | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
};

const costCategoryOptions: Array<{ label: string; value: InternalCostCategory }> = [
  { label: "版师成本", value: "pattern" },
  { label: "裁剪成本", value: "cutting" },
  { label: "缝制成本", value: "sewing" },
  { label: "后整成本", value: "finishing" },
  { label: "其他成本", value: "other" }
];

const customerChargeNameOptions = [
  { label: "样衣费", value: "样衣费" },
  { label: "小样费", value: "小样费" },
  { label: "版费", value: "版费" }
] as const;

const sourceLabels: Record<string, string> = {
  system_recommended: "系统推荐",
  manual: "人工新增",
  evidence: "证据识别",
  legacy: "历史数据"
};

function yuan(value: number | undefined) {
  return value === undefined ? "-" : `¥${value.toFixed(2)}`;
}

function sourceText(sourceType: string, sourceTask?: string) {
  return sourceTask || sourceLabels[sourceType] || sourceType;
}

function costName(category: InternalCostCategory) {
  return costCategoryOptions.find((option) => option.value === category)?.label ?? "其他成本";
}

function draftId(prefix: string) {
  return `draft-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function DynamicPricingModal({
  session,
  row,
  open,
  onClose,
  onChanged
}: DynamicPricingModalProps) {
  const [detail, setDetail] = useState<PricingDetail>();
  const [otherCharges, setOtherCharges] = useState<OrderChargeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [costEditing, setCostEditing] = useState<"new">();
  const [customerEditing, setCustomerEditing] = useState<"new">();
  const [costDrafts, setCostDrafts] = useState<InternalCostItem[]>([]);
  const [customerDrafts, setCustomerDrafts] = useState<CustomerChargeItem[]>([]);
  const [deletedCostIds, setDeletedCostIds] = useState<string[]>([]);
  const [deletedCustomerIds, setDeletedCustomerIds] = useState<string[]>([]);
  const [pricingDraftDirty, setPricingDraftDirty] = useState(false);
  const [otherChargeDetailOpen, setOtherChargeDetailOpen] = useState(false);
  const [localConfirmedEdit, setLocalConfirmedEdit] = useState(false);
  const [serverDraftStarted, setServerDraftStarted] = useState(false);
  const [costForm] = Form.useForm<InternalCostItemPayload>();
  const [customerForm] = Form.useForm<CustomerChargeItemPayload>();
  const [messageApi, contextHolder] = message.useMessage();

  const load = useCallback(async (syncPricingDrafts = true) => {
    if (!row) return;
    setLoading(true);
    try {
      let pricingDetail = await sampleRoomApi.getAdminOrderPricing(session, row.order.id);
      if (
        pricingDetail.pricing?.quotationStatus !== "confirmed" &&
        !pricingDetail.pricing?.recommendationsInitializedAt
      ) {
        await sampleRoomApi.initializeAdminOrderPricing(session, row.order.id);
        pricingDetail = await sampleRoomApi.getAdminOrderPricing(session, row.order.id);
      }
      const charges = await sampleRoomApi.listAdminOrderCharges(session, row.order.id);
      setDetail(pricingDetail);
      setOtherCharges(charges.charges);
      if (syncPricingDrafts) {
        setCostDrafts(
          (pricingDetail.pricing?.internalCostItems ?? []).filter((item) => !item.archivedAt)
        );
        setCustomerDrafts(
          (pricingDetail.pricing?.customerChargeItems ?? []).filter((item) => !item.archivedAt)
        );
        setDeletedCostIds([]);
        setDeletedCustomerIds([]);
        setPricingDraftDirty(false);
        const confirmed = pricingDetail.pricing?.quotationStatus === "confirmed";
        setLocalConfirmedEdit(confirmed);
        setServerDraftStarted(!confirmed);
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "定价详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi, row, session]);

  useEffect(() => {
    if (open) void load(true);
    if (!open) {
      setDetail(undefined);
      setOtherCharges([]);
      setCostDrafts([]);
      setCustomerDrafts([]);
      setPricingDraftDirty(false);
      setOtherChargeDetailOpen(false);
      setLocalConfirmedEdit(false);
      setServerDraftStarted(false);
    }
  }, [load, open]);

  useEffect(() => {
    setOtherChargeDetailOpen(false);
  }, [row?.order.id]);

  const persistedConfirmed = detail?.pricing?.quotationStatus === "confirmed";
  const locked = persistedConfirmed && !localConfirmedEdit;
  const hasConfirmedSnapshot = Boolean(detail?.confirmedQuotation);
  const activeInternalCosts = costDrafts;
  const activeCustomerCharges = customerDrafts;

  const mutate = async (
    operation: () => Promise<unknown>,
    success: string,
    syncPricingDrafts = true
  ) => {
    setSaving(true);
    try {
      await operation();
      messageApi.success(success);
      await load(syncPricingDrafts);
      await onChanged();
      return true;
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "操作失败");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openCost = () => {
    setCostEditing("new");
    costForm.resetFields();
    costForm.setFieldsValue({
      category: "other",
      sourceTask: "",
      note: ""
    });
  };

  const saveCost = async () => {
    if (!row || !costEditing) return;
    const values = await costForm.validateFields();
    setCostDrafts((current) => [
      ...current,
      {
        id: draftId("cost"),
        pricingRecordId: detail?.pricing?.id ?? "",
        name: costName(values.category),
        category: values.category,
        sourceType: "manual",
        ...(values.sourceTask && values.sourceTask !== "人工新增"
          ? { sourceTask: values.sourceTask }
          : {}),
        amount: values.amount,
        ...(values.note ? { note: values.note } : {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]);
    setPricingDraftDirty(true);
    setCostEditing(undefined);
  };

  const openCustomerCharge = () => {
    setCustomerEditing("new");
    customerForm.resetFields();
    customerForm.setFieldsValue({
      name: "样衣费",
      pricingMethod: "fixed",
      sourceTask: "人工新增",
      note: ""
    });
  };

  const saveCustomerCharge = async () => {
    if (!row || !customerEditing) return;
    const values = await customerForm.validateFields();
    const amount =
      values.pricingMethod === "unit_quantity"
        ? Number(values.unitPrice ?? 0) * Number(values.quantity ?? 0)
        : Number(values.amount ?? 0);
    setCustomerDrafts((current) => [
      ...current,
      {
        id: draftId("customer"),
        pricingRecordId: detail?.pricing?.id ?? "",
        name: values.name,
        pricingMethod: values.pricingMethod,
        ...(values.pricingMethod === "unit_quantity"
          ? {
              unitPrice: Number(values.unitPrice ?? 0),
              quantity: Number(values.quantity ?? 0)
            }
          : {}),
        amount,
        sourceType: "manual",
        ...(values.sourceTask && values.sourceTask !== "人工新增"
          ? { sourceTask: values.sourceTask }
          : {}),
        ...(values.note ? { note: values.note } : {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]);
    setPricingDraftDirty(true);
    setCustomerEditing(undefined);
  };

  const maintainOtherCharge = async (operation: () => Promise<unknown>) => {
    await operation();
    await load(false);
    await onChanged();
  };

  const ensureServerDraftStarted = async () => {
    if (!row || !persistedConfirmed || serverDraftStarted) return true;
    try {
      await sampleRoomApi.beginAdminOrderPricingUpdate(session, row.order.id);
      setServerDraftStarted(true);
      return true;
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "无法开始更新报价");
      return false;
    }
  };

  const persistPricingDrafts = async (successMessage?: string) => {
    if (!row) return false;
    if (!pricingDraftDirty) {
      if (successMessage) messageApi.success(successMessage);
      return true;
    }
    if (
      costDrafts.some((item) => !Number.isFinite(item.amount) || item.amount < 0) ||
      customerDrafts.some(
        (item) =>
          !item.name ||
          !Number.isFinite(item.amount) ||
          (item.pricingMethod === "unit_quantity" &&
            (!Number.isFinite(Number(item.unitPrice)) ||
              !Number.isFinite(Number(item.quantity))))
      )
    ) {
      messageApi.warning("请先完整填写成本和客户报价");
      return false;
    }

    setSaving(true);
    try {
      if (!(await ensureServerDraftStarted())) return false;
      for (const itemId of deletedCostIds) {
        await sampleRoomApi.deleteAdminInternalCost(session, row.order.id, itemId);
      }
      for (const item of costDrafts) {
        const payload: InternalCostItemPayload = {
          name: item.category === "material" ? item.name : costName(item.category),
          category: item.category,
          amount: item.amount,
          sourceTask: item.sourceTask || null,
          note: item.note || null
        };
        if (item.id.startsWith("draft-")) {
          await sampleRoomApi.addAdminInternalCost(session, row.order.id, payload);
        } else {
          await sampleRoomApi.updateAdminInternalCost(
            session,
            row.order.id,
            item.id,
            payload
          );
        }
      }

      for (const itemId of deletedCustomerIds) {
        await sampleRoomApi.deleteAdminCustomerCharge(session, row.order.id, itemId);
      }
      for (const item of customerDrafts) {
        const payload: CustomerChargeItemPayload = {
          name: item.name,
          pricingMethod: item.pricingMethod,
          unitPrice: item.pricingMethod === "unit_quantity" ? item.unitPrice ?? null : null,
          quantity: item.pricingMethod === "unit_quantity" ? item.quantity ?? null : null,
          amount: item.pricingMethod === "fixed" ? item.amount : null,
          sourceTask: item.sourceTask || null,
          note: item.note || null
        };
        if (item.id.startsWith("draft-")) {
          await sampleRoomApi.addAdminCustomerCharge(session, row.order.id, payload);
        } else {
          await sampleRoomApi.updateAdminCustomerCharge(
            session,
            row.order.id,
            item.id,
            payload
          );
        }
      }
      await load(true);
      await onChanged();
      if (successMessage) messageApi.success(successMessage);
      return true;
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "定价草稿保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const confirmPricing = async () => {
    if (!row) return;
    if (persistedConfirmed && hasConfirmedSnapshot && !pricingDraftDirty) {
      messageApi.info("报价没有修改");
      onClose();
      return;
    }
    if (!(await persistPricingDrafts())) return;
    const confirmed = await mutate(
      () => sampleRoomApi.confirmAdminOrderPricing(session, row.order.id),
      hasConfirmedSnapshot ? "客户报价更新已确认" : "客户报价已确认"
    );
    if (confirmed) {
      onClose();
    }
  };

  const updateCostDraft = (itemId: string, patch: Partial<InternalCostItem>) => {
    setCostDrafts((current) =>
      current.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
    );
    setPricingDraftDirty(true);
  };

  const updateCustomerDraft = (itemId: string, patch: Partial<CustomerChargeItem>) => {
    setCustomerDrafts((current) =>
      current.map((item) => {
        if (item.id !== itemId) return item;
        const next = { ...item, ...patch };
        return {
          ...next,
          amount:
            next.pricingMethod === "unit_quantity"
              ? Number(next.unitPrice ?? 0) * Number(next.quantity ?? 0)
              : Number(next.amount ?? 0)
        };
      })
    );
    setPricingDraftDirty(true);
  };

  const order = detail?.order ?? row?.order;
  const summary = detail?.summary;
  const activeOtherCharges = otherCharges.filter((charge) => !charge.archivedAt);
  const pricingMethod = Form.useWatch("pricingMethod", customerForm);
  const pricingSourceOptions = [
    { label: "人工新增", value: "人工新增" },
    ...(detail?.orderTasks ?? []).map((task) => ({
      label: task.label,
      value: task.label
    }))
  ];
  const focusNextAmountInput = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Tab" || event.shiftKey) return;
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(
      ".dynamic-pricing-modal .dynamic-pricing-amount-input input:not(:disabled)"
    ));
    const index = inputs.indexOf(event.currentTarget);
    const next = inputs[index + 1];
    if (!next) return;
    event.preventDefault();
    next.focus();
    next.select();
  };

  return (
    <>
      {contextHolder}
      <Modal
        open={open}
        width={viewportBoundDialogWidth("data")}
        className="dynamic-pricing-modal"
        loading={loading}
        onCancel={onClose}
        maskClosable={false}
        keyboard={false}
        closable={false}
        footer={[
          <Button key="cancel" onClick={onClose}>取消</Button>,
          <Button
            key="draft"
            disabled={locked}
            loading={saving}
            onClick={() =>
              void persistPricingDrafts("草稿已保存；待确认的其他费用不会自动计入。")
            }
          >
            保存草稿
          </Button>,
          <Button
            key="confirm"
            type="primary"
            disabled={locked || activeCustomerCharges.length === 0}
            loading={saving}
            onClick={() => void confirmPricing()}
          >
            {hasConfirmedSnapshot ? "确认更新报价" : "确认客户报价"}
          </Button>
        ]}
      >
        <div className="dynamic-pricing-fixed-summary">
          {order ? (
            <BossOrderSummaryHeader
              order={order}
              patternTask={detail?.patternTask}
              loadPreview={(_targetOrder, attachment) =>
                sampleRoomApi.downloadAdminOrderAttachment(session, order.id, attachment.id)
              }
            />
          ) : null}

          {detail?.quotationHasUnconfirmedChanges ? (
            <Alert
              type="warning"
              showIcon
              message="当前其他费用与已锁定报价快照不同；历史报价和已生成对账单不会被覆盖。"
            />
          ) : persistedConfirmed && localConfirmedEdit ? (
            <Alert
              type="info"
              showIcon
              message="正在修改已确认报价；直接取消不会保存任何修改，确认更新后才会生效。"
            />
          ) : hasConfirmedSnapshot ? (
            <Alert
              type="warning"
              showIcon
              message="正在更新报价；客户仍看到上次确认版本，重新确认后才会更新。"
            />
          ) : (
            <Alert type="info" showIcon message="当前为草稿，客户不可见。" />
          )}
        </div>

        <div className="dynamic-pricing-workspace">

        {summary ? (
          <div className="dynamic-pricing-amount-summary">
            <div><span>客户报价小计</span><strong>{yuan(summary.customerQuoteSubtotal)}</strong></div>
            <div><span>其他费用</span><strong>{yuan(summary.confirmedOtherChargeTotal)}</strong></div>
            <div className="primary"><span>应收总额</span><strong>{yuan(summary.receivableTotal)}</strong></div>
            <div><span>内部成本合计</span><strong>{yuan(summary.internalTotalCost)}</strong></div>
            <div><span>预计毛利</span><strong>{yuan(summary.grossProfit)}</strong></div>
            <div><span>毛利率</span><strong>{summary.grossMargin === undefined ? "不适用" : `${summary.grossMargin.toFixed(1)}%`}</strong></div>
          </div>
        ) : null}

        <div className="dynamic-pricing-data-workspace">
        <section className="dynamic-pricing-section dynamic-pricing-internal-cost" aria-label="内部成本">
          <div className="dynamic-pricing-section-title">
            <div>
              <Typography.Text strong>内部成本（客户不可见）</Typography.Text>
              <Typography.Text type="secondary"> 系统推荐与人工新增处于同一层级</Typography.Text>
            </div>
            <Button
              icon={<PlusOutlined />}
              disabled={locked}
              onClick={openCost}
            >
              新增成本项
            </Button>
          </div>
          <Table
            className="dynamic-pricing-internal-cost-table data-workspace-table"
            size="small"
            pagination={false}
            rowKey="id"
            scroll={{ x: 760, y: "100%" }}
            dataSource={activeInternalCosts}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row className="dynamic-pricing-internal-cost-summary">
                  <Table.Summary.Cell index={0}>其他费用</Table.Summary.Cell>
                  <Table.Summary.Cell index={1}>已确认其他费用自动汇总</Table.Summary.Cell>
                  <Table.Summary.Cell index={2}>{yuan(summary?.confirmedOtherChargeTotal ?? 0)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={3}>
                    <Button type="link" onClick={() => setOtherChargeDetailOpen(true)}>
                      查看明细
                    </Button>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4} />
                </Table.Summary.Row>
              </Table.Summary>
            )}
            columns={[
              {
                title: "成本项目",
                width: 150,
                render: (_, item) => (
                  <Select
                    value={item.category}
                    disabled={locked}
                    className="full-width"
                    options={costCategoryOptions}
                    onChange={(category) =>
                      updateCostDraft(item.id, {
                        category,
                        name: costName(category)
                      })
                    }
                  />
                )
              },
              {
                title: "关联任务 / 识别来源",
                width: 210,
                render: (_, item) => (
                  <Input
                    value={item.sourceTask ?? ""}
                    disabled={locked}
                    placeholder={sourceText(item.sourceType)}
                    onChange={(event) =>
                      updateCostDraft(item.id, { sourceTask: event.target.value })
                    }
                  />
                )
              },
              {
                title: "金额",
                width: 140,
                render: (_, item) => (
                  <InputNumber
                    {...decimalInputProps}
                    className="dynamic-pricing-inline-amount dynamic-pricing-amount-input"
                    min={0}
                    precision={2}
                    prefix="¥"
                    placeholder="金额"
                    disabled={locked}
                    value={item.amount === 0 ? null : item.amount}
                    onKeyDown={focusNextAmountInput}
                    onChange={(amount) =>
                      updateCostDraft(item.id, { amount: Number(amount ?? 0) })
                    }
                  />
                )
              },
              {
                title: "说明",
                width: 260,
                render: (_, item) => (
                  <Input
                    className="dynamic-pricing-inline-note"
                    maxLength={500}
                    disabled={locked}
                    placeholder="点击填写说明"
                    value={item.note ?? ""}
                    onChange={(event) =>
                      updateCostDraft(item.id, { note: event.target.value })
                    }
                  />
                )
              },
              {
                title: "操作",
                fixed: "right",
                width: 80,
                render: (_, item) => (
                  <Button
                    type="link"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={locked}
                    onClick={() =>
                      Modal.confirm({
                        title: "删除这个内部成本项目？",
                        content: "只删除定价明细，不会修改订单任务或生产流程。",
                        okButtonProps: { danger: true },
                        onOk: () => {
                          setCostDrafts((current) =>
                            current.filter((candidate) => candidate.id !== item.id)
                          );
                          if (!item.id.startsWith("draft-")) {
                            setDeletedCostIds((current) => [...current, item.id]);
                          }
                          setPricingDraftDirty(true);
                        }
                      })
                    }
                  >
                    删除
                  </Button>
                )
              }
            ]}
          />
        </section>

        <section className="dynamic-pricing-section dynamic-pricing-customer-quotation" aria-label="客户报价">
          <div className="dynamic-pricing-section-title">
            <div>
              <Typography.Text strong>客户报价</Typography.Text>
              <Typography.Text type="secondary"> 正常业务报价收入，参与毛利计算</Typography.Text>
            </div>
            <Button
              icon={<PlusOutlined />}
              disabled={locked}
              onClick={openCustomerCharge}
            >
              新增收费项
            </Button>
          </div>
          <Table
            className="dynamic-pricing-customer-quotation-table data-workspace-table"
            size="small"
            pagination={false}
            rowKey="id"
            scroll={{ x: 940, y: "100%" }}
            locale={{ emptyText: "暂无客户收费项目" }}
            dataSource={activeCustomerCharges}
            columns={[
              {
                title: "收费项目",
                width: 150,
                render: (_, item) => (
                  <Select
                    className="full-width"
                    value={item.name}
                    disabled={locked}
                    options={[...customerChargeNameOptions]}
                    onChange={(name) => updateCustomerDraft(item.id, { name })}
                  />
                )
              },
              {
                title: "说明",
                width: 190,
                render: (_, item) => (
                  <Input
                    value={item.note ?? ""}
                    disabled={locked}
                    placeholder="点击填写说明"
                    onChange={(event) =>
                      updateCustomerDraft(item.id, { note: event.target.value })
                    }
                  />
                )
              },
              {
                title: "关联任务 / 来源",
                width: 180,
                render: (_, item) => (
                  <Select
                    className="full-width"
                    value={item.sourceTask || "人工新增"}
                    disabled={locked}
                    options={pricingSourceOptions}
                    onChange={(sourceTask) =>
                      updateCustomerDraft(item.id, {
                        sourceTask: sourceTask === "人工新增" ? "" : sourceTask
                      })
                    }
                  />
                )
              },
              {
                title: "计价方式",
                width: 120,
                render: (_, item) => (
                  <Select
                    className="full-width"
                    value={item.pricingMethod}
                    disabled={locked}
                    options={[
                      { label: "固定金额", value: "fixed" },
                      { label: "单价 × 数量", value: "unit_quantity" }
                    ]}
                    onChange={(pricingMethod) =>
                      updateCustomerDraft(item.id, {
                        pricingMethod,
                        unitPrice: item.unitPrice ?? 0,
                        quantity: item.quantity ?? 1
                      })
                    }
                  />
                )
              },
              {
                title: "单价",
                width: 120,
                render: (_, item) =>
                  item.pricingMethod === "unit_quantity" ? (
                    <InputNumber
                      {...decimalInputProps}
                      className="dynamic-pricing-amount-input"
                      min={0}
                      precision={2}
                      prefix="¥"
                      placeholder="金额"
                      disabled={locked}
                      value={item.unitPrice ? item.unitPrice : null}
                      onKeyDown={focusNextAmountInput}
                      onChange={(unitPrice) =>
                        updateCustomerDraft(item.id, { unitPrice: Number(unitPrice ?? 0) })
                      }
                    />
                  ) : "-"
              },
              {
                title: "数量",
                width: 90,
                render: (_, item) =>
                  item.pricingMethod === "unit_quantity" ? (
                    <InputNumber
                      {...decimalInputProps}
                      min={0}
                      precision={2}
                      disabled={locked}
                      value={item.quantity ?? 1}
                      onChange={(quantity) =>
                        updateCustomerDraft(item.id, { quantity: Number(quantity ?? 0) })
                      }
                    />
                  ) : "-"
              },
              {
                title: "金额",
                width: 120,
                render: (_, item) =>
                  item.pricingMethod === "fixed" ? (
                    <InputNumber
                      {...decimalInputProps}
                      className="dynamic-pricing-amount-input"
                      min={0}
                      precision={2}
                      prefix="¥"
                      placeholder="金额"
                      disabled={locked}
                      value={item.amount === 0 ? null : item.amount}
                      onKeyDown={focusNextAmountInput}
                      onChange={(amount) =>
                        updateCustomerDraft(item.id, { amount: Number(amount ?? 0) })
                      }
                    />
                  ) : yuan(item.amount)
              },
              {
                title: "操作",
                fixed: "right",
                width: 80,
                render: (_, item) => (
                    <Button
                      type="link"
                      danger
                      disabled={locked}
                      onClick={() =>
                        Modal.confirm({
                          title: "删除这个客户收费项目？",
                          content: "只影响当前定价草稿，不会修改订单任务。",
                          okButtonProps: { danger: true },
                          onOk: () => {
                            setCustomerDrafts((current) =>
                              current.filter((candidate) => candidate.id !== item.id)
                            );
                            if (!item.id.startsWith("draft-")) {
                              setDeletedCustomerIds((current) => [...current, item.id]);
                            }
                            setPricingDraftDirty(true);
                          }
                        })
                      }
                    >
                      删除
                    </Button>
                )
              }
            ]}
          />
        </section>
        </div>
        </div>

      </Modal>

      <Modal
        title={`其他费用明细（${activeOtherCharges.length} 条）`}
        open={open && otherChargeDetailOpen}
        width={1040}
        className="dynamic-pricing-other-charge-modal"
        destroyOnHidden
        footer={<Button onClick={() => setOtherChargeDetailOpen(false)}>关闭</Button>}
        onCancel={() => setOtherChargeDetailOpen(false)}
      >
        <OrderChargeList
          key={row?.order.id}
          charges={activeOtherCharges}
          currentUserId={session.userId}
          canManageAll
          maintenanceDisabled={locked}
          pageSize={5}
          bodyHeight={260}
          onEdit={async (charge, values) => {
            if (!row) return;
            await maintainOtherCharge(() =>
              sampleRoomApi.updateAdminOrderCharge(session, row.order.id, charge.id, values)
            );
          }}
          onDelete={async (charge) => {
            if (!row) return;
            await maintainOtherCharge(() =>
              sampleRoomApi.deleteAdminOrderCharge(session, row.order.id, charge.id)
            );
          }}
          onAddAttachments={async (charge, attachments) => {
            if (!row) return;
            await maintainOtherCharge(() =>
              sampleRoomApi.addOrderChargeAttachments(session, "admin", row.order.id, charge.id, attachments)
            );
          }}
          onRenameAttachment={async (charge, attachmentId, displayName) => {
            if (!row) return;
            await maintainOtherCharge(() =>
              sampleRoomApi.renameOrderChargeAttachment(session, "admin", row.order.id, charge.id, attachmentId, displayName)
            );
          }}
          onDeleteAttachment={async (charge, attachmentId) => {
            if (!row) return;
            await maintainOtherCharge(() =>
              sampleRoomApi.deleteOrderChargeAttachment(session, "admin", row.order.id, charge.id, attachmentId)
            );
          }}
          loadAttachmentBlob={(attachment) => {
            if (!row) return Promise.reject(new Error("当前订单不可用"));
            return sampleRoomApi.downloadAdminOrderAttachment(session, row.order.id, attachment.id);
          }}
        />
      </Modal>

      <Modal
        title={costEditing === "new" ? "新增内部成本" : "编辑内部成本"}
        open={Boolean(costEditing)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        onOk={() => void saveCost()}
        onCancel={() => setCostEditing(undefined)}
      >
        <Form form={costForm} layout="vertical">
          <Form.Item name="category" label="成本分类" rules={[{ required: true }]}>
            <Select options={costCategoryOptions} />
          </Form.Item>
          <Form.Item name="sourceTask" label="关联任务 / 识别来源">
            <Input placeholder="可留空；人工新增时系统仍标识为人工新增" maxLength={120} />
          </Form.Item>
          <Form.Item name="amount" label="金额" rules={[{ required: true }]}>
            <InputNumber {...decimalInputProps} min={0} precision={2} prefix="¥" placeholder="金额" className="full-width dynamic-pricing-amount-input" />
          </Form.Item>
          <Form.Item name="note" label="说明">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={customerEditing === "new" ? "新增客户收费" : "编辑客户收费"}
        open={Boolean(customerEditing)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        onOk={() => void saveCustomerCharge()}
        onCancel={() => setCustomerEditing(undefined)}
      >
        <Form form={customerForm} layout="vertical">
          <Form.Item name="name" label="收费项目" rules={[{ required: true }]}>
            <Select options={[...customerChargeNameOptions]} />
          </Form.Item>
          <Form.Item name="pricingMethod" label="计价方式" rules={[{ required: true }]}>
            <Select
              options={[
                { label: "固定金额", value: "fixed" },
                { label: "单价 × 数量", value: "unit_quantity" }
              ]}
            />
          </Form.Item>
          {pricingMethod === "unit_quantity" ? (
            <Space align="start" className="full-width">
              <Form.Item name="unitPrice" label="单价" rules={[{ required: true }]}>
                <InputNumber {...decimalInputProps} min={0} precision={2} prefix="¥" placeholder="金额" className="dynamic-pricing-amount-input" />
              </Form.Item>
              <Form.Item name="quantity" label="数量" rules={[{ required: true }]}>
                <InputNumber {...decimalInputProps} min={0} precision={2} />
              </Form.Item>
            </Space>
          ) : (
            <Form.Item name="amount" label="固定金额" rules={[{ required: true }]}>
              <InputNumber {...decimalInputProps} min={0} precision={2} prefix="¥" placeholder="金额" className="full-width dynamic-pricing-amount-input" />
            </Form.Item>
          )}
          <Form.Item name="sourceTask" label="关联任务 / 来源">
            <Select options={pricingSourceOptions} />
          </Form.Item>
          <Form.Item name="note" label="说明">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

    </>
  );
}
