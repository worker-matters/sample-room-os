import {
  Button,
  Checkbox,
  Divider,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Tabs,
  Typography,
  message
} from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import {
  DEFAULT_RECEIVER_LABEL_FREEFORM_SETTINGS,
  DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
  RECEIVER_LABEL_SUMMARY_FIELDS,
  RECEIVER_LABEL_TEMPLATES,
  cloneFreeform,
  receiverLabelCopies,
  selectedReceiverSavedLayout,
  type ReceiverLabelFreeformSettings,
  type ReceiverLabelSummaryField,
  type ReceiverQrPrintSettings
} from "@sample-room/shared";
import { useEffect, useMemo, useState } from "react";
import { sampleRoomApi } from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";
import { integerInputProps } from "../forms/numericInputProps";
import {
  connectB1Printer,
  currentB1PrinterState,
  isNativeB1PrinterRuntime,
  listB1Printers
} from "../../printing/receiverPrinter";
import { NiimbotServiceUnavailableError, type NiimbotUsbPrinter } from "../../printing/niimbotWebClient";
import { ReceiverFreeformLabelDesigner } from "./ReceiverFreeformLabelDesigner";
import { ReceiverLabelPreview } from "./ReceiverLabelPreview";
import {
  prepareReceiverFreeformTemplateSave,
  ReceiverFreeformTemplateLimitError
} from "./receiverFreeformTemplateSave";

const summaryFieldOptions: Array<{ value: ReceiverLabelSummaryField; label: string }> = [
  { value: "customerName", label: "客户名称" },
  { value: "businessUserName", label: "业务员" },
  { value: "styleNo", label: "款号" },
  { value: "styleName", label: "款名" },
  { value: "sampleType", label: "样品类型" },
  { value: "quantity", label: "数量" }
];

function freshDefaults(): ReceiverQrPrintSettings {
  return {
    ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
    summaryFields: [...RECEIVER_LABEL_SUMMARY_FIELDS],
    freeform: cloneFreeform(DEFAULT_RECEIVER_QR_PRINT_SETTINGS.freeform),
    savedLayouts: []
  };
}

