import {
  ORDER_STAGES,
  firstPhysicalOrderStage,
  isPatternProductionGateSatisfied,
  patternTaskRequirementsFromItems,
  physicalProductionRoute,
  type OrderStage,
  type PatternTaskRequirement,
  type SampleRequestItem
} from "@sample-room/shared";
import type { PatternDeliverableRecord } from "./patternTypes.js";

export function isValidPatternRequirementDeliverable(
  deliverable: Pick<PatternDeliverableRecord, "archivedAt" | "storageKey" | "taskCategory">
) {
  return Boolean(
    !deliverable.archivedAt &&
      deliverable.storageKey?.trim() &&
      deliverable.taskCategory &&
      deliverable.taskCategory !== "other"
  );
}

export function completedPatternRequirementsFromDeliverables(
  requirements: readonly PatternTaskRequirement[],
  deliverables: readonly PatternDeliverableRecord[]
): PatternTaskRequirement[] {
  const delivered = new Set(
    deliverables
      .filter(isValidPatternRequirementDeliverable)
      .map((deliverable) => deliverable.taskCategory as PatternTaskRequirement)
  );
  return requirements.filter((requirement) => delivered.has(requirement));
}

export function isPatternProductionGateSatisfiedByDeliverables(
  items: readonly SampleRequestItem[],
  deliverables: readonly PatternDeliverableRecord[]
) {
  return isPatternProductionGateSatisfied(
    items,
    completedPatternRequirementsFromDeliverables(
      patternTaskRequirementsFromItems(items),
      deliverables
    )
  );
}

export function currentOrderStageFromPatternGate(input: {
  sampleRequestItems: readonly SampleRequestItem[];
  storedStage: OrderStage | null;
  deliverables: readonly PatternDeliverableRecord[];
}): OrderStage | null {
  if (
    physicalProductionRoute(input.sampleRequestItems).length > 0 &&
    !isPatternProductionGateSatisfiedByDeliverables(
      input.sampleRequestItems,
      input.deliverables
    )
  ) {
    return ORDER_STAGES.patternWaiting;
  }

  if (
    input.storedStage === ORDER_STAGES.patternWaiting ||
    input.storedStage === ORDER_STAGES.patternDoing
  ) {
    return firstPhysicalOrderStage(input.sampleRequestItems);
  }

  return input.storedStage;
}
