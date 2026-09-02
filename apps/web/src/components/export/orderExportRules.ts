import {
  deriveOrderCompletionStatus,
  fabricStatusOptions,
  intakeStatusOptions,
  orderStageOptions,
  trimStatusOptions
} from "@sample-room/shared";
import type { OrderRecord } from "../../api/sampleRoomApi";
import {
  formatDeliveryDate,
  formatOrderDate,
  getOrderBusinessUserName,
  getOrderCustomerName
} from "../orders/orderDisplay";
import {
  orderStatusFilterOptions,
  type OrderFilters
} from "../orders/orderFilters";

export type OrderExportRole = "receiver" | "client";
export type OrderExportScope = "selected" | "filtered" | "all";

export type OrderExportColumn = {
  key: string;
  title: string;
  optional?: boolean;
  getValue: (order: OrderRecord) => string | number;
};

export type OrderExportProfile = {
  role: OrderExportRole;
  title: string;
  sheetName: string;
  defaultColumns: OrderExportColumn[];
  optionalColumns: OrderExportColumn[];
  defaultFilename: string;
  noFilterExample: string;
  rangeLabel: string;
};

function labelFromOptions(options: Array<{ label: string; value: string }>, value?: string | null) {
  if (!value) {
    return "";
  }

  return options.find((option) => option.value === value)?.label ?? value;
}

function compactDate(value?: string) {
  return formatOrderDate(value) || "";
}

function compactDateTime(value?: string) {
  return formatOrderDate(value, { includeTime: true }) || "";
}

function attachmentNames(order: OrderRecord) {
  return order.attachments?.map((attachment) => attachment.fileName).join("; ") ?? "";
}

function recentlyUpdatedBy(order: OrderRecord) {
  return order.returnedBy ?? order.receivedBy ?? "";
}

function isCompleted(order: OrderRecord) {
  return (
    order.completionStatus ??
    deriveOrderCompletionStatus({
      sampleRequestItems: order.sampleRequestItems,
      orderStage: order.stage,
      patternTaskStatus: order.patternTask?.status
    })
  ) === "completed";
}

function isPastDeliveryDate(order: OrderRecord, now = new Date()) {
  if (!order.deliveryDate || isCompleted(order)) {
    return false;
  }

  const delivery = new Date(`${order.deliveryDate}T23:59:59`);
  return Number.isFinite(delivery.getTime()) && delivery < now;
}

function completionStatus(order: OrderRecord) {
  if (order.completionStatus === "production_completed_pattern_pending") {
    return "生产已完成，版师任务未完成";
  }

  if (order.completionStatus === "pattern_only_pending") {
    return "仅版师任务，尚未完成";
  }

  if (isCompleted(order)) {
    return "已完成";
  }

  if (isPastDeliveryDate(order)) {
    return "逾期未完成";
  }

  return "未完成";
}

function missingText() {
  return "未填写";
}

function emptyFutureField() {
  // TODO: Fill from completion, delivery, document-location, and scan modules after those migrations land.
  return "";
}

export const receiverDefaultExportColumns: OrderExportColumn[] = [
  { key: "styleNo", title: "款号", getValue: (order) => order.styleNo },
  { key: "styleName", title: "款名", getValue: (order) => order.styleName },
  { key: "customer", title: "客户", getValue: getOrderCustomerName },
  { key: "businessUser", title: "客户业务员", getValue: getOrderBusinessUserName },
  { key: "quantity", title: "下单数量", getValue: (order) => order.quantity },
  { key: "deliveredQuantity", title: "实际交货数量", getValue: emptyFutureField },
  { key: "createdAt", title: "录入日期", getValue: (order) => compactDateTime(order.createdAt) },
  { key: "receivedAt", title: "接单时间", getValue: (order) => compactDateTime(order.receivedAt) },
  { key: "deliveryDate", title: "交期", getValue: (order) => formatDeliveryDate(order.deliveryDate) },
  { key: "completedAt", title: "实际完成日期", getValue: emptyFutureField },
  { key: "intakeStatus", title: "接单状态", getValue: (order) => labelFromOptions(intakeStatusOptions, order.intakeStatus) },
  { key: "stage", title: "工序阶段", getValue: (order) => labelFromOptions(orderStageOptions, order.stage) },
  { key: "fabricStatus", title: "面里料状态", getValue: (order) => labelFromOptions(fabricStatusOptions, order.fabricStatus) },
  { key: "trimStatus", title: "辅料状态", getValue: (order) => labelFromOptions(trimStatusOptions, order.trimStatus) },
  { key: "documentLocation", title: "单据位置", getValue: emptyFutureField },
  { key: "attachmentCount", title: "附件数量", getValue: (order) => order.attachmentCount },
  { key: "updatedBy", title: "最近操作人 / 最近更新人", getValue: recentlyUpdatedBy }
];

