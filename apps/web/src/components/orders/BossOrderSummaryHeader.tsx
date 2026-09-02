import {
  CalendarOutlined,
  InboxOutlined,
  ProfileOutlined,
  ShoppingOutlined,
  SyncOutlined,
  TagOutlined,
  TeamOutlined,
  UserOutlined
} from "@ant-design/icons";
import { Typography } from "antd";
import { hasPhysicalProductionRoute } from "@sample-room/shared";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useDevSession } from "../../app/DevSessionContext";
import { useSampleTypeOptions } from "../../app/SampleTypeOptionsContext";
import type { OrderAttachment, OrderRecord } from "../../api/sampleRoomApi";
import { request } from "../../api/request";
import {
  AttachmentPreviewModal,
  type AttachmentPreviewRequest
} from "../attachments/AttachmentPreviewModal";
import { sampleRoundLabel } from "../scan/scanDisplay";
import { OrderCompletionTag } from "../operations/OrderCompletionStatus";
import { OrderTaskStatusBadges } from "../operations/PatternTaskStatusBadges";
import { OrderAttachmentThumbnail } from "./OrderAttachmentThumbnail";
import {
  formatOrderDate,
  getOrderBusinessUserName,
  getOrderCustomerName
} from "./orderDisplay";

type BossOrderSummaryHeaderProps = {
  order: OrderRecord;
  patternTask?: OrderRecord["patternTask"] | undefined;
  loadPreview: (order: OrderRecord, attachment: OrderAttachment) => Promise<Blob>;
};

type ProcessPieceReference = {
  orderId: string;
  cutting?: number;
  sewing?: number;
  qc?: number;
};

function SummaryItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="boss-order-summary-item">
      <span className="boss-order-summary-icon" aria-hidden="true">{icon}</span>
      <span className="boss-order-summary-item-copy">
        <Typography.Text type="secondary">{label}</Typography.Text>
        <Typography.Text strong title={value}>{value}</Typography.Text>
      </span>
    </div>
  );
}

export function BossOrderSummaryHeader({
  order,
  patternTask,
  loadPreview
}: BossOrderSummaryHeaderProps) {
  const { session } = useDevSession();
  const [processPieces, setProcessPieces] = useState<ProcessPieceReference>();
  const [previewRequest, setPreviewRequest] = useState<AttachmentPreviewRequest>();
  const resolvedPatternTask = patternTask ?? order.patternTask;
  const { labelFor: sampleTypeLabel } = useSampleTypeOptions();
  const customerName = getOrderCustomerName(order);
  const businessUserName = getOrderBusinessUserName(order);
  const hasPhysicalProduction = hasPhysicalProductionRoute(order.sampleRequestItems);
  const quantity = hasPhysicalProduction ? `${order.quantity} 件` : "N/A";
  const receivedDate = order.receivedAt ? formatOrderDate(order.receivedAt) : "未接单";

  useEffect(() => {
    let active = true;
    setProcessPieces(undefined);
    if (!hasPhysicalProduction || (session.role !== "boss" && session.role !== "system_owner")) {
      return () => {
        active = false;
      };
    }
    void request<{ result: ProcessPieceReference }>(
      session,
      `/api/admin/orders/${encodeURIComponent(order.id)}/process-pieces`
    ).then((response) => {
      if (active) setProcessPieces(response.result);
    }).catch(() => {
      if (active) setProcessPieces(undefined);
    });
    return () => {
      active = false;
    };
  }, [hasPhysicalProduction, order.id, session]);

  useEffect(() => {
    setPreviewRequest(undefined);
  }, [order.id]);

  const openThumbnailPreview = (attachment: OrderAttachment) => {
    setPreviewRequest({
      key: `order-thumbnail-${order.id}-${attachment.id}`,
      fileName: attachment.fileName,
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      load: () => loadPreview(order, attachment)
    });
  };

  return (
    <>
      <section className="boss-order-summary-header" aria-label="订单摘要">
        <div className="boss-order-summary-top">
          <div className="boss-order-summary-thumbnail">
            <OrderAttachmentThumbnail
              order={order}
              loadPreview={loadPreview}
              onPreview={openThumbnailPreview}
            />
          </div>
          <div className="boss-order-summary-grid">
            <SummaryItem icon={<TagOutlined />} label="款号" value={order.styleNo} />
            <SummaryItem icon={<TeamOutlined />} label="客户" value={customerName} />
            <SummaryItem icon={<InboxOutlined />} label="样品类型" value={sampleTypeLabel(order.sampleType)} />
            <SummaryItem icon={<SyncOutlined />} label="轮次" value={sampleRoundLabel(order.sampleRound)} />
            <SummaryItem icon={<ProfileOutlined />} label="款名" value={order.styleName} />
            <SummaryItem icon={<UserOutlined />} label="客户业务员" value={businessUserName} />
            <SummaryItem icon={<ShoppingOutlined />} label="数量" value={quantity} />
            <SummaryItem icon={<CalendarOutlined />} label="接单日期" value={receivedDate} />
          </div>
        </div>
        <div className="boss-order-summary-progress">
          <div className="boss-order-summary-progress-item">
            <Typography.Text type="secondary">当前工序</Typography.Text>
            <OrderCompletionTag
              sampleRequestItems={order.sampleRequestItems}
              stage={order.stage}
              {...(order.stageLabel ? { stageLabel: order.stageLabel } : {})}
              {...(order.completionStatus ? { completionStatus: order.completionStatus } : {})}
              {...(resolvedPatternTask ? { patternTask: resolvedPatternTask } : {})}
            />
          </div>
          <div className="boss-order-summary-progress-item boss-order-summary-tasks">
            <Typography.Text type="secondary">订单任务</Typography.Text>
            <OrderTaskStatusBadges
              sampleRequestItems={order.sampleRequestItems}
              stage={order.stage}
              patternTask={resolvedPatternTask}
              processPieces={processPieces}
              maxRows={2}
            />
          </div>
        </div>
      </section>

      <AttachmentPreviewModal
        request={previewRequest}
        onClose={() => setPreviewRequest(undefined)}
      />
    </>
  );
}
