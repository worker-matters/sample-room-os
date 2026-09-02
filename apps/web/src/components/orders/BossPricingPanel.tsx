import {
  DownloadOutlined,
  RollbackOutlined
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
  type TableProps
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, type Key } from "react";
import { hasPhysicalProductionRoute } from "@sample-room/shared";
import {
  sampleRoomApi,
  type OrderAttachment,
  type OrderChargeRecord,
  type OrderRecord,
  type PricingRow,
  type ReconciliationStatement,
  type ReconciliationStatementExportColumn,
  type ReconciliationStatementListOptions,
  type ReconciliationStatementItemSnapshot
} from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";
import { NON_SEARCHABLE_PAGE_SIZE_CHANGER } from "../tablet/pagination";
import { BossStatsStrip } from "../boss/BossStatsStrip";
import { SampleRoundTag, SampleTypeTag } from "../StatusTags";
import { OrderAttachmentThumbnail } from "./OrderAttachmentThumbnail";
import { OrderTaskStatusBadges } from "../operations/PatternTaskStatusBadges";
import { OrderCompletionTag, orderCompletionLabel } from "../operations/OrderCompletionStatus";
import { usePersistedColumnKeys } from "./usePersistedColumnKeys";
import { DynamicPricingModal } from "./DynamicPricingModal";
import { ColumnVisibilityControl } from "./ColumnVisibilityControl";
import { ReceiverOrderChargeModal } from "./ReceiverOrderChargeModal";
import { isNativeTabletRuntime } from "../../pages/qc/tabletNativeBridge";
import { useVisibleAutoRefresh } from "../../hooks/useVisibleAutoRefresh";

type BossPricingPanelProps = {
  session: DevSession;
};

type DateQuickFilter = "all" | "week" | "month" | "quarter" | "custom";
type PricingStatusFilter = "all" | "unpriced" | "priced";
type OrderStatusFilter = "all" | "pending_receive" | "received" | "terminated";
type PricingTabKey = "pending" | "statements";
type StatementPaymentStatusFilter = "all" | "pending" | "paid";
type StatementFilterValues = {
  q: string;
  customerId: string;
  customerBusinessUserId: string;
  paymentStatus: StatementPaymentStatusFilter;
  dateFrom: string;
  dateTo: string;
};

const defaultStatementFilters: StatementFilterValues = {
  q: "",
  customerId: "all",
  customerBusinessUserId: "all",
  paymentStatus: "all",
  dateFrom: "",
  dateTo: ""
};

const pendingOptionalColumns = [
  { label: "客户", value: "customer" },
  { label: "业务员", value: "salesperson" },
  { label: "样品类型", value: "sampleType" },
  { label: "轮次", value: "sampleRound" },
  { label: "数量", value: "quantity" },
  { label: "订单任务", value: "orderTasks" },
  { label: "当前工序", value: "currentStage" },
  { label: "订单状态", value: "orderStatus" },
  { label: "交期", value: "deliveryDate" },
  { label: "资料数量", value: "attachmentCount" },
  { label: "客户报价小计", value: "quotedPrice" },
  { label: "其他费用", value: "otherCharge" },
  { label: "应收合计", value: "receivableTotal" },
  { label: "定价状态", value: "pricingStatus" }
] as const;
type PendingOptionalColumnKey = (typeof pendingOptionalColumns)[number]["value"];
const defaultPendingColumns: PendingOptionalColumnKey[] = [
  "customer",
  "salesperson",
  "sampleType",
  "sampleRound",
  "quantity",
  "orderTasks",
  "currentStage",
  "orderStatus",
  "quotedPrice",
  "otherCharge",
  "receivableTotal",
  "pricingStatus"
];
const compactPendingColumns: PendingOptionalColumnKey[] = [
  "customer",
  "orderTasks",
  "receivableTotal",
  "pricingStatus"
];

const statementOptionalColumns = [
  { label: "客户", value: "customer" },
  { label: "业务员", value: "salesperson" },
  { label: "生成日期", value: "generatedAt" },
  { label: "订单数", value: "orderCount" },
  { label: "应收金额", value: "receivableAmount" },
  { label: "状态", value: "status" },
  { label: "对账单毛利", value: "grossMargin" }
] as const;
type StatementOptionalColumnKey = (typeof statementOptionalColumns)[number]["value"];
const defaultStatementColumns = statementOptionalColumns.map((option) => option.value);
const compactStatementColumns: StatementOptionalColumnKey[] = [
  "customer",
  "receivableAmount",
  "status",
  "grossMargin"
];

const statementExportColumnOptions: Array<{ label: string; value: ReconciliationStatementExportColumn }> = [
  { label: "接单日期", value: "orderCreatedDate" },
  { label: "交样日期", value: "deliveryDate" },
  { label: "缩略图", value: "thumbnail" },
  { label: "款号", value: "styleNo" },
  { label: "款名", value: "styleName" },
  { label: "样品类型", value: "sampleType" },
  { label: "轮次", value: "sampleRound" },
  { label: "数量", value: "quantity" },
  { label: "样衣单价", value: "quotedPrice" },
  { label: "样衣总价", value: "sampleAmount" },
  { label: "版费", value: "customerPatternFee" },
  { label: "其他费用", value: "otherChargeTotal" },
  { label: "其他费用明细说明", value: "otherChargeNote" },
  { label: "应收总计", value: "receivableTotal" }
];
const defaultStatementExportColumns = statementExportColumnOptions.map((option) => option.value);

function yuan(value: number | undefined) {
  return value === undefined ? "-" : `¥${value.toFixed(2)}`;
}

function orderHasPhysicalProduction(order: Pick<OrderRecord, "sampleRequestItems">) {
  return hasPhysicalProductionRoute(order.sampleRequestItems);
}

function visibleOrderReference(orderNo: string) {
  return /^V2-MOCK-/i.test(orderNo.trim()) ? undefined : orderNo;
}

function dateText(value?: string) {
  return value ? new Date(value).toLocaleDateString() : "-";
}

function getLocalDateKey() {
  return new Date().toLocaleDateString("sv-SE");
}

function dateValue(value?: string) {
  return value ? new Date(value).getTime() : 0;
}

function inDateRange(row: PricingRow, quick: DateQuickFilter, from?: string, to?: string) {
  return valueInDateRange(row.order.createdAt, quick, from, to);
}

