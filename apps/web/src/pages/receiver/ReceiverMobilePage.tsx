import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tabs,
  Typography,
  message
} from "antd";
import { DEFAULT_SAMPLE_REQUEST_ITEMS, sampleRequestItemOptions, sampleRoundOptions } from "@sample-room/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  sampleRoomApi,
  type AttachmentMetadataInput,
  type MaterialStatus,
  type OrderAttachment,
  type OrderRecord,
  type PatternStatus,
  type ReceiverCorrectionPayload,
  type ReceiverSelfEntryCustomer,
  type SelfEntryPayload,
  type TrackingPatchPayload
} from "../../api/sampleRoomApi";
import { useDevSession } from "../../app/DevSessionContext";
import { useSampleTypeOptions } from "../../app/SampleTypeOptionsContext";
import { useVisibleAutoRefresh } from "../../hooks/useVisibleAutoRefresh";
import {
  fabricOptions,
  IntakeTag,
  MaterialTag,
  trimOptions
} from "../../components/StatusTags";
import {
  MobileOrderActionRow,
  MobileOrderKeyGrid,
  MobileOrderSecondaryBlock,
  MobileOrderStatusBlock,
  MobileOrderTitleBlock
} from "../../components/orders/MobileOrderCardParts";
import { OrderMobileFilterBar } from "../../components/orders/OrderMobileFilterBar";
import {
  formatDeliveryDate,
  formatEntryDate,
  getOrderBusinessUserName,
  getOrderCustomerName
} from "../../components/orders/orderDisplay";
import {
  defaultOrderFilters,
  createCurrentMonthOrderFilters,
  filterOrders,
  type OrderFilters
} from "../../components/orders/orderFilters";
import {
  ReceiverCorrectionModal,
  type ReceiverCorrectionSubmitOptions
} from "../../components/orders/ReceiverCorrectionModal";
import { createDefaultReceiverSelfEntryValues } from "../../utils/orderFormDefaults";
import { ReceiverSelfEntryAttachmentFields } from "./ReceiverSelfEntryAttachmentFields";
import { ParallelProgress } from "../../components/operations/ParallelProgress";
import { OrderCompletionTag } from "../../components/operations/OrderCompletionStatus";
import { PatternTaskStatusBadges } from "../../components/operations/PatternTaskStatusBadges";
import { MobileScanChargePanel } from "../../components/orders/MobileScanChargePanel";

type MobileTab = "list" | "self-entry" | "scan-charge";

function getReceiverMobileTabDefaultFilters(tab: MobileTab): OrderFilters {
  return tab === "list" ? createCurrentMonthOrderFilters() : { ...defaultOrderFilters };
}

function optionLabel(options: Array<{ label: string; value: string }>, value?: string) {
  return options.find((option) => option.value === value)?.label ?? "-";
}

function MobileOrderCard({ order, extra, onClick, sampleTypeLabel }: { order: OrderRecord; extra?: ReactNode; onClick?: () => void; sampleTypeLabel: (code: string) => string }) {
  return (
    <Card size="small" className="mobile-order-card" hoverable={Boolean(onClick)} onClick={onClick}>
      <Space direction="vertical" size={8} className="full-width">
        <MobileOrderTitleBlock styleNo={order.styleNo} styleName={order.styleName} />
        <MobileOrderStatusBlock>
          <IntakeTag value={order.intakeStatus} />
          <OrderCompletionTag
            sampleRequestItems={order.sampleRequestItems}
            stage={order.stage}
            {...(order.completionStatus ? { completionStatus: order.completionStatus } : {})}
            {...(order.patternTask ? { patternTask: order.patternTask } : {})}
          />
          <PatternTaskStatusBadges
            sampleRequestItems={order.sampleRequestItems}
            patternTask={order.patternTask}
            maxRows={2}
          />
          <span className="mobile-status-labeled">
            <span>面里料</span>
            <MaterialTag value={order.fabricStatus} />
          </span>
          <span className="mobile-status-labeled">
            <span>辅料</span>
            <MaterialTag value={order.trimStatus} />
          </span>
        </MobileOrderStatusBlock>
        <MobileOrderKeyGrid
          items={[
            { label: "数量", value: order.quantity },
            { label: "客户", value: getOrderCustomerName(order) },
            { label: "业务员", value: getOrderBusinessUserName(order) },
            { label: "样品类型", value: sampleTypeLabel(order.sampleType) },
            { label: "样品轮次", value: optionLabel(sampleRoundOptions, order.sampleRound) },
            { label: "接单日期", value: formatEntryDate(order.createdAt), wide: true }
          ]}
        />
        {order.returnReason ? (
          <Card size="small" className="return-reason-card">
            <Typography.Text strong>退回原因：</Typography.Text>
            <Typography.Text>{order.returnReason}</Typography.Text>
          </Card>
        ) : null}
        {order.remark ? (
          <MobileOrderSecondaryBlock>
            <Typography.Text type="secondary">{order.remark}</Typography.Text>
          </MobileOrderSecondaryBlock>
        ) : null}
        <MobileOrderActionRow>{extra}</MobileOrderActionRow>
      </Space>
    </Card>
  );
}

