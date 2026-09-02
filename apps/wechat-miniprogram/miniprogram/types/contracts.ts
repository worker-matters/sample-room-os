export type ApiMode = "undetected" | "lan" | "public" | "unavailable";

export type AccountRole =
  | "system_owner"
  | "boss"
  | "receiver"
  | "planner"
  | "pattern_maker"
  | "client_admin"
  | "client_business_user"
  | "worker";

export type WorkerRole = "cutting" | "sewing" | "qc_delivery";

export type IdentityState = {
  status: "unbound" | "active" | "disabled" | "password_change_required";
  identityType?: "account";
  accountId?: string;
  accountType?: "business" | "worker";
  role?: AccountRole | string;
  workerType?: WorkerRole;
  activeWorkerProfileId?: string;
  displayName?: string;
  homeRoute: string;
  canScanOrder: boolean;
};

export interface MiniappLoginResponse {
  sessionToken: string;
  expiresAt: string;
  identity: IdentityState;
}

export interface MiniappTestModeLoginResponse {
  testMode: true;
  mode: "development" | "release_preview";
  testModeToken: string;
  expiresAt: string;
  homeRoute: "/pages/dev/test-mode";
}

export type DevelopmentPersonaLoginResponse =
  | (MiniappLoginResponse & { preview: false; mode: "development" })
  | { preview: true; personaKey: string; mode: "release_preview" };

export interface DevelopmentPersona {
  key: string;
  label: string;
}

export interface MiniappHealthResponse {
  ok: true;
  service: string;
  apiVersion: "v1";
}

export interface MiniappScanResolveRequest {
  payload: string;
}

export interface SafeOrderSummary {
  orderNo: string;
  styleNo: string;
  styleName?: string;
  customerName: string;
  customerSalesperson?: string;
  quantity: number;
  thumbnailUrl?: string;
}

export interface MiniappScanResolveResponse {
  objectType: "order";
  order: SafeOrderSummary;
  currentStage: WorkerRole | "pattern" | null;
  currentStageLabel?: string;
  statusMessage?: string;
  blockedReason?: string;
  readOnly: true;
  developmentMode: boolean;
}

export interface WorkerScanState {
  order: {
    styleNo: string;
    styleName: string;
    customerName: string;
    salespersonName: string;
    quantity: number;
  };
  worker?: {
    id: string;
    name: string;
    stage: WorkerRole;
    stageLabel: string;
  };
  allowedAction: "start" | "complete" | "takeover" | "blocked";
  message?: string;
  blockedReason?: string;
  stage: WorkerRole | "pattern" | null;
  stageLabel?: string;
  defaultPieces?: number;
  activeTask?: {
    workerId: string;
    workerName: string;
    stageLabel: string;
    startedAt: string;
  };
}

export interface WorkerScanResolveResponse {
  actor: { kind: "worker"; role?: WorkerRole; workerProfileId?: string };
  order: WorkerScanState["order"];
  allowedActions: string[];
  state: WorkerScanState;
}

export interface ReceiverOrderSummary {
  id: string;
  orderNo: string;
  customerId: string;
  customerName: string;
  salespersonId: string;
  salespersonName: string;
  styleNo: string;
  styleName: string;
  quantity: number;
  sampleType: string;
  sampleRound: string;
  deliveryDate: string;
  remark?: string;
  intakeStatus: string;
  stage: string | null;
  patternStatus: string;
  fabricStatus: string;
  trimStatus: string;
  sampleRequestItems: string[];
  createdAt: string;
  completionStatus: string;
  thumbnailAttachmentId?: string;
  patternTask?: {
    status: string;
    patternMakerName?: string;
    requirements: string[];
    completedRequirements: string[];
    deliverables?: PlannerPatternDeliverable[];
  };
  scanRecords: PlannerScanRecord[];
}

export interface ReceiverSelfEntryCustomer {
  id: string;
  name: string;
  clientUsers: Array<{ id: string; customerId: string; displayName: string }>;
}

export interface ReceiverAttachment {
  id: string;
  orderId: string;
  fileName: string;
  mimeType: string;
  size: number;
  category: string;
  visibility: string;
  createdAt: string;
  hasFile?: boolean;
  canRename?: boolean;
  canDelete?: boolean;
  uploadedByName?: string;
  uploadedByRole?: string;
}

