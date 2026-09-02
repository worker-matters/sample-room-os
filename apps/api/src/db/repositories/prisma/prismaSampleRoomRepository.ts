import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  BusinessUserRequestCreateInput,
  BusinessUserRequestRecord,
  BusinessUserRequestReviewInput
} from "../../../modules/accounts/businessUserRequestTypes.js";
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
} from "../../../modules/orders/orderTypes.js";
import type {
  OrderScanTokenCreateInput,
  ScanRecordCreateInput
} from "../../../modules/scan/scanTypes.js";
import type {
  OrderChargeCreateInput,
  OrderChargeRecord,
  OrderChargeUpdateInput,
  CustomerChargeItemCreateInput,
  CustomerChargeItemRecord,
  CustomerChargeItemUpdateInput,
  InternalCostItemCreateInput,
  InternalCostItemRecord,
  InternalCostItemUpdateInput,
  PricingRecord,
  PricingUpdateInput,
  ReconciliationStatementCreateInput,
  ReconciliationStatementItemUpdateInput,
  ReconciliationStatementRecord,
  ReconciliationStatementUpdateInput
} from "../../../modules/pricing/pricingTypes.js";
import type { RepositoryContext } from "../contracts/index.js";
import type { SampleRoomRepository } from "../sampleRoomRepository.js";
import { createPrismaClient, type SampleRoomPrismaClient } from "./prismaClient.js";
import { PrismaPatternWorkflowRepository } from "./prismaPatternWorkflowRepository.js";
import { createPrismaRepositoryContext } from "./prismaRepositoryContext.js";
import { PrismaScanWorkflowRepository } from "./prismaScanWorkflowRepository.js";

export class PrismaSampleRoomRepository implements SampleRoomRepository {
  constructor(
    private readonly context: RepositoryContext = createPrismaRepositoryContext(),
    private readonly scanWorkflow = new PrismaScanWorkflowRepository(createPrismaClient()),
    private readonly patternWorkflow = new PrismaPatternWorkflowRepository(createPrismaClient()),
    private readonly prisma: SampleRoomPrismaClient = createPrismaClient()
  ) {}

  async withTransaction<T>(operation: (repository: SampleRoomRepository) => Promise<T> | T): Promise<T> {
    return this.prisma.$transaction(async (transaction) => {
      const repository = new PrismaSampleRoomRepository(
        createPrismaRepositoryContext(transaction as unknown as SampleRoomPrismaClient),
        new PrismaScanWorkflowRepository(transaction as unknown as SampleRoomPrismaClient),
        new PrismaPatternWorkflowRepository(transaction as unknown as SampleRoomPrismaClient),
        transaction as unknown as SampleRoomPrismaClient
      );
      return operation(repository);
    });
  }

