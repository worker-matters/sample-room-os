import type { ReceiverOrderSummary } from "../types/contracts";

export const sampleTypeOptions = [
  { label: "初样", value: "first_sample" },
  { label: "试身样", value: "fit_sample" },
  { label: "修改样", value: "revision_sample" },
  { label: "产前样", value: "pre_production_sample" }
] as const;

export const sampleRoundOptions = [
  { label: "第 1 轮", value: "round_1" },
  { label: "第 2 轮", value: "round_2" },
  { label: "第 3 轮", value: "round_3" },
  { label: "第 4 轮", value: "round_4" }
] as const;

export const materialStatusOptions = [
  { label: "未齐", value: "missing" },
  { label: "部分到", value: "partial" },
  { label: "全齐", value: "complete" }
] as const;

export const sampleRequestItemOptions = [
  { label: "生产样衣", value: "sample_garment" },
  { label: "生产小样", value: "sample_small" },
  { label: "制版", value: "pattern_making" },
  { label: "改版", value: "pattern_revision" },
  { label: "推全码版", value: "pattern_full_size" },
  { label: "报价核料", value: "quote_material_check" },
  { label: "大货核料", value: "bulk_material_check" },
  { label: "充棉/绒量", value: "pattern_padding_amount" },
  { label: "核拉链长度", value: "pattern_zipper_length" },
  { label: "裁剪", value: "cutting" }
] as const;

export const defaultSampleRequestItems = ["sample_garment", "cutting", "pattern_making"];

export const stageLabels: Record<string, string> = {
  pending_receive: "待接单",
  pattern_waiting: "待制版",
  pattern_doing: "制版中",
  cutting_waiting: "待裁剪",
  cutting_doing: "裁剪中",
  sewing_waiting: "待缝制",
  sewing_doing: "缝制中",
  qc_delivery_waiting: "待组检/出库",
  done: "已完成"
};

export const optionLabel = (options: ReadonlyArray<{ label: string; value: string }>, value: string) =>
  options.find((option) => option.value === value)?.label ?? value;

export const formatEntryDate = (value: string) => value.slice(0, 10);

export function splitDisplayFileName(fileName: string) {
  const normalized = fileName.replace(/\\/g, "/").split("/").pop() || fileName;
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === normalized.length - 1) {
    return { baseName: normalized, extension: "" };
  }
  return {
    baseName: normalized.slice(0, dotIndex),
    extension: normalized.slice(dotIndex)
  };
}

export function validateDisplayFileBaseName(baseName: string, extension: string) {
  const value = baseName.trim();
  if (!value) return "文件名不能为空";
  if (value === "." || value === ".." || value.includes("..")) return "文件名不能包含路径跳转符号";
  if (/[\\/:*?"<>|\u0000-\u001F]/.test(value)) return "文件名不能包含路径或不安全字符";
  if (/[. ]$/.test(value)) return "文件名不能以句点或空格结尾";
  if (!extension && value.includes(".")) return "不能通过文件名修改扩展名";
  if (`${value}${extension}`.length > 120) return "文件名不能超过 120 个字符";
  return "";
}

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function receiverDateRange(type: "week" | "month" | "quarter", now = new Date()) {
  const start = new Date(now);
  const end = new Date(now);
  if (type === "week") {
    const day = start.getDay() === 0 ? 7 : start.getDay();
    start.setDate(start.getDate() - day + 1);
    end.setDate(start.getDate() + 6);
  } else if (type === "quarter") {
    start.setMonth(start.getMonth() - 2);
    start.setDate(1);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
  } else {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1);
    end.setDate(0);
  }
  return { startDate: dateKey(start), endDate: dateKey(end) };
}

export type ReceiverOrderFilters = {
  keyword: string;
  customerId: string;
  salespersonId: string;
  sampleRound: string;
  sampleType: string;
  fabricStatus: string;
  trimStatus: string;
  status: string;
  startDate: string;
  endDate: string;
  deliveryStartDate: string;
  deliveryEndDate: string;
};

export const emptyReceiverOrderFilters = (): ReceiverOrderFilters => ({
  keyword: "",
  customerId: "",
  salespersonId: "",
  sampleRound: "",
  sampleType: "",
  fabricStatus: "",
  trimStatus: "",
  status: "",
  startDate: "",
  endDate: "",
  deliveryStartDate: "",
  deliveryEndDate: ""
});

export function filterReceiverOrders(orders: ReceiverOrderSummary[], filters: ReceiverOrderFilters) {
  const keyword = filters.keyword.trim().toLowerCase();
  return orders.filter((order) => {
    if (keyword && ![
      order.styleNo,
      order.styleName,
      order.orderNo,
      order.customerName,
      order.salespersonName,
      order.remark ?? ""
    ]
      .some((value) => value.toLowerCase().includes(keyword))) return false;
    if (filters.customerId && order.customerId !== filters.customerId) return false;
    if (filters.salespersonId && order.salespersonId !== filters.salespersonId) return false;
    if (filters.sampleRound && order.sampleRound !== filters.sampleRound) return false;
    if (filters.sampleType && order.sampleType !== filters.sampleType) return false;
    if (filters.fabricStatus && order.fabricStatus !== filters.fabricStatus) return false;
    if (filters.trimStatus && order.trimStatus !== filters.trimStatus) return false;
    if (filters.status === "receiverActiveTracking" && (!order.stage || order.stage === "done")) return false;
    if (filters.status && filters.status !== "receiverActiveTracking" && order.stage !== filters.status) return false;
    const createdDate = formatEntryDate(order.createdAt);
    if (filters.startDate && createdDate < filters.startDate) return false;
    if (filters.endDate && createdDate > filters.endDate) return false;
    if (filters.deliveryStartDate && order.deliveryDate < filters.deliveryStartDate) return false;
    if (filters.deliveryEndDate && order.deliveryDate > filters.deliveryEndDate) return false;
    return true;
  });
}
