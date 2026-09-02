import type {
  BusinessUserRequestCreateInput,
  BusinessUserRequestRecord,
  BusinessUserRequestReviewInput
} from "../../modules/accounts/businessUserRequestTypes.js";
import type {
  AttachmentAuditLogCreateInput,
  AttachmentAuditLogRecord,
  ClientUserCreateInput,
  ClientUserRecord,
  ClientUserUpdateInput,
  CustomerCreateInput,
  CustomerRecord,
  OrderAttachmentCreateInput,
  OrderAttachmentRecord,
  OrderAttachmentUpdateInput,
  OrderComplaintCreateInput,
  OrderComplaintRecord,
  OrderCreateInput,
  OrderRecord,
  OrderTrackingPatch
} from "../../modules/orders/orderTypes.js";
import type {
  OrderScanTokenCreateInput,
  OrderScanTokenRecord,
  ScanRecord,
  ScanRecordCreateInput
} from "../../modules/scan/scanTypes.js";
import type {
  OrderFolderCreateInput,
  OrderFolderRecord,
  PatternDeliverableCreateInput,
  PatternDeliverableRecord,
  PatternDeliverableUpdateInput,
  PatternLibraryEntryCreateInput,
  PatternLibraryEntryRecord,
  PatternLibraryEntryUpdateInput,
  PatternTaskCreateInput,
  PatternTaskRecord,
  PatternTaskUpdateInput,
  SubmittedCuttingVersionCreateInput,
  SubmittedCuttingVersionRecord,
  SubmittedCuttingVersionUpdateInput
} from "../../modules/patterns/patternTypes.js";
import type {
  CustomerChargeItemCreateInput,
  CustomerChargeItemRecord,
  CustomerChargeItemUpdateInput,
  InternalCostItemCreateInput,
  InternalCostItemRecord,
  InternalCostItemUpdateInput,
  OrderChargeCreateInput,
  OrderChargeRecord,
  OrderChargeUpdateInput,
  PricingRecord,
  PricingUpdateInput,
  ReconciliationStatementCreateInput,
  ReconciliationStatementItemUpdateInput,
  ReconciliationStatementRecord,
  ReconciliationStatementUpdateInput
} from "../../modules/pricing/pricingTypes.js";
import { createInMemoryStore, type InMemorySampleRoomStore } from "./memory/inMemoryStore.js";

export type MaybePromise<T> = T | Promise<T>;

