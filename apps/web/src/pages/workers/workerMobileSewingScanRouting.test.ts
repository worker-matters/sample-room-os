import { describe, expect, it } from "vitest";
import type { ScanPageState } from "../../api/sampleRoomApi";
import { findOwnedSewingTaskForScan, type SewingTaskIdentity } from "./workerMobileSewingScanRouting";

const task = (overrides: Partial<SewingTaskIdentity> = {}): SewingTaskIdentity => ({
  orderId: "order-1",
  styleNo: "ST-001",
  quantity: 5,
  startedAt: "2026-08-28T03:00:00.000Z",
  ...overrides
});

const scanState = (overrides: Partial<ScanPageState> = {}): ScanPageState => ({
  order: {
    styleNo: "ST-001",
    styleName: "Mock Style",
    quantity: 5,
    customerName: "Customer",
    salespersonName: "Sales"
  },
  allowedAction: "complete",
  stage: "sewing",
  stageLabel: "缝制",
  startedByCurrentWorker: true,
  activeTask: {
    stage: "sewing",
    stageLabel: "缝制",
    workerId: "worker-1",
    workerName: "缝制员工一号",
    startedAt: "2026-08-28T03:00:00.000Z"
  },
  ...overrides
});

describe("findOwnedSewingTaskForScan", () => {
  it("matches the already accepted task by the same sewing start record", () => {
    const expected = task();
    expect(findOwnedSewingTaskForScan(scanState(), [expected])).toBe(expected);
  });

  it("matches the formal scan presentation timestamp when activeTask is omitted", () => {
    const state = scanState();
    delete state.activeTask;
    (state.order as ScanPageState["order"] & { recordSubmittedAt?: string }).recordSubmittedAt =
      "2026-08-28T03:00:00.000Z";
    const expected = task();
    expect(findOwnedSewingTaskForScan(state, [expected])).toBe(expected);
  });

  it("does not redirect sewing scans that still need start or takeover", () => {
    expect(
      findOwnedSewingTaskForScan(scanState({ allowedAction: "start" }), [task()])
    ).toBeUndefined();
    expect(
      findOwnedSewingTaskForScan(scanState({ allowedAction: "takeover", startedByCurrentWorker: false }), [task()])
    ).toBeUndefined();
  });

  it("does not redirect another stage", () => {
    expect(
      findOwnedSewingTaskForScan(scanState({ stage: "cutting" }), [task()])
    ).toBeUndefined();
  });

  it("uses a unique style and quantity fallback but never guesses between duplicates", () => {
    const fallback = task({ orderId: "fallback", startedAt: "2026-08-28T02:00:00.000Z" });
    expect(findOwnedSewingTaskForScan(scanState(), [fallback])).toBe(fallback);

    const duplicate = task({ orderId: "duplicate", startedAt: "2026-08-28T01:00:00.000Z" });
    expect(findOwnedSewingTaskForScan(scanState(), [fallback, duplicate])).toBeUndefined();
  });
});
