import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Segmented,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from "antd";
import {
  DEFAULT_SAMPLE_REQUEST_ITEMS,
  DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
  receiverLabelCopies,
  hasPhysicalProductionRoute,
  parseOrderQrPayload,
  sampleRequestItemOptions,
  sampleRoundOptions,
  type ReceiverQrPrintSettings
} from "@sample-room/shared";
import { useCallback, useEffect, useMemo, useState, type Key } from "react";
import {
  sampleRoomApi,
  type AttachmentMetadataInput,
  type MaterialStatus,
  type OrderAttachment,
  type OrderChargeRecord,
  type OrderRecord,
  type PatternStatus,
  type ReceiverCorrectionPayload,
  type ReceiverQuickPhotoPayload,
  type ReceiverSelfEntryCustomer,
  type SelfEntryPayload,
  type TrackingPatchPayload
} from "../../api/sampleRoomApi";
import { useDevSession } from "../../app/DevSessionContext";
import { useSampleTypeOptions } from "../../app/SampleTypeOptionsContext";
import { ClientAttachmentPicker } from "../../components/ClientAttachmentPicker";
import { integerInputProps } from "../../components/forms/numericInputProps";
import {
  attachmentFileNameError,
  normalizeAttachmentFileName
} from "../../components/attachmentFileName";
import { OrderExportDialog } from "../../components/export/OrderExportDialog";
import { resolveOrderExportDataset } from "../../components/export/orderExportRules";
import { OrderTable } from "../../components/OrderTable";
import {
  IntakeTag,
  MaterialTag,
  SampleRoundTag,
  SampleTypeTag,
  StageTag,
  fabricOptions,
  trimOptions
} from "../../components/StatusTags";
import { OrderAttachmentThumbnail } from "../../components/orders/OrderAttachmentThumbnail";
import {
  ReceiverCorrectionModal,
  type ReceiverCorrectionSubmitOptions
} from "../../components/orders/ReceiverCorrectionModal";
import { ReceiverCorrectionLog } from "../../components/orders/ReceiverCorrectionLog";
import {
  formatDeliveryDate,
  formatEntryDate,
  getOrderBusinessUserName,
  getOrderCustomerName
} from "../../components/orders/orderDisplay";
import { OrderDesktopFilterBar } from "../../components/orders/OrderDesktopFilterBar";
import {
  createCurrentMonthOrderFilters,
  defaultOrderFilters,
  filterOrders,
  type OrderFilters
} from "../../components/orders/orderFilters";
import { OrderScanRecordsPanel } from "../../components/scan/OrderScanRecordsPanel";
import { downloadBlob } from "../../utils/downloadBlob";
import { qrValueForOrderLink } from "../../utils/publicUrl";
import { createDefaultReceiverSelfEntryValues } from "../../utils/orderFormDefaults";
import { ParallelProgress } from "../../components/operations/ParallelProgress";
import { ReceiverOrderChargeModal } from "../../components/orders/ReceiverOrderChargeModal";
import { OrderChargeReadOnlyPanel } from "../../components/orders/OrderChargeReadOnlyPanel";
import {
  AttachmentLogList,
  UnifiedAttachmentTable
} from "../../components/attachments/UnifiedAttachmentTable";
import { OrderAttachmentPanel } from "../../components/attachments/OrderAttachmentPanel";
import { attachmentUploadErrorMessage } from "../../components/attachments/attachmentErrors";
import { attachmentUploaderLabel } from "../../components/attachments/attachmentPresentation";
import { isSafeAttachmentPreviewMime } from "../../components/attachments/attachmentPreview";
import { useVisibleAutoRefresh } from "../../hooks/useVisibleAutoRefresh";
import {
  ReceiverIntakeAttachmentWorkspace,
  receiverIntakeSubmissionAttachments,
  receiverIntakeThumbnailAttachmentIndex,
  type ReceiverIntakeAttachmentState
} from "../../components/receiver/ReceiverIntakeAttachmentWorkspace";
import { ReceiverSampleRequestSection } from "../../components/receiver/ReceiverSampleRequestSection";
import { TabletWorkbenchHeader } from "../../components/tablet/TabletWorkbenchHeader";
import {
  requestNativeOrderScan,
  subscribeToNativeOrderScans
} from "../qc/tabletNativeBridge";
import { ReceiverPrintSettingsModal } from "../../components/printing/ReceiverPrintSettingsModal";
import { ReceiverLabelPreview } from "../../components/printing/ReceiverLabelPreview";
import {
  buildReceiverLabelPrintJob,
  type ReceiverLabelOrder
} from "../../printing/receiverLabel";
import { printReceiverLabels } from "../../printing/receiverPrinter";
import { createOrderQrPdf } from "../../printing/orderQrPdf";
import { saveGeneratedWithNativeTablet } from "../qc/tabletNativeBridge";
import { viewportBoundDialogWidth } from "../../components/dialogLayout";

type ReceiverTab = "self-entry" | "pending" | "list";

type ReceiverScanPrintItem = {
  order: OrderRecord;
  scanValue: string;
};

type ReceiverWorkbenchPageProps = {
  initialTab?: ReceiverTab;
  tablet?: boolean;
};

function isCompleteReceiverListOrder(order: OrderRecord) {
  return order.intakeStatus === "received";
}

function isReceiverOrderListOrder(order: OrderRecord) {
  return isCompleteReceiverListOrder(order) || (
    order.sourceType === "receiver_self_entry" &&
    order.intakeStatus === "pending_receive"
  );
}

function getReceiverTabDefaultFilters(tab: ReceiverTab): OrderFilters {
  return tab === "list" ? createCurrentMonthOrderFilters() : { ...defaultOrderFilters };
}