export interface SampleRoomRepository {
  withTransaction<T>(operation: (repository: SampleRoomRepository) => MaybePromise<T>): MaybePromise<T>;
  lockOrderForWorkflow(id: string): MaybePromise<void>;
  lockWorkerForWorkflow(workerProfileId: string): MaybePromise<void>;
  lockReconciliationCreation(sequenceKey: string): MaybePromise<void>;
  lockReconciliationStatementForUpdate(id: string): MaybePromise<void>;
  createOrder(input: OrderCreateInput): MaybePromise<OrderRecord>;
  updateOrder(id: string, patch: OrderTrackingPatch & Partial<OrderRecord>): MaybePromise<OrderRecord>;
  findOrderById(id: string): MaybePromise<OrderRecord | undefined>;
  listOrders(): MaybePromise<OrderRecord[]>;
  createOrderComplaint(input: OrderComplaintCreateInput): MaybePromise<OrderComplaintRecord>;
  listOrderComplaintsByOrderId(orderId: string): MaybePromise<OrderComplaintRecord[]>;
  deleteOrderComplaint(orderId: string, complaintId: string): MaybePromise<boolean>;
  createOrderAttachment(input: OrderAttachmentCreateInput): MaybePromise<OrderAttachmentRecord>;
  listOrderAttachments(orderId: string): MaybePromise<OrderAttachmentRecord[]>;
  appendAttachmentAuditLog(input: AttachmentAuditLogCreateInput): MaybePromise<AttachmentAuditLogRecord>;
  listAttachmentAuditLogs(orderId: string): MaybePromise<AttachmentAuditLogRecord[]>;
  updateOrderAttachment(
    orderId: string,
    attachmentId: string,
    input: OrderAttachmentUpdateInput
  ): MaybePromise<OrderAttachmentRecord | undefined>;
  deleteOrderAttachment(
    orderId: string,
    attachmentId: string,
    actor?: { id: string; name?: string | undefined; role: OrderAttachmentRecord["uploadedByRole"] }
  ): MaybePromise<OrderAttachmentRecord | undefined>;
  createCustomer(input: CustomerCreateInput): MaybePromise<CustomerRecord>;
  listCustomers(): MaybePromise<CustomerRecord[]>;
  findCustomerById(id: string): MaybePromise<CustomerRecord | undefined>;
  updateCustomer(
    id: string,
    patch: Partial<Pick<CustomerRecord, "name" | "status" | "archivedAt" | "archivedBy">>
  ): MaybePromise<CustomerRecord>;
  findClientUserById(id: string): MaybePromise<ClientUserRecord | undefined>;
  findClientUserByAccountId(accountId: string): MaybePromise<ClientUserRecord | undefined>;
  listClientUsersByCustomerId(customerId: string): MaybePromise<ClientUserRecord[]>;
  createClientUser(input: ClientUserCreateInput): MaybePromise<ClientUserRecord>;
  updateClientUser(id: string, patch: ClientUserUpdateInput): MaybePromise<ClientUserRecord>;
  createBusinessUserRequest(input: BusinessUserRequestCreateInput): MaybePromise<BusinessUserRequestRecord>;
  listBusinessUserRequests(): MaybePromise<BusinessUserRequestRecord[]>;
  updateBusinessUserRequest(
    id: string,
    input: BusinessUserRequestReviewInput
  ): MaybePromise<BusinessUserRequestRecord>;
  createOrderScanToken(input: OrderScanTokenCreateInput): MaybePromise<OrderScanTokenRecord>;
  findOrderScanToken(token: string): MaybePromise<OrderScanTokenRecord | undefined>;
  listOrderScanTokensByOrderId(orderId: string): MaybePromise<OrderScanTokenRecord[]>;
  createScanRecord(input: ScanRecordCreateInput): MaybePromise<ScanRecord>;
  listScanRecordsByOrderId(orderId: string): MaybePromise<ScanRecord[]>;
  createOrderFolder(input: OrderFolderCreateInput): MaybePromise<OrderFolderRecord>;
  findOrderFolderByOrderId(orderId: string): MaybePromise<OrderFolderRecord | undefined>;
  createPatternTask(input: PatternTaskCreateInput): MaybePromise<PatternTaskRecord>;
  updatePatternTask(id: string, input: PatternTaskUpdateInput): MaybePromise<PatternTaskRecord>;
  claimPendingPatternTask(
    id: string,
    input: import("../../modules/patterns/patternTypes.js").PatternTaskClaimInput
  ): MaybePromise<PatternTaskRecord | undefined>;
  deletePendingPatternTask(id: string): MaybePromise<boolean>;
  findPatternTaskById(id: string): MaybePromise<PatternTaskRecord | undefined>;
  findPatternTaskByOrderId(orderId: string): MaybePromise<PatternTaskRecord | undefined>;
  listPatternTasks(): MaybePromise<PatternTaskRecord[]>;
  createPatternDeliverable(input: PatternDeliverableCreateInput): MaybePromise<PatternDeliverableRecord>;
  listPatternDeliverablesByOrderId(orderId: string): MaybePromise<PatternDeliverableRecord[]>;
  updatePatternDeliverable(
    id: string,
    input: PatternDeliverableUpdateInput
  ): MaybePromise<PatternDeliverableRecord | undefined>;
  archivePatternDeliverable(id: string, archivedAt: string): MaybePromise<PatternDeliverableRecord | undefined>;
  createPatternLibraryEntry(
    input: PatternLibraryEntryCreateInput
  ): MaybePromise<PatternLibraryEntryRecord>;
  updatePatternLibraryEntry(
    id: string,
    input: PatternLibraryEntryUpdateInput
  ): MaybePromise<PatternLibraryEntryRecord>;
  findPatternLibraryEntryById(id: string): MaybePromise<PatternLibraryEntryRecord | undefined>;
  listPatternLibraryEntries(): MaybePromise<PatternLibraryEntryRecord[]>;
  createSubmittedCuttingVersion(
    input: SubmittedCuttingVersionCreateInput
  ): MaybePromise<SubmittedCuttingVersionRecord>;
  updateSubmittedCuttingVersion(
    id: string,
    input: SubmittedCuttingVersionUpdateInput
  ): MaybePromise<SubmittedCuttingVersionRecord>;
  findSubmittedCuttingVersionById(
    id: string
  ): MaybePromise<SubmittedCuttingVersionRecord | undefined>;
  listSubmittedCuttingVersions(): MaybePromise<SubmittedCuttingVersionRecord[]>;
  listSubmittedCuttingVersionsByOrderId(orderId: string): MaybePromise<SubmittedCuttingVersionRecord[]>;
  createOrderCharge(input: OrderChargeCreateInput): MaybePromise<OrderChargeRecord>;
  listOrderChargesByOrderId(orderId: string): MaybePromise<OrderChargeRecord[]>;
  findOrderChargeById(id: string): MaybePromise<OrderChargeRecord | undefined>;
  updateOrderCharge(id: string, input: OrderChargeUpdateInput): MaybePromise<OrderChargeRecord>;
  reviewEffectiveOrderCharge(
    id: string,
    input: OrderChargeUpdateInput
  ): MaybePromise<OrderChargeRecord | undefined>;
  voidEffectiveOrderCharge(
    id: string,
    input: OrderChargeUpdateInput
  ): MaybePromise<OrderChargeRecord | undefined>;
  findPricingRecordByOrderId(orderId: string): MaybePromise<PricingRecord | undefined>;
  listPricingRecords(): MaybePromise<PricingRecord[]>;
  upsertPricingRecord(orderId: string, input: PricingUpdateInput): MaybePromise<PricingRecord>;
  createInternalCostItem(input: InternalCostItemCreateInput): MaybePromise<InternalCostItemRecord>;
  updateInternalCostItem(
    id: string,
    input: InternalCostItemUpdateInput
  ): MaybePromise<InternalCostItemRecord | undefined>;
  createCustomerChargeItem(
    input: CustomerChargeItemCreateInput
  ): MaybePromise<CustomerChargeItemRecord>;
  updateCustomerChargeItem(
    id: string,
    input: CustomerChargeItemUpdateInput
  ): MaybePromise<CustomerChargeItemRecord | undefined>;
  createReconciliationStatement(
    input: ReconciliationStatementCreateInput
  ): MaybePromise<ReconciliationStatementRecord>;
  listReconciliationStatements(): MaybePromise<ReconciliationStatementRecord[]>;
  findReconciliationStatementById(id: string): MaybePromise<ReconciliationStatementRecord | undefined>;
  updateReconciliationStatement(
    id: string,
    input: ReconciliationStatementUpdateInput
  ): MaybePromise<ReconciliationStatementRecord>;
  updateReconciliationStatementItem(
    id: string,
    input: ReconciliationStatementItemUpdateInput
  ): MaybePromise<ReconciliationStatementRecord>;
}

