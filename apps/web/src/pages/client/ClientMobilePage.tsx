import {
  Button,
  Card,
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
import { CLIENT_ACCESS_SCOPES, sampleRoundOptions, type ClientAccessScope } from "@sample-room/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  sampleRoomApi,
  type AttachmentMetadataInput,
  type ClientBusinessUser,
  type ClientOrder,
  type ClientOrderAttachment,
  type ClientOrderPatternTask,
  type ClientQuotation,
  type SupplementOrderPayload
} from "../../api/sampleRoomApi";
import { useDevSession } from "../../app/DevSessionContext";
import { useSampleTypeOptions } from "../../app/SampleTypeOptionsContext";
import { useVisibleAutoRefresh } from "../../hooks/useVisibleAutoRefresh";
import {
  AttachmentSummary,
  ClientAttachmentPicker
} from "../../components/ClientAttachmentPicker";
import { IntakeTag } from "../../components/StatusTags";
import { OrderCompletionTag } from "../../components/operations/OrderCompletionStatus";
import { PatternTaskStatusBadges } from "../../components/operations/PatternTaskStatusBadges";
import { ClientOrderMobileFilterBar } from "../../components/orders/ClientOrderMobileFilterBar";
import { ClientAdminStatistics } from "../../components/orders/ClientAdminStatistics";
import { ClientBusinessUserRegistrationCard } from "../../components/ClientBusinessUserRegistrationCard";
import {
  MobileOrderActionRow,
  MobileOrderKeyGrid,
  MobileOrderStatusBlock,
  MobileOrderTitleBlock
} from "../../components/orders/MobileOrderCardParts";
import {
  formatDeliveryDate,
  formatEntryDate,
  getOrderBusinessUserName
} from "../../components/orders/orderDisplay";
import {
  defaultOrderFilters,
  filterOrders,
  type OrderFilters
} from "../../components/orders/orderFilters";
import { ClientQuickPhotoIntake } from "./ClientQuickIntakePanel";
import { OrderAttachmentThumbnail } from "../../components/orders/OrderAttachmentThumbnail";
import { ClientOrderOverview } from "../../components/client/ClientOrderOverview";
import { downloadBlob } from "../../utils/downloadBlob";

function optionLabel(options: Array<{ label: string; value: string }>, value?: string) {
  return options.find((option) => option.value === value)?.label ?? "-";
}

function ClientMobileOrderCard({
  order,
  onSupplement,
  quotation,
  sampleTypeLabel,
  onLoadThumbnail,
  onDownloadAttachment,
  onDownloadDeliverable
}: {
  order: ClientOrder;
  onSupplement?: (order: ClientOrder) => void;
  quotation?: ClientQuotation | null;
  sampleTypeLabel: (code: string) => string;
  onLoadThumbnail: (order: ClientOrder, attachment: ClientOrderAttachment) => Promise<Blob>;
  onDownloadAttachment: (attachment: ClientOrderAttachment) => Promise<void>;
  onDownloadDeliverable: (
    deliverable: ClientOrderPatternTask["deliverables"][number]
  ) => Promise<void>;
}) {
  return (
    <Card size="small" className="mobile-order-card">
      <Space direction="vertical" size={8} className="full-width">
        <OrderAttachmentThumbnail order={order} loadPreview={onLoadThumbnail} />
        <MobileOrderTitleBlock
          styleNo={order.styleNo}
          styleName={order.styleName}
          extra={<AttachmentSummary count={order.attachmentCount ?? 0} />}
        />
        <MobileOrderStatusBlock>
          <IntakeTag value={order.intakeStatus} />
          <OrderCompletionTag
            simplified
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
        </MobileOrderStatusBlock>
        <MobileOrderKeyGrid
          items={[
            { label: "数量", value: order.quantity },
            { label: "业务员", value: getOrderBusinessUserName(order) },
            { label: "样品类型", value: sampleTypeLabel(order.sampleType) },
            { label: "样品轮次", value: optionLabel(sampleRoundOptions, order.sampleRound) },
            { label: "交期", value: formatDeliveryDate(order.deliveryDate) },
            { label: "录入", value: formatEntryDate(order.createdAt) }
          ]}
        />
        {order.returnReason ? (
          <Card size="small" className="return-reason-card">
            <Typography.Text strong>退回原因：</Typography.Text>
            <Typography.Text>{order.returnReason}</Typography.Text>
          </Card>
        ) : null}
        <ClientOrderOverview order={order} quotation={quotation ?? null} onDownloadAttachment={onDownloadAttachment} onDownloadDeliverable={onDownloadDeliverable} />
        {onSupplement && order.intakeStatus === "needs_client_supplement" ? (
          <MobileOrderActionRow>
            <Button type="primary" onClick={() => onSupplement(order)} block>
              补充资料
            </Button>
          </MobileOrderActionRow>
        ) : null}
      </Space>
    </Card>
  );
}