function valueInDateRange(value: string | undefined, quick: DateQuickFilter, from?: string, to?: string) {
  if (quick === "all") {
    return true;
  }

  const basis = dateValue(value);
  if (!basis) {
    return false;
  }

  if (quick === "custom") {
    const fromTime = from ? new Date(from).getTime() : undefined;
    const toTime = to ? new Date(`${to}T23:59:59`).getTime() : undefined;
    return (fromTime === undefined || basis >= fromTime) && (toTime === undefined || basis <= toTime);
  }

  const now = new Date();
  const start = new Date(now);
  if (quick === "week") {
    start.setDate(now.getDate() - 7);
  } else if (quick === "month") {
    start.setMonth(now.getMonth() - 1);
  } else {
    start.setMonth(now.getMonth() - 3);
  }

  return basis >= start.getTime();
}

function activeStatementItems(statement: ReconciliationStatement) {
  return statement.items.filter((item) => !item.returnedAt);
}

function statementItemCustomerSubtotal(item: ReconciliationStatementItemSnapshot) {
  return Math.max(0, item.receivableTotal - item.otherChargeTotal);
}

function statementItemBaseInternalCost(item: ReconciliationStatementItemSnapshot) {
  return item.internalBaseCost
    ?? Math.max(0, (item.internalTotalCost ?? 0) - item.otherChargeTotal);
}

function statementItemGrossProfit(item: ReconciliationStatementItemSnapshot) {
  return statementItemCustomerSubtotal(item) - statementItemBaseInternalCost(item);
}

function grossMarginForItems(items: ReconciliationStatementItemSnapshot[]) {
  const customerSubtotal = items.reduce(
    (sum, item) => sum + statementItemCustomerSubtotal(item),
    0
  );
  if (customerSubtotal <= 0) return undefined;
  const grossProfit = items.reduce((sum, item) => sum + statementItemGrossProfit(item), 0);
  return grossProfit / customerSubtotal;
}

function percentage(value: number | undefined) {
  return value === undefined ? "不适用" : `${(value * 100).toFixed(1)}%`;
}

function isPriced(row: PricingRow) {
  return (row.summary.quotationStatus ?? row.pricing?.quotationStatus) === "confirmed"
    && !row.quotationHasUnconfirmedChanges;
}

function pricingActionLabel(row: PricingRow) {
  const quotationStatus = row.summary.quotationStatus ?? row.pricing?.quotationStatus;
  const hasConfirmedPricing =
    quotationStatus === "confirmed"
    || Boolean(row.confirmedQuotation)
    || Boolean(row.quotationHasUnconfirmedChanges);
  return hasConfirmedPricing ? "修改定价" : "定价";
}

function pricingStatusLabel(row: PricingRow) {
  if (row.quotationHasUnconfirmedChanges) {
    return <Tag color="warning">费用已变，待重确认</Tag>;
  }
  if (isPriced(row)) {
    return <Tag color="green">报价已确认</Tag>;
  }
  return (
    <Tag color="orange">
      {row.summary.customerQuoteSubtotal > 0 || row.summary.baseInternalCost > 0 ? "报价草稿" : "未定价"}
    </Tag>
  );
}

function uniqueOptions(rows: PricingRow[], selector: (row: PricingRow) => string | undefined) {
  return Array.from(new Set(rows.map(selector).filter((value): value is string => Boolean(value)))).map((value) => ({
    label: value,
    value
  }));
}

function statementListOptions(filters: StatementFilterValues): ReconciliationStatementListOptions {
  return {
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.customerId !== "all" ? { customerId: filters.customerId } : {}),
    ...(filters.customerBusinessUserId !== "all"
      ? { customerBusinessUserId: filters.customerBusinessUserId }
      : {}),
    ...(filters.paymentStatus !== "all" ? { paymentStatus: filters.paymentStatus } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {})
  };
}

function hasActiveStatementFilters(filters: StatementFilterValues) {
  return Object.keys(statementListOptions(filters)).length > 0;
}

function statementCustomerValue(statement: ReconciliationStatement) {
  return statement.customerId || statement.customerName || "未知客户";
}

function statementBusinessUserValue(statement: ReconciliationStatement) {
  return statement.clientUserId || statement.salespersonName || "未知业务员";
}

function statementMatchesCustomer(statement: ReconciliationStatement, value: string) {
  return value === "all" || statement.customerId === value || statement.customerName === value;
}

function statementMatchesBusinessUser(statement: ReconciliationStatement, value: string) {
  return value === "all" || statement.clientUserId === value || statement.salespersonName === value;
}

function fallbackStatementDownloadName(statements: ReconciliationStatement[]) {
  if (statements.length === 1) {
    return `${statements[0]!.statementNo}_客户对账单.xlsx`;
  }

  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `对账单批量下载_${getLocalDateKey()}_${time}.zip`;
}

function statementStatusTag(statement: ReconciliationStatement) {
  if (statement.status === "paid") {
    return <Tag color="green">已收款</Tag>;
  }

  if (statement.status === "returned") {
    return <Tag color="default">已退回</Tag>;
  }

  return <Tag color="orange">待付款</Tag>;
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_");
}

function isTableActionTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest("button, a, input, [role='button'], .ant-checkbox-wrapper"));
}

function pendingOrderCompletion(row: PricingRow) {
  const props = {
    sampleRequestItems: row.order.sampleRequestItems,
    stage: row.order.stage,
    ...(row.order.stageLabel ? { stageLabel: row.order.stageLabel } : {}),
    ...(row.order.completionStatus ? { completionStatus: row.order.completionStatus } : {}),
    ...(row.order.patternTask ? { patternTask: row.order.patternTask } : {})
  };

  return { props, label: orderCompletionLabel(props) };
}

const pendingOrderStatusMeta = {
  pending_receive: { value: "pending_receive", label: "待接单", color: "orange" },
  received: { value: "received", label: "已接单", color: "green" },
  terminated: { value: "terminated", label: "已终止", color: "red" }
} as const;

function pendingOrderStatus(row: PricingRow) {
  if (row.order.terminated) return pendingOrderStatusMeta.terminated;
  if (row.order.intakeStatus === "received") return pendingOrderStatusMeta.received;
  return pendingOrderStatusMeta.pending_receive;
}

const orderStatusOptions: Array<{ label: string; value: OrderStatusFilter }> = [
  { label: "全部订单状态", value: "all" },
  pendingOrderStatusMeta.pending_receive,
  pendingOrderStatusMeta.received,
  pendingOrderStatusMeta.terminated
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFilename(filename);
  link.click();
  URL.revokeObjectURL(url);
}