export class InMemorySampleRoomRepository implements SampleRoomRepository {
  constructor(private readonly store: InMemorySampleRoomStore = createInMemoryStore()) {}

  async withTransaction<T>(operation: (repository: SampleRoomRepository) => MaybePromise<T>): Promise<T> {
    const snapshot = this.store.snapshot();
    try {
      return await operation(this);
    } catch (error) {
      this.store.restore(snapshot);
      throw error;
    }
  }

  lockOrderForWorkflow(_id: string): void {
    // The service-level keyed mutex serializes memory-mode workflow mutations.
  }

  lockWorkerForWorkflow(_workerProfileId: string): void {
    // Memory mode runs in one process; production uses a transaction-scoped advisory lock.
  }

  lockReconciliationCreation(_sequenceKey: string): void {
    // The reconciliation service serializes memory-mode creation in one process.
  }

  lockReconciliationStatementForUpdate(_id: string): void {
    // Memory-mode statement mutations are executed inside the repository snapshot transaction.
  }

  createOrder(input: OrderCreateInput): OrderRecord {
    return this.store.createOrder(input);
  }

  updateOrder(id: string, patch: OrderTrackingPatch & Partial<OrderRecord>): OrderRecord {
    return this.store.updateOrder(id, patch);
  }

  findOrderById(id: string): OrderRecord | undefined {
    return this.store.findOrderById(id);
  }

