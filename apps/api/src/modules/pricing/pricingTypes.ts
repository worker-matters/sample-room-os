import type { Role, SampleRequestItem } from "@sample-room/shared";
import type { OrderAttachmentRecord } from "../orders/orderTypes.js";

export type ExtraChargeRecord = {
  id: string;
  pricingRecordId: string;
  label: string;
  amount: number;
  note?: string | undefined;
  createdAt: string;
};

export type ExtraChargeInput = {
  label: string;
  amount: number;
  note?: string | undefined;
};

export const ORDER_CHARGE_STATUSES = {
  pending: "pending",
  confirmed: "confirmed",
  rejected: "rejected",
  cancelled: "cancelled",
  effective: "effective",
  void: "void"
} as const;

export type OrderChargeStatus =
  (typeof ORDER_CHARGE_STATUSES)[keyof typeof ORDER_CHARGE_STATUSES];

export type OrderChargeRecord = {
  id: string;
  orderId: string;
  name: string;
  amount: number;
  explanation: string;
  sourceScene: string;
  creatorId: string;
  creatorName?: string | undefined;
  creatorRole: Role;
  status: OrderChargeStatus;
  reviewedAt?: string | undefined;
  reviewedBy?: string | undefined;
  reviewedByName?: string | undefined;
  reviewedByRole?: Role | undefined;
  rejectedAt?: string | undefined;
  rejectedBy?: string | undefined;
  rejectedByName?: string | undefined;
  rejectedByRole?: Role | undefined;
  rejectionReason?: string | undefined;
  cancelledAt?: string | undefined;
  cancelledBy?: string | undefined;
  cancelledByName?: string | undefined;
  cancelledByRole?: Role | undefined;
  cancelReason?: string | undefined;
  archivedAt?: string | undefined;
  voidedAt?: string | undefined;
  voidedBy?: string | undefined;
  voidedByName?: string | undefined;
  voidedByRole?: Role | undefined;
  voidReason?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

export type OrderChargeCreateInput = Pick<
  OrderChargeRecord,
  | "orderId"
  | "name"
  | "amount"
  | "explanation"
  | "sourceScene"
  | "creatorId"
  | "creatorRole"
> & {
  creatorName?: string | undefined;
  status?: OrderChargeStatus | undefined;
  reviewedAt?: string | undefined;
  reviewedBy?: string | undefined;
  reviewedByName?: string | undefined;
  reviewedByRole?: Role | undefined;
};

export type OrderChargeUpdateInput = Partial<
  Pick<
    OrderChargeRecord,
    "name" | "amount" | "explanation" | "status" | "reviewedByRole" | "rejectedByRole" |
    "cancelledByRole" | "voidedByRole"
  >
> & {
  reviewedAt?: string | null | undefined;
  reviewedBy?: string | null | undefined;
  reviewedByName?: string | null | undefined;
  rejectedAt?: string | null | undefined;
  rejectedBy?: string | null | undefined;
  rejectedByName?: string | null | undefined;
  rejectionReason?: string | null | undefined;
  cancelledAt?: string | null | undefined;
  cancelledBy?: string | null | undefined;
  cancelledByName?: string | null | undefined;
  cancelReason?: string | null | undefined;
  archivedAt?: string | null | undefined;
  voidedAt?: string | null | undefined;
  voidedBy?: string | null | undefined;
  voidedByName?: string | null | undefined;
  voidReason?: string | null | undefined;
};

export const PRICING_ITEM_SOURCE_TYPES = {
  systemRecommended: "system_recommended",
  manual: "manual",
  evidence: "evidence",
  legacy: "legacy"
} as const;

export type PricingItemSourceType =
  (typeof PRICING_ITEM_SOURCE_TYPES)[keyof typeof PRICING_ITEM_SOURCE_TYPES];

export const INTERNAL_COST_CATEGORIES = {
  pattern: "pattern",
  cutting: "cutting",
  sewing: "sewing",
  finishing: "finishing",
  material: "material",
  other: "other"
} as const;

export type InternalCostCategory =
  (typeof INTERNAL_COST_CATEGORIES)[keyof typeof INTERNAL_COST_CATEGORIES];

export type InternalCostItemRecord = {
  id: string;
  pricingRecordId: string;
  name: string;
  category: InternalCostCategory;
  sourceType: PricingItemSourceType;
  sourceTask?: string | undefined;
  amount: number;
  note?: string | undefined;
  createdBy?: string | undefined;
  updatedBy?: string | undefined;
  archivedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

export type InternalCostItemCreateInput = Omit<
  InternalCostItemRecord,
  "id" | "archivedAt" | "createdAt" | "updatedAt"
>;

export type InternalCostItemUpdateInput = Partial<
  Pick<
    InternalCostItemRecord,
    "name" | "category" | "sourceType" | "amount" | "updatedBy"
  >
> & {
  sourceTask?: string | null | undefined;
  note?: string | null | undefined;
  archivedAt?: string | null | undefined;
};

export const CUSTOMER_CHARGE_PRICING_METHODS = {
  fixed: "fixed",
  unitQuantity: "unit_quantity"
} as const;

export type CustomerChargePricingMethod =
  (typeof CUSTOMER_CHARGE_PRICING_METHODS)[keyof typeof CUSTOMER_CHARGE_PRICING_METHODS];

export type CustomerChargeItemRecord = {
  id: string;
  pricingRecordId: string;
  name: string;
  pricingMethod: CustomerChargePricingMethod;
  unitPrice?: number | undefined;
  quantity?: number | undefined;
  amount: number;
  sourceType: PricingItemSourceType;
  sourceTask?: string | undefined;
  note?: string | undefined;
  createdBy?: string | undefined;
  updatedBy?: string | undefined;
  archivedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

export type CustomerChargeItemCreateInput = Omit<
  CustomerChargeItemRecord,
  "id" | "archivedAt" | "createdAt" | "updatedAt"
>;

export type CustomerChargeItemUpdateInput = Partial<
  Pick<
    CustomerChargeItemRecord,
    | "name"
    | "pricingMethod"
    | "amount"
    | "sourceType"
    | "updatedBy"
  >
> & {
  unitPrice?: number | null | undefined;
  quantity?: number | null | undefined;
  sourceTask?: string | null | undefined;
  note?: string | null | undefined;
  archivedAt?: string | null | undefined;
};

export type PricingSnapshot = {
  customerChargeItems: CustomerChargeItemRecord[];
  internalCostItems: InternalCostItemRecord[];
  otherCharges: Array<Pick<OrderChargeRecord, "id" | "name" | "amount" | "explanation">>;
};

export const PRICING_QUOTATION_STATUSES = {
  draft: "draft",
  confirmed: "confirmed"
} as const;

export type PricingQuotationStatus =
  (typeof PRICING_QUOTATION_STATUSES)[keyof typeof PRICING_QUOTATION_STATUSES];

export type PricingRecord = {
  id: string;
  orderId: string;
  quotedPrice?: number | undefined;
  customerPatternFee?: number | undefined;
  internalPatternCost?: number | undefined;
  internalCuttingCost?: number | undefined;
  internalSewingCost?: number | undefined;
  internalFinishingCost?: number | undefined;
  finishingPiecesSnapshot?: number | undefined;
  finishingNote?: string | undefined;
  quotationStatus: PricingQuotationStatus;
  confirmedAt?: string | undefined;
  confirmedBy?: string | undefined;
  confirmedByName?: string | undefined;
  confirmedSampleUnitPrice?: number | undefined;
  confirmedSampleAmount?: number | undefined;
  confirmedCustomerPatternFee?: number | undefined;
  confirmedOtherChargeTotal?: number | undefined;
  confirmedOtherChargeNote?: string | undefined;
  confirmedReceivableTotal?: number | undefined;
  confirmedCustomerChargeSnapshot?: CustomerChargeItemRecord[] | undefined;
  confirmedInternalCostSnapshot?: InternalCostItemRecord[] | undefined;
  confirmedOtherChargeSnapshot?: PricingSnapshot["otherCharges"] | undefined;
  confirmedCustomerQuoteSubtotal?: number | undefined;
  confirmedBaseInternalCost?: number | undefined;
  confirmedInternalCostTotal?: number | undefined;
  confirmedGrossProfit?: number | undefined;
  confirmedGrossMargin?: number | undefined;
  recommendationsInitializedAt?: string | undefined;
  costAmount?: number | undefined;
  note?: string | undefined;
  createdBy?: string | undefined;
  createdAt: string;
  updatedAt: string;
  extraCharges: ExtraChargeRecord[];
  internalCostItems?: InternalCostItemRecord[] | undefined;
  customerChargeItems?: CustomerChargeItemRecord[] | undefined;
};

export type PricingUpdateInput = {
  quotedPrice?: number | null | undefined;
  customerPatternFee?: number | null | undefined;
  internalPatternCost?: number | null | undefined;
  internalCuttingCost?: number | null | undefined;
  internalSewingCost?: number | null | undefined;
  internalFinishingCost?: number | null | undefined;
  finishingPiecesSnapshot?: number | null | undefined;
  finishingNote?: string | null | undefined;
  quotationStatus?: PricingQuotationStatus | undefined;
  confirmedAt?: string | null | undefined;
  confirmedBy?: string | null | undefined;
  confirmedByName?: string | null | undefined;
  confirmedSampleUnitPrice?: number | null | undefined;
  confirmedSampleAmount?: number | null | undefined;
  confirmedCustomerPatternFee?: number | null | undefined;
  confirmedOtherChargeTotal?: number | null | undefined;
  confirmedOtherChargeNote?: string | null | undefined;
  confirmedReceivableTotal?: number | null | undefined;
  confirmedCustomerChargeSnapshot?: CustomerChargeItemRecord[] | null | undefined;
  confirmedInternalCostSnapshot?: InternalCostItemRecord[] | null | undefined;
  confirmedOtherChargeSnapshot?: PricingSnapshot["otherCharges"] | null | undefined;
  confirmedCustomerQuoteSubtotal?: number | null | undefined;
  confirmedBaseInternalCost?: number | null | undefined;
  confirmedInternalCostTotal?: number | null | undefined;
  confirmedGrossProfit?: number | null | undefined;
  confirmedGrossMargin?: number | null | undefined;
  recommendationsInitializedAt?: string | null | undefined;
  costAmount?: number | null | undefined;
  note?: string | null | undefined;
  createdBy?: string | undefined;
};

export type PricingCostApplicability = {
  pattern: boolean;
  cutting: boolean;
  sewing: boolean;
  finishing: boolean;
};

export type PricingReconciliationEligibility =
  | { eligible: true }
  | {
      eligible: false;
      reason:
        | "pricing_missing"
        | "quotation_not_confirmed"
        | "quotation_snapshot_incomplete"
        | "quotation_changed";
    };

export type PricingSummary = {
  orderId: string;
  quotedPrice?: number | undefined;
  sampleUnitPrice?: number | undefined;
  sampleAmount: number;
  customerPatternFee: number;
  effectiveCustomerOtherCharges: number;
  internalPatternCost: number;
  internalCuttingCost: number;
  internalSewingCost: number;
  internalFinishingCost: number;
  internalTotalCost: number;
  quotationStatus: PricingQuotationStatus;
  stageCostTotal: number;
  patternFeeTotal: number;
  otherChargeTotal: number;
  costAmount?: number | undefined;
  extraChargeTotal: number;
  receivableTotal: number;
  grossProfit?: number | undefined;
  grossMargin?: number | undefined;
  customerQuoteSubtotal: number;
  confirmedOtherChargeTotal: number;
  baseInternalCost: number;
};

export type PricingStageWorkSummary = {
  stage: "cutting" | "pattern" | "sewing";
  stageLabel: string;
  workHours: number;
  pieces?: number | undefined;
  workerNames: string[];
  completedAt: string;
  note?: string | undefined;
};

export type PricingPatternTaskSummary = {
  status: "pending" | "active" | "paused" | "completed" | "submitted" | "in_progress" | "submitted_to_cutting";
  requirements?: string[] | undefined;
  completedRequirements?: string[] | undefined;
  patternMakerName?: string | undefined;
  completedAt?: string | undefined;
  note?: string | undefined;
  deliverables?: Array<{
    id: string;
    version: string;
    type: string;
    fileName?: string | undefined;
    textValue?: string | undefined;
    uploadedByName?: string | undefined;
    taskCategory?: string | undefined;
    createdAt: string;
  }> | undefined;
};

export const RECONCILIATION_STATEMENT_STATUSES = {
  pendingPayment: "pending_payment",
  paid: "paid",
  returned: "returned"
} as const;

export type ReconciliationStatementStatus =
  (typeof RECONCILIATION_STATEMENT_STATUSES)[keyof typeof RECONCILIATION_STATEMENT_STATUSES];

export type ReconciliationStatementItemSnapshot = {
  id: string;
  statementId: string;
  orderId: string;
  orderNo: string;
  orderCreatedAt?: string | undefined;
  folderCode?: string | undefined;
  styleNo: string;
  styleName: string;
  customerName: string;
  salespersonName: string;
  quantity: number;
  sampleRequestItems?: SampleRequestItem[] | undefined;
  quotedPrice: number;
  sampleAmount: number;
  patternFeeTotal?: number | undefined;
  customerPatternFee?: number | undefined;
  otherChargeTotal: number;
  otherChargeNote?: string | undefined;
  customerChargeSnapshot?: CustomerChargeItemRecord[] | undefined;
  receivableTotal: number;
  internalPatternCost?: number | undefined;
  internalCuttingCost?: number | undefined;
  internalSewingCost?: number | undefined;
  internalFinishingCost?: number | undefined;
  internalCostSnapshot?: InternalCostItemRecord[] | undefined;
  internalBaseCost?: number | undefined;
  internalTotalCost?: number | undefined;
  remark?: string | undefined;
  orderStatusLabel?: string | undefined;
  generatedAt: string;
  returnedAt?: string | undefined;
  returnedBy?: string | undefined;
  attachments?: OrderAttachmentRecord[] | undefined;
};

export type ReconciliationStatementItemCreateInput = Omit<
  ReconciliationStatementItemSnapshot,
  "id" | "statementId" | "generatedAt" | "orderCreatedAt"
> & {
  generatedAt?: string | undefined;
};

export type ReconciliationStatementRecord = {
  id: string;
  statementNo: string;
  customerId?: string | undefined;
  clientUserId?: string | undefined;
  customerName: string;
  salespersonName: string;
  billingPeriod: string;
  orderCount: number;
  receivableAmount: number;
  paidAmount: number;
  status: ReconciliationStatementStatus;
  generatedAt: string;
  generatedBy?: string | undefined;
  paidAt?: string | undefined;
  paidBy?: string | undefined;
  returnedAt?: string | undefined;
  returnedBy?: string | undefined;
  items: ReconciliationStatementItemSnapshot[];
};

export type ReconciliationStatementCreateInput = {
  statementNo: string;
  customerName: string;
  salespersonName: string;
  billingPeriod: string;
  receivableAmount: number;
  generatedBy?: string | undefined;
  generatedAt?: string | undefined;
  items: ReconciliationStatementItemCreateInput[];
};

export type ReconciliationStatementUpdateInput = Partial<
  Pick<
    ReconciliationStatementRecord,
    "status" | "orderCount" | "receivableAmount" | "paidAmount" | "returnedAt" | "returnedBy"
  >
> & {
  paidAt?: string | null | undefined;
  paidBy?: string | null | undefined;
};

export type ReconciliationStatementItemUpdateInput = Partial<
  Pick<
    ReconciliationStatementItemSnapshot,
    | "quantity"
    | "quotedPrice"
    | "sampleAmount"
    | "patternFeeTotal"
    | "customerPatternFee"
    | "otherChargeTotal"
    | "customerChargeSnapshot"
    | "receivableTotal"
    | "internalCostSnapshot"
    | "internalBaseCost"
    | "internalPatternCost"
    | "internalCuttingCost"
    | "internalSewingCost"
    | "internalFinishingCost"
    | "internalTotalCost"
    | "returnedAt"
    | "returnedBy"
  >
> & {
  otherChargeNote?: string | null | undefined;
  remark?: string | null | undefined;
};
