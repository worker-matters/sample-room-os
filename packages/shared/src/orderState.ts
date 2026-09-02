import {
  DEFAULT_SAMPLE_REQUEST_ITEMS,
  INTAKE_STATUSES,
  MATERIAL_STATUSES,
  ORDER_STAGES,
  type OrderStage,
  PATTERN_STATUSES,
  type PatternStatus,
  type SampleRequestItem
} from "./statuses.js";
import type { OrderStateSnapshot } from "./dto.js";
import { initialPhysicalOrderStage } from "./productionFlow.js";

export function createClientSubmissionInitialState(): OrderStateSnapshot {
  return {
    sourceType: "client_submission",
    intakeStatus: INTAKE_STATUSES.pendingReceive,
    stage: null,
    patternStatus: PATTERN_STATUSES.none,
    fabricStatus: MATERIAL_STATUSES.missing,
    trimStatus: MATERIAL_STATUSES.missing,
    isInFormalFlow: false
  };
}

export function acceptPendingReceive(
  patternStatus: PatternStatus,
  sampleRequestItems: readonly SampleRequestItem[] = DEFAULT_SAMPLE_REQUEST_ITEMS
): OrderStateSnapshot {
  return {
    sourceType: "client_submission",
    intakeStatus: INTAKE_STATUSES.received,
    stage: initialPhysicalOrderStage(sampleRequestItems),
    patternStatus,
    fabricStatus: MATERIAL_STATUSES.missing,
    trimStatus: MATERIAL_STATUSES.missing,
    isInFormalFlow: true
  };
}

export function createReceiverSelfEntryInitialState(
  patternStatus: PatternStatus,
  sampleRequestItems: readonly SampleRequestItem[] = DEFAULT_SAMPLE_REQUEST_ITEMS
): OrderStateSnapshot {
  return {
    sourceType: "receiver_self_entry",
    intakeStatus: INTAKE_STATUSES.received,
    stage: initialPhysicalOrderStage(sampleRequestItems),
    patternStatus,
    fabricStatus: MATERIAL_STATUSES.missing,
    trimStatus: MATERIAL_STATUSES.missing,
    isInFormalFlow: true
  };
}

export function updateTrackingPatternStatus(
  currentStage: OrderStage,
  newPatternStatus: PatternStatus
): OrderStage {
  void newPatternStatus;
  return currentStage;
}
