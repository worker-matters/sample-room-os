import { describe, expect, it } from "vitest";
import { bossPerformanceQuickRangeDates, localDateKey } from "./bossPerformanceDates";

const strictDate = /^\d{4}-\d{2}-\d{2}$/;

describe("boss performance date ranges", () => {
  it("formats local dates as strict YYYY-MM-DD values", () => {
    expect(localDateKey(new Date(2026, 7, 5))).toBe("2026-08-05");
  });

  it.each([
    ["week", { dateFrom: "2026-08-03", dateTo: "2026-08-05" }],
    ["month", { dateFrom: "2026-08-01", dateTo: "2026-08-05" }],
    ["three_months", { dateFrom: "2026-05-05", dateTo: "2026-08-05" }]
  ] as const)("builds the %s shortcut with valid API dates", (range, expected) => {
    const dates = bossPerformanceQuickRangeDates(range, new Date(2026, 7, 5, 10));
    expect(dates).toEqual(expected);
    expect(dates.dateFrom).toMatch(strictDate);
    expect(dates.dateTo).toMatch(strictDate);
  });
});
