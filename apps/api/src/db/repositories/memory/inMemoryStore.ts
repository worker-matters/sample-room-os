import { CLIENT_ACCESS_SCOPES, DEFAULT_SAMPLE_REQUEST_ITEMS, isClientRole } from "@sample-room/shared";
import type {
  BusinessUserRequestCreateInput,
  BusinessUserRequestRecord,
  BusinessUserRequestReviewInput,
  BusinessUserRequestStatus
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
  OrderCorrectionLogEntry,
  OrderCreateInput,
  OrderRecord,
  OrderTrackingPatch
} from "../../../modules/orders/orderTypes.js";
import { nextFolderCode } from "../../../modules/orders/orderFolderCode.js";
import type {
  OrderScanTokenCreateInput,
  OrderScanTokenRecord,
  ScanRecord,
  ScanRecordCreateInput
} from "../../../modules/scan/scanTypes.js";
import {
  CUTTING_INBOX_STATUSES,
  PATTERN_DELIVERABLE_TYPES,
  PATTERN_TASK_STATUSES,
  type OrderFolderCreateInput,
  type OrderFolderRecord,
  type PatternDeliverableCreateInput,
  type PatternDeliverableRecord,
  type PatternDeliverableUpdateInput,
  type PatternLibraryEntryCreateInput,
  type PatternLibraryEntryRecord,
  type PatternLibraryEntryUpdateInput,
  type PatternTaskCreateInput,
  type PatternTaskRecord,
  type PatternTaskUpdateInput,
  type SubmittedCuttingFileRecord,
  type SubmittedCuttingVersionCreateInput,
  type SubmittedCuttingVersionRecord,
  type SubmittedCuttingVersionUpdateInput
} from "../../../modules/patterns/patternTypes.js";
import type {
  CustomerChargeItemCreateInput,
  CustomerChargeItemRecord,
  CustomerChargeItemUpdateInput,
  ExtraChargeRecord,
  InternalCostItemCreateInput,
  InternalCostItemRecord,
  InternalCostItemUpdateInput,
  OrderChargeCreateInput,
  OrderChargeRecord,
  OrderChargeUpdateInput,
  PricingRecord,
  PricingUpdateInput,
  ReconciliationStatementCreateInput,
  ReconciliationStatementItemSnapshot,
  ReconciliationStatementItemUpdateInput,
  ReconciliationStatementRecord,
  ReconciliationStatementUpdateInput
} from "../../../modules/pricing/pricingTypes.js";

type OrderUpdatePatch = OrderTrackingPatch & Partial<OrderRecord>;

const seedCustomers: CustomerRecord[] = [
  { id: "mock-customer-active", name: "Mock Active Customer", status: "active" },
  { id: "mock-customer-other", name: "Mock Other Customer", status: "active" },
  { id: "mock-customer-archived", name: "Mock Archived Customer", status: "archived" }
];

const seedClientUsers: ClientUserRecord[] = [
  {
    id: "mock-client-user-active",
    customerId: "mock-customer-active",
    accountId: "formal-account-client-business",
    displayName: "客户 A 普通业务员",
    status: "active",
    clientAccessScope: CLIENT_ACCESS_SCOPES.own
  },
  {
    id: "mock-client-user-admin",
    customerId: "mock-customer-active",
    accountId: "formal-account-client-admin",
    displayName: "客户 A 主管账号",
    status: "active",
    clientAccessScope: CLIENT_ACCESS_SCOPES.customerAll
  },
  {
    id: "mock-client-user-second",
    customerId: "mock-customer-active",
    accountId: "formal-account-client-business-second",
    displayName: "客户 A 业务员 2",
    status: "active",
    clientAccessScope: CLIENT_ACCESS_SCOPES.own
  },
  {
    id: "mock-client-user-other",
    customerId: "mock-customer-other",
    accountId: "formal-account-client-business-other",
    displayName: "客户 B 普通业务员",
    status: "active",
    clientAccessScope: CLIENT_ACCESS_SCOPES.own
  },
  {
    id: "mock-client-user-archived",
    customerId: "mock-customer-active",
    accountId: "formal-account-client-business-archived",
    displayName: "Mock Archived Client User",
    status: "archived",
    clientAccessScope: CLIENT_ACCESS_SCOPES.own
  }
];

export class InMemorySampleRoomStore {
  private readonly customers = [...seedCustomers];
  private readonly clientUsers = [...seedClientUsers];
  private orders: OrderRecord[] = [];
  private orderComplaints: OrderComplaintRecord[] = [];
  private attachments: OrderAttachmentRecord[] = [];
  private attachmentAuditLogs: AttachmentAuditLogRecord[] = [];
  private businessUserRequests: BusinessUserRequestRecord[] = [];
  private orderScanTokens: OrderScanTokenRecord[] = [];
  private scanRecords: ScanRecord[] = [];
  private orderFolders: OrderFolderRecord[] = [];
  private patternTasks: PatternTaskRecord[] = [];
  private patternDeliverables: PatternDeliverableRecord[] = [];
  private patternLibraryEntries: PatternLibraryEntryRecord[] = [];
  private submittedCuttingVersions: SubmittedCuttingVersionRecord[] = [];
  private pricingRecords: PricingRecord[] = [];
  private extraCharges: ExtraChargeRecord[] = [];
  private internalCostItems: InternalCostItemRecord[] = [];
  private customerChargeItems: CustomerChargeItemRecord[] = [];
  private orderCharges: OrderChargeRecord[] = [];
  private reconciliationStatements: ReconciliationStatementRecord[] = [];
  private nextOrderNumber = 1;
  private nextOrderComplaintNumber = 1;
  private nextAttachmentNumber = 1;
  private nextAttachmentAuditLogNumber = 1;
  private nextBusinessUserRequestNumber = 1;
  private nextCustomerNumber = 1;
  private nextClientUserNumber = 1;
  private nextOrderScanTokenNumber = 1;
  private nextScanRecordNumber = 1;
  private nextOrderFolderNumber = 1;
  private nextPatternTaskNumber = 1;
  private nextPatternDeliverableNumber = 1;
  private nextPatternLibraryEntryNumber = 1;
  private nextSubmittedCuttingVersionNumber = 1;
  private nextSubmittedCuttingFileNumber = 1;
  private nextPricingRecordNumber = 1;
  private nextExtraChargeNumber = 1;
  private nextInternalCostItemNumber = 1;
  private nextCustomerChargeItemNumber = 1;
  private nextOrderChargeNumber = 1;
  private nextReconciliationStatementNumber = 1;
  private nextReconciliationStatementItemNumber = 1;