  async lockOrderForWorkflow(id: string): Promise<void> {
    await this.prisma.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`
    );
  }

  async lockWorkerForWorkflow(workerProfileId: string): Promise<void> {
    await this.prisma.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`sewing-worker:${workerProfileId}`}, 0))::text AS "lockResult"`
    );
  }

  async lockReconciliationCreation(sequenceKey: string): Promise<void> {
    await this.prisma.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reconciliation-create:${sequenceKey}`}, 0))::text AS "lockResult"`
    );
  }

  async lockReconciliationStatementForUpdate(id: string): Promise<void> {
    await this.prisma.$queryRaw(
      Prisma.sql`SELECT "id" FROM "ReconciliationStatement" WHERE "id" = ${id} FOR UPDATE`
    );
  }

  createOrder(input: OrderCreateInput): Promise<OrderRecord> {
    return this.context.orders.createOrder(input);
  }

  updateOrder(id: string, patch: OrderTrackingPatch & Partial<OrderRecord>): Promise<OrderRecord> {
    return this.context.orders.updateOrder(id, patch);
  }

  findOrderById(id: string): Promise<OrderRecord | undefined> {
    return this.context.orders.findOrderById(id);
  }

  listOrders(): Promise<OrderRecord[]> {
    return this.context.orders.listOrders();
  }

  async createOrderComplaint(input: OrderComplaintCreateInput): Promise<OrderComplaintRecord> {
    const id = randomUUID();
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      orderId: string;
      description: string;
      qcScanRecordId: string | null;
      qcWorkerProfileId: string | null;
      qcWorkerNameSnapshot: string | null;
      registeredByAccountId: string;
      registeredByName: string;
      createdAt: Date;
    }>>(Prisma.sql`
      INSERT INTO "OrderComplaint" (
        "id", "orderId", "description", "qcScanRecordId", "qcWorkerProfileId", "qcWorkerNameSnapshot",
        "registeredByAccountId", "registeredByName"
      ) VALUES (
        ${id}, ${input.orderId}, ${input.description}, ${input.qcScanRecordId ?? null},
        ${input.qcWorkerProfileId ?? null}, ${input.qcWorkerNameSnapshot ?? null},
        ${input.registeredByAccountId}, ${input.registeredByName}
      )
      RETURNING *
    `);
    const record = rows[0];
    if (!record) throw new Error("Failed to create order complaint.");
    return {
      id: record.id,
      orderId: record.orderId,
      description: record.description,
      qcScanRecordId: record.qcScanRecordId ?? undefined,
      qcWorkerProfileId: record.qcWorkerProfileId ?? undefined,
      qcWorkerNameSnapshot: record.qcWorkerNameSnapshot ?? undefined,
      registeredByAccountId: record.registeredByAccountId,
      registeredByName: record.registeredByName,
      createdAt: record.createdAt.toISOString()
    };
  }

  async listOrderComplaintsByOrderId(orderId: string): Promise<OrderComplaintRecord[]> {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      orderId: string;
      description: string;
      qcScanRecordId: string | null;
      qcWorkerProfileId: string | null;
      qcWorkerNameSnapshot: string | null;
      registeredByAccountId: string;
      registeredByName: string;
      createdAt: Date;
    }>>(Prisma.sql`
      SELECT * FROM "OrderComplaint"
      WHERE "orderId" = ${orderId}
      ORDER BY "createdAt" DESC
    `);
    return rows.map((record) => ({
      id: record.id,
      orderId: record.orderId,
      description: record.description,
      qcScanRecordId: record.qcScanRecordId ?? undefined,
      qcWorkerProfileId: record.qcWorkerProfileId ?? undefined,
      qcWorkerNameSnapshot: record.qcWorkerNameSnapshot ?? undefined,
      registeredByAccountId: record.registeredByAccountId,
      registeredByName: record.registeredByName,
      createdAt: record.createdAt.toISOString()
    }));
  }

  async deleteOrderComplaint(orderId: string, complaintId: string): Promise<boolean> {
    const deleted = await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM "OrderComplaint"
      WHERE "id" = ${complaintId} AND "orderId" = ${orderId}
    `);
    return deleted > 0;
  }

  createOrderAttachment(input: OrderAttachmentCreateInput): Promise<OrderAttachmentRecord> {
    return this.context.attachments.createOrderAttachment(input);
  }

  listOrderAttachments(orderId: string): Promise<OrderAttachmentRecord[]> {
    return this.context.attachments.listOrderAttachments(orderId);
  }

  appendAttachmentAuditLog(input: AttachmentAuditLogCreateInput): Promise<AttachmentAuditLogRecord> {
    return this.context.attachments.appendAttachmentAuditLog(input);
  }

  listAttachmentAuditLogs(orderId: string): Promise<AttachmentAuditLogRecord[]> {
    return this.context.attachments.listAttachmentAuditLogs(orderId);
  }

  updateOrderAttachment(
    orderId: string,
    attachmentId: string,
    input: OrderAttachmentUpdateInput
  ): Promise<OrderAttachmentRecord | undefined> {
    return this.context.attachments.updateOrderAttachment(orderId, attachmentId, input);
  }

  deleteOrderAttachment(
    orderId: string,
    attachmentId: string,
    actor?: { id: string; name?: string | undefined; role: OrderAttachmentRecord["uploadedByRole"] }
  ): Promise<OrderAttachmentRecord | undefined> {
    return this.context.attachments.deleteOrderAttachment(orderId, attachmentId, actor);
  }

  listCustomers(): Promise<CustomerRecord[]> {
    return this.context.customers.listCustomers();
  }

  createCustomer(input: CustomerCreateInput): Promise<CustomerRecord> {
    return this.context.customers.createCustomer(input);
  }

  findCustomerById(id: string): Promise<CustomerRecord | undefined> {
    return this.context.customers.findCustomerById(id);
  }

  updateCustomer(
    id: string,
    patch: Partial<Pick<CustomerRecord, "name" | "status" | "archivedAt" | "archivedBy">>
  ): Promise<CustomerRecord> {
    return this.context.customers.updateCustomer(id, patch);
  }

  findClientUserById(id: string): Promise<ClientUserRecord | undefined> {
    return this.context.clientUsers.findClientUserById(id);
  }

  findClientUserByAccountId(accountId: string): Promise<ClientUserRecord | undefined> {
    return this.context.clientUsers.findClientUserByAccountId(accountId);
  }

  listClientUsersByCustomerId(customerId: string): Promise<ClientUserRecord[]> {
    return this.context.clientUsers.listClientUsersByCustomerId(customerId);
  }

  createClientUser(input: ClientUserCreateInput): Promise<ClientUserRecord> {
    return this.context.clientUsers.createClientUser(input);
  }

  updateClientUser(id: string, patch: ClientUserUpdateInput): Promise<ClientUserRecord> {
    return this.context.clientUsers.updateClientUser(id, patch);
  }

  createBusinessUserRequest(
    input: BusinessUserRequestCreateInput
  ): Promise<BusinessUserRequestRecord> {
    return this.context.businessUserRequests.createBusinessUserRequest(input);
  }

  listBusinessUserRequests(): Promise<BusinessUserRequestRecord[]> {
    return this.context.businessUserRequests.listBusinessUserRequests();
  }

  updateBusinessUserRequest(
    id: string,
    input: BusinessUserRequestReviewInput
  ): Promise<BusinessUserRequestRecord> {
    return this.context.businessUserRequests.updateBusinessUserRequest(id, input);
  }

  createOrderScanToken(input: OrderScanTokenCreateInput) {
    return this.scanWorkflow.createOrderScanToken(input);
  }

  findOrderScanToken(token: string) {
    return this.scanWorkflow.findOrderScanToken(token);
  }

  listOrderScanTokensByOrderId(orderId: string) {
    return this.scanWorkflow.listOrderScanTokensByOrderId(orderId);
  }

  createScanRecord(input: ScanRecordCreateInput) {
    return this.scanWorkflow.createScanRecord(input);
  }

  listScanRecordsByOrderId(orderId: string) {
    return this.scanWorkflow.listScanRecordsByOrderId(orderId);
  }

  createOrderFolder(input: import("../../../modules/patterns/patternTypes.js").OrderFolderCreateInput) {
    return this.patternWorkflow.createOrderFolder(input);
  }

  findOrderFolderByOrderId(orderId: string) {
    return this.patternWorkflow.findOrderFolderByOrderId(orderId);
  }

  createPatternTask(input: import("../../../modules/patterns/patternTypes.js").PatternTaskCreateInput) {
    return this.patternWorkflow.createPatternTask(input);
  }

  updatePatternTask(
    id: string,
    input: import("../../../modules/patterns/patternTypes.js").PatternTaskUpdateInput
  ) {
    return this.patternWorkflow.updatePatternTask(id, input);
  }

  claimPendingPatternTask(
    id: string,
    input: import("../../../modules/patterns/patternTypes.js").PatternTaskClaimInput
  ) {
    return this.patternWorkflow.claimPendingPatternTask(id, input);
  }

  deletePendingPatternTask(id: string) {
    return this.patternWorkflow.deletePendingPatternTask(id);
  }

  findPatternTaskById(id: string) {
    return this.patternWorkflow.findPatternTaskById(id);
  }

  findPatternTaskByOrderId(orderId: string) {
    return this.patternWorkflow.findPatternTaskByOrderId(orderId);
  }

  listPatternTasks() {
    return this.patternWorkflow.listPatternTasks();
  }

  createPatternDeliverable(
    input: import("../../../modules/patterns/patternTypes.js").PatternDeliverableCreateInput
  ) {
    return this.patternWorkflow.createPatternDeliverable(input);
  }

  listPatternDeliverablesByOrderId(orderId: string) {
    return this.patternWorkflow.listPatternDeliverablesByOrderId(orderId);
  }

  updatePatternDeliverable(
    id: string,
    input: import("../../../modules/patterns/patternTypes.js").PatternDeliverableUpdateInput
  ) {
    return this.patternWorkflow.updatePatternDeliverable(id, input);
  }

  archivePatternDeliverable(id: string, archivedAt: string) {
    return this.patternWorkflow.archivePatternDeliverable(id, archivedAt);
  }

  createPatternLibraryEntry(
    input: import("../../../modules/patterns/patternTypes.js").PatternLibraryEntryCreateInput
  ) {
    return this.patternWorkflow.createPatternLibraryEntry(input);
  }

  updatePatternLibraryEntry(
    id: string,
    input: import("../../../modules/patterns/patternTypes.js").PatternLibraryEntryUpdateInput
  ) {
    return this.patternWorkflow.updatePatternLibraryEntry(id, input);
  }

  findPatternLibraryEntryById(id: string) {
    return this.patternWorkflow.findPatternLibraryEntryById(id);
  }

  listPatternLibraryEntries() {
    return this.patternWorkflow.listPatternLibraryEntries();
  }

  createSubmittedCuttingVersion(
    input: import("../../../modules/patterns/patternTypes.js").SubmittedCuttingVersionCreateInput
  ) {
    return this.patternWorkflow.createSubmittedCuttingVersion(input);
  }

  updateSubmittedCuttingVersion(
    id: string,
    input: import("../../../modules/patterns/patternTypes.js").SubmittedCuttingVersionUpdateInput
  ) {
    return this.patternWorkflow.updateSubmittedCuttingVersion(id, input);
  }

  findSubmittedCuttingVersionById(id: string) {
    return this.patternWorkflow.findSubmittedCuttingVersionById(id);
  }

  listSubmittedCuttingVersions() {
    return this.patternWorkflow.listSubmittedCuttingVersions();
  }

  listSubmittedCuttingVersionsByOrderId(orderId: string) {
    return this.patternWorkflow.listSubmittedCuttingVersionsByOrderId(orderId);
  }

  private mapPricingRecord(
    record: Prisma.PricingRecordGetPayload<{
      include: {
        extraCharges: true;
        internalCostItems: true;
        customerChargeItems: true;
      };
    }>
  ): PricingRecord {
    const internalCostItems: InternalCostItemRecord[] = record.internalCostItems.map((item) => ({
      id: item.id,
      pricingRecordId: item.pricingRecordId,
      name: item.name,
      category: item.category,
      sourceType: item.sourceType,
      sourceTask: item.sourceTask ?? undefined,
      amount: item.amount.toNumber(),
      note: item.note ?? undefined,
      createdBy: item.createdBy ?? undefined,
      updatedBy: item.updatedBy ?? undefined,
      archivedAt: item.archivedAt?.toISOString(),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    }));
    const customerChargeItems: CustomerChargeItemRecord[] = record.customerChargeItems.map((item) => ({
      id: item.id,
      pricingRecordId: item.pricingRecordId,
      name: item.name,
      pricingMethod: item.pricingMethod,
      unitPrice: item.unitPrice?.toNumber(),
      quantity: item.quantity?.toNumber(),
      amount: item.amount.toNumber(),
      sourceType: item.sourceType,
      sourceTask: item.sourceTask ?? undefined,
      note: item.note ?? undefined,
      createdBy: item.createdBy ?? undefined,
      updatedBy: item.updatedBy ?? undefined,
      archivedAt: item.archivedAt?.toISOString(),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    }));
    return {
      id: record.id,
      orderId: record.orderId,
      quotedPrice: record.quotedPrice?.toNumber(),
      customerPatternFee: record.customerPatternFee?.toNumber(),
      internalPatternCost: record.internalPatternCost?.toNumber(),
      internalCuttingCost: record.internalCuttingCost?.toNumber(),
      internalSewingCost: record.internalSewingCost?.toNumber(),
      internalFinishingCost: record.internalFinishingCost?.toNumber(),
      finishingPiecesSnapshot: record.finishingPiecesSnapshot ?? undefined,
      finishingNote: record.finishingNote ?? undefined,
      quotationStatus: record.quotationStatus,
      confirmedAt: record.confirmedAt?.toISOString(),
      confirmedBy: record.confirmedBy ?? undefined,
      confirmedByName: record.confirmedByName ?? undefined,
      confirmedSampleUnitPrice: record.confirmedSampleUnitPrice?.toNumber(),
      confirmedSampleAmount: record.confirmedSampleAmount?.toNumber(),
      confirmedCustomerPatternFee: record.confirmedCustomerPatternFee?.toNumber(),
      confirmedOtherChargeTotal: record.confirmedOtherChargeTotal?.toNumber(),
      confirmedOtherChargeNote: record.confirmedOtherChargeNote ?? undefined,
      confirmedReceivableTotal: record.confirmedReceivableTotal?.toNumber(),
      confirmedCustomerChargeSnapshot: Array.isArray(record.confirmedCustomerChargeSnapshot)
        ? record.confirmedCustomerChargeSnapshot as unknown as CustomerChargeItemRecord[]
        : undefined,
      confirmedInternalCostSnapshot: Array.isArray(record.confirmedInternalCostSnapshot)
        ? record.confirmedInternalCostSnapshot as unknown as InternalCostItemRecord[]
        : undefined,
      confirmedOtherChargeSnapshot: Array.isArray(record.confirmedOtherChargeSnapshot)
        ? record.confirmedOtherChargeSnapshot as unknown as PricingRecord["confirmedOtherChargeSnapshot"]
        : undefined,
      confirmedCustomerQuoteSubtotal: record.confirmedCustomerQuoteSubtotal?.toNumber(),
      confirmedBaseInternalCost: record.confirmedBaseInternalCost?.toNumber(),
      confirmedInternalCostTotal: record.confirmedInternalCostTotal?.toNumber(),
      confirmedGrossProfit: record.confirmedGrossProfit?.toNumber(),
      confirmedGrossMargin: record.confirmedGrossMargin?.toNumber(),
      recommendationsInitializedAt: record.recommendationsInitializedAt?.toISOString(),
      costAmount: record.costAmount?.toNumber(),
      note: record.note ?? undefined,
      createdBy: record.createdBy ?? undefined,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      extraCharges: record.extraCharges.map((charge) => ({
        id: charge.id,
        pricingRecordId: charge.pricingRecordId,
        label: charge.label,
        amount: charge.amount.toNumber(),
        note: charge.note ?? undefined,
        createdAt: charge.createdAt.toISOString()
      })),
      internalCostItems,
      customerChargeItems
    };
  }

  private mapOrderCharge(record: Prisma.OrderChargeGetPayload<object>): OrderChargeRecord {
    return {
      id: record.id,
      orderId: record.orderId,
      name: record.name,
      amount: record.amount.toNumber(),
      explanation: record.explanation,
      sourceScene: record.sourceScene,
      creatorId: record.creatorId,
      creatorName: record.creatorName ?? undefined,
      creatorRole: record.creatorRole,
      status: record.status,
      reviewedAt: record.reviewedAt?.toISOString(),
      reviewedBy: record.reviewedBy ?? undefined,
      reviewedByName: record.reviewedByName ?? undefined,
      reviewedByRole: record.reviewedByRole ?? undefined,
      rejectedAt: record.rejectedAt?.toISOString(),
      rejectedBy: record.rejectedBy ?? undefined,
      rejectedByName: record.rejectedByName ?? undefined,
      rejectedByRole: record.rejectedByRole ?? undefined,
      rejectionReason: record.rejectionReason ?? undefined,
      cancelledAt: record.cancelledAt?.toISOString(),
      cancelledBy: record.cancelledBy ?? undefined,
      cancelledByName: record.cancelledByName ?? undefined,
      cancelledByRole: record.cancelledByRole ?? undefined,
      cancelReason: record.cancelReason ?? undefined,
      archivedAt: record.archivedAt?.toISOString(),
      voidedAt: record.voidedAt?.toISOString(),
      voidedBy: record.voidedBy ?? undefined,
      voidedByName: record.voidedByName ?? undefined,
      voidedByRole: record.voidedByRole ?? undefined,
      voidReason: record.voidReason ?? undefined,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    };
  }

  async createOrderCharge(input: OrderChargeCreateInput): Promise<OrderChargeRecord> {
    const record = await this.prisma.orderCharge.create({
      data: {
        orderId: input.orderId,
        name: input.name,
        amount: input.amount,
        explanation: input.explanation,
        sourceScene: input.sourceScene,
        creatorId: input.creatorId,
        creatorRole: input.creatorRole,
        status: input.status ?? "pending",
        ...(input.creatorName ? { creatorName: input.creatorName } : {}),
        ...(input.reviewedAt ? { reviewedAt: new Date(input.reviewedAt) } : {}),
        ...(input.reviewedBy ? { reviewedBy: input.reviewedBy } : {}),
        ...(input.reviewedByName ? { reviewedByName: input.reviewedByName } : {}),
        ...(input.reviewedByRole ? { reviewedByRole: input.reviewedByRole } : {})
      }
    });
    return this.mapOrderCharge(record);
  }

  async listOrderChargesByOrderId(orderId: string): Promise<OrderChargeRecord[]> {
    const records = await this.prisma.orderCharge.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" }
    });
    return records.map((record) => this.mapOrderCharge(record));
  }

  async findOrderChargeById(id: string): Promise<OrderChargeRecord | undefined> {
    const record = await this.prisma.orderCharge.findUnique({ where: { id } });
    return record ? this.mapOrderCharge(record) : undefined;
  }

  async updateOrderCharge(
    id: string,
    input: OrderChargeUpdateInput
  ): Promise<OrderChargeRecord> {
    const data: Prisma.OrderChargeUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.amount !== undefined) data.amount = input.amount;
    if (input.explanation !== undefined) data.explanation = input.explanation;
    if (input.status !== undefined) data.status = input.status;
    if (input.reviewedAt !== undefined) data.reviewedAt = input.reviewedAt ? new Date(input.reviewedAt) : null;
    if (input.reviewedBy !== undefined) data.reviewedBy = input.reviewedBy;
    if (input.reviewedByName !== undefined) data.reviewedByName = input.reviewedByName;
    if (input.reviewedByRole !== undefined) data.reviewedByRole = input.reviewedByRole;
    if (input.rejectedAt !== undefined) data.rejectedAt = input.rejectedAt ? new Date(input.rejectedAt) : null;
    if (input.rejectedBy !== undefined) data.rejectedBy = input.rejectedBy;
    if (input.rejectedByName !== undefined) data.rejectedByName = input.rejectedByName;
    if (input.rejectedByRole !== undefined) data.rejectedByRole = input.rejectedByRole;
    if (input.rejectionReason !== undefined) data.rejectionReason = input.rejectionReason;
    if (input.cancelledAt !== undefined) data.cancelledAt = input.cancelledAt ? new Date(input.cancelledAt) : null;
    if (input.cancelledBy !== undefined) data.cancelledBy = input.cancelledBy;
    if (input.cancelledByName !== undefined) data.cancelledByName = input.cancelledByName;
    if (input.cancelledByRole !== undefined) data.cancelledByRole = input.cancelledByRole;
    if (input.cancelReason !== undefined) data.cancelReason = input.cancelReason;
    if (input.archivedAt !== undefined) data.archivedAt = input.archivedAt ? new Date(input.archivedAt) : null;
    if (input.voidedAt !== undefined) data.voidedAt = input.voidedAt ? new Date(input.voidedAt) : null;
    if (input.voidedBy !== undefined) data.voidedBy = input.voidedBy;
    if (input.voidedByName !== undefined) data.voidedByName = input.voidedByName;
    if (input.voidedByRole !== undefined) data.voidedByRole = input.voidedByRole;
    if (input.voidReason !== undefined) data.voidReason = input.voidReason;
    const record = await this.prisma.orderCharge.update({
      where: { id },
      data
    });
    return this.mapOrderCharge(record);
  }

  private orderChargeUpdateData(input: OrderChargeUpdateInput) {
    const data: Prisma.OrderChargeUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.amount !== undefined) data.amount = input.amount;
    if (input.explanation !== undefined) data.explanation = input.explanation;
    if (input.status !== undefined) data.status = input.status;
    if (input.reviewedAt !== undefined) data.reviewedAt = input.reviewedAt ? new Date(input.reviewedAt) : null;
    if (input.reviewedBy !== undefined) data.reviewedBy = input.reviewedBy;
    if (input.reviewedByName !== undefined) data.reviewedByName = input.reviewedByName;
    if (input.reviewedByRole !== undefined) data.reviewedByRole = input.reviewedByRole;
    if (input.rejectedAt !== undefined) data.rejectedAt = input.rejectedAt ? new Date(input.rejectedAt) : null;
    if (input.rejectedBy !== undefined) data.rejectedBy = input.rejectedBy;
    if (input.rejectedByName !== undefined) data.rejectedByName = input.rejectedByName;
    if (input.rejectedByRole !== undefined) data.rejectedByRole = input.rejectedByRole;
    if (input.rejectionReason !== undefined) data.rejectionReason = input.rejectionReason;
    if (input.cancelledAt !== undefined) data.cancelledAt = input.cancelledAt ? new Date(input.cancelledAt) : null;
    if (input.cancelledBy !== undefined) data.cancelledBy = input.cancelledBy;
    if (input.cancelledByName !== undefined) data.cancelledByName = input.cancelledByName;
    if (input.cancelledByRole !== undefined) data.cancelledByRole = input.cancelledByRole;
    if (input.cancelReason !== undefined) data.cancelReason = input.cancelReason;
    if (input.archivedAt !== undefined) data.archivedAt = input.archivedAt ? new Date(input.archivedAt) : null;
    if (input.voidedAt !== undefined) data.voidedAt = input.voidedAt ? new Date(input.voidedAt) : null;
    if (input.voidedBy !== undefined) data.voidedBy = input.voidedBy;
    if (input.voidedByName !== undefined) data.voidedByName = input.voidedByName;
    if (input.voidedByRole !== undefined) data.voidedByRole = input.voidedByRole;
    if (input.voidReason !== undefined) data.voidReason = input.voidReason;
    return data;
  }

  async reviewEffectiveOrderCharge(
    id: string,
    input: OrderChargeUpdateInput
  ): Promise<OrderChargeRecord | undefined> {
    const result = await this.prisma.orderCharge.updateMany({
      where: { id, status: { in: ["pending", "effective"] }, reviewedAt: null },
      data: this.orderChargeUpdateData(input)
    });
    return result.count === 1 ? this.findOrderChargeById(id) : undefined;
  }

  async voidEffectiveOrderCharge(
    id: string,
    input: OrderChargeUpdateInput
  ): Promise<OrderChargeRecord | undefined> {
    const result = await this.prisma.orderCharge.updateMany({
      where: { id, status: { notIn: ["void", "cancelled"] } },
      data: this.orderChargeUpdateData(input)
    });
    return result.count === 1 ? this.findOrderChargeById(id) : undefined;
  }

  async findPricingRecordByOrderId(orderId: string): Promise<PricingRecord | undefined> {
    const record = await this.prisma.pricingRecord.findUnique({
      where: { orderId },
      include: {
        extraCharges: { orderBy: { createdAt: "asc" } },
        internalCostItems: { orderBy: { createdAt: "asc" } },
        customerChargeItems: { orderBy: { createdAt: "asc" } }
      }
    });

    return record ? this.mapPricingRecord(record) : undefined;
  }

  async listPricingRecords(): Promise<PricingRecord[]> {
    const records = await this.prisma.pricingRecord.findMany({
      include: {
        extraCharges: { orderBy: { createdAt: "asc" } },
        internalCostItems: { orderBy: { createdAt: "asc" } },
        customerChargeItems: { orderBy: { createdAt: "asc" } }
      },
      orderBy: { updatedAt: "desc" }
    });

    return records.map((record) => this.mapPricingRecord(record));
  }

  async upsertPricingRecord(orderId: string, input: PricingUpdateInput): Promise<PricingRecord> {
    const persist = async (transaction: SampleRoomPrismaClient) => {
      let pricing = await transaction.pricingRecord.findUnique({
        where: { orderId }
      });

      const data: Record<string, unknown> = {};
      if (input.quotedPrice !== undefined) {
        data.quotedPrice = input.quotedPrice === null ? null : input.quotedPrice;
      }
      if (input.customerPatternFee !== undefined) {
        data.customerPatternFee = input.customerPatternFee === null ? null : input.customerPatternFee;
      }
      if (input.internalPatternCost !== undefined) {
        data.internalPatternCost = input.internalPatternCost === null ? null : input.internalPatternCost;
      }
      if (input.internalCuttingCost !== undefined) {
        data.internalCuttingCost = input.internalCuttingCost === null ? null : input.internalCuttingCost;
      }
      if (input.internalSewingCost !== undefined) {
        data.internalSewingCost = input.internalSewingCost === null ? null : input.internalSewingCost;
      }
      if (input.internalFinishingCost !== undefined) {
        data.internalFinishingCost =
          input.internalFinishingCost === null ? null : input.internalFinishingCost;
      }
      if (input.finishingPiecesSnapshot !== undefined) {
        data.finishingPiecesSnapshot = input.finishingPiecesSnapshot;
      }
      if (input.finishingNote !== undefined) {
        data.finishingNote = input.finishingNote;
      }
      if (input.quotationStatus !== undefined) data.quotationStatus = input.quotationStatus;
      if (input.confirmedAt !== undefined) {
        data.confirmedAt = input.confirmedAt === null ? null : new Date(input.confirmedAt);
      }
      if (input.confirmedBy !== undefined) data.confirmedBy = input.confirmedBy;
      if (input.confirmedByName !== undefined) data.confirmedByName = input.confirmedByName;
      if (input.confirmedSampleUnitPrice !== undefined) {
        data.confirmedSampleUnitPrice = input.confirmedSampleUnitPrice;
      }
      if (input.confirmedSampleAmount !== undefined) {
        data.confirmedSampleAmount = input.confirmedSampleAmount;
      }
      if (input.confirmedCustomerPatternFee !== undefined) {
        data.confirmedCustomerPatternFee = input.confirmedCustomerPatternFee;
      }
      if (input.confirmedOtherChargeTotal !== undefined) {
        data.confirmedOtherChargeTotal = input.confirmedOtherChargeTotal;
      }
      if (input.confirmedOtherChargeNote !== undefined) {
        data.confirmedOtherChargeNote = input.confirmedOtherChargeNote;
      }
      if (input.confirmedReceivableTotal !== undefined) {
        data.confirmedReceivableTotal = input.confirmedReceivableTotal;
      }
      if (input.confirmedCustomerChargeSnapshot !== undefined) {
        data.confirmedCustomerChargeSnapshot =
          input.confirmedCustomerChargeSnapshot === null
            ? Prisma.JsonNull
            : (input.confirmedCustomerChargeSnapshot as Prisma.InputJsonValue);
      }
      if (input.confirmedInternalCostSnapshot !== undefined) {
        data.confirmedInternalCostSnapshot =
          input.confirmedInternalCostSnapshot === null
            ? Prisma.JsonNull
            : (input.confirmedInternalCostSnapshot as Prisma.InputJsonValue);
      }
      if (input.confirmedOtherChargeSnapshot !== undefined) {
        data.confirmedOtherChargeSnapshot =
          input.confirmedOtherChargeSnapshot === null
            ? Prisma.JsonNull
            : (input.confirmedOtherChargeSnapshot as Prisma.InputJsonValue);
      }
      if (input.confirmedCustomerQuoteSubtotal !== undefined) {
        data.confirmedCustomerQuoteSubtotal = input.confirmedCustomerQuoteSubtotal;
      }
      if (input.confirmedBaseInternalCost !== undefined) {
        data.confirmedBaseInternalCost = input.confirmedBaseInternalCost;
      }
      if (input.confirmedInternalCostTotal !== undefined) {
        data.confirmedInternalCostTotal = input.confirmedInternalCostTotal;
      }
      if (input.confirmedGrossProfit !== undefined) {
        data.confirmedGrossProfit = input.confirmedGrossProfit;
      }
      if (input.confirmedGrossMargin !== undefined) {
        data.confirmedGrossMargin = input.confirmedGrossMargin;
      }
      if (input.recommendationsInitializedAt !== undefined) {
        data.recommendationsInitializedAt = input.recommendationsInitializedAt
          ? new Date(input.recommendationsInitializedAt)
          : null;
      }
      if (input.costAmount !== undefined) {
        data.costAmount = input.costAmount === null ? null : input.costAmount;
      }
      if (input.note !== undefined) {
        data.note = input.note === null ? null : input.note;
      }

      if (!pricing) {
        pricing = await transaction.pricingRecord.create({
          data: { orderId, ...data } as Prisma.PricingRecordUncheckedCreateInput
        });
      } else if (Object.keys(data).length > 0) {
        pricing = await transaction.pricingRecord.update({
          where: { id: pricing.id },
          data: data as Prisma.PricingRecordUncheckedUpdateInput
        });
      }

      return transaction.pricingRecord.findUniqueOrThrow({
        where: { id: pricing.id },
        include: {
          extraCharges: { orderBy: { createdAt: "asc" } },
          internalCostItems: { orderBy: { createdAt: "asc" } },
          customerChargeItems: { orderBy: { createdAt: "asc" } }
        }
      });
    };
    const transactionRunner = (this.prisma as unknown as { $transaction?: unknown }).$transaction;
    const record =
      typeof transactionRunner === "function"
        ? await this.prisma.$transaction((transaction) =>
            persist(transaction as unknown as SampleRoomPrismaClient)
          )
        : await persist(this.prisma);

    return this.mapPricingRecord(record);
  }

  async createInternalCostItem(
    input: InternalCostItemCreateInput
  ): Promise<InternalCostItemRecord> {
    const item = await this.prisma.internalCostItem.create({
      data: {
        pricingRecordId: input.pricingRecordId,
        name: input.name,
        category: input.category,
        sourceType: input.sourceType,
        sourceTask: input.sourceTask ?? null,
        amount: input.amount,
        note: input.note ?? null,
        createdBy: input.createdBy ?? null,
        updatedBy: input.updatedBy ?? null
      }
    });
    return {
      id: item.id,
      pricingRecordId: item.pricingRecordId,
      name: item.name,
      category: item.category,
      sourceType: item.sourceType,
      sourceTask: item.sourceTask ?? undefined,
      amount: item.amount.toNumber(),
      note: item.note ?? undefined,
      createdBy: item.createdBy ?? undefined,
      updatedBy: item.updatedBy ?? undefined,
      archivedAt: item.archivedAt?.toISOString(),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  async updateInternalCostItem(
    id: string,
    input: InternalCostItemUpdateInput
  ): Promise<InternalCostItemRecord | undefined> {
    const existing = await this.prisma.internalCostItem.findUnique({ where: { id } });
    if (!existing) return undefined;
    const item = await this.prisma.internalCostItem.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.sourceType !== undefined ? { sourceType: input.sourceType } : {}),
        ...(input.sourceTask !== undefined ? { sourceTask: input.sourceTask } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.updatedBy !== undefined ? { updatedBy: input.updatedBy } : {}),
        ...(input.archivedAt !== undefined
          ? { archivedAt: input.archivedAt ? new Date(input.archivedAt) : null }
          : {})
      }
    });
    return {
      id: item.id,
      pricingRecordId: item.pricingRecordId,
      name: item.name,
      category: item.category,
      sourceType: item.sourceType,
      sourceTask: item.sourceTask ?? undefined,
      amount: item.amount.toNumber(),
      note: item.note ?? undefined,
      createdBy: item.createdBy ?? undefined,
      updatedBy: item.updatedBy ?? undefined,
      archivedAt: item.archivedAt?.toISOString(),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  async createCustomerChargeItem(
    input: CustomerChargeItemCreateInput
  ): Promise<CustomerChargeItemRecord> {
    const item = await this.prisma.customerChargeItem.create({
      data: {
        pricingRecordId: input.pricingRecordId,
        name: input.name,
        pricingMethod: input.pricingMethod,
        unitPrice: input.unitPrice ?? null,
        quantity: input.quantity ?? null,
        amount: input.amount,
        sourceType: input.sourceType,
        sourceTask: input.sourceTask ?? null,
        note: input.note ?? null,
        createdBy: input.createdBy ?? null,
        updatedBy: input.updatedBy ?? null
      }
    });
    return {
      id: item.id,
      pricingRecordId: item.pricingRecordId,
      name: item.name,
      pricingMethod: item.pricingMethod,
      unitPrice: item.unitPrice?.toNumber(),
      quantity: item.quantity?.toNumber(),
      amount: item.amount.toNumber(),
      sourceType: item.sourceType,
      sourceTask: item.sourceTask ?? undefined,
      note: item.note ?? undefined,
      createdBy: item.createdBy ?? undefined,
      updatedBy: item.updatedBy ?? undefined,
      archivedAt: item.archivedAt?.toISOString(),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  async updateCustomerChargeItem(
    id: string,
    input: CustomerChargeItemUpdateInput
  ): Promise<CustomerChargeItemRecord | undefined> {
    const existing = await this.prisma.customerChargeItem.findUnique({ where: { id } });
    if (!existing) return undefined;
    const item = await this.prisma.customerChargeItem.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.pricingMethod !== undefined ? { pricingMethod: input.pricingMethod } : {}),
        ...(input.unitPrice !== undefined ? { unitPrice: input.unitPrice } : {}),
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.sourceType !== undefined ? { sourceType: input.sourceType } : {}),
        ...(input.sourceTask !== undefined ? { sourceTask: input.sourceTask } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.updatedBy !== undefined ? { updatedBy: input.updatedBy } : {}),
        ...(input.archivedAt !== undefined
          ? { archivedAt: input.archivedAt ? new Date(input.archivedAt) : null }
          : {})
      }
    });
    return {
      id: item.id,
      pricingRecordId: item.pricingRecordId,
      name: item.name,
      pricingMethod: item.pricingMethod,
      unitPrice: item.unitPrice?.toNumber(),
      quantity: item.quantity?.toNumber(),
      amount: item.amount.toNumber(),
      sourceType: item.sourceType,
      sourceTask: item.sourceTask ?? undefined,
      note: item.note ?? undefined,
      createdBy: item.createdBy ?? undefined,
      updatedBy: item.updatedBy ?? undefined,
      archivedAt: item.archivedAt?.toISOString(),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  private mapReconciliationStatement(
    record: Prisma.ReconciliationStatementGetPayload<{
      include: { items: { orderBy: { generatedAt: "asc" } } };
    }>
  ): ReconciliationStatementRecord {
    return {
      id: record.id,
      statementNo: record.statementNo,
      customerName: record.customerName,
      salespersonName: record.salespersonName,
      billingPeriod: record.billingPeriod,
      orderCount: record.orderCount,
      receivableAmount: record.receivableAmount.toNumber(),
      paidAmount: record.paidAmount.toNumber(),
      status: record.status,
      generatedAt: record.generatedAt.toISOString(),
      generatedBy: record.generatedBy ?? undefined,
      paidAt: record.paidAt?.toISOString(),
      paidBy: record.paidBy ?? undefined,
      returnedAt: record.returnedAt?.toISOString(),
      returnedBy: record.returnedBy ?? undefined,
      items: record.items.map((item) => ({
        id: item.id,
        statementId: item.statementId,
        orderId: item.orderId,
        orderNo: item.orderNo,
        styleNo: item.styleNo,
        styleName: item.styleName,
        customerName: item.customerName,
        salespersonName: item.salespersonName,
        quantity: item.quantity,
        quotedPrice: item.quotedPrice.toNumber(),
        sampleAmount: item.sampleAmount.toNumber(),
        patternFeeTotal: item.patternFeeTotal.toNumber(),
        customerPatternFee: item.customerPatternFee.toNumber(),
        otherChargeTotal: item.otherChargeTotal.toNumber(),
        otherChargeNote: item.otherChargeNote ?? undefined,
        customerChargeSnapshot: Array.isArray(item.customerChargeSnapshot)
          ? item.customerChargeSnapshot as unknown as CustomerChargeItemRecord[]
          : undefined,
        receivableTotal: item.receivableTotal.toNumber(),
        internalCostSnapshot: Array.isArray(item.internalCostSnapshot)
          ? item.internalCostSnapshot as unknown as InternalCostItemRecord[]
          : undefined,
        internalBaseCost: item.internalBaseCost?.toNumber(),
        internalPatternCost: item.internalPatternCost?.toNumber(),
        internalCuttingCost: item.internalCuttingCost?.toNumber(),
        internalSewingCost: item.internalSewingCost?.toNumber(),
        internalFinishingCost: item.internalFinishingCost?.toNumber(),
        internalTotalCost: item.internalTotalCost?.toNumber(),
        remark: item.remark ?? undefined,
        orderStatusLabel: item.orderStatusLabel ?? undefined,
        generatedAt: item.generatedAt.toISOString(),
        returnedAt: item.returnedAt?.toISOString(),
        returnedBy: item.returnedBy ?? undefined
      }))
    };
  }

  async createReconciliationStatement(
    input: ReconciliationStatementCreateInput
  ): Promise<ReconciliationStatementRecord> {
    const record = await this.prisma.reconciliationStatement.create({
      data: {
        statementNo: input.statementNo,
        customerName: input.customerName,
        salespersonName: input.salespersonName,
        billingPeriod: input.billingPeriod,
        orderCount: input.items.length,
        receivableAmount: input.receivableAmount,
        ...(input.generatedBy ? { generatedBy: input.generatedBy } : {}),
        ...(input.generatedAt ? { generatedAt: new Date(input.generatedAt) } : {}),
        items: {
          create: input.items.map((item) => ({
            orderId: item.orderId,
            orderNo: item.orderNo,
            styleNo: item.styleNo,
            styleName: item.styleName,
            customerName: item.customerName,
            salespersonName: item.salespersonName,
            quantity: item.quantity,
            quotedPrice: item.quotedPrice,
            sampleAmount: item.sampleAmount,
            patternFeeTotal: item.patternFeeTotal ?? 0,
            customerPatternFee: item.customerPatternFee ?? item.patternFeeTotal ?? 0,
            otherChargeTotal: item.otherChargeTotal,
            ...(item.otherChargeNote ? { otherChargeNote: item.otherChargeNote } : {}),
            ...(item.customerChargeSnapshot
              ? {
                  customerChargeSnapshot:
                    item.customerChargeSnapshot as Prisma.InputJsonValue
                }
              : {}),
            receivableTotal: item.receivableTotal,
            ...(item.internalCostSnapshot
              ? {
                  internalCostSnapshot:
                    item.internalCostSnapshot as Prisma.InputJsonValue
                }
              : {}),
            ...(item.internalBaseCost === undefined
              ? {}
              : { internalBaseCost: item.internalBaseCost }),
            ...(item.internalPatternCost === undefined
              ? {}
              : { internalPatternCost: item.internalPatternCost }),
            ...(item.internalCuttingCost === undefined
              ? {}
              : { internalCuttingCost: item.internalCuttingCost }),
            ...(item.internalSewingCost === undefined
              ? {}
              : { internalSewingCost: item.internalSewingCost }),
            ...(item.internalFinishingCost === undefined
              ? {}
              : { internalFinishingCost: item.internalFinishingCost }),
            ...(item.internalTotalCost === undefined
              ? {}
              : { internalTotalCost: item.internalTotalCost }),
            ...(item.remark ? { remark: item.remark } : {}),
            ...(item.orderStatusLabel ? { orderStatusLabel: item.orderStatusLabel } : {}),
            ...(item.generatedAt ? { generatedAt: new Date(item.generatedAt) } : {})
          }))
        }
      },
      include: { items: { orderBy: { generatedAt: "asc" } } }
    });

    return this.mapReconciliationStatement(record);
  }

  async listReconciliationStatements(): Promise<ReconciliationStatementRecord[]> {
    const records = await this.prisma.reconciliationStatement.findMany({
      include: { items: { orderBy: { generatedAt: "asc" } } },
      orderBy: { generatedAt: "desc" }
    });

    return records.map((record) => this.mapReconciliationStatement(record));
  }

  async findReconciliationStatementById(
    id: string
  ): Promise<ReconciliationStatementRecord | undefined> {
    const record = await this.prisma.reconciliationStatement.findUnique({
      where: { id },
      include: { items: { orderBy: { generatedAt: "asc" } } }
    });

    return record ? this.mapReconciliationStatement(record) : undefined;
  }

  async updateReconciliationStatement(
    id: string,
    input: ReconciliationStatementUpdateInput
  ): Promise<ReconciliationStatementRecord> {
    const data: Prisma.ReconciliationStatementUncheckedUpdateInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.orderCount !== undefined ? { orderCount: input.orderCount } : {}),
      ...(input.receivableAmount !== undefined ? { receivableAmount: input.receivableAmount } : {}),
      ...(input.paidAmount !== undefined ? { paidAmount: input.paidAmount } : {}),
      ...(input.paidAt !== undefined ? { paidAt: input.paidAt ? new Date(input.paidAt) : null } : {}),
      ...(input.paidBy !== undefined ? { paidBy: input.paidBy ?? null } : {}),
      ...(input.returnedAt !== undefined
        ? { returnedAt: input.returnedAt ? new Date(input.returnedAt) : null }
        : {}),
      ...(input.returnedBy !== undefined ? { returnedBy: input.returnedBy ?? null } : {})
    };

    const record = await this.prisma.reconciliationStatement.update({
      where: { id },
      data,
      include: { items: { orderBy: { generatedAt: "asc" } } }
    });

    return this.mapReconciliationStatement(record);
  }

  async updateReconciliationStatementItem(
    id: string,
    input: ReconciliationStatementItemUpdateInput
  ): Promise<ReconciliationStatementRecord> {
    const item = await this.prisma.reconciliationStatementItem.update({
      where: { id },
      data: {
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        ...(input.quotedPrice !== undefined ? { quotedPrice: input.quotedPrice } : {}),
        ...(input.sampleAmount !== undefined ? { sampleAmount: input.sampleAmount } : {}),
        ...(input.patternFeeTotal !== undefined ? { patternFeeTotal: input.patternFeeTotal } : {}),
        ...(input.customerPatternFee !== undefined
          ? { customerPatternFee: input.customerPatternFee }
          : {}),
        ...(input.otherChargeTotal !== undefined
          ? { otherChargeTotal: input.otherChargeTotal }
          : {}),
        ...(input.otherChargeNote !== undefined
          ? { otherChargeNote: input.otherChargeNote }
          : {}),
        ...(input.customerChargeSnapshot !== undefined
          ? {
              customerChargeSnapshot:
                input.customerChargeSnapshot as Prisma.InputJsonValue
            }
          : {}),
        ...(input.receivableTotal !== undefined
          ? { receivableTotal: input.receivableTotal }
          : {}),
        ...(input.internalCostSnapshot !== undefined
          ? {
              internalCostSnapshot:
                input.internalCostSnapshot as Prisma.InputJsonValue
            }
          : {}),
        ...(input.internalBaseCost !== undefined
          ? { internalBaseCost: input.internalBaseCost }
          : {}),
        ...(input.internalPatternCost !== undefined
          ? { internalPatternCost: input.internalPatternCost }
          : {}),
        ...(input.internalCuttingCost !== undefined
          ? { internalCuttingCost: input.internalCuttingCost }
          : {}),
        ...(input.internalSewingCost !== undefined
          ? { internalSewingCost: input.internalSewingCost }
          : {}),
        ...(input.internalFinishingCost !== undefined
          ? { internalFinishingCost: input.internalFinishingCost }
          : {}),
        ...(input.internalTotalCost !== undefined
          ? { internalTotalCost: input.internalTotalCost }
          : {}),
        ...(input.remark !== undefined ? { remark: input.remark } : {}),
        ...(input.returnedAt !== undefined
          ? { returnedAt: input.returnedAt ? new Date(input.returnedAt) : null }
          : {}),
        ...(input.returnedBy !== undefined ? { returnedBy: input.returnedBy ?? null } : {})
      }
    });
    const statement = await this.findReconciliationStatementById(item.statementId);
    if (!statement) throw new Error("Reconciliation statement not found.");
    return statement;
  }
}

export function createPrismaSampleRoomRepository(
  context?: RepositoryContext,
  scanWorkflow?: PrismaScanWorkflowRepository,
  patternWorkflow?: PrismaPatternWorkflowRepository,
  prisma?: SampleRoomPrismaClient
) {
  const sharedPrisma = prisma ?? createPrismaClient();
  return new PrismaSampleRoomRepository(
    context ?? createPrismaRepositoryContext(sharedPrisma),
    scanWorkflow ?? new PrismaScanWorkflowRepository(sharedPrisma),
    patternWorkflow ?? new PrismaPatternWorkflowRepository(sharedPrisma),
    sharedPrisma
  );
}
