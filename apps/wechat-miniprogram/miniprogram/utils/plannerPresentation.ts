import type { PlannerOrderSummary } from "../types/contracts";
import { formatEntryDate, receiverDateRange } from "./receiverPresentation";

export type PlannerFilters = {
  keyword: string;
  customerName: string;
  salespersonName: string;
  stage: string;
  sampleType: string;
  sampleRound: string;
  fabricStatus: string;
  trimStatus: string;
  startDate: string;
  endDate: string;
  deliveryStartDate: string;
  deliveryEndDate: string;
};

export const emptyPlannerFilters = (): PlannerFilters => ({
  keyword: "",
  customerName: "",
  salespersonName: "",
  stage: "",
  sampleType: "",
  sampleRound: "",
  fabricStatus: "",
  trimStatus: "",
  startDate: "",
  endDate: "",
  deliveryStartDate: "",
  deliveryEndDate: ""
});

export const plannerDateRange = receiverDateRange;

export function filterPlannerOrders(
  orders: PlannerOrderSummary[],
  filters: PlannerFilters,
  productionPlanOnly = false
) {
  const keyword = filters.keyword.trim().toLowerCase();
  return orders.filter((order) => {
    if (productionPlanOnly && order.stage !== "sewing_waiting" && order.stage !== "sewing_doing") return false;
    if (keyword && ![
      order.styleNo,
      order.styleName,
      order.orderNo,
      order.customerName,
      order.salespersonName,
      order.remark ?? ""
    ].some((value) => value.toLowerCase().includes(keyword))) return false;
    if (filters.customerName && order.customerName !== filters.customerName) return false;
    if (filters.salespersonName && order.salespersonName !== filters.salespersonName) return false;
    if (filters.stage && order.stage !== filters.stage) return false;
    if (filters.sampleType && order.sampleType !== filters.sampleType) return false;
    if (filters.sampleRound && order.sampleRound !== filters.sampleRound) return false;
    if (filters.fabricStatus && order.fabricStatus !== filters.fabricStatus) return false;
    if (filters.trimStatus && order.trimStatus !== filters.trimStatus) return false;
    const createdDate = formatEntryDate(order.createdAt);
    if (filters.startDate && createdDate < filters.startDate) return false;
    if (filters.endDate && createdDate > filters.endDate) return false;
    if (filters.deliveryStartDate && order.deliveryDate < filters.deliveryStartDate) return false;
    if (filters.deliveryEndDate && order.deliveryDate > filters.deliveryEndDate) return false;
    return true;
  });
}

export const uniquePlannerOptions = (
  orders: PlannerOrderSummary[],
  field: "customerName" | "salespersonName"
) => [...new Set(orders.map((order) => order[field]))].map((value) => ({ label: value, value }));
