import { EditOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
  type TableColumnsType
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { request } from "../../api/request";
import { useDevSession } from "../../app/DevSessionContext";
import { isNativeTabletRuntime } from "../qc/tabletNativeBridge";
import { useAuthSession } from "../../app/AuthSessionContext";
import { sampleRoomApi, type PerformanceReport } from "../../api/sampleRoomApi";
import { bossPerformanceQuickRangeDates } from "./bossPerformanceDates";
import { useVisibleAutoRefresh } from "../../hooks/useVisibleAutoRefresh";
import { NON_SEARCHABLE_PAGE_SIZE_CHANGER } from "../../components/tablet/pagination";

type PerformanceStage = "pattern" | "cutting" | "sewing" | "receiver" | "finishing" | "qc_delivery";
type QuickRange = "week" | "month" | "three_months" | "custom";
type EmployeeRow = PerformanceReport["employees"][number];
type PieceCorrectionLog = {
  changedAt: string;
  changedByRole: string;
  changedByAccountId: string;
  changedByName?: string;
  reason?: string;
  oldValue: number | null;
  newValue: number | null;
};
type OrderRow = NonNullable<PerformanceReport["orders"]>[number] & {
  latestCompletion?: {
    source?: "pattern_task" | "scan_record";
    recordId?: string;
  };
  pieceCorrections?: PieceCorrectionLog[];
};
type PieceCorrectionFlowRow = {
  key: string;
  time: string;
  actor: string;
  detail: string;
};

const stageOptions: Array<{ label: string; value: PerformanceStage }> = [
  { label: "版师绩效", value: "pattern" },
  { label: "裁剪绩效", value: "cutting" },
  { label: "缝制绩效", value: "sewing" },
  { label: "接单员绩效", value: "receiver" },
  { label: "后整绩效", value: "finishing" },
  { label: "组检/出库绩效", value: "qc_delivery" }
];

function quickRangeDates(range: Exclude<QuickRange, "custom">) {
  return bossPerformanceQuickRangeDates(range);
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "未录入";
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function correctionActor(log: PieceCorrectionLog) {
  if (log.changedByName) return log.changedByName;
  if (log.changedByRole === "worker") return "员工";
  if (log.changedByRole === "boss") return "老板";
  if (log.changedByRole === "system_owner") return "System Owner";
  return log.changedByRole;
}

function correctionValue(value: number | null) {
  return value === null ? "-" : String(value);
}

export function BossPerformancePage() {
  const tabletLayout = isNativeTabletRuntime();
  const { session } = useDevSession();
  const { logout } = useAuthSession();
  const initialLoadStarted = useRef(false);
  const [report, setReport] = useState<PerformanceReport>();
  const [loading, setLoading] = useState(false);
  const defaultDates = useMemo(() => quickRangeDates("week"), []);
  const [quickRange, setQuickRange] = useState<QuickRange>("week");
  const [dateFrom, setDateFrom] = useState(defaultDates.dateFrom);
  const [dateTo, setDateTo] = useState(defaultDates.dateTo);
  const [stage, setStage] = useState<PerformanceStage>("pattern");
  const [selectedIdentityId, setSelectedIdentityId] = useState("");
  const [employeeDirectory, setEmployeeDirectory] = useState<EmployeeRow[]>([]);
  const [editingOrder, setEditingOrder] = useState<OrderRow | null>(null);
  const [editingPieces, setEditingPieces] = useState<number | null>(null);
  const [editingReason, setEditingReason] = useState("");
  const [savingPieces, setSavingPieces] = useState(false);
  const [logOrder, setLogOrder] = useState<OrderRow | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const load = async (
    nextStage = stage,
    nextIdentityId = selectedIdentityId,
    dates = { dateFrom, dateTo },
    silent = false
  ) => {
    if (!silent) setLoading(true);
    try {
      const nextReport = await sampleRoomApi.getAdminPerformance(session, {
        dateFrom: dates.dateFrom,
        dateTo: dates.dateTo,
        stage: nextStage,
        ...(nextIdentityId && nextStage !== "finishing"
          ? (["cutting", "sewing", "qc_delivery"].includes(nextStage)
              ? { workerProfileId: nextIdentityId }
              : { accountId: nextIdentityId })
          : {}),
        includeOrderDetails:
          Boolean(nextIdentityId) &&
          ["cutting", "sewing", "qc_delivery"].includes(nextStage)
      });
      setReport(nextReport);
      if (!nextIdentityId) setEmployeeDirectory(nextReport.employees);
    } catch (error) {
      if (silent) return;
      if (session.authMode === "formal" && error instanceof Error && error.message === "forbidden") {
        messageApi.error("登录会话已失效，请重新登录");
        await logout();
        return;
      }
      messageApi.error(error instanceof Error ? error.message : "绩效数据加载失败");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void load("pattern", "");
  }, []);

  useVisibleAutoRefresh(() => load(stage, selectedIdentityId, { dateFrom, dateTo }, true));

  const applyQuickRange = (value: QuickRange) => {
    setQuickRange(value);
    if (value !== "custom") {
      const dates = quickRangeDates(value);
      setDateFrom(dates.dateFrom);
      setDateTo(dates.dateTo);
    }
  };

  const changeStage = (value: string) => {
    const nextStage = value as PerformanceStage;
    setStage(nextStage);
    setSelectedIdentityId("");
    setLogOrder(null);
    void load(nextStage, "");
  };

  const changeEmployee = (nextIdentityId: string) => {
    setSelectedIdentityId(nextIdentityId);
    setLogOrder(null);
    void load(stage, nextIdentityId);
  };

  const resetFilters = () => {
    const dates = quickRangeDates("week");
    setQuickRange("week");
    setDateFrom(dates.dateFrom);
    setDateTo(dates.dateTo);
    setSelectedIdentityId("");
    setLogOrder(null);
    void load(stage, "", dates);
  };

  const startPieceCorrection = (row: OrderRow) => {
    if (
      (stage !== "cutting" && stage !== "sewing") ||
      row.latestCompletion?.source !== "scan_record" ||
      !row.latestCompletion.recordId ||
      row.pieces === null ||
      row.pieces === undefined
    ) {
      messageApi.warning("当前订单没有可修正的工序完工件数");
      return;
    }
    setEditingOrder(row);
    setEditingPieces(row.pieces);
    setEditingReason("");
  };

  const savePieceCorrection = async () => {
    const scanRecordId = editingOrder?.latestCompletion?.recordId;
    if (!editingOrder || !scanRecordId || editingPieces === null) return;
    if (!Number.isInteger(editingPieces) || editingPieces < 0) {
      messageApi.warning("件数必须是大于等于 0 的整数");
      return;
    }
    if (editingPieces === editingOrder.pieces) {
      messageApi.info("件数没有变化");
      return;
    }
    if (!editingReason.trim()) {
      messageApi.warning("请填写修改原因");
      return;
    }

    setSavingPieces(true);
    try {
      await request(
        session,
        `/api/admin/performance/orders/${encodeURIComponent(editingOrder.orderId)}/scan-records/${encodeURIComponent(scanRecordId)}/pieces`,
        {
          method: "PATCH",
          body: JSON.stringify({ pieces: editingPieces, reason: editingReason.trim() })
        }
      );
      setEditingOrder(null);
      setEditingPieces(null);
      setEditingReason("");
      messageApi.success("工序件数已修正；原始完工记录已保留");
      await load(stage, selectedIdentityId, { dateFrom, dateTo });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "工序件数修改失败");
    } finally {
      setSavingPieces(false);
    }
  };

  const employeeOptions = useMemo(() => [
    { label: "全部员工", value: "" },
    ...employeeDirectory.map((employee) => ({
      label: employee.employeeName,
      value: employee.workerProfileId ?? employee.accountId
    }))
  ], [employeeDirectory]);

  const summaryCards = () => {
    if (!report) return null;
    const summary = report.roleSummary;
    if (stage === "pattern") return <>
      <Card size="small"><Statistic title="完成综合版师任务数" value={summary.pattern.completedPatternTasks} /></Card>
      <Card size="small"><Statistic title="涉及订单数" value={summary.pattern.involvedOrders} /></Card>
    </>;
    if (stage === "cutting") return <>
      <Card size="small"><Statistic title="完成裁剪订单数" value={summary.cutting.completedOrders} /></Card>
      <Card size="small"><Statistic title="实际裁剪件数" value={summary.cutting.completedPieces} /></Card>
      <Card size="small"><Statistic title="总工时" value={formatNumber(report.overview.cutting.totalHours)} suffix="小时" /></Card>
      <Card size="small">
        <Statistic
          title="每小时产出"
          value={formatNumber(
            report.overview.cutting.totalHours > 0
              ? summary.cutting.completedPieces / report.overview.cutting.totalHours
              : null
          )}
          suffix="件/小时"
        />
      </Card>
    </>;
    if (stage === "sewing") return <>
      <Card size="small"><Statistic title="完成订单数" value={summary.sewing.completedOrders} /></Card>
      <Card size="small"><Statistic title="完成件数" value={summary.sewing.completedPieces} /></Card>
      <Card size="small"><Statistic title="总工时" value={formatNumber(summary.sewing.totalHours)} suffix="小时" /></Card>
      <Card size="small"><Statistic title="每小时产出" value={formatNumber(summary.sewing.hourlyOutput)} suffix="件/小时" /></Card>
      <Card size="small"><Statistic title="平均组检评分" value={formatNumber(summary.sewing.averageQualityScore, 1)} /></Card>
      <Card size="small"><Statistic title="整体返工率" value={formatNumber(summary.sewing.reworkRate, 2)} suffix="%" /></Card>
      <Card size="small"><Statistic title="未最终评分订单数" value={summary.sewing.unratedOrders} /></Card>
    </>;
    if (stage === "receiver") return <Card size="small"><Statistic title="正式录入订单数" value={summary.receiver.formalOrders} /></Card>;
    if (stage === "finishing") return <>
      <Card size="small"><Statistic title="后整订单数" value={summary.finishing.completedOrders} /></Card>
      <Card size="small"><Statistic title="后整件数" value={summary.finishing.completedPieces ?? "—"} /></Card>
      <Card size="small"><Statistic title="老板录入后整金额总计" value={formatMoney(summary.finishing.amount)} /></Card>
      <Card size="small"><Statistic title="每单后整平均价" value={formatMoney(summary.finishing.averageAmountPerPricedOrder)} /></Card>
      <Card size="small"><Statistic title="每件成品后整平均价" value={formatMoney(summary.finishing.averageAmountPerPricedPiece)} /></Card>
    </>;
    return <>
      <Card size="small"><Statistic title="完成组检/出库订单数" value={summary.qcDelivery.completedOrders} /></Card>
      <Card size="small"><Statistic title="实收核对件数" value={summary.qcDelivery.checkedPieces} /></Card>
      <Card size="small"><Statistic title="客诉订单数" value={summary.qcDelivery.complaintOrders} /></Card>
      <Card size="small"><Statistic title="客诉比例" value={formatNumber(summary.qcDelivery.complaintRate)} suffix="%" /></Card>
    </>;
  };

  const columns = useMemo<TableColumnsType<EmployeeRow>>(() => {
    const base: TableColumnsType<EmployeeRow> = [
      { title: "排序", width: 72, render: (_value, _row, index) => index + 1 },
      { title: "员工", render: (_value, row) => row.employeeName }
    ];
    if (stage === "pattern") return [...base,
      { title: "完成综合版师任务数", dataIndex: "completedPatternTasks" },
      { title: "涉及订单数", dataIndex: "involvedOrders" }
    ];
    if (stage === "cutting") return [...base,
      { title: "完成裁剪订单数", dataIndex: "completedOrders" },
      { title: "实际裁剪件数", dataIndex: "completedPieces" }
    ];
    if (stage === "sewing") return [...base,
      { title: "完成订单数", dataIndex: "completedOrders" },
      { title: "完成件数", dataIndex: "completedPieces" },
      { title: "总工时", render: (_value, row) => formatNumber(row.totalHours) },
      { title: "每小时产出", render: (_value, row) => formatNumber(row.hourlyOutput) },
      { title: "平均组检评分", render: (_value, row) => formatNumber(row.averageQualityScore, 1) },
      { title: "未最终评分订单数", dataIndex: "unratedOrders" },
      { title: "返工率", render: (_value, row) => `${formatNumber(row.reworkRate ?? 0, 2)}%` }
    ];
    if (stage === "receiver") return [...base, { title: "正式录入订单数", dataIndex: "formalOrders" }];
    return [...base,
      { title: "完成订单数", dataIndex: "completedOrders" },
      { title: "实收核对件数", dataIndex: "checkedPieces" },
      { title: "客诉订单数", dataIndex: "complaintOrders" },
      { title: "客诉比例", render: (_value, row) => `${formatNumber(row.complaintRate)}%` }
    ];
  }, [stage]);

  const pieceCell = (row: OrderRow) => (
    <Space size={4}>
      <span>{formatNumber(row.pieces)}</span>
      <Button
        type="text"
        size="small"
        icon={<EditOutlined />}
        aria-label={`修改${stage === "cutting" ? "裁剪" : "缝制"}件数`}
        onClick={() => startPieceCorrection(row)}
      />
    </Space>
  );

  const logActionCell = (row: OrderRow) => (
    <Button size="small" onClick={() => setLogOrder(row)}>
      查看日志
    </Button>
  );

  const orderDetailColumns = useMemo<TableColumnsType<OrderRow>>(() => {
    const base: TableColumnsType<OrderRow> = [
      {
        title: "完成时间",
        dataIndex: "completedAt",
        width: 160,
        render: (value?: string) => value
          ? new Date(value).toLocaleString("zh-CN", { hour12: false })
          : "-"
      },
      {
        title: "款式 / 款号",
        width: 240,
        render: (_value, row) => (
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{row.styleNo || "-"}</Typography.Text>
            <Typography.Text type="secondary">{row.styleName || "-"}</Typography.Text>
          </Space>
        )
      }
    ];
    if (stage === "cutting") {
      return [
        ...base,
        { title: "裁剪件数", width: 120, render: (_value, row) => pieceCell(row) },
        { title: "工时（小时）", dataIndex: "workHours", width: 130, render: (value) => formatNumber(value) },
        { title: "操作", width: 110, align: "center", render: (_value, row) => logActionCell(row) }
      ];
    }
    if (stage === "sewing") {
      return [
        ...base,
        { title: "缝制件数", width: 120, render: (_value, row) => pieceCell(row) },
        { title: "工时（小时）", dataIndex: "workHours", width: 130, render: (value) => formatNumber(value) },
        {
          title: "最终组检评分",
          dataIndex: "qualityScore",
          width: 130,
          render: (value?: number | null) =>
            value === null || value === undefined ? "未评分" : formatNumber(value, 1)
        },
        { title: "操作", width: 110, align: "center", render: (_value, row) => logActionCell(row) }
      ];
    }
    return [
      {
        title: "日期",
        dataIndex: "completedAt",
        width: 100,
        render: (value?: string) => value ? value.slice(5, 10) : "-"
      },
      { title: "客户", dataIndex: "customerName", width: 170, ellipsis: true },
      { title: "客户业务员", dataIndex: "salespersonName", width: 150, ellipsis: true },
      { title: "款号", dataIndex: "styleNo", width: 170, ellipsis: true },
      { title: "款名", dataIndex: "styleName", width: 180, ellipsis: true },
      { title: "件数", dataIndex: "pieces", width: 90, render: (value) => formatNumber(value) },
      {
        title: "质量评分",
        dataIndex: "qualityScore",
        width: 110,
        render: (value?: number | null) => value === null || value === undefined ? "-" : formatNumber(value, 1)
      },
      { title: "返工次数", dataIndex: "reworkCount", width: 110, render: (value?: number) => `${value ?? 0}次` },
      {
        title: "投诉情况",
        dataIndex: "complaintCount",
        width: 130,
        render: (value?: number) => value && value > 0
          ? <Tag color="red">{value} 起</Tag>
          : <Tag>无</Tag>
      }
    ];
  }, [stage]);

  const pieceCorrectionLogRows: PieceCorrectionFlowRow[] = [...(logOrder?.pieceCorrections ?? [])]
    .reverse()
    .map((log, index) => ({
      key: `${log.changedAt}-${index}`,
      time: log.changedAt,
      actor: correctionActor(log),
      detail: `${correctionValue(log.oldValue)} → ${correctionValue(log.newValue)} 件`
    }));

  return (
    <Space direction="vertical" size={16} className="full-width boss-performance-page">
      {contextHolder}
      <Card className="section-card">
        <Typography.Title level={3}>员工绩效</Typography.Title>
        <Typography.Text type="secondary">查看各岗位员工的绩效表现与关键数据。</Typography.Text>
      </Card>

      <Card className="section-card boss-performance-content-card">
        <Tabs activeKey={stage} onChange={changeStage} items={stageOptions.map((option) => ({ key: option.value, label: option.label }))} />
        <div className="boss-performance-filter-bar">
          {stage !== "finishing" ? <>
            <Typography.Text>员工</Typography.Text>
            <Select value={selectedIdentityId} onChange={changeEmployee} options={employeeOptions} style={{ width: 150 }} />
          </> : null}
          <Typography.Text>时间</Typography.Text>
          <Segmented
            value={quickRange}
            onChange={(value) => applyQuickRange(value as QuickRange)}
            options={[
              { label: "本周", value: "week" },
              { label: "本月", value: "month" },
              { label: "近三个月", value: "three_months" },
              { label: "自定义", value: "custom" }
            ]}
          />
          {quickRange === "custom" ? <>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="开始日期" />
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="结束日期" />
          </> : null}
          <Button type="primary" loading={loading} onClick={() => void load()}>查询</Button>
          <Button onClick={resetFilters}>重置</Button>
        </div>

        <div className={`boss-performance-role-summary boss-performance-role-summary-${stage}`}>
          {summaryCards()}
        </div>

        {stage === "finishing" && report ? (
          <Alert
            type="info"
            showIcon
            message={`后整金额取自老板在订单定价中录入的后整金额。${report.roleSummary.finishing.missingAmountOrders > 0 ? `当前有 ${report.roleSummary.finishing.missingAmountOrders} 个订单未录入金额，未参与平均值计算。` : ""}`}
          />
        ) : null}

        {stage !== "finishing" &&
        !(
          selectedIdentityId &&
          ["cutting", "sewing", "qc_delivery"].includes(stage)
        ) ? (
          <Table
            className="boss-performance-ranking-table"
            rowKey={(row) => `${row.stage}-${row.workerProfileId ?? row.accountId}`}
            loading={loading}
            dataSource={report?.employees ?? []}
            columns={columns}
            scroll={{ x: "max-content", ...(tabletLayout ? { y: "100%" } : {}) }}
            pagination={false}
            locale={{ emptyText: "暂无绩效数据" }}
          />
        ) : null}

        {selectedIdentityId &&
        ["cutting", "sewing", "qc_delivery"].includes(stage) ? (
          <Space direction="vertical" size={10} className="full-width">
            <Typography.Title level={5}>所选员工完成订单</Typography.Title>
            <Table<OrderRow>
              className="boss-performance-order-detail-table"
              rowKey={(row) => `${row.orderId}-${row.completedAt ?? ""}`}
              loading={loading}
              dataSource={(report?.orders ?? []) as OrderRow[]}
              columns={orderDetailColumns}
              scroll={{ x: "max-content", ...(tabletLayout ? { y: "100%" } : {}) }}
              pagination={tabletLayout
                ? { defaultPageSize: 10, showSizeChanger: NON_SEARCHABLE_PAGE_SIZE_CHANGER, pageSizeOptions: [8, 10, 12, 20] }
                : { pageSize: 10, showSizeChanger: false }}
              locale={{ emptyText: "当前时间范围暂无完成订单" }}
            />
          </Space>
        ) : null}
      </Card>

      <Modal
        title={`修正${stage === "cutting" ? "裁剪" : "缝制"}件数`}
        open={Boolean(editingOrder)}
        onCancel={() => {
          setEditingOrder(null);
          setEditingPieces(null);
          setEditingReason("");
        }}
        onOk={() => void savePieceCorrection()}
        okText="确认修改"
        cancelText="取消"
        confirmLoading={savingPieces}
        okButtonProps={{
          disabled:
            editingPieces === null ||
            !Number.isInteger(editingPieces) ||
            editingPieces < 0 ||
            editingPieces === editingOrder?.pieces ||
            !editingReason.trim()
        }}
      >
        <Space direction="vertical" size={12} className="full-width">
          <Typography.Text type="secondary">
            原始工序完工记录会永久保留；本操作只调整绩效、金额和报表，不改变订单阶段、参与人员或组检状态。
          </Typography.Text>
          {editingOrder ? (
            <Typography.Text>
              {editingOrder.styleNo} / {editingOrder.styleName || "-"}
            </Typography.Text>
          ) : null}
          <InputNumber
            min={0}
            precision={0}
            value={editingPieces}
            onChange={(value) => setEditingPieces(value === null ? null : Number(value))}
            addonAfter="件"
            className="full-width"
          />
          <Input.TextArea
            rows={3}
            maxLength={200}
            showCount
            value={editingReason}
            onChange={(event) => setEditingReason(event.target.value)}
            placeholder="必填：请说明为什么需要修正件数"
          />
        </Space>
      </Modal>

      <Modal
        title={`件数修改日志${logOrder?.styleNo ? ` · ${logOrder.styleNo}` : ""}`}
        open={Boolean(logOrder)}
        onCancel={() => setLogOrder(null)}
        footer={<Button onClick={() => setLogOrder(null)}>关闭</Button>}
        width={760}
      >
        <div className="boss-order-flow-tab">
          {pieceCorrectionLogRows.length > 0 ? (
            <Table<PieceCorrectionFlowRow>
              className="boss-order-flow-table"
              rowKey="key"
              size="small"
              bordered
              pagination={false}
              rowClassName={() => "boss-flow-row boss-flow-row-active"}
              columns={[
                {
                  title: "",
                  key: "status",
                  width: 54,
                  align: "center",
                  render: () => (
                    <span className="boss-flow-status boss-flow-status-active">
                      <EditOutlined />
                    </span>
                  )
                },
                {
                  title: "时间",
                  dataIndex: "time",
                  width: 190,
                  render: (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false })
                },
                {
                  title: "节点",
                  dataIndex: "actor",
                  width: 210,
                  render: (value: string) => (
                    <span>{value} 修改{stage === "cutting" ? "裁剪" : "缝制"}件数</span>
                  )
                },
                { title: "说明", dataIndex: "detail" }
              ]}
              dataSource={pieceCorrectionLogRows}
              scroll={{ y: 360 }}
            />
          ) : (
            <Empty description="暂无修改记录" />
          )}
        </div>
      </Modal>
    </Space>
  );
}
