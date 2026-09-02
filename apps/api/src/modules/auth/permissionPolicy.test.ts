import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_VISIBILITY,
  CLIENT_ACCESS_SCOPES,
  INTAKE_STATUSES,
  ORDER_STAGES,
  ROLES
} from "@sample-room/shared";
import type { BusinessUserRequestRecord } from "../accounts/businessUserRequestTypes.js";
import type {
  ClientUserRecord,
  CustomerRecord,
  OrderAttachmentRecord,
  OrderRecord
} from "../orders/orderTypes.js";
import type { CurrentUser } from "./currentUser.js";
import {
  canClientAddOrderAttachment,
  canClientAdminCreateBusinessUserRequest,
  canClientCreateOrder,
  canClientReadOrder,
  canClientSupplementOrder,
  canClientViewAttachment,
  canClientViewBusinessUserRequest,
  canReceiverAddInternalAttachment,
  canReceiverAddMaterialRecord,
  canReceiverMaintainTracking,
  canReviewBusinessUserRequest,
  hasActiveClientBinding,
  isActiveOwnScopeClientUserForCustomer
} from "./permissionPolicy.js";

const customerA: CustomerRecord = {
  id: "customer-a",
  name: "Customer A",
  status: "active"
};

const ownClientUser: ClientUserRecord = {
  id: "client-a-1",
  customerId: customerA.id,
  accountId: "account-client-a-1",
  displayName: "Client A User",
  status: "active",
  clientAccessScope: CLIENT_ACCESS_SCOPES.own
};

const otherClientUser: ClientUserRecord = {
  id: "client-a-2",
  customerId: customerA.id,
  accountId: "account-client-a-2",
  displayName: "Client A Other User",
  status: "active",
  clientAccessScope: CLIENT_ACCESS_SCOPES.own
};

const adminClientUser: ClientUserRecord = {
  id: "client-a-admin",
  customerId: customerA.id,
  accountId: "account-client-a-admin",
  displayName: "Client A Admin",
  status: "active",
  clientAccessScope: CLIENT_ACCESS_SCOPES.customerAll
};

const ownCurrentUser: CurrentUser = {
  id: ownClientUser.id,
  role: ROLES.clientBusinessUser,
  customerId: customerA.id,
  clientUserId: ownClientUser.id
};

const adminCurrentUser: CurrentUser = {
  id: adminClientUser.id,
  role: ROLES.clientAdmin,
  customerId: customerA.id,
  clientUserId: adminClientUser.id
};

const receiverUser: CurrentUser = {
  id: "receiver-1",
  role: ROLES.receiver
};

const bossUser: CurrentUser = {
  id: "boss-1",
  role: ROLES.boss
};

const systemOwnerUser: CurrentUser = {
  id: "system-owner-1",
  role: ROLES.systemOwner
};

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-1",
    orderNo: "V2-MOCK-0001",
    folderCode: "SR20260611001",
    sourceType: "client_submission",
    customerId: customerA.id,
    clientUserId: ownClientUser.id,
    customerName: customerA.name,
    salespersonId: ownClientUser.id,
    salespersonName: ownClientUser.displayName,
    customerSnapshot: { id: customerA.id, name: customerA.name },
    clientUserSnapshot: { id: ownClientUser.id, displayName: ownClientUser.displayName },
    styleNo: "ST-001",
    styleName: "Sample",
    quantity: 1,
    sampleType: "first_sample",
    sampleRound: "round_1",
    deliveryDate: "2026-06-18",
    intakeStatus: INTAKE_STATUSES.needsClientSupplement,
    stage: null,
    patternStatus: "has",
    patternSourceType: "customer_provided",
    sampleRequestItems: ["sample_garment", "pattern_making"],
    sampleGarmentRequired: true,
    fabricStatus: "missing",
    trimStatus: "missing",
    supplementCount: 0,
    terminated: false,
    createdBy: ownClientUser.id,
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    correctionLogs: [],
    ...overrides
  };
}

function attachment(
  visibility: OrderAttachmentRecord["visibility"] = ATTACHMENT_VISIBILITY.clientVisible
): OrderAttachmentRecord {
  return {
    id: "attachment-1",
    orderId: "order-1",
    fileName: "sample.pdf",
    mimeType: "application/pdf",
    size: 10,
    category: "client_reference",
    uploadedBy: ownClientUser.id,
    uploadedByRole: ROLES.clientBusinessUser,
    createdAt: "2026-06-11T00:00:00.000Z",
    visibility
  };
}

function businessUserRequest(
  customerId = customerA.id
): BusinessUserRequestRecord {
  return {
    id: "request-1",
    customerId,
    customerName: "Customer A",
    requestedByClientUserId: adminClientUser.id,
    requestedByName: adminClientUser.displayName,
    businessUserName: "New User",
    contact: "new@example.com",
    status: "pending",
    createdAt: "2026-06-11T00:00:00.000Z"
  };
}

