import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const mobileSource = readFileSync(resolve(here, "WorkerMobilePage.tsx"), "utf8");
const performanceSource = readFileSync(resolve(here, "WorkerMobilePerformanceSheet.tsx"), "utf8");
const polishedCss = readFileSync(resolve(here, "workerMobilePolished.css"), "utf8");

describe("worker H5 mobile experience", () => {
  it("keeps cutting and sewing on one lightweight mobile workbench with a personal-performance entry", () => {
    expect(mobileSource).toContain("你好呀，{session.displayName}");
    expect(mobileSource).toContain("我的绩效");
    expect(mobileSource).toContain("缝制中 · {tasks.length}");
    expect(mobileSource).toContain("WorkerMobilePerformanceSheet");
    expect(mobileSource).toContain('workerType={isSewing ? "sewing" : "cutting"}');
    expect(mobileSource).not.toContain("裁剪操作");
    expect(mobileSource).not.toContain("完成裁剪</strong>");
  });

  it("reuses the existing personal performance API and Android-equivalent worker metrics", () => {
    expect(performanceSource).toContain("/api/miniapp/me/performance");
    for (const label of ["本周", "本月", "近3个月", "自定义", "任务记录", "完成订单", "完成件数", "总工时"]) {
      expect(performanceSource).toContain(label);
    }
    expect(performanceSource).toContain("每小时产出");
    expect(performanceSource).toContain("平均质检评分");
    expect(performanceSource).toContain("未评分订单");
    expect(performanceSource).toContain("平均耗时");
    expect(performanceSource).toContain("质检 {metric(record.qualityScore)}分");
    expect(performanceSource).not.toContain("/pieces`");
    expect(performanceSource).not.toContain("修改登记件数");
  });

  it("uses the same light card visual language as the standalone registration page", () => {
    expect(polishedCss).toContain("radial-gradient");
    expect(polishedCss).toContain("rgba(255, 255, 255, 0.96)");
    expect(polishedCss).toContain("border-radius: 20px");
    expect(polishedCss).toContain("worker-mobile-performance-sheet");
    expect(polishedCss).toContain("worker-mobile-secondary-action-grid");
  });
});
