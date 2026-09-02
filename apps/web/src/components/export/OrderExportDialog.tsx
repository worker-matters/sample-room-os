import { Button, Checkbox, Input, Modal, Space, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { OrderRecord } from "../../api/sampleRoomApi";
import type { OrderFilters } from "../orders/orderFilters";
import {
  buildOrderExportProfile,
  ensureXlsxExtension,
  exportRows,
  type OrderExportColumn,
  type OrderExportRole,
  type OrderExportScope
} from "./orderExportRules";
import { createXlsxBlob } from "./simpleXlsx";

type WritableFileStreamLike = {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
};

type SaveFileHandleLike = {
  createWritable: () => Promise<WritableFileStreamLike>;
};

type SaveFilePickerOptionsLike = {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
};

type WindowWithSavePicker = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptionsLike) => Promise<SaveFileHandleLike>;
};

type OrderExportDialogProps = {
  open: boolean;
  role: OrderExportRole;
  orders: OrderRecord[];
  filters: OrderFilters;
  exportScope?: OrderExportScope;
  customerName?: string;
  onCancel: () => void;
  onExported?: () => void;
};

function isSavePickerSupported() {
  if (typeof window === "undefined") {
    return false;
  }

  return typeof (window as WindowWithSavePicker).showSaveFilePicker === "function";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function saveBlobWithPicker(blob: Blob, filename: string) {
  const picker = (window as WindowWithSavePicker).showSaveFilePicker;
  if (!picker) {
    downloadBlob(blob, filename);
    return;
  }

  const handle = await picker({
    suggestedName: filename,
    types: [
      {
        description: "Excel 工作簿",
        accept: {
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"]
        }
      }
    ]
  });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function columnCheckboxes(columns: OrderExportColumn[]) {
  return columns.map((column) => ({
    label: column.title,
    value: column.key
  }));
}

export function OrderExportDialog({
  open,
  role,
  orders,
  filters,
  exportScope,
  customerName,
  onCancel,
  onExported
}: OrderExportDialogProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const profile = useMemo(
    () =>
      buildOrderExportProfile({
        role,
        filters,
        ...(exportScope ? { exportScope } : {}),
        ...(customerName ? { customerName } : {})
      }),
    [customerName, exportScope, filters, role]
  );
  const defaultColumnKeys = useMemo(
    () => profile.defaultColumns.map((column) => column.key),
    [profile.defaultColumns]
  );
  const [filename, setFilename] = useState(profile.defaultFilename);
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<string[]>(defaultColumnKeys);
  const [useSavePicker, setUseSavePicker] = useState(false);
  const [exporting, setExporting] = useState(false);
  const savePickerSupported = isSavePickerSupported();

  useEffect(() => {
    if (!open) {
      return;
    }

    setFilename(profile.defaultFilename);
    setSelectedColumnKeys(defaultColumnKeys);
    setUseSavePicker(false);
  }, [defaultColumnKeys, open, profile.defaultFilename]);

  const allColumns = useMemo(
    () => [...profile.defaultColumns, ...profile.optionalColumns],
    [profile.defaultColumns, profile.optionalColumns]
  );

  const selectedColumns = useMemo(
    () => allColumns.filter((column) => selectedColumnKeys.includes(column.key)),
    [allColumns, selectedColumnKeys]
  );

  const confirmExport = async () => {
    if (orders.length === 0) {
      messageApi.warning("当前导出范围为空，暂无可导出订单");
      return;
    }

    if (selectedColumns.length === 0) {
      messageApi.warning("请至少选择一列");
      return;
    }

    const safeFilename = ensureXlsxExtension(filename);
    const blob = createXlsxBlob(exportRows(orders, selectedColumns), profile.sheetName);
    setExporting(true);
    try {
      if (useSavePicker && savePickerSupported) {
        await saveBlobWithPicker(blob, safeFilename);
      } else {
        downloadBlob(blob, safeFilename);
      }
      messageApi.success("已生成 Excel 导出文件");
      onExported?.();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      messageApi.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      title={profile.title}
      open={open}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button
          key="export"
          type="primary"
          loading={exporting}
          disabled={orders.length === 0}
          onClick={() => void confirmExport()}
        >
          导出
        </Button>
      ]}
      width={680}
      className="order-export-dialog"
      destroyOnHidden
    >
      {contextHolder}
      <Space direction="vertical" size={12} className="full-width">
        <div className="order-export-summary">
          <Typography.Text>
            导出范围：{profile.rangeLabel}（{orders.length} 条）
          </Typography.Text>
          {exportScope === "selected" ? (
            <Typography.Text type="secondary">
              已勾选订单优先导出；即使当前有筛选条件，也只导出已勾选行。
            </Typography.Text>
          ) : null}
        </div>

        <Space direction="vertical" size={6} className="full-width">
          <Typography.Text strong>默认文件名</Typography.Text>
          <Input value={filename} onChange={(event) => setFilename(event.target.value)} />
          <Typography.Text type="secondary">
            无筛选时示例：{profile.noFilterExample}
          </Typography.Text>
        </Space>

        <Space direction="vertical" size={6} className="full-width">
          <Typography.Text strong>保存位置</Typography.Text>
          {savePickerSupported ? (
            <Checkbox checked={useSavePicker} onChange={(event) => setUseSavePicker(event.target.checked)}>
              导出时选择保存位置（浏览器支持时）
            </Checkbox>
          ) : null}
          <Typography.Text type="secondary">
            当前浏览器将使用默认下载目录。如需更改保存位置，请在浏览器下载设置中调整。
          </Typography.Text>
        </Space>

        <Space direction="vertical" size={8} className="full-width">
          <Typography.Text strong>默认导出列</Typography.Text>
          <Checkbox.Group
            options={columnCheckboxes(profile.defaultColumns)}
            value={selectedColumnKeys}
            onChange={(values) => {
              const optionalKeys = new Set(profile.optionalColumns.map((column) => column.key));
              const retainedOptional = selectedColumnKeys.filter((key) => optionalKeys.has(key));
              setSelectedColumnKeys([...values.map(String), ...retainedOptional]);
            }}
            className="order-export-column-grid"
          />
        </Space>

        <Space direction="vertical" size={8} className="full-width">
          <Typography.Text strong>可选列（导出时不会默认勾选）</Typography.Text>
          <Checkbox.Group
            options={columnCheckboxes(profile.optionalColumns)}
            value={selectedColumnKeys}
            onChange={(values) => {
              const optionalKeys = new Set(profile.optionalColumns.map((column) => column.key));
              const retainedDefaults = selectedColumnKeys.filter((key) => !optionalKeys.has(key));
              setSelectedColumnKeys([...retainedDefaults, ...values.map(String)]);
            }}
            className="order-export-column-grid"
          />
        </Space>
      </Space>
    </Modal>
  );
}
