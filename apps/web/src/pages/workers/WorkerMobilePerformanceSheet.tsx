import {
  CalendarOutlined,
  CloseOutlined,
  ReloadOutlined,
  SearchOutlined
} from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import type { DevSession } from "../../app/DevSessionContext";
import { request } from "../../api/request";

type WorkerType = "cutting" | "sewing";
type RangePreset = "week" | "month" | "three_months" | "custom";

type PerformanceRecord = {
  orderId: string;
  scanRecordId?: string;
  styleNo: string;
  styleName: string;
  completedAt: string;
  pieces: number;
  workHours: number;
  qualityScore?: number;
  reworkCount?: number;
  complaintCount?: number;
};

type PerformanceResponse = {
  worker: {
    displayName?: string;
    workerType?: string;
  };
  summary: {
    completedOrders: number;
    completedPieces: number;
    totalHours: number;
    averageHoursPerPiece: number;
    hourlyOutput?: number;
    averageQualityScore?: number;
    unratedOrders?: number;
    checkedPieces?: number;
    complaintOrders?: number;
    complaintRate?: number;
  };
  records: PerformanceRecord[];
};

type Props = {
  open: boolean;
  session: DevSession;
  workerType: WorkerType;
  onClose: () => void;
};

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateRangeForPreset(preset: Exclude<RangePreset, "custom">) {
  const today = new Date();
  const from = new Date(today);
  if (preset === "week") {
    const day = today.getDay() || 7;
    from.setDate(today.getDate() - day + 1);
  } else if (preset === "month") {
    from.setDate(1);
  } else {
    from.setMonth(today.getMonth() - 3);
    from.setDate(from.getDate() + 1);
  }
  return { dateFrom: localDateValue(from), dateTo: localDateValue(today) };
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.replace("T", " ").slice(0, 16);
  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function metric(value: number | undefined, digits = 1) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "-";
  return Number(value.toFixed(digits)).toString();
}

