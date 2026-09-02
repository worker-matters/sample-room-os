import { parseOrderQrPayload } from "@sample-room/shared";

export type QcDatePreset = "today" | "week" | "month" | "custom";

function dateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function qcDateRange(preset: QcDatePreset, now = new Date()) {
  const end = dateOnly(now);
  if (preset === "today") return { dateFrom: end, dateTo: end };
  const start = new Date(now);
  if (preset === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (preset === "month") start.setDate(1);
  return preset === "custom" ? {} : { dateFrom: dateOnly(start), dateTo: end };
}

export function qcTokenFromPayload(payload: string) {
  return parseOrderQrPayload(payload).token;
}

export function formatQcTime(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}
