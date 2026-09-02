import {
  ORDER_STAGES,
  PATTERN_TASK_REQUIREMENTS,
  SAMPLE_REQUEST_ITEMS,
  type OrderStage,
  type PatternTaskRequirement,
  type SampleRequestItem
} from "./statuses.js";

export type PhysicalProductionStage = "cutting" | "sewing" | "qc_delivery";

export type OrderCompletionStatus =
  | "in_progress"
  | "pattern_only_pending"
  | "production_completed_pattern_pending"
  | "completed";

const completedPatternTaskStatuses = new Set<string>([
  "completed",
  "submitted",
  "submitted_to_cutting"
]);

export const PRODUCTION_BLOCKING_PATTERN_REQUIREMENTS = [
  SAMPLE_REQUEST_ITEMS.patternMaking,
  SAMPLE_REQUEST_ITEMS.patternRevision
] as const satisfies readonly PatternTaskRequirement[];

export function blockingPatternRequirementsFromItems(
  items: readonly SampleRequestItem[]
): PatternTaskRequirement[] {
  const selected = new Set<string>(items);
  return PRODUCTION_BLOCKING_PATTERN_REQUIREMENTS.filter((requirement) => selected.has(requirement));
}

export function isPatternProductionGateSatisfied(
  items: readonly SampleRequestItem[],
  deliveredCategories: readonly string[]
) {
  const delivered = new Set(deliveredCategories);
  return blockingPatternRequirementsFromItems(items).every((requirement) => delivered.has(requirement));
}

export function patternTaskRequirementsFromItems(
  items: readonly SampleRequestItem[]
): PatternTaskRequirement[] {
  const selected = new Set<string>(items);
  return PATTERN_TASK_REQUIREMENTS.filter((requirement) => selected.has(requirement));
}

export function hasPatternTaskRequirements(items: readonly SampleRequestItem[]) {
  return patternTaskRequirementsFromItems(items).length > 0;
}

export function physicalProductionRoute(
  items: readonly SampleRequestItem[]
): PhysicalProductionStage[] {
  const route: PhysicalProductionStage[] = [];
  if (items.includes(SAMPLE_REQUEST_ITEMS.cutting)) route.push("cutting");
  if (
    items.includes(SAMPLE_REQUEST_ITEMS.sampleGarment) ||
    items.includes(SAMPLE_REQUEST_ITEMS.sampleSmall)
  ) {
    route.push("sewing", "qc_delivery");
  }
  return route;
}

export function hasPhysicalProductionRoute(items: readonly SampleRequestItem[]) {
  return physicalProductionRoute(items).length > 0;
}

export function firstPhysicalOrderStage(items: readonly SampleRequestItem[]): OrderStage {
  const first = physicalProductionRoute(items)[0];
  if (first === "cutting") return ORDER_STAGES.cuttingWaiting;
  if (first === "sewing") return ORDER_STAGES.sewingWaiting;
  return ORDER_STAGES.done;
}

export function initialPhysicalOrderStage(items: readonly SampleRequestItem[]): OrderStage {
  return hasPhysicalProductionRoute(items) && blockingPatternRequirementsFromItems(items).length > 0
    ? ORDER_STAGES.patternWaiting
    : firstPhysicalOrderStage(items);
}

export function physicalStageForOrderStage(
  stage: OrderStage | null | undefined
): PhysicalProductionStage | null {
  if (stage === ORDER_STAGES.cuttingWaiting || stage === ORDER_STAGES.cuttingDoing) {
    return "cutting";
  }
  if (stage === ORDER_STAGES.sewingWaiting || stage === ORDER_STAGES.sewingDoing) {
    return "sewing";
  }
  if (stage === ORDER_STAGES.qcDeliveryWaiting) return "qc_delivery";
  return null;
}

export function nextOrderStageAfterPhysicalCompletion(
  items: readonly SampleRequestItem[],
  completedStage: PhysicalProductionStage
): OrderStage {
  if (completedStage === "cutting") {
    return items.includes(SAMPLE_REQUEST_ITEMS.sampleGarment) ||
      items.includes(SAMPLE_REQUEST_ITEMS.sampleSmall)
      ? ORDER_STAGES.sewingWaiting
      : ORDER_STAGES.done;
  }
  if (completedStage === "sewing") return ORDER_STAGES.qcDeliveryWaiting;
  return ORDER_STAGES.done;
}

export function isPhysicalProductionComplete(
  items: readonly SampleRequestItem[],
  orderStage: OrderStage | null | undefined
) {
  return !hasPhysicalProductionRoute(items) || orderStage === ORDER_STAGES.done;
}

export function isSampleRequestItemComplete(input: {
  item: SampleRequestItem;
  orderStage: OrderStage | null | undefined;
  completedPatternRequirements?: readonly string[] | undefined;
}) {
  if ((PATTERN_TASK_REQUIREMENTS as readonly string[]).includes(input.item)) {
    return (input.completedPatternRequirements ?? []).includes(input.item);
  }

  if (input.item === SAMPLE_REQUEST_ITEMS.cutting) {
    const completedCuttingStages: readonly OrderStage[] = [
      ORDER_STAGES.sewingWaiting,
      ORDER_STAGES.sewingDoing,
      ORDER_STAGES.qcDeliveryWaiting,
      ORDER_STAGES.done
    ];
    return input.orderStage ? completedCuttingStages.includes(input.orderStage) : false;
  }

  if (
    input.item === SAMPLE_REQUEST_ITEMS.sampleGarment ||
    input.item === SAMPLE_REQUEST_ITEMS.sampleSmall
  ) {
    return input.orderStage === ORDER_STAGES.qcDeliveryWaiting ||
      input.orderStage === ORDER_STAGES.done;
  }

  return false;
}

export function isPatternTaskComplete(status: string | null | undefined) {
  return status ? completedPatternTaskStatuses.has(status) : false;
}

export function deriveOrderCompletionStatus(input: {
  sampleRequestItems: readonly SampleRequestItem[];
  orderStage: OrderStage | null | undefined;
  patternTaskStatus?: string | null | undefined;
}): OrderCompletionStatus {
  const productionComplete = isPhysicalProductionComplete(
    input.sampleRequestItems,
    input.orderStage
  );
  const patternComplete =
    !hasPatternTaskRequirements(input.sampleRequestItems) ||
    isPatternTaskComplete(input.patternTaskStatus);

  if (
    !hasPhysicalProductionRoute(input.sampleRequestItems) &&
    hasPatternTaskRequirements(input.sampleRequestItems) &&
    !patternComplete
  ) {
    return "pattern_only_pending";
  }

  if (productionComplete && patternComplete) return "completed";
  if (productionComplete) return "production_completed_pattern_pending";
  return "in_progress";
}
