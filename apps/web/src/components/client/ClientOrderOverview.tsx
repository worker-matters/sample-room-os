import { Button, Card, Space, Steps, Tag, Typography, message } from "antd";
import { useState } from "react";
import type {
  AttachmentMetadataInput,
  ClientOrder,
  ClientOrderAttachment,
  ClientOrderPatternTask,
  ClientQuotation
} from "../../api/sampleRoomApi";
import { ThreeSourceMaterials } from "../operations/ThreeSourceMaterials";
import { OrderCompletionTag } from "../operations/OrderCompletionStatus";
import { ClientAttachmentPicker } from "../ClientAttachmentPicker";
import { ClientQuotationBreakdown } from "./ClientQuotationBreakdown";

const materialLabels: Record<string, string> = { missing: "未齐", partial: "部分到", complete: "已齐" };

type ClientPatternDeliverable = ClientOrderPatternTask["deliverables"][number];

function progressIndex(order: ClientOrder) {
  if (order.intakeStatus !== "received") return 0;
  if (order.completionStatus === "completed") return 3;
  if (order.completionStatus === "pattern_only_pending") return 1;
  if (order.completionStatus === "production_completed_pattern_pending") return 2;
  if (order.stage === "done" && !order.patternTask) return 3;
  if (order.stage === "qc_delivery_waiting") return 2;
  return 1;
}

export function ClientOrderOverview({
  order,
  quotation,
  onDownloadAttachment,
  onDownloadDeliverable,
  onDeleteAttachment,
  canAddAttachments = false,
  onAddAttachments
}: {
  order: ClientOrder;
  quotation?: ClientQuotation | null;
  onDownloadAttachment?: (attachment: ClientOrderAttachment) => Promise<void> | void;
  onDownloadDeliverable?: (deliverable: ClientPatternDeliverable) => Promise<void> | void;
  onDeleteAttachment?: (attachment: ClientOrderAttachment) => Promise<void> | void;
  canAddAttachments?: boolean;
  onAddAttachments?: (attachments: AttachmentMetadataInput[]) => Promise<void>;
}) {
  const [draftAttachments, setDraftAttachments] = useState<AttachmentMetadataInput[]>([]);
  const [uploading, setUploading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const upload = async () => {
    if (!onAddAttachments || draftAttachments.length === 0) return;
    setUploading(true);
    try {
      await onAddAttachments(draftAttachments);
      setDraftAttachments([]);
      messageApi.success("客户资料已追加");
    } finally {
      setUploading(false);
    }
  };
  return (
    <Space direction="vertical" size={12} className="full-width client-order-overview">
      {contextHolder}
      <Card size="small" title="订单进度">
        <Steps
          size="small"
          current={progressIndex(order)}
          items={[{ title: "资料确认" }, { title: "样品制作" }, { title: "质量检查" }, { title: "已完成" }]}
        />
        <OrderCompletionTag
          sampleRequestItems={order.sampleRequestItems}
          stage={order.stage}
          simplified
          {...(order.completionStatus ? { completionStatus: order.completionStatus } : {})}
          {...(order.patternTask ? { patternTask: order.patternTask } : {})}
        />
      </Card>
      <Card size="small" title="面辅料">
        <Space wrap>
          <Tag color={order.fabricStatus === "complete" ? "success" : "warning"}>面里料：{materialLabels[order.fabricStatus] ?? order.fabricStatus}</Tag>
          <Tag color={order.trimStatus === "complete" ? "success" : "warning"}>辅料：{materialLabels[order.trimStatus] ?? order.trimStatus}</Tag>
        </Space>
      </Card>
      <Card size="small" title="打样报价">
        {quotation ? <ClientQuotationBreakdown quotation={quotation} />
          : <Typography.Text type="secondary">报价尚未由打样间确认，暂不展示。</Typography.Text>}
      </Card>
      <ThreeSourceMaterials
        audience="client"
        attachments={order.attachments ?? []}
        deliverables={order.patternTask?.deliverables ?? []}
        {...(onDownloadAttachment ? { onDownload: onDownloadAttachment } : {})}
        {...(onDownloadDeliverable ? { onDownloadDeliverable } : {})}
        {...(onDeleteAttachment ? { onDelete: onDeleteAttachment } : {})}
        canDelete={(attachment) => attachment.canDelete}
      />
      {canAddAttachments ? (
        <Card size="small" title="追加客户资料">
          <ClientAttachmentPicker value={draftAttachments} onChange={setDraftAttachments} showCamera={false} defaultCategory="client_upload" defaultVisibility="client_visible" />
          <Button type="primary" loading={uploading} disabled={draftAttachments.length === 0} onClick={() => void upload()}>上传资料</Button>
        </Card>
      ) : null}
    </Space>
  );
}