export interface ReceiverCharge {
  id: string;
  orderId: string;
  name: string;
  amount: number;
  explanation: string;
  sourceScene: string;
  creatorName?: string;
  creatorRole: string;
  status: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  attachments: ReceiverAttachment[];
  canRename: boolean;
  canVoid: boolean;
}

export interface ReceiverScanChargeContext {
  order: {
    id: string;
    orderNo: string;
    styleNo: string;
    styleName: string;
    customerName: string;
    salespersonName: string;
    thumbnail?: ReceiverAttachment;
  };
  chargeLocked: boolean;
  charges: ReceiverCharge[];
}

export interface PlannerAttachment extends ReceiverAttachment {
  uploadedByName?: string;
  uploadedByRole?: string;
}

export interface PlannerPatternDeliverable {
  id: string;
  version: string;
  type: string;
  fileName?: string;
  uploadedByName?: string;
  createdAt: string;
}

export interface PlannerScanRecord {
  id: string;
  stage: string;
  stageLabel: string;
  action: string;
  actionLabel: string;
  workerName: string;
  eventTime: string;
  workHours?: number;
  pieces?: number;
  qualityResult?: string;
  note?: string;
}

export interface PlannerOrderSummary {
  id: string;
  orderNo: string;
  customerName: string;
  salespersonName: string;
  styleNo: string;
  styleName: string;
  quantity: number;
  sampleType: string;
  sampleRound: string;
  deliveryDate: string;
  remark?: string;
  stage: string | null;
  stageLabel: string;
  patternStatus: string;
  fabricStatus: string;
  trimStatus: string;
  createdAt: string;
  updatedAt: string;
  sampleRequestItems: string[];
  completionStatus: string;
  thumbnailAttachmentId?: string;
  attachments: PlannerAttachment[];
  patternTask?: {
    status: string;
    patternMakerName?: string;
    requirements: string[];
    completedRequirements: string[];
    deliverables?: PlannerPatternDeliverable[];
  };
  scanRecords: PlannerScanRecord[];
  activeWorker?: {
    stage: string;
    stageLabel: string;
    workerName: string;
    startedAt: string;
  };
}

export type PlannerScanChargeContext = ReceiverScanChargeContext;

export interface ClientOrderTaskStatus {
  item: string;
  label: string;
  completed: boolean;
}

export interface ClientAttachment {
  id: string;
  orderId: string;
  fileName: string;
  mimeType: string;
  size: number;
  category: string;
  createdAt: string;
  hasFile?: boolean;
  canDelete: boolean;
}

export interface ClientPatternDeliverable {
  id: string;
  version: string;
  type: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
  hasFile: boolean;
  taskCategory?: string;
}

export interface ClientQuotation {
  sampleUnitPrice: number;
  sampleAmount: number;
  customerPatternFee: number;
  effectiveCustomerOtherCharges: number;
  receivableTotal: number;
  status: string;
  confirmedAt: string;
}

export interface ClientOrderSummary {
  id: string;
  orderNo: string;
  customerName: string;
  salespersonId: string;
  salespersonName: string;
  styleNo: string;
  styleName: string;
  quantity: number;
  sampleType: string;
  sampleRound: string;
  deliveryDate: string;
  remark?: string;
  intakeStatus: string;
  returnReason?: string;
  createdAt: string;
  updatedAt: string;
  orderTasks: ClientOrderTaskStatus[];
  attachments: ClientAttachment[];
  thumbnailAttachmentId?: string;
  patternDeliverables?: ClientPatternDeliverable[];
  quotation: ClientQuotation | null;
}

export interface ClientBusinessUserSummary {
  id: string;
  customerId: string;
  displayName: string;
  clientAccessScope: string;
}

export interface ClientOrdersResponse {
  clientAccessScope: "own" | "customer_all";
  clientUsers: ClientBusinessUserSummary[];
  orders: ClientOrderSummary[];
}

export interface ClientBusinessUserRegistration {
  enabled: boolean;
  message?: string;
  code?: {
    urlPath: string;
    recommendedUrl?: string;
    absoluteUrl?: string;
    customerName: string;
    createdByName: string;
    createdAt: string;
  };
}

