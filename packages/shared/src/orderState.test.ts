import { describe, expect, it } from "vitest";
import {
  acceptPendingReceive,
  createClientSubmissionInitialState,
  createReceiverSelfEntryInitialState,
  updateTrackingPatternStatus
} from "./orderState";
import {
  MATERIAL_STATUSES,
  ORDER_STAGES,
  PATTERN_STATUSES,
  SAMPLE_REQUEST_ITEMS
} from "./statuses";

describe("order state pure functions", () => {
  it("creates client submissions as pending receive outside formal flow", () => {
    expect(createClientSubmissionInitialState()).toMatchObject({
      sourceType: "client_submission",
      intakeStatus: "pending_receive",
      stage: null,
      isInFormalFlow: false
    });
  });

  it("accepts pending receive into the selected physical route", () => {
    expect(acceptPendingReceive(PATTERN_STATUSES.has)).toMatchObject({
      intakeStatus: "received",
      stage: ORDER_STAGES.patternWaiting,
      patternStatus: "has",
      isInFormalFlow: true
    });
  });

  it("starts sample-only orders at sewing without waiting for pattern or cutting", () => {
    expect(
      acceptPendingReceive(PATTERN_STATUSES.none, [SAMPLE_REQUEST_ITEMS.sampleGarment])
    ).toMatchObject({
      intakeStatus: "received",
      stage: ORDER_STAGES.sewingWaiting,
      patternStatus: "none",
      isInFormalFlow: true
    });
  });

  it("creates receiver self-entry without pending receive", () => {
    expect(createReceiverSelfEntryInitialState(PATTERN_STATUSES.has)).toMatchObject({
      sourceType: "receiver_self_entry",
      intakeStatus: "received",
      stage: ORDER_STAGES.patternWaiting,
      isInFormalFlow: true
    });
  });

  it("marks pattern-only receiver entry physical production complete", () => {
    expect(
      createReceiverSelfEntryInitialState(PATTERN_STATUSES.none, [
        SAMPLE_REQUEST_ITEMS.patternRevision
      ])
    ).toMatchObject({
      intakeStatus: "received",
      stage: ORDER_STAGES.done,
      patternStatus: "none",
      isInFormalFlow: true
    });
  });

  it("keeps non-pattern stages unchanged when pattern status changes", () => {
    expect(updateTrackingPatternStatus(ORDER_STAGES.sewingDoing, PATTERN_STATUSES.has)).toBe(
      ORDER_STAGES.sewingDoing
    );
  });

  it("keeps material status values limited to missing, partial, and complete", () => {
    expect(Object.values(MATERIAL_STATUSES).sort()).toEqual(["complete", "missing", "partial"]);
  });

  it("keeps trim status values limited to missing, partial, and complete", () => {
    expect(Object.values(MATERIAL_STATUSES).sort()).toEqual(["complete", "missing", "partial"]);
  });

  it("keeps pattern status values limited to none and has", () => {
    expect(Object.values(PATTERN_STATUSES).sort()).toEqual(["has", "none"]);
  });
});
