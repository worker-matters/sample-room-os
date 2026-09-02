import { Alert, Button, Card, Space, Tag, Typography, message } from "antd";
import type { ClipboardEvent, DragEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DevSession } from "../../app/DevSessionContext";
import {
  sampleRoomApi,
  type AttachmentMetadataInput,
  type ClientExcelImportPreviewResult,
  type ClientExcelImportRowInput
} from "../../api/sampleRoomApi";
import { createXlsxBlob } from "../../components/export/simpleXlsx";
import { attachmentSelectionError } from "../../components/ClientAttachmentPicker";

const legacyExcelTemplateHeaders = [
  "款号",
  "款名",
  "样品类别",
  "样品轮次",
  "数量",
  "期望交期",
  "\u7248\u5b50\u72b6\u6001",
  "面里料状态",
  "辅料状态",
  "备注"
];

const excelTemplateHeaders = legacyExcelTemplateHeaders.filter(
  (header) => header !== "\u7248\u5b50\u72b6\u6001"
);

function fileToAttachment(file: File): AttachmentMetadataInput {
  return {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    category: "client_quick_photo",
    visibility: "client_visible",
    file
  };
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function validRowsFromPreview(preview: ClientExcelImportPreviewResult | null): ClientExcelImportRowInput[] {
  return preview?.validRows ?? [];
}

export function ClientQuickPhotoIntake({
  session,
  onCreated,
  compact = false
}: {
  session: DevSession;
  onCreated: () => Promise<void> | void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<AttachmentMetadataInput[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const previewUrl = useMemo(() => {
    const first = files.find((attachment) => attachment.file?.type.startsWith("image/"));
    return first?.file ? URL.createObjectURL(first.file) : undefined;
  }, [files]);

  useEffect(() => () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  }, [previewUrl]);

  const appendFiles = (selectedFiles: File[]) => {
    const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      messageApi.warning("请粘贴或选择图片文件。");
      return;
    }

    setFiles((current) => {
      const nextFiles = [...current, ...imageFiles.map(fileToAttachment)];
      const error = attachmentSelectionError(nextFiles.map((file) => ({ name: file.fileName, size: file.size })));
      if (error) {
        messageApi.error(error);
        return current;
      }
      return nextFiles;
    });
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const clipboardFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (clipboardFiles.length > 0) {
      event.preventDefault();
      appendFiles(clipboardFiles);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    appendFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const submit = async () => {
    if (files.length === 0) {
      messageApi.warning("请先粘贴截图或选择图片。");
      return;
    }

    setLoading(true);
    try {
      const result = await sampleRoomApi.createClientQuickPhotoOrder(session, files);
      messageApi.success(`已生成订单 ${result.order.styleNo}，接单员会根据图片补齐资料。`);
      setFiles([]);
      await onCreated();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "生成订单失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="截图 / 照片快速录入" className="section-card" size={compact ? "small" : "default"}>
      {contextHolder}
      <Space direction="vertical" size={12} className="full-width">
        <Alert
          type="info"
          showIcon
          message="客户只需要先提交图片"
          description="截图、照片或打样单图片会直接生成一张待接单订单；客户和业务员来自当前登录账号，日期自动记录。"
        />
        <div
          className={`quick-photo-drop-zone${dragging ? " quick-photo-drop-zone-active" : ""}`}
          tabIndex={0}
          onPaste={onPaste}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <Typography.Text strong>截图后直接 Ctrl+V 粘贴，或点击选择图片</Typography.Text>
          <Typography.Text type="secondary">
            手机端可以拍照或从相册选择；Web 端可以拖入图片或从目录选择。
          </Typography.Text>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden-file-input"
            onChange={(event) => {
              appendFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </div>
        {previewUrl ? (
          <img className="quick-photo-preview" src={previewUrl} alt="待生成订单的截图预览" />
        ) : null}
        {files.length > 0 ? (
          <Space wrap>
            <Tag color="blue">已选 {files.length} 个</Tag>
            <Tag color="blue">合计 {(files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(1)} MB</Tag>
            {files.map((file, index) => (
              <Tag
                key={`${file.fileName}-${file.size}-${index}`}
                closable
                onClose={() => setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index))}
              >
                {file.fileName}
              </Tag>
            ))}
          </Space>
        ) : null}
        <Button type="primary" loading={loading} onClick={submit}>
          生成订单
        </Button>
      </Space>
    </Card>
  );
}

export function ClientExcelImportPanel({
  session,
  onImported
}: {
  session: DevSession;
  onImported: () => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ClientExcelImportPreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const validRows = validRowsFromPreview(preview);

  const downloadTemplate = () => {
    downloadBlob(
      createXlsxBlob([excelTemplateHeaders], "客户批量导入模板", {
        validations: [
          { range: "C2:C500", list: ["初样", "试身样", "修改样", "产前样"] },
          { range: "D2:D500", list: ["第 1 轮", "第 2 轮", "第 3 轮", "第 4 轮"] },
          { range: "G2:G500", list: ["未齐", "部分齐", "齐全"] },
          { range: "H2:H500", list: ["未齐", "部分齐", "齐全"] }
        ]
      }),
      "客户订单批量导入模板.xlsx"
    );
  };

  const previewImport = async (selectedFile = file) => {
    if (!selectedFile) {
      messageApi.warning("请先选择固定模板 Excel 文件。");
      return;
    }

    setLoading(true);
    try {
      setPreview(await sampleRoomApi.previewClientExcelImport(session, selectedFile));
      messageApi.success("Excel 已解析，请确认有效行后导入。");
    } catch (error) {
      setPreview(null);
      messageApi.error(error instanceof Error ? error.message : "Excel 解析失败");
    } finally {
      setLoading(false);
    }
  };

  const confirmImport = async () => {
    if (validRows.length === 0) {
      messageApi.warning("没有可导入的有效行。");
      return;
    }

    setLoading(true);
    try {
      const result = await sampleRoomApi.confirmClientExcelImport(session, validRows);
      messageApi.success(`已导入 ${result.createdCount} 张订单，无效行未创建。`);
      setFile(null);
      setPreview(null);
      await onImported();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "确认导入失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="固定 Excel 批量导入" className="section-card">
      {contextHolder}
      <Space direction="vertical" size={12} className="full-width">
        <Typography.Text type="secondary">
          只支持固定模板。客户、业务员、创建日期由系统根据当前登录账号自动填写，Excel 内不能代填。
        </Typography.Text>
        <Space wrap>
          <Button onClick={downloadTemplate}>下载固定模板</Button>
          <Button onClick={() => inputRef.current?.click()}>选择 Excel</Button>
          <Button loading={loading} onClick={() => void previewImport()} disabled={!file}>
            解析预览
          </Button>
          <Button type="primary" loading={loading} onClick={() => void confirmImport()} disabled={validRows.length === 0}>
            确认导入有效行
          </Button>
        </Space>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden-file-input"
          onChange={(event) => {
            const selectedFile = event.target.files?.[0] ?? null;
            setFile(selectedFile);
            setPreview(null);
            if (selectedFile) {
              void previewImport(selectedFile);
            }
            event.target.value = "";
          }}
        />
        {file ? <Tag color="blue">{file.name}</Tag> : <Tag>未选择 Excel</Tag>}
        <Typography.Text type="secondary">
          固定选项：样品类别（初样/试身样/修改样/产前样），轮次（第 1-4 轮），面辅料状态（未齐/部分齐/齐全）。
        </Typography.Text>
        {preview ? (
          <div className="excel-import-preview">
            <Typography.Text strong>
              总行数 {preview.totalRows}，可导入 {preview.validRows.length}，无效 {preview.invalidRows.length}
            </Typography.Text>
            <div className="excel-import-preview-list">
              {preview.rows.map((row) => (
                <div className={`excel-import-preview-row${row.valid ? "" : " excel-import-preview-row-error"}`} key={row.rowNumber}>
                  <Typography.Text strong>第 {row.rowNumber} 行</Typography.Text>
                  {row.data ? (
                    <Typography.Text>
                      {row.data.styleNo} / {row.data.styleName} / {row.data.quantity} 件
                    </Typography.Text>
                  ) : null}
                  <Typography.Text type={row.valid ? "success" : "danger"}>
                    {row.valid ? "有效" : row.errors.join("；")}
                  </Typography.Text>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Space>
    </Card>
  );
}
