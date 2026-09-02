import { Button, Form, Input, InputNumber, Modal, Space, Typography, message } from "antd";
import { decimalInputProps } from "../forms/numericInputProps";
import { useEffect, useState } from "react";
import type {
  AttachmentMetadataInput,
  OrderAttachment,
  OrderChargeRecord
} from "../../api/sampleRoomApi";
import { ClientAttachmentPicker, formatFileSize } from "../ClientAttachmentPicker";
import { editableAttachmentFileName, validateAttachmentFileNameBody } from "../attachmentFileName";
import {
  AttachmentPreviewModal,
  type AttachmentPreviewRequest
} from "../attachments/AttachmentPreviewModal";
import { viewportBoundDialogWidth } from "../dialogLayout";

export type OrderChargeEditValues = {
  name: string;
  amount: number;
  explanation: string;
};

export type OrderChargeEditActions = {
  onEdit?: ((charge: OrderChargeRecord, values: OrderChargeEditValues) => Promise<void>) | undefined;
  onAddAttachments?: ((
    charge: OrderChargeRecord,
    attachments: AttachmentMetadataInput[]
  ) => Promise<void>) | undefined;
  onRenameAttachment?: ((
    charge: OrderChargeRecord,
    attachmentId: string,
    displayName: string
  ) => Promise<void>) | undefined;
  onDeleteAttachment?: ((charge: OrderChargeRecord, attachmentId: string) => Promise<void>) | undefined;
  loadAttachmentBlob?: ((attachment: OrderAttachment) => Promise<Blob>) | undefined;
};

