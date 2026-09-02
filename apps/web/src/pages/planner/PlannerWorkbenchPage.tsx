import {
  CalendarOutlined,
  CarryOutOutlined,
  CheckCircleFilled,
  FileDoneOutlined,
  FileTextOutlined,
  ScissorOutlined,
  SettingOutlined,
  WarningFilled,
} from "@ant-design/icons";
import {
  ORDER_STAGES,
  MATERIAL_STATUS_LABELS,
  orderStageOptions,
  parseOrderQrPayload,
  sampleRequestItemOptions,
  sampleRoundOptions,
} from "@sample-room/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Pagination,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  sampleRoomApi,
  type OrderChargeRecord,
  type PlannerOrder
} from "../../api/sampleRoomApi";
import { useDevSession } from "../../app/DevSessionContext";
import { useSampleTypeOptions } from "../../app/SampleTypeOptionsContext";
import { NON_SEARCHABLE_PAGE_SIZE_CHANGER } from "../../components/tablet/pagination";
import {
  getQuickDateRange,
  type QuickDateRange,
} from "../../components/orders/orderFilters";
import {
  AttachmentLogList,
  UnifiedAttachmentTable
} from "../../components/attachments/UnifiedAttachmentTable";
import { OrderAttachmentPanel } from "../../components/attachments/OrderAttachmentPanel";
import { isSafeAttachmentPreviewMime } from "../../components/attachments/attachmentPreview";
import { OrderCompletionTag } from "../../components/operations/OrderCompletionStatus";
import { ParallelProgress } from "../../components/operations/ParallelProgress";
import { PatternTaskStatusBadges } from "../../components/operations/PatternTaskStatusBadges";
import { ReceiverOrderChargeModal } from "../../components/orders/ReceiverOrderChargeModal";
import { getOrderThumbnailAttachment } from "../../components/orders/orderThumbnail";
import { formatEntryDate } from "../../components/orders/orderDisplay";
import { OrderChargeReadOnlyPanel } from "../../components/orders/OrderChargeReadOnlyPanel";
import { OrderTable } from "../../components/OrderTable";
import { downloadBlob } from "../../utils/downloadBlob";
import { MobileScanChargePanel } from "../../components/orders/MobileScanChargePanel";
import {
  isNormalQcCompletion,
  scanRecordNoteLabel,
  scanRecordQualityScoreLabel,
  scanRecordTitle
} from "../../components/scan/scanDisplay";
import { TabletWorkbenchHeader } from "../../components/tablet/TabletWorkbenchHeader";
import { useVisibleAutoRefresh } from "../../hooks/useVisibleAutoRefresh";
import {
  requestNativeOrderScan,
  subscribeToNativeOrderScans
} from "../qc/tabletNativeBridge";
import { PlannerCollaborationDialog } from "./PlannerCollaborationDialog";

type PlannerWorkbenchPageProps = {
  mobile?: boolean;
  tablet?: boolean;
};

type PlannerTabKey = "all" | "doing" | "waiting" | "in-progress" | "completed" | "scan-charge";

type PlannerFilters = {
  keyword: string;
  stage?: string | undefined;
  sampleType?: string | undefined;
  sampleRound?: string | undefined;
  customerName?: string | undefined;
  salespersonName?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  quickDateRange?: QuickDateRange | undefined;
};

type PlannerCollaborationSummary = {
  completedPieces: number;
  plannedPieces: number;
  unallocatedPieces: number;
  activeParticipantCount: number;
  effectiveParticipantCount: number;
  sewingGateSatisfied: boolean;
  participants: Array<{ id: string; workerName: string; status: string }>;
};

type PlannerOrderWithCollaboration = PlannerOrder & {
  sewingMode?: "single" | "collaboration";
  sewingCollaboration?: PlannerCollaborationSummary;
};

const defaultPlannerFilters: PlannerFilters = {
  keyword: "",
  ...getQuickDateRange("month"),
  quickDateRange: "month",
};

function isCollaborationOrder(order: PlannerOrder) {
  return (order as PlannerOrderWithCollaboration).sewingMode === "collaboration";
}

function plannerCollaboration(order: PlannerOrder) {
  return (order as PlannerOrderWithCollaboration).sewingCollaboration;
}

function collaborationPerformanceNeedsReview(order: PlannerOrder) {
  const collaboration = plannerCollaboration(order);
  return Boolean(
    collaboration &&
    collaboration.completedPieces >= order.quantity &&
    collaboration.activeParticipantCount > 0
  );
}

function collaborationParticipantNames(order: PlannerOrder) {
  return plannerCollaboration(order)?.participants
    .filter((participant) => participant.status === "active" || participant.status === "completed")
    .map((participant) => participant.workerName) ?? [];
}

function plannerSewingStatus(order: PlannerOrder) {
  if (!isCollaborationOrder(order)) {
    return order.stage === ORDER_STAGES.sewingWaiting ? "待缝制" : "缝制中";
  }
  const collaboration = plannerCollaboration(order);
  if (!collaboration) {
    return order.stage === ORDER_STAGES.sewingWaiting ? "待缝制" : "缝制中";
  }
  if (collaboration.activeParticipantCount > 0) return "缝制中";
  return "缝制完成";
}

function isSewingDoing(order: PlannerOrder) {
  return !order.terminated &&
    (order.stage === ORDER_STAGES.sewingWaiting || order.stage === ORDER_STAGES.sewingDoing);
}

function isSewingWaiting(order: PlannerOrder) {
  return !order.terminated && order.stage === ORDER_STAGES.sewingWaiting;
}

function isSewingInProgress(order: PlannerOrder) {
  return !order.terminated && order.stage === ORDER_STAGES.sewingDoing;
}

function plannerMaterialStatusTag(value: string) {
  const normalizedValue =
    Object.entries(MATERIAL_STATUS_LABELS).find(([, label]) => label === value)?.[0] ?? value;
  const color =
    normalizedValue === "complete" ? "green" : normalizedValue === "partial" ? "orange" : "red";
  return <Tag color={color}>{MATERIAL_STATUS_LABELS[value as keyof typeof MATERIAL_STATUS_LABELS] ?? value}</Tag>;
}

function plannerOrderSourceLabel(order: PlannerOrder) {
  if (order.sourceType === "client_submission") return "客户提交";
  if (order.sourceType === "receiver_self_entry") return "接单员录入";
  if (order.sourceType === "internal_manual") return "内部录入";
  return "－";
}

function plannerOrderCreatorLabel(order: PlannerOrder) {
  return order.createdByName ?? "－";
}

function getLocalDateKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function labelFrom(
  options: Array<{ label: string; value: string }>,
  value: string | undefined,
) {
  return (
    options.find((option) => option.value === value)?.label ?? value ?? "-"
  );
}

function sampleRoundLabel(value: string) {
  return labelFrom(sampleRoundOptions, value);
}

