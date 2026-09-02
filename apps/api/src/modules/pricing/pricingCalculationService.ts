import { hasPhysicalProductionRoute } from "@sample-room/shared";
import type { OrderRecord, ReceiverOrderDto } from "../orders/orderTypes.js";
import { collaborativeSewingRoundStates } from "../scan/collaborativeSewing.js";
import { effectiveProcessPieces } from "../scan/processPiecesCorrections.js";
import type { ScanRecord } from "../scan/scanTypes.js";
import {
  ORDER_CHARGE_STATUSES,
  PRICING_QUOTATION_STATUSES,
  type CustomerChargeItemRecord,
  type InternalCostItemRecord,
  type OrderChargeRecord,
  type PricingReconciliationEligibility,
  type PricingRecord,
  type PricingStageWorkSummary,
  type PricingSummary
} from "./pricingTypes.js";

const pricingStageOrder: Array<{
  stage: PricingStageWorkSummary["stage"];
  label: string;
}> = [
  { stage: "cutting", label: "裁剪" },
  { stage: "pattern", label: "制版" },
  { stage: "sewing", label: "缝制" }
];

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function stageChargeLabel(stageLabel: string) {
  return `${stageLabel}工费`;
}

function isStageChargeLabel(label: string) {
  return pricingStageOrder.some((stageRow) => label === stageChargeLabel(stageRow.label));
}

function legacyOtherCharges(pricing?: PricingRecord) {
  return (pricing?.extraCharges ?? []).filter((charge) => !isStageChargeLabel(charge.label));
}

function legacyStageCost(
  pricing: PricingRecord | undefined,
  stage: PricingStageWorkSummary["stage"]
) {
  const label = pricingStageOrder.find((row) => row.stage === stage)?.label;
  if (!label) return 0;
  return (pricing?.extraCharges ?? [])
    .filter((charge) => charge.label === stageChargeLabel(label))
    .reduce((sum, charge) => sum + charge.amount, 0);
}

export function activeInternalCostItems(pricing?: PricingRecord) {
  return (pricing?.internalCostItems ?? []).filter((item) => !item.archivedAt);
}

export function activeCustomerChargeItems(pricing?: PricingRecord) {
  return (pricing?.customerChargeItems ?? []).filter((item) => !item.archivedAt);
}

export function effectiveOrderCharges(charges: readonly OrderChargeRecord[]) {
  return charges.filter(
    (charge) =>
      !charge.archivedAt &&
      (charge.status === ORDER_CHARGE_STATUSES.confirmed ||
        charge.status === ORDER_CHARGE_STATUSES.effective)
  );
}

function itemAmount(item: CustomerChargeItemRecord) {
  if (item.pricingMethod === "unit_quantity") {
    return money((item.unitPrice ?? 0) * (item.quantity ?? 0));
  }
  return money(item.amount);
}

function legacyInternalCosts(pricing?: PricingRecord) {
  const pattern = pricing?.internalPatternCost ?? legacyStageCost(pricing, "pattern");
  const cutting = pricing?.internalCuttingCost ?? legacyStageCost(pricing, "cutting");
  const sewing = pricing?.internalSewingCost ?? legacyStageCost(pricing, "sewing");
  const finishing = pricing?.internalFinishingCost ?? 0;
  const structured = [
    pricing?.internalPatternCost,
    pricing?.internalCuttingCost,
    pricing?.internalSewingCost,
    pricing?.internalFinishingCost
  ].some((value) => value !== undefined);
  const legacyStages = pattern + cutting + sewing > 0;
  return {
    pattern,
    cutting,
    sewing,
    finishing,
    total: structured || legacyStages
      ? money(pattern + cutting + sewing + finishing)
      : money(pricing?.costAmount ?? 0),
    hasCost: structured || legacyStages || pricing?.costAmount !== undefined
  };
}

