import { describe, expect, it } from "vitest";
import { ORDER_STAGES } from "@sample-room/shared";
import type { OrderCorrectionLogEntry } from "../orders/orderTypes.js";
import { processPiecesCorrectionFieldName } from "./processPiecesCorrections.js";
import type { ScanRecord } from "./scanTypes.js";
import {
  collaborativeSewingState,
  hasQcCompletion,
  sewingParticipationCancelFieldName,
  sewingParticipationTargetFieldName
} from "./collaborativeSewing.js";

function log(
  id: string,
  fieldName: string,
  newValue: string | number | null,
  changedAt: string
): OrderCorrectionLogEntry {
  return {
    id,
    fieldName,
    oldValue: null,
    newValue,
    changedAt,
    changedByRole: "planner",
    changedByAccountId: "planner-1",
    changedByName: "计划员"
  };
}

function sewingRecord(input: {
  id: string;
  worker: string;
  action: "start" | "complete";
  eventTime: string;
  pieces?: number;
  collaborationJoin?: boolean;
  takeoverFromWorkerId?: string;
}): Pick<
  ScanRecord,
  | "id"
  | "actorAccountId"
  | "workerProfileId"
  | "stage"
  | "action"
  | "workerId"
  | "workerName"
  | "eventTime"
  | "pieces"
  | "collaborationJoin"
  | "takeoverFromWorkerId"
  | "takeoverFromWorkerName"
> {
  return {
    id: input.id,
    actorAccountId: `account-${input.worker}`,
    workerProfileId: `profile-${input.worker}`,
    stage: "sewing",
    action: input.action,
    workerId: input.worker,
    workerName: input.worker,
    eventTime: input.eventTime,
    ...(input.collaborationJoin ? { collaborationJoin: true } : {}),
    ...(input.pieces !== undefined ? { pieces: input.pieces } : {}),
    ...(input.takeoverFromWorkerId
      ? {
          takeoverFromWorkerId: input.takeoverFromWorkerId,
          takeoverFromWorkerName: input.takeoverFromWorkerId
        }
      : {})
  };
}

function qcReworkRecord(id: string, eventTime: string): Pick<
  ScanRecord,
  | "id"
  | "actorAccountId"
  | "workerProfileId"
  | "stage"
  | "action"
  | "workerId"
  | "workerName"
  | "eventTime"
  | "pieces"
  | "collaborationJoin"
  | "takeoverFromWorkerId"
  | "takeoverFromWorkerName"
  | "qualityResult"
> {
  return {
    id,
    actorAccountId: "account-Q",
    workerProfileId: "profile-Q",
    stage: "qc_delivery",
    action: "complete",
    workerId: "Q",
    workerName: "Q",
    eventTime,
    qualityResult: "rework"
  };
}