  snapshot() {
    return structuredClone({
      customers: this.customers,
      clientUsers: this.clientUsers,
      orders: this.orders,
      orderComplaints: this.orderComplaints,
      attachments: this.attachments,
      attachmentAuditLogs: this.attachmentAuditLogs,
      businessUserRequests: this.businessUserRequests,
      orderScanTokens: this.orderScanTokens,
      scanRecords: this.scanRecords,
      orderFolders: this.orderFolders,
      patternTasks: this.patternTasks,
      patternDeliverables: this.patternDeliverables,
      patternLibraryEntries: this.patternLibraryEntries,
      submittedCuttingVersions: this.submittedCuttingVersions,
      pricingRecords: this.pricingRecords,
      extraCharges: this.extraCharges,
      internalCostItems: this.internalCostItems,
      customerChargeItems: this.customerChargeItems,
      orderCharges: this.orderCharges,
      reconciliationStatements: this.reconciliationStatements,
      nextOrderNumber: this.nextOrderNumber,
      nextOrderComplaintNumber: this.nextOrderComplaintNumber,
      nextAttachmentNumber: this.nextAttachmentNumber,
      nextAttachmentAuditLogNumber: this.nextAttachmentAuditLogNumber,
      nextBusinessUserRequestNumber: this.nextBusinessUserRequestNumber,
      nextCustomerNumber: this.nextCustomerNumber,
      nextClientUserNumber: this.nextClientUserNumber,
      nextOrderScanTokenNumber: this.nextOrderScanTokenNumber,
      nextScanRecordNumber: this.nextScanRecordNumber,
      nextOrderFolderNumber: this.nextOrderFolderNumber,
      nextPatternTaskNumber: this.nextPatternTaskNumber,
      nextPatternDeliverableNumber: this.nextPatternDeliverableNumber,
      nextPatternLibraryEntryNumber: this.nextPatternLibraryEntryNumber,
      nextSubmittedCuttingVersionNumber: this.nextSubmittedCuttingVersionNumber,
      nextSubmittedCuttingFileNumber: this.nextSubmittedCuttingFileNumber,
      nextPricingRecordNumber: this.nextPricingRecordNumber,
      nextExtraChargeNumber: this.nextExtraChargeNumber,
      nextInternalCostItemNumber: this.nextInternalCostItemNumber,
      nextCustomerChargeItemNumber: this.nextCustomerChargeItemNumber,
      nextOrderChargeNumber: this.nextOrderChargeNumber,
      nextReconciliationStatementNumber: this.nextReconciliationStatementNumber,
      nextReconciliationStatementItemNumber: this.nextReconciliationStatementItemNumber
    });
  }

  restore(snapshot: ReturnType<InMemorySampleRoomStore["snapshot"]>) {
    this.customers.splice(0, this.customers.length, ...snapshot.customers);
    this.clientUsers.splice(0, this.clientUsers.length, ...snapshot.clientUsers);
    this.orders = snapshot.orders;
    this.orderComplaints = snapshot.orderComplaints;
    this.attachments = snapshot.attachments;
    this.attachmentAuditLogs = snapshot.attachmentAuditLogs;
    this.businessUserRequests = snapshot.businessUserRequests;
    this.orderScanTokens = snapshot.orderScanTokens;
    this.scanRecords = snapshot.scanRecords;
    this.orderFolders = snapshot.orderFolders;
    this.patternTasks = snapshot.patternTasks;
    this.patternDeliverables = snapshot.patternDeliverables;
    this.patternLibraryEntries = snapshot.patternLibraryEntries;
    this.submittedCuttingVersions = snapshot.submittedCuttingVersions;
    this.pricingRecords = snapshot.pricingRecords;
    this.extraCharges = snapshot.extraCharges;
    this.internalCostItems = snapshot.internalCostItems;
    this.customerChargeItems = snapshot.customerChargeItems;
    this.orderCharges = snapshot.orderCharges;
    this.reconciliationStatements = snapshot.reconciliationStatements;
    this.nextOrderNumber = snapshot.nextOrderNumber;
    this.nextOrderComplaintNumber = snapshot.nextOrderComplaintNumber;
    this.nextAttachmentNumber = snapshot.nextAttachmentNumber;
    this.nextAttachmentAuditLogNumber = snapshot.nextAttachmentAuditLogNumber;
    this.nextBusinessUserRequestNumber = snapshot.nextBusinessUserRequestNumber;
    this.nextCustomerNumber = snapshot.nextCustomerNumber;
    this.nextClientUserNumber = snapshot.nextClientUserNumber;
    this.nextOrderScanTokenNumber = snapshot.nextOrderScanTokenNumber;
    this.nextScanRecordNumber = snapshot.nextScanRecordNumber;
    this.nextOrderFolderNumber = snapshot.nextOrderFolderNumber;
    this.nextPatternTaskNumber = snapshot.nextPatternTaskNumber;
    this.nextPatternDeliverableNumber = snapshot.nextPatternDeliverableNumber;
    this.nextPatternLibraryEntryNumber = snapshot.nextPatternLibraryEntryNumber;
    this.nextSubmittedCuttingVersionNumber = snapshot.nextSubmittedCuttingVersionNumber;
    this.nextSubmittedCuttingFileNumber = snapshot.nextSubmittedCuttingFileNumber;
    this.nextPricingRecordNumber = snapshot.nextPricingRecordNumber;
    this.nextExtraChargeNumber = snapshot.nextExtraChargeNumber;
    this.nextInternalCostItemNumber = snapshot.nextInternalCostItemNumber;
    this.nextCustomerChargeItemNumber = snapshot.nextCustomerChargeItemNumber;
    this.nextOrderChargeNumber = snapshot.nextOrderChargeNumber;
    this.nextReconciliationStatementNumber = snapshot.nextReconciliationStatementNumber;
    this.nextReconciliationStatementItemNumber = snapshot.nextReconciliationStatementItemNumber;
  }

