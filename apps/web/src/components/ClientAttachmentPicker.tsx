import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Checkbox, Input, Modal, Space, Tag, Typography } from "antd";
import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import type { AttachmentMetadataInput } from "../api/sampleRoomApi";
import {
  attachmentFileNameError,
  editableAttachmentFileName,
  normalizeAttachmentFileName,
  renameAttachmentFile
} from "./attachmentFileName";
import { isNativeTabletRuntime } from "../pages/qc/tabletNativeBridge";
import { NativeTabletImagePicker } from "./tablet/NativeTabletImagePicker";
import {
  AttachmentPreviewModal,
  type AttachmentPreviewRequest
} from "./attachments/AttachmentPreviewModal";

function toAttachmentMetadata(
  file: File,
  category: string,
  visibility?: AttachmentMetadataInput["visibility"]
): AttachmentMetadataInput {
  return {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    category,
    ...(visibility ? { visibility } : {}),
    file
  };
}

export function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export const maxAttachmentSelectionBytes = 300 * 1024 * 1024;
export const maxAttachmentFileBytes = 30 * 1024 * 1024;
export const maxAttachmentSelectionCount = 30;

export function attachmentSelectionError(files: Array<Pick<File, "name" | "size">>) {
  const oversized = files.find((file) => file.size > maxAttachmentFileBytes);
  if (oversized) return `文件“${oversized.name}”超过单文件 30MB 限制。`;
  if (files.length > maxAttachmentSelectionCount) return "一次最多选择 30 个附件。";
  if (files.reduce((sum, file) => sum + file.size, 0) > maxAttachmentSelectionBytes) {
    return "已选附件总大小超过 300MB 限制。";
  }
  return undefined;
}

type ClientAttachmentPickerProps = {
  value: AttachmentMetadataInput[];
  onChange: (value: AttachmentMetadataInput[]) => void;
  showCamera?: boolean;
  defaultCategory?: string;
  defaultVisibility?: AttachmentMetadataInput["visibility"] | undefined;
  autoOpenSignal?: number | undefined;
  autoOpenTarget?: "file" | "camera" | undefined;
  accept?: string;
  title?: string;
  description?: string;
  allowRename?: boolean;
  showVisibilityChoice?: boolean;
  compact?: boolean;
  compactLabel?: ReactNode;
  compactTrailingAction?: ReactNode;
  integratedDropZone?: boolean;
  allowPreview?: boolean;
};

