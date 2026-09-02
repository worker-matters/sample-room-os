import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Typography,
  message
} from "antd";
import { CLIENT_ACCESS_SCOPES, sampleRoundOptions, type ClientAccessScope } from "@sample-room/shared";
import { useCallback, useEffect, useMemo, useState, type Key } from "react";
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
import { ClientAttachmentPicker } from "../../components/ClientAttachmentPicker";
import { OrderTable } from "../../components/OrderTable";
import { OrderExportDialog } from "../../components/export/OrderExportDialog";
import { resolveOrderExportDataset } from "../../components/export/orderExportRules";
import { ClientOrderFilterBar } from "../../components/orders/ClientOrderFilterBar";
import { ClientAdminStatistics } from "../../components/orders/ClientAdminStatistics";
import { OrderAttachmentThumbnail } from "../../components/orders/OrderAttachmentThumbnail";
import { ClientOrderOverview } from "../../components/client/ClientOrderOverview";
import { ClientQuotationBreakdown } from "../../components/client/ClientQuotationBreakdown";
import {
  formatDeliveryDate,
  formatEntryDate,
  getOrderBusinessUserName,
  getOrderCustomerName
} from "../../components/orders/orderDisplay";
import {
  defaultOrderFilters,
  filterOrders,
  type OrderFilters
} from "../../components/orders/orderFilters";
import { downloadBlob } from "../../utils/downloadBlob";

const devCustomerExportNames: Record<string, string> = {
  "mock-customer-active": "MockActiveCustomer",
  "mock-customer-other": "MockOtherCustomer"
};