export const receiverOptionalExportColumns: OrderExportColumn[] = [
  { key: "attachmentNames", title: "附件名称列表", optional: true, getValue: attachmentNames },
  { key: "remark", title: "备注", optional: true, getValue: (order) => order.remark ?? "" },
  { key: "returnReason", title: "退回补充原因", optional: true, getValue: (order) => order.returnReason ?? "" },
  { key: "completionRemark", title: "完成备注", optional: true, getValue: emptyFutureField },
  { key: "scanSummary", title: "扫码记录摘要", optional: true, getValue: emptyFutureField },
  { key: "updatedAt", title: "最近更新时间", optional: true, getValue: (order) => compactDateTime(order.updatedAt) }
];

export const clientDefaultExportColumns: OrderExportColumn[] = [
  { key: "businessUser", title: "客户业务员", getValue: getOrderBusinessUserName },
  { key: "styleNo", title: "款号", getValue: (order) => order.styleNo },
  { key: "styleName", title: "款名", getValue: (order) => order.styleName },
  { key: "quantity", title: "下单数量", getValue: (order) => order.quantity },
  { key: "deliveredQuantity", title: "实际交货数量", getValue: emptyFutureField },
  { key: "createdAt", title: "下单日期", getValue: (order) => compactDate(order.createdAt) },
  { key: "receivedAt", title: "接单时间", getValue: (order) => compactDateTime(order.receivedAt) },
  { key: "deliveryDate", title: "交期", getValue: (order) => formatDeliveryDate(order.deliveryDate) },
  { key: "completedAt", title: "实际完成日期", getValue: emptyFutureField },
  { key: "completionStatus", title: "完成情况", getValue: completionStatus },
  { key: "deliveryMethod", title: "送达方式", getValue: missingText },
  { key: "deliveryRemark", title: "快递单号 / 送达备注", getValue: missingText }
];