  createOrder(input: OrderCreateInput): OrderRecord {
    const customer = this.findCustomerById(input.customerId);
    const clientUser = this.findClientUserById(input.clientUserId);

    if (!customer || !clientUser) {
      throw new Error("Cannot create order without customer and client user snapshots.");
    }

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const order: OrderRecord = {
      ...input,
      id: `mock-order-${this.nextOrderNumber}`,
      orderNo: `V2-MOCK-${String(this.nextOrderNumber).padStart(4, "0")}`,
      folderCode: nextFolderCode(
        this.orders.map((existingOrder) => existingOrder.folderCode),
        nowDate
      ),
      sourceOrderId: input.sourceOrderId,
      sourcePatternVersionId: input.sourcePatternVersionId,
      customerName: customer.name,
      salespersonId: clientUser.id,
      salespersonName: clientUser.displayName,
      customerSnapshot: { id: customer.id, name: customer.name },
      clientUserSnapshot: { id: clientUser.id, displayName: clientUser.displayName },
      patternSourceType: input.patternSourceType ?? "none",
      sampleRequestItems: input.sampleRequestItems ?? [...DEFAULT_SAMPLE_REQUEST_ITEMS],
      sampleGarmentRequired: input.sampleGarmentRequired ?? true,
      taskInstructionNote: input.taskInstructionNote,
      latestPatternVersion: input.latestPatternVersion,
      cuttingUsedPatternVersion: input.cuttingUsedPatternVersion,
      supplementCount: input.supplementCount ?? 0,
      terminated: false,
      correctionLogs: input.correctionLogs ?? [],
      createdAt: now,
      updatedAt: now
    };

    this.nextOrderNumber += 1;
    this.orders.push(order);
    return order;
  }

  updateOrder(id: string, patch: OrderUpdatePatch): OrderRecord {
    const index = this.orders.findIndex((order) => order.id === id);
    if (index < 0) {
      throw new Error("Order not found.");
    }

    const existing = this.orders[index]!;
    const updated: OrderRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    this.orders[index] = updated;
    return updated;
  }

  findOrderById(id: string): OrderRecord | undefined {
    return this.orders.find((order) => order.id === id);
  }

  listOrders(): OrderRecord[] {
    return [...this.orders];
  }

  createOrderComplaint(input: OrderComplaintCreateInput): OrderComplaintRecord {
    const complaint: OrderComplaintRecord = {
      ...input,
      id: `mock-order-complaint-${this.nextOrderComplaintNumber}`,
      createdAt: new Date().toISOString()
    };

    this.nextOrderComplaintNumber += 1;
    this.orderComplaints.push(complaint);
    return complaint;
  }

