import { Button, Space, message } from "antd";
import { useState, type ComponentProps } from "react";
import type { AttachmentMetadataInput } from "../../api/sampleRoomApi";
import { ClientAttachmentPicker } from "../ClientAttachmentPicker";
import { attachmentUploadErrorMessage } from "./attachmentErrors";
import { UnifiedAttachmentTable } from "./UnifiedAttachmentTable";

type UnifiedAttachmentTableProps = ComponentProps<typeof UnifiedAttachmentTable>;

type OrderAttachmentPanelProps = UnifiedAttachmentTableProps & {
  defaultCategory: string;
  defaultVisibility?: AttachmentMetadataInput["visibility"];
  showVisibilityChoice?: boolean;
  pickerDescription?: string;
  onUpload: (attachments: AttachmentMetadataInput[]) => Promise<void>;
  workspace?: boolean;
};

export function OrderAttachmentPanel({
  defaultCategory,
  defaultVisibility = "internal_only",
  showVisibilityChoice = true,
  pickerDescription = "",
  onUpload,
  workspace = false,
  ...tableProps
}: OrderAttachmentPanelProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [draftAttachments, setDraftAttachments] = useState<AttachmentMetadataInput[]>([]);
  const [uploading, setUploading] = useState(false);

  const submitUpload = async () => {
    if (draftAttachments.length === 0) return;

    setUploading(true);
    try {
      await onUpload(draftAttachments);
      setDraftAttachments([]);
      messageApi.success("附件已上传");
    } catch (error) {
      messageApi.error(attachmentUploadErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Space
      direction="vertical"
      size={12}
      className={`full-width order-attachment-panel${workspace ? " is-workspace" : ""}`}
    >
      {contextHolder}
      <ClientAttachmentPicker
        value={draftAttachments}
        onChange={setDraftAttachments}
        showCamera={false}
        defaultCategory={defaultCategory}
        defaultVisibility={defaultVisibility}
        showVisibilityChoice={showVisibilityChoice}
        accept=""
        title="拖拽、粘贴或点击选择文件"
        description={pickerDescription}
        allowRename
        compact
        compactLabel="附件（可选）"
        compactTrailingAction={
          <Button
            type="primary"
            loading={uploading}
            disabled={draftAttachments.length === 0}
            onClick={() => void submitUpload()}
          >
            上传附件
          </Button>
        }
      />
      <UnifiedAttachmentTable
        {...tableProps}
        workspace={workspace}
        showPageSizeChanger={Boolean(workspace || tableProps.showPageSizeChanger)}
        pageSizeStorageKey="sample-room:order-detail-attachments:page-size"
        enableBulkDelete
      />
    </Space>
  );
}
