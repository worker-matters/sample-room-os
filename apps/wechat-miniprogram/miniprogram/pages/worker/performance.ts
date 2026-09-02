import type { MiniappGlobalData } from "../../app";
import { getOwnPerformance } from "../../services/apiClient";
import { requireMobileApiContext } from "../../services/mobileSession";
import type { WorkerPerformance } from "../../types/contracts";

type Period = "week" | "month" | "threeMonths" | "custom";
type DisplayRecord = WorkerPerformance["records"][number] & {
  completedDate: string;
  qualityScoreLabel: string;
  complaintLabel: string;
};

const workerLabels = {
  cutting: "裁剪",
  sewing: "缝制",
  qc_delivery: "组检 / 出库"
} as const;

const dateText = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function defaultRange(period: Period) {
  const now = new Date();
  const from = new Date(now);
  if (period === "week") {
    const weekday = now.getDay() || 7;
    from.setDate(now.getDate() - weekday + 1);
  } else if (period === "month" || period === "custom") {
    from.setDate(1);
  } else {
    from.setMonth(now.getMonth() - 3);
    from.setDate(from.getDate() + 1);
  }
  return { dateFrom: dateText(from), dateTo: dateText(now) };
}

Page({
  data: {
    period: "week" as Period,
    report: null as WorkerPerformance | null,
    records: [] as DisplayRecord[],
    workerLabel: "",
    workerType: "cutting" as WorkerPerformance["worker"]["workerType"],
    hourlyOutput: "0.00",
    averageQualityScore: "-",
    unratedOrders: 0,
    complaintRate: "0.00",
    dateFrom: defaultRange("custom").dateFrom,
    dateTo: defaultRange("custom").dateTo,
    loading: false,
    message: ""
  },

  onShow() {
    void this.load();
  },

  async load() {
    this.setData({ loading: true, message: "" });
    try {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const context = await requireMobileApiContext(app.globalData, ["worker"]);
      const range = this.data.period === "custom"
        ? { dateFrom: this.data.dateFrom, dateTo: this.data.dateTo }
        : defaultRange(this.data.period);
      if (range.dateFrom > range.dateTo) {
        throw new Error("开始日期不能晚于结束日期");
      }
      const report = await getOwnPerformance(
        context.baseUrl,
        context.sessionToken,
        `dateFrom=${range.dateFrom}&dateTo=${range.dateTo}`
      );
      const hourlyOutput = report.summary.hourlyOutput ??
        (report.summary.totalHours > 0
          ? report.summary.completedPieces / report.summary.totalHours
          : 0);
      this.setData({
        report,
        records: report.records.map((item) => ({
          ...item,
          completedDate: item.completedAt.slice(0, 10),
          qualityScoreLabel: item.qualityScore === null || item.qualityScore === undefined
            ? "未评分"
            : item.qualityScore.toFixed(1),
          complaintLabel: (item.complaintCount ?? 0) > 0
            ? `${item.complaintCount} 条`
            : "无"
        })),
        workerLabel: workerLabels[report.worker.workerType],
        workerType: report.worker.workerType,
        hourlyOutput: hourlyOutput.toFixed(2),
        averageQualityScore: report.summary.averageQualityScore === undefined
          ? "-"
          : report.summary.averageQualityScore.toFixed(1),
        unratedOrders: report.summary.unratedOrders ?? 0,
        complaintRate: (report.summary.complaintRate ?? 0).toFixed(2)
      });
    } catch (error) {
      this.setData({ message: error instanceof Error ? error.message : "绩效加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  changePeriod(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.period);
    const period: Period =
      value === "month" || value === "threeMonths" || value === "custom" ? value : "week";
    this.setData({ period });
    void this.load();
  },

  changeDate(event: WechatMiniprogram.PickerChange) {
    this.setData({ [String(event.currentTarget.dataset.field)]: String(event.detail.value) });
  },

  applyCustomRange() {
    void this.load();
  }
});
