import {
  PATTERN_SOURCE_TYPES,
  PATTERN_STATUSES,
  PATTERN_TASK_REQUIREMENTS,
  DEFAULT_SAMPLE_REQUEST_ITEMS,
  SAMPLE_REQUEST_ITEMS,
  sampleGarmentRequiredFromItems,
  type PatternSourceType,
  type PatternStatus,
  type SampleRequestItem
} from "@sample-room/shared";
import { HttpError } from "../../shared/errors/httpError.js";

const sampleRequestItemValues = new Set<string>([
  SAMPLE_REQUEST_ITEMS.sampleGarment,
  SAMPLE_REQUEST_ITEMS.sampleSmall,
  SAMPLE_REQUEST_ITEMS.cutting,
  ...PATTERN_TASK_REQUIREMENTS
]);
const patternSourceTypeValues = new Set<string>(Object.values(PATTERN_SOURCE_TYPES));

export const defaultSampleRequestItems: SampleRequestItem[] = [...DEFAULT_SAMPLE_REQUEST_ITEMS];

export function patternSourceTypeFromPatternStatus(
  patternStatus: PatternStatus
): PatternSourceType {
  return patternStatus === PATTERN_STATUSES.has
    ? PATTERN_SOURCE_TYPES.customerProvided
    : PATTERN_SOURCE_TYPES.none;
}

export function normalizeSampleRequestItems(value: unknown): SampleRequestItem[] {
  if (value === undefined || value === null) {
    return [...defaultSampleRequestItems];
  }

  if (!Array.isArray(value)) {
    throw new HttpError(400, "sampleRequestItems must be an array.");
  }

  const normalized: SampleRequestItem[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !sampleRequestItemValues.has(item)) {
      throw new HttpError(400, "sampleRequestItems contains an unsupported item.");
    }

    if (!normalized.includes(item as SampleRequestItem)) {
      normalized.push(item as SampleRequestItem);
    }
  }

  return normalized;
}

export function sampleGarmentRequired(value: readonly SampleRequestItem[]) {
  return sampleGarmentRequiredFromItems(value);
}

export function normalizePatternSourceType(
  value: unknown,
  options: { allowSameOrderRevision: boolean } = { allowSameOrderRevision: true }
): PatternSourceType {
  if (value === undefined || value === null || value === "") {
    return PATTERN_SOURCE_TYPES.previousOrder;
  }

  if (typeof value !== "string" || !patternSourceTypeValues.has(value)) {
    throw new HttpError(400, "patternSourceType is not supported.");
  }

  if (!options.allowSameOrderRevision && value === PATTERN_SOURCE_TYPES.sameOrderRevision) {
    throw new HttpError(400, "same_order_revision cannot be used here.");
  }

  return value as PatternSourceType;
}