describe("collaborativeSewingState", () => {
  it("derives single mode when fewer than two current participations exist", () => {
    const state = collaborativeSewingState({ quantity: 20, correctionLogs: [] }, []);
    expect(state.mode).toBe("single");
    expect(state.sewingGateSatisfied).toBe(false);
  });

  it("satisfies the gate when every participant has completed even below order quantity", () => {
    const state = collaborativeSewingState(
      { quantity: 20, correctionLogs: [] },
      [
        sewingRecord({ id: "a-start", worker: "A", action: "start", eventTime: "2026-08-28T02:00:00.000Z" }),
        sewingRecord({ id: "b-start", worker: "B", action: "start", eventTime: "2026-08-28T02:10:00.000Z", collaborationJoin: true }),
        sewingRecord({ id: "a-done", worker: "A", action: "complete", eventTime: "2026-08-28T03:00:00.000Z", pieces: 5 }),
        sewingRecord({ id: "b-done", worker: "B", action: "complete", eventTime: "2026-08-28T03:10:00.000Z", pieces: 5 })
      ]
    );

    expect(state.mode).toBe("collaboration");
    expect(state.completedPieces).toBe(10);
    expect(state.hasUnresolvedParticipation).toBe(false);
    expect(state.sewingGateSatisfied).toBe(true);
  });

  it("requires every active participant to resolve even when submitted pieces already reach quantity", () => {
    const state = collaborativeSewingState(
      { quantity: 20, correctionLogs: [] },
      [
        sewingRecord({ id: "a-start", worker: "A", action: "start", eventTime: "2026-08-28T02:00:00.000Z" }),
        sewingRecord({ id: "a-done", worker: "A", action: "complete", eventTime: "2026-08-28T03:00:00.000Z", pieces: 20 }),
        sewingRecord({ id: "b-start", worker: "B", action: "start", eventTime: "2026-08-28T03:30:00.000Z", collaborationJoin: true })
      ]
    );

    expect(state.completedPieces).toBe(20);
    expect(state.hasUnresolvedParticipation).toBe(true);
    expect(state.sewingGateSatisfied).toBe(false);
  });

  it("keeps the order in sewing when submitted pieces exceed quantity but another participant is active", () => {
    const state = collaborativeSewingState(
      { quantity: 4, correctionLogs: [] },
      [
        sewingRecord({ id: "a-start", worker: "A", action: "start", eventTime: "2026-08-28T02:00:00.000Z" }),
        sewingRecord({ id: "a-done", worker: "A", action: "complete", eventTime: "2026-08-28T03:00:00.000Z", pieces: 6 }),
        sewingRecord({ id: "b-start", worker: "B", action: "start", eventTime: "2026-08-28T03:30:00.000Z", collaborationJoin: true })
      ]
    );

    expect(state.completedPieces).toBe(6);
    expect(state.activeParticipations).toHaveLength(1);
    expect(state.sewingGateSatisfied).toBe(false);
  });

  it("treats under-planned and over-planned targets as advisory when all participants complete", () => {
    const records = [
      sewingRecord({ id: "a-start", worker: "A", action: "start", eventTime: "2026-08-28T02:00:00.000Z" }),
      sewingRecord({ id: "b-start", worker: "B", action: "start", eventTime: "2026-08-28T02:10:00.000Z", collaborationJoin: true }),
      sewingRecord({ id: "a-done", worker: "A", action: "complete", eventTime: "2026-08-28T03:00:00.000Z", pieces: 1 }),
      sewingRecord({ id: "b-done", worker: "B", action: "complete", eventTime: "2026-08-28T03:10:00.000Z", pieces: 1 })
    ];
    const underPlanned = collaborativeSewingState(
      {
        quantity: 4,
        correctionLogs: [
          log("target-a", sewingParticipationTargetFieldName("a-start"), 1, "2026-08-28T02:20:00.000Z")
        ]
      },
      records
    );
    const overPlanned = collaborativeSewingState(
      {
        quantity: 4,
        correctionLogs: [
          log("target-a", sewingParticipationTargetFieldName("a-start"), 4, "2026-08-28T02:20:00.000Z"),
          log("target-b", sewingParticipationTargetFieldName("b-start"), 4, "2026-08-28T02:20:00.000Z")
        ]
      },
      records
    );

    expect(underPlanned.plannedPieces).toBe(1);
    expect(overPlanned.plannedPieces).toBe(8);
    expect(underPlanned.sewingGateSatisfied).toBe(true);
    expect(overPlanned.sewingGateSatisfied).toBe(true);
  });

  it("treats a planner cancellation as a resolved non-performing participation", () => {
    const state = collaborativeSewingState(
      {
        quantity: 20,
        correctionLogs: [
          log(
            "cancel-b",
            sewingParticipationCancelFieldName("b-start"),
            "cancelled",
            "2026-08-28T04:00:00.000Z"
          )
        ]
      },
      [
        sewingRecord({ id: "a-start", worker: "A", action: "start", eventTime: "2026-08-28T02:00:00.000Z" }),
        sewingRecord({ id: "a-done", worker: "A", action: "complete", eventTime: "2026-08-28T03:00:00.000Z", pieces: 20 }),
        sewingRecord({ id: "b-start", worker: "B", action: "start", eventTime: "2026-08-28T03:30:00.000Z", collaborationJoin: true })
      ]
    );

    expect(state.participations.find((item) => item.id === "b-start")?.status).toBe("cancelled");
    expect(state.mode).toBe("single");
    expect(state.sewingGateSatisfied).toBe(true);
  });

  it("retains a zero-piece exit only in audit records and hides it from business projections", () => {
    const state = collaborativeSewingState(
      { quantity: 20, correctionLogs: [] },
      [
        sewingRecord({ id: "a-start", worker: "A", action: "start", eventTime: "2026-08-28T02:00:00.000Z" }),
        sewingRecord({ id: "a-done", worker: "A", action: "complete", eventTime: "2026-08-28T03:00:00.000Z", pieces: 20 }),
        sewingRecord({ id: "b-start", worker: "B", action: "start", eventTime: "2026-08-28T03:10:00.000Z", collaborationJoin: true }),
        sewingRecord({ id: "b-done", worker: "B", action: "complete", eventTime: "2026-08-28T03:20:00.000Z", pieces: 0 })
      ]
    );

    expect(state.participations.find((item) => item.id === "b-start")).toBeUndefined();
    expect(state.hiddenAuditScanRecordIds).toEqual(["b-start", "b-done"]);
    expect(state.effectiveParticipations.map((item) => item.workerId)).toEqual(["A"]);
    expect(state.completedPieces).toBe(20);
    expect(state.sewingGateSatisfied).toBe(true);
  });

  it("keeps a positive raw completion as a completed participation after a manager corrects performance to zero", () => {
    const state = collaborativeSewingState(
      {
        quantity: 3,
        stage: ORDER_STAGES.qcDeliveryWaiting,
        correctionLogs: [
          log(
            "correct-a-to-zero",
            processPiecesCorrectionFieldName("sewing", "a-done"),
            0,
            "2026-08-28T03:30:00.000Z"
          )
        ]
      },
      [
        sewingRecord({ id: "a-start", worker: "A", action: "start", eventTime: "2026-08-28T02:00:00.000Z" }),
        sewingRecord({ id: "a-done", worker: "A", action: "complete", eventTime: "2026-08-28T03:00:00.000Z", pieces: 3 })
      ]
    );

    expect(state.participations).toEqual([
      expect.objectContaining({
        id: "a-start",
        status: "completed",
        completedPieces: 0
      })
    ]);
    expect(state.currentParticipations).toHaveLength(1);
    expect(state.effectiveParticipations).toHaveLength(0);
    expect(state.hiddenAuditScanRecordIds).toEqual([]);
    expect(state.sewingGateSatisfied).toBe(true);
    expect(state.usesParticipationWorkflow).toBe(true);
  });

  it("uses the shared participation projection for a pure-single order waiting for its first QC result", () => {
    const state = collaborativeSewingState(
      {
        quantity: 3,
        stage: ORDER_STAGES.qcDeliveryWaiting,
        correctionLogs: []
      },
      [
        sewingRecord({ id: "a-start", worker: "A", action: "start", eventTime: "2026-08-28T02:00:00.000Z" }),
        sewingRecord({ id: "a-done", worker: "A", action: "complete", eventTime: "2026-08-28T03:00:00.000Z", pieces: 3 })
      ]
    );

    expect(state.mode).toBe("single");
    expect(state.usesParticipationWorkflow).toBe(true);
    expect(state.sewingGateSatisfied).toBe(true);
  });

  it("keeps target pieces advisory and uses the latest planner value", () => {
    const state = collaborativeSewingState(
      {
        quantity: 20,
        correctionLogs: [
          log("target-a-1", sewingParticipationTargetFieldName("a-start"), 8, "2026-08-28T02:10:00.000Z"),
          log("target-a-2", sewingParticipationTargetFieldName("a-start"), 5, "2026-08-28T02:20:00.000Z")
        ]
      },
      [
        sewingRecord({ id: "a-start", worker: "A", action: "start", eventTime: "2026-08-28T02:00:00.000Z" })
      ]
    );

    expect(state.participations[0]?.targetPieces).toBe(5);
    expect(state.sewingGateSatisfied).toBe(false);
  });

  it("supports a worker exiting with zero and later rejoining as a new participation", () => {
    const state = collaborativeSewingState(
      { quantity: 3, correctionLogs: [] },
      [
        sewingRecord({ id: "a-start-1", worker: "A", action: "start", eventTime: "2026-08-28T02:00:00.000Z" }),
        sewingRecord({ id: "a-done-1", worker: "A", action: "complete", eventTime: "2026-08-28T02:10:00.000Z", pieces: 0 }),
        sewingRecord({ id: "a-start-2", worker: "A", action: "start", eventTime: "2026-08-28T03:00:00.000Z", collaborationJoin: true }),
        sewingRecord({ id: "a-done-2", worker: "A", action: "complete", eventTime: "2026-08-28T04:00:00.000Z", pieces: 3 })
      ]
    );

    expect(state.participations).toHaveLength(1);
    expect(state.participations[0]?.id).toBe("a-start-2");
    expect(state.participations[0]?.status).toBe("completed");
    expect(state.effectiveParticipations).toHaveLength(1);
    expect(state.completedPieces).toBe(3);
    expect(state.sewingGateSatisfied).toBe(true);
  });

  it("keeps only the first valid completion when historical duplicate participation exists", () => {
    const state = collaborativeSewingState(
      { quantity: 3, correctionLogs: [] },
      [
        sewingRecord({ id: "a-start-1", worker: "A", action: "start", eventTime: "2026-08-28T02:00:00.000Z" }),
        sewingRecord({ id: "a-done-1", worker: "A", action: "complete", eventTime: "2026-08-28T02:10:00.000Z", pieces: 1 }),
        sewingRecord({ id: "a-start-2", worker: "A", action: "start", eventTime: "2026-08-28T03:00:00.000Z", collaborationJoin: true })
      ]
    );

    expect(state.currentParticipations).toHaveLength(1);
    expect(state.currentParticipations[0]?.id).toBe("a-start-1");
    expect(state.completedPieces).toBe(1);
    expect(state.duplicateCompletionCount).toBe(0);
    expect(state.hiddenAuditScanRecordIds).toEqual(["a-start-2"]);
    expect(state.mode).toBe("single");
  });

  it("does not count a second completion from the same worker in one sewing round", () => {
    const state = collaborativeSewingState(
      { quantity: 3, correctionLogs: [] },
      [
        sewingRecord({ id: "a-start-1", worker: "A", action: "start", eventTime: "2026-08-28T02:00:00.000Z" }),
        sewingRecord({ id: "a-done-1", worker: "A", action: "complete", eventTime: "2026-08-28T02:10:00.000Z", pieces: 3 }),
        sewingRecord({ id: "a-start-2", worker: "A", action: "start", eventTime: "2026-08-28T03:00:00.000Z", collaborationJoin: true }),
        sewingRecord({ id: "a-done-2", worker: "A", action: "complete", eventTime: "2026-08-28T03:10:00.000Z", pieces: 3 })
      ]
    );

    expect(state.effectiveParticipations).toHaveLength(1);
    expect(state.effectiveParticipations[0]?.completionScanRecordId).toBe("a-done-1");
    expect(state.completedPieces).toBe(3);
    expect(state.duplicateCompletionCount).toBe(1);
    expect(state.hiddenAuditScanRecordIds).toEqual(["a-start-2", "a-done-2"]);
  });

  it("keeps the original sewing participation locked after a QC rework result", () => {
    const rework = qcReworkRecord("qc-rework", "2026-08-28T03:00:00.000Z");
    const state = collaborativeSewingState(
      { quantity: 3, stage: ORDER_STAGES.qcDeliveryWaiting, correctionLogs: [] },
      [
        sewingRecord({ id: "a-start-1", worker: "A", action: "start", eventTime: "2026-08-28T02:00:00.000Z" }),
        sewingRecord({ id: "a-done-1", worker: "A", action: "complete", eventTime: "2026-08-28T02:10:00.000Z", pieces: 3 }),
        rework,
        sewingRecord({ id: "a-start-2", worker: "A", action: "start", eventTime: "2026-08-28T04:00:00.000Z", collaborationJoin: true })
      ]
    );

    expect(state.activeParticipations).toHaveLength(0);
    expect(state.effectiveParticipations).toEqual([
      expect.objectContaining({ id: "a-start-1", status: "completed", completedPieces: 3 })
    ]);
    expect(state.hiddenAuditScanRecordIds).toEqual(["a-start-2"]);
    expect(state.duplicateCompletionCount).toBe(0);
    expect(hasQcCompletion([rework])).toBe(true);
  });

  it("does not resurrect a worker replaced before a later collaboration join", () => {
    const state = collaborativeSewingState(
      { quantity: 20, correctionLogs: [] },
      [
        sewingRecord({ id: "a-start", worker: "A", action: "start", eventTime: "2026-08-28T01:00:00.000Z" }),
        sewingRecord({
          id: "b-takeover",
          worker: "B",
          action: "start",
          eventTime: "2026-08-28T02:00:00.000Z",
          takeoverFromWorkerId: "A"
        }),
        sewingRecord({ id: "c-start", worker: "C", action: "start", eventTime: "2026-08-28T03:00:00.000Z", collaborationJoin: true })
      ]
    );

    expect(state.participations.find((item) => item.id === "a-start")?.status).toBe("replaced");
    expect(state.activeParticipations.map((item) => item.workerId)).toEqual(["B", "C"]);
    expect(state.mode).toBe("collaboration");
    expect(state.hasUnresolvedParticipation).toBe(true);
  });
});
