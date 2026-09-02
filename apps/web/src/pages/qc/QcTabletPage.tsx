import {
  Alert,
  Button,
  Card,
  Divider,
  Empty,
  Image,
  Input,
  Modal,
  Select,
  Segmented,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import {
  BarChartOutlined,
  CameraOutlined,
  SnippetsOutlined,
  QrcodeOutlined,
  ScanOutlined
} from "@ant-design/icons";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDevSession } from "../../app/DevSessionContext";
import { TabletAccountMenu } from "../../components/tablet/TabletAccountMenu";
import {
  sampleRoomApi,
  type QcOwnPerformance,
  type QcTabletFilters,
  type QcTabletOrder,
  type QcTabletOrderDetail,
  type QcTabletOrderList,
  type ScanPageState
} from "../../api/sampleRoomApi";
import { QcInspectionPanel, type QcInspectionValues } from "../../components/qc/QcInspectionPanel";
import { QcOrderPhotosModal } from "../../components/qc/QcOrderPhotosModal";
import { QcPhotoExportButton } from "../../components/qc/QcPhotoExportButton";
import { SampleRoundTag, SampleTypeTag } from "../../components/StatusTags";
import { useVisibleAutoRefresh } from "../../hooks/useVisibleAutoRefresh";
import { formatQcTime, qcDateRange, qcTokenFromPayload, type QcDatePreset } from "../../components/qc/qcTabletUtils";
import {
  requestNativeOrderScan,
  subscribeToNativeOrderScans
} from "./tabletNativeBridge";

type PageKey = "scan" | "orders" | "performance";

const pageTitles: Record<PageKey, string> = {
  scan: "组检/出库",
  orders: "我的组检",
  performance: "绩效"
};

function thumbnail(order: QcTabletOrder) {
  return <QcOrderThumbnail order={order} />;
}

function QcOrderThumbnail({ order }: { order: QcTabletOrder }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [order.thumbnailUrl]);
  return order.thumbnailUrl && !failed
    ? <img src={order.thumbnailUrl} alt={order.styleName} onError={() => setFailed(true)} />
    : <div className="qc-tablet-thumb-placeholder"><SnippetsOutlined /></div>;
}

function QcAuthenticatedPhoto({ orderId, photoId, fileName }: { orderId: string; photoId: string; fileName: string }) {
  const { session } = useDevSession();
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void sampleRoomApi.downloadQcOrderPhoto(session, orderId, photoId).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileName, orderId, photoId, session]);
  return url
    ? <Image width={72} height={72} src={url} alt={fileName} style={{ objectFit: "cover", borderRadius: 8 }} />
    : <div className="qc-tablet-thumb-placeholder" style={{ width: 72, height: 72 }}><Spin size="small" /></div>;
}

function QcFilterBar({ value, options, onChange }: {
  value: QcTabletFilters;
  options: QcTabletOrderList["filterOptions"];
  onChange: (value: QcTabletFilters) => void;
}) {
  return (
    <div className="qc-tablet-filter-bar">
      <Input.Search allowClear placeholder="搜索款号/款名" value={value.q} onChange={(event) => onChange({ ...value, q: event.target.value || undefined })} />
      <Select allowClear placeholder="客户" value={value.customerId ?? null} options={options.customers.map((item) => ({ label: item.name, value: item.id }))} onChange={(customerId) => onChange({ ...value, customerId })} />
      <Select allowClear placeholder="业务员" value={value.clientUserId ?? null} options={options.salespersons.map((item) => ({ label: item.name, value: item.id }))} onChange={(clientUserId) => onChange({ ...value, clientUserId })} />
    </div>
  );
}

