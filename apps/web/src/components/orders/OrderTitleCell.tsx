import { Space, Tag, Tooltip, Typography } from "antd";
import type { ReactNode } from "react";
import type { OrderRecord } from "../../api/sampleRoomApi";
import {
  formatDeliveryDate,
  formatEntryDate,
  getOrderEntrySourceLabel,
  getOrderBusinessUserName,
  getOrderCustomerName
} from "./orderDisplay";

const sourceTypeLabels: Record<NonNullable<OrderRecord["sourceType"]>, string> = {
  client_submission: "客户提交",
  receiver_self_entry: "接单员录入",
  internal_manual: "内部录入"
};

export function OrderTitleCell({
  order,
  audience = "receiver",
  showMeta = true,
  extra,
  thumbnail
}: {
  order: OrderRecord;
  audience?: "client" | "receiver";
  showMeta?: boolean;
  extra?: ReactNode;
  thumbnail?: ReactNode;
}) {
  const businessUserName = getOrderBusinessUserName(order);

  return (
    <div className={thumbnail ? "order-title-cell-with-thumbnail" : "order-title-cell"}>
      {thumbnail}
      <Space direction="vertical" size={2} className="order-title-cell-content">
        <Typography.Text strong className="order-title-style-no">
          {order.styleNo}
        </Typography.Text>
        <Typography.Text type="secondary">{order.styleName}</Typography.Text>
        {audience === "receiver" ? (
          <Typography.Text type="secondary" className="order-title-entry-source">
            {getOrderEntrySourceLabel(order)}
          </Typography.Text>
        ) : null}
        {showMeta ? (
          <>
            <Typography.Text type="secondary" className="order-title-meta">
              录入：{formatEntryDate(order.createdAt)} / 交期：{formatDeliveryDate(order.deliveryDate)}
            </Typography.Text>
            <Typography.Text type="secondary" className="order-title-meta">
              {audience === "receiver"
                ? `客户：${getOrderCustomerName(order)} / 业务员：${businessUserName}`
                : `业务员：${businessUserName}`}
            </Typography.Text>
          </>
        ) : null}
        <Space size={6} wrap>
          {audience !== "receiver" && order.sourceType ? (
            <Tooltip title={`订单号：${order.orderNo}`}>
              <Tag>{sourceTypeLabels[order.sourceType]}</Tag>
            </Tooltip>
          ) : null}
          {extra}
        </Space>
      </Space>
    </div>
  );
}