function dimensionText(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function layoutIdFor(freeform: ReceiverLabelFreeformSettings) {
  const dimensions = `${Math.round(freeform.widthMm * 10)}x${Math.round(freeform.heightMm * 10)}`;
  return `freeform-${dimensions}-${Date.now().toString(36)}`;
}

export function ReceiverPrintSettingsModal({
  open,
  session,
  onCancel,
  onSaved
}: {
  open: boolean;
  session: DevSession;
  onCancel: () => void;
  onSaved?: (settings: ReceiverQrPrintSettings) => void;
}) {
  const [settings, setSettings] = useState<ReceiverQrPrintSettings>(freshDefaults);
  const [activeTab, setActiveTab] = useState<"standard" | "freeform">("standard");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingLayoutId, setEditingLayoutId] = useState<string>();
  const [printers, setPrinters] = useState<NiimbotUsbPrinter[]>([]);
  const [selectedPrinterName, setSelectedPrinterName] = useState<string>();
  const [printerBusy, setPrinterBusy] = useState(false);
  const [printerHint, setPrinterHint] = useState("");
  const [printerSupportUnavailable, setPrinterSupportUnavailable] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [modalApi, modalContextHolder] = Modal.useModal();
  const native = isNativeB1PrinterRuntime();
  const printerState = currentB1PrinterState();
  const selectedSavedLayout = selectedReceiverSavedLayout(settings);
  const standardSummaryEnabled = settings.selectedLayoutId === RECEIVER_LABEL_TEMPLATES.summary50;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setActiveTab("standard");
    setEditingLayoutId(undefined);
    setPrinterHint("");
    setPrinterSupportUnavailable(false);
    void sampleRoomApi.getReceiverPrintSettings(session)
      .then(({ settings: loaded }) => setSettings(loaded))
      .catch((error) => messageApi.error(error instanceof Error ? error.message : "打印设置加载失败"))
      .finally(() => setLoading(false));
    if (!native) {
      void listB1Printers()
        .then((items) => {
          setPrinterSupportUnavailable(false);
          setPrinters(items);
          const selected = currentB1PrinterState();
          const existing = items.find((item) => item.name === selected.name) ?? items[0];
          setSelectedPrinterName(existing?.name);
          if (items.length === 0) setPrinterHint("未检测到通过 USB 连接的精臣打印机");
        })
        .catch((error) => {
          const reason = error instanceof Error ? error.message.trim() : "";
          setPrinterSupportUnavailable(error instanceof NiimbotServiceUnavailableError);
          setPrinterHint(error instanceof NiimbotServiceUnavailableError
            ? ""
            : /^no device$/i.test(reason) ? "未检测到通过 USB 连接的精臣打印机" : reason || "打印服务不可用");
        });
    }
  }, [messageApi, native, open, session]);

  const selectedPrinter = useMemo(
    () => printers.find((printer) => printer.name === selectedPrinterName),
    [printers, selectedPrinterName]
  );

  const patch = (next: Partial<ReceiverQrPrintSettings>) => {
    setSettings((current) => ({ ...current, ...next }));
  };

  const patchFreeform = (next: Partial<ReceiverLabelFreeformSettings>) => {
    setSettings((current) => ({
      ...current,
      freeform: { ...current.freeform, ...next }
    }));
  };

  const changeFreeformFontSize = (fontSizePt: number) => {
    patchFreeform({ fontSizePt: Math.min(18, Math.max(6, fontSizePt)) });
  };

  const resetFreeform = () => patchFreeform({
    showOrderSummary: DEFAULT_RECEIVER_LABEL_FREEFORM_SETTINGS.showOrderSummary,
    summaryText: DEFAULT_RECEIVER_LABEL_FREEFORM_SETTINGS.summaryText,
    summaryBox: { ...DEFAULT_RECEIVER_LABEL_FREEFORM_SETTINGS.summaryBox },
    fontSizePt: DEFAULT_RECEIVER_LABEL_FREEFORM_SETTINGS.fontSizePt,
    bold: DEFAULT_RECEIVER_LABEL_FREEFORM_SETTINGS.bold
  });

  const selectLayout = (layoutId: string) => {
    if (layoutId === RECEIVER_LABEL_TEMPLATES.qrOnly33 || layoutId === RECEIVER_LABEL_TEMPLATES.summary50) {
      patch({ selectedLayoutId: layoutId, template: layoutId });
      return;
    }
    if (settings.savedLayouts.some((layout) => layout.id === layoutId)) {
      patch({ selectedLayoutId: layoutId });
    }
  };

  const switchTab = (tab: string) => {
    const next = tab as "standard" | "freeform";
    if (next === "freeform" && selectedSavedLayout) {
      patch({ freeform: cloneFreeform(selectedSavedLayout.settings) });
      setEditingLayoutId(selectedSavedLayout.id);
    } else if (next === "freeform") {
      setEditingLayoutId(undefined);
    }
    setActiveTab(next);
  };

  const editSavedLayout = (layoutId: string) => {
    const layout = settings.savedLayouts.find((item) => item.id === layoutId);
    if (!layout) return;
    patch({ freeform: cloneFreeform(layout.settings) });
    setEditingLayoutId(layout.id);
  };

  const deleteSavedLayout = async (layoutId: string) => {
    const nextSettings: ReceiverQrPrintSettings = {
      ...settings,
      selectedLayoutId: settings.selectedLayoutId === layoutId
        ? RECEIVER_LABEL_TEMPLATES.qrOnly33
        : settings.selectedLayoutId,
      template: settings.selectedLayoutId === layoutId
        ? RECEIVER_LABEL_TEMPLATES.qrOnly33
        : settings.template,
      savedLayouts: settings.savedLayouts.filter((layout) => layout.id !== layoutId)
    };
    setSaving(true);
    try {
      const result = await sampleRoomApi.updateReceiverPrintSettings(session, nextSettings);
      setSettings(result.settings);
      onSaved?.(result.settings);
      if (editingLayoutId === layoutId) setEditingLayoutId(undefined);
      messageApi.success("自由设计模板已删除");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "自由设计模板删除失败");
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteSavedLayout = (layoutId: string) => {
    const layout = settings.savedLayouts.find((item) => item.id === layoutId);
    if (!layout) return;
    modalApi.confirm({
      title: "删除这个自由设计模板？",
      content: `“${layout.name}”删除后，也会从标准模板的尺寸下拉框中移除。`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => deleteSavedLayout(layoutId)
    });
  };

  const connect = async () => {
    setPrinterBusy(true);
    setPrinterHint("");
    try {
      let printer = selectedPrinter;
      if (!native && !printer) {
        const items = await listB1Printers();
        setPrinters(items);
        printer = items[0];
        setSelectedPrinterName(printer?.name);
        if (!printer) {
          setPrinterSupportUnavailable(false);
          setPrinterHint("未检测到通过 USB 连接的精臣打印机");
          return;
        }
      }
      await connectB1Printer(printer);
      setPrinterSupportUnavailable(false);
      if (!native) setPrinterHint(`已连接：${printer?.name}`);
    } catch (error) {
      setPrinterSupportUnavailable(error instanceof NiimbotServiceUnavailableError);
      setPrinterHint(error instanceof NiimbotServiceUnavailableError
        ? ""
        : error instanceof Error ? error.message : "打印机连接失败");
    } finally {
      setPrinterBusy(false);
    }
  };

  const save = async (saveAsNew = false) => {
    setSaving(true);
    try {
      let nextSettings = settings;
      if (activeTab === "freeform") {
        nextSettings = prepareReceiverFreeformTemplateSave({
          settings,
          editingLayoutId,
          saveAsNew,
          createLayoutId: () => layoutIdFor(settings.freeform),
          createLayoutName: (templateNumber) => `${dimensionText(settings.freeform.widthMm)}mm × ${dimensionText(settings.freeform.heightMm)}mm（自由设计 ${templateNumber}）`
        });
      }
      const result = await sampleRoomApi.updateReceiverPrintSettings(session, nextSettings);
      setSettings(result.settings);
      onSaved?.(result.settings);
      messageApi.success("打印设置已保存并同步到当前账号");
      onCancel();
    } catch (error) {
      messageApi.error(error instanceof ReceiverFreeformTemplateLimitError
        ? "最多保存 12 个自由设计模板，请先删除不再使用的模板"
        : error instanceof Error ? error.message : "打印设置保存失败");
    } finally {
      setSaving(false);
    }
  };

  const printerConnection = (
    <div className="receiver-b1-setting-block">
      <Typography.Text strong>打印机连接</Typography.Text>
      {native ? (
        <Space wrap>
          <Typography.Text>{printerState.status === "connected" ? `已连接：${printerState.name || "B1"}` : "B1 尚未连接"}</Typography.Text>
          <Button onClick={() => void connect()} loading={printerBusy}>连接蓝牙 B1</Button>
        </Space>
      ) : (
        <Space wrap>
          <Select
            aria-label="USB 打印机"
            value={selectedPrinterName}
            options={printers.map((printer) => ({ value: printer.name, label: printer.name }))}
            onChange={setSelectedPrinterName}
            placeholder="选择 USB B1 打印机"
            className="receiver-b1-printer-select"
          />
          <Button onClick={() => void connect()} loading={printerBusy}>连接打印机</Button>
        </Space>
      )}
      {!native && printerSupportUnavailable ? (
        <div className="receiver-b1-printer-support-notice" role="alert">
          <Typography.Text strong>未检测到打印服务。</Typography.Text>
          <Typography.Text>此电脑首次使用 NIIMBOT B1 时，请自行从精臣官方渠道取得并安装 driver/desktop service。</Typography.Text>
          <Typography.Text>安装完成后，请返回此页面重新点击“连接打印机”。</Typography.Text>
        </div>
      ) : null}
      {printerHint ? <Typography.Text type="secondary">{printerHint}</Typography.Text> : null}
    </div>
  );

  const standardControlsDisabled = Boolean(selectedSavedLayout);
  const standardTab = (
    <div className="receiver-b1-settings-layout receiver-b1-standard-layout">
      <section className="receiver-b1-settings-left">
        <div className="receiver-b1-live-preview">
          <Typography.Text strong>打印预览</Typography.Text>
          <ReceiverLabelPreview settings={settings} />
        </div>
      </section>
      <section className="receiver-b1-settings-right">
        {printerConnection}
        <Divider />
        <div className="receiver-b1-setting-block">
          <Typography.Text strong>标签纸尺寸（毫米）</Typography.Text>
          <Select
            aria-label="标签纸尺寸（毫米）"
            value={settings.selectedLayoutId}
            onChange={selectLayout}
            options={[
              { value: RECEIVER_LABEL_TEMPLATES.qrOnly33, label: "33mm × 33mm（仅二维码）" },
              { value: RECEIVER_LABEL_TEMPLATES.summary50, label: "50mm × 50mm（含摘要）" },
              ...settings.savedLayouts.map((layout) => ({ value: layout.id, label: layout.name }))
            ]}
            className="receiver-b1-layout-select"
          />
          {selectedSavedLayout ? (
            <Typography.Text type="secondary">使用该尺寸保存时的排版、摘要、字体和打印份数；如需修改，请前往“自由设计”。</Typography.Text>
          ) : null}
        </div>
        <Divider />
        <div className="receiver-b1-setting-block">
          <Typography.Text strong>打印份数</Typography.Text>
          <InputNumber
            {...integerInputProps}
            min={1}
            max={20}
            value={receiverLabelCopies(settings)}
            disabled={standardControlsDisabled}
            onChange={(copies) => patch({ copies: copies ?? 1 })}
          />
        </div>
        {standardSummaryEnabled ? (
          <>
            <Divider />
            <div className="receiver-b1-switch-row">
              <Typography.Text strong>显示订单摘要</Typography.Text>
              <Switch checked={settings.showOrderSummary} onChange={(value) => patch({ showOrderSummary: value })} />
            </div>
            <Checkbox.Group
              value={settings.summaryFields}
              disabled={!settings.showOrderSummary}
              onChange={(values) => patch({ summaryFields: values as ReceiverLabelSummaryField[] })}
              className="receiver-b1-summary-fields"
            >
              {summaryFieldOptions.map((option) => <Checkbox key={option.value} value={option.value}>{option.label}</Checkbox>)}
            </Checkbox.Group>
            <div className="receiver-b1-setting-block">
              <Typography.Text strong>样品类型</Typography.Text>
              <Radio.Group
                value={settings.sampleTypeDisplay}
                disabled={!settings.showOrderSummary}
                onChange={(event) => patch({ sampleTypeDisplay: event.target.value })}
              >
                <Radio value="full">完整显示</Radio>
                <Radio value="truncate_8">最多 8 个字</Radio>
              </Radio.Group>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );

  const freeformTab = (
    <div className="receiver-b1-settings-layout receiver-b1-freeform-layout">
      <section className="receiver-b1-freeform-left">
        <ReceiverFreeformLabelDesigner settings={settings} freeform={settings.freeform} onChange={patchFreeform} onReset={resetFreeform} />
      </section>
      <section className="receiver-b1-freeform-right">
        <div className="receiver-freeform-setting-group">
          <Typography.Text strong>标签尺寸</Typography.Text>
          <div className="receiver-freeform-saved-layout-row">
            <Select
              aria-label="已保存的自由设计"
              placeholder="选择已保存设计进行调整"
              value={editingLayoutId ?? null}
              onChange={editSavedLayout}
              allowClear
              onClear={() => setEditingLayoutId(undefined)}
              options={settings.savedLayouts.map((layout) => ({ value: layout.id, label: layout.name }))}
              optionRender={(option) => (
                <div className="receiver-freeform-layout-option">
                  <span>{option.label}</span>
                  <Button
                    type="text"
                    danger
                    size="small"
                    aria-label={`删除${String(option.label)}`}
                    icon={<DeleteOutlined />}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      confirmDeleteSavedLayout(String(option.value));
                    }}
                  />
                </div>
              )}
              notFoundContent="暂无已保存设计"
            />
          </div>
          <div className="receiver-freeform-size-inputs">
            <label>
              <span>宽度</span>
              <Space.Compact block>
                <InputNumber aria-label="标签宽度" min={20} max={50} precision={1} value={settings.freeform.widthMm} onChange={(value) => patchFreeform({ widthMm: value ?? 20 })} />
                <Button className="receiver-freeform-unit-button">mm</Button>
              </Space.Compact>
            </label>
            <label>
              <span>高度</span>
              <Space.Compact block>
                <InputNumber aria-label="标签高度" min={20} max={200} precision={1} value={settings.freeform.heightMm} onChange={(value) => patchFreeform({ heightMm: value ?? 20 })} />
                <Button className="receiver-freeform-unit-button">mm</Button>
              </Space.Compact>
            </label>
          </div>
          <Typography.Text type="secondary">B1 支持宽度 20–50mm，高度 20–200mm。</Typography.Text>
        </div>
        <div className="receiver-freeform-setting-group">
          <Typography.Text strong>摘要内容</Typography.Text>
          <div className="receiver-b1-switch-row"><Typography.Text>显示摘要</Typography.Text><Switch checked={settings.freeform.showOrderSummary} onChange={(value) => patchFreeform({ showOrderSummary: value })} /></div>
          <Input.TextArea
            aria-label="自由摘要文字"
            value={settings.freeform.summaryText}
            disabled={!settings.freeform.showOrderSummary}
            onChange={(event) => patchFreeform({ summaryText: event.target.value })}
            autoSize={{ minRows: 6, maxRows: 10 }}
            maxLength={2000}
            showCount
          />
          <Typography.Text type="secondary">
            可直接输入文字、按 Enter 换行，并使用动态字段：{`{{styleNo}}、{{styleName}}、{{sampleType}}、{{quantity}}、{{customerName}}、{{businessUserName}}`}。
          </Typography.Text>
        </div>
        <div className="receiver-freeform-setting-group">
          <Typography.Text strong>文字样式</Typography.Text>
          <div className="receiver-freeform-style-grid">
            <div>
              <Typography.Text type="secondary">字体大小</Typography.Text>
              <Space.Compact block>
                <Button aria-label="缩小字体" onClick={() => changeFreeformFontSize(settings.freeform.fontSizePt - 1)}>－</Button>
                <Button className="receiver-freeform-value-button" aria-live="polite">{settings.freeform.fontSizePt} pt</Button>
                <Button aria-label="放大字体" onClick={() => changeFreeformFontSize(settings.freeform.fontSizePt + 1)}>＋</Button>
              </Space.Compact>
              <Typography.Text type="secondary" className="receiver-freeform-font-hint">打印保持此字号；如内容超出，请调整文字框尺寸或文字内容。</Typography.Text>
            </div>
            <div>
              <Typography.Text type="secondary">字体样式</Typography.Text>
              <Radio.Group value={settings.freeform.bold ? "bold" : "normal"} onChange={(event) => patchFreeform({ bold: event.target.value === "bold" })} buttonStyle="solid">
                <Radio.Button value="normal">正常</Radio.Button>
                <Radio.Button value="bold">加粗</Radio.Button>
              </Radio.Group>
            </div>
          </div>
        </div>
        <div className="receiver-freeform-setting-group">
          <Typography.Text strong>打印份数</Typography.Text>
          <Space.Compact>
            <Button onClick={() => patchFreeform({ copies: Math.max(1, settings.freeform.copies - 1) })}>－</Button>
            <Button className="receiver-freeform-value-button">{settings.freeform.copies}</Button>
            <Button onClick={() => patchFreeform({ copies: Math.min(20, settings.freeform.copies + 1) })}>＋</Button>
          </Space.Compact>
        </div>
      </section>
    </div>
  );

  return (
    <Modal
      title="打印设置"
      open={open}
      width="min(1240px, calc(100vw - 32px))"
      className="receiver-b1-settings-modal"
      onCancel={onCancel}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        ...(activeTab === "freeform" ? [
          <Button key="save-as-new" loading={saving} disabled={loading} onClick={() => void save(true)}>另存为新模板</Button>
        ] : []),
        <Button key="save" type="primary" loading={saving} disabled={loading} onClick={() => void save()}>保存设置</Button>
      ]}
    >
      {contextHolder}
      {modalContextHolder}
      <Tabs
        activeKey={activeTab}
        onChange={switchTab}
        items={[
          { key: "standard", label: "标准模板", children: standardTab },
          { key: "freeform", label: "自由设计", children: freeformTab }
        ]}
      />
    </Modal>
  );
}