export function ClientOrdersPage() {
  const { options: sampleTypeOptions } = useSampleTypeOptions();
  const { session } = useDevSession();
  const [supplementForm] = Form.useForm<SupplementOrderPayload>();
  const [orders, setOrders] = useState<ClientOrder[]>([]);
  const [clientUsers, setClientUsers] = useState<ClientBusinessUser[]>([]);
  const [clientAccessScope, setClientAccessScope] = useState<ClientAccessScope>(
    session.clientAccessScope ?? CLIENT_ACCESS_SCOPES.own
  );
  const [supplementAttachments, setSupplementAttachments] = useState<AttachmentMetadataInput[]>([]);
  const [supplementingOrder, setSupplementingOrder] = useState<ClientOrder | null>(null);
  const [filters, setFilters] = useState<OrderFilters>({ ...defaultOrderFilters });
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [selectedOrderRowKeys, setSelectedOrderRowKeys] = useState<Key[]>([]);
  const [detailOrder, setDetailOrder] = useState<ClientOrder | null>(null);
  const [quotationOrder, setQuotationOrder] = useState<ClientOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [quotations, setQuotations] = useState<Record<string, ClientQuotation | null>>({});
  const [messageApi, contextHolder] = message.useMessage();

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
      if (!silent) messageApi.error(error instanceof Error ? error.message : "加载客户订单失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [messageApi, session]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useVisibleAutoRefresh(() => loadOrders({ silent: true }));

  useEffect(() => {
    setFilters({ ...defaultOrderFilters });
    setSelectedOrderRowKeys([]);
    setDetailOrder(null);
    setQuotationOrder(null);
  }, [session.clientAccessScope, session.clientUserId, session.customerId]);

  const filteredOrders = useMemo(() => filterOrders(orders, filters), [orders, filters]);
  const exportDataset = useMemo(
    () => resolveOrderExportDataset(filteredOrders, selectedOrderRowKeys, filters),
    [filteredOrders, filters, selectedOrderRowKeys]
  );

  useEffect(() => {
    const visibleIds = new Set(filteredOrders.map((order) => order.id));
    setSelectedOrderRowKeys((keys) => keys.filter((key) => visibleIds.has(String(key))));
  }, [filteredOrders]);

  const changeClientFilters = (nextFilters: OrderFilters) => {
    setFilters(nextFilters);
    setSelectedOrderRowKeys([]);
  };

  const exportCustomerName = useMemo(
    () =>
      orders[0]
        ? getOrderCustomerName(orders[0])
        : session.customerId
          ? devCustomerExportNames[session.customerId] ?? session.customerId
          : "客户",
    [orders, session.customerId]
  );
  const isCustomerAll = clientAccessScope === CLIENT_ACCESS_SCOPES.customerAll;
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
    supplementForm.setFieldsValue({
      styleNo: order.styleNo,
      styleName: order.styleName,
      quantity: order.quantity,
      sampleType: order.sampleType,
      sampleRound: order.sampleRound,
      deliveryDate: order.deliveryDate,
      remark: order.remark ?? ""
    });
    setSupplementAttachments([]);
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
    messageApi.success("补充资料已重新提交，订单已回到待接单");
    setSupplementingOrder(null);
    setSupplementAttachments([]);
    await loadOrders();
  };

  const addOrderAttachments = async (order: ClientOrder, attachments: AttachmentMetadataInput[]) => {
    await sampleRoomApi.addClientOrderAttachments(session, order.id, attachments);
    await loadOrders();
  };

  const downloadOrderAttachment = async (order: ClientOrder, attachment: ClientOrderAttachment) => {
    const blob = await sampleRoomApi.downloadClientOrderAttachment(session, order.id, attachment.id);
    downloadBlob(blob, attachment.fileName);
  };

  const deleteOrderAttachment = async (order: ClientOrder, attachment: ClientOrderAttachment) => {
    await sampleRoomApi.deleteClientOrderAttachment(session, order.id, attachment.id);
    await loadOrders();
  };

  const loadOrderAttachmentPreview = (order: ClientOrder, attachment: ClientOrderAttachment) =>
    sampleRoomApi.downloadClientOrderAttachment(session, order.id, attachment.id);

  const downloadPatternDeliverable = async (
    order: ClientOrder,
    deliverable: ClientOrderPatternTask["deliverables"][number]
  ) => {
    const blob = await sampleRoomApi.downloadClientPatternDeliverable(session, order.id, deliverable.id);
    downloadBlob(blob, deliverable.fileName ?? `${deliverable.version}-${deliverable.type}`);
  };

  const clientOrderDetail = (order: ClientOrder) => (
    <div className="client-expanded-detail">
      <div className="order-expanded-meta" aria-label="客户订单详情">
        <div>
          <span>录入日期</span>
          <strong>{formatEntryDate(order.createdAt)}</strong>
        </div>
        <div>
          <span>接单时间</span>
          <strong>{order.intakeStatus === "received" ? formatEntryDate(order.updatedAt) : "未接单"}</strong>
        </div>
        <div>
          <span>交期</span>
          <strong>{formatDeliveryDate(order.deliveryDate)}</strong>
        </div>
        <div>
          <span>客户业务员</span>
          <strong>{getOrderBusinessUserName(order)}</strong>
        </div>
      </div>
      <ClientOrderOverview
        order={order}
        quotation={quotations[order.id] ?? null}
        onDownloadAttachment={(attachment) => downloadOrderAttachment(order, attachment)}
        onDeleteAttachment={(attachment) => deleteOrderAttachment(order, attachment)}
        onDownloadDeliverable={(deliverable) => downloadPatternDeliverable(order, deliverable)}
        canAddAttachments={clientAccessScope === CLIENT_ACCESS_SCOPES.own}
        onAddAttachments={(attachments) => addOrderAttachments(order, attachments)}
      />
    </div>
  );

  const actions = (order: ClientOrder) => {
    return (
      <Space direction="vertical" size={2} className="row-action-stack">
        <Button type="link" size="small" onClick={() => setDetailOrder(order)}>
          查看详情
        </Button>
        {clientAccessScope === CLIENT_ACCESS_SCOPES.own &&
        order.intakeStatus === "needs_client_supplement" ? (
          <Button type="primary" size="small" onClick={() => openSupplement(order)}>
            补充资料
          </Button>
        ) : null}
      </Space>
    );
  };

  return (
    <Space direction="vertical" size={16} className="full-width">
      {contextHolder}
      <Card className="section-card">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>客户订单</Typography.Title>
          <Typography.Text type="secondary">
            {isCustomerAll
              ? "主管账号可查看并按业务员筛选同客户订单，不能创建打样需求。"
              : "查看和筛选当前账号自己的订单；需要新建打样需求请回到客户工作台。"}
          </Typography.Text>
        </Space>
      </Card>

      <Card
        title={`我的订单 ${filteredOrders.length}/${orders.length}`}
        className="section-card"
        extra={
          <Space>
            {exportDataset.scope === "selected" ? (
              <Typography.Text type="secondary">已选择 {exportDataset.orders.length} 条</Typography.Text>
            ) : null}
            <Button type="primary" onClick={() => setExportDialogOpen(true)}>
              导出 Excel
            </Button>
          </Space>
        }
      >
        <ClientOrderFilterBar
          filters={filters}
          onChange={changeClientFilters}
          businessUserOptions={businessUserOptions}
        />
        {isCustomerAll ? (
          <ClientAdminStatistics orders={filteredOrders} variant="web" />
        ) : null}
        <OrderTable
          orders={filteredOrders}
          loading={loading}
          audience="client"
          titleThumbnail={(order) => (
            <OrderAttachmentThumbnail order={order} loadPreview={loadOrderAttachmentPreview} />
          )}
          clientQuotation={(order) => quotations[order.id]
            ? <Button type="link" size="small" onClick={() => setQuotationOrder(order)}>
                ¥{quotations[order.id]!.receivableTotal.toFixed(2)}
              </Button>
            : <Typography.Text type="secondary">待确认</Typography.Text>}
          actions={actions}
          selectable
          selectedRowKeys={selectedOrderRowKeys}
          onSelectedRowKeysChange={setSelectedOrderRowKeys}
          scrollY="calc(100vh - 430px)"
        />
      </Card>

      <OrderExportDialog
        open={exportDialogOpen}
        role="client"
        orders={exportDataset.orders}
        filters={filters}
        exportScope={exportDataset.scope}
        customerName={exportCustomerName}
        onCancel={() => setExportDialogOpen(false)}
        onExported={() => setExportDialogOpen(false)}
      />

      <Modal
        title={detailOrder ? `订单详情 · ${detailOrder.styleNo}` : "订单详情"}
        open={Boolean(detailOrder)}
        onCancel={() => setDetailOrder(null)}
        footer={<Button onClick={() => setDetailOrder(null)}>关闭</Button>}
        width={960}
        className="client-order-detail-modal order-detail-fixed-height-modal"
        style={{ top: 24 }}
        destroyOnHidden
      >
        {detailOrder ? clientOrderDetail(detailOrder) : null}
      </Modal>

      <Modal
        title={quotationOrder ? `打样报价 · ${quotationOrder.styleNo}` : "打样报价"}
        open={Boolean(quotationOrder)}
        onCancel={() => setQuotationOrder(null)}
        footer={<Button onClick={() => setQuotationOrder(null)}>关闭</Button>}
        width={620}
        destroyOnHidden
      >
        {quotationOrder && quotations[quotationOrder.id]
          ? <ClientQuotationBreakdown quotation={quotations[quotationOrder.id]!} />
          : <Typography.Text type="secondary">报价尚未确认。</Typography.Text>}
      </Modal>

      <Modal
        title="补充客户资料"
        open={Boolean(supplementingOrder)}
        onCancel={() => setSupplementingOrder(null)}
        onOk={() => void submitSupplement()}
        okText="重新提交"
        cancelText="取消"
        width={760}
      >
        {supplementingOrder?.returnReason ? (
          <Card size="small" className="return-reason-card">
            <Typography.Text strong>退回原因：</Typography.Text>
            <Typography.Text>{supplementingOrder.returnReason}</Typography.Text>
          </Card>
        ) : null}
        <Form form={supplementForm} layout="vertical" className="modal-form">
          <div className="form-grid">
            <Form.Item label="款号" name="styleNo" rules={[{ required: true, message: "请输入款号" }]}>
              <Input />
            </Form.Item>
            <Form.Item label="款名" name="styleName" rules={[{ required: true, message: "请输入款名" }]}>
              <Input />
            </Form.Item>
            <Form.Item label="数量" name="quantity" rules={[{ required: true, message: "请输入数量" }]}>
              <InputNumber min={1} className="full-width" />
            </Form.Item>
            <Form.Item label="样品类型" name="sampleType" rules={[{ required: true, message: "请选择样品类型" }]}>
              <Select options={sampleTypeOptions} />
            </Form.Item>
            <Form.Item label="样品轮次" name="sampleRound" rules={[{ required: true, message: "请选择样品轮次" }]}>
              <Select options={sampleRoundOptions} />
            </Form.Item>
            <Form.Item label="期望交期" name="deliveryDate" rules={[{ required: true, message: "请输入交期" }]}>
              <Input type="date" />
            </Form.Item>
          </div>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item label="新增附件">
            <ClientAttachmentPicker
              value={supplementAttachments}
              onChange={setSupplementAttachments}
              showCamera={false}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