export function pricingChargeTotals(
  pricing?: PricingRecord,
  charges: readonly OrderChargeRecord[] = []
) {
  const confirmedOtherChargeTotal = money(
    effectiveOrderCharges(charges).reduce((sum, charge) => sum + charge.amount, 0) +
      legacyOtherCharges(pricing).reduce((sum, charge) => sum + charge.amount, 0)
  );
  const dynamicInternal = activeInternalCostItems(pricing);
  const legacy = legacyInternalCosts(pricing);
  const baseInternalCost = dynamicInternal.length > 0
    ? money(dynamicInternal.reduce((sum, item) => sum + item.amount, 0))
    : legacy.total;
  const dynamicCustomer = activeCustomerChargeItems(pricing);
  const customerQuoteSubtotal = dynamicCustomer.length > 0
    ? money(dynamicCustomer.reduce((sum, item) => sum + itemAmount(item), 0))
    : 0;
  return {
    stageCostTotal: baseInternalCost,
    patternFeeTotal: pricing?.customerPatternFee ?? 0,
    otherChargeTotal: confirmedOtherChargeTotal,
    confirmedOtherChargeTotal,
    baseInternalCost,
    customerQuoteSubtotal,
    internalCostTotal: baseInternalCost
  };
}

export function otherChargeNote(
  pricing?: PricingRecord,
  charges: readonly OrderChargeRecord[] = []
) {
  const legacyNotes = legacyOtherCharges(pricing).map((charge) => charge.label);
  const currentNotes = effectiveOrderCharges(charges).map((charge) => charge.name);
  return [...legacyNotes, ...currentNotes].join("；") || undefined;
}

export function confirmedOtherChargeSnapshot(
  pricing?: PricingRecord,
  charges: readonly OrderChargeRecord[] = []
) {
  return [
    ...legacyOtherCharges(pricing).map((charge) => ({
      id: charge.id,
      name: charge.label,
      amount: charge.amount,
      explanation: charge.note ?? ""
    })),
    ...effectiveOrderCharges(charges).map((charge) => ({
      id: charge.id,
      name: charge.name,
      amount: charge.amount,
      explanation: charge.explanation
    }))
  ];
}

function legacyCustomerSubtotal(
  order: Pick<ReceiverOrderDto, "quantity"> &
    Partial<Pick<ReceiverOrderDto, "sampleRequestItems">>,
  pricing?: PricingRecord
) {
  const quantity = hasPhysicalProductionRoute(order.sampleRequestItems ?? [])
    ? Number.isFinite(order.quantity) ? order.quantity : 0
    : 0;
  const sampleAmount = money((pricing?.quotedPrice ?? 0) * quantity);
  return {
    sampleAmount,
    customerPatternFee: pricing?.customerPatternFee ?? 0,
    subtotal: money(sampleAmount + (pricing?.customerPatternFee ?? 0))
  };
}

export function summarizePricing(
  order: Pick<ReceiverOrderDto, "id" | "quantity"> &
    Partial<Pick<ReceiverOrderDto, "sampleRequestItems">>,
  pricing?: PricingRecord,
  charges: readonly OrderChargeRecord[] = []
): PricingSummary {
  const totals = pricingChargeTotals(pricing, charges);
  const legacyCustomer = legacyCustomerSubtotal(order, pricing);
  const dynamicCustomer = activeCustomerChargeItems(pricing);
  const customerQuoteSubtotal =
    dynamicCustomer.length > 0 ? totals.customerQuoteSubtotal : legacyCustomer.subtotal;
  const otherChargeTotal = totals.confirmedOtherChargeTotal;
  const receivableTotal = money(customerQuoteSubtotal + otherChargeTotal);
  const internalTotalCost = totals.baseInternalCost;
  const grossProfit = money(customerQuoteSubtotal - totals.baseInternalCost);
  const grossMargin =
    customerQuoteSubtotal > 0 ? money((grossProfit / customerQuoteSubtotal) * 100) : undefined;
  const legacy = legacyInternalCosts(pricing);

  return {
    orderId: order.id,
    quotedPrice: pricing?.quotedPrice,
    sampleUnitPrice: pricing?.quotedPrice,
    sampleAmount: legacyCustomer.sampleAmount,
    customerPatternFee: legacyCustomer.customerPatternFee,
    effectiveCustomerOtherCharges: otherChargeTotal,
    internalPatternCost: legacy.pattern,
    internalCuttingCost: legacy.cutting,
    internalSewingCost: legacy.sewing,
    internalFinishingCost: legacy.finishing,
    internalTotalCost,
    quotationStatus: pricing?.quotationStatus ?? PRICING_QUOTATION_STATUSES.draft,
    stageCostTotal: totals.baseInternalCost,
    patternFeeTotal: legacyCustomer.customerPatternFee,
    otherChargeTotal,
    costAmount: totals.baseInternalCost,
    extraChargeTotal: otherChargeTotal,
    receivableTotal,
    grossProfit,
    grossMargin,
    customerQuoteSubtotal,
    confirmedOtherChargeTotal: otherChargeTotal,
    baseInternalCost: totals.baseInternalCost
  };
}