export function ClientAttachmentPicker({
  value,
  onChange,
  showCamera = true,
  defaultCategory = "client_reference",
  defaultVisibility,
  autoOpenSignal,
  autoOpenTarget = "file",
  accept,
  title = "拖入打样单照片 / PDF / 表格",
  description = "Web 端可拖拽文件或从目录选择；手机端可拍照或从相册选择。",
  allowRename = false,
  showVisibilityChoice = false,
  compact = false,
  compactLabel,
  compactTrailingAction,
  integratedDropZone = false,
  allowPreview = false
}: ClientAttachmentPickerProps) {
  const nativeTablet = isNativeTabletRuntime();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const lastAutoOpenSignal = useRef(autoOpenSignal);
  const [dragging, setDragging] = useState(false);
  const [renameDraft, setRenameDraft] = useState<{ index: number; baseName: string }>();
  const [selectionError, setSelectionError] = useState<string>();
  const [previewRequest, setPreviewRequest] = useState<AttachmentPreviewRequest>();

  const appendFiles = (files: File[]) => {
    if (files.length > 0) {
      const currentFiles = value.map((attachment) => ({ name: attachment.fileName, size: attachment.size }));
      const error = attachmentSelectionError([...currentFiles, ...files]);
      setSelectionError(error);
      if (error) return;
      onChange([
        ...value,
        ...files.map((file) => toAttachmentMetadata(file, defaultCategory, defaultVisibility))
      ]);
    }
  };

  const appendInputFiles = (event: ChangeEvent<HTMLInputElement>) => {
    appendFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    appendFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const pasteFiles = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (files.length > 0) {
      event.preventDefault();
      appendFiles(files);
    }
  };

  useEffect(() => {
    if (autoOpenSignal === undefined || autoOpenSignal === lastAutoOpenSignal.current) {
      return;
    }

    lastAutoOpenSignal.current = autoOpenSignal;
    const input = autoOpenTarget === "camera" && showCamera ? cameraInputRef.current : fileInputRef.current;
    input?.click();
  }, [autoOpenSignal, autoOpenTarget, showCamera]);

  const removeAt = (index: number) => {
    onChange(value.filter((_, currentIndex) => currentIndex !== index));
  };

  const renameAt = (index: number, baseName: string) => {
    onChange(
      value.map((attachment, currentIndex) =>
        currentIndex === index ? renameAttachmentFile(attachment, baseName) : attachment
      )
    );
  };

  const setVisibilityAt = (index: number, clientVisible: boolean) => {
    onChange(
      value.map((attachment, currentIndex) =>
        currentIndex === index
          ? {
              ...attachment,
              visibility: clientVisible ? "client_visible" : "internal_only"
            }
          : attachment
      )
    );
  };

  const previewAt = (attachment: AttachmentMetadataInput, index: number) => {
    if (!allowPreview || !attachment.file) return;
    setPreviewRequest({
      key: `pending-${index}-${attachment.fileName}-${attachment.size}`,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      load: async () => attachment.file!
    });
  };

  const fileUploadControl = (
    <label className="file-button">
      上传附件
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={accept}
        onChange={appendInputFiles}
      />
    </label>
  );
  const selectionSummary = (
    <Space wrap size={6}>
      <Tag color="blue">已选 {value.length} 个</Tag>
      <Tag color="blue">合计 {formatFileSize(value.reduce((sum, attachment) => sum + attachment.size, 0))}</Tag>
    </Space>
  );

  return (
    <Space
      direction="vertical"
      size={compact ? 6 : 10}
      className={`full-width${compact ? " client-attachment-picker-compact" : ""}`}
    >
      {!compact ? (
        <div
          className={`attachment-drop-zone${dragging ? " attachment-drop-zone-active" : ""}${integratedDropZone ? " attachment-drop-zone-integrated" : ""}`}
          {...(integratedDropZone ? { role: "button", "aria-label": title } : {})}
          tabIndex={0}
          onClick={integratedDropZone ? () => fileInputRef.current?.click() : undefined}
          onKeyDown={integratedDropZone ? (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          } : undefined}
          onPaste={pasteFiles}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={dropFiles}
        >
          <Typography.Text strong>{title}</Typography.Text>
          <Typography.Text type="secondary">{description}</Typography.Text>
          {integratedDropZone ? (
            <input
              ref={fileInputRef}
              hidden
              type="file"
              multiple
              accept={accept}
              onChange={appendInputFiles}
            />
          ) : null}
        </div>
      ) : null}
      {compact ? (
        <div className="client-attachment-picker-compact-actions">
          <Typography.Text strong>{compactLabel}</Typography.Text>
          <div className={nativeTablet ? "client-attachment-picker-native-actions" : ""}>
            {nativeTablet ? <NativeTabletImagePicker onFiles={appendFiles} /> : null}
            <div
              className={`client-attachment-picker-compact-drop-zone${dragging ? " is-dragging" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onPaste={pasteFiles}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={dropFiles}
            >
              {nativeTablet ? "选择文件" : "点击/拖入文件上传"}
              <input
                ref={fileInputRef}
                hidden
                type="file"
                multiple
                accept={accept}
                onChange={appendInputFiles}
              />
            </div>
          </div>
          {selectionSummary}
          {compactTrailingAction ? (
            <div className="client-attachment-picker-compact-trailing-action">
              {compactTrailingAction}
            </div>
          ) : null}
        </div>
      ) : integratedDropZone ? (
        selectionSummary
      ) : (
        <>
          <Space wrap>
            {fileUploadControl}
            {showCamera ? (
              <label className="file-button">
                拍照上传
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={appendInputFiles}
                />
              </label>
            ) : null}
          </Space>
          {selectionSummary}
        </>
      )}
      {selectionError ? <Typography.Text type="danger">{selectionError}</Typography.Text> : null}

      {compact ? (
        <div
          className={`client-attachment-picker-compact-table${showVisibilityChoice ? " has-visibility" : ""}`}
          role="table"
          aria-label="待提交附件"
        >
          <div className="client-attachment-picker-compact-header" role="row">
            <span>文件名</span>
            <span>大小</span>
            {showVisibilityChoice ? <span>客户可见</span> : null}
            <span>操作</span>
          </div>
          <div className="client-attachment-picker-compact-list">
            {value.length === 0 ? (
              <Typography.Text type="secondary" className="client-attachment-picker-compact-empty">
                未选择附件
              </Typography.Text>
            ) : value.map((attachment, index) => {
              const editableName = editableAttachmentFileName(attachment);
              return (
                <div
                  className="client-attachment-picker-compact-row"
                  role="row"
                  key={`${attachment.file?.name ?? attachment.fileName}-${attachment.size}-${index}`}
                >
                  <div className="client-attachment-picker-compact-name">
                    {allowPreview && attachment.file ? (
                      <Typography.Link ellipsis title={attachment.fileName} onClick={() => previewAt(attachment, index)}>
                        {attachment.fileName}
                      </Typography.Link>
                    ) : (
                      <Typography.Text ellipsis={{ tooltip: attachment.fileName }}>{attachment.fileName}</Typography.Text>
                    )}
                    {allowRename ? (
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        aria-label={`修改附件 ${index + 1} 展示名称`}
                        onClick={() => setRenameDraft({ index, baseName: editableName.baseName })}
                      />
                    ) : null}
                  </div>
                  <Typography.Text>{formatFileSize(attachment.size)}</Typography.Text>
                  {showVisibilityChoice ? (
                    <Checkbox
                      checked={attachment.visibility === "client_visible"}
                      onChange={(event) => setVisibilityAt(index, event.target.checked)}
                    />
                  ) : null}
                  <Space size={2}>
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      aria-label={`删除待上传附件：${attachment.fileName}`}
                      onClick={() => removeAt(index)}
                    />
                  </Space>
                </div>
              );
            })}
          </div>
        </div>
      ) : value.length > 0 ? (
        <div className="attachment-list">
          {value.map((attachment, index) => {
            const editableName = editableAttachmentFileName(attachment);
            return (
              <div
                className="attachment-row"
                key={`${attachment.file?.name ?? attachment.fileName}-${attachment.size}-${index}`}
              >
                <Space direction="vertical" size={4} className="attachment-row-content">
                  <Space size={4}>
                    <Typography.Text strong>{attachment.fileName}</Typography.Text>
                    {allowRename ? (
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        aria-label={`修改附件 ${index + 1} 展示名称`}
                        onClick={() => setRenameDraft({ index, baseName: editableName.baseName })}
                      />
                    ) : null}
                  </Space>
                  <Typography.Text type="secondary">
                    {attachment.mimeType || "application/octet-stream"} | {formatFileSize(attachment.size)}
                  </Typography.Text>
                  {showVisibilityChoice ? (
                    <Checkbox
                      checked={attachment.visibility === "client_visible"}
                      onChange={(event) => setVisibilityAt(index, event.target.checked)}
                    >
                      客户可见
                    </Checkbox>
                  ) : null}
                </Space>
                <Button size="small" onClick={() => removeAt(index)}>
                  删除
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <Tag>未选择附件</Tag>
      )}
      <Modal
        title="修改附件展示名称"
        open={Boolean(renameDraft)}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ disabled: Boolean(renameDraft && attachmentFileNameError(renameAttachmentFile(value[renameDraft.index]!, renameDraft.baseName))) }}
        onCancel={() => setRenameDraft(undefined)}
        onOk={() => {
          if (!renameDraft) return;
          const next = normalizeAttachmentFileName(
            renameAttachmentFile(value[renameDraft.index]!, renameDraft.baseName)
          );
          if (attachmentFileNameError(next)) return;
          renameAt(renameDraft.index, editableAttachmentFileName(next).baseName);
          setRenameDraft(undefined);
        }}
      >
        <Typography.Paragraph type="secondary">
          只修改文件名主体，扩展名被锁定；真实文件和预览下载地址不会改变。
        </Typography.Paragraph>
        {renameDraft ? (
          <>
            <Input
              autoFocus
              aria-label="附件文件名主体"
              value={renameDraft.baseName}
              {...(attachmentFileNameError(
                renameAttachmentFile(value[renameDraft.index]!, renameDraft.baseName)
              )
                ? { status: "error" as const }
                : {})}
              addonAfter={editableAttachmentFileName(value[renameDraft.index]!).extension || "无扩展名"}
              onChange={(event) => setRenameDraft({ ...renameDraft, baseName: event.target.value })}
              onPressEnter={() => {
                const next = normalizeAttachmentFileName(
                  renameAttachmentFile(value[renameDraft.index]!, renameDraft.baseName)
                );
                if (attachmentFileNameError(next)) return;
                renameAt(renameDraft.index, editableAttachmentFileName(next).baseName);
                setRenameDraft(undefined);
              }}
            />
            {attachmentFileNameError(renameAttachmentFile(value[renameDraft.index]!, renameDraft.baseName)) ? (
              <Typography.Text type="danger">
                {attachmentFileNameError(renameAttachmentFile(value[renameDraft.index]!, renameDraft.baseName))}
              </Typography.Text>
            ) : null}
          </>
        ) : null}
      </Modal>
      <AttachmentPreviewModal request={previewRequest} onClose={() => setPreviewRequest(undefined)} />
    </Space>
  );
}

export function AttachmentSummary({ count }: { count: number }) {
  return <Tag color={count > 0 ? "blue" : "default"}>附件 {count}</Tag>;
}
