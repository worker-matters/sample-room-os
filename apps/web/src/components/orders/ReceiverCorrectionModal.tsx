import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
  message
} from "antd";
import { integerInputProps } from "../forms/numericInputProps";
import {
  hasPhysicalProductionRoute,
  sampleRoundOptions,
  sampleRequestItemOptions,
} from "@sample-room/shared";
import { attachmentSelectionError } from "../ClientAttachmentPicker";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent
} from "react";
import type {
  AttachmentMetadataInput,
  OrderAttachment,
  OrderRecord,
  ReceiverCorrectionPayload
} from "../../api/sampleRoomApi";
import {
  isSafeAttachmentPreviewMime,
  isSafeImagePreviewMime
} from "../attachments/attachmentPreview";
import { fabricOptions, trimOptions } from "../StatusTags";
import { getOrderBusinessUserName, getOrderCustomerName } from "./orderDisplay";
import { useSampleTypeOptions } from "../../app/SampleTypeOptionsContext";
import { viewportBoundDialogWidth } from "../dialogLayout";
import { getOrderThumbnailAttachment } from "./orderThumbnail";
import { ParallelProgress } from "../operations/ParallelProgress";

export type ReceiverCorrectionSubmitIntent = "draft" | "complete";

export type ReceiverCorrectionSubmitOptions = {
  intent: ReceiverCorrectionSubmitIntent;
  thumbnailAttachments: AttachmentMetadataInput[];
};

type ReceiverCorrectionModalProps = {
  open: boolean;
  order: OrderRecord | null;
  onCancel: () => void;
  onSubmit: (
    values: ReceiverCorrectionPayload,
    options: ReceiverCorrectionSubmitOptions
  ) => Promise<void> | void;
  onDownloadAttachment?: (order: OrderRecord, attachment: OrderAttachment) => Promise<void> | void;
  onLoadAttachmentPreview?: (order: OrderRecord, attachment: OrderAttachment) => Promise<Blob>;
  currentUserId?: string;
  onUploadSampleSheet?: (
    order: OrderRecord,
    attachment: AttachmentMetadataInput
  ) => Promise<OrderAttachment[]>;
  onSelectSampleSheet?: (
    order: OrderRecord,
    attachmentId: string
  ) => Promise<OrderAttachment[]>;
};

function clipboardImageFileName(mimeType: string) {
  const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return `pasted-thumbnail-${Date.now()}.${extension}`;
}

export function canEditOrderQuantityForReceiver(
  order: Pick<OrderRecord, "quantityCorrectionLocked">
) {
  return order.quantityCorrectionLocked !== true;
}

export function initialCorrectionSampleRequestItems(
  order: Pick<OrderRecord, "intakeStatus" | "sampleRequestItems" | "correctionLogs">
) {
  const currentItems = order.sampleRequestItems ?? [];
  const hasSavedTaskCorrection = order.correctionLogs?.some(
    (entry) => entry.fieldName === "sampleRequestItems"
  );

  if (order.intakeStatus !== "pending_receive" || hasSavedTaskCorrection) {
    return currentItems;
  }

  return currentItems;
}

function toThumbnailAttachment(file: File): AttachmentMetadataInput {
  return {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    category: "style_thumbnail",
    visibility: "client_visible",
    file
  };
}

function isPreviewableAttachment(attachment: OrderAttachment) {
  return (
    attachment.hasFile === true &&
    isSafeAttachmentPreviewMime(attachment.mimeType)
  );
}

function isSampleSheetAttachmentType(attachment: Pick<OrderAttachment, "fileName" | "mimeType" | "hasFile">) {
  const fileName = attachment.fileName.toLowerCase();
  return attachment.hasFile === true && (
    attachment.mimeType.startsWith("image/") ||
    attachment.mimeType === "application/pdf" ||
    attachment.mimeType === "application/vnd.ms-excel" ||
    attachment.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    fileName.endsWith(".xls") ||
    fileName.endsWith(".xlsx")
  );
}

const blockedSampleSheetCategories = new Set([
  "receiver_attachment",
  "receiver_material_record",
  "order_charge"
]);