export function confirmedCustomerQuotation(pricing?: PricingRecord) {
  if (!pricing || !pricing.confirmedAt) {
    return undefined;
  }
  if (
    pricing.confirmedCustomerChargeSnapshot &&
    pricing.confirmedCustomerQuoteSubtotal !== undefined &&
    pricing.confirmedOtherChargeTotal !== undefined &&
    pricing.confirmedReceivableTotal !== undefined
  ) {
    const otherCharges = pricing.confirmedOtherChargeSnapshot ?? [];
    return {
      sampleUnitPrice: pricing.confirmedSampleUnitPrice ?? 0,
      sampleAmount: pricing.confirmedSampleAmount ?? 0,
      customerPatternFee: pricing.confirmedCustomerPatternFee ?? 0,
      customerChargeItems: pricing.confirmedCustomerChargeSnapshot,
      effectiveCustomerOtherCharges: pricing.confirmedOtherChargeTotal,
      customerQuoteSubtotal: pricing.confirmedCustomerQuoteSubtotal,
      receivableTotal: pricing.confirmedReceivableTotal,
      status: PRICING_QUOTATION_STATUSES.confirmed,
      confirmedAt: pricing.confirmedAt,
      otherChargeNote:
        otherCharges.map((charge) => charge.name).join("；") ||
        undefined,
      otherCharges
    };
  }
  if (
    pricing.confirmedSampleUnitPrice === undefined ||
    pricing.confirmedSampleAmount === undefined ||
    pricing.confirmedCustomerPatternFee === undefined ||
    pricing.confirmedOtherChargeTotal === undefined ||
    pricing.confirmedReceivableTotal === undefined
  ) {
    return undefined;
  }
  return {
    sampleUnitPrice: pricing.confirmedSampleUnitPrice,
    sampleAmount: pricing.confirmedSampleAmount,
    customerPatternFee: pricing.confirmedCustomerPatternFee,
    customerChargeItems: [] as CustomerChargeItemRecord[],
    effectiveCustomerOtherCharges: pricing.confirmedOtherChargeTotal,
    customerQuoteSubtotal:
      pricing.confirmedCustomerQuoteSubtotal ??
      money(pricing.confirmedSampleAmount + pricing.confirmedCustomerPatternFee),
    receivableTotal: pricing.confirmedReceivableTotal,
    status: PRICING_QUOTATION_STATUSES.confirmed,
    confirmedAt: pricing.confirmedAt,
    otherChargeNote: pricing.confirmedOtherChargeNote,
    otherCharges: pricing.confirmedOtherChargeSnapshot ?? []
  };
}

export function pricingReconciliationEligibility(
  pricing: PricingRecord | undefined,
  summary: PricingSummary
): PricingReconciliationEligibility {
  if (!pricing) {
    return { eligible: false, reason: "pricing_missing" };
  }
  const confirmedQuotation = confirmedCustomerQuotation(pricing);
  const quotationChanged = Boolean(
    confirmedQuotation &&
      Math.abs(confirmedQuotation.customerQuoteSubtotal - summary.customerQuoteSubtotal) > 0.001
  );
  if (quotationChanged) {
    return { eligible: false, reason: "quotation_changed" };
  }
  if (pricing.quotationStatus !== PRICING_QUOTATION_STATUSES.confirmed) {
    return { eligible: false, reason: "quotation_not_confirmed" };
  }
  if (!confirmedQuotation) {
    return { eligible: false, reason: "quotation_snapshot_incomplete" };
  }
  return { eligible: true };
}

