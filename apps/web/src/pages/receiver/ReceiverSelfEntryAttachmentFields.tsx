import { Select, Space, Typography } from "antd";
import type { AttachmentMetadataInput, OrderAttachment } from "../../api/sampleRoomApi";
import { ClientAttachmentPicker } from "../../components/ClientAttachmentPicker";

type ReceiverSelfEntryAttachmentFieldsProps = {
  attachments: AttachmentMetadataInput[];
  visibility: OrderAttachment["visibility"];
  autoOpenSignal?: number | undefined;
  autoOpenTarget?: "file" | "camera" | undefined;
  onAttachmentsChange: (attachments: AttachmentMetadataInput[]) => void;
  onVisibilityChange: (visibility: OrderAttachment["visibility"]) => void;
};

export function ReceiverSelfEntryAttachmentFields({
  attachments,
  visibility,
  autoOpenSignal,
  autoOpenTarget,
  onAttachmentsChange,
  onVisibilityChange
}: ReceiverSelfEntryAttachmentFieldsProps) {
  return (
    <div className="receiver-self-entry-attachments">
      <Space direction="vertical" size={8} className="full-width">
        <Space size={8} wrap>
          <Typography.Text strong>附件（可选）</Typography.Text>
          <Typography.Text type="secondary">创建订单后自动上传，失败时保留订单。</Typography.Text>
        </Space>
        <Space size={8} wrap>
          <Typography.Text type="secondary">可见范围</Typography.Text>
          <Select
            size="small"
            value={visibility}
            style={{ minWidth: 120 }}
            options={[
              { value: "client_visible", label: "客户可见" },
              { value: "internal_only", label: "仅内部" }
            ]}
            onChange={onVisibilityChange}
          />
        </Space>
        <ClientAttachmentPicker
          value={attachments}
          onChange={onAttachmentsChange}
          showCamera
          defaultCategory="client_result"
          defaultVisibility={visibility}
          autoOpenSignal={autoOpenSignal}
          autoOpenTarget={autoOpenTarget}
        />
      </Space>
    </div>
  );
}
