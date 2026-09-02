import {
  ROLES,
  SAMPLE_REQUEST_ITEMS,
  deriveOrderCompletionStatus,
  hasPatternTaskRequirements,
  isClientRole,
  physicalProductionRoute,
  sampleRequestItemOptions
} from "@sample-room/shared";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import {
  canClientReadOrder,
  hasActiveClientBinding,
  isBossOrSystemOwner
} from "../auth/permissionPolicy.js";
import { attachmentForWebResponse } from "../files/attachmentDto.js";
import type { OrderRecord, ReceiverOrderDto } from "../orders/orderTypes.js";
import { lockActiveOrderForBusinessWrite } from "../orders/orderWriteBoundary.js";
import {
  completedPatternRequirementsFromDeliverables,
  currentOrderStageFromPatternGate
} from "../patterns/patternCompletionRules.js";
import {
  CUSTOMER_CHARGE_PRICING_METHODS,
  INTERNAL_COST_CATEGORIES,
  PRICING_ITEM_SOURCE_TYPES,
  PRICING_QUOTATION_STATUSES,
  type CustomerChargeItemCreateInput,
  type CustomerChargeItemRecord,
  type CustomerChargeItemUpdateInput,
  type InternalCostItemCreateInput,
  type InternalCostItemRecord,
  type InternalCostItemUpdateInput,
  type OrderChargeRecord,
  type PricingCostApplicability,
  type PricingPatternTaskSummary,
  type PricingRecord,
  type PricingUpdateInput
} from "./pricingTypes.js";
import {
  activeCustomerChargeItems,
  activeInternalCostItems,
  confirmedOtherChargeSnapshot,
  currentConfirmedCustomerQuotation,
  effectiveOrderCharges,
  finishingEvidence,
  pricingReconciliationEligibility,
  summarizePricing,
  summarizeStageWork
} from "./pricingCalculationService.js";
import {
  ReconciliationStatementService,
  type ReconciliationStatementExportDependencies,
  type ReconciliationStatementDownloadPayload,
  type ReconciliationStatementListOptions,
  type StatementCreatePayload
} from "./reconciliationStatementService.js";

type LegacyPricingPayload = {
  quotedPrice?: unknown;
  customerPatternFee?: unknown;
  internalPatternCost?: unknown;
  internalCuttingCost?: unknown;
  internalSewingCost?: unknown;
  internalFinishingCost?: unknown;
  finishingNote?: unknown;
  costAmount?: unknown;
  note?: unknown;
  extraCharges?: unknown;
};

type DynamicCostPayload = {
  name?: unknown;
  category?: unknown;
  sourceType?: unknown;
  sourceTask?: unknown;
  amount?: unknown;
  note?: unknown;
};

type DynamicCustomerChargePayload = {
  name?: unknown;
  pricingMethod?: unknown;
  unitPrice?: unknown;
  quantity?: unknown;
  amount?: unknown;
  sourceType?: unknown;
  sourceTask?: unknown;
  note?: unknown;
};

const taskLabelMap = new Map(sampleRequestItemOptions.map((option) => [option.value, option.label]));

function taskLabel(value: string) {
  return taskLabelMap.get(value as never) ?? value;
}