export function ReceiverMobilePage() {
  const { session } = useDevSession();
  const { options: sampleTypeOptions, labelFor: sampleTypeLabel } = useSampleTypeOptions();
  const [searchParams] = useSearchParams();
  const scanToken = searchParams.get("scanToken") ?? undefined;
  const [activeTab, setActiveTab] = useState<MobileTab>("self-entry");
  const [filters, setFilters] = useState<OrderFilters>(() => getReceiverMobileTabDefaultFilters("self-entry"));
  const [pendingOrders, setPendingOrders] = useState<OrderRecord[]>([]);
  const [trackingOrders, setTrackingOrders] = useState<OrderRecord[]>([]);
  const [allOrders, setAllOrders] = useState<OrderRecord[]>([]);
  const [selfEntryCustomers, setSelfEntryCustomers] = useState<ReceiverSelfEntryCustomer[]>([]);
  const [returningOrder, setReturningOrder] = useState<OrderRecord | null>(null);
  const [editingOrder, setEditingOrder] = useState<OrderRecord | null>(null);
  const [correctingOrder, setCorrectingOrder] = useState<OrderRecord | null>(null);
  const [viewingOrder, setViewingOrder] = useState<OrderRecord | null>(null);
  const [trackingDraft, setTrackingDraft] = useState<TrackingPatchPayload>({});
  const [selfEntryAttachments, setSelfEntryAttachments] = useState<AttachmentMetadataInput[]>([]);
  const [selfEntryAttachmentOpenSignal, setSelfEntryAttachmentOpenSignal] = useState(0);
  const [selfEntryAttachmentVisibility, setSelfEntryAttachmentVisibility] =
    useState<OrderAttachment["visibility"]>("client_visible");
  const [selfEntrySubmitting, setSelfEntrySubmitting] = useState(false);
  const [lastSelfEntryOrder, setLastSelfEntryOrder] = useState<OrderRecord | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    if (scanToken) setActiveTab("scan-charge");
  }, [scanToken]);
  const [selfEntryForm] = Form.useForm<SelfEntryPayload>();
  const selectedSampleRequestItems = Form.useWatch("sampleRequestItems", selfEntryForm) ?? DEFAULT_SAMPLE_REQUEST_ITEMS;
  const [returnForm] = Form.useForm<{ returnReason: string }>();
  const selectedCustomerId = Form.useWatch("customerId", selfEntryForm);
  const defaultSelfEntryValues = useMemo(() => createDefaultReceiverSelfEntryValues(), []);

  const customerOptions = useMemo(
    () =>
      selfEntryCustomers.map((customer) => ({
        label: customer.name,
        value: customer.id
      })),
    [selfEntryCustomers]
  );

  const loadOrders = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      const [pending, tracking, all, selfEntryOptions] = await Promise.all([
        sampleRoomApi.listPendingReceive(session),
        sampleRoomApi.listTracking(session),
        sampleRoomApi.listReceiverOrders(session),
        sampleRoomApi.listReceiverSelfEntryOptions(session)
      ]);
      setPendingOrders(pending.orders);
      setTrackingOrders(tracking.orders);
      setAllOrders(all.orders);
      setSelfEntryCustomers(selfEntryOptions.customers);
    } catch (error) {
      if (!silent) messageApi.error(error instanceof Error ? error.message : "加载手机端接单数据失败");
    }
  }, [messageApi, session]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useVisibleAutoRefresh(() => loadOrders({ silent: true }));

  const clientUserOptions = useMemo(() => {
    const selectedCustomer =
      selfEntryCustomers.find((customer) => customer.id === selectedCustomerId) ??
      selfEntryCustomers[0];

    return (
      selectedCustomer?.clientUsers.map((clientUser) => ({
        label: clientUser.displayName,
        value: clientUser.id
      })) ?? []
    );
  }, [selectedCustomerId, selfEntryCustomers]);

  const filteredPendingOrders = useMemo(
    () => filterOrders(pendingOrders, filters),
    [pendingOrders, filters]
  );
  const completeReceiverOrders = useMemo(
    () => allOrders.filter((order) => order.intakeStatus === "received"),
    [allOrders]
  );
  const filteredAllOrders = useMemo(
    () => filterOrders(completeReceiverOrders, filters),
    [completeReceiverOrders, filters]
  );

  const changeTab = (key: string) => {
    const nextTab = key as MobileTab;
    setActiveTab(nextTab);
    setFilters(getReceiverMobileTabDefaultFilters(nextTab));
  };

  const openReturn = (order: OrderRecord) => {
    setReturningOrder(order);
    returnForm.setFieldsValue({ returnReason: "" });
  };

  const submitReturn = async () => {
    if (!returningOrder) {
      return;
    }

    const values = await returnForm.validateFields();
    await sampleRoomApi.returnOrder(session, returningOrder.id, values);
    messageApi.success("已退回补充");
    setReturningOrder(null);
    await loadOrders();
  };

  const openTrackingEdit = (order: OrderRecord) => {
    setEditingOrder(order);
    setTrackingDraft({
      fabricStatus: order.fabricStatus,
      trimStatus: order.trimStatus,
      ...(order.remark ? { remark: order.remark } : {})
    });
  };

  const submitTrackingPatch = async () => {
    if (!editingOrder) {
      return;
    }

    await sampleRoomApi.updateTracking(session, editingOrder.id, trackingDraft);
    messageApi.success("手机端状态已更新");
    setEditingOrder(null);
    setTrackingDraft({});
    await loadOrders();
  };

  const submitCorrection = async (
    values: ReceiverCorrectionPayload,
    options: ReceiverCorrectionSubmitOptions
  ) => {
    if (!correctingOrder) {
      return;
    }

    await sampleRoomApi.correctReceiverOrder(session, correctingOrder.id, values);
    if (options.thumbnailAttachments.length > 0) {
      await sampleRoomApi.addReceiverOrderAttachments(
        session,
        correctingOrder.id,
        options.thumbnailAttachments
      );
    }

    if (options.intent === "complete" && correctingOrder.intakeStatus === "pending_receive") {
      await sampleRoomApi.acceptOrder(session, correctingOrder.id, {
        patternStatus: (values.patternStatus ?? correctingOrder.patternStatus) as PatternStatus,
        fabricStatus: (values.fabricStatus ?? correctingOrder.fabricStatus) as MaterialStatus,
        trimStatus: (values.trimStatus ?? correctingOrder.trimStatus) as MaterialStatus
      });
      messageApi.success("已完成校正，订单进入订单列表");
    } else {
      messageApi.success(options.intent === "draft" ? "已保存校正草稿" : "手机端订单资料已校正");
    }
    setCorrectingOrder(null);
    await loadOrders();
  };

  const loadReceiverOrderAttachmentPreview = (order: OrderRecord, attachment: OrderAttachment) =>
    sampleRoomApi.downloadReceiverOrderAttachment(session, order.id, attachment.id);

  const uploadReceiverSampleSheet = async (
    order: OrderRecord,
    attachment: AttachmentMetadataInput
  ) => {
    const created = await sampleRoomApi.addReceiverOrderAttachments(session, order.id, [attachment]);
    const uploaded = created.attachments[0];
    if (!uploaded) throw new Error("文件上传失败");
    return (
      await sampleRoomApi.selectReceiverSampleSheetAttachment(session, order.id, uploaded.id)
    ).attachments;
  };

  const selectReceiverSampleSheet = async (order: OrderRecord, attachmentId: string) =>
    (
      await sampleRoomApi.selectReceiverSampleSheetAttachment(session, order.id, attachmentId)
    ).attachments;

  const submitSelfEntry = async (values: SelfEntryPayload) => {
    setSelfEntrySubmitting(true);
    try {
      const created = await sampleRoomApi.createSelfEntry(session, {
        ...values,
        patternStatus: "none"
      });
      setLastSelfEntryOrder(created.order);

      if (selfEntryAttachments.length > 0) {
        try {
          await sampleRoomApi.addReceiverOrderAttachments(
            session,
            created.order.id,
            selfEntryAttachments.map((attachment) => ({
              ...attachment,
              visibility: selfEntryAttachmentVisibility
            }))
          );
          messageApi.success("手机端自主录入成功，附件已上传");
        } catch {
          messageApi.warning("订单已创建，但部分附件上传失败，请稍后在订单详情中补传。");
        }
      } else {
        messageApi.success("手机端自主录入成功");
      }

      selfEntryForm.resetFields();
      setSelfEntryAttachments([]);
      setSelfEntryAttachmentVisibility("client_visible");
      await loadOrders();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "手机端自主录入失败");
    } finally {
      setSelfEntrySubmitting(false);
    }
  };

  const fillReceiverQuickPhotoDraft = () => {
    const stamp = new Date().toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).replace(/[^\d]/g, "");
    selfEntryForm.setFieldsValue({
      ...defaultSelfEntryValues,
      styleNo: `待补款号-${stamp}`,
      styleName: "待补款名",
      quantity: 1,
      remark: "接单员手机先拍照简录，后续根据打样单照片/实物在校正资料中补齐。"
    });
    setSelfEntryAttachmentOpenSignal((signal) => signal + 1);
    messageApi.info("已填入拍照简录占位信息，请拍照或从相册选择打样单。");
  };

  const canMaintainTrackingOrder = (order: OrderRecord) =>
    order.intakeStatus === "received" && order.stage !== null && order.stage !== "done";

  const pendingList = (
    <Space direction="vertical" size={12} className="full-width">
      <OrderMobileFilterBar orders={pendingOrders} filters={filters} onChange={setFilters} />
      {filteredPendingOrders.map((order) => (
        <MobileOrderCard
          key={order.id}
          order={order}
          sampleTypeLabel={sampleTypeLabel}
          extra={
            <Space wrap>
              <Button type="primary" onClick={() => setCorrectingOrder(order)}>
                校正资料
              </Button>
              {order.sourceType === "client_submission" ? (
                <Button onClick={() => openReturn(order)}>退回</Button>
              ) : null}
            </Space>
          }
        />
      ))}
      {filteredPendingOrders.length === 0 ? <Card size="small">暂无待接单</Card> : null}
    </Space>
  );

  const orderList = (
    <Space direction="vertical" size={12} className="full-width">
      <OrderMobileFilterBar
        orders={allOrders}
        filters={filters}
        onChange={setFilters}
        defaultFilters={getReceiverMobileTabDefaultFilters("list")}
      />
      {filteredAllOrders.map((order) => (
        <MobileOrderCard
          key={order.id}
          order={order}
          sampleTypeLabel={sampleTypeLabel}
          onClick={() => setViewingOrder(order)}
        />
      ))}
      {filteredAllOrders.length === 0 ? <Card size="small">暂无订单</Card> : null}
    </Space>
  );

  return (
    <div className="mobile-page">
      {contextHolder}
      <Card className="mobile-title-card">
        <Typography.Title level={3}>接单员手机端</Typography.Title>
        <Typography.Text type="secondary">
          手机端用于现场拍照录入、只读浏览订单和扫描费用；资料校正与账号安全在 Web 端完成。
        </Typography.Text>
        <div className="mobile-task-room-steps" aria-label="接单员手机端主流程">
          <span>现场录入</span>
          <span>订单</span>
          <span>扫描费用</span>
        </div>
      </Card>

      <Tabs
        activeKey={activeTab}
        onChange={changeTab}
        className="mobile-tabs"
        items={[
          { key: "list", label: `订单 ${completeReceiverOrders.length}`, children: orderList },
          {
            key: "self-entry",
            label: "现场录入",
            children: (
              <Card size="small">
                <Typography.Paragraph type="secondary" className="mobile-self-entry-note">
                  可先拍照上传打样单，填写少量必填信息创建订单；有空后再用校正资料补齐。
                </Typography.Paragraph>
                {lastSelfEntryOrder ? (
                  <Alert
                    type="success"
                    showIcon
                    className="mobile-self-entry-note"
                    message={`已创建订单：${lastSelfEntryOrder.styleNo}`}
                    description={`${lastSelfEntryOrder.styleName} / ${getOrderCustomerName(lastSelfEntryOrder)} / ${getOrderBusinessUserName(lastSelfEntryOrder)} / ${lastSelfEntryOrder.quantity} 件`}
                  />
                ) : null}
                <Form
                  form={selfEntryForm}
                  layout="vertical"
                  onFinish={submitSelfEntry}
                  initialValues={defaultSelfEntryValues}
                >
                  <Form.Item label="客户" name="customerId" rules={[{ required: true }]}>
                    <Select
                      options={customerOptions}
                      onChange={(customerId) => {
                        const firstClientUser =
                          selfEntryCustomers.find((customer) => customer.id === customerId)?.clientUsers[0]?.id ??
                          "mock-client-user-active";
                        selfEntryForm.setFieldValue("clientUserId", firstClientUser);
                      }}
                    />
                  </Form.Item>
                  <Form.Item label="业务员" name="clientUserId" rules={[{ required: true }]}>
                    <Select options={clientUserOptions} />
                  </Form.Item>
                  <Form.Item label="面里料状态" name="fabricStatus" rules={[{ required: true }]}>
                    <Select options={fabricOptions} />
                  </Form.Item>
                  <Form.Item label="辅料状态" name="trimStatus" rules={[{ required: true }]}>
                    <Select options={trimOptions} />
                  </Form.Item>
                  <Form.Item label="打样要求" name="sampleRequestItems" rules={[{ required: true }]}>
                    <Checkbox.Group className="receiver-correction-sample-request-grid" options={sampleRequestItemOptions} />
                  </Form.Item>
                  <ParallelProgress compact sampleRequestItems={selectedSampleRequestItems} stage={null} />
                  <Form.Item label="款号" name="styleNo" rules={[{ required: true }]}>
                    <Input placeholder="SELF-M-001" />
                  </Form.Item>
                  <Form.Item label="款名" name="styleName" rules={[{ required: true }]}>
                    <Input placeholder="手机端录入样衣" />
                  </Form.Item>
                  <Form.Item label="数量" name="quantity" rules={[{ required: true }]}>
                    <InputNumber min={1} className="full-width" />
                  </Form.Item>
                  <Form.Item label="样品类型" name="sampleType" rules={[{ required: true }]}>
                    <Select options={sampleTypeOptions} />
                  </Form.Item>
                  <Form.Item label="样品轮次" name="sampleRound" rules={[{ required: true }]}>
                    <Select options={sampleRoundOptions} />
                  </Form.Item>
                  <Form.Item label="期望交期" name="deliveryDate" rules={[{ required: true }]}>
                    <Input type="date" />
                  </Form.Item>
                  <Form.Item label="备注" name="remark">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <ReceiverSelfEntryAttachmentFields
                    attachments={selfEntryAttachments}
                    visibility={selfEntryAttachmentVisibility}
                    autoOpenSignal={selfEntryAttachmentOpenSignal}
                    autoOpenTarget="camera"
                    onAttachmentsChange={setSelfEntryAttachments}
                    onVisibilityChange={setSelfEntryAttachmentVisibility}
                  />
                  <Button onClick={fillReceiverQuickPhotoDraft} block>
                    拍照简录
                  </Button>
                  <Button type="primary" htmlType="submit" block loading={selfEntrySubmitting}>
                    创建订单
                  </Button>
                </Form>
              </Card>
            )
          },
          { key: "scan-charge", label: "扫描费用", children: <MobileScanChargePanel role="receiver" {...(scanToken ? { initialToken: scanToken } : {})} /> }
        ]}
      />

      <Modal
        title={viewingOrder ? `订单详情 · ${viewingOrder.styleNo}` : "订单详情"}
        open={Boolean(viewingOrder)}
        onCancel={() => setViewingOrder(null)}
        footer={<Button onClick={() => setViewingOrder(null)}>关闭</Button>}
      >
        {viewingOrder ? (
          <Space direction="vertical" size={12} className="full-width">
            <Alert type="info" showIcon message="手机端订单详情为只读页面" />
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="款号 / 款名">{viewingOrder.styleNo} / {viewingOrder.styleName}</Descriptions.Item>
              <Descriptions.Item label="客户 / 业务员">{getOrderCustomerName(viewingOrder)} / {getOrderBusinessUserName(viewingOrder)}</Descriptions.Item>
              <Descriptions.Item label="数量">{viewingOrder.quantity}</Descriptions.Item>
              <Descriptions.Item label="接单日期">{formatEntryDate(viewingOrder.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="样品类型 / 轮次">{sampleTypeLabel(viewingOrder.sampleType)} / {optionLabel(sampleRoundOptions, viewingOrder.sampleRound)}</Descriptions.Item>
            </Descriptions>
            <PatternTaskStatusBadges sampleRequestItems={viewingOrder.sampleRequestItems} patternTask={viewingOrder.patternTask} maxRows={2} />
          </Space>
        ) : null}
      </Modal>

      <Modal
        title="退回客户补充"
        open={Boolean(returningOrder)}
        onCancel={() => setReturningOrder(null)}
        onOk={() => void submitReturn()}
        okText="确认退回"
        cancelText="取消"
      >
        <Form form={returnForm} layout="vertical">
          <Form.Item label="退回原因" name="returnReason" rules={[{ required: true }]}>
            <Input.TextArea rows={4} placeholder="说明需要客户补充的资料" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="手机端维护状态"
        open={Boolean(editingOrder)}
        onCancel={() => setEditingOrder(null)}
        onOk={() => void submitTrackingPatch()}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" size={12} className="full-width">
          <Typography.Text>面里料状态</Typography.Text>
          <Select
            value={trackingDraft.fabricStatus ?? null}
            options={fabricOptions}
            onChange={(fabricStatus) =>
              setTrackingDraft((draft) => ({ ...draft, fabricStatus: fabricStatus as MaterialStatus }))
            }
            className="full-width"
          />
          <Typography.Text>辅料状态</Typography.Text>
          <Select
            value={trackingDraft.trimStatus ?? null}
            options={trimOptions}
            onChange={(trimStatus) =>
              setTrackingDraft((draft) => ({ ...draft, trimStatus: trimStatus as MaterialStatus }))
            }
            className="full-width"
          />
        </Space>
      </Modal>

      <ReceiverCorrectionModal
        order={correctingOrder}
        open={Boolean(correctingOrder)}
        onCancel={() => setCorrectingOrder(null)}
        onSubmit={submitCorrection}
        onLoadAttachmentPreview={loadReceiverOrderAttachmentPreview}
        currentUserId={session.userId}
        onUploadSampleSheet={uploadReceiverSampleSheet}
        onSelectSampleSheet={selectReceiverSampleSheet}
      />
    </div>
  );
}