function matchesPlannerFilters(order: PlannerOrder, filters: PlannerFilters) {
  const keyword = filters.keyword.trim().toLowerCase();
  if (
    keyword &&
    ![
      order.styleNo,
      order.styleName,
      order.orderNo,
      order.customerName,
      order.salespersonName,
      order.remark,
    ]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(keyword))
  ) {
    return false;
  }

  if (filters.stage && order.stage !== filters.stage) {
    return false;
  }

  if (filters.sampleType && order.sampleType !== filters.sampleType) {
    return false;
  }

  if (filters.sampleRound && order.sampleRound !== filters.sampleRound) {
    return false;
  }

  if (filters.customerName && order.customerName !== filters.customerName) {
    return false;
  }

  if (
    filters.salespersonName &&
    order.salespersonName !== filters.salespersonName
  ) {
    return false;
  }

  if (!matchesCreatedDateRange(order, filters)) {
    return false;
  }

  return true;
}

function formatDate(value: string | undefined) {
  return value ? value.slice(0, 10) : "-";
}

function dateKey(value: string | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function matchesCreatedDateRange(order: PlannerOrder, filters: PlannerFilters) {
  if (!filters.startDate && !filters.endDate) {
    return true;
  }

  const createdDate = dateKey(order.createdAt);
  if (filters.startDate && createdDate < filters.startDate) {
    return false;
  }

  if (filters.endDate && createdDate > filters.endDate) {
    return false;
  }

  return true;
}

function uniquePlannerOptions(
  orders: PlannerOrder[],
  selector: (order: PlannerOrder) => string | undefined,
) {
  return Array.from(
    new Set(
      orders
        .map(selector)
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  )
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((value) => ({ label: value, value }));
}

function PlannerOrderThumbnail({
  order,
  session,
  variant = "legacy"
}: {
  order: PlannerOrder;
  session: ReturnType<typeof useDevSession>["session"];
  variant?: "legacy" | "table" | "detail";
}) {
  const attachment = order.attachments?.find((item) => item.category === "style_thumbnail" && item.hasFile)
    ?? order.attachments?.find((item) => item.mimeType.startsWith("image/") && item.hasFile);
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setUrl(undefined);
    if (attachment) {
      void sampleRoomApi.downloadPlannerOrderAttachment(session, order.id, attachment.id).then((blob) => {
        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      }).catch(() => setUrl(undefined));
    } else {
      setUrl(undefined);
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment?.id, order.id, session]);

  return (
    <span
      className={`planner-order-thumbnail planner-order-thumbnail-${variant}`}
      aria-label="款式缩略图"
    >
      {url ? <img src={url} alt={order.styleNo} /> : <span>图</span>}
    </span>
  );
}

export function PlannerWorkbenchPage({
  mobile = false,
  tablet = false,
}: PlannerWorkbenchPageProps) {
  const { session } = useDevSession();
  const { options: sampleTypeOptions, labelFor: sampleTypeLabel } = useSampleTypeOptions();
  const [searchParams] = useSearchParams();
  const scanToken = searchParams.get("scanToken") ?? undefined;
  const [messageApi, contextHolder] = message.useMessage();
  const blockTerminatedOrder = (order: PlannerOrder) => {
    if (!order.terminated) return false;
    messageApi.info("订单已终止");
    return true;
  };
  const [orders, setOrders] = useState<PlannerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PlannerTabKey>("all");
  const [filters, setFilters] = useState<PlannerFilters>(defaultPlannerFilters);
  const [selectedOrder, setSelectedOrder] = useState<PlannerOrder>();
  const [chargeOrder, setChargeOrder] = useState<PlannerOrder>();
  const [collaborationOrder, setCollaborationOrder] = useState<PlannerOrder>();
  const [tabletScannedChargeOrder, setTabletScannedChargeOrder] = useState<PlannerOrder>();
  const [chargesByOrder, setChargesByOrder] = useState<Record<string, OrderChargeRecord[]>>({});
  const [tabletScanLoading, setTabletScanLoading] = useState(false);
  const [doingPage, setDoingPage] = useState(1);
  const [waitingPage, setWaitingPage] = useState(1);
  const [doingPageSize, setDoingPageSize] = useState(() => {
    const stored = Number(window.localStorage.getItem("sample-room:planner-doing-orders:page-size"));
    return Number.isInteger(stored) && stored > 0 ? stored : 10;
  });

  useEffect(() => {
    if (mobile && scanToken) setActiveTab("scan-charge");
  }, [mobile, scanToken]);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const orderResult = await sampleRoomApi.listPlannerOrders(session);
      setOrders(orderResult.orders);
    } catch (error) {
      if (!silent) void messageApi.error(
        error instanceof Error ? error.message : "加载计划员数据失败",
      );
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.userId, session.role]);

  useVisibleAutoRefresh(() => loadData(true));

  const resolveTabletScan = useCallback(async (payload: string) => {
    setTabletScanLoading(true);
    try {
      const token = parseOrderQrPayload(payload).token;
      const context = await sampleRoomApi.getMobileScanChargeContext(session, "planner", token);
      let order = orders.find((candidate) => candidate.id === context.order.id);
      if (!order) {
        const refreshed = await sampleRoomApi.listPlannerOrders(session);
        setOrders(refreshed.orders);
        order = refreshed.orders.find((candidate) => candidate.id === context.order.id);
      }
      if (!order) throw new Error("已定位订单，但计划员订单列表中未找到该订单。")
      if (order.terminated) {
        messageApi.info("订单已终止");
        return;
      }
      setChargesByOrder((current) => ({ ...current, [order.id]: context.charges }));
      setTabletScannedChargeOrder(order);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "订单二维码读取失败");
    } finally {
      setTabletScanLoading(false);
    }
  }, [messageApi, orders, session]);

  useEffect(() => {
    if (!tablet) return undefined;
    return subscribeToNativeOrderScans((payload) => { void resolveTabletScan(payload); });
  }, [resolveTabletScan, tablet]);

  const startTabletScan = () => {
    if (!requestNativeOrderScan()) {
      messageApi.warning("请在样品间 Pad APK 中使用原生扫码。");
    }
  };

  const doingOrders = useMemo(() => orders.filter(isSewingDoing), [orders]);
  const waitingOrders = useMemo(() => orders.filter(isSewingWaiting), [orders]);
  const inProgressOrders = useMemo(() => orders.filter(isSewingInProgress), [orders]);
  const todayDateKey = useMemo(() => getLocalDateKey(), []);
  const plannerOverviewStats = useMemo(
    () => [
      {
        label: "待校正",
        value: orders.filter((order) => order.stage === null).length,
        tone: "orange",
        icon: <FileDoneOutlined />,
      },
      {
        label: "已接单",
        value: orders.length,
        tone: "green",
        icon: <CarryOutOutlined />,
      },
      {
        label: "待制版",
        value: orders.filter(
          (order) => order.stage === ORDER_STAGES.patternWaiting,
        ).length,
        tone: "purple",
        icon: <FileTextOutlined />,
      },
      {
        label: "待裁剪",
        value: orders.filter(
          (order) => order.stage === ORDER_STAGES.cuttingWaiting,
        ).length,
        tone: "orange",
        icon: <ScissorOutlined />,
      },
      {
        label: "生产中",
        value: orders.filter(
          (order) =>
            order.stage === ORDER_STAGES.patternDoing ||
            order.stage === ORDER_STAGES.cuttingDoing ||
            order.stage === ORDER_STAGES.sewingWaiting ||
            order.stage === ORDER_STAGES.sewingDoing ||
            order.stage === ORDER_STAGES.qcDeliveryWaiting,
        ).length,
        tone: "blue",
        icon: <SettingOutlined />,
      },
      {
        label: "今日交期",
        value: orders.filter((order) => dateKey(order.deliveryDate) === todayDateKey).length,
        tone: "blue",
        featured: true,
        icon: <CalendarOutlined />,
      },
      {
        label: "异常待处理",
        value: orders.filter(
          (order) =>
            order.completionStatus !== "completed" &&
            dateKey(order.deliveryDate) < todayDateKey,
        ).length,
        tone: "red",
        featured: true,
        icon: <WarningFilled />,
      },
      {
        label: "已完成",
        value: orders.filter((order) => order.completionStatus === "completed").length,
        tone: "green",
        icon: <CheckCircleFilled />,
      },
    ],
    [orders, todayDateKey],
  );
  const filteredAllOrders = useMemo(
    () => orders.filter((order) => matchesPlannerFilters(order, filters)),
    [filters, orders],
  );
  const filteredDoingOrders = useMemo(
    () =>
      doingOrders.filter((order) =>
        matchesPlannerFilters(order, {
          ...filters,
          stage: undefined,
        }),
      ),
    [doingOrders, filters],
  );
  const filteredWaitingOrders = useMemo(
    () => waitingOrders.filter((order) => matchesPlannerFilters(order, { ...filters, stage: undefined })),
    [filters, waitingOrders]
  );
  const filteredInProgressOrders = useMemo(
    () => inProgressOrders.filter((order) => matchesPlannerFilters(order, { ...filters, stage: undefined })),
    [filters, inProgressOrders]
  );
  const filteredCompletedOrders = useMemo(
    () => orders
      .filter((order) => order.completionStatus === "completed")
      .filter((order) => matchesPlannerFilters(order, { ...filters, stage: undefined })),
    [filters, orders]
  );
  const customerOptions = useMemo(
    () => uniquePlannerOptions(orders, (order) => order.customerName),
    [orders],
  );
  const salespersonOptions = useMemo(
    () =>
      uniquePlannerOptions(
        filters.customerName
          ? orders.filter(
              (order) => order.customerName === filters.customerName,
            )
          : orders,
        (order) => order.salespersonName,
      ),
    [filters.customerName, orders],
  );
  const setFilter = <K extends keyof PlannerFilters>(
    key: K,
    value: PlannerFilters[K],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const setQuickDateRange = (quickDateRange: QuickDateRange) => {
    setFilters((current) => ({
      ...current,
      ...getQuickDateRange(quickDateRange),
      quickDateRange,
    }));
  };

  const openPlannerOrder = (order: PlannerOrder) => {
    if (blockTerminatedOrder(order)) return;
    setSelectedOrder(order);
    void sampleRoomApi.listOrderCharges(session, "planner", order.id)
      .then((result) => setChargesByOrder((current) => ({ ...current, [order.id]: result.charges })))
      .catch((error) => messageApi.error(error instanceof Error ? error.message : "费用记录加载失败"));
  };

  const closePlannerOrder = () => {
    setSelectedOrder(undefined);
  };

  const openCollaborationDialog = (order: PlannerOrder) => {
    if (blockTerminatedOrder(order)) return;
    setCollaborationOrder(order);
  };

  const openChargeDialog = async (order: PlannerOrder) => {
    if (blockTerminatedOrder(order)) return;
    setChargeOrder(order);
    try {
      const result = await sampleRoomApi.listOrderCharges(session, "planner", order.id);
      setChargesByOrder((current) => ({ ...current, [order.id]: result.charges }));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "费用记录加载失败");
    }
  };

  const openDownloadedAttachment = async (load: () => Promise<Blob>, fileName: string) => {
    const target = window.open("", "_blank");
    if (!target) {
      messageApi.warning("浏览器阻止了打开附件，请允许本站打开新窗口");
      return;
    }
    target.document.title = fileName;
    target.document.body.textContent = "正在加载附件预览…";
    try {
      const blob = await load();
      if (!isSafeAttachmentPreviewMime(blob.type)) {
        target.close();
        messageApi.info("当前附件仅支持下载。");
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      target.location.replace(objectUrl);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      target.close();
      messageApi.error(error instanceof Error ? error.message : "附件预览失败");
    }
  };

  const renderStage = (order: PlannerOrder) => (
    order.terminated ? <Tag color="red">已终止</Tag> : (
      <OrderCompletionTag
        sampleRequestItems={order.sampleRequestItems ?? []}
        stage={order.stage}
        stageLabel={order.stageLabel}
        {...(order.completionStatus ? { completionStatus: order.completionStatus } : {})}
        {...(order.patternTask ? { patternTask: order.patternTask } : {})}
      />
    )
  );

  const renderSewingWorker = (order: PlannerOrder) => {
    const names = collaborationParticipantNames(order);
    return isCollaborationOrder(order) ? (
      <Tooltip title={names.join("、")}><Tag color="blue">多人</Tag></Tooltip>
    ) : order.activeWorker?.stage === "sewing" ? (
      <Typography.Text>{order.activeWorker.workerName}</Typography.Text>
    ) : (
      <Typography.Text type="secondary">-</Typography.Text>
    );
  };

  const customerContextColumn: ColumnsType<PlannerOrder>[number] = {
    title: "客户 / 业务员",
    key: "customerContext",
    width: 180,
    render: (_value, order) => (
      <div className="planner-order-customer-line">
        <Typography.Text strong>{order.customerName}</Typography.Text>
        <Typography.Text type="secondary">业务员：{order.salespersonName}</Typography.Text>
      </div>
    )
  };

  const quantityColumn: ColumnsType<PlannerOrder>[number] = {
    title: "件数",
    key: "quantity",
    dataIndex: "quantity",
    width: 72,
    render: (value) => <Typography.Text>{value}</Typography.Text>,
  };

  const sampleTypeColumn: ColumnsType<PlannerOrder>[number] = {
    title: "样品类型",
    key: "sampleType",
    dataIndex: "sampleType",
    width: 96,
    render: (value) => <Tag>{sampleTypeLabel(value)}</Tag>,
  };

  const sampleRoundColumn: ColumnsType<PlannerOrder>[number] = {
    title: "轮次",
    key: "sampleRound",
    dataIndex: "sampleRound",
    width: 86,
    render: (value) => <Tag>{sampleRoundLabel(value)}</Tag>,
  };

  const patternTaskColumn: ColumnsType<PlannerOrder>[number] = {
    title: "版师任务",
    key: "patternTask",
    width: 170,
    render: (_value, order) => (
      <PatternTaskStatusBadges
        sampleRequestItems={order.sampleRequestItems ?? []}
        patternTask={order.patternTask}
        maxRows={2}
      />
    )
  };

  const plannerListActions = (order: PlannerOrder) => order.terminated ? (
    <Button danger size="small" onClick={(event) => {
      event.stopPropagation();
      blockTerminatedOrder(order);
    }}>已终止</Button>
  ) : (
    <Space direction="vertical" size={4} className="planner-order-actions">
      {isCollaborationOrder(order) && isSewingDoing(order) && (plannerCollaboration(order)?.participants.length ?? 0) > 0 ? (
        <Button
          size="small"
          type="primary"
          onClick={(event) => {
            event.stopPropagation();
            openCollaborationDialog(order);
          }}
        >
          协作分配
        </Button>
      ) : null}
      <Button
        size="small"
        onClick={(event) => {
          event.stopPropagation();
          openPlannerOrder(order);
        }}
      >
        查看详情
      </Button>
      <Button
        size="small"
        onClick={(event) => {
          event.stopPropagation();
          void openChargeDialog(order);
        }}
      >
        其他费用 {order.chargeCount ?? 0}
      </Button>
    </Space>
  );

  const operationColumn: ColumnsType<PlannerOrder>[number] = {
    title: "操作",
    key: "actions",
    width: 112,
    fixed: "right",
    render: (_value, order) => plannerListActions(order)
  };

  const plannerOrderTitleCell = (order: PlannerOrder) => (
    <div className="order-title-cell-with-thumbnail">
      {order.terminated
        ? <Tag color="red">已终止</Tag>
        : <PlannerOrderThumbnail order={order} session={session} variant="table" />}
      <Space direction="vertical" size={2} className="order-title-cell-content">
        <Space size={4} wrap>
          <Typography.Text strong className="order-title-style-no">
            {order.styleNo}
          </Typography.Text>
          {isCollaborationOrder(order) ? (
            <Tooltip title={collaborationParticipantNames(order).join("、")}>
              <Tag color="blue">协作</Tag>
            </Tooltip>
          ) : null}
          {collaborationPerformanceNeedsReview(order) ? <Tag color="orange">绩效数量待确认</Tag> : null}
        </Space>
        <Typography.Text type="secondary">{order.styleName}</Typography.Text>
        <Typography.Text type="secondary" className="order-title-meta">
          录入：{formatEntryDate(order.createdAt)} / 交期：{order.deliveryDate}
        </Typography.Text>
      </Space>
    </div>
  );

  const plannerCustomerContext = (order: PlannerOrder) => (
    <div className="order-customer-context-cell">
      <Typography.Text strong>{order.customerName}</Typography.Text>
      <Typography.Text type="secondary">{order.salespersonName}</Typography.Text>
    </div>
  );

  const sewingColumns: ColumnsType<PlannerOrder> = [
    {
      title: "款式 / 款号",
      key: "style",
      width: 280,
      render: (_value, order) => plannerOrderTitleCell(order),
    },
    customerContextColumn,
    quantityColumn,
    sampleTypeColumn,
    sampleRoundColumn,
    patternTaskColumn,
    {
      title: "缝制人员",
      key: "assignment",
      render: (_value, order) => renderSewingWorker(order),
      width: 128,
    },
    {
      title: "接手时间",
      key: "sewingStartedAt",
      render: (_value, order) =>
        order.activeWorker?.stage === "sewing"
          ? formatDate(order.activeWorker.startedAt)
          : "-",
      width: 108,
    },
    operationColumn,
  ];

  const renderOverview = () => (
    <Card className="planner-overview-card">
      <div className="planner-overview-layout">
        {!tablet ? <div className="planner-overview-copy">
          <Typography.Text type="secondary">
            {mobile ? "计划员手机任务间" : "计划员任务间"}
          </Typography.Text>
          <Typography.Title level={4}>
            {mobile ? "计划员手机端" : "计划员工作台"}
          </Typography.Title>
          <Typography.Text type="secondary">
            先看交期与异常，再按订单筛选明细。
          </Typography.Text>
        </div> : null}
        <div className="planner-overview-stats" aria-label="计划员订单状态总览">
          {plannerOverviewStats.map((item) => (
            <div
              className={`planner-overview-stat planner-overview-stat-${item.tone}${
                item.featured ? " planner-overview-stat-featured" : ""
              }`}
              key={item.label}
            >
              <span className="planner-overview-stat-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="planner-overview-stat-copy">
                <Typography.Text type="secondary">{item.label}</Typography.Text>
                <Typography.Text strong>{item.value}</Typography.Text>
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );

  const renderFilters = () => (
    <Card size="small" className="planner-filter-card">
      <div className="planner-filter-grid">
        <Input.Search
          allowClear
          className="planner-filter-keyword"
          placeholder="搜款号 / 款名 / 客户 / 业务员 / 备注"
          value={filters.keyword}
          onChange={(event) => setFilter("keyword", event.target.value)}
        />
        <Select
          allowClear
          className="planner-filter-select"
          placeholder="全部客户"
          value={filters.customerName ?? null}
          onChange={(value) => {
            setFilters((current) => ({
              ...current,
              customerName: value ?? undefined,
              salespersonName: undefined,
            }));
          }}
          options={customerOptions}
        />
        <Select
          allowClear
          className="planner-filter-select"
          placeholder="全部业务员"
          value={filters.salespersonName ?? null}
          onChange={(value) => setFilter("salespersonName", value ?? undefined)}
          options={salespersonOptions}
        />
        {activeTab === "all" ? (
          <Select
            className="planner-filter-select"
            value={filters.stage ?? ""}
            onChange={(value) => setFilter("stage", value || undefined)}
            options={[
              { label: "全部状态", value: "" },
              ...orderStageOptions.map((option) => ({
                label: option.label,
                value: option.value,
              })),
            ]}
          />
        ) : null}
        <Select
          className="planner-filter-select"
          value={filters.sampleType ?? ""}
          onChange={(value) => setFilter("sampleType", value || undefined)}
          options={[{ label: "全部样衣类型", value: "" }, ...sampleTypeOptions]}
        />
        <Select
          className="planner-filter-select"
          value={filters.sampleRound ?? ""}
          onChange={(value) => setFilter("sampleRound", value || undefined)}
          options={[{ label: "全部轮次", value: "" }, ...sampleRoundOptions]}
        />
        <Space.Compact className="planner-date-shortcuts">
          <Button
            autoInsertSpace={false}
            type={filters.quickDateRange === "week" ? "primary" : "default"}
            onClick={() => setQuickDateRange("week")}
          >
            <span>本周</span>
          </Button>
          <Button
            autoInsertSpace={false}
            type={filters.quickDateRange === "month" ? "primary" : "default"}
            onClick={() => setQuickDateRange("month")}
          >
            <span>本月</span>
          </Button>
          <Button
            autoInsertSpace={false}
            type={filters.quickDateRange === "quarter" ? "primary" : "default"}
            onClick={() => setQuickDateRange("quarter")}
          >
            <span>近三月</span>
          </Button>
        </Space.Compact>
        <span className="planner-date-label">自定义时间</span>
        <Input
          type="date"
          className="planner-filter-date"
          value={filters.startDate ?? ""}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              startDate: event.target.value || undefined,
              quickDateRange: undefined,
            }))
          }
        />
        <Input
          type="date"
          className="planner-filter-date"
          value={filters.endDate ?? ""}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              endDate: event.target.value || undefined,
              quickDateRange: undefined,
            }))
          }
        />
        <Button onClick={() => setFilters(defaultPlannerFilters)}>
          重置筛选
        </Button>
        <Typography.Text type="secondary">
          当前显示{" "}
          {activeTab === "all"
            ? filteredAllOrders.length
            : activeTab === "waiting"
              ? filteredWaitingOrders.length
              : activeTab === "in-progress"
                ? filteredInProgressOrders.length
                : activeTab === "completed"
                  ? filteredCompletedOrders.length
                : activeTab === "doing" ? filteredDoingOrders.length : 0}{" "}
          单
        </Typography.Text>
      </div>
    </Card>
  );

  const renderMobileList = (items: PlannerOrder[], variant: "all" | "doing") => {
    if (items.length === 0) {
      return <Empty description="暂无订单" />;
    }

    return (
      <Space direction="vertical" size={12} className="planner-mobile-list">
        {items.map((order) => {
          const collaboration = plannerCollaboration(order);
          return (
            <Card key={order.id} size="small" className="planner-mobile-card" onClick={() => void openPlannerOrder(order)}>
              <Space direction="vertical" size={8} className="full-width">
                <Space align="start" className="planner-card-title">
                  <div className="planner-mobile-info-block">
                    <Typography.Text type="secondary">款式 / 款号</Typography.Text>
                    <Space size={4} wrap>
                      <Typography.Text strong>{order.styleName}</Typography.Text>
                      {isCollaborationOrder(order) ? <Tag color="blue">协作</Tag> : null}
                      {collaborationPerformanceNeedsReview(order) ? <Tag color="orange">绩效数量待确认</Tag> : null}
                    </Space>
                    <Typography.Text type="secondary">款号：{order.styleNo}</Typography.Text>
                  </div>
                  {variant === "all" ? renderStage(order) : null}
                </Space>
                <div>
                  样衣：{sampleTypeLabel(order.sampleType)} /{" "}
                  {sampleRoundLabel(order.sampleRound)}
                </div>
                <div>件数：{order.quantity}</div>
                <div className="planner-mobile-info-block">
                  <Typography.Text type="secondary">客户 / 业务员</Typography.Text>
                  <Typography.Text>{order.customerName}</Typography.Text>
                  <Typography.Text type="secondary">业务员：{order.salespersonName}</Typography.Text>
                </div>
                <div>交期：{order.deliveryDate}</div>
                {variant === "doing" ? (
                  <Space direction="vertical" size={2} className="full-width">
                    <div>生产状态：{plannerSewingStatus(order)}</div>
                    <div>进入缝制：{order.activeWorker?.stage === "sewing" ? formatDate(order.activeWorker.startedAt) : "-"}</div>
                    <div>缝制员工：{isCollaborationOrder(order) ? "多人" : order.activeWorker?.stage === "sewing" ? order.activeWorker.workerName : "-"}</div>
                    {collaboration ? (
                      <Typography.Text type="secondary">
                        计划分配 {collaboration.plannedPieces} 件 · 已申报绩效 {collaboration.completedPieces} 件 · 进行中 {collaboration.activeParticipantCount} 人
                      </Typography.Text>
                    ) : null}
                    {isCollaborationOrder(order) && (collaboration?.participants.length ?? 0) > 0 ? (
                      <Button
                        type="primary"
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
                          openCollaborationDialog(order);
                        }}
                      >
                        协作分配
                      </Button>
                    ) : null}
                  </Space>
                ) : null}
              </Space>
            </Card>
          );
        })}
      </Space>
    );
  };

  const renderOrderView = (
    items: PlannerOrder[],
    columns: ColumnsType<PlannerOrder>,
    variant: "waiting" | "doing",
  ) => {
    if (mobile) return renderMobileList(items, "doing");
    const page = variant === "waiting" ? waitingPage : doingPage;
    const setPage = variant === "waiting" ? setWaitingPage : setDoingPage;
    const pageCount = Math.max(1, Math.ceil(items.length / doingPageSize));
    const currentPage = Math.min(page, pageCount);
    const visibleItems = items.slice(
      (currentPage - 1) * doingPageSize,
      currentPage * doingPageSize
    );
    const changePage = (nextPage: number, nextPageSize: number) => {
      const pageSizeChanged = nextPageSize !== doingPageSize;
      setPage(pageSizeChanged ? 1 : nextPage);
      if (pageSizeChanged) {
        setDoingPageSize(nextPageSize);
        window.localStorage.setItem("sample-room:planner-doing-orders:page-size", String(nextPageSize));
      }
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".planner-doing-data-workspace .ant-table-body")?.scrollTo({ top: 0 }));
    };

    return (
      <div className={`planner-doing-data-workspace planner-sewing-${variant}-workspace`}>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={visibleItems}
        pagination={false}
        size="small"
        tableLayout="fixed"
        scroll={{ x: 1200, y: "100%", scrollToFirstRowOnChange: true }}
        className="order-scroll-table planner-order-table planner-dense-table data-workspace-table"
        onRow={(order) => ({ onClick: () => void openPlannerOrder(order) })}
      />
      <Pagination
        className="planner-doing-pagination"
        current={currentPage}
        pageSize={doingPageSize}
        total={items.length}
        showSizeChanger={NON_SEARCHABLE_PAGE_SIZE_CHANGER}
        pageSizeOptions={[10, 20, 50]}
        onChange={changePage}
      />
      </div>
    );
  };

  const renderReceiverStyleOrderView = (items: PlannerOrder[]) =>
    mobile ? (
      renderMobileList(items, "all")
    ) : (
      <div className="receiver-list-panel receiver-full-list-panel planner-receiver-style-order-list">
        <Typography.Text type="secondary" className="receiver-list-hint">
          单击订单行打开订单详情；计划员仅提供查看详情和追加费用操作。
        </Typography.Text>
        <OrderTable
          orders={items}
          loading={loading}
          compact
          pageSize={10}
          showPageSizeChanger
          workspace
          pageSizeStorageKey="sample-room:planner-orders:page-size"
          scrollX={1260}
          actions={plannerListActions}
          titleCellRender={plannerOrderTitleCell}
          customerContextRender={plannerCustomerContext}
          intakeStatusRender={() => <Tag color="success">已接单</Tag>}
          fabricStatusRender={(order) => plannerMaterialStatusTag(order.fabricStatus)}
          trimStatusRender={(order) => plannerMaterialStatusTag(order.trimStatus)}
          onOrderClick={openPlannerOrder}
          rowClassName={(order) =>
            order.id === selectedOrder?.id ? "receiver-order-row-selected" : ""
          }
        />
      </div>
    );

  const renderSewingBoard = () => mobile ? (
    renderMobileList(filteredDoingOrders, "doing")
  ) : (
    <div className="planner-sewing-board">
      <Card size="small" title={`待缝制（${filteredWaitingOrders.length}）`}>
        {renderOrderView(filteredWaitingOrders, sewingColumns, "waiting")}
      </Card>
      <Card size="small" title={`缝制中（${filteredInProgressOrders.length}）`}>
        {renderOrderView(filteredInProgressOrders, sewingColumns, "doing")}
      </Card>
    </div>
  );

  const selectDesktopView = (key: PlannerTabKey) => {
    setActiveTab(key);
    setFilters((current) => ({ ...current, stage: undefined }));
  };

  const desktopMetricCards = [
    { key: "all" as const, label: "全部订单", value: filteredAllOrders.length, icon: <FileDoneOutlined />, tone: "orange" },
    { key: "waiting" as const, label: "待缝制", value: filteredWaitingOrders.length, icon: <FileTextOutlined />, tone: "purple" },
    { key: "in-progress" as const, label: "缝制中", value: filteredInProgressOrders.length, icon: <SettingOutlined />, tone: "blue" },
    { key: "completed" as const, label: "已完成", value: filteredCompletedOrders.length, icon: <CheckCircleFilled />, tone: "green" },
  ];

  const desktopCurrentOrders = activeTab === "waiting"
    ? filteredWaitingOrders
    : activeTab === "in-progress"
      ? filteredInProgressOrders
      : activeTab === "completed"
        ? filteredCompletedOrders
        : filteredAllOrders;

  const renderDesktopDashboard = () => (
    <div className="planner-reference-layout">
      <aside className="planner-reference-sidebar" aria-label="计划员订单导航">
        <div className="planner-reference-sidebar-title">
          <SettingOutlined />
          <span>计划员工作台</span>
        </div>
        {[
          { key: "all" as const, label: "全部订单", value: filteredAllOrders.length, icon: <FileDoneOutlined /> },
          { key: "waiting" as const, label: "待缝制", value: filteredWaitingOrders.length, icon: <FileTextOutlined /> },
          { key: "in-progress" as const, label: "缝制中", value: filteredInProgressOrders.length, icon: <SettingOutlined /> },
        ].map((item) => (
          <button
            type="button"
            key={item.key}
            className={`planner-reference-nav-item${activeTab === item.key ? " is-active" : ""}`}
            onClick={() => selectDesktopView(item.key)}
          >
            {item.icon}<span>{item.label}（{item.value}）</span>
          </button>
        ))}
      </aside>
      <main className="planner-reference-main">
        <div className="planner-reference-metrics" aria-label="本月订单统计">
          {desktopMetricCards.map((item) => (
            <button
              type="button"
              key={item.key}
              className={`planner-reference-metric planner-reference-metric-${item.tone}${activeTab === item.key ? " is-active" : ""}`}
              onClick={() => selectDesktopView(item.key)}
            >
              <span className="planner-reference-metric-icon">{item.icon}</span>
              <span><small>{item.label}</small><strong>{item.value}</strong></span>
              <span className="planner-reference-chevron">›</span>
            </button>
          ))}
        </div>
        <div className="planner-reference-divider" />
        {renderFilters()}
        <section className="planner-reference-table" aria-label={`${desktopMetricCards.find((item) => item.key === activeTab)?.label ?? "全部订单"}列表`}>
          {activeTab === "waiting"
            ? renderOrderView(desktopCurrentOrders, sewingColumns, "waiting")
            : activeTab === "in-progress"
              ? renderOrderView(desktopCurrentOrders, sewingColumns, "doing")
              : renderReceiverStyleOrderView(desktopCurrentOrders)}
        </section>
      </main>
    </div>
  );

  const compactPlannerTabs = [
    {
      key: "all",
      label: mobile ? `订单（${filteredAllOrders.length}）` : `全部订单（${filteredAllOrders.length}）`,
      children: renderReceiverStyleOrderView(filteredAllOrders),
    },
    {
      key: "doing",
      label: `缝制计划（${filteredDoingOrders.length}）`,
      children: renderSewingBoard(),
    },
    ...(mobile ? [{
      key: "scan-charge",
      label: "扫描费用",
      children: <MobileScanChargePanel role="planner" {...(scanToken ? { initialToken: scanToken } : {})} />
    }] : []),
  ];

  return (
    <section className={`planner-workbench${tablet ? " planner-tablet-workbench" : ""}`}>
      {tablet ? (
        <TabletWorkbenchHeader
          roleLabel="计划员"
          onScan={startTabletScan}
          scanning={tabletScanLoading}
        />
      ) : null}
      {contextHolder}
      <div className="full-width planner-workbench-content">
        {mobile || tablet ? renderOverview() : null}
        {mobile ? (
          <Alert
            type="info"
            showIcon
            message="计划员不在系统内分配缝制员工；缝制员工仍通过扫码加入订单。形成多人协作后，计划员可在“协作分配”中维护计划任务件数。客户仍然看不到员工信息和内部流转控制。"
          />
        ) : null}
        {!mobile && !tablet ? renderDesktopDashboard() : <>
        {renderFilters()}
        <Tabs
          className={`section-card-tabs planner-tablet-data-tabs${!mobile && !tablet ? " planner-desktop-side-tabs" : ""}`}
          tabPosition={!mobile && !tablet ? "left" : "top"}
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as PlannerTabKey)}
          items={compactPlannerTabs}
        />
        </>}
        <Modal
          title="订单详情"
          width={tablet ? "calc(100vw - 32px)" : 1080}
          open={Boolean(selectedOrder)}
          onCancel={closePlannerOrder}
          footer={<Button onClick={closePlannerOrder}>关闭</Button>}
          style={{ top: 24 }}
          destroyOnHidden
          className="planner-order-detail-modal order-detail-fixed-height-modal"
        >
          {selectedOrder ? (
            <div className="planner-order-detail-shell receiver-order-detail-dialog">
              <div className="receiver-detail-hero">
                <PlannerOrderThumbnail order={selectedOrder} session={session} variant="detail" />
                <Space direction="vertical" size={8} className="receiver-detail-hero-copy">
                  <Typography.Title level={3}>{selectedOrder.styleNo}</Typography.Title>
                  <Typography.Text>{selectedOrder.styleName}</Typography.Text>
                  <div className="receiver-detail-hero-meta">
                    <span><Typography.Text type="secondary">接单日期</Typography.Text><strong>{formatEntryDate(selectedOrder.createdAt)}</strong></span>
                    <span><Typography.Text type="secondary">客户</Typography.Text><strong>{selectedOrder.customerName}</strong></span>
                    <span><Typography.Text type="secondary">业务员</Typography.Text><strong>{selectedOrder.salespersonName}</strong></span>
                  </div>
                  <Space wrap className="receiver-detail-status-tags">
                    <Tag color="blue">{sampleTypeLabel(selectedOrder.sampleType)}</Tag>
                    <Tag color="blue">{sampleRoundLabel(selectedOrder.sampleRound)}</Tag>
                    {isCollaborationOrder(selectedOrder) ? <Tag color="blue">协作</Tag> : null}
                    <OrderCompletionTag
                      sampleRequestItems={selectedOrder.sampleRequestItems ?? []}
                      stage={selectedOrder.stage}
                      stageLabel={selectedOrder.stageLabel}
                      {...(selectedOrder.completionStatus ? { completionStatus: selectedOrder.completionStatus } : {})}
                      {...(selectedOrder.patternTask ? { patternTask: selectedOrder.patternTask } : {})}
                    />
                    {plannerMaterialStatusTag(selectedOrder.fabricStatus)}
                    {plannerMaterialStatusTag(selectedOrder.trimStatus)}
                  </Space>
                </Space>
              </div>
              <Tabs
                className="planner-order-detail-tabs"
                items={[
                {
                  key: "overview",
                  label: "订单概览",
                  children: (
                    <Space direction="vertical" size={12} className="full-width planner-order-detail order-detail-tab-scroll">
                      <div className="receiver-detail-overview-grid">
                        <div className="receiver-detail-overview-card">
                          <Typography.Text type="secondary">数量</Typography.Text>
                          <Typography.Text strong>{selectedOrder.quantity} 件</Typography.Text>
                        </div>
                        <div className="receiver-detail-overview-card">
                          <Typography.Text type="secondary">样品类型 / 轮次</Typography.Text>
                          <Space wrap>
                            <Tag color="blue">{sampleTypeLabel(selectedOrder.sampleType)}</Tag>
                            <Tag color="blue">{sampleRoundLabel(selectedOrder.sampleRound)}</Tag>
                          </Space>
                        </div>
                        <div className="receiver-detail-overview-card">
                          <Typography.Text type="secondary">期望交期</Typography.Text>
                          <Typography.Text strong>{selectedOrder.deliveryDate}</Typography.Text>
                        </div>
                      </div>
                      <div className="receiver-detail-wide-card receiver-detail-progress-card">
                        <Typography.Text type="secondary">订单进度</Typography.Text>
                        <ParallelProgress
                          compact
                          stacked
                          sampleRequestItems={selectedOrder.sampleRequestItems ?? []}
                          stage={selectedOrder.stage}
                          {...(selectedOrder.patternTask ? { patternTask: selectedOrder.patternTask } : {})}
                        />
                      </div>
                      <div className="receiver-detail-overview-paired-grid">
                        <div className="receiver-detail-wide-card receiver-detail-order-information-card">
                          <Typography.Text strong>订单信息</Typography.Text>
                          <div className="receiver-detail-order-information-grid">
                            <div><Typography.Text type="secondary">录入时间</Typography.Text><Typography.Text>{formatEntryDate(selectedOrder.createdAt)}</Typography.Text></div>
                            <div><Typography.Text type="secondary">订单来源</Typography.Text><Typography.Text>{plannerOrderSourceLabel(selectedOrder)}</Typography.Text></div>
                            <div><Typography.Text type="secondary">录入人</Typography.Text><Typography.Text>{plannerOrderCreatorLabel(selectedOrder)}</Typography.Text></div>
                          </div>
                        </div>
                        <div className="receiver-detail-wide-card">
                          <Typography.Text strong>打样要求</Typography.Text>
                          <Space wrap>
                            {(selectedOrder.sampleRequestItems ?? []).map((item) => (
                              <Tag color="blue" key={item}>
                                {labelFrom(sampleRequestItemOptions, item)}
                              </Tag>
                            ))}
                            {(selectedOrder.sampleRequestItems ?? []).length === 0 ? (
                              <Typography.Text type="secondary">暂无打样要求</Typography.Text>
                            ) : null}
                          </Space>
                        </div>
                      </div>
                      {isCollaborationOrder(selectedOrder) ? (
                        <div className="receiver-detail-wide-card">
                          <Space direction="vertical" size={6} className="full-width">
                            <Typography.Text strong>协作缝制</Typography.Text>
                            {plannerCollaboration(selectedOrder) ? (
                              <Typography.Text type="secondary">
                                计划分配 {plannerCollaboration(selectedOrder)!.plannedPieces} 件 · 已申报绩效 {plannerCollaboration(selectedOrder)!.completedPieces} 件 · 进行中 {plannerCollaboration(selectedOrder)!.activeParticipantCount} 人
                              </Typography.Text>
                            ) : null}
                            {(plannerCollaboration(selectedOrder)?.participants.length ?? 0) > 0 ? (
                              <Button type="primary" onClick={() => openCollaborationDialog(selectedOrder)}>协作分配</Button>
                            ) : (
                              <Typography.Text type="secondary">等待缝制员工扫码加入协作。</Typography.Text>
                            )}
                          </Space>
                        </div>
                      ) : null}
                      <div className="receiver-detail-wide-card">
                        <Typography.Text strong>备注</Typography.Text>
                        <Typography.Paragraph className="receiver-detail-remark">
                          {selectedOrder.remark || "无"}
                        </Typography.Paragraph>
                      </div>
                    </Space>
                  )
                },
                {
                  key: "attachments",
                  label: `资料与附件 ${selectedOrder.attachmentCount ?? selectedOrder.attachments?.length ?? 0}`,
                  children: mobile ? (
                    <Space direction="vertical" size={12} className="full-width planner-attachment-workspace">
                      <Alert type="info" showIcon message="手机端订单详情为只读页面；附件上传请使用计划员 Web 端。" />
                      <UnifiedAttachmentTable
                        key={selectedOrder.id}
                        compact
                        showAdvancedFilters
                        attachments={selectedOrder.attachments ?? []}
                        deliverables={selectedOrder.patternTask?.deliverables ?? []}
                        logs={selectedOrder.attachmentLogs ?? []}
                        currentUserId={session.userId}
                        currentRole={session.role}
                        showPageSizeChanger={tablet}
                        showLogs={!tablet}
                        loadPreview={(row) =>
                          sampleRoomApi.downloadPlannerOrderAttachment(session, selectedOrder.id, row.id)
                        }
                        loadDeliverablePreview={(deliverable) =>
                          sampleRoomApi.downloadPlannerPatternDeliverable(session, selectedOrder.id, deliverable.id)
                        }
                      />
                    </Space>
                  ) : (
                      <OrderAttachmentPanel
                        key={selectedOrder.id}
                        workspace
                        compact
                        showAdvancedFilters
                        defaultCategory="planner_upload"
                        defaultVisibility="internal_only"
                        showVisibilityChoice
                        pickerDescription="计划员可上传任意业务格式附件。"
                        onUpload={async (drafts) => {
                          const result = await sampleRoomApi.addPlannerOrderAttachments(
                            session,
                            selectedOrder.id,
                            drafts
                          );
                          setSelectedOrder((current) => current ? {
                            ...current,
                            attachments: result.attachments,
                            attachmentCount: result.attachments.length
                          } : current);
                          setOrders((current) => current.map((order) => order.id === selectedOrder.id ? {
                            ...order,
                            attachments: result.attachments,
                            attachmentCount: result.attachments.length
                          } : order));
                        }}
                        attachments={selectedOrder.attachments ?? []}
                        deliverables={selectedOrder.patternTask?.deliverables ?? []}
                        logs={selectedOrder.attachmentLogs ?? []}
                        currentUserId={session.userId}
                        currentRole={session.role}
                        showPageSizeChanger={tablet}
                        showLogs={!tablet}
                        onRenameAttachment={async (attachment, displayName) => {
                          const result = await sampleRoomApi.renamePlannerOrderAttachment(
                            session,
                            selectedOrder.id,
                            attachment.id,
                            displayName
                          );
                          setSelectedOrder((current) => current ? {
                            ...current,
                            attachments: result.attachments,
                            attachmentCount: result.attachments.length
                          } : current);
                          setOrders((current) => current.map((order) =>
                            order.id === selectedOrder.id
                              ? {
                                  ...order,
                                  attachments: result.attachments,
                                  attachmentCount: result.attachments.length
                                }
                              : order
                          ));
                        }}
                        onDeleteAttachment={async (attachment) => {
                          const result = await sampleRoomApi.deletePlannerOrderAttachment(
                            session,
                            selectedOrder.id,
                            attachment.id
                          );
                          setSelectedOrder((current) => current ? {
                            ...current,
                            attachments: result.attachments,
                            attachmentCount: result.attachments.length
                          } : current);
                          setOrders((current) => current.map((order) =>
                            order.id === selectedOrder.id
                              ? {
                                  ...order,
                                  attachments: result.attachments,
                                  attachmentCount: result.attachments.length
                                }
                              : order
                          ));
                        }}
                        onChangeAttachmentVisibility={async (attachment, visibility) => {
                          await sampleRoomApi.changePlannerOrderAttachmentVisibility(
                            session,
                            selectedOrder.id,
                            attachment.id,
                            visibility
                          );
                          const refreshed = await sampleRoomApi.listPlannerOrders(session);
                          setOrders(refreshed.orders);
                          setSelectedOrder(
                            refreshed.orders.find((order) => order.id === selectedOrder.id)
                          );
                        }}
                        loadPreview={(row) =>
                          sampleRoomApi.downloadPlannerOrderAttachment(session, selectedOrder.id, row.id)
                        }
                        loadDeliverablePreview={(deliverable) =>
                          sampleRoomApi.downloadPlannerPatternDeliverable(session, selectedOrder.id, deliverable.id)
                        }
                      />
                  )
                },
                ...(tablet ? [{
                  key: "attachment-logs",
                  label: `附件日志 ${selectedOrder.attachmentLogs?.length ?? 0}`,
                  children: (
                    <div className="order-detail-attachment-log-tab">
                      <AttachmentLogList logs={selectedOrder.attachmentLogs ?? []} />
                    </div>
                  )
                }] : []),
                {
                  key: "charges",
                  label: `其他费用 ${(chargesByOrder[selectedOrder.id] ?? []).length}`,
                  children: (
                    <OrderChargeReadOnlyPanel
                        charges={chargesByOrder[selectedOrder.id] ?? []}
                        currentUserId={session.userId}
                        tabletLayout={tablet}
                        onEdit={async (charge, payload) => {
                          const result = await sampleRoomApi.updateOrderCharge(
                            session,
                            "planner",
                            charge.orderId,
                            charge.id,
                            payload
                          );
                          setChargesByOrder((current) => ({
                            ...current,
                            [selectedOrder.id]: (current[selectedOrder.id] ?? []).map((item) =>
                              item.id === result.charge.id ? result.charge : item
                            )
                          }));
                        }}
                        onDelete={async (charge) => {
                          await sampleRoomApi.deleteOrderCharge(session, "planner", charge.orderId, charge.id);
                          setChargesByOrder((current) => ({
                            ...current,
                            [selectedOrder.id]: (current[selectedOrder.id] ?? []).filter((item) => item.id !== charge.id)
                          }));
                        }}
                        onRenameAttachment={async (charge, attachmentId, displayName) => {
                          const result = await sampleRoomApi.renameOrderChargeAttachment(
                            session,
                            "planner",
                            charge.orderId,
                            charge.id,
                            attachmentId,
                            displayName
                          );
                          setChargesByOrder((current) => ({
                            ...current,
                            [selectedOrder.id]: (current[selectedOrder.id] ?? []).map((item) =>
                              item.id === result.charge.id ? result.charge : item
                            )
                          }));
                        }}
                        onAddAttachments={async (charge, attachments) => {
                          const result = await sampleRoomApi.addOrderChargeAttachments(
                            session,
                            "planner",
                            charge.orderId,
                            charge.id,
                            attachments
                          );
                          setChargesByOrder((current) => ({
                            ...current,
                            [selectedOrder.id]: (current[selectedOrder.id] ?? []).map((item) =>
                              item.id === result.charge.id ? result.charge : item
                            )
                          }));
                        }}
                        onDeleteAttachment={async (charge, attachmentId) => {
                          const result = await sampleRoomApi.deleteOrderChargeAttachment(
                            session,
                            "planner",
                            charge.orderId,
                            charge.id,
                            attachmentId
                          );
                          setChargesByOrder((current) => ({
                            ...current,
                            [selectedOrder.id]: (current[selectedOrder.id] ?? []).map((item) =>
                              item.id === result.charge.id ? result.charge : item
                            )
                          }));
                        }}
                        loadAttachmentBlob={(attachment) =>
                          sampleRoomApi.downloadPlannerOrderAttachment(
                            session,
                            selectedOrder.id,
                            attachment.id
                          )
                        }
                      />
                  )
                },
                {
                  key: "scan-records",
                  label: `扫码记录 ${selectedOrder.scanRecords?.length ?? 0}`,
                  children: selectedOrder.scanRecords?.length ? (
                    <Space direction="vertical" size={6} className="full-width planner-scan-record-list order-detail-data-scroll">
                      {selectedOrder.scanRecords.map((record) => (
                        <div className="planner-scan-record" key={record.id}>
                          <Tag>{scanRecordTitle(record)}</Tag>
                          <Typography.Text>
                            {record.workerName}
                            {record.pieces !== undefined ? ` · ${record.pieces} 件` : ""}
                            {record.workHours !== undefined ? ` · ${record.workHours} 小时` : ""}
                            {scanRecordQualityScoreLabel(record) ? ` · ${scanRecordQualityScoreLabel(record)}` : ""}
                            {record.note
                              ? ` · ${isNormalQcCompletion(record) ? scanRecordNoteLabel(record) : record.note}`
                              : ""}
                            {!isNormalQcCompletion(record) && record.qualityResult ? ` · 质量：${record.qualityResult}` : ""}
                            {record.takeoverReason ? ` · 接替原因：${record.takeoverReason}` : ""}
                          </Typography.Text>
                          <Typography.Text type="secondary">{new Date(record.eventTime).toLocaleString("zh-CN")}</Typography.Text>
                        </div>
                      ))}
                    </Space>
                  ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无扫码记录" />
                }
                ]}
              />
            </div>
          ) : null}
        </Modal>
        <Modal title="已定位订单" open={Boolean(tabletScannedChargeOrder)} footer={null} closable={false} maskClosable={false} width={520}>
          {tabletScannedChargeOrder ? <Space direction="vertical" size={16} className="full-width">
            <Typography.Title level={4}>{tabletScannedChargeOrder.styleNo} · {tabletScannedChargeOrder.styleName}</Typography.Title>
            <Button type="primary" size="large" block onClick={() => {
              setChargeOrder(tabletScannedChargeOrder);
              setTabletScannedChargeOrder(undefined);
            }}>其他费用 {tabletScannedChargeOrder.chargeCount ?? 0}</Button>
            <Button size="large" block onClick={() => setTabletScannedChargeOrder(undefined)}>取消</Button>
          </Space> : null}
        </Modal>
        <PlannerCollaborationDialog
          open={Boolean(collaborationOrder)}
          orderId={collaborationOrder?.id}
          orderLabel={collaborationOrder ? `${collaborationOrder.styleNo} · ${collaborationOrder.styleName}` : undefined}
          session={session}
          onClose={() => setCollaborationOrder(undefined)}
          onChanged={async () => {
            await loadData(true);
            if (selectedOrder) {
              const refreshed = await sampleRoomApi.listPlannerOrders(session);
              setSelectedOrder(refreshed.orders.find((order) => order.id === selectedOrder.id));
            }
          }}
        />
        <ReceiverOrderChargeModal
          order={chargeOrder ?? null}
          charges={chargeOrder ? chargesByOrder[chargeOrder.id] ?? [] : []}
          sourceScene="planner_order_list"
          role="planner"
          onCancel={() => { setChargeOrder(undefined); setTabletScannedChargeOrder(undefined); }}
          onChargesChange={(charges) => {
            if (!chargeOrder) return;
            setChargesByOrder((current) => ({
              ...current,
              [chargeOrder.id]: charges
            }));
            void loadData(true);
          }}
        />
      </div>
    </section>
  );
}