export function ClientMobilePage() {
  const { session } = useDevSession();
  const { options: sampleTypeOptions, labelFor: sampleTypeLabel } = useSampleTypeOptions();
  const [orders, setOrders] = useState<ClientOrder[]>([]);
  const [clientUsers, setClientUsers] = useState<ClientBusinessUser[]>([]);
  const [clientAccessScope, setClientAccessScope] = useState<ClientAccessScope>(
    session.clientAccessScope ?? CLIENT_ACCESS_SCOPES.own
  );
  const [loading, setLoading] = useState(false);
  const [quotations, setQuotations] = useState<Record<string, ClientQuotation | null>>({});
  const [activeTab, setActiveTab] = useState("orders");
  const [supplementAttachments, setSupplementAttachments] = useState<AttachmentMetadataInput[]>([]);
  const [supplementingOrder, setSupplementingOrder] = useState<ClientOrder | null>(null);
  const [filters, setFilters] = useState<OrderFilters>({ ...defaultOrderFilters });
  const [messageApi, contextHolder] = message.useMessage();
  const [supplementForm] = Form.useForm<SupplementOrderPayload>();

  const loadOrders = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const result = await sampleRoomApi.listClientOrders(session);
      setOrders(result.orders);
      setClientUsers(result.clientUsers);
      setClientAccessScope(result.clientAccessScope);
      const quotationEntries = await Promise.all(result.orders.map(async (order) => {
        try {
          const response = await sampleRoomApi.getClientOrderQuotation(session, order.id);
          return [order.id, response.quotation] as const;
        } catch {
          return [order.id, null] as const;
        }
      }));
      setQuotations(Object.fromEntries(quotationEntries));
    } catch (error) {
      if (!silent) messageApi.error(error instanceof Error ? error.message : "加载我的款式失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [messageApi, session]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useVisibleAutoRefresh(() => loadOrders({ silent: true }));

  const isCustomerAll = clientAccessScope === CLIENT_ACCESS_SCOPES.customerAll;

  useEffect(() => {
    setFilters({ ...defaultOrderFilters });
    setActiveTab("orders");
  }, [session.clientAccessScope, session.clientUserId, session.customerId]);

  const changeTab = (key: string) => {
    setActiveTab(key);
    setFilters({ ...defaultOrderFilters });
  };

  const filteredOrders = useMemo(() => filterOrders(orders, filters), [orders, filters]);
  const sortedOrders = useMemo(
    () => [...filteredOrders].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [filteredOrders]
  );
  const businessUserOptions = useMemo(
    () =>
      isCustomerAll
        ? clientUsers.map((clientUser) => ({
            label: clientUser.displayName,
            value: clientUser.id
          }))
        : [],
    [clientUsers, isCustomerAll]
  );

  const openSupplement = (order: ClientOrder) => {
    setSupplementingOrder(order);
    setSupplementAttachments([]);
    supplementForm.setFieldsValue({
      styleNo: order.styleNo,
      styleName: order.styleName,
      quantity: order.quantity,
      sampleType: order.sampleType,
      sampleRound: order.sampleRound,
      deliveryDate: order.deliveryDate,
      remark: order.remark ?? ""
    });
  };

  const submitSupplement = async () => {
    if (!supplementingOrder) {
      return;
    }

    const values = await supplementForm.validateFields();
    await sampleRoomApi.supplementClientOrder(session, supplementingOrder.id, {
      ...values,
      attachments: supplementAttachments
    });
    messageApi.success("补充资料已提交，订单重新回到待接单。");
    setSupplementingOrder(null);
    setSupplementAttachments([]);
    await loadOrders();
  };

  const loadThumbnail = (order: ClientOrder, attachment: ClientOrderAttachment) =>
    sampleRoomApi.downloadClientOrderAttachment(session, order.id, attachment.id);

  const downloadAttachment = async (order: ClientOrder, attachment: ClientOrderAttachment) => {
    const blob = await sampleRoomApi.downloadClientOrderAttachment(session, order.id, attachment.id);
    downloadBlob(blob, attachment.fileName);
  };

  const downloadPatternDeliverable = async (
    order: ClientOrder,
    deliverable: ClientOrderPatternTask["deliverables"][number]
  ) => {
    const blob = await sampleRoomApi.downloadClientPatternDeliverable(session, order.id, deliverable.id);
    downloadBlob(blob, deliverable.fileName ?? `${deliverable.version}-${deliverable.type}`);
  };

  return (
    <div className="mobile-page">
      {contextHolder}
      <Card className="mobile-title-card">
        <Typography.Title level={3}>客户手机端</Typography.Title>
        <Typography.Text type="secondary">
          {isCustomerAll
            ? "主管账号用于查看和筛选同客户订单，不能创建打样需求。"
            : "先拍照或上传截图生成订单，接单员后续会补齐资料。"}
        </Typography.Text>
        {!isCustomerAll ? (
          <div className="mobile-task-room-steps" aria-label="客户手机端主流程">
            <span>拍照录入</span>
            <span>提交待接单</span>
            <span>接单员补齐</span>
          </div>
        ) : (
          <div className="mobile-task-room-steps" aria-label="客户主管手机端主流程">
            <span>订单筛选</span>
            <span>业务员统计</span>
            <span>账号申请</span>
          </div>
        )}
      </Card>

      <Tabs
        activeKey={activeTab}
        onChange={changeTab}
        className="mobile-tabs"
        items={[
          {
            key: "orders",
            label: `我的款式 ${filteredOrders.length}/${orders.length}`,
            children: (
              <Space direction="vertical" size={12} className="full-width">
                <ClientOrderMobileFilterBar
                  filters={filters}
                  onChange={setFilters}
                  businessUserOptions={businessUserOptions}
                />
                {isCustomerAll ? (
                  <ClientAdminStatistics orders={filteredOrders} variant="mobile" />
                ) : null}
                {isCustomerAll ? (
                  <Card size="small">
                    <Typography.Text type="secondary">
                      主管账号仅用于查看和筛选订单，不能创建打样需求。
                    </Typography.Text>
                  </Card>
                ) : null}
                {sortedOrders.map((order) => (
                  isCustomerAll ? (
                    <ClientMobileOrderCard
                      key={order.id}
                      order={order}
                      quotation={quotations[order.id] ?? null}
                      sampleTypeLabel={sampleTypeLabel}
                      onLoadThumbnail={loadThumbnail}
                      onDownloadAttachment={(attachment) => downloadAttachment(order, attachment)}
                      onDownloadDeliverable={(deliverable) => downloadPatternDeliverable(order, deliverable)}
                    />
                  ) : (
                    <ClientMobileOrderCard
                      key={order.id}
                      order={order}
                      onSupplement={openSupplement}
                      quotation={quotations[order.id] ?? null}
                      sampleTypeLabel={sampleTypeLabel}
                      onLoadThumbnail={loadThumbnail}
                      onDownloadAttachment={(attachment) => downloadAttachment(order, attachment)}
                      onDownloadDeliverable={(deliverable) => downloadPatternDeliverable(order, deliverable)}
                    />
                  )
                ))}
                {sortedOrders.length === 0 ? (
                  <Card size="small" loading={loading}>
                    暂无款式
                  </Card>
                ) : null}
              </Space>
            )
          }
        ].concat(
          isCustomerAll
            ? [
                {
                  key: "registration",
                  label: "业务员注册",
                  children: <ClientBusinessUserRegistrationCard />
                }
              ]
            : [
                {
                  key: "new",
                  label: "拍照录入",
                  children: (
                    <ClientQuickPhotoIntake
                      session={session}
                      compact
                      onCreated={async () => {
                        await loadOrders();
                        setActiveTab("orders");
                      }}
                    />
                  )
                }
              ]
        )}
      />

      <Modal
        title="补充资料"
        open={Boolean(supplementingOrder)}
        onCancel={() => setSupplementingOrder(null)}
        onOk={() => void submitSupplement()}
        okText="重新提交"
        cancelText="取消"
      >
        {supplementingOrder?.returnReason ? (
          <Card size="small" className="return-reason-card">
            <Typography.Text strong>退回原因：</Typography.Text>
            <Typography.Text>{supplementingOrder.returnReason}</Typography.Text>
          </Card>
        ) : null}
        <Form form={supplementForm} layout="vertical" className="modal-form">
          <Form.Item label="款号" name="styleNo" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="款名" name="styleName" rules={[{ required: true }]}>
            <Input />
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
          <Form.Item label="新增附件/拍照">
            <ClientAttachmentPicker
              value={supplementAttachments}
              onChange={setSupplementAttachments}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
