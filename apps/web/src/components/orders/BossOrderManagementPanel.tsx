import {
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Image,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
  type TableProps
} from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  InboxOutlined,
  ToolOutlined,
  UserOutlined
} from "@ant-design/icons";
import {
  hasPhysicalProductionRoute,
  ORDER_STAGES,
  sampleGarmentRequiredFromItems,
  sampleRoundOptions,
  sampleRequestItemOptions,
  type SampleRequestItem
} from "@sample-room/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  sampleRoomApi,
  type AdminOrderDetail,
  type AdminQcResult,
  type OrderAttachment,
  type OrderChargeRecord,
  type OrderComplaint,
  type OrderRecord,
  type ScanRecord
} from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";
import { useSampleTypeOptions } from "../../app/SampleTypeOptionsContext";
import { useVisibleAutoRefresh } from "../../hooks/useVisibleAutoRefresh";
import { QcPhotoExportButton } from "../qc/QcPhotoExportButton";
import { BossStatsStrip } from "../boss/BossStatsStrip";
import { NON_SEARCHABLE_PAGE_SIZE_CHANGER } from "../tablet/pagination";
import {
  MaterialTag,
  SampleRoundTag,
  SampleTypeTag
} from "../StatusTags";
import {
  isNormalQcCompletion,
  orderOrIntakeStatusLabel,
  orderStageLabel,
  scanRecordNoteLabel,
  scanRecordQualityScoreLabel,
  scanRecordTitle
} from "../scan/scanDisplay";
import { OrderCompletionTag } from "../operations/OrderCompletionStatus";
import { OrderTaskStatusBadges } from "../operations/PatternTaskStatusBadges";
import { OrderAttachmentPanel } from "../attachments/OrderAttachmentPanel";
import { AttachmentLogList } from "../attachments/UnifiedAttachmentTable";
import { OrderAttachmentThumbnail } from "./OrderAttachmentThumbnail";
import { OrderTitleCell } from "./OrderTitleCell";
import { OrderChargeReadOnlyPanel } from "./OrderChargeReadOnlyPanel";
import { BossOrderSummaryHeader } from "./BossOrderSummaryHeader";
import { ReceiverOrderChargeModal } from "./ReceiverOrderChargeModal";
import { usePersistedColumnKeys } from "./usePersistedColumnKeys";
import { ColumnVisibilityControl } from "./ColumnVisibilityControl";
import { isNativeTabletRuntime } from "../../pages/qc/tabletNativeBridge";
import {
  buildCustomerOptions,
  buildSalespersonOptions,
  type FilterOption
} from "./orderFilters";
import {
  formatDeliveryDate,
  formatOrderDate,
  getOrderBusinessUserName,
  getOrderCustomerName,
  getOrderReceiverLabel
} from "./orderDisplay";
import {
  bossStageFilterOptions,
  matchesBossStageFilter,
  type BossStageFilterValue
} from "./bossStageFilter";
import {
  bossQuickStageCards,
  countBossQuickStageOrders,
  isSingleBossQuickStageSelected
} from "./bossQuickFilter";

type BossOrderManagementPanelProps = {
  session: DevSession;
};

type BossActiveFilters = {
  keyword: string;
  customerId?: string | undefined;
  salespersonId?: string | undefined;
  stages?: BossStageFilterValue[] | undefined;
  taskItems?: SampleRequestItem[] | undefined;
  sampleType?: string | undefined;
  sampleRound?: string | undefined;
  complaint?: "with" | "without" | undefined;
  receivedStartDate?: string | undefined;
  receivedEndDate?: string | undefined;
  deliveryStartDate?: string | undefined;
  deliveryEndDate?: string | undefined;
};

type OrderFlowRecord = {
  key: string;
  time?: string | undefined;
  title: string;
  detail?: string | undefined;
  tone: "success" | "warning" | "active" | "neutral";
  qualityResult?: "qualified" | "rework" | "rejected" | undefined;
  qualityScore?: number | undefined;
  qcWorkerName?: string | undefined;
  sewingWorkerName?: string | undefined;
  pieces?: number | undefined;
  reworkReason?: string | undefined;
  reworkPhotos?: OrderAttachment[] | undefined;
  scanRecordId?: string | undefined;
};

const defaultActiveFilters: BossActiveFilters = {
  keyword: ""
};

const bossActiveOptionalColumns = [
  { label: "接单时间", value: "receivedAt" },
  { label: "客户/业务员", value: "customer" },
  { label: "数量", value: "quantity" },
  { label: "样品类型", value: "sampleType" },
  { label: "轮次", value: "sampleRound" },
  { label: "订单任务", value: "orderTasks" },
  { label: "当前工序", value: "currentStage" },
  { label: "面里料", value: "fabricStatus" },
  { label: "辅料", value: "trimStatus" },
  { label: "交期", value: "deliveryDate" }
] as const;
type BossActiveOptionalColumnKey = (typeof bossActiveOptionalColumns)[number]["value"];
const defaultBossActiveColumns: BossActiveOptionalColumnKey[] = [
  "receivedAt",
  "customer",
  "quantity",
  "sampleType",
  "sampleRound",
  "orderTasks",
  "currentStage",
  "deliveryDate"
];
const compactBossActiveColumns: BossActiveOptionalColumnKey[] = [
  "customer",
  "orderTasks",
  "currentStage",
  "deliveryDate"
];

function hasPhysicalProduction(order: Pick<OrderRecord, "sampleRequestItems">) {
  return hasPhysicalProductionRoute(order.sampleRequestItems);
}


function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "-";
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatReceivedTime(order: OrderRecord) {
  return order.receivedAt ? formatOrderDate(order.receivedAt) : "未接单";
}

function orderDateKey(value?: string) {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : localDateKey(date);
}

function inDateRange(value: string | undefined, start?: string, end?: string) {
  if (!start && !end) {
    return true;
  }

  const key = orderDateKey(value);
  if (!key) {
    return false;
  }

  if (start && key < start) {
    return false;
  }

  if (end && key > end) {
    return false;
  }

  return true;
}