function requiredText(value: unknown, fieldName: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${fieldName} is required.`);
  }
  return value.trim();
}

function optionalText(value: unknown, fieldName = "note"): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, `${fieldName} must be a string.`);
  return value.trim() || null;
}

function optionalNumber(value: unknown, fieldName: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(400, `${fieldName} must be a non-negative number.`);
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function requiredAmount(value: unknown, fieldName: string) {
  const parsed = optionalNumber(value, fieldName);
  if (parsed === undefined || parsed === null) {
    throw new HttpError(400, `${fieldName} is required.`);
  }
  return parsed;
}

function parseLegacyPayload(
  payload: LegacyPricingPayload,
  currentUser: CurrentUser
): PricingUpdateInput {
  if (payload.extraCharges !== undefined) {
    throw new HttpError(400, "extraCharges is read-only; use the other charge workflow.");
  }
  return {
    quotedPrice: optionalNumber(payload.quotedPrice, "quotedPrice"),
    customerPatternFee: optionalNumber(payload.customerPatternFee, "customerPatternFee"),
    internalPatternCost: optionalNumber(payload.internalPatternCost, "internalPatternCost"),
    internalCuttingCost: optionalNumber(payload.internalCuttingCost, "internalCuttingCost"),
    internalSewingCost: optionalNumber(payload.internalSewingCost, "internalSewingCost"),
    internalFinishingCost: optionalNumber(payload.internalFinishingCost, "internalFinishingCost"),
    finishingNote: optionalText(payload.finishingNote, "finishingNote"),
    costAmount: optionalNumber(payload.costAmount, "costAmount"),
    note: optionalText(payload.note),
    createdBy: currentUser.id
  };
}

function pricingCostApplicability(
  order: Pick<ReceiverOrderDto, "sampleRequestItems">
): PricingCostApplicability {
  const route = physicalProductionRoute(order.sampleRequestItems);
  return {
    pattern: hasPatternTaskRequirements(order.sampleRequestItems),
    cutting: route.includes("cutting"),
    sewing: route.includes("sewing"),
    finishing: route.includes("qc_delivery")
  };
}

function hasFinishingRoute(order: Pick<ReceiverOrderDto, "sampleRequestItems">) {
  return physicalProductionRoute(order.sampleRequestItems).includes("qc_delivery");
}

function finishingSummary(
  pricing: PricingRecord | undefined,
  records: Parameters<typeof finishingEvidence>[0],
  order: Pick<ReceiverOrderDto, "sampleRequestItems">
) {
  const evidence = finishingEvidence(records, hasFinishingRoute(order));
  const finishingItem = activeInternalCostItems(pricing).find(
    (item) => item.category === INTERNAL_COST_CATEGORIES.finishing
  );
  return {
    visible: evidence.visible,
    pieces: pricing?.finishingPiecesSnapshot ?? evidence.pieces,
    amount: finishingItem?.amount ?? pricing?.internalFinishingCost ?? null,
    note: finishingItem?.note ?? pricing?.finishingNote ?? null,
    anomaly: evidence.anomaly
  };
}

function summarizePatternTask(
  task: Awaited<ReturnType<SampleRoomRepository["findPatternTaskByOrderId"]>>,
  deliverables: Awaited<ReturnType<SampleRoomRepository["listPatternDeliverablesByOrderId"]>>
): PricingPatternTaskSummary | undefined {
  if (!task) return undefined;
  return {
    status: task.status,
    requirements: [...task.requirements],
    completedRequirements: completedPatternRequirementsFromDeliverables(
      task.requirements,
      deliverables
    ),
    ...(task.patternMakerName ? { patternMakerName: task.patternMakerName } : {}),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    ...(task.note ? { note: task.note } : {})
  };
}

function normalizeCustomerChargeAmount(
  pricingMethod: CustomerChargeItemRecord["pricingMethod"],
  unitPrice: number | null | undefined,
  quantity: number | null | undefined,
  amount: number | null | undefined
) {
  if (pricingMethod === CUSTOMER_CHARGE_PRICING_METHODS.unitQuantity) {
    if (unitPrice === undefined || unitPrice === null || quantity === undefined || quantity === null) {
      throw new HttpError(400, "unitPrice and quantity are required for unit_quantity.");
    }
    return Math.round((unitPrice * quantity + Number.EPSILON) * 100) / 100;
  }
  if (amount === undefined || amount === null) {
    throw new HttpError(400, "amount is required for fixed pricing.");
  }
  return amount;
}

function quotationState(
  pricing: PricingRecord | undefined,
  summary: ReturnType<typeof summarizePricing>,
  charges?: readonly OrderChargeRecord[]
) {
  const confirmedQuotation = currentConfirmedCustomerQuotation(pricing, summary, charges) ?? null;
  const reconciliationEligibility = pricingReconciliationEligibility(pricing, summary);
  return {
    confirmedQuotation,
    quotationHasUnconfirmedChanges:
      !reconciliationEligibility.eligible &&
      reconciliationEligibility.reason === "quotation_changed",
    reconciliationEligibility
  };
}

export class PricingService {
  private readonly reconciliationStatements: ReconciliationStatementService;

  constructor(
    private readonly repository: SampleRoomRepository,
    reconciliationExportDependencies: ReconciliationStatementExportDependencies = {}
  ) {
    this.reconciliationStatements = new ReconciliationStatementService(
      repository,
      reconciliationExportDependencies
    );
  }

  private ensureManager(currentUser: CurrentUser) {
    if (!isBossOrSystemOwner(currentUser)) throw new HttpError(403, "forbidden");
  }

  private async requireOrder(orderId: string) {
    const order = await this.repository.findOrderById(orderId);
    if (!order) throw new HttpError(404, "order not found.");
    return order;
  }

  private async requireDraftPricing(orderId: string) {
    const pricing = await this.repository.findPricingRecordByOrderId(orderId);
    if (pricing?.quotationStatus === PRICING_QUOTATION_STATUSES.confirmed) {
      throw new HttpError(
        409,
        "quotation is confirmed and locked; return it to pricing before making changes."
      );
    }
    return pricing;
  }

  private async withDraftPricingWrite<T>(
    orderId: string,
    operation: (
      repository: SampleRoomRepository,
      order: OrderRecord,
      pricing: PricingRecord | undefined
    ) => Promise<T>
  ) {
    return this.repository.withTransaction(async (repository) => {
      const order = await lockActiveOrderForBusinessWrite(repository, orderId);
      const pricing = await repository.findPricingRecordByOrderId(orderId);
      if (pricing?.quotationStatus === PRICING_QUOTATION_STATUSES.confirmed) {
        throw new HttpError(
          409,
          "quotation is confirmed and locked; return it to pricing before making changes."
        );
      }
      return operation(repository, order, pricing);
    });
  }

  private async pricingResponse(orderId: string) {
    const order = await this.requireOrder(orderId);
    const [pricing, scanRecords, patternTask, patternDeliverables, charges, attachments] =
      await Promise.all([
        this.repository.findPricingRecordByOrderId(orderId),
        this.repository.listScanRecordsByOrderId(orderId),
        this.repository.findPatternTaskByOrderId(orderId),
        this.repository.listPatternDeliverablesByOrderId(orderId),
        this.repository.listOrderChargesByOrderId(orderId),
        this.repository.listOrderAttachments(orderId)
      ]);
    const summary = summarizePricing(order, pricing, charges);
    return {
      order: {
        ...order,
        attachmentCount: attachments.length,
        attachments: attachments.map(attachmentForWebResponse),
        completionStatus: deriveOrderCompletionStatus({
          sampleRequestItems: order.sampleRequestItems,
          orderStage: order.stage,
          patternTaskStatus: patternTask?.status
        })
      },
      pricing,
      summary,
      ...quotationState(pricing, summary, charges),
      costApplicability: pricingCostApplicability(order),
      finishing: finishingSummary(pricing, scanRecords, order),
      stageWork: summarizeStageWork(scanRecords, order),
      patternTask: summarizePatternTask(patternTask, patternDeliverables),
      orderTasks: order.sampleRequestItems.map((item) => ({
        key: item,
        label: taskLabel(item),
        source: "order_task" as const
      }))
    };
  }

  async getOrderPricing(orderId: string, currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    return this.pricingResponse(orderId);
  }

  async initializeRecommendations(orderId: string, currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    await this.withDraftPricingWrite(orderId, async (repository, order, pricing) => {
      if (pricing?.recommendationsInitializedAt) return;
      const initializedPricing = await repository.upsertPricingRecord(orderId, {
        quotationStatus: PRICING_QUOTATION_STATUSES.draft,
        recommendationsInitializedAt: new Date().toISOString(),
        createdBy: currentUser.id
      });
    const patternTasks = order.sampleRequestItems.filter((item) =>
      [
        SAMPLE_REQUEST_ITEMS.patternMaking,
        SAMPLE_REQUEST_ITEMS.patternRevision,
        SAMPLE_REQUEST_ITEMS.patternFullSize,
        SAMPLE_REQUEST_ITEMS.quoteMaterialCheck,
        SAMPLE_REQUEST_ITEMS.bulkMaterialCheck,
        SAMPLE_REQUEST_ITEMS.patternPaddingAmount,
        SAMPLE_REQUEST_ITEMS.patternZipperLength
      ].includes(item as never)
    );
    const route = physicalProductionRoute(order.sampleRequestItems);
    const records = await repository.listScanRecordsByOrderId(orderId);
    const costRecommendations: Array<Omit<InternalCostItemCreateInput, "pricingRecordId">> = [];
    if (patternTasks.length > 0) {
      costRecommendations.push({
        name: "版师成本",
        category: INTERNAL_COST_CATEGORIES.pattern,
        sourceType: PRICING_ITEM_SOURCE_TYPES.systemRecommended,
        sourceTask: patternTasks.map(taskLabel).join("、"),
        amount: 0,
        createdBy: currentUser.id
      });
    }
    if (route.includes("cutting")) {
      costRecommendations.push({
        name: "裁剪成本",
        category: INTERNAL_COST_CATEGORIES.cutting,
        sourceType: PRICING_ITEM_SOURCE_TYPES.systemRecommended,
        sourceTask: "裁剪",
        amount: 0,
        createdBy: currentUser.id
      });
    }
    if (route.includes("sewing")) {
      const sewingSource = order.sampleRequestItems.includes(SAMPLE_REQUEST_ITEMS.sampleSmall)
        ? "生产小样"
        : "生产样衣";
      costRecommendations.push({
        name: "缝制成本",
        category: INTERNAL_COST_CATEGORIES.sewing,
        sourceType: PRICING_ITEM_SOURCE_TYPES.systemRecommended,
        sourceTask: sewingSource,
        amount: 0,
        createdBy: currentUser.id
      });
      costRecommendations.push({
        name: "后整成本",
        category: INTERNAL_COST_CATEGORIES.finishing,
        sourceType: PRICING_ITEM_SOURCE_TYPES.systemRecommended,
        sourceTask: sewingSource,
        amount: 0,
        createdBy: currentUser.id
      });
    }
    if (
      !route.includes("sewing") &&
      finishingEvidence(records, route.includes("qc_delivery")).visible
    ) {
      costRecommendations.push({
        name: "后整成本",
        category: INTERNAL_COST_CATEGORIES.finishing,
        sourceType: PRICING_ITEM_SOURCE_TYPES.evidence,
        sourceTask: "QC / 出库证据",
        amount: 0,
        createdBy: currentUser.id
      });
    }
    for (const recommendation of costRecommendations) {
      await repository.createInternalCostItem({
        ...recommendation,
        pricingRecordId: initializedPricing.id
      });
    }

    const customerRecommendations: Array<Omit<CustomerChargeItemCreateInput, "pricingRecordId">> = [];
    if (
      order.sampleRequestItems.includes(SAMPLE_REQUEST_ITEMS.sampleGarment) ||
      order.sampleRequestItems.includes(SAMPLE_REQUEST_ITEMS.sampleSmall)
    ) {
      customerRecommendations.push({
        name: order.sampleRequestItems.includes(SAMPLE_REQUEST_ITEMS.sampleSmall)
          ? "小样费"
          : "样衣费",
        pricingMethod: CUSTOMER_CHARGE_PRICING_METHODS.unitQuantity,
        unitPrice: 0,
        quantity: Math.max(order.quantity, 1),
        amount: 0,
        sourceType: PRICING_ITEM_SOURCE_TYPES.systemRecommended,
        sourceTask: order.sampleRequestItems.includes(SAMPLE_REQUEST_ITEMS.sampleSmall)
          ? "生产小样"
          : "生产样衣",
        createdBy: currentUser.id
      });
    }
    if (patternTasks.length > 0) {
      customerRecommendations.push({
        name: "版费",
        pricingMethod: CUSTOMER_CHARGE_PRICING_METHODS.fixed,
        amount: 0,
        sourceType: PRICING_ITEM_SOURCE_TYPES.systemRecommended,
        sourceTask: patternTasks.map(taskLabel).join("、"),
        createdBy: currentUser.id
      });
    }
    for (const recommendation of customerRecommendations) {
      await repository.createCustomerChargeItem({
        ...recommendation,
        pricingRecordId: initializedPricing.id
      });
    }
    });
    return this.pricingResponse(orderId);
  }

  async saveOrderPricing(
    orderId: string,
    payload: LegacyPricingPayload,
    currentUser: CurrentUser
  ) {
    this.ensureManager(currentUser);
    await this.withDraftPricingWrite(orderId, async (repository) => {
      await repository.upsertPricingRecord(orderId, parseLegacyPayload(payload, currentUser));
    });
    return this.pricingResponse(orderId);
  }

  async createInternalCost(
    orderId: string,
    payload: DynamicCostPayload,
    currentUser: CurrentUser
  ) {
    this.ensureManager(currentUser);
    const categories = Object.values(INTERNAL_COST_CATEGORIES);
    const category = requiredText(payload.category, "category");
    if (!categories.includes(category as never)) throw new HttpError(400, "invalid category.");
    await this.withDraftPricingWrite(orderId, async (repository, _order, currentPricing) => {
      const pricing = currentPricing ?? await repository.upsertPricingRecord(orderId, {
        quotationStatus: PRICING_QUOTATION_STATUSES.draft,
        createdBy: currentUser.id
      });
      await repository.createInternalCostItem({
        pricingRecordId: pricing.id,
        name: requiredText(payload.name, "name"),
        category: category as InternalCostItemRecord["category"],
        sourceType: PRICING_ITEM_SOURCE_TYPES.manual,
        sourceTask: optionalText(payload.sourceTask, "sourceTask") ?? undefined,
        amount: requiredAmount(payload.amount, "amount"),
        note: optionalText(payload.note) ?? undefined,
        createdBy: currentUser.id,
        updatedBy: currentUser.id
      });
    });
    return this.pricingResponse(orderId);
  }

  async updateInternalCost(
    orderId: string,
    itemId: string,
    payload: DynamicCostPayload,
    currentUser: CurrentUser
  ) {
    this.ensureManager(currentUser);
    const input: InternalCostItemUpdateInput = { updatedBy: currentUser.id };
    if (payload.name !== undefined) input.name = requiredText(payload.name, "name");
    if (payload.category !== undefined) {
      const category = requiredText(payload.category, "category");
      if (!Object.values(INTERNAL_COST_CATEGORIES).includes(category as never)) {
        throw new HttpError(400, "invalid category.");
      }
      input.category = category as InternalCostItemRecord["category"];
    }
    if (payload.sourceTask !== undefined) input.sourceTask = optionalText(payload.sourceTask, "sourceTask");
    if (payload.amount !== undefined) input.amount = requiredAmount(payload.amount, "amount");
    if (payload.note !== undefined) input.note = optionalText(payload.note);
    await this.withDraftPricingWrite(orderId, async (repository, _order, pricing) => {
      const current = pricing?.internalCostItems?.find(
        (item) => item.id === itemId && !item.archivedAt
      );
      if (!current) throw new HttpError(404, "internal cost item not found.");
      await repository.updateInternalCostItem(itemId, input);
    });
    return this.pricingResponse(orderId);
  }

  async deleteInternalCost(orderId: string, itemId: string, currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    await this.withDraftPricingWrite(orderId, async (repository, _order, pricing) => {
      const current = pricing?.internalCostItems?.find(
        (item) => item.id === itemId && !item.archivedAt
      );
      if (!current) throw new HttpError(404, "internal cost item not found.");
      await repository.updateInternalCostItem(itemId, {
        archivedAt: new Date().toISOString(),
        updatedBy: currentUser.id
      });
    });
    return this.pricingResponse(orderId);
  }

  async createCustomerCharge(
    orderId: string,
    payload: DynamicCustomerChargePayload,
    currentUser: CurrentUser
  ) {
    this.ensureManager(currentUser);
    const pricingMethod = requiredText(payload.pricingMethod, "pricingMethod");
    if (!Object.values(CUSTOMER_CHARGE_PRICING_METHODS).includes(pricingMethod as never)) {
      throw new HttpError(400, "invalid pricingMethod.");
    }
    const unitPrice = optionalNumber(payload.unitPrice, "unitPrice");
    const quantity = optionalNumber(payload.quantity, "quantity");
    const amount = normalizeCustomerChargeAmount(
      pricingMethod as CustomerChargeItemRecord["pricingMethod"],
      unitPrice,
      quantity,
      optionalNumber(payload.amount, "amount")
    );
    await this.withDraftPricingWrite(orderId, async (repository, _order, currentPricing) => {
      const pricing = currentPricing ?? await repository.upsertPricingRecord(orderId, {
        quotationStatus: PRICING_QUOTATION_STATUSES.draft,
        createdBy: currentUser.id
      });
      await repository.createCustomerChargeItem({
        pricingRecordId: pricing.id,
        name: requiredText(payload.name, "name"),
        pricingMethod: pricingMethod as CustomerChargeItemRecord["pricingMethod"],
        ...(unitPrice === null || unitPrice === undefined ? {} : { unitPrice }),
        ...(quantity === null || quantity === undefined ? {} : { quantity }),
        amount,
        sourceType: PRICING_ITEM_SOURCE_TYPES.manual,
        sourceTask: optionalText(payload.sourceTask, "sourceTask") ?? undefined,
        note: optionalText(payload.note) ?? undefined,
        createdBy: currentUser.id,
        updatedBy: currentUser.id
      });
    });
    return this.pricingResponse(orderId);
  }

  async updateCustomerCharge(
    orderId: string,
    itemId: string,
    payload: DynamicCustomerChargePayload,
    currentUser: CurrentUser
  ) {
    this.ensureManager(currentUser);
    await this.withDraftPricingWrite(orderId, async (repository, _order, pricing) => {
      const current = pricing?.customerChargeItems?.find(
        (item) => item.id === itemId && !item.archivedAt
      );
      if (!current) throw new HttpError(404, "customer charge item not found.");
      const pricingMethod = payload.pricingMethod === undefined
        ? current.pricingMethod
        : requiredText(payload.pricingMethod, "pricingMethod");
      if (!Object.values(CUSTOMER_CHARGE_PRICING_METHODS).includes(pricingMethod as never)) {
        throw new HttpError(400, "invalid pricingMethod.");
      }
      const unitPrice = payload.unitPrice === undefined
        ? current.unitPrice
        : optionalNumber(payload.unitPrice, "unitPrice");
      const quantity = payload.quantity === undefined
        ? current.quantity
        : optionalNumber(payload.quantity, "quantity");
      const submittedAmount = payload.amount === undefined
        ? current.amount
        : optionalNumber(payload.amount, "amount");
      const input: CustomerChargeItemUpdateInput = {
        pricingMethod: pricingMethod as CustomerChargeItemRecord["pricingMethod"],
        unitPrice,
        quantity,
        amount: normalizeCustomerChargeAmount(
          pricingMethod as CustomerChargeItemRecord["pricingMethod"],
          unitPrice,
          quantity,
          submittedAmount
        ),
        updatedBy: currentUser.id
      };
      if (payload.name !== undefined) input.name = requiredText(payload.name, "name");
      if (payload.sourceTask !== undefined) input.sourceTask = optionalText(payload.sourceTask, "sourceTask");
      if (payload.note !== undefined) input.note = optionalText(payload.note);
      await repository.updateCustomerChargeItem(itemId, input);
    });
    return this.pricingResponse(orderId);
  }

  async deleteCustomerCharge(orderId: string, itemId: string, currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    await this.withDraftPricingWrite(orderId, async (repository, _order, pricing) => {
      const current = pricing?.customerChargeItems?.find(
        (item) => item.id === itemId && !item.archivedAt
      );
      if (!current) throw new HttpError(404, "customer charge item not found.");
      await repository.updateCustomerChargeItem(itemId, {
        archivedAt: new Date().toISOString(),
        updatedBy: currentUser.id
      });
    });
    return this.pricingResponse(orderId);
  }

  async confirmQuotation(orderId: string, currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    await this.repository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(orderId);
      const order = await repository.findOrderById(orderId);
      if (!order) throw new HttpError(404, "order not found.");
      if (order.terminated) {
        throw new HttpError(409, "订单已终止，无法继续修改。");
      }
      const [existing, charges] = await Promise.all([
        repository.findPricingRecordByOrderId(orderId),
        repository.listOrderChargesByOrderId(orderId)
      ]);
      if (!existing) throw new HttpError(409, "quotation has no pricing items.");
      if (existing.quotationStatus === PRICING_QUOTATION_STATUSES.confirmed) {
        throw new HttpError(409, "quotation is already confirmed and locked.");
      }
      const summary = summarizePricing(order, existing, charges);
      const confirmedAt = new Date().toISOString();
      let customerItems = activeCustomerChargeItems(existing);
      if (customerItems.length === 0 && summary.customerQuoteSubtotal > 0) {
        const legacyItems: CustomerChargeItemRecord[] = [];
        if ((summary.sampleAmount ?? 0) > 0) {
          legacyItems.push({
            id: `legacy-sample-${existing.id}`,
            pricingRecordId: existing.id,
            name: "样衣费",
            pricingMethod: CUSTOMER_CHARGE_PRICING_METHODS.unitQuantity,
            unitPrice: summary.sampleUnitPrice ?? 0,
            quantity: order.quantity,
            amount: summary.sampleAmount,
            sourceType: PRICING_ITEM_SOURCE_TYPES.legacy,
            createdAt: confirmedAt,
            updatedAt: confirmedAt
          });
        }
        if ((summary.customerPatternFee ?? 0) > 0) {
          legacyItems.push({
            id: `legacy-pattern-${existing.id}`,
            pricingRecordId: existing.id,
            name: "客户版费",
            pricingMethod: CUSTOMER_CHARGE_PRICING_METHODS.fixed,
            amount: summary.customerPatternFee,
            sourceType: PRICING_ITEM_SOURCE_TYPES.legacy,
            createdAt: confirmedAt,
            updatedAt: confirmedAt
          });
        }
        customerItems = legacyItems;
      }
      if (customerItems.length === 0) {
        throw new HttpError(409, "quotation requires at least one customer charge item.");
      }
      const otherCharges = confirmedOtherChargeSnapshot(existing, charges);
      const legacySampleCharge = customerItems.find(
        (item) => item.name.includes("样衣") && item.pricingMethod === "unit_quantity"
      );
      const legacySampleAmount = legacySampleCharge?.amount ?? 0;
      const legacyPatternOrServiceAmount =
        summary.customerQuoteSubtotal - legacySampleAmount;
      const confirmedPricing = await repository.upsertPricingRecord(orderId, {
        quotationStatus: PRICING_QUOTATION_STATUSES.confirmed,
        confirmedAt,
        confirmedBy: currentUser.id,
        confirmedByName: currentUser.displayName ?? null,
        confirmedCustomerChargeSnapshot: customerItems,
        confirmedInternalCostSnapshot: activeInternalCostItems(existing),
        confirmedOtherChargeSnapshot: otherCharges,
        confirmedCustomerQuoteSubtotal: summary.customerQuoteSubtotal,
        confirmedBaseInternalCost: summary.baseInternalCost,
        confirmedOtherChargeTotal: summary.confirmedOtherChargeTotal,
        confirmedReceivableTotal: summary.receivableTotal,
        confirmedInternalCostTotal: summary.internalTotalCost,
        confirmedGrossProfit: summary.grossProfit ?? 0,
        confirmedGrossMargin: summary.grossMargin ?? null,
        // Legacy snapshots remain populated for existing Android, mini-program and statement clients.
        confirmedSampleUnitPrice: legacySampleCharge?.unitPrice ?? 0,
        confirmedSampleAmount: legacySampleAmount,
        confirmedCustomerPatternFee: legacyPatternOrServiceAmount,
        confirmedOtherChargeNote:
          otherCharges.map((charge) => charge.name).join("；") ||
          null
      });
      await new ReconciliationStatementService(
        repository
      ).refreshPendingStatementItemSnapshot(order, confirmedPricing);
    });
    return this.pricingResponse(orderId);
  }

  async beginQuotationUpdate(orderId: string, currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    await this.repository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(orderId);
      const order = await repository.findOrderById(orderId);
      if (!order) throw new HttpError(404, "order not found.");
      if (order.terminated) {
        throw new HttpError(409, "订单已终止，无法继续修改。");
      }
      const pricing = await repository.findPricingRecordByOrderId(orderId);
      if (!pricing || pricing.quotationStatus !== PRICING_QUOTATION_STATUSES.confirmed) {
        throw new HttpError(409, "only a confirmed quotation can enter update mode.");
      }
      const paidOrderIds = await new ReconciliationStatementService(
        repository
      ).paidStatementOrderIds();
      if (paidOrderIds.has(orderId)) {
        throw new HttpError(
          409,
          "quotation is included in a paid reconciliation statement; undo payment before updating."
        );
      }
      await repository.upsertPricingRecord(orderId, {
        quotationStatus: PRICING_QUOTATION_STATUSES.draft
      });
    });
    return this.pricingResponse(orderId);
  }

  async getClientQuotation(orderId: string, currentUser: CurrentUser) {
    if (!isClientRole(currentUser.role) || !currentUser.clientUserId || !currentUser.customerId) {
      throw new HttpError(403, "forbidden");
    }
    const order = await this.requireOrder(orderId);
    const [customer, clientUser, pricing, charges] = await Promise.all([
      this.repository.findCustomerById(currentUser.customerId),
      this.repository.findClientUserById(currentUser.clientUserId),
      this.repository.findPricingRecordByOrderId(orderId),
      this.repository.listOrderChargesByOrderId(orderId)
    ]);
    if (!customer || !clientUser || !hasActiveClientBinding(currentUser, customer, clientUser).allowed) {
      throw new HttpError(403, "client user is not bound to an active customer.");
    }
    if (!canClientReadOrder(currentUser, clientUser, order).allowed) {
      throw new HttpError(404, "order not found.");
    }
    const quotation = currentConfirmedCustomerQuotation(pricing, undefined, charges);
    if (!quotation) return { quotation: null };
    return {
      quotation: {
        customerChargeItems: quotation.customerChargeItems,
        customerQuoteSubtotal: quotation.customerQuoteSubtotal,
        effectiveCustomerOtherCharges: quotation.effectiveCustomerOtherCharges,
        otherCharges: quotation.otherCharges.map((charge) => ({
          id: charge.id,
          name: charge.name,
          amount: charge.amount,
          ...(charge.explanation ? { note: charge.explanation } : {})
        })),
        receivableTotal: quotation.receivableTotal,
        status: quotation.status,
        confirmedAt: quotation.confirmedAt,
        // Legacy compatibility fields.
        sampleUnitPrice: quotation.sampleUnitPrice,
        sampleAmount: quotation.sampleAmount,
        customerPatternFee: quotation.customerPatternFee
      }
    };
  }

  async listPricingRows(currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    const [orders, pricingRecords, activeStatementOrderIds] = await Promise.all([
      this.repository.listOrders(),
      this.repository.listPricingRecords(),
      this.reconciliationStatements.activeStatementOrderIds()
    ]);
    const pricingByOrderId = new Map(pricingRecords.map((pricing) => [pricing.orderId, pricing]));
    return Promise.all(
      orders
        .filter((order) => !activeStatementOrderIds.has(order.id))
        .map(async (order) => {
          const pricing = pricingByOrderId.get(order.id);
          const [scanRecords, patternTask, patternDeliverables, charges, attachments] =
            await Promise.all([
              this.repository.listScanRecordsByOrderId(order.id),
              this.repository.findPatternTaskByOrderId(order.id),
              this.repository.listPatternDeliverablesByOrderId(order.id),
              this.repository.listOrderChargesByOrderId(order.id),
              this.repository.listOrderAttachments(order.id)
            ]);
          const currentStage = currentOrderStageFromPatternGate({
            sampleRequestItems: order.sampleRequestItems,
            storedStage: order.stage,
            deliverables: patternDeliverables
          });
          const summary = summarizePricing(order, pricing, charges);
          return {
            order: {
              ...order,
              stage: currentStage,
              attachmentCount: attachments.length,
              attachments: attachments.map(attachmentForWebResponse),
              completionStatus: deriveOrderCompletionStatus({
                sampleRequestItems: order.sampleRequestItems,
                orderStage: currentStage,
                patternTaskStatus: patternTask?.status
              })
            },
            pricing,
            summary,
            ...quotationState(pricing, summary, charges),
            costApplicability: pricingCostApplicability(order),
            finishing: finishingSummary(pricing, scanRecords, order),
            stageWork: summarizeStageWork(scanRecords, order),
            patternTask: summarizePatternTask(patternTask, patternDeliverables),
            orderTasks: order.sampleRequestItems.map((item) => ({
              key: item,
              label: taskLabel(item),
              source: "order_task" as const
            }))
          };
        })
    );
  }

  async listReconciliationStatements(
    currentUser: CurrentUser,
    options: ReconciliationStatementListOptions = {}
  ) {
    return this.reconciliationStatements.listReconciliationStatements(currentUser, options);
  }
  async createReconciliationStatement(payload: StatementCreatePayload, currentUser: CurrentUser) {
    return this.reconciliationStatements.createReconciliationStatement(payload, currentUser);
  }
  async downloadReconciliationStatements(
    payload: ReconciliationStatementDownloadPayload,
    currentUser: CurrentUser
  ) {
    return this.reconciliationStatements.downloadReconciliationStatements(payload, currentUser);
  }
  async returnReconciliationStatement(statementId: string, currentUser: CurrentUser) {
    return this.reconciliationStatements.returnReconciliationStatement(statementId, currentUser);
  }
  async returnReconciliationStatementItem(
    statementId: string,
    itemId: string,
    currentUser: CurrentUser
  ) {
    return this.reconciliationStatements.returnReconciliationStatementItem(
      statementId,
      itemId,
      currentUser
    );
  }
  async markReconciliationStatementPaid(statementId: string, currentUser: CurrentUser) {
    return this.reconciliationStatements.markReconciliationStatementPaid(statementId, currentUser);
  }
  async undoReconciliationStatementPaid(statementId: string, currentUser: CurrentUser) {
    return this.reconciliationStatements.undoReconciliationStatementPaid(statementId, currentUser);
  }
}
