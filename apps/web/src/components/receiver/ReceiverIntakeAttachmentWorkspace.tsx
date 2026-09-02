import {
  EyeOutlined,
  FileImageOutlined,
  FileOutlined,
  LockOutlined
} from "@ant-design/icons";
import { Button, Empty, Input, Modal, Pagination, Select, Table, Tag, Typography } from "antd";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { AttachmentMetadataInput } from "../../api/sampleRoomApi";
import {
  attachmentFileNameError,
  editableAttachmentFileName,
  normalizeAttachmentFileName,
  renameAttachmentFile
} from "../attachmentFileName";
import { attachmentSelectionError } from "../ClientAttachmentPicker";
import { setNextNativeUploadSource } from "../../pages/qc/tabletNativeBridge";

export type ReceiverIntakeAttachmentState = {
  sampleSheetAttachments: AttachmentMetadataInput[];
  ordinaryAttachments: AttachmentMetadataInput[];
  thumbnailSampleIndex?: number | undefined;
};

type ReceiverIntakeAttachmentWorkspaceProps = {
  value: ReceiverIntakeAttachmentState;
  onChange: (value: ReceiverIntakeAttachmentState) => void;
  tablet?: boolean;
};

const visibilityOptions = [
  { label: <span><EyeOutlined /> 客户可见</span>, value: "client_visible" },
  { label: <span><LockOutlined /> 仅内部</span>, value: "internal_only" }
] as const;

function attachmentFromFile(file: File, category: string): AttachmentMetadataInput {
  return {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    category,
    visibility: "internal_only",
    file
  };
}

function isImageAttachment(attachment: AttachmentMetadataInput) {
  return attachment.mimeType.startsWith("image/");
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fileType(attachment: AttachmentMetadataInput) {
  const extension = attachment.fileName.split(".").pop();
  return extension && extension !== attachment.fileName
    ? extension.toLowerCase()
    : attachment.mimeType.split("/").pop() ?? "file";
}

function AttachmentImage({ attachment }: { attachment: AttachmentMetadataInput }) {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!attachment.file || !isImageAttachment(attachment)) {
      setUrl(undefined);
      return;
    }
    const nextUrl = URL.createObjectURL(attachment.file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [attachment]);

  return url
    ? <img src={url} alt={attachment.fileName} />
    : isImageAttachment(attachment)
      ? <FileImageOutlined />
      : <FileOutlined />;
}

export function receiverIntakeSubmissionAttachments(value: ReceiverIntakeAttachmentState) {
  return [...value.sampleSheetAttachments, ...value.ordinaryAttachments];
}

export function receiverIntakeThumbnailAttachmentIndex(value: ReceiverIntakeAttachmentState) {
  const index = value.thumbnailSampleIndex;
  const attachment = index === undefined ? undefined : value.sampleSheetAttachments[index];
  return index !== undefined && attachment && isImageAttachment(attachment)
    ? index
    : undefined;
}

