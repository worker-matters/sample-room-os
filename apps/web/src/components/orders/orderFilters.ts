import {
  fabricStatusOptions,
  intakeStatusOptions,
  ORDER_STAGES,
  orderStageOptions,
  sampleRoundOptions,
  trimStatusOptions
} from "@sample-room/shared";
import type { OrderRecord } from "../../api/sampleRoomApi";

export type QuickDateRange = "today" | "week" | "month" | "quarter";

export type OrderFilters = {
  keyword: string;
  customerId?: string | undefined;
  salespersonId?: string | undefined;
  status?: string | undefined;
  sampleType?: string | undefined;
  sampleRound?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  deliveryStartDate?: string | undefined;
  deliveryEndDate?: string | undefined;
  patternStatus?: string | undefined;
  fabricStatus?: string | undefined;
  trimStatus?: string | undefined;
  quickDateRange?: QuickDateRange | undefined;
};

export const defaultOrderFilters: OrderFilters = {
  keyword: ""
};

export function createDefaultOrderFilters(): OrderFilters {
  return { ...defaultOrderFilters };
}

export type FilterOption = {
  label: string;
  value: string;
};

export const orderStatusFilterOptions: FilterOption[] = [
  {
    label: "进行中 / 待跟踪",
    value: "receiverActiveTracking"
  },
  ...intakeStatusOptions.map((option) => ({
    label: `接单：${option.label}`,
    value: `intakeStatus:${option.value}`
  })),
  ...orderStageOptions.map((option) => ({
    label: `工序：${option.label}`,
    value: `stage:${option.value}`
  })),
  ...fabricStatusOptions.map((option) => ({
    label: `面里料：${option.label}`,
    value: `fabricStatus:${option.value}`
  })),
  ...trimStatusOptions.map((option) => ({
    label: `辅料：${option.label}`,
    value: `trimStatus:${option.value}`
  }))
];

export const clientOrderStatusFilterOptions: FilterOption[] = [
  ...intakeStatusOptions.map((option) => ({
    label: `接单：${option.label}`,
    value: `intakeStatus:${option.value}`
  })),
  ...orderStageOptions
    .filter((option) => option.value !== ORDER_STAGES.pendingReceive)
    .map((option) => ({
      label: `工序：${option.label}`,
      value: `stage:${option.value}`
    }))
];

export const clientSampleRoundFilterOptions: FilterOption[] = sampleRoundOptions.map((option) => ({
  label: option.label,
  value: option.value
}));

export const fabricStatusFilterOptions: FilterOption[] = fabricStatusOptions.map((option) => ({
  label: option.label,
  value: option.value
}));

export const trimStatusFilterOptions: FilterOption[] = trimStatusOptions.map((option) => ({
  label: option.label,
  value: option.value
}));

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getQuickDateRange(type: QuickDateRange, now = new Date()) {
  const start = new Date(now);
  const end = new Date(now);

  if (type === "today") {
    return { startDate: dateKey(start), endDate: dateKey(end) };
  }

  if (type === "week") {
    const day = start.getDay() === 0 ? 7 : start.getDay();
    start.setDate(start.getDate() - day + 1);
    end.setDate(start.getDate() + 6);
    return { startDate: dateKey(start), endDate: dateKey(end) };
  }

  if (type === "quarter") {
    start.setMonth(start.getMonth() - 2);
    start.setDate(1);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
    return { startDate: dateKey(start), endDate: dateKey(end) };
  }

  start.setDate(1);
  end.setMonth(start.getMonth() + 1);
  end.setDate(0);
  return { startDate: dateKey(start), endDate: dateKey(end) };
}

export function createCurrentMonthOrderFilters(now = new Date()): OrderFilters {
  return {
    ...defaultOrderFilters,
    ...getQuickDateRange("month", now),
    quickDateRange: "month"
  };
}

export function matchDateRange(order: OrderRecord, filters: OrderFilters) {
  if (!filters.startDate && !filters.endDate) {
    return true;
  }

  const createdDate = dateKey(new Date(order.createdAt));
  if (filters.startDate && createdDate < filters.startDate) {
    return false;
  }

  if (filters.endDate && createdDate > filters.endDate) {
    return false;
  }

  return true;
}

export function matchDeliveryDateRange(order: OrderRecord, filters: OrderFilters) {
  if (!filters.deliveryStartDate && !filters.deliveryEndDate) {
    return true;
  }

  const deliveryDate = order.deliveryDate;
  if (!deliveryDate) {
    return false;
  }

  if (filters.deliveryStartDate && deliveryDate < filters.deliveryStartDate) {
    return false;
  }

  if (filters.deliveryEndDate && deliveryDate > filters.deliveryEndDate) {
    return false;
  }

  return true;
}

function matchesKeyword(order: OrderRecord, keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [order.styleNo, order.styleName, order.orderNo, order.remark]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(normalized));
}

function matchesStatus(order: OrderRecord, status?: string) {
  if (!status) {
    return true;
  }

  if (status === "receiverActiveTracking") {
    return order.intakeStatus === "received" && order.stage !== null && order.stage !== "done";
  }

  const [field, value] = status.split(":");
  if (!field || !value) {
    return false;
  }

  if (field === "intakeStatus") {
    return order.intakeStatus === value;
  }

  if (field === "stage") {
    return order.stage === value;
  }

  if (field === "patternStatus") {
    return order.patternStatus === value;
  }

  if (field === "fabricStatus") {
    return order.fabricStatus === value;
  }

  if (field === "trimStatus") {
    return order.trimStatus === value;
  }

  return false;
}

export function filterOrders<T extends OrderRecord>(orders: T[], filters: OrderFilters): T[] {
  return orders.filter((order) => {
    if (!matchesKeyword(order, filters.keyword)) {
      return false;
    }

    if (filters.customerId && order.customerId !== filters.customerId) {
      return false;
    }

    if (filters.salespersonId && order.salespersonId !== filters.salespersonId) {
      return false;
    }

    if (filters.sampleType && order.sampleType !== filters.sampleType) {
      return false;
    }

    if (filters.sampleRound && order.sampleRound !== filters.sampleRound) {
      return false;
    }

    if (filters.patternStatus && order.patternStatus !== filters.patternStatus) {
      return false;
    }

    if (filters.fabricStatus && order.fabricStatus !== filters.fabricStatus) {
      return false;
    }

    if (filters.trimStatus && order.trimStatus !== filters.trimStatus) {
      return false;
    }

    if (!matchesStatus(order, filters.status)) {
      return false;
    }

    return matchDateRange(order, filters) && matchDeliveryDateRange(order, filters);
  });
}

export function buildCustomerOptions(orders: OrderRecord[]): FilterOption[] {
  const map = new Map<string, string>();
  for (const order of orders) {
    if (order.customerId) {
      map.set(order.customerId, order.customerName ?? order.customerSnapshot?.name ?? order.customerId);
    }
  }

  return [...map.entries()].map(([value, label]) => ({ value, label }));
}

export function buildSalespersonOptions(
  orders: OrderRecord[],
  customerId?: string
): FilterOption[] {
  const map = new Map<string, string>();
  for (const order of orders) {
    if (customerId && order.customerId !== customerId) {
      continue;
    }

    const salespersonId = order.salespersonId ?? order.clientUserId;
    if (salespersonId) {
      map.set(
        salespersonId,
        order.salespersonName ?? order.clientUserSnapshot?.displayName ?? salespersonId
      );
    }
  }

  return [...map.entries()].map(([value, label]) => ({ value, label }));
}