  listOrders(): OrderRecord[] {
    return this.store.listOrders();
  }

  createOrderComplaint(input: OrderComplaintCreateInput): OrderComplaintRecord {
    return this.store.createOrderComplaint(input);
  }

  listOrderComplaintsByOrderId(orderId: string): OrderComplaintRecord[] {
    return this.store.listOrderComplaintsByOrderId(orderId);
  }

  deleteOrderComplaint(orderId: string, complaintId: string): boolean {
    return this.store.deleteOrderComplaint(orderId, complaintId);
  }

  createOrderAttachment(input: OrderAttachmentCreateInput): OrderAttachmentRecord {
    return this.store.createOrderAttachment(input);
  }

  listOrderAttachments(orderId: string): OrderAttachmentRecord[] {
    return this.store.listOrderAttachments(orderId);
  }

  appendAttachmentAuditLog(input: AttachmentAuditLogCreateInput): AttachmentAuditLogRecord {
    return this.store.appendAttachmentAuditLog(input);
  }

  listAttachmentAuditLogs(orderId: string): AttachmentAuditLogRecord[] {
    return this.store.listAttachmentAuditLogs(orderId);
  }

  updateOrderAttachment(
    orderId: string,
    attachmentId: string,
    input: OrderAttachmentUpdateInput
  ): OrderAttachmentRecord | undefined {
    return this.store.updateOrderAttachment(orderId, attachmentId, input);
  }

  deleteOrderAttachment(
    orderId: string,
    attachmentId: string,
    actor?: { id: string; name?: string | undefined; role: OrderAttachmentRecord["uploadedByRole"] }
  ): OrderAttachmentRecord | undefined {
    return this.store.deleteOrderAttachment(orderId, attachmentId, actor);
  }

  createCustomer(input: CustomerCreateInput): CustomerRecord {
    return this.store.createCustomer(input);
  }

  listCustomers(): CustomerRecord[] {
    return this.store.listCustomers();
  }

  findCustomerById(id: string): CustomerRecord | undefined {
    return this.store.findCustomerById(id);
  }

  updateCustomer(
    id: string,
    patch: Partial<Pick<CustomerRecord, "name" | "status" | "archivedAt" | "archivedBy">>
  ): CustomerRecord {
    return this.store.updateCustomer(id, patch);
  }

  findClientUserById(id: string): ClientUserRecord | undefined {
    return this.store.findClientUserById(id);
  }

  findClientUserByAccountId(accountId: string): ClientUserRecord | undefined {
    return this.store.findClientUserByAccountId(accountId);
  }

  listClientUsersByCustomerId(customerId: string): ClientUserRecord[] {
    return this.store.listClientUsersByCustomerId(customerId);
  }

  createClientUser(input: ClientUserCreateInput): ClientUserRecord {
    return this.store.createClientUser(input);
  }

  updateClientUser(id: string, patch: ClientUserUpdateInput): ClientUserRecord {
    return this.store.updateClientUser(id, patch);
  }

  createBusinessUserRequest(input: BusinessUserRequestCreateInput): BusinessUserRequestRecord {
    return this.store.createBusinessUserRequest(input);
  }