export interface ClientBusinessUserRequest {
  id: string;
  businessUserName: string;
  contact: string;
  requestedUsername?: string;
  source: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export interface BossPricingRow {
  order: ReceiverOrderSummary & {
    attachmentCount?: number;
    attachments?: ReceiverAttachment[];
    thumbnailAttachmentId?: string;
  };
  pricing?: {
    id: string;
    quotationStatus: "draft" | "confirmed" | "updating";
  };
  summary: {
    receivableTotal: number;
    internalTotalCost: number;
    customerQuoteSubtotal?: number;
    confirmedOtherChargeTotal?: number;
    baseInternalCost?: number;
    grossProfit?: number;
    grossMargin?: number;
    quotationStatus: "draft" | "confirmed" | "updating";
  };
  orderTasks: Array<{ key: string; label: string }>;
  quotationHasUnconfirmedChanges: boolean;
  reconciliationEligibility:
    | { eligible: true }
    | {
        eligible: false;
        reason:
          | "pricing_missing"
          | "quotation_not_confirmed"
          | "quotation_snapshot_incomplete"
          | "quotation_changed";
      };
}

export type BossPricingMethod = "fixed" | "unit_quantity";
export type BossInternalCostCategory =
  | "pattern"
  | "cutting"
  | "sewing"
  | "finishing"
  | "material"
  | "other";

export interface BossCustomerChargeItem {
  id: string;
  name: string;
  pricingMethod: BossPricingMethod;
  unitPrice?: number;
  quantity?: number;
  amount: number;
  sourceType: string;
  sourceTask?: string;
  note?: string;
  archivedAt?: string;
}

export interface BossInternalCostItem {
  id: string;
  name: string;
  category: BossInternalCostCategory;
  amount: number;
  sourceType: string;
  sourceTask?: string;
  note?: string;
  archivedAt?: string;
}

export interface BossOrderCharge {
  id: string;
  name: string;
  amount: number;
  creatorId: string;
  creatorName?: string;
  creatorRole: string;
  status: "pending" | "confirmed" | "effective" | "rejected" | "cancelled" | "void";
  archivedAt?: string;
  createdAt: string;
}

export interface BossPricingDetail extends BossPricingRow {
  pricing?: {
    id: string;
    quotationStatus: "draft" | "confirmed";
    confirmedAt?: string;
    recommendationsInitializedAt?: string;
    customerChargeItems?: BossCustomerChargeItem[];
    internalCostItems?: BossInternalCostItem[];
  };
  confirmedQuotation?: {
    customerQuoteSubtotal: number;
    effectiveCustomerOtherCharges: number;
    receivableTotal: number;
  } | null;
  costApplicability: {
    pattern: boolean;
    cutting: boolean;
    sewing: boolean;
    finishing: boolean;
  };
}

export interface ReconciliationStatementItem {
  id: string;
  statementId: string;
  orderId: string;
  orderNo: string;
  styleNo: string;
  styleName: string;
  customerName: string;
  salespersonName: string;
  quantity: number;
  quotedPrice: number;
  sampleAmount: number;
  patternFeeTotal?: number;
  customerPatternFee?: number;
  otherChargeTotal: number;
  otherChargeNote?: string;
  receivableTotal: number;
  generatedAt: string;
  returnedAt?: string;
}

export interface ReconciliationStatement {
  id: string;
  statementNo: string;
  customerName: string;
  salespersonName: string;
  billingPeriod: string;
  orderCount: number;
  receivableAmount: number;
  paidAmount: number;
  status: "pending_payment" | "paid" | "returned";
  generatedAt: string;
  items: ReconciliationStatementItem[];
}

export interface WorkerPerformance {
  worker: {
    displayName: string;
    workerType: WorkerRole;
  };
  summary: {
    completedOrders: number;
    completedPieces: number;
    totalHours: number;
    averageHoursPerPiece: number;
    hourlyOutput?: number;
    averageQualityScore?: number;
    unratedOrders?: number;
    checkedPieces?: number;
    complaintOrders?: number;
    complaintRate?: number;
  };
  records: Array<{
    styleNo: string;
    styleName: string;
    completedAt: string;
    pieces?: number;
    workHours?: number;
    qualityScore?: number | null;
    complaintCount?: number;
  }>;
}

export interface AccountSecurityProfile {
  accountId: string;
  accountType: "business" | "worker";
  username: string | null;
  phoneNumber: string | null;
  displayName: string;
  roleLabel: string;
  mustChangePassword: boolean;
}
