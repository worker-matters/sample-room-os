export type BossPerformanceQuickRange = "week" | "month" | "three_months";

export function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function bossPerformanceQuickRangeDates(
  range: BossPerformanceQuickRange,
  now = new Date()
) {
  const to = new Date(now);
  let from: Date;
  if (range === "week") {
    const day = to.getDay() || 7;
    from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - day + 1);
  } else if (range === "month") {
    from = new Date(to.getFullYear(), to.getMonth(), 1);
  } else {
    from = new Date(to.getFullYear(), to.getMonth() - 3, to.getDate());
  }
  return { dateFrom: localDateKey(from), dateTo: localDateKey(to) };
}