  listBusinessUserRequests(): BusinessUserRequestRecord[] {
    return this.store.listBusinessUserRequests();
  }

  updateBusinessUserRequest(
    id: string,
    input: BusinessUserRequestReviewInput
  ): BusinessUserRequestRecord {
    return this.store.updateBusinessUserRequest(id, input);
  }

  createOrderScanToken(input: OrderScanTokenCreateInput): OrderScanTokenRecord {
    return this.store.createOrderScanToken(input);
  }

  findOrderScanToken(token: string): OrderScanTokenRecord | undefined {
    return this.store.findOrderScanToken(token);
  }

  listOrderScanTokensByOrderId(orderId: string): OrderScanTokenRecord[] {
    return this.store.listOrderScanTokensByOrderId(orderId);
  }

  createScanRecord(input: ScanRecordCreateInput): ScanRecord {
    return this.store.createScanRecord(input);
  }

  listScanRecordsByOrderId(orderId: string): ScanRecord[] {
    return this.store.listScanRecordsByOrderId(orderId);
  }

  createOrderFolder(input: OrderFolderCreateInput): OrderFolderRecord {
    return this.store.createOrderFolder(input);
  }

  findOrderFolderByOrderId(orderId: string): OrderFolderRecord | undefined {
    return this.store.findOrderFolderByOrderId(orderId);
  }

  createPatternTask(input: PatternTaskCreateInput): PatternTaskRecord {
    return this.store.createPatternTask(input);
  }

  updatePatternTask(id: string, input: PatternTaskUpdateInput): PatternTaskRecord {
    return this.store.updatePatternTask(id, input);
  }

  claimPendingPatternTask(
    id: string,
    input: import("../../modules/patterns/patternTypes.js").PatternTaskClaimInput
  ): PatternTaskRecord | undefined {
    return this.store.claimPendingPatternTask(id, input);
  }

  deletePendingPatternTask(id: string): boolean {
    return this.store.deletePendingPatternTask(id);
  }

  findPatternTaskById(id: string): PatternTaskRecord | undefined {
    return this.store.findPatternTaskById(id);
  }

  findPatternTaskByOrderId(orderId: string): PatternTaskRecord | undefined {
    return this.store.findPatternTaskByOrderId(orderId);
  }

  listPatternTasks(): PatternTaskRecord[] {
    return this.store.listPatternTasks();
  }

  createPatternDeliverable(input: PatternDeliverableCreateInput): PatternDeliverableRecord {
    return this.store.createPatternDeliverable(input);
  }

  listPatternDeliverablesByOrderId(orderId: string): PatternDeliverableRecord[] {
    return this.store.listPatternDeliverablesByOrderId(orderId);
  }

  updatePatternDeliverable(
    id: string,
    input: PatternDeliverableUpdateInput
  ): PatternDeliverableRecord | undefined {
    return this.store.updatePatternDeliverable(id, input);
  }

  archivePatternDeliverable(id: string, archivedAt: string): PatternDeliverableRecord | undefined {
    return this.store.archivePatternDeliverable(id, archivedAt);
  }

  createPatternLibraryEntry(input: PatternLibraryEntryCreateInput): PatternLibraryEntryRecord {
    return this.store.createPatternLibraryEntry(input);
  }

  updatePatternLibraryEntry(
    id: string,
    input: PatternLibraryEntryUpdateInput
  ): PatternLibraryEntryRecord {
    return this.store.updatePatternLibraryEntry(id, input);
  }

  findPatternLibraryEntryById(id: string): PatternLibraryEntryRecord | undefined {
    return this.store.findPatternLibraryEntryById(id);
  }

  listPatternLibraryEntries(): PatternLibraryEntryRecord[] {
    return this.store.listPatternLibraryEntries();
  }

  createSubmittedCuttingVersion(
    input: SubmittedCuttingVersionCreateInput
  ): SubmittedCuttingVersionRecord {
    return this.store.createSubmittedCuttingVersion(input);
  }