export function ReceiverIntakeAttachmentWorkspace({
  value,
  onChange,
  tablet = false
}: ReceiverIntakeAttachmentWorkspaceProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const sampleInputRef = useRef<HTMLInputElement>(null);
  const ordinaryInputRef = useRef<HTMLInputElement>(null);
  const [selectionError, setSelectionError] = useState<string>();
  const [renameTarget, setRenameTarget] = useState<{ area: "sample" | "ordinary"; index: number; baseName: string }>();
  const [ordinaryPage, setOrdinaryPage] = useState(1);
  const [ordinaryPageSize, setOrdinaryPageSize] = useState(10);

  const updateAttachments = (
    area: "sample" | "ordinary",
    attachments: AttachmentMetadataInput[],
    thumbnailSampleIndex = value.thumbnailSampleIndex
  ) => onChange(area === "sample"
    ? { ...value, sampleSheetAttachments: attachments, thumbnailSampleIndex }
    : { ...value, ordinaryAttachments: attachments });

  const appendFiles = (area: "sample" | "ordinary", files: File[]) => {
    if (files.length === 0) return;
    const existing = receiverIntakeSubmissionAttachments(value).map((attachment) => ({
      name: attachment.fileName,
      size: attachment.size
    }));
    const error = attachmentSelectionError([...existing, ...files]);
    setSelectionError(error);
    if (error) return;

    const additions = files.map((file) => attachmentFromFile(
      file,
      area === "sample" ? "receiver_quick_photo" : "receiver_attachment"
    ));
    if (area === "sample") {
      const next = [...value.sampleSheetAttachments, ...additions];
      const thumbnail = value.thumbnailSampleIndex ?? next.findIndex(isImageAttachment);
      updateAttachments("sample", next, thumbnail >= 0 ? thumbnail : undefined);
    } else {
      updateAttachments("ordinary", [...value.ordinaryAttachments, ...additions]);
    }
  };

  const onFiles = (area: "sample" | "ordinary") => (event: ChangeEvent<HTMLInputElement>) => {
    appendFiles(area, Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const setVisibility = (area: "sample" | "ordinary", index: number, visibility: "client_visible" | "internal_only") => {
    const attachments = area === "sample" ? value.sampleSheetAttachments : value.ordinaryAttachments;
    updateAttachments(area, attachments.map((attachment, current) => current === index
      ? { ...attachment, visibility }
      : attachment));
  };

  const removeSample = (index: number) => {
    const next = value.sampleSheetAttachments.filter((_, current) => current !== index);
    let thumbnail = value.thumbnailSampleIndex;
    if (thumbnail === index) {
      const firstImage = next.findIndex(isImageAttachment);
      thumbnail = firstImage >= 0 ? firstImage : undefined;
    } else if (thumbnail !== undefined && thumbnail > index) {
      thumbnail -= 1;
    }
    updateAttachments("sample", next, thumbnail);
  };

  const removeOrdinary = (index: number) => {
    updateAttachments("ordinary", value.ordinaryAttachments.filter((_, current) => current !== index));
  };

  const renameAttachment = () => {
    if (!renameTarget) return;
    const attachments = renameTarget.area === "sample"
      ? value.sampleSheetAttachments
      : value.ordinaryAttachments;
    const renamed = normalizeAttachmentFileName(renameAttachmentFile(
      attachments[renameTarget.index]!,
      renameTarget.baseName
    ));
    if (attachmentFileNameError(renamed)) return;
    updateAttachments(renameTarget.area, attachments.map((attachment, index) =>
      index === renameTarget.index ? renamed : attachment
    ));
    setRenameTarget(undefined);
  };

  const ordinaryPageCount = Math.max(1, Math.ceil(value.ordinaryAttachments.length / ordinaryPageSize));
  useEffect(() => {
    if (ordinaryPage > ordinaryPageCount) setOrdinaryPage(ordinaryPageCount);
  }, [ordinaryPage, ordinaryPageCount]);

  const ordinaryRows = useMemo(() => value.ordinaryAttachments
    .map((attachment, index) => ({ attachment, index, key: `${attachment.fileName}-${attachment.size}-${index}` }))
    .slice((ordinaryPage - 1) * ordinaryPageSize, ordinaryPage * ordinaryPageSize), [ordinaryPage, ordinaryPageSize, value.ordinaryAttachments]);

  const renameAttachmentValue = renameTarget
    ? (renameTarget.area === "sample" ? value.sampleSheetAttachments : value.ordinaryAttachments)[renameTarget.index]
    : undefined;
  const renameError = renameAttachmentValue && renameTarget
    ? attachmentFileNameError(renameAttachmentFile(renameAttachmentValue, renameTarget.baseName))
    : undefined;

  return (
    <div className="receiver-intake-attachment-workspace">
      <section className="receiver-intake-attachment-section receiver-intake-sample-sheet-section">
        <div className="receiver-intake-attachment-heading">
          <Typography.Title level={5}>打样单相关附件</Typography.Title>
          <div className="receiver-intake-attachment-actions">
            <Button type="primary" onClick={() => cameraInputRef.current?.click()}>{tablet ? "拍照" : "拍摄下一张"}</Button>
            <Button type="primary" onClick={() => {
              if (tablet) setNextNativeUploadSource("gallery");
              sampleInputRef.current?.click();
            }}>{tablet ? "相册" : "从相册选择"}</Button>
          </div>
        </div>
        <input ref={cameraInputRef} hidden type="file" accept="image/*" capture="environment" multiple onChange={onFiles("sample")} />
        <input ref={sampleInputRef} hidden type="file" multiple {...(tablet ? { accept: "image/*" } : {})} onChange={onFiles("sample")} />
        <div className="receiver-intake-sample-scroll">
          {value.sampleSheetAttachments.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请添加至少一份打样单相关附件" />
          ) : value.sampleSheetAttachments.map((attachment, index) => {
            const thumbnail = value.thumbnailSampleIndex === index && isImageAttachment(attachment);
            return (
              <article className={`receiver-intake-sample-card${thumbnail ? " receiver-intake-sample-card-thumbnail" : ""}`} key={`${attachment.fileName}-${attachment.size}-${index}`}>
                <div className="receiver-intake-sample-preview">
                  <AttachmentImage attachment={attachment} />
                  {thumbnail ? <Tag color="blue">订单缩略图</Tag> : null}
                </div>
                <Typography.Text strong ellipsis={{ tooltip: attachment.fileName }}>{attachment.fileName}</Typography.Text>
                <Typography.Text type="secondary">{formatFileSize(attachment.size)}</Typography.Text>
                <Select
                  value={attachment.visibility ?? "internal_only"}
                  options={[...visibilityOptions]}
                  onChange={(visibility) => setVisibility("sample", index, visibility)}
                />
                <div className="receiver-intake-card-actions">
                  {isImageAttachment(attachment) ? (
                    <Button type="link" size="small" disabled={thumbnail} onClick={() => onChange({ ...value, thumbnailSampleIndex: index })}>设为缩略图</Button>
                  ) : null}
                  <Button type="link" size="small" onClick={() => setRenameTarget({ area: "sample", index, baseName: editableAttachmentFileName(attachment).baseName })}>改名</Button>
                  <Button type="link" size="small" danger onClick={() => removeSample(index)}>删除</Button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="receiver-intake-attachment-section receiver-intake-ordinary-section">
        <div className="receiver-intake-attachment-heading">
          <Typography.Title level={5}>普通附件（可选）</Typography.Title>
          <Button type="primary" onClick={() => ordinaryInputRef.current?.click()}>上传普通附件</Button>
        </div>
        <input ref={ordinaryInputRef} hidden type="file" multiple onChange={onFiles("ordinary")} />
        <Table
          className="receiver-intake-ordinary-table data-workspace-table"
          size="small"
          tableLayout="fixed"
          pagination={false}
          scroll={{ x: 625, y: "100%", scrollToFirstRowOnChange: true }}
          dataSource={ordinaryRows}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无普通附件" /> }}
          columns={[
            { title: "文件名", width: 220, render: (_, row) => <Typography.Text ellipsis={{ tooltip: row.attachment.fileName }}>{row.attachment.fileName}</Typography.Text> },
            { title: "类型", width: 70, render: (_, row) => fileType(row.attachment) },
            { title: "大小", width: 80, render: (_, row) => formatFileSize(row.attachment.size) },
            {
              title: "可见范围",
              width: 145,
              render: (_, row) => <Select value={row.attachment.visibility ?? "internal_only"} options={[...visibilityOptions]} onChange={(visibility) => setVisibility("ordinary", row.index, visibility)} />
            },
            {
              title: "操作",
              width: 110,
              render: (_, row) => <div className="receiver-intake-table-actions">
                <Button type="link" size="small" onClick={() => setRenameTarget({ area: "ordinary", index: row.index, baseName: editableAttachmentFileName(row.attachment).baseName })}>改名</Button>
                <Button type="link" size="small" danger onClick={() => removeOrdinary(row.index)}>删除</Button>
              </div>
            }
          ]}
        />
        <div className="receiver-intake-pagination">
          <Pagination size="small" current={ordinaryPage} pageSize={ordinaryPageSize} total={value.ordinaryAttachments.length} showSizeChanger={false} onChange={setOrdinaryPage} />
          <label>每页显示 <Select value={ordinaryPageSize} options={[5, 10, 20].map((size) => ({ label: `${size} 行`, value: size }))} onChange={(size) => { setOrdinaryPageSize(size); setOrdinaryPage(1); }} /></label>
        </div>
      </section>

      {selectionError ? <Typography.Text type="danger">{selectionError}</Typography.Text> : null}
      <Modal title="修改附件展示名称" open={Boolean(renameTarget)} okText="保存" cancelText="取消" okButtonProps={{ disabled: Boolean(renameError) }} onCancel={() => setRenameTarget(undefined)} onOk={renameAttachment}>
        {renameTarget && renameAttachmentValue ? (
          <>
            <Typography.Paragraph type="secondary">只修改文件名主体，扩展名保持不变。</Typography.Paragraph>
            <Input
              autoFocus
              value={renameTarget.baseName}
              {...(renameError ? { status: "error" as const } : {})}
              addonAfter={editableAttachmentFileName(renameAttachmentValue).extension || "无扩展名"}
              onChange={(event) => setRenameTarget({ ...renameTarget, baseName: event.target.value })}
              onPressEnter={renameAttachment}
            />
            {renameError ? <Typography.Text type="danger">{renameError}</Typography.Text> : null}
          </>
        ) : null}
      </Modal>
    </div>
  );
}