export function QcTabletPage() {
  const { session } = useDevSession();
  const [page, setPage] = useState<PageKey>("scan");
  const [messageApi, contextHolder] = message.useMessage();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedPayload, setPastedPayload] = useState("");
  const [scanState, setScanState] = useState<ScanPageState | null>(null);
  const [scanToken, setScanToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControls = useRef<IScannerControls | null>(null);

  const [orderTab, setOrderTab] = useState<"rework" | "completed">("rework");
  const [orderDatePreset, setOrderDatePreset] = useState<QcDatePreset>("week");
  const [filters, setFilters] = useState<QcTabletFilters>(() => qcDateRange("week"));
  const [orderList, setOrderList] = useState<QcTabletOrderList>({ orders: [], filterOptions: { customers: [], salespersons: [] } });
  const orderRequestIdRef = useRef(0);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [loadedOrderTab, setLoadedOrderTab] = useState<"rework" | "completed" | null>(null);
  const [reinspectOrder, setReinspectOrder] = useState<QcTabletOrderDetail | null>(null);
  const [photoOrder, setPhotoOrder] = useState<QcTabletOrder | null>(null);
  const [exportOrder, setExportOrder] = useState<QcTabletOrderDetail | null>(null);
  const [performancePreset, setPerformancePreset] = useState<QcDatePreset>("week");
  const [performanceFilters, setPerformanceFilters] = useState<QcTabletFilters>(() => qcDateRange("week"));
  const [performance, setPerformance] = useState<QcOwnPerformance | null>(null);

  const authorized = session.role === "worker" && session.activeWorkerType === "qc_delivery" && Boolean(session.activeWorkerProfileId);

  const stopScanner = useCallback(() => {
    scannerControls.current?.stop();
    scannerControls.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setScannerOpen(false);
  }, []);

  useEffect(() => () => stopScanner(), [stopScanner]);
  useEffect(() => { if (page !== "scan") stopScanner(); }, [page, stopScanner]);

  const openToken = useCallback(async (token: string) => {
    stopScanner();
    setLoading(true);
    try {
      const result = await sampleRoomApi.getScanState(token);
      setScanToken(token);
      setScanState(result.state);
    } catch (error) {
      setScanToken(null);
      setScanState(null);
      void messageApi.error(error instanceof Error ? error.message : "二维码不可用");
    } finally { setLoading(false); }
  }, [messageApi, stopScanner]);

  const parseAndOpen = useCallback(async (payload: string) => {
    try { await openToken(qcTokenFromPayload(payload)); }
    catch { void messageApi.error("只支持本系统订单二维码或 /scan/:token 链接"); }
  }, [messageApi, openToken]);

  useEffect(() => subscribeToNativeOrderScans((payload) => { void parseAndOpen(payload); }), [parseAndOpen]);

  const startScanner = async () => {
    if (requestNativeOrderScan()) {
      setScanState(null);
      setScanToken(null);
      return;
    }
    setScannerOpen(true);
    setScanState(null);
    setScanToken(null);
    try {
      const reader = new BrowserQRCodeReader();
      scannerControls.current = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (result) void parseAndOpen(result.getText());
      });
    } catch (error) {
      stopScanner();
      void messageApi.error(error instanceof Error ? `摄像头无法启动：${error.message}` : "摄像头无法启动");
    }
  };

  const finishQc = async (values: QcInspectionValues) => {
    if (!scanToken) return;
    setLoading(true);
    try {
      const { note, qualityScore, ...required } = values;
      await sampleRoomApi.completeScan(scanToken, {
        ...required,
        ...(note !== undefined ? { note } : {}),
        ...(qualityScore !== undefined ? { qualityScore } : {})
      });
      void messageApi.success(values.qualityResult === "qualified" ? "组检合格，订单已完成。" : "返工已记录，订单等待复检。");
      setScanState(null);
      setScanToken(null);
      setPage("scan");
    } catch (error) { void messageApi.error(error instanceof Error ? error.message : "提交失败"); }
    finally { setLoading(false); }
  };

  const loadOrders = useCallback(async (silent = false) => {
    if (!authorized || page !== "orders") return;
    const requestId = ++orderRequestIdRef.current;
    if (!silent) setOrdersLoading(true);
    try {
      const nextOrderList = orderTab === "rework"
        ? await sampleRoomApi.listQcReworkOrders(session, filters)
        : await sampleRoomApi.listQcCompletedOrders(session, filters);
      if (requestId === orderRequestIdRef.current) {
        const visibleOrderIds = new Set(nextOrderList.orders.map((order) => order.orderId));
        setOrderList(nextOrderList);
        setLoadedOrderTab(orderTab);
        setReinspectOrder((current) => current && !visibleOrderIds.has(current.orderId) ? null : current);
        setPhotoOrder((current) => current && !visibleOrderIds.has(current.orderId) ? null : current);
        setExportOrder((current) => current && !visibleOrderIds.has(current.orderId) ? null : current);
      }
    } catch (error) { if (!silent) void messageApi.error(error instanceof Error ? error.message : "组检记录加载失败"); }
    finally { if (requestId === orderRequestIdRef.current) setOrdersLoading(false); }
  }, [authorized, filters, messageApi, orderTab, page, session]);
  useEffect(() => { void loadOrders(); }, [loadOrders]);

  const openReinspect = async (order: QcTabletOrder) => {
    setLoading(true);
    try { setReinspectOrder((await sampleRoomApi.getQcOrder(session, order.orderId)).order); }
    catch (error) { void messageApi.error(error instanceof Error ? error.message : "复检信息加载失败"); }
    finally { setLoading(false); }
  };

  const openExport = async (order: QcTabletOrder) => {
    setLoading(true);
    try { setExportOrder((await sampleRoomApi.getQcOrder(session, order.orderId)).order); }
    catch (error) { void messageApi.error(error instanceof Error ? error.message : "组检照片加载失败"); }
    finally { setLoading(false); }
  };

  const submitReinspect = async (values: QcInspectionValues) => {
    if (!reinspectOrder) return;
    setLoading(true);
    try {
      const { note, qualityScore, ...required } = values;
      await sampleRoomApi.reinspectQcOrder(session, reinspectOrder.orderId, {
        ...required,
        ...(note !== undefined ? { note } : {}),
        ...(qualityScore !== undefined ? { qualityScore } : {})
      });
      void messageApi.success(values.qualityResult === "qualified" ? "组检合格，订单已完成。" : "返工已记录，订单等待复检。");
      setReinspectOrder(null);
      await loadOrders();
    } catch (error) { void messageApi.error(error instanceof Error ? error.message : "复检提交失败"); }
    finally { setLoading(false); }
  };

  const loadPerformance = useCallback(async (silent = false) => {
    if (!authorized || page !== "performance") return;
    if (!silent) setLoading(true);
    try { setPerformance(await sampleRoomApi.getQcOwnPerformance(session, performanceFilters)); }
    catch (error) { if (!silent) void messageApi.error(error instanceof Error ? error.message : "绩效加载失败"); }
    finally { if (!silent) setLoading(false); }
  }, [authorized, messageApi, page, performanceFilters, session]);
  useEffect(() => { void loadPerformance(); }, [loadPerformance]);

  const refreshOpenScanState = useCallback(async () => {
    if (!authorized || page !== "scan" || !scanToken || !scanState) return;
    const result = await sampleRoomApi.getScanState(scanToken);
    setScanState(result.state);
  }, [authorized, page, scanState, scanToken]);

  useVisibleAutoRefresh(async () => {
    await Promise.all([refreshOpenScanState(), loadOrders(true), loadPerformance(true)]);
  }, authorized);

  const navItems = useMemo(() => [
    { key: "scan" as const, label: "扫码", icon: <ScanOutlined /> },
    { key: "orders" as const, label: "我的组检", icon: <SnippetsOutlined /> },
    { key: "performance" as const, label: "绩效", icon: <BarChartOutlined /> }
  ], []);

  if (!authorized) {
    return <div className="qc-tablet-denied"><Alert type="error" showIcon message="无权进入组检/出库 Pad 工作台" description="仅当前岗位为组检/出库的有效 Worker 账号可以使用。" /></div>;
  }

  const scanPage = (
    <div className="qc-tablet-scan-page">
      {!scanState ? (
        <div className="qc-tablet-scan-hero">
          <div className="qc-tablet-scan-icon"><QrcodeOutlined /></div>
          <Typography.Title level={2}>扫码进入组检</Typography.Title>
          <Typography.Text>扫描订单二维码后，查看订单资料并填写 QC 结果</Typography.Text>
          <Button type="primary" size="large" icon={<CameraOutlined />} onClick={() => void startScanner()}>扫码进入组检</Button>
          <Button type="link" onClick={() => setPasteOpen(true)}>粘贴扫码链接</Button>
          {scannerOpen ? (
            <div className="qc-tablet-camera-box">
              <video ref={videoRef} muted playsInline />
              <div className="qc-tablet-scan-frame" />
              <Button onClick={stopScanner}>关闭摄像头</Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="qc-tablet-inspection-layout">
          <Card className="qc-tablet-order-summary" title="订单信息">
            <div className="qc-tablet-order-summary-grid">
              {scanState.order.thumbnailUrl ? <img src={scanState.order.thumbnailUrl} alt={scanState.order.styleName} /> : null}
              <Space direction="vertical">
                <Typography.Text>款号 <strong>{scanState.order.styleNo}</strong></Typography.Text>
                <Typography.Text>款名 <strong>{scanState.order.styleName}</strong></Typography.Text>
                <Typography.Text>订单数量 <strong>{scanState.order.quantity} 件</strong></Typography.Text>
                <Typography.Text>当前工序 <Tag color="blue">{scanState.stageLabel}</Tag></Typography.Text>
              </Space>
            </div>
            <Divider />
            <Typography.Title level={5}>接单员备注 / 客户特殊要求</Typography.Title>
            <div className="qc-order-note">{[scanState.order.remark, scanState.order.taskInstructionNote].filter(Boolean).join("\n") || "-"}</div>
          </Card>
          <Card className="qc-tablet-inspection-card" title="QC 结果" extra={<Button onClick={() => Modal.confirm({ title: "关闭当前订单？", content: "未提交的内容将被清空，订单数据不会改变。", okText: "确认关闭", cancelText: "继续填写", onOk: () => { setScanState(null); setScanToken(null); } })}>× 关闭当前订单</Button>}>
            {scanState.allowedAction === "complete" && scanState.stage === "qc_delivery" ? (
              <QcInspectionPanel
                state={scanState}
                compact
                submitting={loading}
                onSubmit={finishQc}
              />
            ) : <Alert type="warning" showIcon message={scanState.message ?? "当前订单不能处理"} />}
          </Card>
        </div>
      )}
    </div>
  );

  const ordersPage = (
    <div className="qc-tablet-orders-page">
      <Tabs activeKey={orderTab} onChange={(key) => setOrderTab(key as typeof orderTab)} tabBarExtraContent={<div className="qc-order-date-filter">
        <Segmented value={orderDatePreset} onChange={(value) => {
          const preset = value as QcDatePreset;
          setOrderDatePreset(preset);
          if (preset !== "custom") setFilters((current) => ({ ...current, ...qcDateRange(preset) }));
        }} options={[
          { label: "今天", value: "today" },
          { label: "本周", value: "week" },
          { label: "本月", value: "month" },
          { label: "自定义", value: "custom" }
        ]} />
        {orderDatePreset === "custom" ? <Space.Compact className="qc-custom-date-range">
          <Input type="date" aria-label="开始日期" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value || undefined })} />
          <Input type="date" aria-label="结束日期" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value || undefined })} />
        </Space.Compact> : null}
      </div>} items={[
        { key: "rework", label: "待返工" },
        { key: "completed", label: "已完成" }
      ]} />
      <QcFilterBar value={filters} options={orderList.filterOptions} onChange={setFilters} />
      <div className="qc-tablet-order-list">
        {loadedOrderTab !== orderTab || orderList.orders.length === 0 ? <Empty description={orderTab === "rework" ? "暂无本人待返工订单" : "暂无本人已完成订单"} /> : orderList.orders.map((order) => (
          <Card key={order.orderId} className="qc-tablet-order-row">
            <div className="qc-tablet-order-thumb">{thumbnail(order)}</div>
            <div className="qc-tablet-order-primary">
              <Typography.Title level={4}>{order.styleNo}</Typography.Title>
              <Typography.Text strong>{order.styleName}</Typography.Text>
              {orderTab === "completed" ? <Space wrap className="qc-order-meta-tags"><Space size={4}><Typography.Text type="secondary">样衣类别</Typography.Text><SampleTypeTag value={order.sampleType} /></Space><Space size={4}><Typography.Text type="secondary">轮次</Typography.Text><SampleRoundTag value={order.sampleRound} /></Space><Tag>数量：{order.quantity}件</Tag></Space> : null}
            </div>
            <div className="qc-tablet-order-customer"><span>客户</span><strong>{order.customerName}</strong><span>业务员</span><strong>{order.salespersonName}</strong></div>
            {orderTab === "rework" ? (
              <div className="qc-tablet-order-result"><span>数量</span><strong>{order.quantity} 件</strong><span>返工原因</span><strong>{order.note || "-"}</strong><span>返工时间</span><strong>{formatQcTime(order.eventTime)}</strong></div>
            ) : (
              <div className="qc-tablet-order-result"><span>完成时间</span><strong>{formatQcTime(order.eventTime)}</strong><span>QC 结果</span><strong className="qc-qualified">合格</strong><span>质量得分</span><strong className="qc-score">{order.qualityScore ?? "-"} 分</strong></div>
            )}
            <div className="qc-tablet-order-action">
              {orderTab === "rework" ? <><Tag color="orange">待返工</Tag><Button type="primary" onClick={() => void openReinspect(order)}>进入复检</Button></> : <Button type="primary" onClick={() => setPhotoOrder(order)}>查看 / 补充</Button>}
              {orderTab === "completed" ? <Button onClick={() => void openExport(order)}>组检报告导出</Button> : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );

  const performancePage = (
    <div className="qc-tablet-performance-page">
      <div className="qc-performance-filter">
        <Segmented value={performancePreset} onChange={(value) => { const preset = value as QcDatePreset; setPerformancePreset(preset); if (preset !== "custom") setPerformanceFilters(qcDateRange(preset)); }} options={[
          { label: "今天", value: "today" }, { label: "本周", value: "week" }, { label: "本月", value: "month" }, { label: "自定义", value: "custom" }
        ]} />
        {performancePreset === "custom" ? <Space.Compact><Input type="date" value={performanceFilters.dateFrom} onChange={(event) => setPerformanceFilters({ ...performanceFilters, dateFrom: event.target.value || undefined })} /><Input type="date" value={performanceFilters.dateTo} onChange={(event) => setPerformanceFilters({ ...performanceFilters, dateTo: event.target.value || undefined })} /></Space.Compact> : null}
      </div>
      <div className="qc-performance-cards">
        <Card><span>完成组检订单数</span><strong>{performance?.summary.completedOrders ?? 0}<small> 单</small></strong></Card>
        <Card><span>检查件数</span><strong>{performance?.summary.checkedPieces ?? performance?.summary.completedPieces ?? 0}<small> 件</small></strong></Card>
        <Card><span>被投诉订单数</span><strong className="qc-warning-number">{performance?.summary.complaintOrders ?? 0}<small> 单</small></strong></Card>
        <Card><span>投诉率</span><strong>{(performance?.summary.complaintRate ?? 0).toFixed(2)}<small> %</small></strong></Card>
      </div>
      <Typography.Title level={4}>完成记录</Typography.Title>
      <div className="qc-performance-table">
        <div className="qc-performance-row qc-performance-head"><span>日期</span><span>客户</span><span>客户业务员</span><span>款号</span><span>款名</span><span>件数</span><span>质量评分</span><span>返工次数</span><span>投诉情况</span></div>
        {performance?.records.map((record) => <div className="qc-performance-row" key={`${record.styleNo}-${record.completedAt}`}><span>{record.completedAt.slice(5, 10)}</span><span>{record.customerName}</span><span>{record.salespersonName}</span><span>{record.styleNo}</span><span>{record.styleName}</span><span>{record.pieces ?? 0}</span><span>{record.qualityScore ?? "-"}</span><span>{record.reworkCount ?? 0}次</span><span className={(record.complaintCount ?? 0) > 0 ? "qc-complaint" : ""}>{(record.complaintCount ?? 0) > 0 ? `${record.complaintCount} 起` : "无"}</span></div>)}
      </div>
    </div>
  );

  return (
    <div className="qc-tablet-shell">
      {contextHolder}
      <header className="qc-tablet-header">
        <Typography.Title level={4}>{pageTitles[page]}</Typography.Title>
        <TabletAccountMenu roleLabel="组检/出库" />
      </header>
      <main className="qc-tablet-main"><Spin spinning={page === "orders" ? ordersLoading && loadedOrderTab !== orderTab : loading}>{page === "scan" ? scanPage : page === "orders" ? ordersPage : performancePage}</Spin></main>
      <nav className="qc-tablet-bottom-nav">
        {navItems.map((item) => <button type="button" key={item.key} className={page === item.key ? "active" : ""} onClick={() => setPage(item.key)}>{item.icon}<span>{item.label}</span></button>)}
      </nav>

      <Modal title="粘贴扫码链接" open={pasteOpen} onCancel={() => setPasteOpen(false)} onOk={() => { setPasteOpen(false); void parseAndOpen(pastedPayload); }} okText="打开" cancelText="取消">
        <Input.TextArea value={pastedPayload} onChange={(event) => setPastedPayload(event.target.value)} rows={3} placeholder="粘贴 /scan/:token 链接或本系统二维码内容" />
      </Modal>
      <Modal className="qc-reinspect-modal" width="calc(100vw - 32px)" title="返工复检" open={Boolean(reinspectOrder)} onCancel={() => setReinspectOrder(null)} footer={null} destroyOnHidden>
        {reinspectOrder ? <div className="qc-tablet-inspection-layout qc-reinspect-layout"><Card title="订单信息" className="qc-tablet-order-summary">
          <div className="qc-tablet-order-summary-grid">{reinspectOrder.thumbnailUrl ? <img src={reinspectOrder.thumbnailUrl} alt={reinspectOrder.styleName} /> : null}<Space direction="vertical"><Typography.Text>款号 <strong>{reinspectOrder.styleNo}</strong></Typography.Text><Typography.Text>款名 <strong>{reinspectOrder.styleName}</strong></Typography.Text><Typography.Text>数量 <strong>{reinspectOrder.quantity} 件</strong></Typography.Text><Typography.Text>客户 <strong>{reinspectOrder.customerName}</strong></Typography.Text></Space></div>
          <Divider /><Typography.Title level={5}>接单员备注 / 客户特殊要求</Typography.Title><div className="qc-order-note">{[reinspectOrder.remark, reinspectOrder.taskInstructionNote].filter(Boolean).join("\n") || "-"}</div>
          {reinspectOrder.latestRework ? <><Divider /><Typography.Title level={5}>当前返工信息</Typography.Title><Alert type="warning" showIcon message={`返工原因：${reinspectOrder.latestRework.note ?? "-"}`} description={<Space direction="vertical"><span>登记人：{reinspectOrder.latestRework.workerName ?? "-"}</span><span>登记时间：{formatQcTime(reinspectOrder.latestRework.eventTime)}</span><span>问题照片：{reinspectOrder.latestRework.photos.length ? `${reinspectOrder.latestRework.photos.length} 张` : "未上传"}</span>{reinspectOrder.latestRework.photos.length ? <Image.PreviewGroup><Space wrap>{reinspectOrder.latestRework.photos.map((photo) => <QcAuthenticatedPhoto key={photo.id} orderId={reinspectOrder.orderId} photoId={photo.id} fileName={photo.fileName} />)}</Space></Image.PreviewGroup> : null}</Space>} /></> : null}
        </Card><Card title="本次复检结果" className="qc-tablet-inspection-card"><QcInspectionPanel state={reinspectOrder.state} compact submitting={loading} onSubmit={submitReinspect} /></Card></div> : null}
      </Modal>
      {exportOrder ? <QcPhotoExportButton
          order={exportOrder}
          photos={exportOrder.attachments.filter((photo) => photo.category !== "qc_issue_photo")}
          loadPhoto={(photo) => sampleRoomApi.downloadQcOrderPhoto(session, exportOrder.orderId, photo.id)}
          autoOpen
          onClose={() => setExportOrder(null)}
        /> : null}
      <QcOrderPhotosModal open={Boolean(photoOrder)} order={photoOrder} session={session} onClose={() => setPhotoOrder(null)} onChanged={() => void loadOrders()} />
    </div>
  );
}
