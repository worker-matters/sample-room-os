import { describe, expect, it } from "vitest";
import {
  deriveOrderCompletionStatus,
  firstPhysicalOrderStage,
  nextOrderStageAfterPhysicalCompletion,
  ORDER_STAGES,
  SAMPLE_REQUEST_ITEMS,
  type PatternTaskRequirement,
  type SampleRequestItem
} from "@sample-room/shared";
import type { PatternDeliverableRecord } from "./patternTypes.js";
import {
  completedPatternRequirementsFromDeliverables,
  currentOrderStageFromPatternGate,
  isPatternProductionGateSatisfiedByDeliverables
} from "./patternCompletionRules.js";

function deliverable(
  taskCategory: PatternTaskRequirement,
  overrides: Partial<PatternDeliverableRecord> = {}
): PatternDeliverableRecord {
  return {
    id: `deliverable-${taskCategory}`,
    orderId: "order-1",
    patternTaskId: "task-1",
    version: "V1",
    type: "pattern_file",
    fileName: `${taskCategory}.dxf`,
    storageKey: `orders/order-1/${taskCategory}.dxf`,
    visibility: "internal_only",
    uploadedBy: "pattern-maker-1",
    taskCategory,
    createdAt: "2026-07-14T00:00:00.000Z",
    ...overrides
  };
}

function currentStage(
  sampleRequestItems: SampleRequestItem[],
  deliverables: PatternDeliverableRecord[],
  storedStage = firstPhysicalOrderStage(sampleRequestItems)
) {
  return currentOrderStageFromPatternGate({
    sampleRequestItems,
    storedStage,
    deliverables
  });
}

describe("authoritative pattern completion and dynamic production status", () => {
  it("keeps making + cutting + sample garment waiting when making has no valid file", () => {
    const items = [
      SAMPLE_REQUEST_ITEMS.patternMaking,
      SAMPLE_REQUEST_ITEMS.cutting,
      SAMPLE_REQUEST_ITEMS.sampleGarment
    ];
    expect(currentStage(items, [])).toBe(ORDER_STAGES.patternWaiting);
  });

  it("keeps making + revision + cutting waiting until both blocking files exist", () => {
    const items = [
      SAMPLE_REQUEST_ITEMS.patternMaking,
      SAMPLE_REQUEST_ITEMS.patternRevision,
      SAMPLE_REQUEST_ITEMS.cutting
    ];
    const making = deliverable(SAMPLE_REQUEST_ITEMS.patternMaking);
    expect(isPatternProductionGateSatisfiedByDeliverables(items, [making])).toBe(false);
    expect(currentStage(items, [making])).toBe(ORDER_STAGES.patternWaiting);
    expect(
      completedPatternRequirementsFromDeliverables(
        [SAMPLE_REQUEST_ITEMS.patternMaking, SAMPLE_REQUEST_ITEMS.patternRevision],
        [making]
      )
    ).toEqual([SAMPLE_REQUEST_ITEMS.patternMaking]);
  });

  it("finishes a making + cutting order after valid making delivery and cutting completion", () => {
    const items = [SAMPLE_REQUEST_ITEMS.patternMaking, SAMPLE_REQUEST_ITEMS.cutting];
    const files = [deliverable(SAMPLE_REQUEST_ITEMS.patternMaking)];
    expect(currentStage(items, files)).toBe(ORDER_STAGES.cuttingWaiting);
    expect(nextOrderStageAfterPhysicalCompletion(items, "cutting")).toBe(ORDER_STAGES.done);
    expect(
      deriveOrderCompletionStatus({
        sampleRequestItems: items,
        orderStage: ORDER_STAGES.done,
        patternTaskStatus: "completed"
      })
    ).toBe("completed");
  });

  it("moves making + cutting + sample garment to sewing after cutting", () => {
    const items = [
      SAMPLE_REQUEST_ITEMS.patternMaking,
      SAMPLE_REQUEST_ITEMS.cutting,
      SAMPLE_REQUEST_ITEMS.sampleGarment
    ];
    expect(nextOrderStageAfterPhysicalCompletion(items, "cutting")).toBe(
      ORDER_STAGES.sewingWaiting
    );
  });

  it("starts making + sample garment at sewing when there is no cutting", () => {
    const items = [SAMPLE_REQUEST_ITEMS.patternMaking, SAMPLE_REQUEST_ITEMS.sampleGarment];
    expect(currentStage(items, [deliverable(SAMPLE_REQUEST_ITEMS.patternMaking)])).toBe(
      ORDER_STAGES.sewingWaiting
    );
  });

  it("moves making + cutting + sample small to sewing after cutting", () => {
    const items = [
      SAMPLE_REQUEST_ITEMS.patternMaking,
      SAMPLE_REQUEST_ITEMS.cutting,
      SAMPLE_REQUEST_ITEMS.sampleSmall
    ];
    expect(nextOrderStageAfterPhysicalCompletion(items, "cutting")).toBe(
      ORDER_STAGES.sewingWaiting
    );
  });

  it("keeps final business status pending when production is done but a non-blocking task remains active", () => {
    expect(
      deriveOrderCompletionStatus({
        sampleRequestItems: [
          SAMPLE_REQUEST_ITEMS.sampleGarment,
          SAMPLE_REQUEST_ITEMS.patternFullSize
        ],
        orderStage: ORDER_STAGES.done,
        patternTaskStatus: "active"
      })
    ).toBe("production_completed_pattern_pending");
  });

  it("rejects filename-only and archived deliverables as completion evidence", () => {
    const requirements = [SAMPLE_REQUEST_ITEMS.patternMaking];
    expect(
      completedPatternRequirementsFromDeliverables(requirements, [
        deliverable(SAMPLE_REQUEST_ITEMS.patternMaking, { storageKey: undefined })
      ])
    ).toEqual([]);
    expect(
      completedPatternRequirementsFromDeliverables(requirements, [
        deliverable(SAMPLE_REQUEST_ITEMS.patternMaking, { storageKey: "   " })
      ])
    ).toEqual([]);
    expect(
      completedPatternRequirementsFromDeliverables(requirements, [
        deliverable(SAMPLE_REQUEST_ITEMS.patternMaking, {
          archivedAt: "2026-07-14T01:00:00.000Z"
        })
      ])
    ).toEqual([]);
  });
});