export const clientOptionalExportColumns: OrderExportColumn[] = [
  { key: "intakeStatus", title: "接单状态", optional: true, getValue: (order) => labelFromOptions(intakeStatusOptions, order.intakeStatus) },
  { key: "stage", title: "工序阶段", optional: true, getValue: (order) => labelFromOptions(orderStageOptions, order.stage) },
  { key: "fabricStatus", title: "面里料状态", optional: true, getValue: (order) => labelFromOptions(fabricStatusOptions, order.fabricStatus) },
  { key: "trimStatus", title: "辅料状态", optional: true, getValue: (order) => labelFromOptions(trimStatusOptions, order.trimStatus) },
  { key: "attachmentCount", title: "附件数量", optional: true, getValue: (order) => order.attachmentCount },
  { key: "remark", title: "备注", optional: true, getValue: (order) => order.remark ?? "" },
  { key: "returnReason", title: "退回补充原因", optional: true, getValue: (order) => order.returnReason ?? "" },
  { key: "completionRemark", title: "完成备注", optional: true, getValue: emptyFutureField }
];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function formatExportDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatExportTime(date = new Date()) {
  return `${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function isFilterActive(filters: OrderFilters) {
  return Boolean(
    filters.keyword.trim() ||
      filters.customerId ||
      filters.salespersonId ||
      filters.status ||
      filters.sampleType ||
      filters.sampleRound ||
      filters.startDate ||
      filters.endDate ||
      filters.quickDateRange
  );
}

export function sanitizeFilenamePart(value: string) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function ensureXlsxExtension(filename: string) {
  const trimmed = filename.trim() || "orders.xlsx";
  return /\.xlsx$/i.test(trimmed) ? trimmed : `${trimmed.replace(/\.+$/g, "")}.xlsx`;
}

function statusLabel(filters: OrderFilters) {
  if (!filters.status) {
    return "";
  }

  const label = orderStatusFilterOptions.find((option) => option.value === filters.status)?.label ?? filters.status;
  return sanitizeFilenamePart(label.replace(/^(接单|工序|版子|面里料|辅料)[：:]/, ""));
}

function dateRangeSummary(filters: OrderFilters) {
  if (filters.startDate && filters.endDate) {
    return `${filters.startDate}_to_${filters.endDate}`;
  }

  return filters.startDate ?? filters.endDate ?? "";
}

export function buildReceiverExportFilename(filters: OrderFilters, now = new Date()) {
  const date = formatExportDate(now);
  const time = formatExportTime(now);

  if (!isFilterActive(filters)) {
    return `接单员_订单全量_${date}_${time}.xlsx`;
  }

  const parts = ["接单员", "订单查询"];
  const status = statusLabel(filters);
  const range = dateRangeSummary(filters);
  if (status) {
    parts.push(status);
  }
  if (range) {
    parts.push(range);
  }
  if (!status && !range) {
    parts.push("筛选结果");
  }
  if (range) {
    parts.push(time);
  } else {
    parts.push(date, time);
  }
  return `${parts.map(sanitizeFilenamePart).filter(Boolean).join("_")}.xlsx`;
}

export function buildReceiverSelectedExportFilename(now = new Date()) {
  return `接单员_勾选订单_${formatExportDate(now)}_${formatExportTime(now)}.xlsx`;
}

export function buildClientExportFilename(
  filters: OrderFilters,
  customerName: string,
  now = new Date()
) {
  const safeCustomer = sanitizeFilenamePart(customerName || "客户");
  const date = formatExportDate(now);
  const time = formatExportTime(now);
  const status = statusLabel(filters);
  const range = dateRangeSummary(filters);

  if (!isFilterActive(filters)) {
    return `${safeCustomer}_订单全量_${date}_${time}.xlsx`;
  }

  if (range) {
    const scope = status ? `${status}订单` : "订单查询";
    return `${safeCustomer}_${sanitizeFilenamePart(scope)}_${range}_${time}.xlsx`;
  }

  if (status) {
    return `${safeCustomer}_${status}订单_${date}_${time}.xlsx`;
  }

  return `${safeCustomer}_订单查询_${date}_${time}.xlsx`;
}

export function buildClientSelectedExportFilename(customerName: string, now = new Date()) {
  const safeCustomer = sanitizeFilenamePart(customerName || "客户");
  return `${safeCustomer}_勾选订单_${formatExportDate(now)}_${formatExportTime(now)}.xlsx`;
}

export function exportRows(orders: OrderRecord[], columns: OrderExportColumn[]) {
  return [
    columns.map((column) => column.title),
    ...orders.map((order) => columns.map((column) => column.getValue(order)))
  ];
}

export function resolveOrderExportDataset(
  visibleOrders: OrderRecord[],
  selectedRowKeys: unknown[],
  filters: OrderFilters
) {
  const selectedKeySet = new Set(selectedRowKeys.map(String));
  const selectedOrders = visibleOrders.filter((order) => selectedKeySet.has(order.id));

  if (selectedOrders.length > 0) {
    return {
      orders: selectedOrders,
      scope: "selected" as const
    };
  }

  return {
    orders: visibleOrders,
    scope: isFilterActive(filters) ? ("filtered" as const) : ("all" as const)
  };
}

export function buildOrderExportProfile({
  role,
  filters,
  customerName,
  exportScope
}: {
  role: OrderExportRole;
  filters: OrderFilters;
  customerName?: string;
  exportScope?: OrderExportScope;
}): OrderExportProfile {
  const scope = exportScope ?? (isFilterActive(filters) ? "filtered" : "all");

  if (role === "receiver") {
    return {
      role,
      title: "接单员导出设置",
      sheetName: "接单员订单查询",
      defaultColumns: receiverDefaultExportColumns,
      optionalColumns: receiverOptionalExportColumns,
      defaultFilename:
        scope === "selected" ? buildReceiverSelectedExportFilename() : buildReceiverExportFilename(filters),
      noFilterExample: buildReceiverExportFilename({ keyword: "" }),
      rangeLabel:
        scope === "selected" ? "已勾选订单" : scope === "filtered" ? "当前筛选结果" : "当前可见全量"
    };
  }

  return {
    role,
    title: "客户导出设置",
    sheetName: "客户订单查询",
    defaultColumns: clientDefaultExportColumns,
    optionalColumns: clientOptionalExportColumns,
    defaultFilename:
      scope === "selected"
        ? buildClientSelectedExportFilename(customerName ?? "客户")
        : buildClientExportFilename(filters, customerName ?? "客户"),
    noFilterExample: buildClientExportFilename({ keyword: "" }, customerName ?? "客户"),
    rangeLabel:
      scope === "selected" ? "已勾选订单" : scope === "filtered" ? "当前筛选结果" : "当前可见全量"
  };
}
