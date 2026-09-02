import { describe, expect, it } from "vitest";
import type { OrderCorrectionLogEntry } from "../orders/orderTypes.js";
import { processPiecesCorrectionFieldName } from "../scan/processPiecesCorrections.js";
import type { ScanRecord } from "../scan/scanTypes.js";
import { summarizeStageWork } from "./pricingCalculationService.js";

function sewingRecord(input: {
  id: string;
  worker: string;
  action: "start" | "complete";
  eventTime: string;
  pieces?: number;
  workHours?: number;
  collaborationJoin?: boolean;
}) {
  return {
    id: input.id,
    orderId: "order-1",
    actorAccountId: `account-${input.worker}`,
    workerProfileId: `profile-${input.worker}`,
    actorType: "production_worker",
    actorRole: "worker",
    workerId: input.worker,
    workerName: input.worker,
    stage: "sewing",
    orderStage: "sewing_doing",
    action: input.action,
    scanAction: input.action === "start" ? "sewing_start" : "sewing_finish",
    eventTime: input.eventTime,
    source: "scan",
    ...(input.pieces !== undefined ? { pieces: input.pieces } : {}),
    ...(input.workHours !== undefined ? { workHours: input.workHours } : {}),
    ...(input.collaborationJoin ? { collaborationJoin: true } : {})
  } as ScanRecord;
}

describe("collaborative sewing pricing stage work", () => {
  it("shows one aggregated piece total and hides individual worker names", () => {
    const records = [
      sewingRecord({ id: "a-start", worker: "A", action: "start", eventTime: "2026-08-29T01:00:00.000Z" }),
      sewingRecord({ id: "b-start", worker: "B", action: "start", eventTime: "2026-08-29T01:10:00.000Z", collaborationJoin: true }),
      sewingRecord({ id: "a-complete", worker: "A", action: "complete", eventTime: "2026-08-29T02:00:00.000Z", pieces: 3, workHours: 1 }),
      sewingRecord({ id: "b-complete", worker: "B", action: "complete", eventTime: "2026-08-29T02:10:00.000Z", pieces: 2, workHours: 2 })
    ];
    const correction: OrderCorrectionLogEntry = {
      id: "correction-1",
      changedAt: "2026-08-29T03:00:00.000Z",
      changedByRole: "boss",
      changedByAccountId: "boss-1",
      fieldName: processPiecesCorrectionFieldName("sewing", "b-complete"),
      oldValue: 2,
      newValue: 4
    };

    expect(summarizeStageWork(records, { quantity: 5, correctionLogs: [correction] }))
      .toContainEqual(expect.objectContaining({
        stage: "sewing",
        pieces: 7,
        workHours: 3,
        workerNames: ["多人协作"]
      }));
  });
});
