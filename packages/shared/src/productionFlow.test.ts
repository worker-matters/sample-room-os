import { describe, expect, it } from "vitest";
import {
  deriveOrderCompletionStatus,
  blockingPatternRequirementsFromItems,
  firstPhysicalOrderStage,
  hasPhysicalProductionRoute,
  initialPhysicalOrderStage,
  isPatternProductionGateSatisfied,
  isSampleRequestItemComplete,
  nextOrderStageAfterPhysicalCompletion,
  patternTaskRequirementsFromItems,
  physicalProductionRoute
} from "./productionFlow.js";
import { ORDER_STAGES, SAMPLE_REQUEST_ITEMS } from "./statuses.js";

describe("parallel pattern and physical production rules", () => {
  it("derives all supported physical production routes", () => {
    expect(
      physicalProductionRoute([
        SAMPLE_REQUEST_ITEMS.patternRevision,
        SAMPLE_REQUEST_ITEMS.cutting,
        SAMPLE_REQUEST_ITEMS.sampleGarment
      ])
    ).toEqual(["cutting", "sewing", "qc_delivery"]);
    expect(physicalProductionRoute([SAMPLE_REQUEST_ITEMS.cutting])).toEqual(["cutting"]);
    expect(physicalProductionRoute([SAMPLE_REQUEST_ITEMS.sampleGarment])).toEqual([
      "sewing",
      "qc_delivery"
    ]);
    expect(physicalProductionRoute([SAMPLE_REQUEST_ITEMS.sampleSmall])).toEqual([
      "sewing",
      "qc_delivery"
    ]);
    expect(
      physicalProductionRoute([
        SAMPLE_REQUEST_ITEMS.sampleGarment,
        SAMPLE_REQUEST_ITEMS.sampleSmall
      ])
    ).toEqual(["sewing", "qc_delivery"]);
    expect(physicalProductionRoute([SAMPLE_REQUEST_ITEMS.patternRevision])).toEqual([]);
    expect(hasPhysicalProductionRoute([SAMPLE_REQUEST_ITEMS.cutting])).toBe(true);
    expect(hasPhysicalProductionRoute([SAMPLE_REQUEST_ITEMS.patternRevision])).toBe(false);
  });

  it("starts and advances only selected physical stages", () => {
    expect(initialPhysicalOrderStage([SAMPLE_REQUEST_ITEMS.cutting])).toBe(
      ORDER_STAGES.cuttingWaiting
    );
    expect(initialPhysicalOrderStage([SAMPLE_REQUEST_ITEMS.sampleGarment])).toBe(
      ORDER_STAGES.sewingWaiting
    );
    expect(initialPhysicalOrderStage([SAMPLE_REQUEST_ITEMS.sampleSmall])).toBe(
      ORDER_STAGES.sewingWaiting
    );
    expect(initialPhysicalOrderStage([SAMPLE_REQUEST_ITEMS.patternMaking])).toBe(
      ORDER_STAGES.done
    );
    expect(
      initialPhysicalOrderStage([
        SAMPLE_REQUEST_ITEMS.patternMaking,
        SAMPLE_REQUEST_ITEMS.cutting,
        SAMPLE_REQUEST_ITEMS.sampleGarment
      ])
    ).toBe(ORDER_STAGES.patternWaiting);
    expect(
      initialPhysicalOrderStage([
        SAMPLE_REQUEST_ITEMS.patternFullSize,
        SAMPLE_REQUEST_ITEMS.cutting
      ])
    ).toBe(ORDER_STAGES.cuttingWaiting);
    expect(
      firstPhysicalOrderStage([
        SAMPLE_REQUEST_ITEMS.patternRevision,
        SAMPLE_REQUEST_ITEMS.sampleGarment
      ])
    ).toBe(ORDER_STAGES.sewingWaiting);
    expect(
      nextOrderStageAfterPhysicalCompletion([SAMPLE_REQUEST_ITEMS.cutting], "cutting")
    ).toBe(ORDER_STAGES.done);
    expect(
      nextOrderStageAfterPhysicalCompletion(
        [SAMPLE_REQUEST_ITEMS.cutting, SAMPLE_REQUEST_ITEMS.sampleGarment],
        "cutting"
      )
    ).toBe(ORDER_STAGES.sewingWaiting);
    expect(
      nextOrderStageAfterPhysicalCompletion(
        [SAMPLE_REQUEST_ITEMS.cutting, SAMPLE_REQUEST_ITEMS.sampleSmall],
        "cutting"
      )
    ).toBe(ORDER_STAGES.sewingWaiting);
  });

  it("releases production only after selected pattern-making and revision results exist", () => {
    const items = [
      SAMPLE_REQUEST_ITEMS.patternMaking,
      SAMPLE_REQUEST_ITEMS.patternRevision,
      SAMPLE_REQUEST_ITEMS.patternFullSize,
      SAMPLE_REQUEST_ITEMS.cutting
    ];
    expect(blockingPatternRequirementsFromItems(items)).toEqual([
      SAMPLE_REQUEST_ITEMS.patternMaking,
      SAMPLE_REQUEST_ITEMS.patternRevision
    ]);
    expect(isPatternProductionGateSatisfied(items, [SAMPLE_REQUEST_ITEMS.patternMaking])).toBe(false);
    expect(
      isPatternProductionGateSatisfied(items, [
        SAMPLE_REQUEST_ITEMS.patternMaking,
        SAMPLE_REQUEST_ITEMS.patternRevision
      ])
    ).toBe(true);
  });

  it("extracts selected pattern requirements into one comprehensive task", () => {
    expect(
      patternTaskRequirementsFromItems([
        SAMPLE_REQUEST_ITEMS.patternRevision,
        SAMPLE_REQUEST_ITEMS.patternFullSize,
        SAMPLE_REQUEST_ITEMS.patternZipperLength,
        SAMPLE_REQUEST_ITEMS.cutting
      ])
    ).toEqual([
      SAMPLE_REQUEST_ITEMS.patternRevision,
      SAMPLE_REQUEST_ITEMS.patternFullSize,
      SAMPLE_REQUEST_ITEMS.patternZipperLength
    ]);
  });

  it("keeps production completion separate from final order completion", () => {
    const sampleRequestItems = [
      SAMPLE_REQUEST_ITEMS.patternRevision,
      SAMPLE_REQUEST_ITEMS.sampleGarment
    ];
    expect(
      deriveOrderCompletionStatus({
        sampleRequestItems,
        orderStage: ORDER_STAGES.done,
        patternTaskStatus: "paused"
      })
    ).toBe("production_completed_pattern_pending");
    expect(
      deriveOrderCompletionStatus({
        sampleRequestItems,
        orderStage: ORDER_STAGES.done,
        patternTaskStatus: "completed"
      })
    ).toBe("completed");
    expect(
      deriveOrderCompletionStatus({
        sampleRequestItems: [SAMPLE_REQUEST_ITEMS.patternRevision],
        orderStage: ORDER_STAGES.done,
        patternTaskStatus: "paused"
      })
    ).toBe("pattern_only_pending");
  });

  it("reports each selected order task from authoritative pattern and production facts", () => {
    expect(
      isSampleRequestItemComplete({
        item: SAMPLE_REQUEST_ITEMS.patternMaking,
        orderStage: ORDER_STAGES.cuttingWaiting,
        completedPatternRequirements: [SAMPLE_REQUEST_ITEMS.patternMaking]
      })
    ).toBe(true);
    expect(
      isSampleRequestItemComplete({
        item: SAMPLE_REQUEST_ITEMS.patternRevision,
        orderStage: ORDER_STAGES.cuttingWaiting,
        completedPatternRequirements: [SAMPLE_REQUEST_ITEMS.patternMaking]
      })
    ).toBe(false);
    expect(
      isSampleRequestItemComplete({
        item: SAMPLE_REQUEST_ITEMS.cutting,
        orderStage: ORDER_STAGES.sewingWaiting
      })
    ).toBe(true);
    expect(
      isSampleRequestItemComplete({
        item: SAMPLE_REQUEST_ITEMS.sampleGarment,
        orderStage: ORDER_STAGES.qcDeliveryWaiting
      })
    ).toBe(true);
    expect(
      isSampleRequestItemComplete({
        item: SAMPLE_REQUEST_ITEMS.sampleGarment,
        orderStage: ORDER_STAGES.sewingDoing
      })
    ).toBe(false);
    expect(
      isSampleRequestItemComplete({
        item: SAMPLE_REQUEST_ITEMS.sampleSmall,
        orderStage: ORDER_STAGES.done
      })
    ).toBe(true);
  });
});
