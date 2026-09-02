import type { OrderRecord } from "../../api/sampleRoomApi";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function formatOrderDate(value?: string, options: { includeTime?: boolean } = {}) {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.replaceAll("-", "/");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const dateText = `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
  if (!options.includeTime) {
    return dateText;
  }

  return `${dateText} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatEntryDate(value?: string) {
  return formatOrderDate(value, { includeTime: true }) || "未记录";
}

export function formatDeliveryDate(value?: string) {
  return formatOrderDate(value) || "未填交期";
}

export function getOrderBusinessUserName(order: OrderRecord) {
  return order.salespersonName ?? order.clientUserSnapshot?.displayName ?? order.clientUserId ?? "-";
}

export function getOrderCustomerName(order: OrderRecord) {
  return order.customerName ?? order.customerSnapshot?.name ?? "-";
}

export function getOrderEntrySourceLabel(order: OrderRecord) {
  if (order.sourceType === "client_submission") {
    const context = [getOrderCustomerName(order), getOrderBusinessUserName(order)]
      .filter((value) => value && value !== "-")
      .join(" / ");
    return context ? `客户提交 · ${context}` : "客户提交";
  }

  if (order.sourceType === "internal_manual") {
    return order.createdByName ? `内部录入 · ${order.createdByName}` : "内部录入";
  }

  if (order.sourceType === "receiver_self_entry") {
    return order.createdByName ? `接单员录入 · ${order.createdByName}` : "接单员录入";
  }

  return order.createdByName ? `内部录入 · ${order.createdByName}` : "内部录入";
}

export function getOrderReceiverLabel(order: OrderRecord) {
  return order.receivedByName ? `接单人：${order.receivedByName}` : "接单人未知";
}