function firstCustomerUser(customers: ReceiverSelfEntryCustomer[]) {
  const customer = customers[0];
  const clientUser = customer?.clientUsers[0];
  return customer && clientUser
    ? { customerId: customer.id, clientUserId: clientUser.id }
    : undefined;
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getReceiverBusinessUserDisplayName(order: OrderRecord) {
  const rawName = getOrderBusinessUserName(order);
  if (rawName === "-") {
    return rawName;
  }

  const customerName = getOrderCustomerName(order);
  if (customerName !== "-" && rawName.startsWith(customerName)) {
    return rawName.slice(customerName.length).trim() || rawName;
  }

  return rawName.replace(/^客户\s*[A-Za-z0-9一二三四五六七八九十]*\s*/, "").trim() || rawName;
}

function getReceiverOrderSourceParts(order: OrderRecord) {
  if (order.sourceType === "client_submission") {
    return {
      label: "客户提交",
      detail: getOrderCustomerName(order)
    };
  }

  if (order.sourceType === "receiver_self_entry") {
    return {
      label: "接单员录入",
      detail: order.createdBy ?? "Receiver"
    };
  }

  return {
    label: "内部录入",
    detail: order.createdBy ?? "-"
  };
}

function sampleRequestLabel(value: string) {
  return sampleRequestItemOptions.find((option) => option.value === value)?.label ?? value;
}

function emptyReceiverIntakeAttachmentState(): ReceiverIntakeAttachmentState {
  return { sampleSheetAttachments: [], ordinaryAttachments: [] };
}

export function ReceiverWorkbenchPage({
  initialTab = "self-entry",
  tablet = false
}: ReceiverWorkbenchPageProps) {
  const { options: sampleTypeOptions } = useSampleTypeOptions();
  const { session } = useDevSession();
  const [activeTab, setActiveTab] = useState<ReceiverTab>(initialTab);
  const [filters, setFilters] = useState<OrderFilters>(() => getReceiverTabDefaultFilters(initialTab));
  const [entryUserFilter, setEntryUserFilter] = useState("all");
  const [pendingOrders, setPendingOrders] = useState<OrderRecord[]>([]);
  const [allOrders, setAllOrders] = useState<OrderRecord[]>([]);
  const [selfEntryCustomers, setSelfEntryCustomers] = useState<ReceiverSelfEntryCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [returningOrder, setReturningOrder] = useState<OrderRecord | null>(null);
  const [editingOrder, setEditingOrder] = useState<OrderRecord | null>(null);
  const [correctingOrder, setCorrectingOrder] = useState<OrderRecord | null>(null);
  const [trackingDraft, setTrackingDraft] = useState<TrackingPatchPayload>({});
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [selectedQueryRowKeys, setSelectedQueryRowKeys] = useState<Key[]>([]);
  const [inspectingOrderId, setInspectingOrderId] = useState<string>();
  const [activeOrderDetailTab, setActiveOrderDetailTab] = useState("overview");
  const [activeOrderRecordSections, setActiveOrderRecordSections] = useState<string[]>(["scan-records"]);
  const [detailDraftAttachments, setDetailDraftAttachments] = useState<AttachmentMetadataInput[]>([]);
  const [detailAttachmentSubmitting, setDetailAttachmentSubmitting] = useState(false);
  const [detailUploadOpen, setDetailUploadOpen] = useState(false);
  const [detailAttachmentKeyword, setDetailAttachmentKeyword] = useState("");
  const [detailAttachmentSource, setDetailAttachmentSource] = useState("all");
  const [materialRecordOrder, setMaterialRecordOrder] = useState<OrderRecord | null>(null);
  const [materialRecordAttachments, setMaterialRecordAttachments] = useState<AttachmentMetadataInput[]>([]);
  const [materialRecordSubmitting, setMaterialRecordSubmitting] = useState(false);
  const [chargeOrder, setChargeOrder] = useState<OrderRecord | null>(null);
  const [batchScanPrintItems, setBatchScanPrintItems] = useState<ReceiverScanPrintItem[]>([]);
  const [batchScanPrintOpen, setBatchScanPrintOpen] = useState(false);
  const [batchScanPrintLoading, setBatchScanPrintLoading] = useState(false);
  const [batchQrPdfPreviewItems, setBatchQrPdfPreviewItems] = useState<ReceiverScanPrintItem[]>([]);
  const [batchQrPdfPreviewOpen, setBatchQrPdfPreviewOpen] = useState(false);
  const [batchQrPdfSaving, setBatchQrPdfSaving] = useState(false);
  const [b1PrintBusy, setB1PrintBusy] = useState(false);
  const [printSettingsOpen, setPrintSettingsOpen] = useState(false);
  const [printSettings, setPrintSettings] = useState<ReceiverQrPrintSettings>({
    ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
    summaryFields: [...DEFAULT_RECEIVER_QR_PRINT_SETTINGS.summaryFields]
  });
  const [quickEntryAttachments, setQuickEntryAttachments] = useState<ReceiverIntakeAttachmentState>(emptyReceiverIntakeAttachmentState);
  const [fullEntryAttachments, setFullEntryAttachments] = useState<ReceiverIntakeAttachmentState>(emptyReceiverIntakeAttachmentState);
  const [selfEntrySubmitting, setSelfEntrySubmitting] = useState(false);
  const [selfEntryMode, setSelfEntryMode] = useState<"quick" | "full">("full");
  const [chargesByOrder, setChargesByOrder] = useState<Record<string, OrderChargeRecord[]>>({});
  const [tabletScannedOrder, setTabletScannedOrder] = useState<OrderRecord | null>(null);
  const [tabletScanLoading, setTabletScanLoading] = useState(false);
  const [returnForm] = Form.useForm<{ returnReason: string }>();
  const [selfEntryForm] = Form.useForm<Omit<ReceiverQuickPhotoPayload, "attachments" | "thumbnailAttachmentIndex">>();
  const [fullEntryForm] = Form.useForm<SelfEntryPayload>();
  const selectedCustomerId = Form.useWatch("customerId", selfEntryForm);
  const fullSelectedCustomerId = Form.useWatch("customerId", fullEntryForm);
  const [messageApi, contextHolder] = message.useMessage();
  const blockTerminatedOrder = (order: OrderRecord) => {
    if (!order.terminated) return false;
    messageApi.info("订单已终止");
    return true;
  };

  const customerOptions = useMemo(
    () =>
      selfEntryCustomers.map((customer) => ({
        label: customer.name,
        value: customer.id
      })),
    [selfEntryCustomers]
  );

  const clientUserOptions = useMemo(() => {
    const selectedCustomer =
      selfEntryCustomers.find((customer) => customer.id === selectedCustomerId) ??
      selfEntryCustomers[0];

    return (
      selectedCustomer?.clientUsers.map((clientUser) => ({
        label: clientUser.displayName,
        value: clientUser.id
      })) ?? []
    );
  }, [selectedCustomerId, selfEntryCustomers]);

  const fullClientUserOptions = useMemo(() => {
    const selectedCustomer = selfEntryCustomers.find((customer) => customer.id === fullSelectedCustomerId) ?? selfEntryCustomers[0];
    return selectedCustomer?.clientUsers.map((clientUser) => ({ label: clientUser.displayName, value: clientUser.id })) ?? [];
  }, [fullSelectedCustomerId, selfEntryCustomers]);

  const loadOrders = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [pending, all, selfEntryOptions] = await Promise.all([
        sampleRoomApi.listPendingReceive(session),
        sampleRoomApi.listReceiverOrders(session),
        sampleRoomApi.listReceiverSelfEntryOptions(session)
      ]);
      setPendingOrders(pending.orders);
      setAllOrders(all.orders);
      setSelfEntryCustomers(selfEntryOptions.customers);
    } catch (error) {
      if (!silent) messageApi.error(error instanceof Error ? error.message : "加载接单数据失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [messageApi, session]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useVisibleAutoRefresh(() => loadOrders({ silent: true }));

  const resolveTabletScan = useCallback(async (payload: string) => {
    setTabletScanLoading(true);
    try {
      const token = parseOrderQrPayload(payload).token;
      const context = await sampleRoomApi.getMobileScanChargeContext(session, "receiver", token);
      let order = allOrders.find((candidate) => candidate.id === context.order.id);
      if (!order) {
        const refreshed = await sampleRoomApi.listReceiverOrders(session);
        setAllOrders(refreshed.orders);
        order = refreshed.orders.find((candidate) => candidate.id === context.order.id);
      }
      if (!order) throw new Error("已定位订单，但接单员订单列表中未找到该订单。")
      if (order.terminated) {
        messageApi.info("订单已终止");
        return;
      }
      setChargesByOrder((current) => ({ ...current, [order.id]: context.charges }));
      setTabletScannedOrder(order);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "订单二维码读取失败");
    } finally {
      setTabletScanLoading(false);
    }
  }, [allOrders, messageApi, session]);

  useEffect(() => {
    if (!tablet) return undefined;
    return subscribeToNativeOrderScans((payload) => { void resolveTabletScan(payload); });
  }, [resolveTabletScan, tablet]);

  const startTabletScan = () => {
    if (!requestNativeOrderScan()) {
      messageApi.warning("请在样品间 Pad APK 中使用原生扫码。")
    }
  };

  useEffect(() => {
    setActiveTab(initialTab);
    setFilters(getReceiverTabDefaultFilters(initialTab));
    setSelectedQueryRowKeys([]);
  }, [initialTab]);

  useEffect(() => {
    const defaults = firstCustomerUser(selfEntryCustomers);
    if (!defaults) {
      return;
    }

    const currentCustomerId = selfEntryForm.getFieldValue("customerId") as string | undefined;
    const currentClientUserId = selfEntryForm.getFieldValue("clientUserId") as string | undefined;
    if (!currentCustomerId || !currentClientUserId) {
      selfEntryForm.setFieldsValue({
        ...defaults,
        quantity: 1,
        sampleRequestItems: DEFAULT_SAMPLE_REQUEST_ITEMS,
        remark: ""
      });
    }
    const fullCustomerId = fullEntryForm.getFieldValue("customerId");
    if (!fullCustomerId) {
      fullEntryForm.setFieldsValue({ ...createDefaultReceiverSelfEntryValues(), ...defaults });
    }
  }, [fullEntryForm, selfEntryCustomers, selfEntryForm]);

  const filteredPendingOrders = useMemo(() => {
    const pendingIds = new Set(pendingOrders.map((order) => order.id));
    return filterOrders(allOrders, filters)
      .filter((order) => pendingIds.has(order.id) && !order.terminated)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [allOrders, pendingOrders, filters]);

  const entryUserOptions = useMemo(() => {
    const createdByValues = Array.from(
      new Set(
        allOrders
          .map((order) => order.createdBy)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      )
    ).sort();
    return [
      { label: "全部录入人", value: "all" },
      { label: "我录入的", value: "mine" },
      ...createdByValues.map((value) => ({ label: value, value: `user:${value}` }))
    ];
  }, [allOrders]);

  const matchesEntryUserFilter = useCallback(
    (order: OrderRecord) => {
      if (entryUserFilter === "all") {
        return true;
      }
      if (entryUserFilter === "mine") {
        return order.createdBy === session.userId;
      }
      if (entryUserFilter.startsWith("user:")) {
        return order.createdBy === entryUserFilter.slice("user:".length);
      }
      return true;
    },
    [entryUserFilter, session.userId]
  );

  const filteredQueryOrders = useMemo(
    () =>
      filterOrders(allOrders, filters)
        .filter(
          (order) =>
            isReceiverOrderListOrder(order) &&
            matchesEntryUserFilter(order)
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [allOrders, filters, matchesEntryUserFilter]
  );

  const completeReceiverOrders = useMemo(
    () => allOrders.filter(isCompleteReceiverListOrder),
    [allOrders]
  );

  const receiverOrderListOrders = useMemo(
    () => allOrders.filter(isReceiverOrderListOrder),
    [allOrders]
  );

  const activeOrders = useMemo(() => allOrders.filter((order) => !order.terminated), [allOrders]);

  const receiverStatusPreviewItems = useMemo(() => {
    const today = getLocalDateKey();
    const count = (predicate: (order: OrderRecord) => boolean) => activeOrders.filter(predicate).length;

    return [
      {
        label: "待校正",
        value: pendingOrders.filter((order) => !order.terminated).length,
        tone: "orange"
      },
      {
        label: "已接单",
        value: completeReceiverOrders.length,
        tone: "green"
      },
      {
        label: "待制版",
        value: count((order) => order.stage === "pattern_waiting" || order.stage === "pattern_doing"),
        tone: "purple"
      },
      {
        label: "待裁剪",
        value: count((order) => order.stage === "cutting_waiting"),
        tone: "blue"
      },
      {
        label: "生产中",
        value: count((order) =>
          ["cutting_doing", "sewing_waiting", "sewing_doing", "qc_delivery_waiting"].includes(order.stage ?? "")
        ),
        tone: "cyan"
      },
      {
        label: "今日交期",
        value: count((order) => order.deliveryDate === today && order.stage !== "done"),
        tone: "geekblue"
      },
      {
        label: "异常待处理",
        value: count(
          (order) =>
            order.intakeStatus === "needs_client_supplement" ||
            order.fabricStatus === "missing" ||
            order.trimStatus === "missing"
        ),
        tone: "red"
      },
      {
        label: "已完成",
        value: count((order) => order.stage === "done"),
        tone: "default"
      }
    ];
  }, [activeOrders, completeReceiverOrders.length, pendingOrders]);

  const exportDataset = useMemo(
    () => resolveOrderExportDataset(filteredQueryOrders, selectedQueryRowKeys, filters),
    [filteredQueryOrders, filters, selectedQueryRowKeys]
  );

  const inspectingOrder = useMemo(
    () => filteredQueryOrders.find((order) => order.id === inspectingOrderId),
    [filteredQueryOrders, inspectingOrderId]
  );
  const currentMaterialRecordOrder = materialRecordOrder
    ? allOrders.find((order) => order.id === materialRecordOrder.id) ?? materialRecordOrder
    : null;

  useEffect(() => {
    const visibleIds = new Set(filteredQueryOrders.map((order) => order.id));
    setSelectedQueryRowKeys((keys) => keys.filter((key) => visibleIds.has(String(key))));
    setInspectingOrderId((current) => (current && visibleIds.has(current) ? current : undefined));
  }, [filteredQueryOrders]);

  const changeReceiverFilters = (nextFilters: OrderFilters) => {
    setFilters(nextFilters);
    setSelectedQueryRowKeys([]);
    setInspectingOrderId(undefined);
  };

  const changeTab = (key: string) => {
    const nextTab = key as ReceiverTab;
    setActiveTab(nextTab);
    setFilters(getReceiverTabDefaultFilters(nextTab));
    setSelectedQueryRowKeys([]);
    setInspectingOrderId(undefined);
  };

  const openReturn = (order: OrderRecord) => {
    setReturningOrder(order);
    returnForm.setFieldsValue({ returnReason: "" });
  };

  const submitReturn = async () => {
    if (!returningOrder) {
      return;
    }

    const values = await returnForm.validateFields();
    await sampleRoomApi.returnOrder(session, returningOrder.id, values);
    messageApi.success("已退回客户补充");
    setReturningOrder(null);
    await loadOrders();
  };

  const openTrackingEdit = (order: OrderRecord) => {
    setEditingOrder(order);
    setTrackingDraft({
      fabricStatus: order.fabricStatus,
      trimStatus: order.trimStatus,
      ...(order.remark ? { remark: order.remark } : {})
    });
  };

  const submitTrackingPatch = async () => {
    if (!editingOrder) {
      return;
    }

    await sampleRoomApi.updateTracking(session, editingOrder.id, trackingDraft);
    messageApi.success("已保存订单状态");
    setEditingOrder(null);
    setTrackingDraft({});
    await loadOrders();
  };

  const submitCorrection = async (
    values: ReceiverCorrectionPayload,
    options: ReceiverCorrectionSubmitOptions
  ) => {
    if (!correctingOrder) {
      return;
    }

    await sampleRoomApi.correctReceiverOrder(session, correctingOrder.id, values);
    if (options.thumbnailAttachments.length > 0) {
      await sampleRoomApi.addReceiverOrderAttachments(
        session,
        correctingOrder.id,
        options.thumbnailAttachments
      );
    }

    if (options.intent === "complete" && correctingOrder.intakeStatus === "pending_receive") {
      await sampleRoomApi.acceptOrder(session, correctingOrder.id, {
        patternStatus: (values.patternStatus ?? correctingOrder.patternStatus) as PatternStatus,
        fabricStatus: (values.fabricStatus ?? correctingOrder.fabricStatus) as MaterialStatus,
        trimStatus: (values.trimStatus ?? correctingOrder.trimStatus) as MaterialStatus
      });
      messageApi.success("已完成校正，订单进入订单列表");
    } else {
      messageApi.success(options.intent === "draft" ? "已保存校正草稿" : "已保存订单资料");
    }

    setCorrectingOrder(null);
    await loadOrders();
  };

  const submitSelfEntry = async (values: Omit<ReceiverQuickPhotoPayload, "attachments" | "thumbnailAttachmentIndex">) => {
    if (quickEntryAttachments.sampleSheetAttachments.length === 0) {
      messageApi.warning("拍照简录必须上传至少一份打样单相关附件");
      return;
    }

    setSelfEntrySubmitting(true);
    try {
      const attachments = receiverIntakeSubmissionAttachments(quickEntryAttachments);
      const created = await sampleRoomApi.createReceiverQuickPhotoOrder(session, {
        ...values,
        attachments,
        thumbnailAttachmentIndex: receiverIntakeThumbnailAttachmentIndex(quickEntryAttachments)
      });
      messageApi.success(`已生成待校正订单：${created.order.styleNo}`);
      selfEntryForm.resetFields();
      selfEntryForm.setFieldsValue({
        ...firstCustomerUser(selfEntryCustomers),
        quantity: 1,
        sampleRequestItems: DEFAULT_SAMPLE_REQUEST_ITEMS,
        remark: ""
      });
      setQuickEntryAttachments(emptyReceiverIntakeAttachmentState());
      await loadOrders();
    } catch (error) {
      messageApi.error(attachmentUploadErrorMessage(error));
    } finally {
      setSelfEntrySubmitting(false);
    }
  };

  const canMaintainTrackingOrder = (order: OrderRecord) =>
    order.intakeStatus === "received" && order.stage !== null && order.stage !== "done" && !order.terminated;

  const canShowOrderScanLink = (order: OrderRecord) =>
    !order.terminated &&
    order.intakeStatus === "received" &&
    order.sampleRequestItems.length > 0 &&
    order.stage !== null;

  const sampleTypeLabelFor = (value: string) =>
    sampleTypeOptions.find((option) => option.value === value)?.label ?? value;

  const receiverLabelOrder = (order: OrderRecord, scanValue: string): ReceiverLabelOrder => ({
    orderId: order.id,
    scanValue,
    customerName: getOrderCustomerName(order),
    businessUserName: getOrderBusinessUserName(order),
    styleNo: order.styleNo,
    styleName: order.styleName,
    sampleType: sampleTypeLabelFor(order.sampleType),
    quantity: order.quantity
  });

  const loadPrintSettings = async () => {
    const result = await sampleRoomApi.getReceiverPrintSettings(session);
    setPrintSettings(result.settings);
    return result.settings;
  };

  const printB1Items = async (items: ReceiverScanPrintItem[], settings = printSettings) => {
    if (items.length === 0) return;
    setB1PrintBusy(true);
    try {
      const job = buildReceiverLabelPrintJob(
        settings,
        items.map((item) => receiverLabelOrder(item.order, item.scanValue))
      );
      await printReceiverLabels(job);
      messageApi.success(`已完成 ${items.length * receiverLabelCopies(settings)} 张 B1 标签打印`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "B1 标签打印失败";
      messageApi.error(text);
      if (text.includes("打印设置") || text.includes("打印机") || text.includes("打印服务")) {
        setPrintSettingsOpen(true);
      }
      throw error;
    } finally {
      setB1PrintBusy(false);
    }
  };

  const printSingleOrder = async (order: OrderRecord) => {
    if (!canShowOrderScanLink(order)) return;
    setB1PrintBusy(true);
    try {
      const [scan, settings] = await Promise.all([
        sampleRoomApi.ensureReceiverOrderScanLink(session, order.id),
        loadPrintSettings()
      ]);
      await printB1Items([{
        order,
        scanValue: qrValueForOrderLink(scan.scanLink)
      }], settings);
    } catch {
      // printB1Items and request helpers already provide a user-facing error.
    } finally {
      setB1PrintBusy(false);
    }
  };

  const selectedQueryOrders = useMemo(() => {
    const selectedIds = new Set(selectedQueryRowKeys.map(String));
    return filteredQueryOrders.filter((order) => selectedIds.has(order.id));
  }, [filteredQueryOrders, selectedQueryRowKeys]);

  const openBatchScanPrint = async () => {
    if (selectedQueryOrders.length === 0) {
      messageApi.warning("请先勾选需要打印二维码的订单");
      return;
    }

    const eligibleOrders = selectedQueryOrders.filter(canShowOrderScanLink);
    if (eligibleOrders.length === 0) {
      messageApi.warning("所选订单当前不能生成流转二维码");
      return;
    }

    if (eligibleOrders.length < selectedQueryOrders.length) {
      messageApi.warning("已跳过尚未接单或不能生成二维码的订单");
    }

    setBatchScanPrintLoading(true);
    try {
      const [items, settings] = await Promise.all([
        Promise.all(
        eligibleOrders.map(async (order) => {
          const result = await sampleRoomApi.ensureReceiverOrderScanLink(session, order.id);
          return {
            order,
            scanValue: qrValueForOrderLink(result.scanLink)
          };
        })
        ),
        loadPrintSettings()
      ]);
      setBatchScanPrintItems(items);
      setPrintSettings(settings);
      setBatchScanPrintOpen(true);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "批量二维码加载失败");
    } finally {
      setBatchScanPrintLoading(false);
    }
  };

  const openBatchQrPdfPreview = async () => {
    if (selectedQueryOrders.length === 0) {
      messageApi.warning("请先勾选需要生成 PDF 二维码的订单");
      return;
    }
    const eligibleOrders = selectedQueryOrders.filter(canShowOrderScanLink);
    if (eligibleOrders.length === 0) {
      messageApi.warning("所选订单当前不能生成流转二维码");
      return;
    }
    setBatchScanPrintLoading(true);
    try {
      const [items, settings] = await Promise.all([
        Promise.all(eligibleOrders.map(async (order) => ({
          order,
          scanValue: qrValueForOrderLink((await sampleRoomApi.ensureReceiverOrderScanLink(session, order.id)).scanLink)
        }))),
        loadPrintSettings()
      ]);
      setBatchQrPdfPreviewItems(items);
      setPrintSettings(settings);
      setBatchQrPdfPreviewOpen(true);
      if (eligibleOrders.length < selectedQueryOrders.length) {
        messageApi.warning("已跳过尚未接单或不能生成二维码的订单");
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "PDF 二维码预览加载失败");
    } finally {
      setBatchScanPrintLoading(false);
    }
  };

  const confirmBatchQrPdf = async () => {
    if (batchQrPdfPreviewItems.length === 0) return;
    setBatchQrPdfSaving(true);
    try {
      const blob = await createOrderQrPdf(
        batchQrPdfPreviewItems.map(({ order, scanValue }) => receiverLabelOrder(order, scanValue)),
        printSettings
      );
      const fileName = `订单二维码_${new Date().toISOString().slice(0, 10)}.pdf`;
      if (!await saveGeneratedWithNativeTablet(blob, fileName, "application/pdf")) downloadBlob(blob, fileName);
      messageApi.success(`已生成 ${batchQrPdfPreviewItems.length * receiverLabelCopies(printSettings)} 张订单二维码标签 PDF`);
      setBatchQrPdfPreviewOpen(false);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "PDF 二维码生成失败");
    } finally {
      setBatchQrPdfSaving(false);
    }
  };

  const addReceiverOrderAttachments = async (
    order: OrderRecord,
    attachments: AttachmentMetadataInput[]
  ) => {
    await sampleRoomApi.addReceiverOrderAttachments(session, order.id, attachments);
    await loadOrders();
  };

  const replaceOrderAttachments = (orderId: string, attachments: OrderAttachment[]) => {
    const replace = (order: OrderRecord) => order.id === orderId
      ? {
          ...order,
          attachments,
          attachmentCount: attachments.length,
          materialRecordCount: attachments.filter((attachment) => attachment.category === "receiver_material_record").length
        }
      : order;
    setAllOrders((orders) => orders.map(replace));
    setPendingOrders((orders) => orders.map(replace));
  };

  const uploadReceiverSampleSheet = async (
    order: OrderRecord,
    attachment: AttachmentMetadataInput
  ) => {
    const created = await sampleRoomApi.addReceiverOrderAttachments(session, order.id, [attachment]);
    const uploaded = created.attachments[0];
    if (!uploaded) throw new Error("文件上传失败");
    return (
      await sampleRoomApi.selectReceiverSampleSheetAttachment(session, order.id, uploaded.id)
    ).attachments;
  };

  const selectReceiverSampleSheet = async (order: OrderRecord, attachmentId: string) =>
    (
      await sampleRoomApi.selectReceiverSampleSheetAttachment(session, order.id, attachmentId)
    ).attachments;

  const submitFullSelfEntry = async (values: SelfEntryPayload) => {
    if (fullEntryAttachments.sampleSheetAttachments.length === 0) {
      messageApi.warning("完整录入必须上传至少一份打样单相关附件");
      return;
    }
    setSelfEntrySubmitting(true);
    try {
      const attachments = receiverIntakeSubmissionAttachments(fullEntryAttachments);
      const created = await sampleRoomApi.createSelfEntry(session, {
        ...values,
        patternStatus: "none",
        attachments,
        thumbnailAttachmentIndex: receiverIntakeThumbnailAttachmentIndex(fullEntryAttachments)
      });
      messageApi.success(`完整订单已录入：${created.order.styleNo}`);
      fullEntryForm.resetFields();
      fullEntryForm.setFieldsValue(createDefaultReceiverSelfEntryValues());
      setFullEntryAttachments(emptyReceiverIntakeAttachmentState());
      await loadOrders();
    } catch (error) {
      messageApi.error(attachmentUploadErrorMessage(error));
    } finally {
      setSelfEntrySubmitting(false);
    }
  };

  const submitDetailAttachments = async (order: OrderRecord) => {
    if (detailDraftAttachments.length === 0) {
      messageApi.warning("请先选择附件");
      return;
    }

    setDetailAttachmentSubmitting(true);
    try {
      await addReceiverOrderAttachments(
        order,
        detailDraftAttachments.map((attachment) => ({
          ...attachment,
          category: "receiver_attachment",
          visibility: attachment.visibility ?? "internal_only"
        }))
      );
      setDetailDraftAttachments([]);
      setDetailUploadOpen(false);
      messageApi.success("附件已上传");
    } catch (error) {
      messageApi.error(attachmentUploadErrorMessage(error));
    } finally {
      setDetailAttachmentSubmitting(false);
    }
  };

  const openMaterialRecord = (order: OrderRecord) => {
    setMaterialRecordOrder(order);
    setMaterialRecordAttachments([]);
  };

  const submitMaterialRecord = async () => {
    if (!materialRecordOrder || materialRecordAttachments.length === 0) {
      messageApi.warning("请先拍照或选择面辅料记录附件");
      return;
    }
    const invalidFileName = materialRecordAttachments
      .map(attachmentFileNameError)
      .find((error) => error !== undefined);
    if (invalidFileName) {
      messageApi.warning(invalidFileName);
      return;
    }

    setMaterialRecordSubmitting(true);
    try {
      await addReceiverOrderAttachments(
        materialRecordOrder,
        materialRecordAttachments.map(normalizeAttachmentFileName).map((attachment) => ({
          ...attachment,
          category: "receiver_material_record",
          visibility: attachment.visibility ?? "internal_only"
        }))
      );
      messageApi.success("面辅料记录已上传");
      setMaterialRecordAttachments([]);
    } catch (error) {
      messageApi.error(attachmentUploadErrorMessage(error));
    } finally {
      setMaterialRecordSubmitting(false);
    }
  };

  const downloadReceiverOrderAttachment = async (order: OrderRecord, attachment: OrderAttachment) => {
    const blob = await sampleRoomApi.downloadReceiverOrderAttachment(session, order.id, attachment.id);
    downloadBlob(blob, attachment.fileName);
  };

  const openDownloadedAttachment = async (load: () => Promise<Blob>, fileName: string) => {
    const target = window.open("", "_blank");
    if (!target) {
      messageApi.warning("浏览器阻止了打开附件，请允许本站打开新窗口");
      return;
    }
    target.document.title = fileName;
    target.document.body.textContent = "正在下载附件并交给默认应用打开…";
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
      messageApi.error(error instanceof Error ? error.message : "附件打开失败");
    }
  };

  const deleteReceiverOrderAttachment = async (order: OrderRecord, attachment: OrderAttachment) => {
    await sampleRoomApi.deleteReceiverOrderAttachment(session, order.id, attachment.id);
    await loadOrders();
  };

  const loadReceiverOrderAttachmentPreview = (order: OrderRecord, attachment: OrderAttachment) =>
    sampleRoomApi.downloadReceiverOrderAttachment(session, order.id, attachment.id);

  const correctionAction = (order: OrderRecord, primary = false) => (
    <Button type={primary ? "primary" : "default"} size="small" onClick={() => {
      if (!blockTerminatedOrder(order)) setCorrectingOrder(order);
    }}>
      校正资料
    </Button>
  );

  const openOrderDetail = async (order: OrderRecord) => {
    if (blockTerminatedOrder(order)) return;
    setInspectingOrderId(order.id);
    setActiveOrderDetailTab("overview");
    setActiveOrderRecordSections(["scan-records"]);
    setDetailDraftAttachments([]);
    setDetailUploadOpen(false);
    setDetailAttachmentKeyword("");
    setDetailAttachmentSource("all");
    try {
      const result = await sampleRoomApi.listOrderCharges(session, "receiver", order.id);
      setChargesByOrder((current) => ({ ...current, [order.id]: result.charges }));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "费用记录加载失败");
    }
  };

  const openChargeDialog = async (order: OrderRecord) => {
    if (blockTerminatedOrder(order)) return;
    setChargeOrder(order);
    try {
      const result = await sampleRoomApi.listOrderCharges(session, "receiver", order.id);
      setChargesByOrder((current) => ({ ...current, [order.id]: result.charges }));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "费用记录加载失败");
    }
  };

  const receiverListActions = (order: OrderRecord) => order.terminated ? (
    <Button danger size="small" onClick={() => blockTerminatedOrder(order)}>已终止</Button>
  ) : (
    <Space direction="vertical" size={4} className="receiver-row-actions">
      <Button size="small" onClick={() => setCorrectingOrder(order)}>校正资料</Button>
      <Button size="small" loading={b1PrintBusy} disabled={!canShowOrderScanLink(order)} onClick={() => void printSingleOrder(order)}>打印二维码</Button>
      <Button size="small" onClick={() => void openChargeDialog(order)}>其他费用 {order.chargeCount ?? 0}</Button>
      <Button size="small" onClick={() => openMaterialRecord(order)}>面辅料记录 {order.materialRecordCount ?? 0}</Button>
    </Space>
  );

  const receiverStatusControl = (
    order: OrderRecord,
    value: MaterialStatus
  ) => (
    <Button type="text" size="small" className="receiver-status-control" onClick={() => {
      if (!blockTerminatedOrder(order)) openTrackingEdit(order);
    }}>
      <MaterialTag value={value} />
    </Button>
  );

  const orderThumbnail = (order: OrderRecord) => order.terminated
    ? <Tag color="red">已终止</Tag>
    : <OrderAttachmentThumbnail order={order} loadPreview={loadReceiverOrderAttachmentPreview} />;

  const pendingRowActions = (order: OrderRecord) => (
    <Space direction="vertical" size={2} className="row-action-stack">
      {correctionAction(order, true)}
      {order.sourceType === "client_submission" ? (
        <Button size="small" onClick={() => openReturn(order)}>
          退回补充
        </Button>
      ) : null}
    </Space>
  );

  const renderOrderOverview = (order: OrderRecord) => {
    const source = getReceiverOrderSourceParts(order);
    const sampleRequests = order.sampleRequestItems ?? [];
    const hasPhysicalProduction = hasPhysicalProductionRoute(order.sampleRequestItems);

    return (
      <Space direction="vertical" size={12} className="full-width order-detail-tab-scroll">
        <div className="receiver-detail-overview-grid">
          <div className="receiver-detail-overview-card">
            <Typography.Text type="secondary">数量</Typography.Text>
            <Typography.Text strong>{hasPhysicalProduction ? `${order.quantity} 件` : "N/A"}</Typography.Text>
          </div>
          <div className="receiver-detail-overview-card">
            <Typography.Text type="secondary">样品类型 / 轮次</Typography.Text>
            <Space wrap>
              <SampleTypeTag value={order.sampleType} />
              <SampleRoundTag value={order.sampleRound} />
            </Space>
          </div>
          <div className="receiver-detail-overview-card">
            <Typography.Text type="secondary">期望交期</Typography.Text>
            <Typography.Text strong>{formatDeliveryDate(order.deliveryDate)}</Typography.Text>
          </div>
        </div>
        <div className="receiver-detail-wide-card receiver-detail-progress-card">
          <Typography.Text type="secondary">订单进度</Typography.Text>
          <ParallelProgress
            compact={true}
            stacked
            sampleRequestItems={order.sampleRequestItems}
            stage={order.stage}
            {...(order.patternTask ? { patternTask: order.patternTask } : {})}
          />
        </div>
        <div className="receiver-detail-overview-paired-grid">
          <div className="receiver-detail-wide-card receiver-detail-order-information-card">
            <Typography.Text strong>订单信息</Typography.Text>
            <div className="receiver-detail-order-information-grid">
              <div><Typography.Text type="secondary">录入时间</Typography.Text><Typography.Text>{formatEntryDate(order.createdAt)}</Typography.Text></div>
              <div><Typography.Text type="secondary">订单来源</Typography.Text><Typography.Text>{source.label}</Typography.Text></div>
              <div><Typography.Text type="secondary">录入人</Typography.Text><Typography.Text>{order.createdByName ?? order.createdBy ?? "-"}</Typography.Text></div>
            </div>
          </div>
          <div className="receiver-detail-wide-card">
            <Typography.Text strong>打样要求</Typography.Text>
            {sampleRequests.length > 0 ? (
              <Space wrap>
                {sampleRequests.map((item) => (
                  <Tag color="blue" key={item}>
                    {sampleRequestLabel(item)}
                  </Tag>
                ))}
              </Space>
            ) : (
              <Typography.Text type="secondary">暂无打样要求</Typography.Text>
            )}
          </div>
        </div>
        <div className="receiver-detail-wide-card">
          <Typography.Text strong>备注</Typography.Text>
          <Typography.Paragraph className="receiver-detail-remark">{order.remark || "无"}</Typography.Paragraph>
        </div>
      </Space>
    );
  };

  const renderOrderCharges = (order: OrderRecord) => (
    <OrderChargeReadOnlyPanel
        charges={chargesByOrder[order.id] ?? []}
        currentUserId={session.userId}
        tabletLayout={tablet}
        onEdit={async (charge, payload) => {
          const result = await sampleRoomApi.updateOrderCharge(
            session,
            "receiver",
            charge.orderId,
            charge.id,
            payload
          );
          setChargesByOrder((current) => ({
            ...current,
            [order.id]: (current[order.id] ?? []).map((item) =>
              item.id === result.charge.id ? result.charge : item
            )
          }));
        }}
        onDelete={async (charge) => {
          await sampleRoomApi.deleteOrderCharge(session, "receiver", charge.orderId, charge.id);
          setChargesByOrder((current) => ({
            ...current,
            [order.id]: (current[order.id] ?? []).filter((item) => item.id !== charge.id)
          }));
        }}
        onRenameAttachment={async (charge, attachmentId, displayName) => {
          const result = await sampleRoomApi.renameOrderChargeAttachment(
            session,
            "receiver",
            charge.orderId,
            charge.id,
            attachmentId,
            displayName
          );
          setChargesByOrder((current) => ({
            ...current,
            [order.id]: (current[order.id] ?? []).map((item) =>
              item.id === result.charge.id ? result.charge : item
            )
          }));
        }}
        onAddAttachments={async (charge, attachments) => {
          const result = await sampleRoomApi.addOrderChargeAttachments(
            session,
            "receiver",
            charge.orderId,
            charge.id,
            attachments
          );
          setChargesByOrder((current) => ({
            ...current,
            [order.id]: (current[order.id] ?? []).map((item) =>
              item.id === result.charge.id ? result.charge : item
            )
          }));
        }}
        onDeleteAttachment={async (charge, attachmentId) => {
          const result = await sampleRoomApi.deleteOrderChargeAttachment(
            session,
            "receiver",
            charge.orderId,
            charge.id,
            attachmentId
          );
          setChargesByOrder((current) => ({
            ...current,
            [order.id]: (current[order.id] ?? []).map((item) =>
              item.id === result.charge.id ? result.charge : item
            )
          }));
        }}
        loadAttachmentBlob={(attachment) =>
          sampleRoomApi.downloadReceiverOrderAttachment(session, order.id, attachment.id)
        }
      />
  );

  const renderOrderAttachmentsLegacy = (order: OrderRecord) => {
    const attachments = order.attachments ?? [];
    const deliverables = (order.patternTask?.deliverables ?? []).filter((item) => item.fileName);
    const roleLabels: Record<string, string> = {
      boss: "老板",
      client_admin: "客户主管",
      client_business_user: "客户业务员",
      receiver: "接单员",
      planner: "计划员",
      pattern_maker: "版师",
      worker: "组检 / 出库"
    };
    const rows = [
      ...attachments.map((attachment) => ({
        key: `attachment-${attachment.id}`,
        id: attachment.id,
        kind: "attachment" as const,
        fileName: attachment.fileName,
        taskCategory: attachment.patternTaskCategory,
        uploadedBy: attachment.uploadedBy,
        uploadedByName: attachment.uploadedByName,
        uploadedByRole: attachment.uploadedByRole,
        createdAt: attachment.createdAt,
        hasFile: attachment.hasFile,
        mimeType: attachment.mimeType,
        attachment
      })),
      ...deliverables.map((deliverable) => ({
        key: `deliverable-${deliverable.id}`,
        id: deliverable.id,
        kind: "deliverable" as const,
        fileName: deliverable.fileName ?? `${deliverable.version}-${deliverable.type}`,
        taskCategory: deliverable.taskCategory,
        uploadedBy: deliverable.uploadedBy,
        uploadedByName: deliverable.uploadedByName,
        uploadedByRole: "pattern_maker",
        createdAt: deliverable.createdAt,
        hasFile: deliverable.hasFile,
        mimeType: deliverable.mimeType,
        deliverable
      }))
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const normalizedKeyword = detailAttachmentKeyword.trim().toLocaleLowerCase("zh-CN");
    const filteredRows = rows.filter((row) => {
      if (detailAttachmentSource !== "all" && row.uploadedByRole !== detailAttachmentSource) {
        return false;
      }
      if (!normalizedKeyword) {
        return true;
      }
      return [row.fileName, row.uploadedByName, row.uploadedBy, row.taskCategory]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedKeyword));
    });
    const logs = order.attachmentLogs ?? [];

    return (
      <Space direction="vertical" size={12} className="full-width">
        <div className="receiver-attachment-toolbar">
          <Input.Search
            allowClear
            value={detailAttachmentKeyword}
            placeholder="搜索文件名、上传人或任务类别"
            onChange={(event) => setDetailAttachmentKeyword(event.target.value)}
          />
          <Select
            value={detailAttachmentSource}
            aria-label="筛选附件来源"
            options={[
              { label: "全部来源", value: "all" },
              { label: "老板", value: "boss" },
              { label: "客户主管", value: "client_admin" },
              { label: "客户业务员", value: "client_business_user" },
              { label: "接单员", value: "receiver" },
              { label: "计划员", value: "planner" },
              { label: "版师", value: "pattern_maker" },
              { label: "组检 / 出库", value: "worker" }
            ]}
            onChange={setDetailAttachmentSource}
          />
          <Button type="primary" onClick={() => setDetailUploadOpen((open) => !open)}>
            上传附件
          </Button>
        </div>
        {detailUploadOpen ? (
          <div className="receiver-attachment-upload-section">
              <ClientAttachmentPicker
                value={detailDraftAttachments}
                onChange={setDetailDraftAttachments}
                showCamera={false}
                defaultCategory="receiver_attachment"
                defaultVisibility="internal_only"
                showVisibilityChoice
                accept=""
                title="拖拽、粘贴或点击选择文件"
                description=""
              />
              <Button
                type="primary"
                loading={detailAttachmentSubmitting}
                disabled={detailDraftAttachments.length === 0}
                onClick={() => void submitDetailAttachments(order)}
              >
                确认上传
              </Button>
          </div>
        ) : null}
        <Table
          className="receiver-unified-attachment-table"
          size="small"
          tableLayout="fixed"
          rowKey="key"
          dataSource={filteredRows}
          scroll={{ x: 825, y: 320 }}
          locale={{
            emptyText: <div className="receiver-attachment-empty"><strong>暂无附件</strong><span>点击“上传附件”补充订单资料。</span></div>
          }}
          pagination={{
            pageSize: 8,
            showSizeChanger: false,
            showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 个附件`
          }}
          columns={[
            {
              title: "文件名",
              dataIndex: "fileName",
              width: 270,
              render: (fileName: string, row) => (
                <Space size={6} wrap>
                  {row.hasFile ? <Button type="link" className="receiver-attachment-name" onClick={() => {
                    if (row.kind === "attachment") {
                      void downloadReceiverOrderAttachment(order, row.attachment);
                    } else {
                      void sampleRoomApi.downloadReceiverPatternDeliverable(session, order.id, row.deliverable.id)
                        .then((blob) => downloadBlob(blob, row.fileName))
                        .catch((error) => messageApi.error(error instanceof Error ? error.message : "版师附件下载失败"));
                    }
                  }}>{fileName}</Button> : <Typography.Text className="receiver-attachment-name">{fileName}</Typography.Text>}
                  {row.taskCategory ? <Tag color="purple">{sampleRequestLabel(row.taskCategory)}</Tag> : null}
                  {row.uploadedByRole === "receiver" ? <Tag color="blue">接单员上传</Tag> : null}
                  {row.kind === "attachment" && row.attachment.category === "receiver_material_record" ? (
                    <Tag color="gold">面辅料记录</Tag>
                  ) : row.uploadedByRole === "receiver" ? (
                    <Tag color="cyan">打样单相关</Tag>
                  ) : null}
                </Space>
              )
            },
            {
              title: "上传角色",
              dataIndex: "uploadedByRole",
              width: 120,
              responsive: ["md"],
              render: (role?: string) => roleLabels[role ?? ""] ?? role ?? "-"
            },
            {
              title: "上传人",
              dataIndex: "uploadedByName",
              width: 140,
              responsive: ["md"],
              render: (_name: string | undefined, row) => attachmentUploaderLabel(row)
            },
            {
              title: "上传信息",
              key: "uploader",
              width: 190,
              responsive: ["xs", "sm"],
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text>{roleLabels[row.uploadedByRole ?? ""] ?? row.uploadedByRole ?? "-"}</Typography.Text>
                  <Typography.Text type="secondary">{attachmentUploaderLabel(row)}</Typography.Text>
                </Space>
              )
            },
            { title: "上传时间", dataIndex: "createdAt", width: 165, render: formatEntryDate },
            {
              title: "操作",
              key: "actions",
              width: 130,
              fixed: "right",
              render: (_, row) => (
                <Space size={4}>
                  {row.hasFile && isSafeAttachmentPreviewMime(row.mimeType) ? <Button size="small" onClick={() => {
                    if (row.kind === "attachment") {
                      void openDownloadedAttachment(
                        () => sampleRoomApi.downloadReceiverOrderAttachment(session, order.id, row.attachment.id),
                        row.fileName
                      );
                    } else {
                      void openDownloadedAttachment(
                        () => sampleRoomApi.downloadReceiverPatternDeliverable(session, order.id, row.deliverable.id),
                        row.fileName
                      );
                    }
                  }}>预览</Button> : null}
                  {row.hasFile ? <Button size="small" onClick={() => {
                    if (row.kind === "attachment") {
                      void downloadReceiverOrderAttachment(order, row.attachment);
                    } else {
                      void sampleRoomApi.downloadReceiverPatternDeliverable(session, order.id, row.deliverable.id)
                        .then((blob) => downloadBlob(blob, row.fileName));
                    }
                  }}>下载</Button> : null}
                  {row.kind === "attachment" && row.uploadedBy === session.userId ? (
                    <Button danger size="small" onClick={() => Modal.confirm({
                      title: "确认删除附件？",
                      content: <>文件：{row.fileName}<br />删除后，附件将从列表中移除，但操作会永久保留在附件日志中。</>,
                      okText: "确认删除",
                      cancelText: "取消",
                      okButtonProps: { danger: true },
                      onOk: () => deleteReceiverOrderAttachment(order, row.attachment)
                    })}>删除</Button>
                  ) : null}
                </Space>
              )
            }
          ]}
        />
        <Collapse
          size="small"
          className="receiver-attachment-log-collapse"
          items={[
            {
              key: "attachment-log",
              label: `附件日志（${logs.length}）`,
              children:
                logs.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无附件日志" />
                ) : (
                  <div className="receiver-attachment-log-list">
                    {logs.map((log) => (
                      <div className="attachment-log-row" key={log.id}>
                        <Space direction="vertical" size={2}>
                          <Typography.Text strong>{log.action === "upload" ? "上传" : "删除"} · {log.originalFileName}</Typography.Text>
                          <Typography.Text type="secondary">
                            {roleLabels[log.actorRole] ?? log.actorRole} · {log.actorName ?? log.actorId} · {formatEntryDate(log.createdAt)}
                            {log.patternTaskCategory ? ` · ${sampleRequestLabel(log.patternTaskCategory)}` : ""}
                          </Typography.Text>
                        </Space>
                      </div>
                    ))}
                  </div>
                )
            }
          ]}
        />
      </Space>
    );
  };

  const renderOrderAttachments = (order: OrderRecord) => {
    const attachments = order.attachments ?? [];
    const deliverables = (order.patternTask?.deliverables ?? []).filter((item) => item.fileName);

    return (
      <OrderAttachmentPanel
          key={order.id}
          workspace
          defaultCategory="receiver_attachment"
          defaultVisibility="internal_only"
          showVisibilityChoice
          onUpload={(drafts) => addReceiverOrderAttachments(
            order,
            drafts.map((attachment) => ({
              ...attachment,
              category: "receiver_attachment",
              visibility: attachment.visibility ?? "internal_only"
            }))
          )}
          attachments={attachments}
          deliverables={deliverables}
          logs={order.attachmentLogs ?? []}
          currentUserId={session.userId}
          currentRole={session.role}
          showPageSizeChanger={tablet}
          showLogs={!tablet}
          onRenameAttachment={async (attachment, displayName) => {
            await sampleRoomApi.renameReceiverOrderAttachment(
              session,
              order.id,
              attachment.id,
              displayName
            );
            await loadOrders();
          }}
          onDeleteAttachment={(attachment) => deleteReceiverOrderAttachment(order, attachment)}
          onChangeAttachmentVisibility={async (attachment, visibility) => {
            const result = await sampleRoomApi.changeReceiverOrderAttachmentVisibility(
              session,
              order.id,
              attachment.id,
              visibility
            );
            replaceOrderAttachments(order.id, result.attachments);
            await loadOrders();
          }}
          loadPreview={(row) =>
            sampleRoomApi.downloadReceiverOrderAttachment(session, order.id, row.id)
          }
          loadDeliverablePreview={(deliverable) =>
            sampleRoomApi.downloadReceiverPatternDeliverable(session, order.id, deliverable.id)
          }
      />
    );
  };

  const setOrderRecordSectionActive = (key: string, active: boolean) => {
    setActiveOrderRecordSections((current) => {
      if (active) return current.includes(key) ? current : [...current, key];
      return current.filter((item) => item !== key);
    });
  };

  const renderOrderRecords = (order: OrderRecord) => {
    const scanRecordsActive = activeOrderRecordSections.includes("scan-records");
    const correctionLogActive = activeOrderRecordSections.includes("correction-log");

    return (
      <div className="full-width order-detail-records-tab">
        <div className={`order-detail-record-section${scanRecordsActive ? " is-expanded" : " is-collapsed"}`}>
          <Collapse
            size="small"
            className="order-records-collapse order-records-scan-collapse"
            activeKey={scanRecordsActive ? ["scan-records"] : []}
            onChange={(keys) => {
              const activeKeys = Array.isArray(keys) ? keys : [keys];
              setOrderRecordSectionActive("scan-records", activeKeys.includes("scan-records"));
            }}
            items={[
              {
                key: "scan-records",
                label: "扫码记录",
                children: <OrderScanRecordsPanel order={order} session={session} variant="timeline" />
              }
            ]}
          />
        </div>
        <div className={`order-detail-record-section${correctionLogActive ? " is-expanded" : " is-collapsed"}`}>
          <ReceiverCorrectionLog
            logs={order.correctionLogs}
            active={correctionLogActive}
            onActiveChange={(active) => setOrderRecordSectionActive("correction-log", active)}
          />
        </div>
        <Typography.Text className="order-detail-records-note" type="secondary">
          此处仅展示扫码记录与订单资料修改记录，供查看与追溯。
        </Typography.Text>
      </div>
    );
  };

  const tabLabel = (name: string, filteredCount: number, totalCount: number) =>
    filteredCount === totalCount ? `${name} ${totalCount}` : `${name} ${filteredCount}/${totalCount}`;

  const statusPreview = (
    <div className="receiver-status-preview" aria-label="接单员订单状态预览">
      {receiverStatusPreviewItems.map((item) => (
        <div className={`receiver-status-preview-item receiver-status-preview-${item.tone}`} key={item.label}>
          <Typography.Text type="secondary">{item.label}</Typography.Text>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );

  const selectedOrderPanel = (order?: OrderRecord) => {
    if (!order) {
      return null;
    }
    const hasPhysicalProduction = hasPhysicalProductionRoute(order.sampleRequestItems);

    return (
      <div className="receiver-order-detail-dialog" aria-label="订单详情">
        <div className="receiver-detail-hero">
          {orderThumbnail(order)}
          <Space direction="vertical" size={8} className="receiver-detail-hero-copy">
            <Typography.Title level={3}>{order.styleNo}</Typography.Title>
            <Typography.Text>{order.styleName}</Typography.Text>
            <div className="receiver-detail-hero-meta">
              <span><Typography.Text type="secondary">接单日期</Typography.Text><strong>{formatEntryDate(order.receivedAt ?? order.createdAt)}</strong></span>
              <span><Typography.Text type="secondary">客户</Typography.Text><strong>{getOrderCustomerName(order)}</strong></span>
              <span><Typography.Text type="secondary">业务员</Typography.Text><strong>{getReceiverBusinessUserDisplayName(order)}</strong></span>
            </div>
            <Space wrap className="receiver-detail-status-tags">
              <SampleTypeTag value={order.sampleType} />
              <SampleRoundTag value={order.sampleRound} />
              <IntakeTag value={order.intakeStatus} />
              <StageTag value={order.stage} {...(order.stageLabel ? { label: order.stageLabel } : {})} />
              {hasPhysicalProduction ? <MaterialTag value={order.fabricStatus} /> : <Tag>N/A · 面里料</Tag>}
              {hasPhysicalProduction ? <MaterialTag value={order.trimStatus} /> : <Tag>N/A · 辅料</Tag>}
            </Space>
          </Space>
        </div>
        <Tabs
          activeKey={activeOrderDetailTab}
          onChange={setActiveOrderDetailTab}
          items={[
            {
              key: "overview",
              label: "订单概览",
              children: renderOrderOverview(order)
            },
            {
              key: "attachments",
              label: `资料与附件 ${(order.attachments?.length ?? 0) + (order.patternTask?.deliverables?.length ?? 0)}`,
              children: renderOrderAttachments(order)
            },
            ...(tablet ? [{
              key: "attachment-logs",
              label: `附件日志 ${order.attachmentLogs?.length ?? 0}`,
              children: (
                <div className="order-detail-attachment-log-tab">
                  <AttachmentLogList logs={order.attachmentLogs ?? []} />
                </div>
              )
            }] : []),
            {
              key: "charges",
              label: `其他费用 ${(chargesByOrder[order.id] ?? []).length}`,
              children: renderOrderCharges(order)
            },
            {
              key: "records",
              label: "记录",
              children: renderOrderRecords(order)
            }
          ]}
        />
      </div>
    );
  };

  return (
    <div className={`receiver-workbench full-width${tablet ? " receiver-tablet-workbench" : ""}${tablet && activeTab !== "self-entry" ? " receiver-tablet-list-state" : ""}${tablet && activeTab === "self-entry" ? " receiver-tablet-entry-state" : ""}`}>
      {contextHolder}
      {tablet ? (
        <>
          <TabletWorkbenchHeader roleLabel="接单员" onScan={startTabletScan} scanning={tabletScanLoading} />
          <Segmented
            block
            size="large"
            className="receiver-tablet-navigation"
            value={activeTab}
            onChange={(value) => changeTab(value as ReceiverTab)}
            options={[
              { label: "订单录入", value: "self-entry" },
              { label: "待接单", value: "pending" },
              { label: "订单列表", value: "list" }
            ]}
          />
          <Card size="small" className="receiver-tablet-status-card">{statusPreview}</Card>
        </>
      ) : <Card className="section-card receiver-overview-card">
        <div className="receiver-overview-head">
          <Space direction="vertical" size={2}>
            <Typography.Text className="role-task-room-eyebrow">接单员工作间</Typography.Text>
            <Typography.Title level={3}>接单员工作台</Typography.Title>
          </Space>
          <Tag color="blue">V2 操作台</Tag>
        </div>
        {statusPreview}
      </Card>}

      {activeTab !== "self-entry" ? (
        <Card className="section-card receiver-filter-card">
          <Space direction="vertical" size={8} className="full-width">
            <OrderDesktopFilterBar
              orders={allOrders}
              filters={filters}
              onChange={changeReceiverFilters}
              defaultFilters={getReceiverTabDefaultFilters(activeTab)}
            />
            {activeTab === "list" ? (
              <Select
                value={entryUserFilter}
                options={entryUserOptions}
                onChange={setEntryUserFilter}
                style={{ width: 220 }}
              />
            ) : null}
          </Space>
        </Card>
      ) : null}

      <Card className="section-card receiver-tabs-card">
        <Tabs
          className="receiver-workbench-tabs"
          tabBarStyle={{ display: "none" }}
          activeKey={activeTab}
          onChange={changeTab}
          items={[
            {
              key: "self-entry",
              label: "订单录入",
              children: (
                <div className="receiver-intake-entry">
                  {tablet ? <div className="receiver-intake-mode-bar">
                    <Segmented
                      value={selfEntryMode}
                      onChange={(value) => setSelfEntryMode(value as "quick" | "full")}
                      options={[{ label: "完整录入", value: "full" }, { label: "拍照简录", value: "quick" }]}
                    />
                    <Button
                      type="primary"
                      loading={selfEntrySubmitting}
                      onClick={() => selfEntryMode === "quick" ? selfEntryForm.submit() : fullEntryForm.submit()}
                    >
                      {selfEntryMode === "quick" ? "生成待校正订单" : "创建正式订单"}
                    </Button>
                  </div> : (
                    <Segmented
                      value={selfEntryMode}
                      onChange={(value) => setSelfEntryMode(value as "quick" | "full")}
                      options={[{ label: "完整录入", value: "full" }, { label: "拍照简录", value: "quick" }]}
                    />
                  )}
                  {selfEntryMode === "quick" ? (
                    <Form
                      form={selfEntryForm}
                      layout="vertical"
                      initialValues={{ quantity: 1, sampleRequestItems: DEFAULT_SAMPLE_REQUEST_ITEMS, remark: "" }}
                      onFinish={(values) => void submitSelfEntry(values)}
                      className="receiver-intake-form receiver-quick-entry-form"
                    >
                      <div className="receiver-intake-main">
                        <div className="receiver-intake-fields">
                          <div className="form-grid receiver-quick-customer-grid">
                            <Form.Item label="客户" name="customerId" rules={[{ required: true, message: "请选择客户" }]}>
                              <Select options={customerOptions} onChange={(customerId) => {
                                const clientUserId = selfEntryCustomers.find((customer) => customer.id === customerId)?.clientUsers[0]?.id;
                                selfEntryForm.setFieldValue("clientUserId", clientUserId);
                              }} />
                            </Form.Item>
                            <Form.Item label="客户业务员" name="clientUserId" rules={[{ required: true, message: "请选择客户业务员" }]}>
                              <Select options={clientUserOptions} />
                            </Form.Item>
                            <Form.Item
                              label="数量"
                              name="quantity"
                              rules={[
                                { required: true, message: "请输入正整数数量" },
                                {
                                  validator: (_, value) =>
                                    Number.isInteger(value) && value > 0
                                      ? Promise.resolve()
                                      : Promise.reject(new Error("请输入正整数数量"))
                                }
                              ]}
                            >
                              <InputNumber {...integerInputProps} min={1} precision={0} className="full-width" />
                            </Form.Item>
                          </div>
                          <Form.Item label="打样要求（可多选，至少选择 1 项）" name="sampleRequestItems" rules={[{ required: true, type: "array", min: 1, message: "请至少选择一项打样要求" }]}>
                            <ReceiverSampleRequestSection />
                          </Form.Item>
                          <Form.Item className="receiver-intake-remark" label="备注（选填）" name="remark">
                            <Input.TextArea rows={5} />
                          </Form.Item>
                        </div>
                        <ReceiverIntakeAttachmentWorkspace value={quickEntryAttachments} onChange={setQuickEntryAttachments} tablet={tablet} />
                      </div>
                      {!tablet ? <div className="receiver-intake-submit-row">
                        <Button type="primary" htmlType="submit" loading={selfEntrySubmitting}>生成待校正订单</Button>
                      </div> : null}
                    </Form>
                  ) : (
                    <Form
                      form={fullEntryForm}
                      layout="vertical"
                      initialValues={createDefaultReceiverSelfEntryValues()}
                      onFinish={(values) => void submitFullSelfEntry(values)}
                      className="receiver-intake-form receiver-full-entry-form"
                    >
                      <div className="receiver-intake-main">
                        <div className="receiver-intake-fields">
                          <div className="form-grid receiver-full-fields-grid">
                            <Form.Item label="客户" name="customerId" rules={[{ required: true }]}>
                              <Select options={customerOptions} onChange={(customerId) => {
                                const clientUserId = selfEntryCustomers.find((customer) => customer.id === customerId)?.clientUsers[0]?.id;
                                fullEntryForm.setFieldValue("clientUserId", clientUserId);
                              }} />
                            </Form.Item>
                            <Form.Item label="客户业务员" name="clientUserId" rules={[{ required: true }]}><Select options={fullClientUserOptions} /></Form.Item>
                            <Form.Item label="款号" name="styleNo" rules={[{ required: true }]}><Input /></Form.Item>
                            <Form.Item label="款名" name="styleName" rules={[{ required: true }]}><Input /></Form.Item>
                            <Form.Item label="数量" name="quantity" rules={[{ required: true }]}><InputNumber {...integerInputProps} min={1} precision={0} className="full-width" /></Form.Item>
                            <Form.Item label="样品类型" name="sampleType" rules={[{ required: true }]}><Select options={sampleTypeOptions} /></Form.Item>
                            <Form.Item label="样品轮次" name="sampleRound" rules={[{ required: true }]}><Select options={sampleRoundOptions} /></Form.Item>
                            <Form.Item label="期望交期" name="deliveryDate" rules={[{ required: true }]}><Input type="date" /></Form.Item>
                            <Form.Item label="面里料状态" name="fabricStatus" rules={[{ required: true }]}><Select options={fabricOptions} /></Form.Item>
                            <Form.Item label="辅料状态" name="trimStatus" rules={[{ required: true }]}><Select options={trimOptions} /></Form.Item>
                          </div>
                          <Form.Item label="打样要求（可多选，至少选择 1 项）" name="sampleRequestItems" rules={[{ required: true, type: "array", min: 1, message: "请至少选择一项打样要求" }]}>
                            <ReceiverSampleRequestSection />
                          </Form.Item>
                          <Form.Item className="receiver-intake-remark" label="备注（选填）" name="remark"><Input.TextArea rows={3} /></Form.Item>
                        </div>
                        <ReceiverIntakeAttachmentWorkspace value={fullEntryAttachments} onChange={setFullEntryAttachments} tablet={tablet} />
                      </div>
                      {!tablet ? <div className="receiver-intake-submit-row">
                        <Button type="primary" htmlType="submit" loading={selfEntrySubmitting}>创建正式订单</Button>
                      </div> : null}
                    </Form>
                  )}
                </div>
              )
            },
            {
              key: "pending",
              label: tabLabel("待校正订单", filteredPendingOrders.length, pendingOrders.length),
              children: (
                <div className="receiver-list-panel receiver-full-list-panel">
                  <Typography.Text type="secondary" className="receiver-list-hint">
                    客户提交和接单员拍照简录的待校正订单集中在这里；单击订单行可直接校正资料。
                  </Typography.Text>
                  <OrderTable
                    orders={filteredPendingOrders}
                    loading={loading}
                    actions={pendingRowActions}
                    titleThumbnail={orderThumbnail}
                    compact
                    pageSize={12}
                    showPageSizeChanger
                    workspace
                    pageSizeStorageKey="sample-room:receiver-pending-orders:page-size"
                    scrollX={1260}
                    onOrderClick={(order) => setCorrectingOrder(order)}
                  />
                </div>
              )
            },
            {
              key: "list",
              label: tabLabel("订单列表", filteredQueryOrders.length, receiverOrderListOrders.length),
              children: (
                <div className="receiver-list-panel receiver-full-list-panel">
                    <div className="receiver-query-head">
                      <Space direction="vertical" size={2}>
                        <Typography.Text type="secondary" className="receiver-list-hint">
                          单击订单行打开订单详情；勾选框只用于批量打印二维码、生成 PDF 二维码或导出 Excel。
                        </Typography.Text>
                        {exportDataset.scope === "selected" ? (
                          <Typography.Text type="secondary">已选择 {exportDataset.orders.length} 条</Typography.Text>
                        ) : null}
                      </Space>
                      <Space wrap>
                        <Button onClick={() => setPrintSettingsOpen(true)}>
                          打印设置
                        </Button>
                        <Button
                          loading={batchScanPrintLoading}
                          disabled={selectedQueryOrders.length === 0}
                          onClick={() => void openBatchScanPrint()}
                        >
                          批量打印二维码
                        </Button>
                        <Button
                          loading={batchScanPrintLoading}
                          disabled={selectedQueryOrders.length === 0}
                          onClick={() => void openBatchQrPdfPreview()}
                        >
                          批量打印 PDF 二维码
                        </Button>
                        <Button type="primary" onClick={() => setExportDialogOpen(true)}>
                          导出 Excel
                        </Button>
                      </Space>
                    </div>
                    <OrderTable
                      orders={filteredQueryOrders}
                      loading={loading}
                      titleThumbnail={orderThumbnail}
                      actions={receiverListActions}
                      compact
                      pageSize={12}
                      showPageSizeChanger
                      workspace
                      pageSizeStorageKey="sample-room:receiver-orders:page-size"
                      scrollX={1260}
                      selectable
                      selectedRowKeys={selectedQueryRowKeys}
                      onSelectedRowKeysChange={setSelectedQueryRowKeys}
                      onOrderClick={openOrderDetail}
                      intakeStatusRender={(order) => order.terminated
                        ? <Tag color="red">已终止</Tag>
                        : <IntakeTag value={order.intakeStatus} />}
                      fabricStatusRender={(order) => receiverStatusControl(order, order.fabricStatus)}
                      trimStatusRender={(order) => receiverStatusControl(order, order.trimStatus)}
                      rowClassName={(order) =>
                        order.terminated
                          ? "receiver-order-row-terminated"
                          : order.id === inspectingOrder?.id ? "receiver-order-row-selected" : ""
                      }
                    />
                </div>
              )
            }
          ]}
        />
      </Card>

      <Modal
        title="退回客户补充"
        open={Boolean(returningOrder)}
        onCancel={() => setReturningOrder(null)}
        onOk={() => void submitReturn()}
        okText="确认退回"
        cancelText="取消"
      >
        <Form form={returnForm} layout="vertical">
          <Form.Item
            label="退回原因"
            name="returnReason"
            rules={[{ required: true, message: "请输入退回原因" }]}
          >
            <Input.TextArea rows={4} placeholder="说明客户需要补充或修改的资料" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="维护订单状态"
        open={Boolean(editingOrder)}
        onCancel={() => setEditingOrder(null)}
        onOk={() => void submitTrackingPatch()}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" size={12} className="full-width">
          <Space direction="vertical" className="full-width">
            <Typography.Text>面里料状态</Typography.Text>
            <Select
              value={trackingDraft.fabricStatus ?? null}
              options={fabricOptions}
              onChange={(fabricStatus) =>
                setTrackingDraft((draft) => ({ ...draft, fabricStatus: fabricStatus as MaterialStatus }))
              }
              className="full-width"
            />
          </Space>
          <Space direction="vertical" className="full-width">
            <Typography.Text>辅料状态</Typography.Text>
            <Select
              value={trackingDraft.trimStatus ?? null}
              options={trimOptions}
              onChange={(trimStatus) =>
                setTrackingDraft((draft) => ({ ...draft, trimStatus: trimStatus as MaterialStatus }))
              }
              className="full-width"
            />
          </Space>
          <Space direction="vertical" className="full-width">
            <Typography.Text>备注</Typography.Text>
            <Input.TextArea
              rows={3}
              value={trackingDraft.remark}
              onChange={(event) => setTrackingDraft((draft) => ({ ...draft, remark: event.target.value }))}
            />
          </Space>
        </Space>
      </Modal>

      <ReceiverPrintSettingsModal
        open={printSettingsOpen}
        session={session}
        onCancel={() => setPrintSettingsOpen(false)}
        onSaved={setPrintSettings}
      />

      <Modal
        title="已定位订单"
        open={Boolean(tabletScannedOrder)}
        closable={false}
        maskClosable={false}
        footer={null}
        width={560}
      >
        {tabletScannedOrder ? (
          <Space direction="vertical" size={16} className="full-width">
            <div className="tablet-scan-order-summary">
              <Typography.Title level={4}>{tabletScannedOrder.styleNo} · {tabletScannedOrder.styleName}</Typography.Title>
              <Typography.Text>客户：{getOrderCustomerName(tabletScannedOrder)}</Typography.Text>
              <Typography.Text>业务员：{getReceiverBusinessUserDisplayName(tabletScannedOrder)}</Typography.Text>
            </div>
            <Button type="primary" size="large" block onClick={() => {
              setChargeOrder(tabletScannedOrder);
              setTabletScannedOrder(null);
            }}>其他费用 {tabletScannedOrder.chargeCount ?? 0}</Button>
            <Button size="large" block onClick={() => {
              openMaterialRecord(tabletScannedOrder);
              setTabletScannedOrder(null);
            }}>面辅料记录 {tabletScannedOrder.materialRecordCount ?? 0}</Button>
            <Button size="large" block onClick={() => setTabletScannedOrder(null)}>取消</Button>
          </Space>
        ) : null}
      </Modal>

      <Modal
        title="批量打印订单流转二维码"
        open={batchScanPrintOpen}
        width={920}
        onCancel={() => setBatchScanPrintOpen(false)}
        destroyOnHidden
        footer={[
          <Button key="close" onClick={() => setBatchScanPrintOpen(false)}>
            关闭
          </Button>,
          <Button
            key="print"
            type="primary"
            loading={b1PrintBusy}
            onClick={() => void printB1Items(batchScanPrintItems).then(() => setBatchScanPrintOpen(false)).catch(() => undefined)}
          >
            打印
          </Button>
        ]}
      >
        <Space direction="vertical" size={12} className="full-width">
          <Typography.Text type="secondary">
            工人需先绑定身份。裁剪、组检完成时扫码一次；缝制开始和完成各扫码一次。
          </Typography.Text>
          <Typography.Text strong>
            共 {batchScanPrintItems.length} 个订单 × {receiverLabelCopies(printSettings)} 份 = {batchScanPrintItems.length * receiverLabelCopies(printSettings)} 张标签
          </Typography.Text>
          {batchScanPrintItems[0] ? (
            <ReceiverLabelPreview
              settings={printSettings}
              order={receiverLabelOrder(batchScanPrintItems[0].order, batchScanPrintItems[0].scanValue)}
            />
          ) : null}
        </Space>
      </Modal>

      <Modal
        title="批量打印 PDF 二维码预览"
        open={batchQrPdfPreviewOpen}
        width={900}
        className="receiver-qr-pdf-preview-modal"
        onCancel={() => setBatchQrPdfPreviewOpen(false)}
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={() => setBatchQrPdfPreviewOpen(false)}>取消</Button>,
          <Button key="confirm" type="primary" loading={batchQrPdfSaving} onClick={() => void confirmBatchQrPdf()}>
            确认并输出 PDF
          </Button>
        ]}
      >
        <Typography.Paragraph type="secondary">
          预览和 PDF 均使用当前打印设置；确认后按真实标签尺寸自动排在 A4 页面上，供普通打印机临时使用。
        </Typography.Paragraph>
        <Typography.Paragraph strong>
          共 {batchQrPdfPreviewItems.length} 个订单 × {receiverLabelCopies(printSettings)} 份 = {batchQrPdfPreviewItems.length * receiverLabelCopies(printSettings)} 张标签
        </Typography.Paragraph>
        <div className="receiver-qr-pdf-preview-grid">
          {Array.from({ length: receiverLabelCopies(printSettings) }, (_, copyIndex) =>
            batchQrPdfPreviewItems.map(({ order, scanValue }) => (
              <div className="receiver-qr-pdf-preview-item" key={`${order.id}-${copyIndex}`}>
                <ReceiverLabelPreview settings={printSettings} order={receiverLabelOrder(order, scanValue)} compact />
              </div>
            ))
          )}
        </div>
      </Modal>

      <Modal
        title="订单详情"
        open={Boolean(inspectingOrder)}
        footer={<Button onClick={() => setInspectingOrderId(undefined)}>关闭</Button>}
        width={tablet ? "calc(100vw - 32px)" : 1080}
        className="receiver-order-detail-modal order-detail-fixed-height-modal"
        onCancel={() => setInspectingOrderId(undefined)}
        destroyOnHidden
      >
        {selectedOrderPanel(inspectingOrder)}
      </Modal>

      <Modal
        title="添加面辅料记录"
        open={Boolean(materialRecordOrder)}
        width={viewportBoundDialogWidth("business")}
        className="app-workspace-modal app-workspace-modal-data receiver-material-record-modal"
        onCancel={() => {
          setMaterialRecordOrder(null);
          setMaterialRecordAttachments([]);
        }}
        footer={<Button key="cancel" onClick={() => {
            setMaterialRecordOrder(null);
            setMaterialRecordAttachments([]);
          }}>
            取消
          </Button>}
        destroyOnHidden
      >
        {currentMaterialRecordOrder ? <Space direction="vertical" size={14} className="full-width receiver-material-record-workspace">
          <section className="receiver-material-record-order-summary">
            {orderThumbnail(currentMaterialRecordOrder)}
            <div><Typography.Text type="secondary">款号</Typography.Text><strong>{currentMaterialRecordOrder.styleNo || "-"}</strong></div>
            <div><Typography.Text type="secondary">款名</Typography.Text><strong>{currentMaterialRecordOrder.styleName || "-"}</strong></div>
            <div><Typography.Text type="secondary">客户</Typography.Text><strong>{getOrderCustomerName(currentMaterialRecordOrder)}</strong></div>
            <div><Typography.Text type="secondary">客户业务员</Typography.Text><strong>{getReceiverBusinessUserDisplayName(currentMaterialRecordOrder)}</strong></div>
            <div><Typography.Text type="secondary">接单状态</Typography.Text><IntakeTag value={currentMaterialRecordOrder.intakeStatus} /></div>
          </section>
          <section className="receiver-material-record-section">
            <Typography.Title level={5}>新增面辅料记录</Typography.Title>
            <Typography.Paragraph type="secondary">
              默认仅内部可见，也可为每个文件设置客户可见；上传前可预览、改名或删除。
            </Typography.Paragraph>
            <ClientAttachmentPicker
              value={materialRecordAttachments}
              onChange={setMaterialRecordAttachments}
              showCamera={false}
              compact
              compactLabel="选择待上传文件"
              compactTrailingAction={<Button
                type="primary"
                loading={materialRecordSubmitting}
                disabled={
                  materialRecordAttachments.length === 0 ||
                  materialRecordAttachments.some((attachment) => Boolean(attachmentFileNameError(attachment)))
                }
                onClick={() => void submitMaterialRecord()}
              >上传记录</Button>}
              defaultCategory="receiver_material_record"
              defaultVisibility="internal_only"
              showVisibilityChoice
              accept=""
              allowRename
              allowPreview
            />
          </section>
          <section className="receiver-material-record-section">
            <Typography.Title level={5}>已登记的面辅料记录（{(currentMaterialRecordOrder.attachments ?? []).filter((attachment) => attachment.category === "receiver_material_record").length} 条）</Typography.Title>
            <UnifiedAttachmentTable
            attachments={(currentMaterialRecordOrder.attachments ?? []).filter((attachment) => attachment.category === "receiver_material_record")}
            currentUserId={session.userId}
            currentRole={session.role}
            compact
            simple
            workspace
            showLogs={false}
            loadPreview={(row) => sampleRoomApi.downloadReceiverOrderAttachment(session, currentMaterialRecordOrder.id, row.id)}
            onRenameAttachment={async (attachment, displayName) => {
              const result = await sampleRoomApi.renameReceiverOrderAttachment(session, currentMaterialRecordOrder.id, attachment.id, displayName);
              replaceOrderAttachments(currentMaterialRecordOrder.id, result.attachments);
            }}
            onDeleteAttachment={async (attachment) => {
              const result = await sampleRoomApi.deleteReceiverOrderAttachment(session, currentMaterialRecordOrder.id, attachment.id);
              replaceOrderAttachments(currentMaterialRecordOrder.id, result.attachments);
            }}
          />
          </section>
        </Space> : null}
      </Modal>

      <ReceiverCorrectionModal
        open={Boolean(correctingOrder)}
        order={correctingOrder}
        onCancel={() => setCorrectingOrder(null)}
        onSubmit={submitCorrection}
        onDownloadAttachment={downloadReceiverOrderAttachment}
        onLoadAttachmentPreview={loadReceiverOrderAttachmentPreview}
        currentUserId={session.userId}
        onUploadSampleSheet={uploadReceiverSampleSheet}
        onSelectSampleSheet={selectReceiverSampleSheet}
      />

      <ReceiverOrderChargeModal
        order={chargeOrder}
        thumbnail={chargeOrder ? orderThumbnail(chargeOrder) : null}
        charges={chargeOrder ? chargesByOrder[chargeOrder.id] ?? [] : []}
        role="receiver"
        onCancel={() => setChargeOrder(null)}
        onChargesChange={(charges) => {
          if (!chargeOrder) return;
          setChargesByOrder((current) => ({
            ...current,
            [chargeOrder.id]: charges
          }));
          void loadOrders({ silent: true });
        }}
      />

      <OrderExportDialog
        open={exportDialogOpen}
        role="receiver"
        orders={exportDataset.orders}
        filters={filters}
        exportScope={exportDataset.scope}
        onCancel={() => setExportDialogOpen(false)}
        onExported={() => setExportDialogOpen(false)}
      />
    </div>
  );
}