export function currentConfirmedCustomerQuotation(
  pricing: PricingRecord | undefined,
  _summary?: PricingSummary,
  charges?: readonly OrderChargeRecord[]
) {
  const quotation = confirmedCustomerQuotation(pricing);
  if (!quotation || charges === undefined) {
    return quotation;
  }
  const otherCharges = confirmedOtherChargeSnapshot(pricing, charges);
  const effectiveCustomerOtherCharges = money(
    otherCharges.reduce((sum, charge) => sum + charge.amount, 0)
  );
  return {
    ...quotation,
    effectiveCustomerOtherCharges,
    receivableTotal: money(quotation.customerQuoteSubtotal + effectiveCustomerOtherCharges),
    otherChargeNote: otherCharges.map((charge) => charge.name).join("；") || undefined,
    otherCharges
  };
}

export function finishingEvidence(
  records: readonly ScanRecord[],
  hasQcDeliveryRoute: boolean
) {
  if (!hasQcDeliveryRoute) {
    return { visible: false as const, pieces: null, anomaly: null };
  }
  const qcOrDeliveryEvidence = [...records]
    .filter(
      (record) =>
        record.stage === "qc_delivery" &&
        record.action === "complete"
    )
    .sort((left, right) => left.eventTime.localeCompare(right.eventTime))
    .at(-1);
  const sewingCompletion = [...records]
    .filter((record) => record.stage === "sewing" && record.action === "complete")
    .sort((left, right) => left.eventTime.localeCompare(right.eventTime))
    .at(-1);
  const pieces =
    typeof qcOrDeliveryEvidence?.pieces === "number"
      ? qcOrDeliveryEvidence.pieces
      : typeof sewingCompletion?.pieces === "number"
        ? sewingCompletion.pieces
        : null;
  return {
    visible: Boolean(qcOrDeliveryEvidence),
    pieces,
    anomaly: qcOrDeliveryEvidence
      ? pieces === null
        ? ("finishing_pieces_missing" as const)
        : null
      : ("finishing_evidence_pending" as const)
  };
}

export function summarizeStageWork(
  records: ScanRecord[],
  order?: Pick<OrderRecord, "quantity" | "correctionLogs">
): PricingStageWorkSummary[] {
  return pricingStageOrder.flatMap(({ stage, label }) => {
    let stageRecords = records
      .filter(
        (record) =>
          record.stage === stage &&
          (record.action === "complete" || record.action === "termination_complete") &&
          typeof record.workHours === "number"
      )
      .sort((left, right) => left.eventTime.localeCompare(right.eventTime));

    const collaborationRounds = stage === "sewing" && order
      ? collaborativeSewingRoundStates(order, records)
      : [];
    const usesCollaboration = collaborationRounds.some((round) => round.usesParticipationWorkflow);
    if (usesCollaboration) {
      const completionIds = new Set(
        collaborationRounds.flatMap((round) => round.effectiveParticipations).flatMap(
          (item) => item.completionScanRecordId ? [item.completionScanRecordId] : []
        )
      );
      stageRecords = stageRecords.filter((record) => completionIds.has(record.id));
    }

    if (stageRecords.length === 0) return [];

    const workHours = stageRecords.reduce((sum, record) => sum + (record.workHours ?? 0), 0);
    const pieces = usesCollaboration
      ? collaborationRounds.reduce((sum, round) => sum + round.completedPieces, 0)
      : stageRecords.reduce(
          (sum, record) => sum + (order ? effectiveProcessPieces(order, record) ?? 0 : record.pieces ?? 0),
          0
        );
    const latest = stageRecords[stageRecords.length - 1]!;
    const workerNames = collaborationRounds.some((round) => round.mode === "collaboration")
      ? ["多人协作"]
      : [...new Set(stageRecords.map((record) => record.workerName))];

    return [{
      stage,
      stageLabel: label,
      workHours,
      ...(pieces > 0 ? { pieces } : {}),
      workerNames,
      completedAt: latest.eventTime,
      ...(latest.note ? { note: latest.note } : {})
    }];
  });
}