  listOrderComplaintsByOrderId(orderId: string): OrderComplaintRecord[] {
    return this.orderComplaints
      .filter((complaint) => complaint.orderId === orderId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  deleteOrderComplaint(orderId: string, complaintId: string): boolean {
    const index = this.orderComplaints.findIndex(
      (complaint) => complaint.id === complaintId && complaint.orderId === orderId
    );
    if (index < 0) return false;
    this.orderComplaints.splice(index, 1);
    return true;
  }

  createOrderAttachment(input: OrderAttachmentCreateInput): OrderAttachmentRecord {
    const attachment: OrderAttachmentRecord = {
      ...input,
      id: `mock-attachment-${this.nextAttachmentNumber}`,
      createdAt: new Date().toISOString()
    };

    this.nextAttachmentNumber += 1;
    this.attachments.push(attachment);
    this.appendAttachmentAuditLog({
      orderId: attachment.orderId,
      attachmentId: attachment.id,
      originalFileName: attachment.fileName,
      action: "upload",
      actorId: attachment.uploadedBy,
      actorName: attachment.uploadedByName,
      actorRole: attachment.uploadedByRole,
      originalUploaderId: attachment.uploadedBy,
      originalUploaderName: attachment.uploadedByName,
      originalUploaderRole: attachment.uploadedByRole,
      attachmentCategory: attachment.category,
      sourceCategory: attachment.sourceCategory ?? (
        isClientRole(attachment.uploadedByRole)
          ? "client_upload"
          : attachment.uploadedByRole === "pattern_maker"
            ? "pattern_maker_upload"
            : "sample_room_upload"
      ),
      patternTaskId: attachment.patternTaskId,
      patternTaskCategory: attachment.patternTaskCategory,
      orderChargeId: attachment.orderChargeId
    });
    return attachment;
  }

  listOrderAttachments(orderId: string): OrderAttachmentRecord[] {
    return this.attachments.filter((attachment) => attachment.orderId === orderId);
  }

  appendAttachmentAuditLog(input: AttachmentAuditLogCreateInput): AttachmentAuditLogRecord {
    const record: AttachmentAuditLogRecord = {
      ...input,
      id: `mock-attachment-log-${this.nextAttachmentAuditLogNumber}`,
      createdAt: new Date().toISOString()
    };
    this.nextAttachmentAuditLogNumber += 1;
    this.attachmentAuditLogs.push(record);
    return record;
  }

  listAttachmentAuditLogs(orderId: string): AttachmentAuditLogRecord[] {
    return this.attachmentAuditLogs
      .filter((log) => log.orderId === orderId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  updateOrderAttachment(
    orderId: string,
    attachmentId: string,
    input: OrderAttachmentUpdateInput
  ): OrderAttachmentRecord | undefined {
    const index = this.attachments.findIndex(
      (attachment) => attachment.orderId === orderId && attachment.id === attachmentId
    );
    if (index < 0) {
      return undefined;
    }

    const updated: OrderAttachmentRecord = {
      ...this.attachments[index]!,
      ...input
    };
    this.attachments[index] = updated;
    return updated;
  }

  deleteOrderAttachment(
    orderId: string,
    attachmentId: string,
    actor?: { id: string; name?: string | undefined; role: OrderAttachmentRecord["uploadedByRole"] }
  ): OrderAttachmentRecord | undefined {
    const index = this.attachments.findIndex(
      (attachment) => attachment.orderId === orderId && attachment.id === attachmentId
    );
    if (index < 0) {
      return undefined;
    }

    const [deleted] = this.attachments.splice(index, 1);
    if (deleted && actor) {
      this.appendAttachmentAuditLog({
        orderId,
        attachmentId: deleted.id,
        originalFileName: deleted.fileName,
        action: "delete",
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        originalUploaderId: deleted.uploadedBy,
        originalUploaderName: deleted.uploadedByName,
        originalUploaderRole: deleted.uploadedByRole,
        attachmentCategory: deleted.category,
        sourceCategory: deleted.sourceCategory,
        patternTaskId: deleted.patternTaskId,
        patternTaskCategory: deleted.patternTaskCategory,
        orderChargeId: deleted.orderChargeId
      });
    }
    return deleted;
  }

  listCustomers(): CustomerRecord[] {
    return [...this.customers];
  }

  createCustomer(input: CustomerCreateInput): CustomerRecord {
    const customer: CustomerRecord = {
      id: `mock-customer-generated-${this.nextCustomerNumber}`,
      name: input.name,
      status: input.status ?? "active"
    };

    this.nextCustomerNumber += 1;
    this.customers.push(customer);
    return customer;
  }

  findCustomerById(id: string): CustomerRecord | undefined {
    return this.customers.find((customer) => customer.id === id);
  }

  updateCustomer(
    id: string,
    patch: Partial<Pick<CustomerRecord, "name" | "status" | "archivedAt" | "archivedBy">>
  ): CustomerRecord {
    const index = this.customers.findIndex((customer) => customer.id === id);
    if (index < 0) {
      throw new Error("Customer not found.");
    }

    const updated: CustomerRecord = {
      ...this.customers[index]!,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.archivedAt !== undefined ? { archivedAt: patch.archivedAt } : {}),
      ...(patch.archivedBy !== undefined ? { archivedBy: patch.archivedBy } : {})
    };
    this.customers[index] = updated;
    return updated;
  }

  findClientUserById(id: string): ClientUserRecord | undefined {
    return this.clientUsers.find((clientUser) => clientUser.id === id);
  }

  findClientUserByAccountId(accountId: string): ClientUserRecord | undefined {
    return this.clientUsers.find((clientUser) => clientUser.accountId === accountId);
  }

  listClientUsersByCustomerId(customerId: string): ClientUserRecord[] {
    return this.clientUsers.filter((clientUser) => clientUser.customerId === customerId);
  }

  createClientUser(input: ClientUserCreateInput): ClientUserRecord {
    const clientUser: ClientUserRecord = {
      customerId: input.customerId,
      displayName: input.displayName,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.contact ? { contact: input.contact } : {}),
      status: input.status ?? "active",
      clientAccessScope: input.clientAccessScope ?? CLIENT_ACCESS_SCOPES.own,
      id: `mock-client-user-generated-${this.nextClientUserNumber}`
    };

    this.nextClientUserNumber += 1;
    this.clientUsers.push(clientUser);
    return clientUser;
  }

  updateClientUser(id: string, patch: ClientUserUpdateInput): ClientUserRecord {
    const index = this.clientUsers.findIndex((clientUser) => clientUser.id === id);
    if (index < 0) {
      throw new Error("Client user not found.");
    }

    const updated: ClientUserRecord = {
      ...this.clientUsers[index]!,
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.contact !== undefined ? { contact: patch.contact } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.clientAccessScope !== undefined ? { clientAccessScope: patch.clientAccessScope } : {}),
      ...(patch.accountId !== undefined ? { accountId: patch.accountId } : {}),
      ...(patch.archivedAt !== undefined ? { archivedAt: patch.archivedAt } : {}),
      ...(patch.archivedBy !== undefined ? { archivedBy: patch.archivedBy } : {})
    };
    this.clientUsers[index] = updated;
    return updated;
  }

  createBusinessUserRequest(input: BusinessUserRequestCreateInput): BusinessUserRequestRecord {
    const now = new Date().toISOString();
    const request: BusinessUserRequestRecord = {
      ...input,
      id: `mock-business-user-request-${this.nextBusinessUserRequestNumber}`,
      status: "pending",
      createdAt: now,
      source: input.source ?? "supervisor_request"
    };

    this.nextBusinessUserRequestNumber += 1;
    this.businessUserRequests.push(request);
    return request;
  }

  listBusinessUserRequests(): BusinessUserRequestRecord[] {
    return [...this.businessUserRequests];
  }

  updateBusinessUserRequest(
    id: string,
    input: BusinessUserRequestReviewInput
  ): BusinessUserRequestRecord {
    const index = this.businessUserRequests.findIndex((request) => request.id === id);
    if (index < 0) {
      throw new Error("Business user request not found.");
    }

    const existing = this.businessUserRequests[index]!;
    const updated: BusinessUserRequestRecord = {
      ...existing,
      status: input.status as BusinessUserRequestStatus,
      reviewedAt: new Date().toISOString(),
      reviewedBy: input.reviewedBy,
      reviewedByRole: input.reviewedByRole,
      reviewNote: input.reviewNote,
      ...(input.createdClientUserId ? { createdClientUserId: input.createdClientUserId } : {})
    };

    this.businessUserRequests[index] = updated;
    return updated;
  }

  appendOrderCorrectionLogs(
    orderId: string,
    logs: OrderCorrectionLogEntry[]
  ): OrderCorrectionLogEntry[] {
    const order = this.findOrderById(orderId);
    if (!order) {
      throw new Error("Order not found.");
    }

    this.updateOrder(orderId, {
      correctionLogs: [...order.correctionLogs, ...logs]
    });

    return logs;
  }

  listOrderCorrectionLogsByOrderId(orderId: string): OrderCorrectionLogEntry[] {
    return this.findOrderById(orderId)?.correctionLogs ?? [];
  }

  createOrderScanToken(input: OrderScanTokenCreateInput): OrderScanTokenRecord {
    const record: OrderScanTokenRecord = {
      id: `mock-order-scan-token-${this.nextOrderScanTokenNumber}`,
      orderId: input.orderId,
      token: input.token,
      stage: input.stage,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt
    };

    this.nextOrderScanTokenNumber += 1;
    this.orderScanTokens.push(record);
    return record;
  }

  findOrderScanToken(token: string): OrderScanTokenRecord | undefined {
    return this.orderScanTokens.find((scanToken) => scanToken.token === token);
  }

  listOrderScanTokensByOrderId(orderId: string): OrderScanTokenRecord[] {
    return this.orderScanTokens.filter((scanToken) => scanToken.orderId === orderId);
  }

  createScanRecord(input: ScanRecordCreateInput): ScanRecord {
    // Legacy fixtures may still express historical attribution as workerId. New
    // Scan writes always provide both explicit identity fields.
    const actorType = input.actorType ?? "production_worker";
    const actorAccountId = input.actorAccountId ?? input.workerId;
    const workerProfileId = actorType === "production_worker"
      ? input.workerProfileId ?? input.workerId
      : undefined;
    if (actorType === "production_worker" && !workerProfileId) {
      throw new Error("production worker ScanRecord requires workerProfileId.");
    }
    if (actorType === "internal_account" && input.workerProfileId) {
      throw new Error("internal account ScanRecord cannot set workerProfileId.");
    }
    const record: ScanRecord = {
      ...input,
      id: `mock-scan-record-${this.nextScanRecordNumber}`,
      actorAccountId,
      workerProfileId,
      actorType,
      eventTime: input.eventTime ?? new Date().toISOString(),
      source: "scan"
    };

    this.nextScanRecordNumber += 1;
    this.scanRecords.push(record);
    return record;
  }

  listScanRecordsByOrderId(orderId: string): ScanRecord[] {
    return this.scanRecords.filter((record) => record.orderId === orderId);
  }

  createOrderFolder(input: OrderFolderCreateInput): OrderFolderRecord {
    const existing = this.findOrderFolderByOrderId(input.orderId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const record: OrderFolderRecord = {
      ...input,
      id: `mock-order-folder-${this.nextOrderFolderNumber}`,
      createdAt: now,
      updatedAt: now
    };

    this.nextOrderFolderNumber += 1;
    this.orderFolders.push(record);
    return record;
  }

  findOrderFolderByOrderId(orderId: string): OrderFolderRecord | undefined {
    return this.orderFolders.find((folder) => folder.orderId === orderId);
  }

  createPatternTask(input: PatternTaskCreateInput): PatternTaskRecord {
    const existing = this.findPatternTaskByOrderId(input.orderId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const record: PatternTaskRecord = {
      orderId: input.orderId,
      status: input.status ?? PATTERN_TASK_STATUSES.pending,
      requirements: [...(input.requirements ?? [])],
      completedRequirements: [...(input.completedRequirements ?? [])],
      id: `mock-pattern-task-${this.nextPatternTaskNumber}`,
      createdAt: now,
      updatedAt: now,
      ...(input.totalWorkHours !== undefined ? { totalWorkHours: input.totalWorkHours } : {}),
      ...(input.completionNote ? { completionNote: input.completionNote } : {}),
      ...(input.patternMakerId ? { patternMakerId: input.patternMakerId } : {}),
      ...(input.patternMakerName ? { patternMakerName: input.patternMakerName } : {}),
      ...(input.internalName ? { internalName: input.internalName } : {}),
      ...(input.linkedPatternLibraryEntryId
        ? { linkedPatternLibraryEntryId: input.linkedPatternLibraryEntryId }
        : {}),
      ...(input.orderFolderId ? { orderFolderId: input.orderFolderId } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(input.pausedAt ? { pausedAt: input.pausedAt } : {}),
      ...(input.pausedReason ? { pausedReason: input.pausedReason } : {})
    };

    this.nextPatternTaskNumber += 1;
    this.patternTasks.push(record);
    return record;
  }

  updatePatternTask(id: string, input: PatternTaskUpdateInput): PatternTaskRecord {
    const index = this.patternTasks.findIndex((task) => task.id === id);
    if (index < 0) {
      throw new Error("Pattern task not found.");
    }

    const record: PatternTaskRecord = {
      ...this.patternTasks[index]!,
      ...input,
      updatedAt: new Date().toISOString()
    };
    this.patternTasks[index] = record;
    return record;
  }

  findPatternTaskById(id: string): PatternTaskRecord | undefined {
    return this.patternTasks.find((task) => task.id === id);
  }

  findPatternTaskByOrderId(orderId: string): PatternTaskRecord | undefined {
    return this.patternTasks.find((task) => task.orderId === orderId);
  }

  listPatternTasks(): PatternTaskRecord[] {
    return [...this.patternTasks];
  }

  createPatternDeliverable(input: PatternDeliverableCreateInput): PatternDeliverableRecord {
    const record: PatternDeliverableRecord = {
      ...input,
      type: input.type ?? PATTERN_DELIVERABLE_TYPES.other,
      visibility: input.visibility,
      id: `mock-pattern-deliverable-${this.nextPatternDeliverableNumber}`,
      createdAt: new Date().toISOString()
    };

    this.nextPatternDeliverableNumber += 1;
    this.patternDeliverables.push(record);
    return record;
  }

  claimPendingPatternTask(
    id: string,
    input: import("../../../modules/patterns/patternTypes.js").PatternTaskClaimInput
  ): PatternTaskRecord | undefined {
    const task = this.findPatternTaskById(id);
    if (!task || task.status !== PATTERN_TASK_STATUSES.pending || task.patternMakerId) {
      return undefined;
    }
    return this.updatePatternTask(id, {
      status: PATTERN_TASK_STATUSES.active,
      patternMakerId: input.patternMakerId,
      patternMakerName: input.patternMakerName,
      startedAt: input.startedAt,
      pausedAt: "",
      pausedReason: ""
    });
  }

  deletePendingPatternTask(id: string): boolean {
    const index = this.patternTasks.findIndex(
      (task) => task.id === id && task.status === PATTERN_TASK_STATUSES.pending && !task.patternMakerId
    );
    if (index < 0) return false;
    this.patternTasks.splice(index, 1);
    return true;
  }

  listPatternDeliverablesByOrderId(orderId: string): PatternDeliverableRecord[] {
    return this.patternDeliverables.filter(
      (deliverable) => deliverable.orderId === orderId && !deliverable.archivedAt
    );
  }

  updatePatternDeliverable(
    id: string,
    input: PatternDeliverableUpdateInput
  ): PatternDeliverableRecord | undefined {
    const index = this.patternDeliverables.findIndex((deliverable) => deliverable.id === id);
    if (index < 0) return undefined;
    const updated = { ...this.patternDeliverables[index]!, ...input };
    this.patternDeliverables[index] = updated;
    return updated;
  }

  archivePatternDeliverable(id: string, archivedAt: string): PatternDeliverableRecord | undefined {
    const index = this.patternDeliverables.findIndex((deliverable) => deliverable.id === id);
    if (index < 0) return undefined;
    const updated = { ...this.patternDeliverables[index]!, archivedAt };
    this.patternDeliverables[index] = updated;
    return updated;
  }

  createPatternLibraryEntry(
    input: PatternLibraryEntryCreateInput
  ): PatternLibraryEntryRecord {
    const now = new Date().toISOString();
    const record: PatternLibraryEntryRecord = {
      ...input,
      id: `mock-pattern-library-entry-${this.nextPatternLibraryEntryNumber}`,
      createdAt: now,
      updatedAt: now
    };

    this.nextPatternLibraryEntryNumber += 1;
    this.patternLibraryEntries.push(record);
    return record;
  }

  updatePatternLibraryEntry(
    id: string,
    input: PatternLibraryEntryUpdateInput
  ): PatternLibraryEntryRecord {
    const index = this.patternLibraryEntries.findIndex((entry) => entry.id === id);
    if (index < 0) {
      throw new Error("Pattern library entry not found.");
    }

    const record: PatternLibraryEntryRecord = {
      ...this.patternLibraryEntries[index]!,
      ...input,
      updatedAt: new Date().toISOString()
    };
    this.patternLibraryEntries[index] = record;
    return record;
  }

  findPatternLibraryEntryById(id: string): PatternLibraryEntryRecord | undefined {
    return this.patternLibraryEntries.find((entry) => entry.id === id);
  }

  listPatternLibraryEntries(): PatternLibraryEntryRecord[] {
    return [...this.patternLibraryEntries];
  }

  createSubmittedCuttingVersion(
    input: SubmittedCuttingVersionCreateInput
  ): SubmittedCuttingVersionRecord {
    const files: SubmittedCuttingFileRecord[] = input.files.map((file) => ({
      ...file,
      id: `mock-submitted-cutting-file-${this.nextSubmittedCuttingFileNumber++}`,
      submissionId: `mock-submitted-cutting-version-${this.nextSubmittedCuttingVersionNumber}`,
      createdAt: new Date().toISOString()
    }));

    const record: SubmittedCuttingVersionRecord = {
      ...input,
      id: `mock-submitted-cutting-version-${this.nextSubmittedCuttingVersionNumber}`,
      purpose: input.purpose ?? "cutting_handoff",
      status: input.status ?? CUTTING_INBOX_STATUSES.pendingPrint,
      files
    };

    this.nextSubmittedCuttingVersionNumber += 1;
    this.submittedCuttingVersions.push(record);
    return record;
  }

  updateSubmittedCuttingVersion(
    id: string,
    input: SubmittedCuttingVersionUpdateInput
  ): SubmittedCuttingVersionRecord {
    const index = this.submittedCuttingVersions.findIndex((submission) => submission.id === id);
    if (index < 0) {
      throw new Error("Submitted cutting version not found.");
    }

    const record: SubmittedCuttingVersionRecord = {
      ...this.submittedCuttingVersions[index]!,
      ...input
    };
    this.submittedCuttingVersions[index] = record;
    return record;
  }

  findSubmittedCuttingVersionById(id: string): SubmittedCuttingVersionRecord | undefined {
    return this.submittedCuttingVersions.find((submission) => submission.id === id);
  }

  listSubmittedCuttingVersions(): SubmittedCuttingVersionRecord[] {
    return [...this.submittedCuttingVersions];
  }

  listSubmittedCuttingVersionsByOrderId(orderId: string): SubmittedCuttingVersionRecord[] {
    return this.submittedCuttingVersions.filter((submission) => submission.orderId === orderId);
  }

  createOrderCharge(input: OrderChargeCreateInput): OrderChargeRecord {
    const now = new Date().toISOString();
    const record: OrderChargeRecord = {
      ...input,
      id: `mock-order-charge-${this.nextOrderChargeNumber++}`,
      status: input.status ?? "pending",
      createdAt: now,
      updatedAt: now
    };
    this.orderCharges.push(record);
    return record;
  }

  listOrderChargesByOrderId(orderId: string): OrderChargeRecord[] {
    return this.orderCharges
      .filter((charge) => charge.orderId === orderId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  findOrderChargeById(id: string): OrderChargeRecord | undefined {
    return this.orderCharges.find((charge) => charge.id === id);
  }

  updateOrderCharge(id: string, input: OrderChargeUpdateInput): OrderChargeRecord {
    const index = this.orderCharges.findIndex((charge) => charge.id === id);
    if (index < 0) {
      throw new Error("Order charge not found.");
    }
    const record = {
      ...this.orderCharges[index]!,
      ...input,
      updatedAt: new Date().toISOString()
    } as unknown as OrderChargeRecord;
    for (const field of [
      "reviewedAt",
      "reviewedBy",
      "reviewedByName",
      "rejectedAt",
      "rejectedBy",
      "rejectedByName",
      "rejectionReason",
      "cancelledAt",
      "cancelledBy",
      "cancelledByName",
      "cancelReason",
      "archivedAt",
      "voidedAt",
      "voidedBy",
      "voidedByName",
      "voidReason"
    ] as const) {
      if (input[field] === null) {
        delete (record as unknown as Record<string, unknown>)[field];
      }
    }
    this.orderCharges[index] = record;
    return record;
  }

  reviewEffectiveOrderCharge(
    id: string,
    input: OrderChargeUpdateInput
  ): OrderChargeRecord | undefined {
    const charge = this.findOrderChargeById(id);
    if (
      !charge ||
      !["pending", "effective"].includes(charge.status) ||
      charge.reviewedAt
    ) return undefined;
    return this.updateOrderCharge(id, input);
  }

  voidEffectiveOrderCharge(
    id: string,
    input: OrderChargeUpdateInput
  ): OrderChargeRecord | undefined {
    const charge = this.findOrderChargeById(id);
    if (!charge || ["void", "cancelled"].includes(charge.status)) return undefined;
    return this.updateOrderCharge(id, input);
  }

  private pricingWithExtraCharges(record: PricingRecord): PricingRecord {
    return {
      ...record,
      extraCharges: this.extraCharges.filter((charge) => charge.pricingRecordId === record.id),
      internalCostItems: this.internalCostItems.filter(
        (item) => item.pricingRecordId === record.id
      ),
      customerChargeItems: this.customerChargeItems.filter(
        (item) => item.pricingRecordId === record.id
      )
    };
  }

  findPricingRecordByOrderId(orderId: string): PricingRecord | undefined {
    const record = this.pricingRecords.find((pricing) => pricing.orderId === orderId);
    return record ? this.pricingWithExtraCharges(record) : undefined;
  }

  listPricingRecords(): PricingRecord[] {
    return this.pricingRecords.map((record) => this.pricingWithExtraCharges(record));
  }

  upsertPricingRecord(orderId: string, input: PricingUpdateInput): PricingRecord {
    const now = new Date().toISOString();
    const existingIndex = this.pricingRecords.findIndex((pricing) => pricing.orderId === orderId);
    const existing = existingIndex >= 0 ? this.pricingRecords[existingIndex] : undefined;
    const record: PricingRecord = {
      ...(existing ?? {}),
      id: existing?.id ?? `mock-pricing-record-${this.nextPricingRecordNumber}`,
      orderId,
      quotationStatus: input.quotationStatus ?? existing?.quotationStatus ?? "draft",
      createdBy: existing?.createdBy ?? input.createdBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      extraCharges: [],
      internalCostItems: [],
      customerChargeItems: []
    };

    const optionalFields = [
      "quotedPrice",
      "customerPatternFee",
      "internalPatternCost",
      "internalCuttingCost",
      "internalSewingCost",
      "internalFinishingCost",
      "finishingPiecesSnapshot",
      "finishingNote",
      "confirmedAt",
      "confirmedBy",
      "confirmedByName",
      "confirmedSampleUnitPrice",
      "confirmedSampleAmount",
      "confirmedCustomerPatternFee",
      "confirmedOtherChargeTotal",
      "confirmedOtherChargeNote",
      "confirmedReceivableTotal",
      "confirmedCustomerChargeSnapshot",
      "confirmedInternalCostSnapshot",
      "confirmedOtherChargeSnapshot",
      "confirmedCustomerQuoteSubtotal",
      "confirmedBaseInternalCost",
      "confirmedInternalCostTotal",
      "confirmedGrossProfit",
      "confirmedGrossMargin",
      "recommendationsInitializedAt",
      "costAmount",
      "note"
    ] as const;
    for (const field of optionalFields) {
      const value = input[field];
      if (value === null) {
        delete (record as unknown as Record<string, unknown>)[field];
      } else if (value !== undefined) {
        (record as unknown as Record<string, unknown>)[field] = value;
      }
    }

    if (existingIndex >= 0) {
      this.pricingRecords[existingIndex] = record;
    } else {
      this.nextPricingRecordNumber += 1;
      this.pricingRecords.push(record);
    }

    return this.pricingWithExtraCharges(record);
  }

  createInternalCostItem(input: InternalCostItemCreateInput): InternalCostItemRecord {
    const now = new Date().toISOString();
    const record: InternalCostItemRecord = {
      ...input,
      id: `mock-internal-cost-item-${this.nextInternalCostItemNumber++}`,
      createdAt: now,
      updatedAt: now
    };
    this.internalCostItems.push(record);
    return record;
  }

  updateInternalCostItem(
    id: string,
    input: InternalCostItemUpdateInput
  ): InternalCostItemRecord | undefined {
    const index = this.internalCostItems.findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    const current = this.internalCostItems[index]!;
    const record = {
      ...current,
      ...input,
      updatedAt: new Date().toISOString()
    } as unknown as InternalCostItemRecord;
    for (const field of ["sourceTask", "note", "archivedAt"] as const) {
      if (input[field] === undefined) continue;
      if (input[field] === null) {
        delete (record as unknown as Record<string, unknown>)[field];
      }
    }
    this.internalCostItems[index] = record;
    return record;
  }

  createCustomerChargeItem(input: CustomerChargeItemCreateInput): CustomerChargeItemRecord {
    const now = new Date().toISOString();
    const record: CustomerChargeItemRecord = {
      ...input,
      id: `mock-customer-charge-item-${this.nextCustomerChargeItemNumber++}`,
      createdAt: now,
      updatedAt: now
    };
    this.customerChargeItems.push(record);
    return record;
  }

  updateCustomerChargeItem(
    id: string,
    input: CustomerChargeItemUpdateInput
  ): CustomerChargeItemRecord | undefined {
    const index = this.customerChargeItems.findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    const current = this.customerChargeItems[index]!;
    const record = {
      ...current,
      ...input,
      updatedAt: new Date().toISOString()
    } as unknown as CustomerChargeItemRecord;
    for (const field of ["unitPrice", "quantity", "sourceTask", "note", "archivedAt"] as const) {
      if (input[field] === undefined) continue;
      if (input[field] === null) {
        delete (record as unknown as Record<string, unknown>)[field];
      }
    }
    this.customerChargeItems[index] = record;
    return record;
  }

  private cloneReconciliationStatement(
    record: ReconciliationStatementRecord
  ): ReconciliationStatementRecord {
    return {
      ...record,
      items: record.items.map((item) => ({ ...item }))
    };
  }

  createReconciliationStatement(
    input: ReconciliationStatementCreateInput
  ): ReconciliationStatementRecord {
    const now = input.generatedAt ?? new Date().toISOString();
    const statementId = `mock-reconciliation-statement-${this.nextReconciliationStatementNumber}`;
    const record: ReconciliationStatementRecord = {
      id: statementId,
      statementNo: input.statementNo,
      customerName: input.customerName,
      salespersonName: input.salespersonName,
      billingPeriod: input.billingPeriod,
      orderCount: input.items.length,
      receivableAmount: input.receivableAmount,
      paidAmount: 0,
      status: "pending_payment",
      generatedAt: now,
      generatedBy: input.generatedBy,
      items: input.items.map((item) => ({
        ...item,
        id: `mock-reconciliation-statement-item-${this.nextReconciliationStatementItemNumber++}`,
        statementId,
        generatedAt: item.generatedAt ?? now
      }))
    };

    this.nextReconciliationStatementNumber += 1;
    this.reconciliationStatements.push(record);
    return this.cloneReconciliationStatement(record);
  }

  listReconciliationStatements(): ReconciliationStatementRecord[] {
    return this.reconciliationStatements
      .map((record) => this.cloneReconciliationStatement(record))
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  }

  findReconciliationStatementById(id: string): ReconciliationStatementRecord | undefined {
    const record = this.reconciliationStatements.find((statement) => statement.id === id);
    return record ? this.cloneReconciliationStatement(record) : undefined;
  }

  updateReconciliationStatement(
    id: string,
    input: ReconciliationStatementUpdateInput
  ): ReconciliationStatementRecord {
    const index = this.reconciliationStatements.findIndex((statement) => statement.id === id);
    if (index < 0) {
      throw new Error("Reconciliation statement not found.");
    }

    const { paidAt, paidBy, ...otherInput } = input;
    const updated: ReconciliationStatementRecord = {
      ...this.reconciliationStatements[index]!,
      ...otherInput,
      ...(paidAt !== undefined ? { paidAt: paidAt ?? undefined } : {}),
      ...(paidBy !== undefined ? { paidBy: paidBy ?? undefined } : {})
    };
    this.reconciliationStatements[index] = updated;
    return this.cloneReconciliationStatement(updated);
  }

  updateReconciliationStatementItem(
    id: string,
    input: ReconciliationStatementItemUpdateInput
  ): ReconciliationStatementRecord {
    const statementIndex = this.reconciliationStatements.findIndex((statement) =>
      statement.items.some((item) => item.id === id)
    );
    if (statementIndex < 0) {
      throw new Error("Reconciliation statement item not found.");
    }
    const statement = this.reconciliationStatements[statementIndex]!;
    const { otherChargeNote, remark, ...otherInput } = input;
    const normalizedInput: Partial<ReconciliationStatementItemSnapshot> = {
      ...otherInput,
      ...(otherChargeNote !== undefined
        ? { otherChargeNote: otherChargeNote ?? undefined }
        : {}),
      ...(remark !== undefined ? { remark: remark ?? undefined } : {})
    };
    const updated: ReconciliationStatementRecord = {
      ...statement,
      items: statement.items.map((item) =>
        item.id === id ? { ...item, ...normalizedInput } : item
      )
    };
    this.reconciliationStatements[statementIndex] = updated;
    return this.cloneReconciliationStatement(updated);
  }
}

export function createInMemoryStore() {
  return new InMemorySampleRoomStore();
}