describe("permissionPolicy", () => {
  it("validates active client binding against the loaded customer and client user", () => {
    expect(hasActiveClientBinding(ownCurrentUser, customerA, ownClientUser).allowed).toBe(true);
    expect(hasActiveClientBinding(ownCurrentUser, undefined, ownClientUser).allowed).toBe(false);
    expect(
      hasActiveClientBinding(ownCurrentUser, customerA, {
        ...ownClientUser,
        status: "archived"
      }).allowed
    ).toBe(false);
  });

  it("checks active own-scope client users under a customer", () => {
    expect(isActiveOwnScopeClientUserForCustomer(customerA.id, ownClientUser).allowed).toBe(true);
    expect(isActiveOwnScopeClientUserForCustomer(customerA.id, adminClientUser).allowed).toBe(false);
    expect(
      isActiveOwnScopeClientUserForCustomer("customer-b", ownClientUser).allowed
    ).toBe(false);
  });

  it("preserves client order read access for own and customer_all scopes", () => {
    expect(canClientReadOrder(ownCurrentUser, ownClientUser, order()).allowed).toBe(true);
    expect(
      canClientReadOrder(ownCurrentUser, ownClientUser, order({ clientUserId: otherClientUser.id }))
        .allowed
    ).toBe(false);
    expect(
      canClientReadOrder(ownCurrentUser, ownClientUser, order({ customerId: "customer-b" }))
        .allowed
    ).toBe(false);
    expect(
      canClientReadOrder(adminCurrentUser, adminClientUser, order({ clientUserId: otherClientUser.id }))
        .allowed
    ).toBe(true);
    expect(
      canClientReadOrder(adminCurrentUser, adminClientUser, order({ customerId: "customer-b" }))
        .allowed
    ).toBe(false);
  });

  it("preserves client create and supplement rules", () => {
    expect(
      canClientCreateOrder(ownCurrentUser, customerA.id, ownClientUser.id, ownClientUser).allowed
    ).toBe(true);
    expect(
      canClientCreateOrder(adminCurrentUser, customerA.id, adminClientUser.id, adminClientUser)
        .allowed
    ).toBe(false);
    expect(canClientSupplementOrder(ownCurrentUser, ownClientUser, order()).allowed).toBe(true);
    expect(
      canClientSupplementOrder(
        ownCurrentUser,
        ownClientUser,
        order({ intakeStatus: INTAKE_STATUSES.received, stage: ORDER_STAGES.cuttingWaiting })
      ).allowed
    ).toBe(false);
    expect(canClientSupplementOrder(adminCurrentUser, adminClientUser, order()).allowed).toBe(false);
  });

  it("preserves client attachment visibility and upload rules", () => {
    expect(
      canClientViewAttachment(ownCurrentUser, ownClientUser, order(), attachment()).allowed
    ).toBe(true);
    expect(
      canClientViewAttachment(
        ownCurrentUser,
        ownClientUser,
        order(),
        attachment(ATTACHMENT_VISIBILITY.internalOnly)
      ).allowed
    ).toBe(false);
    expect(
      canClientViewAttachment(adminCurrentUser, adminClientUser, order(), attachment()).allowed
    ).toBe(true);
    expect(canClientAddOrderAttachment(adminCurrentUser, adminClientUser, order()).allowed).toBe(
      false
    );
    expect(
      canClientViewAttachment(
        ownCurrentUser,
        ownClientUser,
        order({ customerId: "customer-b" }),
        attachment()
      ).allowed
    ).toBe(false);
  });

  it("preserves client admin business-user request rules", () => {
    expect(
      canClientAdminCreateBusinessUserRequest(
        adminCurrentUser,
        customerA.id,
        adminClientUser
      ).allowed
    ).toBe(true);
    expect(
      canClientAdminCreateBusinessUserRequest(ownCurrentUser, customerA.id, ownClientUser)
        .allowed
    ).toBe(false);
    expect(
      canClientViewBusinessUserRequest(adminCurrentUser, adminClientUser, businessUserRequest())
        .allowed
    ).toBe(true);
    expect(
      canClientViewBusinessUserRequest(
        adminCurrentUser,
        adminClientUser,
        businessUserRequest("customer-b")
      ).allowed
    ).toBe(false);
  });

  it("preserves boss and system owner request review rules", () => {
    expect(canReviewBusinessUserRequest(bossUser).allowed).toBe(true);
    expect(canReviewBusinessUserRequest(systemOwnerUser).allowed).toBe(true);
    expect(canReviewBusinessUserRequest(receiverUser).allowed).toBe(false);
    expect(canReviewBusinessUserRequest(ownCurrentUser).allowed).toBe(false);
  });

  it("preserves receiver tracking and internal attachment rules", () => {
    const trackingOrder = order({
      intakeStatus: INTAKE_STATUSES.received,
      stage: ORDER_STAGES.cuttingWaiting
    });

    expect(canReceiverMaintainTracking(receiverUser, trackingOrder).allowed).toBe(true);
    expect(canReceiverMaintainTracking(ownCurrentUser, trackingOrder).allowed).toBe(false);
    expect(canReceiverAddInternalAttachment(receiverUser, trackingOrder).allowed).toBe(true);
    expect(
      canReceiverMaintainTracking(receiverUser, order({ intakeStatus: INTAKE_STATUSES.received, stage: ORDER_STAGES.done }))
        .allowed
    ).toBe(false);
    expect(
      canReceiverAddMaterialRecord(
        receiverUser,
        order({ intakeStatus: INTAKE_STATUSES.received, stage: ORDER_STAGES.done })
      ).allowed
    ).toBe(true);
    expect(
      canReceiverAddMaterialRecord(
        receiverUser,
        order({ intakeStatus: INTAKE_STATUSES.pendingReceive, stage: null })
      ).allowed
    ).toBe(false);
    expect(
      canReceiverAddMaterialRecord(
        receiverUser,
        order({ intakeStatus: INTAKE_STATUSES.received, stage: ORDER_STAGES.done, terminated: true })
      ).allowed
    ).toBe(false);
    expect(canReceiverAddMaterialRecord(ownCurrentUser, trackingOrder).allowed).toBe(false);
  });
});