export function OrderChargeEditModal({
  charge,
  currentUserId,
  canManageAll = false,
  onCancel,
  onEdit,
  onAddAttachments,
  onRenameAttachment,
  onDeleteAttachment,
  loadAttachmentBlob
}: {
  charge?: OrderChargeRecord | undefined;
  currentUserId?: string | undefined;
  canManageAll?: boolean | undefined;
  onCancel: () => void;
} & OrderChargeEditActions) {
  const [form] = Form.useForm<OrderChargeEditValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [saving, setSaving] = useState(false);
  const [addingAttachments, setAddingAttachments] = useState(false);
  const [attachmentDraft, setAttachmentDraft] = useState<AttachmentMetadataInput[]>([]);
  const [renameDraft, setRenameDraft] = useState<{
    attachmentId: string;
    baseName: string;
    extension: string;
  }>();
  const [renaming, setRenaming] = useState(false);
  const [previewRequest, setPreviewRequest] = useState<AttachmentPreviewRequest>();

  useEffect(() => {
    if (!charge) return;
    form.setFieldsValue({
      name: charge.name,
      amount: charge.amount,
      explanation: charge.explanation
    });
  }, [charge, form]);

  const close = () => {
    setAttachmentDraft([]);
    setRenameDraft(undefined);
    setPreviewRequest(undefined);
    onCancel();
  };

  return (
    <>
      {contextHolder}
      <Modal
        title="编辑其他费用"
        open={Boolean(charge)}
        width={viewportBoundDialogWidth("form")}
        className="app-workspace-modal app-workspace-modal-data order-charge-edit-modal"
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
        onCancel={close}
        onOk={async () => {
          if (!charge || !onEdit) return;
          const values = await form.validateFields();
          setSaving(true);
          try {
            await onEdit(charge, values);
            messageApi.success("其他费用已更新");
            close();
          } catch (error) {
            messageApi.error(error instanceof Error ? error.message : "其他费用更新失败");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Space direction="vertical" size={16} className="full-width order-charge-edit-dialog">
          <section className="order-charge-edit-section">
            <Typography.Text strong>费用信息</Typography.Text>
            <Form form={form} layout="vertical" className="order-charge-edit-form">
              <Form.Item label="费用名称" name="name" rules={[{ required: true, message: "请输入费用名称" }]}>
                <Input />
              </Form.Item>
              <Form.Item label="金额" name="amount" rules={[{ required: true, message: "请输入金额" }]}>
                <InputNumber {...decimalInputProps} min={0.01} precision={2} prefix="¥" className="full-width" />
              </Form.Item>
              <Form.Item label="说明（可选）" name="explanation">
                <Input />
              </Form.Item>
            </Form>
          </section>

          <section className="order-charge-edit-section">
            <Typography.Text strong>附件管理</Typography.Text>
            <div className="order-charge-edit-attachment-table" role="table" aria-label="费用附件">
              <div className="order-charge-edit-attachment-header" role="row">
                <span>文件名</span>
                <span>大小</span>
                <span>操作</span>
              </div>
              <div className="order-charge-edit-attachment-body">
                {(charge?.attachments ?? []).length === 0 ? (
                  <Typography.Text type="secondary" className="order-charge-edit-attachment-empty">
                    暂无附件
                  </Typography.Text>
                ) : (charge?.attachments ?? []).map((attachment) => (
                  <div className="order-charge-edit-attachment-row" role="row" key={attachment.id}>
                    {attachment.hasFile !== false && loadAttachmentBlob ? (
                      <Typography.Link
                        ellipsis
                        title={attachment.fileName}
                        onClick={() => setPreviewRequest({
                          key: attachment.id,
                          fileName: attachment.fileName,
                          ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
                          load: () => loadAttachmentBlob(attachment)
                        })}
                      >
                        {attachment.fileName}
                      </Typography.Link>
                    ) : (
                      <Typography.Text ellipsis={{ tooltip: attachment.fileName }}>
                        {attachment.fileName}
                      </Typography.Text>
                    )}
                    <Typography.Text>{formatFileSize(attachment.size)}</Typography.Text>
                    <Space size={2} wrap={false}>
                      {(canManageAll || attachment.uploadedBy === currentUserId) && onRenameAttachment ? (
                        <Button
                          type="link"
                          size="small"
                          onClick={() => {
                            const editable = editableAttachmentFileName(attachment);
                            setRenameDraft({
                              attachmentId: attachment.id,
                              baseName: editable.baseName,
                              extension: editable.extension
                            });
                          }}
                        >
                          改名
                        </Button>
                      ) : null}
                      {(canManageAll || attachment.uploadedBy === currentUserId) && onDeleteAttachment ? (
                        <Button
                          type="link"
                          danger
                          size="small"
                          onClick={() => {
                            if (!charge) return;
                            Modal.confirm({
                              title: "确认删除费用附件？",
                              content: "只删除附件，费用记录会继续保留；删除日志仍会永久保留。",
                              okText: "确认删除",
                              okButtonProps: { danger: true },
                              cancelText: "取消",
                              onOk: () => onDeleteAttachment(charge, attachment.id)
                            });
                          }}
                        >
                          删除
                        </Button>
                      ) : null}
                    </Space>
                  </div>
                ))}
              </div>
            </div>

            {onAddAttachments ? (
              <ClientAttachmentPicker
                value={attachmentDraft}
                onChange={setAttachmentDraft}
                allowRename
                defaultCategory="order_charge"
                defaultVisibility="internal_only"
                showCamera={false}
                compact
                compactLabel="添加附件"
                compactTrailingAction={(
                  <Button
                    loading={addingAttachments}
                    disabled={attachmentDraft.length === 0}
                    onClick={async () => {
                      if (!charge || attachmentDraft.length === 0) return;
                      setAddingAttachments(true);
                      try {
                        await onAddAttachments(charge, attachmentDraft);
                        setAttachmentDraft([]);
                        messageApi.success("费用附件已添加");
                      } catch (error) {
                        messageApi.error(error instanceof Error ? error.message : "费用附件添加失败");
                      } finally {
                        setAddingAttachments(false);
                      }
                    }}
                  >
                    添加附件
                  </Button>
                )}
              />
            ) : null}
          </section>
        </Space>
      </Modal>

      <Modal
        title="修改附件展示名称"
        open={Boolean(renameDraft)}
        okText="保存"
        cancelText="取消"
        confirmLoading={renaming}
        okButtonProps={{
          disabled: Boolean(
            renameDraft && validateAttachmentFileNameBody(renameDraft.baseName, renameDraft.extension)
          )
        }}
        onCancel={() => setRenameDraft(undefined)}
        onOk={async () => {
          if (!charge || !renameDraft || !onRenameAttachment) return;
          const error = validateAttachmentFileNameBody(renameDraft.baseName, renameDraft.extension);
          if (error) return;
          setRenaming(true);
          try {
            await onRenameAttachment(charge, renameDraft.attachmentId, renameDraft.baseName.trim());
            setRenameDraft(undefined);
            messageApi.success("附件名称已更新");
          } catch (error) {
            messageApi.error(error instanceof Error ? error.message : "附件名称修改失败");
          } finally {
            setRenaming(false);
          }
        }}
      >
        <Typography.Paragraph type="secondary">
          只修改文件名主体，扩展名被锁定；真实文件和预览下载地址不会改变。
        </Typography.Paragraph>
        {renameDraft ? (
          <>
            <Input
              autoFocus
              value={renameDraft.baseName}
              {...(validateAttachmentFileNameBody(renameDraft.baseName, renameDraft.extension)
                ? { status: "error" as const }
                : {})}
              addonAfter={renameDraft.extension || "无扩展名"}
              onChange={(event) => setRenameDraft({ ...renameDraft, baseName: event.target.value })}
            />
            {validateAttachmentFileNameBody(renameDraft.baseName, renameDraft.extension) ? (
              <Typography.Text type="danger">
                {validateAttachmentFileNameBody(renameDraft.baseName, renameDraft.extension)}
              </Typography.Text>
            ) : null}
          </>
        ) : null}
      </Modal>
      <AttachmentPreviewModal
        request={previewRequest}
        onClose={() => setPreviewRequest(undefined)}
      />
    </>
  );
}
