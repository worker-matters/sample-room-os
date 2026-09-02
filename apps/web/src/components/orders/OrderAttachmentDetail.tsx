import { Button, Collapse, Empty, Popconfirm, Space, Tag, Typography, message } from "antd";
import { useState } from "react";
import type { ReactNode } from "react";
import type { AttachmentMetadataInput, OrderAttachment, OrderRecord } from "../../api/sampleRoomApi";
import { ClientAttachmentPicker } from "../ClientAttachmentPicker";
import { formatEntryDate } from "./orderDisplay";
import { attachmentOperationErrorMessage, attachmentUploadErrorMessage } from "../attachments/attachmentErrors";

const roleLabels: Record<string, string> = {
  client_admin: "客户",
  client_business_user: "客户",
  receiver: "接单员",
  boss: "老板",
  system_owner: "System Owner"
};

const visibilityLabels: Record<OrderAttachment["visibility"], string> = {
  client_visible: "客户可见",
  internal_only: "仅内部"
};

type OrderAttachmentDetailProps = {
  order: OrderRecord;
  canAdd: boolean;
  addButtonLabel?: string;
  defaultCategory?: string;
  defaultVisibility?: OrderAttachment["visibility"] | undefined;
  allowVisibilityChoice?: boolean;
  readOnlyNote?: string;
  includeScanPlaceholder?: boolean;
  scanPanel?: ReactNode;
  onAddAttachments?: (order: OrderRecord, attachments: AttachmentMetadataInput[]) => Promise<void>;
  onDownloadAttachment?: (order: OrderRecord, attachment: OrderAttachment) => Promise<void>;
  onDeleteAttachment?: (order: OrderRecord, attachment: OrderAttachment) => Promise<void>;
};

function AttachmentLog({
  attachments,
  onDownload,
  downloadingId,
  onDelete,
  deletingId
}: {
  attachments: OrderAttachment[];
  onDownload?: ((attachment: OrderAttachment) => void | Promise<void>) | undefined;
  downloadingId?: string | null;
  onDelete?: ((attachment: OrderAttachment) => void | Promise<void>) | undefined;
  deletingId?: string | null;
}) {
  if (attachments.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无附件记录" />;
  }

  return (
    <Space direction="vertical" size={8} className="full-width">
      {attachments.map((attachment) => (
        <div className="attachment-log-row" key={attachment.id}>
          <Space direction="vertical" size={2}>
            <Typography.Text strong>{attachment.fileName}</Typography.Text>
            <Typography.Text type="secondary">
              {attachment.uploadedByRole ? roleLabels[attachment.uploadedByRole] ?? attachment.uploadedByRole : "资料"} / {attachment.uploadedBy ?? "-"} /{" "}
              {formatEntryDate(attachment.createdAt)}
            </Typography.Text>
          </Space>
          <Space>
            <Tag>{visibilityLabels[attachment.visibility] ?? attachment.visibility}</Tag>
            {attachment.hasFile && onDownload ? (
              <Button
                size="small"
                loading={downloadingId === attachment.id}
                onClick={() => onDownload(attachment)}
              >
                下载
              </Button>
            ) : null}
            {onDelete ? (
              <Popconfirm
                title="删除附件"
                description="删除后，客户和内部附件列表都不再显示该附件。"
                okText="删除"
                cancelText="取消"
                onConfirm={() => onDelete(attachment)}
              >
                <Button danger size="small" loading={deletingId === attachment.id}>
                  删除
                </Button>
              </Popconfirm>
            ) : null}
          </Space>
        </div>
      ))}
    </Space>
  );
}

export function OrderAttachmentDetail({
  order,
  canAdd,
  addButtonLabel = "新增附件",
  defaultCategory = "client_reference",
  defaultVisibility = "client_visible",
  allowVisibilityChoice = false,
  readOnlyNote,
  includeScanPlaceholder = false,
  scanPanel,
  onAddAttachments,
  onDownloadAttachment,
  onDeleteAttachment
}: OrderAttachmentDetailProps) {
  const [draftAttachments, setDraftAttachments] = useState<AttachmentMetadataInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const attachments = order.attachments ?? [];

  const submitAttachments = async () => {
    if (!onAddAttachments || draftAttachments.length === 0) {
      messageApi.warning("请先选择附件");
      return;
    }

    setSubmitting(true);
    try {
      await onAddAttachments(order, draftAttachments);
      setDraftAttachments([]);
      messageApi.success("附件记录已追加");
    } catch (error) {
      messageApi.error(attachmentUploadErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const downloadAttachment = async (attachment: OrderAttachment) => {
    if (!onDownloadAttachment) {
      return;
    }

    setDownloadingId(attachment.id);
    try {
      await onDownloadAttachment(order, attachment);
    } catch (error) {
      messageApi.error(attachmentOperationErrorMessage(error));
    } finally {
      setDownloadingId(null);
    }
  };

  const deleteAttachment = async (attachment: OrderAttachment) => {
    if (!onDeleteAttachment) {
      return;
    }

    setDeletingId(attachment.id);
    try {
      await onDeleteAttachment(order, attachment);
      messageApi.success("附件已删除");
    } catch (error) {
      messageApi.error(attachmentOperationErrorMessage(error));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="order-detail-panel">
      {contextHolder}
      {canAdd ? (
        <div className="order-attachment-add-entry">
          <Typography.Text strong>{addButtonLabel}</Typography.Text>
          <ClientAttachmentPicker
            value={draftAttachments}
            onChange={setDraftAttachments}
            showCamera={false}
            defaultCategory={defaultCategory}
            defaultVisibility={defaultVisibility}
            showVisibilityChoice={allowVisibilityChoice}
          />
          <Button
            type="primary"
            size="small"
            loading={submitting}
            onClick={() => void submitAttachments()}
          >
            追加附件记录
          </Button>
        </div>
      ) : readOnlyNote ? (
        <Typography.Text type="secondary">{readOnlyNote}</Typography.Text>
      ) : null}

      <Collapse
        size="small"
        className="order-detail-collapse"
        items={[
          {
            key: "attachments",
            label: `附件日志 ${attachments.length}`,
            children: (
              <AttachmentLog
                attachments={attachments}
                {...(onDownloadAttachment ? { onDownload: downloadAttachment } : {})}
                {...(onDeleteAttachment ? { onDelete: deleteAttachment } : {})}
                downloadingId={downloadingId}
                deletingId={deletingId}
              />
            )
          },
          ...(scanPanel || includeScanPlaceholder
            ? [
                {
                  key: "scan-records",
                  label: "扫码记录",
                  children: scanPanel ?? (
                    <Typography.Text type="secondary">
                      暂无扫码记录；扫码模块待迁移。
                    </Typography.Text>
                  )
                }
              ]
            : [])
        ]}
      />
    </div>
  );
}