export function BossPricingPanel({ session }: BossPricingPanelProps) {
  const tabletColumns = isNativeTabletRuntime();
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [statements, setStatements] = useState<ReconciliationStatement[]>([]);
  const [allStatements, setAllStatements] = useState<ReconciliationStatement[]>([]);
  const [loading, setLoading] = useState(false);
  const [statementCreating, setStatementCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<PricingTabKey>("pending");
  const [editingRow, setEditingRow] = useState<PricingRow | null>(null);
  const [chargeOrder, setChargeOrder] = useState<OrderRecord | null>(null);
  const [chargeModalCharges, setChargeModalCharges] = useState<OrderChargeRecord[]>([]);
  const chargeRequestIdRef = useRef(0);
  const [selectedOrderKeys, setSelectedOrderKeys] = useState<Key[]>([]);
  const [selectedStatementKeys, setSelectedStatementKeys] = useState<Key[]>([]);
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingPageSize, setPendingPageSize] = useState(() => {
    const stored = Number(window.localStorage.getItem("sample-room:boss-pricing-pending:page-size"));
    return Number.isInteger(stored) && stored > 0 ? stored : 10;
  });
  const [statementPage, setStatementPage] = useState(1);
  const [statementPageSize, setStatementPageSize] = useState(() => {
    const stored = Number(window.localStorage.getItem("sample-room:boss-pricing-statements:page-size"));
    return Number.isInteger(stored) && stored > 0 ? stored : 10;
  });
  const [pricingStatusFilter, setPricingStatusFilter] = useState<PricingStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [customerFilter, setCustomerFilter] = useState<string>("all");
  const [salespersonFilter, setSalespersonFilter] = useState<string>("all");
  const [currentStageFilter, setCurrentStageFilter] = useState<string>("all");
  const [orderStatusFilter, setOrderStatusFilter] = useState<OrderStatusFilter>("all");
  const [dateQuick, setDateQuick] = useState<DateQuickFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statementFilters, setStatementFilters] = useState<StatementFilterValues>(defaultStatementFilters);
  const [statementDraftFilters, setStatementDraftFilters] =
    useState<StatementFilterValues>(defaultStatementFilters);
  const [visiblePendingColumnKeys, setVisiblePendingColumnKeys] =
    usePersistedColumnKeys<PendingOptionalColumnKey>(
      `sample-room:boss-pricing-pending-columns:v4${tabletColumns ? ":tablet" : ""}`,
      pendingOptionalColumns.map((option) => option.value),
      tabletColumns ? compactPendingColumns : defaultPendingColumns
    );
  const [visibleStatementColumnKeys, setVisibleStatementColumnKeys] =
    usePersistedColumnKeys<StatementOptionalColumnKey>(
      `sample-room:boss-pricing-statement-columns:v2${tabletColumns ? ":tablet" : ""}`,
      statementOptionalColumns.map((option) => option.value),
      tabletColumns ? compactStatementColumns : defaultStatementColumns
    );
  const [downloadTargets, setDownloadTargets] = useState<ReconciliationStatement[]>([]);
  const [downloadColumnKeys, setDownloadColumnKeys] =
    useState<ReconciliationStatementExportColumn[]>(defaultStatementExportColumns);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const loadData = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const statementOptions = statementListOptions(statementFilters);
      const shouldLoadAllStatements = hasActiveStatementFilters(statementFilters);
      const [pricingResponse, statementResponse, allStatementResponse] = await Promise.all([
        sampleRoomApi.listAdminPricingRows(session),
        sampleRoomApi.listAdminReconciliationStatements(session, statementOptions),
        shouldLoadAllStatements
          ? sampleRoomApi.listAdminReconciliationStatements(session)
          : Promise.resolve(undefined)
      ]);
      setRows(pricingResponse.rows);
      setStatements(statementResponse.statements);
      setAllStatements(allStatementResponse?.statements ?? statementResponse.statements);
      setSelectedOrderKeys((current) =>
        current.filter((key) => pricingResponse.rows.some((row) => row.order.id === key))
      );
      setSelectedStatementKeys((current) =>
        current.filter((key) => statementResponse.statements.some((statement) => statement.id === key))
      );
    } catch (error) {
      if (!silent) messageApi.error(error instanceof Error ? error.message : "定价对账数据加载失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [messageApi, session, statementFilters]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useVisibleAutoRefresh(() => loadData({ silent: true }));

  const customerOptions = useMemo(
    () => [{ label: "全部客户", value: "all" }, ...uniqueOptions(rows, (row) => row.order.customerName)],
    [rows]
  );
  const salespersonOptions = useMemo(
    () => [{ label: "全部业务员", value: "all" }, ...uniqueOptions(rows, (row) => row.order.salespersonName)],
    [rows]
  );
  const currentStageOptions = useMemo(() => {
    const labels = Array.from(new Set(rows.map((row) => pendingOrderCompletion(row).label)));
    return [
      { label: "全部当前工序", value: "all" },
      ...labels.map((label) => ({ label, value: label }))
    ];
  }, [rows]);

  const statementCustomerOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const statement of allStatements) {
      options.set(statementCustomerValue(statement), statement.customerName || "未知客户");
    }

    return [
      { label: "全部客户", value: "all" },
      ...Array.from(options, ([value, label]) => ({ label, value }))
    ];
  }, [allStatements]);
  const statementBusinessUserOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const statement of allStatements) {
      if (!statementMatchesCustomer(statement, statementDraftFilters.customerId)) {
        continue;
      }

      options.set(statementBusinessUserValue(statement), statement.salespersonName || "未知业务员");
    }

    return [
      { label: "全部业务员", value: "all" },
      ...Array.from(options, ([value, label]) => ({ label, value }))
    ];
  }, [allStatements, statementDraftFilters.customerId]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      const searchable = [
        row.order.orderNo,
        row.order.styleNo,
        row.order.styleName,
        row.order.customerName,
        row.order.salespersonName
      ]
        .join(" ")
        .toLowerCase();
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesCustomer = customerFilter === "all" || row.order.customerName === customerFilter;
      const matchesSalesperson = salespersonFilter === "all" || row.order.salespersonName === salespersonFilter;
      const matchesCurrentStage = currentStageFilter === "all"
        || pendingOrderCompletion(row).label === currentStageFilter;
      const matchesOrderStatus = orderStatusFilter === "all"
        || pendingOrderStatus(row).value === orderStatusFilter;
      const matchesDate = inDateRange(row, dateQuick, dateFrom, dateTo);
      const matchesPricingStatus =
        pricingStatusFilter === "all" ||
        (pricingStatusFilter === "priced" && isPriced(row)) ||
        (pricingStatusFilter === "unpriced" && !isPriced(row));
      return matchesQuery && matchesCustomer && matchesSalesperson && matchesCurrentStage && matchesOrderStatus && matchesDate && matchesPricingStatus;
    });
  }, [
    customerFilter,
    currentStageFilter,
    orderStatusFilter,
    dateFrom,
    dateQuick,
    dateTo,
    pricingStatusFilter,
    query,
    rows,
    salespersonFilter
  ]);

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(filteredRows.length / pendingPageSize));
    if (pendingPage > lastPage) setPendingPage(lastPage);
  }, [filteredRows.length, pendingPage, pendingPageSize]);

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(statements.length / statementPageSize));
    if (statementPage > lastPage) setStatementPage(lastPage);
  }, [statementPage, statementPageSize, statements.length]);

  const overviewStats = useMemo(() => {
    if (activeTab === "pending") {
      const generatedItemCount = allStatements
        .filter((statement) => statement.status !== "returned")
        .flatMap(activeStatementItems)
        .filter((item) =>
          valueInDateRange(item.orderCreatedAt ?? item.generatedAt, dateQuick, dateFrom, dateTo)
        ).length;
      return [
        { label: "未定价", value: filteredRows.filter((row) => !isPriced(row)).length, tone: "orange" },
        { label: "已定价", value: filteredRows.filter(isPriced).length, tone: "green" },
        { label: "已生成对账单款数", value: generatedItemCount, tone: "blue" }
      ];
    }

    const activeStatements = allStatements.filter((statement) => statement.status !== "returned");
    const paidStatements = activeStatements.filter((statement) => statement.status === "paid");
    const grossMargin = grossMarginForItems(activeStatements.flatMap(activeStatementItems));
    return [
      {
        label: "待付款单数",
        value: activeStatements.filter((statement) => statement.status === "pending_payment").length,
        tone: "orange"
      },
      { label: "已收款单数", value: paidStatements.length, tone: "green" },
      {
        label: "应收款",
        value: yuan(activeStatements.reduce((sum, statement) => sum + statement.receivableAmount, 0)),
        tone: "blue"
      },
      {
        label: "已收款",
        value: yuan(paidStatements.reduce((sum, statement) => sum + statement.paidAmount, 0)),
        tone: "green"
      },
      {
        label: "毛利率",
        value: percentage(grossMargin),
        tone: "blue"
      }
    ];
  }, [activeTab, allStatements, dateFrom, dateQuick, dateTo, filteredRows]);

  const resetFilters = () => {
    setQuery("");
    setCustomerFilter("all");
    setSalespersonFilter("all");
    setCurrentStageFilter("all");
    setOrderStatusFilter("all");
    setDateQuick("all");
    setDateFrom("");
    setDateTo("");
    setPricingStatusFilter("all");
  };

  const applyStatementFilters = (overrides: Partial<StatementFilterValues> = {}) => {
    const nextFilters = { ...statementDraftFilters, ...overrides };
    setStatementDraftFilters(nextFilters);
    setStatementFilters(nextFilters);
  };

  const resetStatementFilters = () => {
    setStatementDraftFilters(defaultStatementFilters);
    setStatementFilters(defaultStatementFilters);
  };

  const updateStatementCustomerFilter = (customerId: string) => {
    setStatementDraftFilters((current) => {
      const businessUserStillValid =
        current.customerBusinessUserId === "all" ||
        allStatements.some(
          (statement) =>
            statementMatchesCustomer(statement, customerId) &&
            statementMatchesBusinessUser(statement, current.customerBusinessUserId)
        );

      return {
        ...current,
        customerId,
        customerBusinessUserId: businessUserStillValid ? current.customerBusinessUserId : "all"
      };
    });
  };

  const openEdit = (row: PricingRow) => setEditingRow(row);

  const openChargeDialog = async (order: OrderRecord) => {
    const requestId = ++chargeRequestIdRef.current;
    setChargeOrder(order);
    setChargeModalCharges([]);
    try {
      const result = await sampleRoomApi.listOrderCharges(session, "admin", order.id);
      if (requestId === chargeRequestIdRef.current) setChargeModalCharges(result.charges);
    } catch (error) {
      if (requestId === chargeRequestIdRef.current) {
        messageApi.error(error instanceof Error ? error.message : "费用记录加载失败");
      }
    }
  };

  const loadOrderAttachmentPreview = (order: OrderRecord, attachment: OrderAttachment) =>
    sampleRoomApi.downloadAdminOrderAttachment(session, order.id, attachment.id);

  const orderThumbnail = (order: OrderRecord) => (
    <OrderAttachmentThumbnail order={order} loadPreview={loadOrderAttachmentPreview} />
  );

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedOrderKeys.includes(row.order.id)),
    [rows, selectedOrderKeys]
  );

  const selectedStatements = useMemo(
    () => statements.filter((statement) => selectedStatementKeys.includes(statement.id)),
    [selectedStatementKeys, statements]
  );

  const validateStatementRows = (targetRows: PricingRow[]) => {
    if (targetRows.length === 0) {
      messageApi.warning("请先选择要生成对账单的订单");
      return false;
    }

    if (targetRows.some((row) => !isPriced(row))) {
      messageApi.warning("存在未定价订单，请先完成定价后再生成对账单");
      return false;
    }

    const first = targetRows[0]!.order;
    const sameCustomerAndSalesperson = targetRows.every(
      (row) => row.order.customerName === first.customerName && row.order.salespersonName === first.salespersonName
    );
    if (!sameCustomerAndSalesperson) {
      messageApi.warning("请选择同一客户和业务员的订单生成对账单");
      return false;
    }

    return true;
  };

  const createStatement = async (targetRows: PricingRow[]) => {
    if (statementCreating || !validateStatementRows(targetRows)) {
      return;
    }

    setStatementCreating(true);
    try {
      await sampleRoomApi.createAdminReconciliationStatement(
        session,
        targetRows.map((row) => row.order.id)
      );
      messageApi.success("已生成对账单");
      setActiveTab("statements");
      await loadData();
    } catch (error) {
      const content = error instanceof Error ? error.message : "生成对账单失败";
      await loadData({ silent: true });
      Modal.warning({
        title: "对账单未生成",
        content,
        okText: "知道了"
      });
    } finally {
      setStatementCreating(false);
    }
  };

  const downloadStatements = async (
    targetStatements: ReconciliationStatement[],
    columns: ReconciliationStatementExportColumn[]
  ) => {
    if (targetStatements.length === 0) {
      messageApi.warning("请先选择要下载的对账单");
      return;
    }

    if (columns.length === 0) {
      messageApi.warning("请至少选择一个对账单明细字段");
      return;
    }

    setDownloadLoading(true);
    try {
      const { blob, filename } = await sampleRoomApi.downloadAdminReconciliationStatements(
        session,
        targetStatements.map((statement) => statement.id),
        columns
      );
      downloadBlob(blob, filename ?? fallbackStatementDownloadName(targetStatements));
      messageApi.success(targetStatements.length === 1 ? "已开始下载对账单" : "已开始批量下载对账单");
      setDownloadTargets([]);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "下载对账单失败");
    } finally {
      setDownloadLoading(false);
    }
  };

  const openStatementDownload = (targetStatements: ReconciliationStatement[]) => {
    if (targetStatements.length === 0) {
      messageApi.warning("请先选择要下载的对账单");
      return;
    }
    setDownloadTargets(targetStatements);
  };

  const confirmReturnStatements = (targetStatements: ReconciliationStatement[]) => {
    if (targetStatements.length === 0) {
      messageApi.warning("请先选择待付款对账单");
      return;
    }

    const blocked = targetStatements.find((statement) => statement.status !== "pending_payment");
    if (blocked) {
      messageApi.warning("只有待付款对账单可以退回到待对账");
      return;
    }

    Modal.confirm({
      title: "退回整张对账单？",
      content: `将退回 ${targetStatements.length} 张对账单，明细订单会重新回到“待对账”。已退回记录会保留，但不计入应收款。`,
      okText: "确认退回",
      cancelText: "取消",
      onOk: async () => {
        try {
          await Promise.all(
            targetStatements.map((statement) =>
              sampleRoomApi.returnAdminReconciliationStatement(session, statement.id)
            )
          );
          messageApi.success("已退回到待对账");
          await loadData();
        } catch (error) {
          messageApi.error(error instanceof Error ? error.message : "退回对账单失败");
        }
      }
    });
  };

  const openStatementItemPricing = async (item: ReconciliationStatementItemSnapshot) => {
    const detail = await sampleRoomApi.getAdminOrderPricing(session, item.orderId);
    await openEdit({
      order: detail.order,
      summary: detail.summary,
      ...(detail.pricing ? { pricing: detail.pricing } : {}),
      ...(detail.stageWork ? { stageWork: detail.stageWork } : {}),
      ...(detail.confirmedQuotation !== undefined
        ? { confirmedQuotation: detail.confirmedQuotation }
        : {}),
      ...(detail.quotationHasUnconfirmedChanges !== undefined
        ? { quotationHasUnconfirmedChanges: detail.quotationHasUnconfirmedChanges }
        : {})
    });
  };

  const confirmReturnStatementItem = (
    statement: ReconciliationStatement,
    item: ReconciliationStatementItemSnapshot
  ) => {
    if (statement.status !== "pending_payment") {
      messageApi.warning("已收款对账单中的订单不能退回");
      return;
    }

    Modal.confirm({
      title: "退回这个订单？",
      content: (
        <Space direction="vertical" size={6}>
          <Typography.Text>
            款号：<Typography.Text strong>{item.styleNo}</Typography.Text>
          </Typography.Text>
          <Typography.Text>
            本单应收：<Typography.Text strong>{yuan(item.receivableTotal)}</Typography.Text>
          </Typography.Text>
          <Typography.Text>
            确认后，该订单回到“待对账”；本对账单保留，其余订单和历史记录不受影响。
          </Typography.Text>
          <Typography.Text type="secondary">已收款的对账单不能退回订单。</Typography.Text>
        </Space>
      ),
      okText: "确认退回",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await sampleRoomApi.returnAdminReconciliationStatementItem(session, statement.id, item.id);
          messageApi.success("订单已退回到待对账");
          await loadData();
        } catch (error) {
          messageApi.error(error instanceof Error ? error.message : "订单退回失败");
        }
      }
    });
  };

  const markStatementPaid = async (statement: ReconciliationStatement) => {
    if (statement.status !== "pending_payment") {
      return;
    }

    try {
      await sampleRoomApi.markAdminReconciliationStatementPaid(session, statement.id);
      messageApi.success("已标记为已收款");
      await loadData();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "标记收款失败");
    }
  };

  const confirmUndoStatementPaid = (statement: ReconciliationStatement) => {
    if (statement.status !== "paid") return;
    Modal.confirm({
      title: "撤回已收款状态？",
      content: "撤回后对账单恢复为待付款，已收金额和收款时间会清除；对账单金额快照不会改变。",
      okText: "确认撤回",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await sampleRoomApi.undoAdminReconciliationStatementPaid(session, statement.id);
          messageApi.success("已撤回收款，对账单恢复为待付款");
          await loadData();
        } catch (error) {
          messageApi.error(error instanceof Error ? error.message : "撤回已收款失败");
        }
      }
    });
  };

  const pendingColumnDefinitions: TableProps<PricingRow>["columns"] = [
    {
      title: "款号 / 款式",
      key: "order",
      width: 300,
      render: (_, row) => (
        <div className="boss-pricing-order-cell">
          {orderThumbnail(row.order)}
          <Space direction="vertical" size={2} className="boss-pricing-order-copy">
            <Typography.Text strong>{row.order.styleNo}</Typography.Text>
            <Typography.Text type="secondary">{row.order.styleName}</Typography.Text>
            {visibleOrderReference(row.order.orderNo) ? (
              <Typography.Text type="secondary">
                {visibleOrderReference(row.order.orderNo)}
              </Typography.Text>
            ) : null}
          </Space>
        </div>
      )
    },
    { title: "客户", key: "customer", dataIndex: ["order", "customerName"], width: 150 },
    { title: "业务员", key: "salesperson", dataIndex: ["order", "salespersonName"], width: 150 },
    {
      title: "样品类型",
      key: "sampleType",
      width: 100,
      render: (_, row) => <SampleTypeTag value={row.order.sampleType} />
    },
    {
      title: "轮次",
      key: "sampleRound",
      width: 104,
      render: (_, row) => <SampleRoundTag value={row.order.sampleRound} />
    },
    {
      title: "数量",
      key: "quantity",
      width: 70,
      render: (_, row) => orderHasPhysicalProduction(row.order) ? row.order.quantity : "N/A"
    },
    {
      title: "订单任务",
      key: "orderTasks",
      width: 260,
      render: (_, row) => (
        <OrderTaskStatusBadges
          sampleRequestItems={row.order.sampleRequestItems}
          stage={row.order.stage}
          patternTask={row.patternTask}
          maxRows={2}
        />
      )
    },
    {
      title: "当前工序",
      key: "currentStage",
      width: 170,
      render: (_, row) => (
        <OrderCompletionTag {...pendingOrderCompletion(row).props} />
      )
    },
    {
      title: "订单状态",
      key: "orderStatus",
      width: 100,
      render: (_, row) => {
        const status = pendingOrderStatus(row);
        return <Tag color={status.color}>{status.label}</Tag>;
      }
    },
    {
      title: "交期",
      key: "deliveryDate",
      width: 110,
      render: (_, row) => dateText(row.order.deliveryDate)
    },
    {
      title: "资料数量",
      key: "attachmentCount",
      width: 90,
      render: (_, row) => `${row.order.attachmentCount} 个`
    },
    {
      title: "客户报价小计",
      key: "quotedPrice",
      width: 120,
      render: (_, row) => yuan(row.summary.customerQuoteSubtotal)
    },
    {
      title: "其他费用",
      key: "otherCharge",
      width: 100,
      render: (_, row) => yuan(row.summary.otherChargeTotal)
    },
    {
      title: "应收合计",
      key: "receivableTotal",
      width: 110,
      render: (_, row) => <Typography.Text strong>{yuan(row.summary.receivableTotal)}</Typography.Text>
    },
    {
      title: "定价状态",
      key: "pricingStatus",
      width: 100,
      render: (_, row) => pricingStatusLabel(row)
    },
    {
      title: "",
      key: "spacer",
      className: "pricing-table-flex-spacer",
      render: () => null
    },
    {
      title: "操作",
      key: "actions",
      width: 90,
      align: "center",
      fixed: "right",
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          <Button type="primary" size="small" className="pricing-row-edit-button" onClick={() => openEdit(row)}>
            {pricingActionLabel(row)}
          </Button>
          <Button size="small" className="boss-order-row-action" onClick={() => void openChargeDialog(row.order)}>
            追加费用
          </Button>
        </Space>
      )
    }
  ];
  const pendingColumns = pendingColumnDefinitions.filter((column) => {
    const key = String(column.key ?? "");
    return (
      key === "order" ||
      key === "spacer" ||
      key === "actions" ||
      visiblePendingColumnKeys.includes(key as PendingOptionalColumnKey)
    );
  });

  const statementColumns: TableProps<ReconciliationStatement>["columns"] = [
    {
      title: "对账单号",
      key: "statementNo",
      dataIndex: "statementNo",
      width: 150,
      render: (value) => <Typography.Text strong>{value}</Typography.Text>
    },
    { title: "客户", key: "customer", dataIndex: "customerName", width: 150 },
    { title: "业务员", key: "salesperson", dataIndex: "salespersonName", width: 150 },
    {
      title: "生成日期",
      key: "generatedAt",
      dataIndex: "generatedAt",
      width: 120,
      render: (value) => dateText(value)
    },
    { title: "订单数", key: "orderCount", dataIndex: "orderCount", width: 80 },
    {
      title: "应收金额",
      key: "receivableAmount",
      dataIndex: "receivableAmount",
      width: 110,
      render: (value) => <Typography.Text strong>{yuan(value)}</Typography.Text>
    },
    {
      title: "状态",
      key: "status",
      width: 100,
      render: (_, statement) => statementStatusTag(statement)
    },
    {
      title: "对账单毛利",
      key: "grossMargin",
      width: 120,
      render: (_, statement) => percentage(grossMarginForItems(activeStatementItems(statement)))
    },
    {
      title: "",
      key: "spacer",
      className: "pricing-table-flex-spacer",
      render: () => null
    },
    {
      title: "操作",
      key: "actions",
      width: 300,
      align: "center",
      fixed: "right",
      render: (_, statement) => (
        <Space size={6}>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => openStatementDownload([statement])}>
            下载对账单
          </Button>
          <Button
            type={statement.status === "paid" ? "default" : "primary"}
            danger={statement.status === "paid"}
            size="small"
            disabled={statement.status === "returned"}
            onClick={() =>
              statement.status === "paid"
                ? confirmUndoStatementPaid(statement)
                : void markStatementPaid(statement)
            }
          >
            {statement.status === "paid" ? "撤回已收款" : "标记已收款"}
          </Button>
          <Button
            size="small"
            danger
            disabled={statement.status !== "pending_payment"}
            onClick={() => confirmReturnStatements([statement])}
          >
            退回整单
          </Button>
        </Space>
      )
    }
  ];
  const visibleStatementColumns = statementColumns.filter((column) => {
    const key = String(column.key ?? "");
    return (
      key === "statementNo" ||
      key === "spacer" ||
      key === "actions" ||
      visibleStatementColumnKeys.includes(key as StatementOptionalColumnKey)
    );
  });

  const statementItemColumns: TableProps<ReconciliationStatementItemSnapshot>["columns"] = [
    {
      title: "款号 / 款名",
      width: 300,
      render: (_, item) => (
        <button
          type="button"
          className="boss-pricing-order-cell boss-pricing-order-link"
          onClick={() => void openStatementItemPricing(item)}
          aria-label={`修改定价：${item.styleNo}`}
        >
          <OrderAttachmentThumbnail
            order={{ id: item.orderId, attachments: item.attachments ?? [] }}
            loadPreview={(order, attachment) =>
              sampleRoomApi.downloadAdminOrderAttachment(session, order.id, attachment.id)
            }
          />
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{item.styleNo}</Typography.Text>
            <Typography.Text type="secondary">{item.styleName}</Typography.Text>
          </Space>
        </button>
      )
    },
    {
      title: "样衣单价",
      width: 110,
      render: (_, item) => yuan(item.quotedPrice)
    },
    {
      title: "数量",
      width: 80,
      render: (_, item) => item.sampleRequestItems && !hasPhysicalProductionRoute(item.sampleRequestItems)
        ? "N/A"
        : item.quantity
    },
    {
      title: "样衣总价",
      width: 110,
      render: (_, item) => yuan(item.sampleAmount)
    },
    {
      title: "版费",
      width: 100,
      render: (_, item) => yuan(item.patternFeeTotal ?? 0)
    },
    {
      title: "其他费用",
      width: 110,
      render: (_, item) => yuan(item.otherChargeTotal)
    },
    {
      title: "订单毛利",
      width: 110,
      render: (_, item) => yuan(statementItemGrossProfit(item))
    },
    {
      title: "应收合计",
      dataIndex: "receivableTotal",
      width: 120,
      render: (value) => <Typography.Text strong>{yuan(value)}</Typography.Text>
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      fixed: "right",
      render: (_, item) => {
        const statement = allStatements.find((candidate) => candidate.id === item.statementId);
        if (!statement) return null;
        return (
          <Space size={6}>
            <Button
              size="small"
              onClick={() => void openStatementItemPricing(item)}
            >
              修改定价
            </Button>
            <Button
              danger
              size="small"
              disabled={statement.status !== "pending_payment" || Boolean(item.returnedAt)}
              onClick={() => confirmReturnStatementItem(statement, item)}
            >
              退回此订单
            </Button>
          </Space>
        );
      }
    }
  ];

  const pendingToolbar = (
    <Space direction="vertical" size={12} className="full-width">
      <div className="pricing-filter-bar">
        <Input.Search
          allowClear
          className="pricing-filter-search"
          placeholder="搜索订单号 / 款号 / 款名 / 客户 / 业务员"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onSearch={setQuery}
        />
        <Select className="pricing-filter-select" value={customerFilter} options={customerOptions} onChange={setCustomerFilter} />
        <Select
          className="pricing-filter-select"
          value={salespersonFilter}
          options={salespersonOptions}
          onChange={setSalespersonFilter}
        />
        <Select
          className="pricing-filter-select"
          value={currentStageFilter}
          options={currentStageOptions}
          onChange={setCurrentStageFilter}
        />
        <Select<OrderStatusFilter>
          className="pricing-filter-select"
          value={orderStatusFilter}
          options={orderStatusOptions}
          onChange={setOrderStatusFilter}
        />
        <Select<DateQuickFilter>
          className="pricing-filter-select"
          value={dateQuick}
          onChange={setDateQuick}
          options={[
            { label: "全部时间", value: "all" },
            { label: "本周", value: "week" },
            { label: "本月", value: "month" },
            { label: "近三月", value: "quarter" },
            { label: "自定义", value: "custom" }
          ]}
        />
        {dateQuick === "custom" ? (
          <>
            <Input className="pricing-filter-date" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            <Input className="pricing-filter-date" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </>
        ) : null}
        <Button onClick={resetFilters}>重置筛选</Button>
        <ColumnVisibilityControl
          value={visiblePendingColumnKeys}
          options={[...pendingOptionalColumns]}
          standardKeys={defaultPendingColumns}
          compactKeys={compactPendingColumns}
          onChange={setVisiblePendingColumnKeys}
          className="pricing-filter-select"
          ariaLabel="选择待对账显示列"
        />
      </div>
      <div className="pricing-statement-toolbar">
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          value={pricingStatusFilter}
          onChange={(event) => setPricingStatusFilter(event.target.value)}
          options={[
            { label: "全部", value: "all" },
            { label: "未定价", value: "unpriced" },
            { label: "已定价", value: "priced" }
          ]}
        />
        <Space wrap>
          <Typography.Text type="secondary">
            已选 {selectedRows.length} 单，当前显示 {filteredRows.length} 单
          </Typography.Text>
          <Button
            type="primary"
            loading={statementCreating}
            disabled={selectedRows.length === 0 || statementCreating}
            onClick={() => void createStatement(selectedRows)}
          >
            生成对账单
          </Button>
        </Space>
      </div>
    </Space>
  );

  const pendingTab = (
    <Space direction="vertical" size={12} className="full-width">
      <Alert
        type="info"
        showIcon
        message="待对账只显示尚未进入有效对账单的订单。只有已定价订单可以生成对账单。"
      />
      {pendingToolbar}
      <Table
        rowKey={(row) => row.order.id}
        size="small"
        className="boss-pricing-pending-table data-workspace-table"
        columns={pendingColumns}
        dataSource={filteredRows}
        loading={loading}
        pagination={{
          current: pendingPage,
          pageSize: pendingPageSize,
          showSizeChanger: NON_SEARCHABLE_PAGE_SIZE_CHANGER,
          pageSizeOptions: [10, 20, 50],
          onChange: (nextPage, nextPageSize) => {
            if (nextPageSize !== pendingPageSize) {
              setPendingPageSize(nextPageSize);
              setPendingPage(1);
              window.localStorage.setItem("sample-room:boss-pricing-pending:page-size", String(nextPageSize));
              return;
            }
            setPendingPage(nextPage);
          }
        }}
        rowSelection={{
          selectedRowKeys: selectedOrderKeys,
          onChange: setSelectedOrderKeys,
          getCheckboxProps: (row) => ({
            disabled: !isPriced(row),
            ...(!isPriced(row) ? { title: "未定价订单需要先完成定价" } : {})
          })
        }}
        onRow={(row) => ({
          className: isPriced(row) ? "pricing-selectable-row" : "",
          onClick: (event) => {
            if (!isPriced(row) || isTableActionTarget(event.target)) return;
            setSelectedOrderKeys((current) =>
              current.includes(row.order.id)
                ? current.filter((key) => key !== row.order.id)
                : [...current, row.order.id]
            );
          }
        })}
        tableLayout="fixed"
        scroll={{ x: "max-content", y: "100%", scrollToFirstRowOnChange: true }}
      />
    </Space>
  );

  const canReturnSelectedStatements =
    selectedStatements.length > 0 && selectedStatements.every((statement) => statement.status === "pending_payment");

  const statementsTab = (
    <Space direction="vertical" size={12} className="full-width">
      <div className="pricing-filter-bar">
        <Input.Search
          allowClear
          className="pricing-filter-search"
          placeholder="搜索订单号 / 款号 / SR编号 / 客户款名"
          value={statementDraftFilters.q}
          onChange={(event) =>
            setStatementDraftFilters((current) => ({ ...current, q: event.target.value }))
          }
          onSearch={(value) => applyStatementFilters({ q: value })}
        />
        <Select
          className="pricing-filter-select"
          value={statementDraftFilters.customerId}
          options={statementCustomerOptions}
          onChange={updateStatementCustomerFilter}
        />
        <Select
          className="pricing-filter-select"
          value={statementDraftFilters.customerBusinessUserId}
          options={statementBusinessUserOptions}
          onChange={(value) =>
            setStatementDraftFilters((current) => ({ ...current, customerBusinessUserId: value }))
          }
        />
        <Select<StatementPaymentStatusFilter>
          className="pricing-filter-select"
          value={statementDraftFilters.paymentStatus}
          onChange={(value) => setStatementDraftFilters((current) => ({ ...current, paymentStatus: value }))}
          options={[
            { label: "全部收款状态", value: "all" },
            { label: "待付款", value: "pending" },
            { label: "已收款", value: "paid" }
          ]}
        />
        <Typography.Text type="secondary">对账单生成日期</Typography.Text>
        <Input
          className="pricing-filter-date"
          type="date"
          value={statementDraftFilters.dateFrom}
          onChange={(event) =>
            setStatementDraftFilters((current) => ({ ...current, dateFrom: event.target.value }))
          }
        />
        <Input
          className="pricing-filter-date"
          type="date"
          value={statementDraftFilters.dateTo}
          onChange={(event) =>
            setStatementDraftFilters((current) => ({ ...current, dateTo: event.target.value }))
          }
        />
        <Button type="primary" onClick={() => applyStatementFilters()}>
          查询 / 应用筛选
        </Button>
        <Button onClick={resetStatementFilters}>重置</Button>
        <Button onClick={() => void loadData()}>刷新</Button>
        <ColumnVisibilityControl
          value={visibleStatementColumnKeys}
          options={[...statementOptionalColumns]}
          standardKeys={defaultStatementColumns}
          compactKeys={compactStatementColumns}
          onChange={setVisibleStatementColumnKeys}
          className="pricing-filter-select"
          ariaLabel="选择对账单显示列"
        />
      </div>
      <div className="pricing-statement-toolbar">
        <Typography.Text type="secondary">
          待付款对账单可整单退回，也可在展开明细中单独退回订单；无需填写原因。
        </Typography.Text>
        <Space wrap>
          <Button onClick={() => void loadData()}>刷新</Button>
          <Button
            icon={<DownloadOutlined />}
            disabled={selectedStatements.length === 0}
            onClick={() => openStatementDownload(selectedStatements)}
          >
            批量下载
          </Button>
          <Button
            danger
            icon={<RollbackOutlined />}
            disabled={!canReturnSelectedStatements}
            onClick={() => confirmReturnStatements(selectedStatements)}
          >
            批量退回到待对账
          </Button>
        </Space>
      </div>
      <Table
        rowKey="id"
        size="small"
        className="boss-pricing-statements-table data-workspace-table"
        columns={visibleStatementColumns}
        dataSource={statements}
        loading={loading}
        pagination={{
          current: statementPage,
          pageSize: statementPageSize,
          showSizeChanger: NON_SEARCHABLE_PAGE_SIZE_CHANGER,
          pageSizeOptions: [10, 20, 50],
          onChange: (nextPage, nextPageSize) => {
            if (nextPageSize !== statementPageSize) {
              setStatementPageSize(nextPageSize);
              setStatementPage(1);
              window.localStorage.setItem("sample-room:boss-pricing-statements:page-size", String(nextPageSize));
              return;
            }
            setStatementPage(nextPage);
          }
        }}
        tableLayout="fixed"
        scroll={{ x: "max-content", y: "100%", scrollToFirstRowOnChange: true }}
        rowSelection={{
          selectedRowKeys: selectedStatementKeys,
          onChange: setSelectedStatementKeys,
          getCheckboxProps: (statement) => ({
            ...(statement.status === "paid" ? { title: "已收款对账单不能退回" } : {})
          })
        }}
        onRow={(statement) => ({
          className: "pricing-selectable-row",
          onClick: (event) => {
            if (isTableActionTarget(event.target)) return;
            setSelectedStatementKeys((current) =>
              current.includes(statement.id)
                ? current.filter((key) => key !== statement.id)
                : [...current, statement.id]
            );
          }
        })}
        expandable={{
          expandedRowRender: (statement) => (
            <Table
              rowKey="id"
              size="small"
              columns={statementItemColumns}
              dataSource={statement.items}
              pagination={false}
              scroll={{ x: "max-content" }}
            />
          )
        }}
      />
    </Space>
  );

  const renderOverview = () => (
    <BossStatsStrip
      scope="老板视角 / 定价对账"
      title="定价对账总览"
      helper="待对账、对账单、收款与退回集中处理。"
      ariaLabel="老板定价对账总览"
      items={overviewStats}
    />
  );

  return (
    <Space direction="vertical" size={16} className="full-width boss-pricing-panel">
      {contextHolder}
      {renderOverview()}
      <Card
        className="section-card"
        title={tabletColumns ? undefined : "定价对账"}
        extra={tabletColumns ? undefined : <Button onClick={() => void loadData()}>刷新</Button>}
      >
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as PricingTabKey)}
          tabBarExtraContent={tabletColumns ? <Button onClick={() => void loadData()}>刷新</Button> : undefined}
          items={[
            { key: "pending", label: "待对账", children: pendingTab },
            { key: "statements", label: "对账单", children: statementsTab }
          ]}
        />

        <Modal
          title={downloadTargets.length > 1 ? `批量下载 ${downloadTargets.length} 张对账单` : "下载对账单"}
          open={downloadTargets.length > 0}
          okText="开始下载"
          cancelText="取消"
          confirmLoading={downloadLoading}
          onCancel={() => setDownloadTargets([])}
          onOk={() => void downloadStatements(downloadTargets, downloadColumnKeys)}
        >
          <Space direction="vertical" size={12} className="full-width">
            <Alert
              type="info"
              showIcon
              message="对账单基本信息固定保留"
              description="对账单号、客户、业务员、生成日期和账期始终显示。内部成本不会写入客户版对账单。"
            />
            <Typography.Text strong>选择订单明细字段</Typography.Text>
            <Checkbox.Group
              options={statementExportColumnOptions}
              value={downloadColumnKeys}
              onChange={(values) => setDownloadColumnKeys(values as ReconciliationStatementExportColumn[])}
            />
          </Space>
        </Modal>

        <DynamicPricingModal
          session={session}
          row={editingRow}
          open={Boolean(editingRow)}
          onClose={() => setEditingRow(null)}
          onChanged={loadData}
        />
        <ReceiverOrderChargeModal
          order={chargeOrder}
          thumbnail={chargeOrder ? orderThumbnail(chargeOrder) : null}
          charges={chargeModalCharges}
          role="admin"
          sourceScene="boss_order_list"
          onCancel={() => {
            chargeRequestIdRef.current += 1;
            setChargeOrder(null);
            setChargeModalCharges([]);
          }}
          onChargesChange={(charges) => {
            setChargeModalCharges(charges);
            void loadData();
          }}
        />
      </Card>
    </Space>
  );
}