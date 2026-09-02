import { Button, Card, Space, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { sampleRoomApi, type ClientOrder } from "../../api/sampleRoomApi";
import { useDevSession } from "../../app/DevSessionContext";
import { RoleTaskRoomHeader } from "../../components/RoleTaskRoomHeader";
import { useVisibleAutoRefresh } from "../../hooks/useVisibleAutoRefresh";
import { IntakeTag, StageTag } from "../../components/StatusTags";
import {
  formatDeliveryDate,
  formatEntryDate
} from "../../components/orders/orderDisplay";
import {
  ClientExcelImportPanel,
  ClientQuickPhotoIntake
} from "./ClientQuickIntakePanel";

function RecentOrderSummary({ orders }: { orders: ClientOrder[] }) {
  const navigate = useNavigate();
  const recentOrders = useMemo(
    () => [...orders].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 4),
    [orders]
  );

  return (
    <Card
      title="最近订单"
      className="section-card"
      extra={<Button onClick={() => navigate("/client/orders")}>查看全部订单</Button>}
    >
      <Space direction="vertical" size={10} className="full-width">
        {recentOrders.map((order) => (
          <div className="recent-order-row" key={order.id}>
            <Space direction="vertical" size={0}>
              <Typography.Text strong>{order.styleNo}</Typography.Text>
              <Typography.Text type="secondary">{order.styleName}</Typography.Text>
              <Typography.Text type="secondary">
                录入：{formatEntryDate(order.createdAt)} / 交期：{formatDeliveryDate(order.deliveryDate)}
              </Typography.Text>
            </Space>
            <Typography.Text>{order.quantity}</Typography.Text>
            <Space wrap>
              <IntakeTag value={order.intakeStatus} />
              <StageTag value={order.stage} />
            </Space>
          </div>
        ))}
        {recentOrders.length === 0 ? (
          <Typography.Text type="secondary">暂无最近订单</Typography.Text>
        ) : null}
      </Space>
    </Card>
  );
}

export function ClientWorkbenchPage() {
  const { session } = useDevSession();
  const [orders, setOrders] = useState<ClientOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const navigate = useNavigate();

  const loadOrders = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const result = await sampleRoomApi.listClientOrders(session);
      setOrders(result.orders);
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

  return (
    <Space direction="vertical" size={16} className="full-width">
      {contextHolder}
      <RoleTaskRoomHeader
        eyebrow="客户任务间"
        title="客户工作台"
        description="客户只需要先提交截图、照片或固定 Excel；接单员确认后会补齐订单资料并推动流转。"
        steps={[
          { label: "截图/照片录入", help: "直接粘贴或选择图片生成待接单订单", active: true },
          { label: "Excel 批量导入", help: "下载固定模板，预览有效行后批量生成订单" },
          { label: "订单跟踪", help: "在客户订单页查看进度和补充资料" }
        ]}
        aside={<Button onClick={() => navigate("/client/orders")}>进入订单筛选</Button>}
      />

      <div className="client-intake-grid">
        <ClientQuickPhotoIntake session={session} onCreated={loadOrders} />
        <ClientExcelImportPanel session={session} onImported={loadOrders} />
      </div>

      <RecentOrderSummary orders={orders} />
      {loading ? <Typography.Text type="secondary">正在刷新订单...</Typography.Text> : null}
    </Space>
  );
}