function matchesActiveFilters(order: OrderRecord, filters: BossActiveFilters) {
  const keyword = filters.keyword.trim().toLowerCase();
  const searchable = [
    order.orderNo,
    order.styleNo,
    order.styleName,
    order.customerName,
    order.customerSnapshot?.name,
    order.salespersonName,
    order.clientUserSnapshot?.displayName,
    order.remark
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (keyword && !searchable.includes(keyword)) {
    return false;
  }

  if (filters.customerId && order.customerId !== filters.customerId) {
    return false;
  }

  const salespersonId = order.salespersonId ?? order.clientUserId;
  if (filters.salespersonId && salespersonId !== filters.salespersonId) {
    return false;
  }

  if (!matchesBossStageFilter(order, filters.stages)) {
    return false;
  }

  if (filters.taskItems?.length && !filters.taskItems.every((item) => order.sampleRequestItems.includes(item))) {
    return false;
  }

  if (filters.sampleType && order.sampleType !== filters.sampleType) {
    return false;
  }

  if (filters.sampleRound && order.sampleRound !== filters.sampleRound) {
    return false;
  }

  if (filters.complaint === "with" && !(order.complaintCount && order.complaintCount > 0)) {
    return false;
  }

  if (filters.complaint === "without" && (order.complaintCount ?? 0) > 0) {
    return false;
  }

  return (
    inDateRange(order.receivedAt, filters.receivedStartDate, filters.receivedEndDate) &&
    inDateRange(order.deliveryDate, filters.deliveryStartDate, filters.deliveryEndDate)
  );
}

function matchesTerminatedKeyword(order: OrderRecord, keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    order.orderNo,
    order.styleNo,
    order.styleName,
    order.customerName,
    order.customerSnapshot?.name,
    order.salespersonName,
    order.clientUserSnapshot?.displayName,
    order.terminationReason,
    order.statusBeforeTermination,
    order.stageAtTermination
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function optionFromShared(options: Array<{ label: string; value: string }>): FilterOption[] {
  return options.map((option) => ({ label: option.label, value: option.value }));
}

function sortByOperationalTime(left: OrderRecord, right: OrderRecord) {
  const leftTime = new Date(left.receivedAt ?? left.createdAt).getTime();
  const rightTime = new Date(right.receivedAt ?? right.createdAt).getTime();
  return rightTime - leftTime;
}

export function bossQcAction(order: Pick<OrderRecord, "qcRecordStatus">) {
  if (order.qcRecordStatus === "rework") {
    return { label: "返工中", className: "is-rework", disabled: false } as const;
  }
  if (order.qcRecordStatus === "completed") {
    return { label: "组检记录", className: "is-completed", disabled: false } as const;
  }
  return { label: "尚未组检", className: "is-empty", disabled: true } as const;
}

function buildOrderFlowRecords(
  order: OrderRecord,
  scanRecords: ScanRecord[],
  qcReworkRecords: AdminOrderDetail["qcReworkRecords"] = []
): OrderFlowRecord[] {
  const reworkPhotosByRecordId = new Map(
    qcReworkRecords.map((record) => [record.scanRecordId, record.photos])
  );
  const records: OrderFlowRecord[] = [
    {
      key: "created",
      time: order.createdAt,
      title: "订单创建",
      detail: `${getOrderCustomerName(order)} / ${getOrderBusinessUserName(order)}`,
      tone: "neutral"
    }
  ];

  if (order.receivedAt) {
    records.push({
      key: "received",
      time: order.receivedAt,
      title: "接单员已接单",
      detail: getOrderReceiverLabel(order),
      tone: "neutral"
    });
  }

  if (order.returnedAt) {
    records.push({
      key: "returned",
      time: order.returnedAt,
      title: "订单退回",
      detail: order.returnReason,
      tone: "warning"
    });
  }

  if (order.patternTask?.completedAt) {
    records.push({
      key: "pattern-completed",
      time: order.patternTask.completedAt,
      title: "版师完成资料",
      detail: order.patternTask.patternMakerName ?? order.patternTask.note,
      tone: "active"
    });
  }

  for (const correction of order.correctionLogs ?? []) {
    if (correction.fieldName !== "quantity") continue;
    const managerPricingUpdate =
      correction.changedByRole === "boss" || correction.changedByRole === "system_owner";
    const actorName = correction.changedByName ?? (
      correction.changedByRole === "boss"
        ? "老板"
        : correction.changedByRole === "system_owner"
          ? "System Owner"
          : correction.changedByRole === "receiver"
            ? "接单员"
            : "管理员"
    );
    records.push({
      key: `quantity-correction-${correction.id}`,
      time: correction.changedAt,
      title: managerPricingUpdate ? "定价更新订单数量" : "订单数量修正",
      detail: `${actorName} / ${correction.oldValue ?? "-"} → ${correction.newValue ?? "-"} 件`,
      tone: "active"
    });
  }

  for (const record of scanRecords) {
    const qualityResult = record.stage === "qc_delivery" && record.action === "complete"
      ? record.qualityResult
      : undefined;
    const reworkPhotos = record.qualityResult === "rework"
      ? reworkPhotosByRecordId.get(record.id) ?? []
      : undefined;
    const recordTime = new Date(record.eventTime).getTime();
    const sewingWorkerName = qualityResult === "rework"
      ? scanRecords
          .filter((candidate) =>
            candidate.stage === "sewing" &&
            candidate.action === "complete" &&
            new Date(candidate.eventTime).getTime() <= recordTime
          )
          .sort((left, right) => new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime())[0]
          ?.workerName
      : undefined;
    records.push({
      key: `scan-${record.id}`,
      time: record.eventTime,
      title: scanRecordTitle(record),
      detail: [
        record.workerName,
        record.workHours ? `工时 ${record.workHours}` : undefined,
        record.pieces !== undefined ? `产出 ${record.pieces}` : undefined,
        scanRecordQualityScoreLabel(record),
        isNormalQcCompletion(record) ? scanRecordNoteLabel(record) : record.note
      ]
        .filter(Boolean)
        .join(" / "),
      tone: qualityResult === "qualified"
        ? "success"
        : qualityResult === "rework"
          ? "warning"
          : "active",
      ...(qualityResult ? { qualityResult } : {}),
      ...(record.qualityScore !== undefined ? { qualityScore: record.qualityScore } : {}),
      ...(qualityResult ? { qcWorkerName: record.workerName } : {}),
      ...(sewingWorkerName ? { sewingWorkerName } : {}),
      ...(record.pieces !== undefined ? { pieces: record.pieces } : {}),
      ...(qualityResult === "rework" && record.note ? { reworkReason: record.note } : {}),
      ...(reworkPhotos ? { reworkPhotos, scanRecordId: record.id } : {})
    });
  }

  if (order.terminatedAt) {
    records.push({
      key: "terminated",
      time: order.terminatedAt,
      title: "订单终止",
      detail: order.terminationReason ?? order.terminatedByName,
      tone: "warning"
    });
  }

  return records.sort((left, right) => {
    const leftTime = left.time ? new Date(left.time).getTime() : 0;
    const rightTime = right.time ? new Date(right.time).getTime() : 0;
    return rightTime - leftTime;
  });
}

function BossQcReworkPhoto({ attachment, index, load }: {
  attachment: OrderAttachment;
  index: number;
  load: () => Promise<Blob>;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setUrl("");
    setFailed(false);
    void loadRef.current().then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id]);
  return (
    <figure className="boss-rework-photo-item">
      {failed ? (
        <div className="boss-qc-rework-photo-loading is-error">
          <Typography.Text type="danger">照片加载失败</Typography.Text>
        </div>
      ) : url ? (
        <Image
          width="100%"
          height={154}
          src={url}
          alt={`瑕疵照片 ${index + 1}`}
          style={{ objectFit: "cover" }}
        />
      ) : (
        <div className="boss-qc-rework-photo-loading"><Spin size="small" /></div>
      )}
      <figcaption>瑕疵照片 {index + 1}</figcaption>
    </figure>
  );
}

function flowRecordIcon(record: OrderFlowRecord) {
  if (record.tone === "success") return <CheckCircleOutlined />;
  if (record.tone === "warning") return <ExclamationCircleOutlined />;
  return <span className="boss-flow-dot" />;
}

export function BossOrderManagementPanel({ session }: BossOrderManagementPanelProps) {
  const tabletColumns = isNativeTabletRuntime();
  const { options: sampleTypeOptions } = useSampleTypeOptions();
  const [activeOrders, setActiveOrders] = useState<OrderRecord[]>([]);
  const [terminatedOrders, setTerminatedOrders] = useState<OrderRecord[]>([]);
  const [activeFilters, setActiveFilters] = useState<BossActiveFilters>(defaultActiveFilters);
  const [visibleActiveColumnKeys, setVisibleActiveColumnKeys] =
    usePersistedColumnKeys<BossActiveOptionalColumnKey>(
      `sample-room:boss-active-order-columns:v4${tabletColumns ? ":tablet" : ""}`,
      defaultBossActiveColumns,
      tabletColumns ? compactBossActiveColumns : defaultBossActiveColumns
    );
  const [terminatedKeyword, setTerminatedKeyword] = useState("");
  const [terminatedExpanded, setTerminatedExpanded] = useState(false);
  const [activePage, setActivePage] = useState(1);
  const [activePageSize, setActivePageSize] = useState(() => {
    const stored = Number(window.localStorage.getItem("sample-room:boss-active-orders:page-size"));
    return [10, 20, 50].includes(stored) ? stored : 10;
  });
  const [terminatedPage, setTerminatedPage] = useState(1);
  const [terminatedPageSize, setTerminatedPageSize] = useState(() => {
    const stored = Number(window.localStorage.getItem("sample-room:boss-terminated-orders:page-size"));
    return [10, 20, 50].includes(stored) ? stored : 10;
  });
  const terminatedSectionRef = useRef<HTMLDivElement | null>(null);
  const activeTableRef = useRef<HTMLDivElement | null>(null);
  const terminatedTableRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [orderDetail, setOrderDetail] = useState<AdminOrderDetail | null>(null);
  const [detailCharges, setDetailCharges] = useState<OrderChargeRecord[]>([]);
  const detailRequestIdRef = useRef(0);
  const detailOrderIdRef = useRef<string | undefined>(undefined);
  const [chargeOrder, setChargeOrder] = useState<OrderRecord | null>(null);
  const [chargeModalCharges, setChargeModalCharges] = useState<OrderChargeRecord[]>([]);
  const chargeRequestIdRef = useRef(0);
  const [detailTab, setDetailTab] = useState("attachments");
  const [detailFlowPage, setDetailFlowPage] = useState(1);
  const [reworkPhotoRecord, setReworkPhotoRecord] = useState<OrderFlowRecord | null>(null);
  const [detailComplaintPage, setDetailComplaintPage] = useState(1);
  const [detailComplaintPageSize, setDetailComplaintPageSize] = useState(8);
  const [terminatingOrder, setTerminatingOrder] = useState<OrderRecord | null>(null);
  const [complaintOrder, setComplaintOrder] = useState<OrderRecord | null>(null);
  const [qcResultOrder, setQcResultOrder] = useState<OrderRecord | null>(null);
  const [qcResult, setQcResult] = useState<AdminQcResult | null>(null);
  const [qcResultLoading, setQcResultLoading] = useState(false);
  const qcResultOpenRef = useRef(false);
  const qcResultRefreshBlockedUntilRef = useRef(0);
  const [deletingComplaintId, setDeletingComplaintId] = useState<string | null>(null);
  const [form] = Form.useForm<{ reason?: string }>();
  const [complaintForm] = Form.useForm<{ description: string }>();
  const [messageApi, contextHolder] = message.useMessage();

  const loadOrders = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [active, terminated] = await Promise.all([
        sampleRoomApi.listAdminActiveOrders(session),
        sampleRoomApi.listAdminTerminatedOrders(session)
      ]);
      setActiveOrders(active.orders);
      setTerminatedOrders(terminated.orders);
    } catch (error) {
      if (!silent) messageApi.error(error instanceof Error ? error.message : "老板订单列表加载失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [messageApi, session]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useVisibleAutoRefresh(() => {
    if (qcResultOpenRef.current || Date.now() < qcResultRefreshBlockedUntilRef.current) return;
    return loadOrders({ silent: true });
  });

  const openTerminate = (order: OrderRecord) => {
    setTerminatingOrder(order);
    form.setFieldsValue({ reason: "" });
  };

  const submitTerminate = async () => {
    if (!terminatingOrder) {
      return;
    }

    const values = await form.validateFields();
    await sampleRoomApi.terminateAdminOrder(session, terminatingOrder.id, values);
    messageApi.success("订单已终止");
    setTerminatedExpanded(true);
    setTerminatedKeyword("");
    setTerminatingOrder(null);
    await loadOrders();
    requestAnimationFrame(() => {
      terminatedSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const openComplaint = (order: OrderRecord) => {
    setComplaintOrder(order);
    complaintForm.resetFields();
  };

  const submitComplaint = async () => {
    if (!complaintOrder) return;
    const values = await complaintForm.validateFields();
    await sampleRoomApi.registerAdminOrderComplaint(session, complaintOrder.id, values);
    messageApi.success("客诉记录已登记");
    const registeredOrder = complaintOrder;
    setComplaintOrder(null);
    await loadOrders();
    if (detailOpen && orderDetail?.order.id === registeredOrder.id) {
      await loadOrderDetail(registeredOrder);
    }
  };

  const deleteComplaint = async (complaint: OrderComplaint) => {
    const order = orderDetail?.order;
    if (!order) return;
    setDeletingComplaintId(complaint.id);
    try {
      await sampleRoomApi.deleteAdminOrderComplaint(session, order.id, complaint.id);
      messageApi.success("客诉记录已删除");
      await Promise.all([loadOrders(), loadOrderDetail(order)]);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "客诉记录删除失败");
    } finally {
      setDeletingComplaintId(null);
    }
  };

  const restoreOrder = async (order: OrderRecord) => {
    try {
      await sampleRoomApi.restoreAdminOrder(session, order.id);
      messageApi.success("订单已恢复");
      await loadOrders();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "订单恢复失败");
    }
  };

  const loadOrderDetail = useCallback(
    async (order: OrderRecord) => {
      const requestId = ++detailRequestIdRef.current;
      detailOrderIdRef.current = order.id;
      setDetailLoading(true);
      setOrderDetail({ order, scanRecords: [], qcReworkRecords: [], complaints: [] });
      setDetailCharges([]);
      try {
        const [detail, charges] = await Promise.all([
          sampleRoomApi.getAdminOrderDetail(session, order.id),
          sampleRoomApi.listOrderCharges(session, "admin", order.id)
        ]);
        if (requestId !== detailRequestIdRef.current) return;
        setOrderDetail(detail);
        setDetailCharges(charges.charges);
      } catch (error) {
        if (requestId !== detailRequestIdRef.current) return;
        messageApi.error(error instanceof Error ? error.message : "订单详情加载失败");
      } finally {
        if (requestId === detailRequestIdRef.current) setDetailLoading(false);
      }
    },
    [messageApi, session]
  );

  const openOrderDetail = (order: OrderRecord) => {
    setDetailTab("attachments");
    setDetailFlowPage(1);
    setReworkPhotoRecord(null);
    setDetailComplaintPage(1);
    setDetailOpen(true);
    void loadOrderDetail(order);
  };

  const closeOrderDetail = () => {
    detailRequestIdRef.current += 1;
    detailOrderIdRef.current = undefined;
    setDetailOpen(false);
    setOrderDetail(null);
    setDetailCharges([]);
    setDetailTab("attachments");
    setDetailFlowPage(1);
    setDetailComplaintPage(1);
  };

  const refreshDetailCharges = async (orderId: string) => {
    const result = await sampleRoomApi.listOrderCharges(session, "admin", orderId);
    if (detailOrderIdRef.current === orderId) setDetailCharges(result.charges);
  };

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

  const openQcResult = async (order: OrderRecord) => {
    qcResultOpenRef.current = true;
    setQcResultOrder(order);
    setQcResult(null);
    setQcResultLoading(true);
    try {
      setQcResult((await sampleRoomApi.getAdminQcResult(session, order.id)).result);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "组检结果加载失败");
      qcResultOpenRef.current = false;
      setQcResultOrder(null);
    } finally {
      setQcResultLoading(false);
    }
  };

  const loadOrderAttachmentPreview = useCallback(
    (order: OrderRecord, attachment: OrderAttachment) =>
      sampleRoomApi.downloadAdminOrderAttachment(session, order.id, attachment.id),
    [session]
  );

  const orderThumbnail = useCallback(
    (order: OrderRecord) => (
      <OrderAttachmentThumbnail order={order} loadPreview={loadOrderAttachmentPreview} />
    ),
    [loadOrderAttachmentPreview]
  );

  const orderIdentity = useCallback(
    (order: OrderRecord) => (
      <OrderTitleCell
        order={order}
        showMeta={false}
        thumbnail={orderThumbnail(order)}
        extra={<Space size={4} wrap>
          <Tag>{order.attachmentCount} 份资料</Tag>
          {order.sewingWorkforce?.mode === "collaboration" ? (
            <Tooltip title={order.sewingWorkforce.workerNames.join("、")}>
              <Tag color="blue">协作</Tag>
            </Tooltip>
          ) : null}
        </Space>}
      />
    ),
    [orderThumbnail]
  );

  const activeActions = (order: OrderRecord) => {
    const qcAction = bossQcAction(order);
    return <Space direction="vertical" size={4}>
      <Button size="small" className="boss-order-row-action" onClick={() => void openChargeDialog(order)}>
        其他费用 {order.chargeCount ?? 0}
      </Button>
      {sampleGarmentRequiredFromItems(order.sampleRequestItems) ? (
        <><Button
          size="small"
          disabled={qcAction.disabled}
          className={`boss-order-row-action boss-order-qc-action ${qcAction.className}`}
          onClick={() => void openQcResult(order)}
        >{qcAction.label}</Button><Button size="small" className="boss-order-row-action" onClick={() => openComplaint(order)}>登记客诉</Button></>
      ) : null}
      <Button
        danger
        size="small"
        disabled={order.stage === ORDER_STAGES.done || order.completionStatus === "completed"}
        className="boss-order-row-action"
        onClick={() => openTerminate(order)}
      >
        终止订单
      </Button>
    </Space>;
  };

  const closeQcResult = () => {
    qcResultOpenRef.current = false;
    qcResultRefreshBlockedUntilRef.current = Date.now() + 2_000;
    setQcResultOrder(null);
    setQcResult(null);
    setQcResultLoading(false);
  };

  const terminatedActions = (order: OrderRecord) => (
    <Space direction="vertical" size={4}>
      <Button size="small" className="boss-order-row-action" onClick={() => openOrderDetail(order)}>
        查看详情
      </Button>
      <Button size="small" className="boss-order-row-action restore-order-button" onClick={() => void restoreOrder(order)}>
        恢复订单
      </Button>
    </Space>
  );

  const scrollActiveOrdersIntoView = () => {
    requestAnimationFrame(() => {
      activeTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      activeTableRef.current?.querySelector<HTMLElement>(".ant-table-body")?.scrollTo({ top: 0 });
    });
  };

  const resetActiveFilters = () => {
    setActiveFilters(defaultActiveFilters);
    setActivePage(1);
    scrollActiveOrdersIntoView();
  };

  const patchActiveFilters = (patch: Partial<BossActiveFilters>) => {
    setActivePage(1);
    setActiveFilters((current) => ({ ...current, ...patch }));
    requestAnimationFrame(() => activeTableRef.current?.querySelector<HTMLElement>(".ant-table-body")?.scrollTo({ top: 0 }));
  };

  const applyQuickStageFilter = (stage: BossStageFilterValue) => {
    const selected = isSingleBossQuickStageSelected(activeFilters.stages, stage);
    setActiveFilters(selected ? defaultActiveFilters : { ...defaultActiveFilters, stages: [stage] });
    setActivePage(1);
    scrollActiveOrdersIntoView();
  };

  const applyTodayDeliveryQuickFilter = (todayKey: string) => {
    const selected =
      activeFilters.deliveryStartDate === todayKey &&
      activeFilters.deliveryEndDate === todayKey;
    setActiveFilters(selected
      ? defaultActiveFilters
      : { ...defaultActiveFilters, deliveryStartDate: todayKey, deliveryEndDate: todayKey });
    setActivePage(1);
    scrollActiveOrdersIntoView();
  };

  const openTerminatedQuickView = () => {
    setTerminatedKeyword("");
    setTerminatedPage(1);
    setTerminatedExpanded(true);
    requestAnimationFrame(() => {
      terminatedSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      terminatedTableRef.current?.querySelector<HTMLElement>(".ant-table-body")?.scrollTo({ top: 0 });
    });
  };

  const updateTerminatedKeyword = (keyword: string) => {
    setTerminatedKeyword(keyword);
    setTerminatedPage(1);
    requestAnimationFrame(() => terminatedTableRef.current?.querySelector<HTMLElement>(".ant-table-body")?.scrollTo({ top: 0 }));
  };

  const customerOptions = useMemo(() => buildCustomerOptions(activeOrders), [activeOrders]);
  const salespersonOptions = useMemo(
    () => buildSalespersonOptions(activeOrders, activeFilters.customerId),
    [activeFilters.customerId, activeOrders]
  );

  const sampleTypeFilterOptions = useMemo(() => optionFromShared(sampleTypeOptions), [sampleTypeOptions]);
  const sampleRoundFilterOptions = useMemo(() => optionFromShared(sampleRoundOptions), []);

  const filteredActiveOrders = useMemo(
    () => activeOrders.filter((order) => matchesActiveFilters(order, activeFilters)).sort(sortByOperationalTime),
    [activeFilters, activeOrders]
  );
  const filteredTerminatedOrders = useMemo(
    () =>
      terminatedOrders
        .filter((order) => matchesTerminatedKeyword(order, terminatedKeyword))
        .sort((left, right) => {
          const leftTime = new Date(left.terminatedAt ?? left.updatedAt).getTime();
          const rightTime = new Date(right.terminatedAt ?? right.updatedAt).getTime();
          return rightTime - leftTime;
        }),
    [terminatedKeyword, terminatedOrders]
  );
  const currentActivePage = Math.min(activePage, Math.max(1, Math.ceil(filteredActiveOrders.length / activePageSize)));
  const currentTerminatedPage = Math.min(terminatedPage, Math.max(1, Math.ceil(filteredTerminatedOrders.length / terminatedPageSize)));
  const visibleActiveOrders = filteredActiveOrders.slice(
    (currentActivePage - 1) * activePageSize,
    currentActivePage * activePageSize
  );
  const visibleTerminatedOrders = filteredTerminatedOrders.slice(
    (currentTerminatedPage - 1) * terminatedPageSize,
    currentTerminatedPage * terminatedPageSize
  );

  useEffect(() => {
    if (activePage !== currentActivePage) setActivePage(currentActivePage);
  }, [activePage, currentActivePage]);

  useEffect(() => {
    if (terminatedPage !== currentTerminatedPage) setTerminatedPage(currentTerminatedPage);
  }, [currentTerminatedPage, terminatedPage]);

  const detailOrder = orderDetail?.order ?? null;
  const detailAttachments = detailOrder?.attachments ?? [];
  const detailScanRecords = orderDetail?.scanRecords ?? [];
  const detailComplaints: OrderComplaint[] = orderDetail?.complaints ?? [];
  const detailFlowRecords = useMemo(
    () => (detailOrder ? buildOrderFlowRecords(detailOrder, detailScanRecords, orderDetail?.qcReworkRecords ?? []) : []),
    [detailOrder, detailScanRecords, orderDetail?.qcReworkRecords]
  );
  const detailComplaintPageCount = Math.max(1, Math.ceil(detailComplaints.length / detailComplaintPageSize));
  const currentDetailComplaintPage = Math.min(detailComplaintPage, detailComplaintPageCount);
  const visibleDetailComplaints = detailComplaints.slice(
    (currentDetailComplaintPage - 1) * detailComplaintPageSize,
    currentDetailComplaintPage * detailComplaintPageSize
  );

  useEffect(() => {
    if (detailComplaintPage !== currentDetailComplaintPage) {
      setDetailComplaintPage(currentDetailComplaintPage);
    }
  }, [currentDetailComplaintPage, detailComplaintPage]);
  const todayKey = localDateKey();
  const overviewItems = [
    ...bossQuickStageCards.map((card) => ({
      label: card.label,
      value: countBossQuickStageOrders(activeOrders, card.stage),
      tone: card.tone,
      selected: isSingleBossQuickStageSelected(activeFilters.stages, card.stage),
      onClick: () => applyQuickStageFilter(card.stage)
    })),
    {
      label: "今日交期",
      value: activeOrders.filter((order) => orderDateKey(order.deliveryDate) === todayKey).length,
      tone: "cyan",
      selected:
        activeFilters.deliveryStartDate === todayKey &&
        activeFilters.deliveryEndDate === todayKey,
      onClick: () => applyTodayDeliveryQuickFilter(todayKey)
    },
    {
      label: "已终止",
      value: terminatedOrders.length,
      tone: "gray",
      selected: terminatedExpanded,
      onClick: openTerminatedQuickView
    }
  ];

  const renderAttachmentTab = () => {
    const deliverables = detailOrder?.patternTask?.deliverables ?? [];

    if (!detailOrder) return null;

    return (
        <OrderAttachmentPanel
          key={detailOrder.id}
          workspace
          defaultCategory="other"
          defaultVisibility="internal_only"
          showVisibilityChoice
          pickerDescription="默认仅内部可见，可为每个文件单独设置客户可见。"
          onUpload={async (drafts) => {
            const result = await sampleRoomApi.addAdminOrderAttachments(
              session,
              detailOrder.id,
              drafts
            );
            setOrderDetail((current) => current ? {
              ...current,
              order: {
                ...current.order,
                attachments: result.attachments,
                attachmentCount: result.attachments.length
              }
            } : current);
          }}
          attachments={detailAttachments}
          deliverables={deliverables}
          logs={detailOrder.attachmentLogs ?? []}
          currentUserId={session.userId}
          currentRole={session.role}
          showPageSizeChanger={tabletColumns}
          showLogs={!tabletColumns}
          onRenameAttachment={async (attachment, displayName) => {
            await sampleRoomApi.renameAdminOrderAttachment(
              session,
              detailOrder.id,
              attachment.id,
              displayName
            );
            await loadOrderDetail(detailOrder);
          }}
          onRenameDeliverable={async (deliverable, displayName) => {
            await sampleRoomApi.renameAdminPatternDeliverable(
              session,
              detailOrder.id,
              deliverable.id,
              displayName
            );
            await loadOrderDetail(detailOrder);
          }}
          onDeleteAttachment={async (attachment) => {
            await sampleRoomApi.deleteAdminOrderAttachment(
              session,
              detailOrder.id,
              attachment.id
            );
            await loadOrderDetail(detailOrder);
          }}
          onDeleteDeliverable={async (deliverable) => {
            await sampleRoomApi.deleteAdminPatternDeliverable(
              session,
              detailOrder.id,
              deliverable.id
            );
            await loadOrderDetail(detailOrder);
          }}
          onChangeAttachmentVisibility={async (attachment, visibility) => {
            await sampleRoomApi.changeAdminOrderAttachmentVisibility(
              session,
              detailOrder.id,
              attachment.id,
              visibility
            );
            await loadOrderDetail(detailOrder);
          }}
          onChangeDeliverableVisibility={async (deliverable, visibility) => {
            await sampleRoomApi.changeAdminPatternDeliverableVisibility(
              session,
              detailOrder.id,
              deliverable.id,
              visibility
            );
            await loadOrderDetail(detailOrder);
          }}
          loadPreview={(row) =>
            sampleRoomApi.downloadAdminOrderAttachment(session, detailOrder.id, row.id)
          }
          loadDeliverablePreview={(deliverable) =>
            sampleRoomApi.downloadAdminPatternDeliverable(session, detailOrder.id, deliverable.id)
          }
        />
    );
  };

  const renderFlowTab = () => (
    <div className="boss-order-flow-tab">
      {detailFlowRecords.length ? (
        <Table
          className="boss-order-flow-table"
          rowKey="key"
          size="small"
          bordered
          rowClassName={(record) => `boss-flow-row boss-flow-row-${record.tone}`}
          pagination={{
            current: detailFlowPage,
            defaultPageSize: 10,
            showSizeChanger: NON_SEARCHABLE_PAGE_SIZE_CHANGER,
            pageSizeOptions: [10, 20, 50],
            showTotal: (total) => `共 ${total} 条`,
            onChange: setDetailFlowPage
          }}
          columns={[
            {
              title: "",
              key: "status",
              width: 54,
              align: "center",
              render: (_, record: OrderFlowRecord) => (
                <span className={`boss-flow-status boss-flow-status-${record.tone}`}>
                  {flowRecordIcon(record)}
                </span>
              )
            },
            { title: "时间", dataIndex: "time", width: 190, render: formatTime },
            {
              title: "节点",
              dataIndex: "title",
              width: 190,
              render: (value: string, record: OrderFlowRecord) => (
                <Space direction="vertical" size={4}>
                  <span>{value}</span>
                  {record.qualityResult === "rework" ? <Tag color="orange">返工</Tag> : null}
                </Space>
              )
            },
            {
              title: "说明",
              dataIndex: "detail",
              render: (value: string | undefined) => <span>{value || "-"}</span>
            },
            {
              title: "操作",
              key: "actions",
              width: 180,
              align: "center",
              render: (_, record: OrderFlowRecord) => record.qualityResult === "rework" ? (
                <Button size="small" onClick={() => setReworkPhotoRecord(record)}>
                  查看瑕疵记录{record.reworkPhotos?.length ? ` ${record.reworkPhotos.length}` : ""}
                </Button>
              ) : record.qualityResult === "qualified" && detailOrder ? (
                <Button size="small" onClick={() => void openQcResult(detailOrder)}>
                  查看详情
                </Button>
              ) : <Typography.Text type="secondary">--</Typography.Text>
            }
          ]}
          dataSource={detailFlowRecords}
          scroll={{ y: "100%" }}
        />
      ) : (
        <Empty description="暂无流程记录" />
      )}
    </div>
  );

  const renderComplaintTab = () => (
    <div className="boss-order-complaint-tab">
      <div className="boss-order-complaint-list">
        {visibleDetailComplaints.length > 0 ? visibleDetailComplaints.map((complaint) => (
          <div className="boss-order-complaint-row" key={complaint.id}>
            <div>
              <Typography.Text>{complaint.description}</Typography.Text>
              <br />
              <Typography.Text type="secondary">
                登记人：{complaint.registeredByName} · 登记时间：{formatTime(complaint.createdAt)}
                {` · 关联组检/出库人员：${complaint.qcWorkerNameSnapshot || "未关联"}`}
              </Typography.Text>
            </div>
            <Popconfirm
              title="删除这条客诉记录？"
              description="删除后，该记录不再计入组检/出库客诉统计。"
              okText="确认删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteComplaint(complaint)}
            >
              <Button danger size="small" loading={deletingComplaintId === complaint.id}>
                删除
              </Button>
            </Popconfirm>
          </div>
        )) : (
          <Empty description="暂无客诉记录" />
        )}
      </div>
      <Pagination
        className="boss-order-complaint-pagination"
        current={currentDetailComplaintPage}
        pageSize={detailComplaintPageSize}
        total={detailComplaints.length}
        showSizeChanger={tabletColumns ? NON_SEARCHABLE_PAGE_SIZE_CHANGER : false}
        pageSizeOptions={[8, 12, 20]}
        onChange={(nextPage, nextPageSize) => {
          if (nextPageSize !== detailComplaintPageSize) {
            setDetailComplaintPageSize(nextPageSize);
            setDetailComplaintPage(1);
          } else {
            setDetailComplaintPage(nextPage);
          }
        }}
      />
    </div>
  );

  const activeColumnDefinitions: TableProps<OrderRecord>["columns"] = [
    {
      title: "接单时间",
      key: "receivedAt",
      width: 128,
      render: (_, order) => <Typography.Text>{formatReceivedTime(order)}</Typography.Text>
    },
    {
      title: "订单",
      key: "order",
      width: 360,
      render: (_, order) => (
        <Space direction="vertical" size={2} className="boss-order-title-wrap">
          {orderIdentity(order)}
        </Space>
      )
    },
    {
      title: "客户/业务员",
      key: "customer",
      width: 220,
      render: (_, order) => {
        const customerName = getOrderCustomerName(order);
        const businessUserName = getOrderBusinessUserName(order);
        return (
          <div className="order-customer-context-cell">
            <Typography.Text strong title={customerName}>
              {customerName}
            </Typography.Text>
            <Typography.Text type="secondary" title={businessUserName}>
              {businessUserName}
            </Typography.Text>
          </div>
        );
      }
    },
    {
      title: "数量",
      key: "quantity",
      width: 70,
      render: (_, order) => hasPhysicalProduction(order) ? order.quantity : "N/A"
    },
    {
      title: "样品类型",
      key: "sampleType",
      dataIndex: "sampleType",
      width: 96,
      render: (value) => <SampleTypeTag value={value} />
    },
    {
      title: "轮次",
      key: "sampleRound",
      dataIndex: "sampleRound",
      width: 84,
      render: (value) => <SampleRoundTag value={value} />
    },
    {
      title: "订单任务",
      key: "orderTasks",
      width: 260,
      render: (_value, order) => (
        <OrderTaskStatusBadges
          sampleRequestItems={order.sampleRequestItems}
          stage={order.stage}
          patternTask={order.patternTask}
          maxRows={2}
        />
      )
    },
    {
      title: "当前工序",
      key: "currentStage",
      width: 170,
      render: (_value, order) => (
        <OrderCompletionTag
          sampleRequestItems={order.sampleRequestItems}
          stage={order.stage}
          {...(order.stageLabel ? { stageLabel: order.stageLabel } : {})}
          {...(order.completionStatus ? { completionStatus: order.completionStatus } : {})}
          {...(order.patternTask ? { patternTask: order.patternTask } : {})}
        />
      )
    },
    {
      title: "缝制员工",
      key: "sewingWorkers",
      width: 130,
      render: (_value, order) => {
        const workforce = order.sewingWorkforce;
        if (!workforce?.workerNames.length) return <Typography.Text type="secondary">-</Typography.Text>;
        if (workforce.mode === "collaboration") {
          return <Tooltip title={workforce.workerNames.join("、")}><Tag color="blue">多人</Tag></Tooltip>;
        }
        return <Typography.Text>{workforce.workerNames[0]}</Typography.Text>;
      }
    },
    {
      title: "面里料",
      key: "fabricStatus",
      dataIndex: "fabricStatus",
      width: 90,
      render: (value, order) => hasPhysicalProduction(order) ? <MaterialTag value={value} /> : "N/A"
    },
    {
      title: "辅料",
      key: "trimStatus",
      dataIndex: "trimStatus",
      width: 90,
      render: (value, order) => hasPhysicalProduction(order) ? <MaterialTag value={value} /> : "N/A"
    },
    {
      title: "交期",
      key: "deliveryDate",
      dataIndex: "deliveryDate",
      width: 108,
      render: (value) => formatDeliveryDate(value)
    },
    {
      title: "客诉情况",
      key: "complaintStatus",
      width: 104,
      render: (_, order) => order.complaintCount && order.complaintCount > 0
        ? <Tag color="red">有客诉</Tag>
        : <Tag>无</Tag>
    },
    {
      title: "操作",
      key: "actions",
      width: 124,
      fixed: "right",
      render: (_, order) => activeActions(order)
    }
  ];
  const showSewingWorkerColumn = isSingleBossQuickStageSelected(
    activeFilters.stages,
    ORDER_STAGES.sewingDoing
  );
  const selectedActiveColumns = activeColumnDefinitions.filter((column) => {
    const key = String(column.key ?? "");
    return key === "order" || key === "complaintStatus" || key === "actions" ||
      (key === "sewingWorkers" && showSewingWorkerColumn) ||
      visibleActiveColumnKeys.includes(key as BossActiveOptionalColumnKey);
  });
  const activeColumns: TableProps<OrderRecord>["columns"] = [
    ...selectedActiveColumns.filter((column) => column.key !== "actions"),
    {
      title: "",
      key: "layoutSpacer",
      className: "boss-active-table-spacer",
      render: () => null
    },
    ...selectedActiveColumns.filter((column) => column.key === "actions")
  ];

  const terminatedColumns: TableProps<OrderRecord>["columns"] = [
    {
      title: "接单时间",
      key: "receivedAt",
      width: 128,
      render: (_, order) => formatReceivedTime(order)
    },
    {
      title: "订单",
      key: "order",
      width: 360,
      render: (_, order) => orderIdentity(order)
    },
    {
      title: "客户/业务员",
      key: "customer",
      width: 220,
      render: (_, order) => {
        const customerName = getOrderCustomerName(order);
        const businessUserName = getOrderBusinessUserName(order);
        return (
          <div className="order-customer-context-cell">
            <Typography.Text strong title={customerName}>
              {customerName}
            </Typography.Text>
            <Typography.Text type="secondary" title={businessUserName}>
              {businessUserName}
            </Typography.Text>
          </div>
        );
      }
    },
    {
      title: "终止时间",
      dataIndex: "terminatedAt",
      width: 156,
      render: (value) => formatTime(value)
    },
    {
      title: "终止原因",
      dataIndex: "terminationReason",
      width: 220,
      render: (value) => value || "-"
    },
    {
      title: "终止前状态",
      key: "before",
      width: 180,
      render: (_, order) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>{orderOrIntakeStatusLabel(order.statusBeforeTermination)}</Typography.Text>
          <Typography.Text type="secondary">{orderStageLabel(order.stageAtTermination)}</Typography.Text>
        </Space>
      )
    },
    {
      title: "操作",
      width: 116,
      fixed: "right",
      render: (_, order) => terminatedActions(order)
    }
  ];

  return (
    <div className="boss-order-page full-width">
      {contextHolder}
      <BossStatsStrip
        scope="经营管理 / 订单状态"
        title="订单状态总览"
        ariaLabel="订单状态总览"
        items={overviewItems}
      />

      <Card
        className="section-card boss-active-orders-card"
        title={`活跃订单（${filteredActiveOrders.length}）`}
        extra={
          <Space>
            <Typography.Text type="secondary">共 {activeOrders.length} 单</Typography.Text>
            <Button onClick={() => void loadOrders()}>刷新</Button>
          </Space>
        }
      >
        <Space direction="vertical" size={12} className="full-width">
          <div className="boss-active-filter-bar">
            <span className="boss-filter-label">接单时间</span>
            <Input
              type="date"
              value={activeFilters.receivedStartDate}
              onChange={(event) => patchActiveFilters({ receivedStartDate: event.target.value })}
              className="boss-filter-date"
            />
            <Input
              type="date"
              value={activeFilters.receivedEndDate}
              onChange={(event) => patchActiveFilters({ receivedEndDate: event.target.value })}
              className="boss-filter-date"
            />
            <Input
              allowClear
              placeholder="搜索订单 / 款号 / 客户 / 业务员"
              value={activeFilters.keyword}
              onChange={(event) => patchActiveFilters({ keyword: event.target.value })}
              className="boss-filter-keyword"
            />
            <Select
              allowClear
              placeholder="全部客户"
              value={activeFilters.customerId ?? null}
              options={customerOptions}
              onChange={(customerId) => patchActiveFilters({ customerId: customerId ?? undefined, salespersonId: undefined })}
              className="boss-filter-select"
            />
            <Select
              allowClear
              placeholder="全部业务员"
              value={activeFilters.salespersonId ?? null}
              options={salespersonOptions}
              onChange={(salespersonId) => patchActiveFilters({ salespersonId: salespersonId ?? undefined })}
              className="boss-filter-select"
            />
            <Select<BossStageFilterValue[]>
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              placeholder="全部工序"
              value={activeFilters.stages ?? []}
              options={bossStageFilterOptions}
              onChange={(stages) => patchActiveFilters({ stages })}
              className="boss-filter-select"
              aria-label="筛选当前工序"
            />
            <Select<SampleRequestItem[]>
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              placeholder="订单任务（包含全部已选）"
              value={activeFilters.taskItems ?? []}
              options={optionFromShared(sampleRequestItemOptions)}
              onChange={(taskItems) => patchActiveFilters({ taskItems })}
              className="boss-filter-select"
              aria-label="筛选订单任务"
            />
            <Select
              allowClear
              placeholder="样品类型"
              value={activeFilters.sampleType ?? null}
              options={sampleTypeFilterOptions}
              onChange={(sampleType) => patchActiveFilters({ sampleType: sampleType ?? undefined })}
              className="boss-filter-select"
            />
            <Select
              allowClear
              placeholder="样品轮次"
              value={activeFilters.sampleRound ?? null}
              options={sampleRoundFilterOptions}
              onChange={(sampleRound) => patchActiveFilters({ sampleRound: sampleRound ?? undefined })}
              className="boss-filter-select"
            />
            <Select
              allowClear
              placeholder="全部客诉情况"
              value={activeFilters.complaint ?? null}
              options={[
                { label: "有客诉", value: "with" },
                { label: "无客诉", value: "without" }
              ]}
              onChange={(complaint) => patchActiveFilters({
                complaint: complaint as BossActiveFilters["complaint"]
              })}
              className="boss-filter-select"
              aria-label="筛选客诉情况"
            />
            <span className="boss-filter-label">交期</span>
            <Input
              type="date"
              value={activeFilters.deliveryStartDate}
              onChange={(event) => patchActiveFilters({ deliveryStartDate: event.target.value })}
              className="boss-filter-date"
            />
            <Input
              type="date"
              value={activeFilters.deliveryEndDate}
              onChange={(event) => patchActiveFilters({ deliveryEndDate: event.target.value })}
              className="boss-filter-date"
            />
            <Button onClick={resetActiveFilters}>重置</Button>
            <ColumnVisibilityControl
              value={visibleActiveColumnKeys}
              options={[...bossActiveOptionalColumns]}
              standardKeys={defaultBossActiveColumns}
              compactKeys={compactBossActiveColumns}
              onChange={setVisibleActiveColumnKeys}
              className="boss-filter-select"
              ariaLabel="选择活跃订单显示列"
            />
          </div>
          <div ref={activeTableRef} className="boss-order-data-workspace">
          <Table
            rowKey="id"
            size="small"
            className="compact-order-table boss-order-table boss-active-table data-workspace-table"
            columns={activeColumns}
            dataSource={visibleActiveOrders}
            loading={loading}
            pagination={false}
            scroll={{ x: "max-content", y: "100%", scrollToFirstRowOnChange: true }}
            onRow={(order) => ({
              onClick: (event) => {
                const target = event.target as HTMLElement;
                if (target.closest("button, a, input, select, textarea, [role='button'], [role='checkbox']")) return;
                openOrderDetail(order);
              }
            })}
          />
          <Pagination
            className="boss-order-workspace-pagination"
            current={currentActivePage}
            pageSize={activePageSize}
            total={filteredActiveOrders.length}
            showSizeChanger={NON_SEARCHABLE_PAGE_SIZE_CHANGER}
            pageSizeOptions={[10, 20, 50]}
            onChange={(nextPage, nextPageSize) => {
              const changed = nextPageSize !== activePageSize;
              setActivePage(changed ? 1 : nextPage);
              if (changed) {
                setActivePageSize(nextPageSize);
                window.localStorage.setItem("sample-room:boss-active-orders:page-size", String(nextPageSize));
              }
              requestAnimationFrame(() => activeTableRef.current?.querySelector<HTMLElement>(".ant-table-body")?.scrollTo({ top: 0 }));
            }}
          />
          </div>
        </Space>
      </Card>

      <div ref={terminatedSectionRef} className={`terminated-orders-section${terminatedExpanded ? " is-expanded" : ""}`}>
        <Card
          className="section-card boss-terminated-orders-card"
          title={`终止订单（${filteredTerminatedOrders.length}）`}
          extra={
            <Space wrap>
              <Input.Search
                allowClear
                placeholder="搜索终止订单 / 款号 / 客户 / 终止原因"
                value={terminatedKeyword}
                onChange={(event) => updateTerminatedKeyword(event.target.value)}
                onSearch={updateTerminatedKeyword}
                className="boss-terminated-search"
              />
              <Button
                className="terminated-orders-expand-button"
                aria-expanded={terminatedExpanded}
                onClick={() => setTerminatedExpanded((expanded) => !expanded)}
              >
                {terminatedExpanded ? "收起" : "展开"}
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={10} className="full-width">
            <Typography.Text type="secondary">
              终止订单保留完整历史；计划员 Android 手机端不再计入活跃订单，Boss / System Owner 可在此查看详情和恢复。
            </Typography.Text>
            {terminatedExpanded ? (
              <div ref={terminatedTableRef} className="boss-order-data-workspace">
              <Table
                rowKey="id"
                size="small"
                className="compact-order-table boss-order-table boss-terminated-table data-workspace-table"
                columns={terminatedColumns}
                dataSource={visibleTerminatedOrders}
                loading={loading}
                pagination={false}
                tableLayout="fixed"
                scroll={{ x: 1440, y: "100%", scrollToFirstRowOnChange: true }}
              />
              <Pagination
                className="boss-order-workspace-pagination"
                current={currentTerminatedPage}
                pageSize={terminatedPageSize}
                total={filteredTerminatedOrders.length}
                showSizeChanger={NON_SEARCHABLE_PAGE_SIZE_CHANGER}
                pageSizeOptions={[10, 20, 50]}
                onChange={(nextPage, nextPageSize) => {
                  const changed = nextPageSize !== terminatedPageSize;
                  setTerminatedPage(changed ? 1 : nextPage);
                  if (changed) {
                    setTerminatedPageSize(nextPageSize);
                    window.localStorage.setItem("sample-room:boss-terminated-orders:page-size", String(nextPageSize));
                  }
                  requestAnimationFrame(() => terminatedTableRef.current?.querySelector<HTMLElement>(".ant-table-body")?.scrollTo({ top: 0 }));
                }}
              />
              </div>
            ) : null}
          </Space>
        </Card>
      </div>

      <Modal
        title={
          <Space size={8}>
            <span>订单详情</span>
            {detailOrder ? (
              <Button size="small" onClick={() => void loadOrderDetail(detailOrder)}>
                刷新详情
              </Button>
            ) : null}
          </Space>
        }
        open={detailOpen}
        onCancel={closeOrderDetail}
        style={{ top: 24 }}
        width="min(1080px, calc(100vw - 32px))"
        footer={detailOrder ? (
          <Space className="boss-order-detail-footer">
            {detailOrder.terminated ? (
              <Button className="restore-order-button" onClick={() => void restoreOrder(detailOrder)}>
                恢复订单
              </Button>
            ) : (
              <Button
                danger
                disabled={detailOrder.stage === ORDER_STAGES.done || detailOrder.completionStatus === "completed"}
                onClick={() => openTerminate(detailOrder)}
              >
                终止订单
              </Button>
            )}
            <Button onClick={closeOrderDetail}>关闭</Button>
          </Space>
        ) : null}
        styles={{ content: { height: "min(1120px, calc(100dvh - 48px))" } }}
        className="boss-order-detail-modal order-detail-fixed-height-modal"
      >
        <Spin spinning={detailLoading}>
          {detailOrder ? (
            <Space direction="vertical" size={14} className="full-width boss-order-detail-shell">
              <BossOrderSummaryHeader
                order={detailOrder}
                patternTask={detailOrder.patternTask}
                loadPreview={loadOrderAttachmentPreview}
              />

              <Tabs
                activeKey={detailTab}
                onChange={(key) => {
                  setDetailTab(key);
                  if (key === "flow") setDetailFlowPage(1);
                }}
                items={[
                  {
                    key: "attachments",
                    label: `附件资料 ${detailAttachments.length}`,
                    children: renderAttachmentTab()
                  },
                  ...(tabletColumns ? [{
                    key: "attachment-logs",
                    label: `附件日志 ${detailOrder.attachmentLogs?.length ?? 0}`,
                    children: (
                      <div className="order-detail-attachment-log-tab">
                        <AttachmentLogList logs={detailOrder.attachmentLogs ?? []} />
                      </div>
                    )
                  }] : []),
                  {
                    key: "charges",
                    label: `其他费用 ${detailCharges.length}`,
                    children: (
                      <OrderChargeReadOnlyPanel
                        charges={detailCharges}
                        currentUserId={session.userId}
                        canManageAll
                        tabletLayout={tabletColumns}
                        onEdit={async (charge, payload) => {
                          await sampleRoomApi.updateOrderCharge(session, "admin", charge.orderId, charge.id, payload);
                          await refreshDetailCharges(charge.orderId);
                        }}
                        onDelete={async (charge) => {
                          await sampleRoomApi.deleteOrderCharge(session, "admin", charge.orderId, charge.id);
                          await refreshDetailCharges(charge.orderId);
                        }}
                        onAddAttachments={async (charge, attachments) => {
                          await sampleRoomApi.addOrderChargeAttachments(session, "admin", charge.orderId, charge.id, attachments);
                          await refreshDetailCharges(charge.orderId);
                        }}
                        onRenameAttachment={async (charge, attachmentId, displayName) => {
                          await sampleRoomApi.renameOrderChargeAttachment(session, "admin", charge.orderId, charge.id, attachmentId, displayName);
                          await refreshDetailCharges(charge.orderId);
                        }}
                        onDeleteAttachment={async (charge, attachmentId) => {
                          await sampleRoomApi.deleteOrderChargeAttachment(session, "admin", charge.orderId, charge.id, attachmentId);
                          await refreshDetailCharges(charge.orderId);
                        }}
                        loadAttachmentBlob={(attachment) =>
                          sampleRoomApi.downloadAdminOrderAttachment(session, detailOrder.id, attachment.id)
                        }
                      />
                    )
                  },
                  {
                    key: "flow",
                    label: "流程记录",
                    children: renderFlowTab()
                  },
                  {
                    key: "complaints",
                    label: `客诉记录 ${detailComplaints.length}`,
                    children: renderComplaintTab()
                  }
                ]}
              />

            </Space>
          ) : (
            <Empty description="请选择订单查看详情" />
          )}
        </Spin>
      </Modal>

      <Modal
        title="返工瑕疵记录"
        open={Boolean(reworkPhotoRecord)}
        onCancel={() => setReworkPhotoRecord(null)}
        footer={<Button onClick={() => setReworkPhotoRecord(null)}>关闭</Button>}
        width={760}
        centered
        className="boss-rework-photo-modal"
        destroyOnHidden
      >
        <div className="boss-rework-photo-dialog">
          <div className="boss-rework-summary">
            <div className="boss-rework-summary-item">
              <span className="boss-rework-summary-icon"><ClockCircleOutlined /></span>
              <span><Typography.Text type="secondary">返工时间</Typography.Text><strong>{formatTime(reworkPhotoRecord?.time)}</strong></span>
            </div>
            <div className="boss-rework-summary-item">
              <span className="boss-rework-summary-icon"><UserOutlined /></span>
              <span><Typography.Text type="secondary">组检出库员工</Typography.Text><strong>{reworkPhotoRecord?.qcWorkerName || "-"}</strong></span>
            </div>
            <div className="boss-rework-summary-item">
              <span className="boss-rework-summary-icon"><ToolOutlined /></span>
              <span><Typography.Text type="secondary">缝制员工</Typography.Text><strong>{reworkPhotoRecord?.sewingWorkerName || "未关联"}</strong></span>
            </div>
            <div className="boss-rework-summary-item">
              <span className="boss-rework-summary-icon"><InboxOutlined /></span>
              <span><Typography.Text type="secondary">产出</Typography.Text><strong>{reworkPhotoRecord?.pieces !== undefined ? `${reworkPhotoRecord.pieces} 件` : "-"}</strong></span>
            </div>
            <div className="boss-rework-summary-item boss-rework-summary-reason">
              <span className="boss-rework-summary-icon"><FileTextOutlined /></span>
              <span><Typography.Text type="secondary">返工原因</Typography.Text><strong>{reworkPhotoRecord?.reworkReason || "未填写"}</strong></span>
            </div>
          </div>
          <div className="boss-rework-photo-section">
            <Typography.Title level={5}>瑕疵照片</Typography.Title>
          {detailOrder && reworkPhotoRecord?.scanRecordId && reworkPhotoRecord.reworkPhotos?.length ? (
            <Image.PreviewGroup>
              <div className="boss-rework-photo-strip">
                {reworkPhotoRecord.reworkPhotos.map((attachment, index) => (
                  <BossQcReworkPhoto
                    key={attachment.id}
                    attachment={attachment}
                    index={index}
                    load={() => sampleRoomApi.downloadAdminQcReworkPhoto(
                      session,
                      detailOrder.id,
                      reworkPhotoRecord.scanRecordId!,
                      attachment.id
                    )}
                  />
                ))}
              </div>
            </Image.PreviewGroup>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次返工未上传瑕疵照片" />}
          </div>
        </div>
      </Modal>

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
          if (chargeOrder && detailOrderIdRef.current === chargeOrder.id) setDetailCharges(charges);
          void loadOrders();
        }}
      />

      <Modal
        title="登记客诉"
        open={Boolean(complaintOrder)}
        onCancel={() => setComplaintOrder(null)}
        onOk={() => void submitComplaint()}
        okText="确认登记"
        cancelText="取消"
      >
        <Space direction="vertical" size={12} className="full-width">
          <Typography.Text type="secondary">
            客诉将作为独立记录保留，并自动关联该订单最近一次组检/出库完成人员，供后续客诉率统计使用。
          </Typography.Text>
          <Form form={complaintForm} layout="vertical">
            <Form.Item
              label="客诉内容"
              name="description"
              rules={[
                { required: true, whitespace: true, message: "请输入客诉内容" },
                { max: 1000, message: "客诉内容不能超过 1000 个字符" }
              ]}
            >
              <Input.TextArea rows={4} placeholder="记录客户反馈的问题、数量、影响及必要说明" />
            </Form.Item>
          </Form>
        </Space>
      </Modal>

      <Modal title={qcResultOrder && qcResult ? <Space><span>组检结果</span><QcPhotoExportButton order={qcResultOrder} photos={qcResult.photos} loadPhoto={(photo) => sampleRoomApi.downloadAdminQcResultPhoto(session, qcResultOrder.id, photo.id)} /></Space> : "组检结果"} centered width={760} open={Boolean(qcResultOrder)} onCancel={closeQcResult} footer={<Button onClick={closeQcResult}>关闭</Button>}>
        <Spin spinning={qcResultLoading}>
          {!qcResultLoading && !qcResult ? <Empty description="暂无组检结果" /> : qcResult ? <Space direction="vertical" size={18} className="full-width qc-admin-result">
            <Space><Typography.Text type="secondary">{qcResult.qualityResult === "qualified" ? "最终结果" : "当前结果"}</Typography.Text><Tag color={qcResult.qualityResult === "qualified" ? "green" : "orange"}>{qcResult.qualityResult === "qualified" ? "合格并完成" : "需要返工"}</Tag></Space>
            <Descriptions bordered size="small" column={2} items={qcResult.qualityResult === "qualified" ? [
              { key: "score", label: "质量评分", children: qcResult.qualityScore !== undefined ? `${qcResult.qualityScore} 分` : "-" },
              { key: "pieces", label: "检查件数", children: qcResult.pieces !== undefined ? `${qcResult.pieces} 件` : "-" },
              { key: "worker", label: "组检人员", children: qcResult.workerName ?? "-" },
              { key: "time", label: "完成时间", children: formatTime(qcResult.eventTime) },
              { key: "note", label: "最终说明", span: 2, children: qcResult.note || "-" }
            ] : [
              { key: "reason", label: "最新返工原因", span: 2, children: qcResult.note || "-" },
              { key: "pieces", label: "检查件数", children: qcResult.pieces !== undefined ? `${qcResult.pieces} 件` : "-" },
              { key: "worker", label: "登记人", children: qcResult.workerName ?? "-" },
              { key: "time", label: "登记时间", span: 2, children: formatTime(qcResult.eventTime) }
            ]} />
            {qcResult.qualityResult === "rework" ? <div>{qcResult.photos.filter((photo) => photo.category === "qc_issue_photo").length ? <><Typography.Title level={5}>问题照片</Typography.Title><Image.PreviewGroup><Space wrap>{qcResult.photos.filter((photo) => photo.category === "qc_issue_photo").map((photo) => <Image key={photo.id} width={150} height={120} src={`/api/admin/orders/${qcResultOrder!.id}/qc-result/photos/${photo.id}/download`} alt={photo.fileName} />)}</Space></Image.PreviewGroup></> : null}</div> : <>
              <div><Typography.Title level={5}>样衣照片</Typography.Title>{qcResult.photos.some((photo) => photo.category === "qc_sample_photo") ? <Image.PreviewGroup><Space wrap>{qcResult.photos.filter((photo) => photo.category === "qc_sample_photo").map((photo) => <Image key={photo.id} width={150} height={120} src={`/api/admin/orders/${qcResultOrder!.id}/qc-result/photos/${photo.id}/download`} alt={photo.fileName} />)}</Space></Image.PreviewGroup> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无样衣照片" />}</div>
              <div><Typography.Title level={5}>尺寸表照片</Typography.Title>{qcResult.photos.some((photo) => photo.category === "qc_measurement_photo") ? <Image.PreviewGroup><Space wrap>{qcResult.photos.filter((photo) => photo.category === "qc_measurement_photo").map((photo) => <Image key={photo.id} width={150} height={120} src={`/api/admin/orders/${qcResultOrder!.id}/qc-result/photos/${photo.id}/download`} alt={photo.fileName} />)}</Space></Image.PreviewGroup> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无尺寸表照片" />}</div>
            </>}
          </Space> : null}
        </Spin>
      </Modal>

      <Modal
        title="终止订单"
        open={Boolean(terminatingOrder)}
        onCancel={() => setTerminatingOrder(null)}
        onOk={() => void submitTerminate()}
        okText="确认终止"
        okButtonProps={{ danger: true }}
        cancelText="取消"
      >
        <Space direction="vertical" size={12} className="full-width">
          <Typography.Text>
            订单不会删除；已有费用、扫码、附件记录会保留；计划员 Android 手机端会从活跃订单与阶段统计中移除该订单，Boss / System Owner 仍可查看和恢复。
          </Typography.Text>
          <Form form={form} layout="vertical">
            <Form.Item label="终止原因（可选）" name="reason">
              <Input.TextArea rows={3} placeholder="说明终止原因，便于后续恢复或核算" />
            </Form.Item>
          </Form>
        </Space>
      </Modal>

    </div>
  );
}