function isLegalSampleSheetPreview(attachment: OrderAttachment) {
  return !blockedSampleSheetCategories.has(attachment.category) && isSampleSheetAttachmentType(attachment);
}

export function receiverSampleSheetAttachment(
  attachments: readonly OrderAttachment[],
  _currentUserId?: string
) {
  const legalAttachments = attachments.filter(isLegalSampleSheetPreview);
  const receiverOwnedAttachments = legalAttachments.filter((attachment) =>
    attachment.uploadedByRole === "receiver" &&
    (!_currentUserId || attachment.uploadedBy === _currentUserId)
  );
  return receiverOwnedAttachments.find((attachment) => attachment.category === "receiver_sample_sheet")
    ?? receiverOwnedAttachments.find((attachment) => attachment.category === "style_thumbnail")
    ?? legalAttachments.find((attachment) => attachment.category === "client_quick_photo")
    ?? receiverOwnedAttachments[0];
}

function toSampleSheetAttachment(file: File): AttachmentMetadataInput {
  return {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    category: "receiver_attachment",
    visibility: "client_visible",
    file
  };
}

export function ReceiverCorrectionModal({
  open,
  order,
  onCancel,
  onSubmit,
  onDownloadAttachment,
  onLoadAttachmentPreview,
  currentUserId,
  onUploadSampleSheet,
  onSelectSampleSheet
}: ReceiverCorrectionModalProps) {
  const { options: sampleTypeOptions } = useSampleTypeOptions();
  const [form] = Form.useForm<ReceiverCorrectionPayload>();
  const selectedSampleRequestItems = Form.useWatch("sampleRequestItems", form) ?? [];
  const hasPhysicalProduction = hasPhysicalProductionRoute(selectedSampleRequestItems);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const sampleSheetInputRef = useRef<HTMLInputElement>(null);
  const thumbnailUploadRef = useRef<HTMLDivElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [previewAttachment, setPreviewAttachment] = useState<OrderAttachment>();
  const [thumbnailUrl, setThumbnailUrl] = useState<string>();
  const [thumbnailDraft, setThumbnailDraft] = useState<AttachmentMetadataInput>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string>();
  const [currentAttachments, setCurrentAttachments] = useState<OrderAttachment[]>([]);
  const [sampleSheetPickerOpen, setSampleSheetPickerOpen] = useState(false);
  const [sampleSheetPickerId, setSampleSheetPickerId] = useState<string>();
  const [sampleSheetSaving, setSampleSheetSaving] = useState(false);
  const [previewTransform, setPreviewTransform] = useState({ scale: 1, x: 0, y: 0 });
  const dragStateRef = useRef<{
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | undefined>(undefined);
  const [submittingIntent, setSubmittingIntent] = useState<ReceiverCorrectionSubmitIntent>();
  const quantityEditable = order ? canEditOrderQuantityForReceiver(order) : true;

  useEffect(() => {
    if (!order || !open) {
      return;
    }

    form.setFieldsValue({
      styleNo: order.styleNo,
      styleName: order.styleName,
      quantity: order.quantity,
      sampleType: order.sampleType,
      sampleRound: order.sampleRound,
      deliveryDate: order.deliveryDate,
      remark: order.remark,
      fabricStatus: order.fabricStatus,
      trimStatus: order.trimStatus,
      sampleRequestItems: initialCorrectionSampleRequestItems(order)
    });
    setCurrentAttachments(order.attachments ?? []);
  }, [form, open, order]);

  const loadPreview = async (attachment: OrderAttachment) => {
    if (!order || !onLoadAttachmentPreview || !attachment.hasFile) {
      return;
    }

    setPreviewLoading(true);
    setPreviewError(undefined);
    try {
      const blob = await onLoadAttachmentPreview(order, attachment);
      if (!isSafeAttachmentPreviewMime(blob.type)) {
        throw new Error("当前附件仅支持下载。");
      }
      setPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return URL.createObjectURL(blob);
      });
      setPreviewAttachment(attachment);
      setPreviewTransform({ scale: 1, x: 0, y: 0 });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "附件预览加载失败");
    } finally {
      setPreviewLoading(false);
    }
  };

  const loadExistingThumbnail = async () => {
    if (!order || !onLoadAttachmentPreview) {
      return;
    }

    const thumbnail = getOrderThumbnailAttachment(order);
    if (!thumbnail) {
      setThumbnailUrl(undefined);
      return;
    }

    try {
      const blob = await onLoadAttachmentPreview(order, thumbnail);
      if (!isSafeImagePreviewMime(blob.type)) {
        throw new Error("当前缩略图不是可安全预览的图片。");
      }
      setThumbnailUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return URL.createObjectURL(blob);
      });
    } catch {
      setThumbnailUrl(undefined);
    }
  };

  useEffect(() => {
    if (!open || !order) {
      setPreviewAttachment(undefined);
      setPreviewError(undefined);
      setThumbnailDraft(undefined);
      setPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return undefined;
      });
      setThumbnailUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return undefined;
      });
      return;
    }

    const sampleSheet = receiverSampleSheetAttachment(order.attachments ?? [], currentUserId);
    if (sampleSheet && isPreviewableAttachment(sampleSheet)) {
      void loadPreview(sampleSheet);
    } else {
      setPreviewAttachment(sampleSheet);
      setPreviewUrl(undefined);
    }
    void loadExistingThumbnail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id, currentUserId]);

  const availableSampleSheets = currentAttachments.filter(
    (attachment) =>
      attachment.uploadedByRole === "receiver" &&
      (!currentUserId || attachment.uploadedBy === currentUserId) &&
      isLegalSampleSheetPreview(attachment)
  );
  const sampleSheet = receiverSampleSheetAttachment(currentAttachments, currentUserId);

  const applyAttachments = async (attachments: OrderAttachment[]) => {
    setCurrentAttachments(attachments);
    const next = receiverSampleSheetAttachment(attachments, currentUserId);
    if (next && isPreviewableAttachment(next)) {
      await loadPreview(next);
    } else {
      setPreviewAttachment(next);
      setPreviewUrl(undefined);
      setPreviewTransform({ scale: 1, x: 0, y: 0 });
    }
  };

  const uploadSampleSheet = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = Array.from(event.target.files ?? [])[0];
    event.target.value = "";
    if (!file || !order || !onUploadSampleSheet) return;
    const selectionError = attachmentSelectionError([file]);
    if (selectionError) {
      message.error(selectionError);
      return;
    }
    setSampleSheetSaving(true);
    try {
      await applyAttachments(await onUploadSampleSheet(order, toSampleSheetAttachment(file)));
      message.success("已替换打样单附件");
    } finally {
      setSampleSheetSaving(false);
    }
  };

  const confirmSampleSheetSelection = async () => {
    if (!order || !sampleSheetPickerId || !onSelectSampleSheet) return;
    setSampleSheetSaving(true);
    try {
      await applyAttachments(await onSelectSampleSheet(order, sampleSheetPickerId));
      setSampleSheetPickerOpen(false);
      message.success("已更新打样单附件");
    } finally {
      setSampleSheetSaving(false);
    }
  };

  const onPreviewWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nextScale = Math.min(4, Math.max(0.5, previewTransform.scale - event.deltaY * 0.001));
    setPreviewTransform((current) => ({ ...current, scale: nextScale }));
  };

  const onPreviewPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStateRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: previewTransform.x,
      originY: previewTransform.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPreviewPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    setPreviewTransform((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.x,
      y: drag.originY + event.clientY - drag.y
    }));
  };

  useEffect(
    () => () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      if (thumbnailUrl) {
        URL.revokeObjectURL(thumbnailUrl);
      }
    },
    [previewUrl, thumbnailUrl]
  );

  const setThumbnailFile = (file: File) => {
    const selectionError = attachmentSelectionError([file]);
    if (selectionError) {
      message.error(selectionError);
      return;
    }
    setThumbnailDraft(toThumbnailAttachment(file));
    setThumbnailUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return URL.createObjectURL(file);
    });
  };

  const onThumbnailFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = Array.from(event.target.files ?? []).find((item) => item.type.startsWith("image/"));
    if (file) {
      setThumbnailFile(file);
    }
    event.target.value = "";
  };

  const openThumbnailPicker = () => {
    thumbnailInputRef.current?.click();
  };

  const onThumbnailPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const file = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((item): item is File => Boolean(item))
      .find((item) => item.type.startsWith("image/"));
    if (file) {
      event.preventDefault();
      setThumbnailFile(file);
    }
  };

  const readClipboardThumbnail = async () => {
    if (!navigator.clipboard?.read) {
      message.warning("浏览器未允许直接读取剪贴板，请点击上传区域后按 Ctrl+V。");
      thumbnailUploadRef.current?.focus();
      return;
    }

    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) {
          continue;
        }
        const blob = await item.getType(imageType);
        setThumbnailFile(new File([blob], clipboardImageFileName(imageType), { type: imageType }));
        message.success("已从剪贴板粘贴款式缩略图");
        return;
      }
      message.warning("剪贴板中没有可粘贴的图片。");
    } catch {
      message.warning("浏览器未允许直接读取剪贴板，请点击上传区域后按 Ctrl+V。");
      thumbnailUploadRef.current?.focus();
    }
  };

  const submit = async (intent: ReceiverCorrectionSubmitIntent) => {
    const values = intent === "draft"
      ? form.getFieldsValue(true)
      : await form.validateFields();
    if (intent === "complete" && (values.sampleRequestItems?.length ?? 0) === 0) {
      form.setFields([{ name: "sampleRequestItems", errors: ["请至少选择一个打样任务"] }]);
      return;
    }
    setSubmittingIntent(intent);
    try {
      await onSubmit(values, {
        intent,
        thumbnailAttachments: thumbnailDraft ? [thumbnailDraft] : []
      });
    } catch (error) {
      Modal.warning({
        title: "操作未完成",
        content: error instanceof Error ? error.message : "订单状态已变化，请刷新后重试。",
        okText: "知道了"
      });
    } finally {
      setSubmittingIntent(undefined);
    }
  };

  const renderPreview = () => {
    if (!previewAttachment) {
      return (
        <div className="receiver-correction-preview-empty">
          <Typography.Text type="secondary">
            暂无可预览的打样单照片、PDF 或 Excel。
          </Typography.Text>
        </div>
      );
    }

    if (!previewUrl) {
      return (
        <div className="receiver-correction-preview-document">
          <Tag color="green">Excel</Tag>
          <Typography.Text strong>{previewAttachment.fileName}</Typography.Text>
          <Typography.Text type="secondary">表格文件请下载查看完整内容</Typography.Text>
          {onDownloadAttachment && order ? (
            <Button onClick={() => void onDownloadAttachment(order, previewAttachment)}>下载查看</Button>
          ) : null}
        </div>
      );
    }

    const transformStyle = {
      transform: `translate(${previewTransform.x}px, ${previewTransform.y}px) scale(${previewTransform.scale})`
    };

    if (isSafeImagePreviewMime(previewAttachment.mimeType)) {
      return (
        <img
          className="receiver-correction-preview-image"
          src={previewUrl}
          alt={previewAttachment.fileName}
          style={transformStyle}
          draggable={false}
        />
      );
    }

    if (previewAttachment.mimeType === "application/pdf") {
      return (
        <iframe
          className="receiver-correction-preview-pdf"
          src={previewUrl}
          title={previewAttachment.fileName}
          style={transformStyle}
          tabIndex={-1}
        />
      );
    }

    return <Typography.Text type="secondary">当前附件格式不能直接预览，请下载查看。</Typography.Text>;
  };

  return (
    <>
    <Modal
      title="校正订单资料"
      open={open}
      onCancel={onCancel}
      destroyOnHidden
      width={viewportBoundDialogWidth("workspace")}
      className="app-workspace-modal app-workspace-modal-data receiver-correction-wide-modal"
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button
          key="draft"
          loading={submittingIntent === "draft"}
          onClick={() => void submit("draft")}
        >
          保存草稿
        </Button>,
        <Button
          key="complete"
          type="primary"
          loading={submittingIntent === "complete"}
          onClick={() => void submit("complete")}
        >
          完成校正并进入订单列表
        </Button>
      ]}
    >
      <Space
        direction="vertical"
        size={12}
        className="full-width receiver-correction-modal"
        onPaste={onThumbnailPaste}
      >
        {order ? (
          <div
            ref={thumbnailUploadRef}
            className="receiver-correction-identity-band"
            tabIndex={0}
          >
            <div className="receiver-correction-thumbnail-current">
              {thumbnailUrl ? <img src={thumbnailUrl} alt="款式缩略图" /> : <span>暂无缩略图</span>}
              <input
                ref={thumbnailInputRef}
                type="file"
                accept="image/*"
                onChange={onThumbnailFileChange}
              />
            </div>
            <Space direction="vertical" size={4} className="receiver-correction-thumbnail-controls">
              <Button size="small" type="primary" ghost onClick={openThumbnailPicker}>
                更换缩略图
              </Button>
              <Button size="small" type="text" onClick={() => void readClipboardThumbnail()}>
                Ctrl+V 粘贴
              </Button>
            </Space>
            <div className="receiver-correction-identity-copy">
              <div className="receiver-correction-summary-grid">
                <div>
                  <Typography.Text type="secondary">临时款号</Typography.Text>
                  <Typography.Title level={4}>{order.styleNo}</Typography.Title>
                </div>
                <div>
                  <Typography.Text type="secondary">款名</Typography.Text>
                  <Typography.Text>{order.styleName}</Typography.Text>
                </div>
                <div>
                  <Typography.Text type="secondary">客户</Typography.Text>
                  <Typography.Text strong>{getOrderCustomerName(order)}</Typography.Text>
                </div>
                <div>
                  <Typography.Text type="secondary">客户业务员</Typography.Text>
                  <Typography.Text strong>{getOrderBusinessUserName(order)}</Typography.Text>
                </div>
              </div>
            </div>
            <div className="receiver-correction-status-summary">
              <div>
                <Typography.Text type="secondary">来源</Typography.Text>
                <Tag color={order.sourceType === "client_submission" ? "green" : "blue"}>
                  {order.sourceType === "client_submission" ? "客户提交" : "接单员录入"}
                </Tag>
              </div>
              <div>
                <Typography.Text type="secondary">当前状态</Typography.Text>
                <Tag color={order.intakeStatus === "pending_receive" ? "orange" : "blue"}>
                  {order.intakeStatus === "pending_receive" ? "待校正" : "已接单"}
                </Tag>
              </div>
            </div>
          </div>
        ) : null}

        {!quantityEditable ? (
          <Alert type="warning" showIcon message="裁剪已提交或缝制已接单，件数不可修改。" />
        ) : null}

        <div className="receiver-correction-review-layout">
          <Card
            size="small"
            title={(
              <Space size={6} wrap>
                <span>打样单照片 / PDF / Excel 预览</span>
                {sampleSheet ? <Tag color="blue">打样单</Tag> : null}
              </Space>
            )}
            className="receiver-correction-attachment-card"
          >
            <Space direction="vertical" size={8} className="full-width">
              <div
                className={`receiver-correction-preview${dragStateRef.current ? " is-dragging" : ""}`}
                onWheel={onPreviewWheel}
                onPointerDown={onPreviewPointerDown}
                onPointerMove={onPreviewPointerMove}
                onPointerUp={() => { dragStateRef.current = undefined; }}
                onPointerCancel={() => { dragStateRef.current = undefined; }}
              >
                {previewLoading ? <Typography.Text type="secondary">正在加载预览...</Typography.Text> : renderPreview()}
              </div>
              {previewError ? <Alert type="warning" showIcon message={previewError} /> : null}
              <div className="receiver-correction-sample-sheet-meta">
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{sampleSheet?.fileName ?? "尚未指定打样单"}</Typography.Text>
                  <Typography.Text type="secondary">滚轮缩放，按住鼠标拖动查看区域</Typography.Text>
                </Space>
                <Space wrap>
                  <Button
                    loading={sampleSheetSaving}
                    disabled={!onUploadSampleSheet}
                    onClick={() => sampleSheetInputRef.current?.click()}
                  >
                    上传替换
                  </Button>
                  <Button
                    type="primary"
                    ghost
                    disabled={!onSelectSampleSheet || availableSampleSheets.length === 0}
                    onClick={() => {
                      setSampleSheetPickerId(sampleSheet?.id ?? availableSampleSheets[0]?.id);
                      setSampleSheetPickerOpen(true);
                    }}
                  >
                    从接单员附件选择
                  </Button>
                  <input
                    ref={sampleSheetInputRef}
                    className="receiver-correction-hidden-input"
                    type="file"
                    accept="image/*,.pdf,.xls,.xlsx,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) => void uploadSampleSheet(event)}
                  />
                </Space>
              </div>
            </Space>
          </Card>
          <Form form={form} layout="vertical" className="receiver-correction-form">
            <div className="form-grid receiver-correction-grid">
              <Form.Item label="款号" name="styleNo" rules={[{ required: true, message: "请输入款号" }]}>
                <Input />
              </Form.Item>
              <Form.Item label="款名" name="styleName" rules={[{ required: true, message: "请输入款名" }]}>
                <Input />
              </Form.Item>
              {hasPhysicalProduction ? (
                <Form.Item
                  label="数量 / 打样件数"
                  name="quantity"
                  rules={[{ required: true, message: "请输入数量" }]}
                  tooltip={!quantityEditable ? "裁剪已提交或缝制已接单，件数不可修改。" : undefined}
                >
                  <InputNumber {...integerInputProps} min={1} precision={0} className="full-width" disabled={!quantityEditable} />
                </Form.Item>
              ) : (
                <Form.Item label="数量 / 打样件数"><Typography.Text type="secondary">N/A（无实体生产路线）</Typography.Text></Form.Item>
              )}
              <Form.Item label="样品类型" name="sampleType" rules={[{ required: true, message: "请选择样品类型" }]}>
                <Select options={sampleTypeOptions} />
              </Form.Item>
              <Form.Item label="样品轮次" name="sampleRound" rules={[{ required: true, message: "请选择样品轮次" }]}>
                <Select options={sampleRoundOptions} />
              </Form.Item>
              <Form.Item
                label="期望交期"
                name="deliveryDate"
                rules={[{ required: true, message: "请选择期望交期" }]}
              >
                <Input type="date" />
              </Form.Item>
              {hasPhysicalProduction ? (
                <>
                  <Form.Item label="面里料状态" name="fabricStatus" rules={[{ required: true, message: "请选择面里料状态" }]}>
                    <Select options={fabricOptions} />
                  </Form.Item>
                  <Form.Item label="辅料状态" name="trimStatus" rules={[{ required: true, message: "请选择辅料状态" }]}>
                    <Select options={trimOptions} />
                  </Form.Item>
                </>
              ) : (
                <>
                  <Form.Item label="面里料状态"><Typography.Text type="secondary">N/A（无实体生产路线）</Typography.Text></Form.Item>
                  <Form.Item label="辅料状态"><Typography.Text type="secondary">N/A（无实体生产路线）</Typography.Text></Form.Item>
                </>
              )}
            </div>
            <Form.Item
              label="打样要求"
              name="sampleRequestItems"
            >
              <Checkbox.Group
                className="receiver-correction-sample-request-grid"
                options={sampleRequestItemOptions}
              />
            </Form.Item>
            <ParallelProgress compact sampleRequestItems={selectedSampleRequestItems} stage={null} />
            <Form.Item label="备注" name="remark">
              <Input.TextArea rows={3} />
            </Form.Item>
          </Form>
        </div>
      </Space>
    </Modal>
      <Modal
        title="选择打样单附件"
        open={sampleSheetPickerOpen}
        okText="设为打样单"
        cancelText="取消"
        confirmLoading={sampleSheetSaving}
        onOk={() => void confirmSampleSheetSelection()}
        onCancel={() => setSampleSheetPickerOpen(false)}
      >
        <Radio.Group
          className="receiver-correction-sample-sheet-picker"
          value={sampleSheetPickerId}
          onChange={(event) => setSampleSheetPickerId(event.target.value as string)}
        >
          {availableSampleSheets.map((attachment) => (
            <Radio key={attachment.id} value={attachment.id}>
              <span>{attachment.fileName}</span>
              {attachment.category === "receiver_sample_sheet" ? <Tag color="blue">当前打样单</Tag> : null}
            </Radio>
          ))}
        </Radio.Group>
      </Modal>
    </>
  );
}
