import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) =>
  readFileSync(resolve(here, path), "utf8").replace(/\r\n?/g, "\n");

describe("lightweight formal Worker H5 bootstrap", () => {
  const mainSource = read("../../main.tsx");
  const standaloneSource = read("WorkerMobileStandaloneApp.tsx");
  const scanPanelSource = read("WorkerMobileScanPanel.tsx");
  const apiSource = read("workerMobileLiteApi.ts");
  const formalLoginSource = read("../login/FormalLoginPage.tsx");

  it("routes formal /worker/mobile before the full desktop application root", () => {
    expect(mainSource).toContain('const workerMobilePath = /^\\/worker\\/mobile\\/?$/.test(window.location.pathname);');
    expect(mainSource).toContain('import.meta.env.VITE_AUTH_MODE !== "dev"');
    expect(mainSource).toContain('import("./pages/workers/WorkerMobileStandaloneApp")');
    expect(mainSource.indexOf("lightweightWorkerMobilePath")).toBeLessThan(mainSource.indexOf('import("./FullApplicationRoot")'));
  });

  it("hard-navigates successful worker logins back through the lightweight entrypoint", () => {
    expect(formalLoginSource).toContain('if (target === "/worker/mobile")');
    expect(formalLoginSource).toContain("window.location.replace(target)");
  });

  it("keeps heavy mobile features out of the initial standalone chunk", () => {
    expect(standaloneSource).toContain('await import("@zxing/browser")');
    expect(standaloneSource).toContain('lazy(() =>\n  import("./WorkerMobilePerformanceSheet")');
    expect(standaloneSource).toContain('lazy(() =>\n  import("./WorkerMobileScanPanel")');
    expect(standaloneSource).not.toContain('from "antd"');
    expect(standaloneSource).not.toContain('from "react-router-dom"');
    expect(standaloneSource).not.toContain('from "../../app/AuthSessionContext"');
    expect(standaloneSource).not.toContain('from "../../api/sampleRoomApi"');
    expect(standaloneSource).not.toContain('from "../../api/request"');
    expect(standaloneSource).not.toContain('from "@zxing/browser"');
  });

  it("submits a new sewing assignment directly from the scan action page", () => {
    expect(scanPanelSource).toContain('onClick={() => void submitStartSewing()}');
    expect(scanPanelSource).not.toContain('title: "确认开始缝制？"');
    expect(scanPanelSource).toContain('await sampleRoomApi.startScan(token)');
  });

  it("submits cutting or fallback sewing completion directly from the scan action page", () => {
    expect(scanPanelSource).toContain('onClick={() => void submitCompleteTask()}');
    expect(scanPanelSource).toContain('await sampleRoomApi.completeScan(token, {');
    expect(scanPanelSource).not.toContain('title: `确认${actionText}？`');
  });

  it("renders a completed sewing round as read-only without join or completion actions", () => {
    expect(scanPanelSource).toContain('state.blockedReason === "SEWING_ROUND_ALREADY_COMPLETED"');
    expect(scanPanelSource).toContain('return "你已完成本轮缝制"');
    expect(scanPanelSource).toContain('state.allowedAction === "join_collaboration"');
    expect(scanPanelSource).toContain('state.allowedAction === "complete"');
  });

  it("restores only the cookie session and fetches optional dictionaries after first render", () => {
    expect(apiSource).toContain('fetch("/api/auth/me"');
    expect(apiSource).toContain('credentials: "same-origin"');
    expect(apiSource).toContain('"/api/form-options/sample-types"');
    expect(apiSource).toContain('"/api/miniapp/me/sewing-tasks"');
    expect(standaloneSource).toContain("setSession(toWorkerMobileSession(user));");
    expect(standaloneSource).toContain("void workerMobileLiteApi.sampleTypes()");
  });

  it("keeps the Sample Room OS brand visible during bootstrap and on the worker home", () => {
    expect(standaloneSource).toContain("Sample Room OS");
    expect(standaloneSource).toContain("sample-room-os-mark.svg");
  });
});
