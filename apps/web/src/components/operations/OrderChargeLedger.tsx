import { EditOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, InputNumber, Modal, Space, Tag, Typography, message } from "antd";
import { decimalInputProps } from "../forms/numericInputProps";
import { useState } from "react";
import { ROLE_LABELS } from "@sample-room/shared";
import type { AttachmentMetadataInput, OrderAttachment, OrderChargeCreatePayload, OrderChargeRecord } from "../../api/sampleRoomApi";
import { ClientAttachmentPicker } from "../ClientAttachmentPicker";
import { OrderChargeList } from "../orders/OrderChargeList";
import { isSafeAttachmentPreviewMime } from "../attachments/attachmentPreview";
import {
  editableAttachmentFileName,
  validateAttachmentFileNameBody
} from "../attachmentFileName";

type ChargeFormValues = Omit<OrderChargeCreatePayload, "sourceScene">;

export function OrderChargeLedger({
  charges = [],
  sourceScene,
  canAdd = false,
  canReview = false,
  loading = false,
  onAdd,
  onEdit,
  onReview,
  onVoid,
  allowAttachments = false,
  currentUserId,
  canManageAll = false,
  onVoidOwn,
  onAddAttachments,
  onRenameAttachment,
  onDeleteAttachment,
  loadAttachmentBlob,
  onPreviewAttachment,
  onDownloadAttachment,
  desktopModalLayout = false,
  effectiveTotal
}: {
  charges?: OrderChargeRecord[];
  sourceScene: string;
  canAdd?: boolean;
  canReview?: boolean;
  loading?: boolean;
  onAdd?: (payload: OrderChargeCreatePayload, attachments: AttachmentMetadataInput[]) => Promise<void>;
  onEdit?: (charge: OrderChargeRecord, payload: OrderChargeCreatePayload) => Promise<void>;
  onReview?: (charge: OrderChargeRecord) => Promise<void>;
  onVoid?: (charge: OrderChargeRecord, reason: string) => Promise<void>;
  allowAttachments?: boolean;
  currentUserId?: string;
  canManageAll?: boolean;
  onVoidOwn?: (charge: OrderChargeRecord) => Promise<void>;
  onAddAttachments?: (charge: OrderChargeRecord, attachments: AttachmentMetadataInput[]) => Promise<void>;
  onRenameAttachment?: (charge: OrderChargeRecord, attachmentId: string, displayName: string) => Promise<void>;
  onDeleteAttachment?: (charge: OrderChargeRecord, attachmentId: string) => Promise<void>;
  loadAttachmentBlob?: (attachment: OrderAttachment) => Promise<Blob>;
  onPreviewAttachment?: (attachment: OrderAttachment) => Promise<void>;
  onDownloadAttachment?: (attachmentId: string, fileName?: string) => Promise<void>;
  desktopModalLayout?: boolean;
  effectiveTotal?: number;
}) {
  const [form] = Form.useForm<ChargeFormValues>();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<OrderChargeRecord>();
  const [voiding, setVoiding] = useState<OrderChargeRecord>();
  const [voidReason, setVoidReason] = useState("");
  const [attachmentDraft, setAttachmentDraft] = useState<AttachmentMetadataInput[]>([]);
  const [attachmentCharge, setAttachmentCharge] = useState<OrderChargeRecord>();
  const [existingAttachmentDraft, setExistingAttachmentDraft] = useState<AttachmentMetadataInput[]>([]);
  const [renamingAttachment, setRenamingAttachment] = useState<{
    charge: OrderChargeRecord;
    attachmentId: string;
    baseName: string;
    extension: string;
  }>();
  const [renaming, setRenaming] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const visibleCharges = charges.filter(
    (charge) => !charge.archivedAt && charge.status !== "void"
  );

  const submit = async () => {
    if (!onAdd && !onEdit) return;
    const values = await form.validateFields();
    setAdding(true);
    try {
      const payload = { ...values, sourceScene };
      if (editing && onEdit) {
        await onEdit(editing, payload);
      } else if (onAdd) {
        await onAdd(payload, attachmentDraft);
      }
      form.resetFields();
      setAttachmentDraft([]);
      setEditing(undefined);
      messageApi.success(editing ? "其他费用已更新" : "其他费用已登记");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "费用追加失败");
    } finally {
      setAdding(false);
    }
  };

  const confirmVoid = async () => {
    if (!voiding || !onVoid || !voidReason.trim()) return;
    try {
      await onVoid(voiding, voidReason.trim());
      setVoiding(undefined);
      setVoidReason("");
      messageApi.success("费用记录已作废并保留审计记录");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "费用作废失败");
    }
  };

  const review = async (charge: OrderChargeRecord) => {
    if (!onReview) return;
    try {
      await onReview(charge);
      messageApi.success("费用已复核");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "费用复核失败");
    }
  };

  const voidOwn = (charge: OrderChargeRecord) => {
    if (!onVoidOwn) return;
    Modal.confirm({
      title: "确认删除这条其他费用？",
      content: "费用会从当前明细中移除，删除记录仍会永久保留并仅供老板审计。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => onVoidOwn(charge)
    });
  };

  const deleteAttachment = (charge: OrderChargeRecord, attachmentId: string) => {
    if (!onDeleteAttachment) return;
    Modal.confirm({
      title: "确认删除费用附件？",
      content: "只删除附件，费用记录会继续保留；删除日志仍会永久保留。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => onDeleteAttachment(charge, attachmentId)
    });
  };

  const canMaintainOwnCharge = (charge: OrderChargeRecord) =>
    charge.creatorId === currentUserId &&
    (charge.status === "pending" || charge.status === "effective");

  const beginEditingCharge = (charge: OrderChargeRecord) => {
    setEditing(charge);
    form.setFieldsValue({
      name: charge.name,
      amount: charge.amount,
      explanation: charge.explanation
    });
  };

  const attachmentPicker = allowAttachments && !editing ? (
    <Form.Item className="order-charge-attachment-picker">
      <ClientAttachmentPicker
        value={attachmentDraft}
        onChange={setAttachmentDraft}
        allowRename
        defaultCategory="order_charge"
        defaultVisibility="internal_only"
        showCamera={false}
        title="上传文件（可选）"
        description="可选择费用凭证文件。"
      />
    </Form.Item>
  ) : null;

  return (
    <Card
      size="small"
      title={desktopModalLayout ? "新增费用" : "其他费用"}
      loading={loading}
      {...(desktopModalLayout ? { className: "order-charge-ledger-modal" } : {})}
    >
      {contextHolder}
      <Space direction="vertical" size={10} className="full-width">
        {canAdd ? (
          <Form form={form} layout={desktopModalLayout ? "vertical" : "inline"} className={`order-charge-form${desktopModalLayout ? " is-modal" : ""}`}>
            <Form.Item {...(desktopModalLayout ? { label: "费用名称" } : {})} name="name" rules={[{ required: true, message: "请输入费用名称" }]}>
              <Input placeholder="费用名称" />
            </Form.Item>
            <Form.Item {...(desktopModalLayout ? { label: "金额（¥）" } : {})} name="amount" rules={[{ required: true, message: "请输入金额" }]}>
              <InputNumber {...decimalInputProps} min={0.01} precision={2} prefix="¥" placeholder="金额" className="full-width" />
            </Form.Item>
            {desktopModalLayout ? <Form.Item label="说明（可选）" name="explanation">
              <Input placeholder="请输入说明" />
            </Form.Item> : null}
            {desktopModalLayout ? (
              <div className="order-charge-attachment-layout">
                <ClientAttachmentPicker
                  value={attachmentDraft}
                  onChange={setAttachmentDraft}
                  allowRename
                  defaultCategory="order_charge"
                  defaultVisibility="internal_only"
                  showCamera={false}
                  compact
                  compactLabel="费用凭证附件（可选）"
                  compactTrailingAction={(
                    <Button type="primary" loading={adding} onClick={() => void submit()}>
                      登记费用
                    </Button>
                  )}
                />
              </div>
            ) : (
              <>
                {attachmentPicker}
                <Button type="primary" loading={adding} onClick={() => void submit()}>
                  {editing ? "保存修改" : "登记费用"}
                </Button>
                {editing ? (
                  <Button
                    onClick={() => {
                      setEditing(undefined);
                      form.resetFields();
                    }}
                  >
                    取消编辑
                  </Button>
                ) : null}
              </>
            )}
          </Form>
        ) : null}
        {desktopModalLayout ? (
          <div className="order-charge-desktop-section">
            <div className="order-charge-desktop-heading">
              <Typography.Text strong>已登记费用（{charges.length} 条）</Typography.Text>
              <span className="order-charge-desktop-total">
                <Typography.Text type="secondary">有效其他费用合计</Typography.Text>
                <Typography.Text strong>¥{(effectiveTotal ?? 0).toFixed(2)}</Typography.Text>
              </span>
            </div>
            <OrderChargeList
              charges={charges}
              currentUserId={currentUserId}
              canManageAll={canManageAll}
              scrollable
              {...(onEdit
                ? {
                    onEdit: (charge, values) =>
                      onEdit(charge, { ...values, sourceScene })
                  }
                : {})}
              {...(onVoidOwn ? { onDelete: onVoidOwn } : {})}
              {...(onAddAttachments ? { onAddAttachments } : {})}
              {...(onRenameAttachment ? { onRenameAttachment } : {})}
              {...(onDeleteAttachment ? { onDeleteAttachment } : {})}
              {...(loadAttachmentBlob ? { loadAttachmentBlob } : {})}
            />
          </div>
        ) : visibleCharges.length === 0 ? (
          <Typography.Text type="secondary">暂无其他费用记录</Typography.Text>
        ) : visibleCharges.map((charge) => (
          <div className="order-charge-row" key={charge.id}>
            <div>
              <Space wrap>
                <Typography.Text strong>{charge.name}</Typography.Text>
                <Typography.Text strong>¥{charge.amount.toFixed(2)}</Typography.Text>
                <Tag
                  color={
                    charge.status === "confirmed" || charge.status === "effective"
                      ? "green"
                      : charge.status === "pending"
                        ? "orange"
                        : "default"
                  }
                >
                  {desktopModalLayout
                    ? charge.status === "effective"
                      ? "已生效"
                      : charge.status === "confirmed"
                        ? "已确认"
                        : charge.status === "pending"
                          ? "待确认，仅兼容历史数据"
                          : charge.status === "rejected"
                            ? "已驳回"
                            : "已取消"
                    : charge.status === "confirmed" || charge.status === "effective"
                      ? "已确认"
                      : charge.status === "pending"
                        ? "待确认"
                        : charge.status === "rejected"
                          ? "已驳回"
                          : "已取消"}
                </Tag>
              </Space>
              <Typography.Paragraph type="secondary" className="order-charge-explanation">
                {desktopModalLayout ? `说明：${charge.explanation || "无"} · ` : ""}
                登记角色：{ROLE_LABELS[charge.creatorRole as keyof typeof ROLE_LABELS] ?? charge.creatorRole}
                {" · "}登记人：{charge.creatorName ?? charge.creatorId}
                {" · "}登记时间：{desktopModalLayout
                  ? new Date(charge.createdAt).toLocaleString("zh-CN")
                  : new Date(charge.createdAt).toLocaleDateString("zh-CN")}
                {charge.voidReason ? ` · 作废原因：${charge.voidReason}` : ""}
              </Typography.Paragraph>
              {(charge.attachments ?? []).map((attachment) => (
                <Space key={attachment.id} wrap size={6} className="order-charge-attachment-row">
                  <Typography.Text>{attachment.fileName}</Typography.Text>
                  {attachment.uploadedBy === currentUserId && onRenameAttachment ? (
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      aria-label={`修改附件 ${attachment.fileName} 展示名称`}
                      onClick={() => {
                        const editable = editableAttachmentFileName(attachment);
                        setRenamingAttachment({
                          charge,
                          attachmentId: attachment.id,
                          baseName: editable.baseName,
                          extension: editable.extension
                        });
                      }}
                    />
                  ) : null}
                  {onPreviewAttachment && isSafeAttachmentPreviewMime(attachment.mimeType) ? (
                    <Button size="small" onClick={() => void onPreviewAttachment(attachment)}>预览</Button>
                  ) : null}
                  {onDownloadAttachment ? (
                    <Button
                      size="small"
                      onClick={() => void onDownloadAttachment(attachment.id, attachment.fileName)}
                    >
                      下载
                    </Button>
                  ) : null}
                  {attachment.uploadedBy === currentUserId && onDeleteAttachment ? (
                    <Button danger size="small" onClick={() => deleteAttachment(charge, attachment.id)}>删除附件</Button>
                  ) : null}
                </Space>
              ))}
            </div>
            {canReview && charge.status === "effective" ? (
              <Space>
                {!charge.reviewedAt && onReview ? <Button size="small" onClick={() => void review(charge)}>复核</Button> : null}
                {onVoid ? <Button danger size="small" onClick={() => setVoiding(charge)}>作废</Button> : null}
              </Space>
            ) : null}
            {charge.creatorId === currentUserId ? (
              <Space wrap>
                {(charge.status === "pending" || charge.status === "effective") && onEdit ? (
                  <Button
                    size="small"
                    onClick={() => {
                      beginEditingCharge(charge);
                    }}
                  >
                    编辑
                  </Button>
                ) : null}
                {onAddAttachments && (!desktopModalLayout || charge.status === "pending" || charge.status === "effective") ? (
                  <Button size="small" onClick={() => setAttachmentCharge(charge)}>添加附件</Button>
                ) : null}
                {onVoidOwn && (charge.status === "pending" || charge.status === "effective") ? (
                  <Button danger size="small" onClick={() => voidOwn(charge)}>删除费用</Button>
                ) : null}
              </Space>
            ) : null}
          </div>
        ))}
      </Space>
      <Modal
        title="作废费用记录"
        open={Boolean(voiding)}
        okText="确认作废"
        okButtonProps={{ danger: true, disabled: !voidReason.trim() }}
        onOk={() => void confirmVoid()}
        onCancel={() => { setVoiding(undefined); setVoidReason(""); }}
      >
        <Typography.Paragraph>记录不会删除；作废后保留完整审计信息。</Typography.Paragraph>
        <Input.TextArea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="必填：作废原因" rows={3} />
      </Modal>
      <Modal
        title="添加费用附件"
        open={Boolean(attachmentCharge)}
        okText="上传附件"
        okButtonProps={{ disabled: existingAttachmentDraft.length === 0 }}
        onCancel={() => { setAttachmentCharge(undefined); setExistingAttachmentDraft([]); }}
        onOk={async () => {
          if (!attachmentCharge || !onAddAttachments || existingAttachmentDraft.length === 0) return;
          await onAddAttachments(attachmentCharge, existingAttachmentDraft);
          setAttachmentCharge(undefined);
          setExistingAttachmentDraft([]);
        }}
      >
        <ClientAttachmentPicker
          value={existingAttachmentDraft}
          onChange={setExistingAttachmentDraft}
          allowRename
          defaultCategory="order_charge"
          defaultVisibility="internal_only"
          showCamera={false}
          title="上传文件"
          description="可选择费用凭证文件。"
        />
      </Modal>
      <Modal
        title="修改附件展示名称"
        open={Boolean(renamingAttachment)}
        okText="保存"
        cancelText="取消"
        confirmLoading={renaming}
        okButtonProps={{
          disabled: Boolean(
            renamingAttachment &&
              validateAttachmentFileNameBody(
                renamingAttachment.baseName,
                renamingAttachment.extension
              )
          )
        }}
        onCancel={() => setRenamingAttachment(undefined)}
        onOk={async () => {
          if (!renamingAttachment || !onRenameAttachment) return;
          const error = validateAttachmentFileNameBody(
            renamingAttachment.baseName,
            renamingAttachment.extension
          );
          if (error) return;
          setRenaming(true);
          try {
            await onRenameAttachment(
              renamingAttachment.charge,
              renamingAttachment.attachmentId,
              renamingAttachment.baseName.trim()
            );
            setRenamingAttachment(undefined);
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
        {renamingAttachment ? (
          <>
            <Input
              autoFocus
              aria-label="附件文件名主体"
              value={renamingAttachment.baseName}
              {...(validateAttachmentFileNameBody(
                renamingAttachment.baseName,
                renamingAttachment.extension
              )
                ? { status: "error" as const }
                : {})}
              addonAfter={renamingAttachment.extension || "无扩展名"}
              onChange={(event) =>
                setRenamingAttachment({ ...renamingAttachment, baseName: event.target.value })
              }
            />
            {validateAttachmentFileNameBody(
              renamingAttachment.baseName,
              renamingAttachment.extension
            ) ? (
              <Typography.Text type="danger">
                {validateAttachmentFileNameBody(
                  renamingAttachment.baseName,
                  renamingAttachment.extension
                )}
              </Typography.Text>
            ) : null}
          </>
        ) : null}
      </Modal>
    </Card>
  );
}