  updateSubmittedCuttingVersion(
    id: string,
    input: SubmittedCuttingVersionUpdateInput
  ): SubmittedCuttingVersionRecord {
    return this.store.updateSubmittedCuttingVersion(id, input);
  }

  findSubmittedCuttingVersionById(id: string): SubmittedCuttingVersionRecord | undefined {
    return this.store.findSubmittedCuttingVersionById(id);
  }

  listSubmittedCuttingVersions(): SubmittedCuttingVersionRecord[] {
    return this.store.listSubmittedCuttingVersions();
  }

  listSubmittedCuttingVersionsByOrderId(orderId: string): SubmittedCuttingVersionRecord[] {
    return this.store.listSubmittedCuttingVersionsByOrderId(orderId);
  }

  createOrderCharge(input: OrderChargeCreateInput): OrderChargeRecord {
    return this.store.createOrderCharge(input);
  }

  listOrderChargesByOrderId(orderId: string): OrderChargeRecord[] {
    return this.store.listOrderChargesByOrderId(orderId);
  }

  findOrderChargeById(id: string): OrderChargeRecord | undefined {
    return this.store.findOrderChargeById(id);
  }

  updateOrderCharge(id: string, input: OrderChargeUpdateInput): OrderChargeRecord {
    return this.store.updateOrderCharge(id, input);
  }

  reviewEffectiveOrderCharge(
    id: string,
    input: OrderChargeUpdateInput
  ): OrderChargeRecord | undefined {
    return this.store.reviewEffectiveOrderCharge(id, input);
  }

  voidEffectiveOrderCharge(
    id: string,
    input: OrderChargeUpdateInput
  ): OrderChargeRecord | undefined {
    return this.store.voidEffectiveOrderCharge(id, input);
  }

  findPricingRecordByOrderId(orderId: string): PricingRecord | undefined {
    return this.store.findPricingRecordByOrderId(orderId);
  }

  listPricingRecords(): PricingRecord[] {
    return this.store.listPricingRecords();
  }

  upsertPricingRecord(orderId: string, input: PricingUpdateInput): PricingRecord {
    return this.store.upsertPricingRecord(orderId, input);
  }

  createInternalCostItem(input: InternalCostItemCreateInput): InternalCostItemRecord {
    return this.store.createInternalCostItem(input);
  }

  updateInternalCostItem(
    id: string,
    input: InternalCostItemUpdateInput
  ): InternalCostItemRecord | undefined {
    return this.store.updateInternalCostItem(id, input);
  }

  createCustomerChargeItem(input: CustomerChargeItemCreateInput): CustomerChargeItemRecord {
    return this.store.createCustomerChargeItem(input);
  }

  updateCustomerChargeItem(
    id: string,
    input: CustomerChargeItemUpdateInput
  ): CustomerChargeItemRecord | undefined {
    return this.store.updateCustomerChargeItem(id, input);
  }

  createReconciliationStatement(
    input: ReconciliationStatementCreateInput
  ): ReconciliationStatementRecord {
    return this.store.createReconciliationStatement(input);
  }

  listReconciliationStatements(): ReconciliationStatementRecord[] {
    return this.store.listReconciliationStatements();
  }

  findReconciliationStatementById(id: string): ReconciliationStatementRecord | undefined {
    return this.store.findReconciliationStatementById(id);
  }

  updateReconciliationStatement(
    id: string,
    input: ReconciliationStatementUpdateInput
  ): ReconciliationStatementRecord {
    return this.store.updateReconciliationStatement(id, input);
  }

  updateReconciliationStatementItem(
    id: string,
    input: ReconciliationStatementItemUpdateInput
  ): ReconciliationStatementRecord {
    return this.store.updateReconciliationStatementItem(id, input);
  }
}

export function createInMemorySampleRoomRepository(store?: InMemorySampleRoomStore) {
  return new InMemorySampleRoomRepository(store);
}