export function WorkerMobilePerformanceSheet({ open, session, workerType, onClose }: Props) {
  const defaultWeek = useMemo(() => dateRangeForPreset("week"), []);
  const [preset, setPreset] = useState<RangePreset>("week");
  const [customFrom, setCustomFrom] = useState(defaultWeek.dateFrom);
  const [customTo, setCustomTo] = useState(defaultWeek.dateTo);
  const [report, setReport] = useState<PerformanceResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = async (nextPreset = preset) => {
    const range = nextPreset === "custom"
      ? { dateFrom: customFrom, dateTo: customTo }
      : dateRangeForPreset(nextPreset);
    if (!range.dateFrom || !range.dateTo) {
      setError("请选择开始和结束日期");
      return;
    }
    if (range.dateFrom > range.dateTo) {
      setError("开始日期不能晚于结束日期");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(range);
      const result = await request<PerformanceResponse>(
        session,
        `/api/miniapp/me/performance?${params.toString()}`
      );
      setReport(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "绩效加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setPreset("week");
    setQuery("");
    setReport(undefined);
    void load("week");
  }, [open]);

  const selectPreset = (nextPreset: RangePreset) => {
    setPreset(nextPreset);
    setError(null);
    if (nextPreset !== "custom") void load(nextPreset);
  };

  const filteredRecords = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return report?.records ?? [];
    return (report?.records ?? []).filter((record) =>
      `${record.styleNo} ${record.styleName}`.toLocaleLowerCase().includes(normalized)
    );
  }, [query, report]);

  if (!open) return null;

  const summary = report?.summary;
  const isSewing = workerType === "sewing";
  const cards = isSewing
    ? [
        { label: "完成订单", value: summary ? `${summary.completedOrders}` : "-" },
        { label: "完成件数", value: summary ? `${summary.completedPieces}` : "-" },
        { label: "总工时", value: summary ? `${metric(summary.totalHours)}h` : "-" },
        { label: "每小时产出", value: summary ? `${metric(summary.hourlyOutput)}件` : "-" },
        { label: "平均质检评分", value: summary ? metric(summary.averageQualityScore) : "-" },
        { label: "未评分订单", value: summary ? `${summary.unratedOrders ?? 0}` : "-" }
      ]
    : [
        { label: "完成订单", value: summary ? `${summary.completedOrders}` : "-" },
        { label: "完成件数", value: summary ? `${summary.completedPieces}` : "-" },
        { label: "总工时", value: summary ? `${metric(summary.totalHours)}h` : "-" },
        { label: "平均耗时", value: summary ? `${metric(summary.averageHoursPerPiece, 2)}h/件` : "-" }
      ];

  return (
    <div className="worker-mobile-performance-backdrop" role="presentation" onClick={onClose}>
      <section
        className="worker-mobile-performance-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="我的绩效"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="worker-mobile-performance-header">
          <div>
            <span>{workerType === "sewing" ? "缝制" : "裁剪"}员工</span>
            <h2>我的绩效</h2>
          </div>
          <div className="worker-mobile-performance-header-actions">
            <button type="button" onClick={() => void load()} aria-label="刷新绩效">
              <ReloadOutlined spin={loading} />
            </button>
            <button type="button" onClick={onClose} aria-label="关闭我的绩效">
              <CloseOutlined />
            </button>
          </div>
        </div>

        <div className="worker-mobile-performance-body">
          <div className="worker-mobile-performance-presets" role="group" aria-label="绩效时间范围">
            {([
              ["week", "本周"],
              ["month", "本月"],
              ["three_months", "近3个月"],
              ["custom", "自定义"]
            ] as Array<[RangePreset, string]>).map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={preset === value ? "is-active" : ""}
                onClick={() => selectPreset(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {preset === "custom" ? (
            <div className="worker-mobile-performance-custom-range">
              <label>
                <span>开始日期</span>
                <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
              </label>
              <label>
                <span>结束日期</span>
                <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
              </label>
              <button type="button" onClick={() => void load("custom")} disabled={loading}>
                <CalendarOutlined />
                应用
              </button>
            </div>
          ) : null}

          {error ? <div className="worker-mobile-performance-error">{error}</div> : null}

          <div className={`worker-mobile-performance-summary${isSewing ? " is-sewing" : ""}`}>
            {cards.map((card) => (
              <div key={card.label}>
                <span>{card.label}</span>
                <strong>{loading && !report ? "…" : card.value}</strong>
              </div>
            ))}
          </div>

          <div className="worker-mobile-performance-record-heading">
            <div>
              <h3>任务记录</h3>
              <span>{filteredRecords.length} 条</span>
            </div>
            <label className="worker-mobile-performance-search">
              <SearchOutlined />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索款号或款名"
                inputMode="search"
              />
              {query ? (
                <button type="button" onClick={() => setQuery("")} aria-label="清除搜索">
                  <CloseOutlined />
                </button>
              ) : null}
            </label>
          </div>

          <div className="worker-mobile-performance-records">
            {loading && !report ? (
              <div className="worker-mobile-performance-empty">正在加载绩效…</div>
            ) : filteredRecords.length === 0 ? (
              <div className="worker-mobile-performance-empty">当前范围暂无任务记录</div>
            ) : (
              filteredRecords.map((record, index) => (
                <article
                  className="worker-mobile-performance-record"
                  key={`${record.styleNo}-${record.completedAt}-${index}`}
                >
                  <div className="worker-mobile-performance-record-main">
                    <strong>{record.styleNo || "未录入款号"}</strong>
                    <span>{record.styleName || "-"}</span>
                  </div>
                  <div className="worker-mobile-performance-record-meta">
                    <span>{record.pieces}件</span>
                    <span>{metric(record.workHours)}小时</span>
                    {isSewing && record.qualityScore !== undefined ? (
                      <span className="is-score">质检 {metric(record.qualityScore)}分</span>
                    ) : null}
                  </div>
                  <time>{formatDateTime(record.completedAt)}</time>
                </article>
              ))
            )}
          </div>
        </div>

      </section>
    </div>
  );
}
