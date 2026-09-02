import {
  ATTACHMENT_VISIBILITY,
  CLIENT_ACCESS_SCOPES,
  INTAKE_STATUSES,
  ORDER_STAGES,
  ROLES,
  isClientRole
} from "@sample-room/shared";
import type { BusinessUserRequestRecord } from "../accounts/businessUserRequestTypes.js";
import type {
  ClientUserRecord,
  CustomerRecord,
  OrderAttachmentRecord,
  OrderRecord
} from "../orders/orderTypes.js";
import type { CurrentUser } from "./currentUser.js";

export type PolicyDecision = {
  allowed: boolean;
  reason?: string;
};

type CustomerPolicyRecord = Pick<CustomerRecord, "id" | "status">;
type ClientUserPolicyRecord = Pick<
  ClientUserRecord,
  "id" | "customerId" | "status" | "clientAccessScope"
>;
type OrderPolicyRecord = Pick<
  OrderRecord,
  "customerId" | "clientUserId" | "intakeStatus" | "stage" | "sourceType"
> & {
  terminated?: boolean | undefined;
};
type AttachmentPolicyRecord = Pick<OrderAttachmentRecord, "visibility">;
type BusinessUserRequestPolicyRecord = Pick<BusinessUserRequestRecord, "customerId">;

function allow(): PolicyDecision {
  return { allowed: true };
}

function deny(reason?: string): PolicyDecision {
  const decision: PolicyDecision = { allowed: false };
  if (reason) {
    decision.reason = reason;
  }

  return decision;
}

export function isSystemOwner(currentUser: Pick<CurrentUser, "role">) {
  return currentUser.role === ROLES.systemOwner;
}

export function isBossOrSystemOwner(currentUser: Pick<CurrentUser, "role">) {
  return currentUser.role === ROLES.boss || currentUser.role === ROLES.systemOwner;
}

export function canUseReceiverWorkflow(currentUser: Pick<CurrentUser, "role">) {
  return currentUser.role === ROLES.receiver || currentUser.role === ROLES.boss;
}

export function canUsePatternMakerWorkflow(currentUser: Pick<CurrentUser, "role">): PolicyDecision {
  return currentUser.role === ROLES.patternMaker
    ? allow()
    : deny("cannot_use_pattern_maker_workflow");
}

export function canManagePatternLibrary(currentUser: Pick<CurrentUser, "role">): PolicyDecision {
  return currentUser.role === ROLES.patternMaker || isBossOrSystemOwner(currentUser)
    ? allow()
    : deny("cannot_manage_pattern_library");
}

export function canUseCuttingRoomWorkflow(currentUser: Pick<CurrentUser, "role">): PolicyDecision {
  return isBossOrSystemOwner(currentUser)
    ? allow()
    : deny("cannot_use_cutting_room_workflow");
}

export function canUsePlannerWorkflow(currentUser: Pick<CurrentUser, "role">): PolicyDecision {
  return currentUser.role === ROLES.planner || isBossOrSystemOwner(currentUser)
    ? allow()
    : deny("cannot_use_planner_workflow");
}

export function canManageOrderTermination(currentUser: Pick<CurrentUser, "role">): PolicyDecision {
  return isBossOrSystemOwner(currentUser) ? allow() : deny("cannot_manage_order_termination");
}

export function hasActiveClientBinding(
  currentUser: CurrentUser,
  customer: CustomerPolicyRecord | undefined,
  clientUser: ClientUserPolicyRecord | undefined
): PolicyDecision {
  if (!isClientRole(currentUser.role)) {
    return deny("not_client_account");
  }

  if (!currentUser.customerId || !currentUser.clientUserId) {
    return deny("missing_client_binding");
  }

  if (!customer || !clientUser) {
    return deny("inactive_client_binding");
  }

  if (customer.status !== "active" || clientUser.status !== "active") {
    return deny("inactive_client_binding");
  }

  if (customer.id !== currentUser.customerId || clientUser.id !== currentUser.clientUserId) {
    return deny("session_binding_mismatch");
  }

  if (clientUser.customerId !== customer.id) {
    return deny("client_account_customer_mismatch");
  }

  return allow();
}

export function isActiveOwnScopeClientUserForCustomer(
  customerId: string,
  clientUser: ClientUserPolicyRecord | undefined
): PolicyDecision {
  if (!clientUser) {
    return deny("missing_client_profile");
  }

  if (
    clientUser.status !== "active" ||
    clientUser.customerId !== customerId ||
    clientUser.clientAccessScope !== CLIENT_ACCESS_SCOPES.own
  ) {
    return deny("client_business_user_not_active_own_scope_for_customer");
  }

  return allow();
}

export function canClientReadOrder(
  currentUser: CurrentUser,
  clientUser: ClientUserPolicyRecord,
  order: OrderPolicyRecord
): PolicyDecision {
  if (!isClientRole(currentUser.role)) {
    return deny("not_client_account");
  }

  if (!currentUser.customerId || !currentUser.clientUserId) {
    return deny("missing_client_binding");
  }

  if (
    clientUser.status !== "active" ||
    clientUser.id !== currentUser.clientUserId ||
    clientUser.customerId !== currentUser.customerId
  ) {
    return deny("inactive_client_binding");
  }

  if (order.customerId !== currentUser.customerId) {
    return deny("cross_customer_order");
  }

  if (clientUser.clientAccessScope === CLIENT_ACCESS_SCOPES.customerAll) {
    return allow();
  }

  if (
    clientUser.clientAccessScope === CLIENT_ACCESS_SCOPES.own &&
    order.clientUserId === currentUser.clientUserId
  ) {
    return allow();
  }

  return deny("order_not_owned_by_client_business_user");
}

export function canClientCreateOrder(
  currentUser: CurrentUser,
  customerId: string,
  clientUserId: string,
  clientUser?: ClientUserPolicyRecord
): PolicyDecision {
  if (!isClientRole(currentUser.role)) {
    return deny("not_client_account");
  }

  if (currentUser.customerId !== customerId || currentUser.clientUserId !== clientUserId) {
    return deny("session_binding_mismatch");
  }

  const accessScope = clientUser?.clientAccessScope ?? currentUser.clientAccessScope;
  if (accessScope !== CLIENT_ACCESS_SCOPES.own) {
    return deny("customer_admin_cannot_create_order");
  }

  if (
    clientUser &&
    (clientUser.status !== "active" ||
      clientUser.id !== clientUserId ||
      clientUser.customerId !== customerId)
  ) {
    return deny("inactive_client_binding");
  }

  return allow();
}

export function canClientAddOrderAttachment(
  currentUser: CurrentUser,
  clientUser: ClientUserPolicyRecord,
  order: OrderPolicyRecord
): PolicyDecision {
  if (order.terminated) {
    return deny("order_terminated");
  }

  if (clientUser.clientAccessScope !== CLIENT_ACCESS_SCOPES.own) {
    return deny("customer_admin_cannot_change_order");
  }

  return canClientReadOrder(currentUser, clientUser, order);
}

export function canClientSupplementOrder(
  currentUser: CurrentUser,
  clientUser: ClientUserPolicyRecord,
  order: OrderPolicyRecord
): PolicyDecision {
  const writable = canClientAddOrderAttachment(currentUser, clientUser, order);
  if (!writable.allowed) {
    return writable;
  }

  if (order.intakeStatus !== INTAKE_STATUSES.needsClientSupplement) {
    return deny("order_not_waiting_for_client_supplement");
  }

  return allow();
}

export function canClientViewAttachment(
  currentUser: CurrentUser,
  clientUser: ClientUserPolicyRecord,
  order: OrderPolicyRecord,
  attachment: AttachmentPolicyRecord
): PolicyDecision {
  const readable = canClientReadOrder(currentUser, clientUser, order);
  if (!readable.allowed) {
    return readable;
  }

  if (attachment.visibility !== ATTACHMENT_VISIBILITY.clientVisible) {
    return deny("attachment_not_client_visible");
  }

  return allow();
}

export function canClientAdminListBusinessUsers(
  currentUser: CurrentUser,
  customerId: string,
  clientUser?: ClientUserPolicyRecord
): PolicyDecision {
  if (!isClientRole(currentUser.role)) {
    return deny("not_client_account");
  }

  if (!currentUser.customerId || currentUser.customerId !== customerId) {
    return deny("cross_customer_admin_action");
  }

  const accessScope = clientUser?.clientAccessScope ?? currentUser.clientAccessScope;
  if (accessScope !== CLIENT_ACCESS_SCOPES.customerAll) {
    return deny("not_customer_admin");
  }

  if (
    clientUser &&
    (clientUser.status !== "active" ||
      clientUser.id !== currentUser.clientUserId ||
      clientUser.customerId !== customerId)
  ) {
    return deny("inactive_client_binding");
  }

  return allow();
}

export function canClientAdminCreateBusinessUserRequest(
  currentUser: CurrentUser,
  customerId: string,
  clientUser?: ClientUserPolicyRecord
): PolicyDecision {
  return canClientAdminListBusinessUsers(currentUser, customerId, clientUser);
}

export function canClientViewBusinessUserRequest(
  currentUser: CurrentUser,
  clientUser: ClientUserPolicyRecord,
  request: BusinessUserRequestPolicyRecord
): PolicyDecision {
  return canClientAdminListBusinessUsers(currentUser, request.customerId, clientUser);
}

export function canReviewBusinessUserRequest(currentUser: Pick<CurrentUser, "role">) {
  return isBossOrSystemOwner(currentUser) ? allow() : deny("cannot_review_business_user_request");
}

export function canReceiverViewOrder(
  currentUser: Pick<CurrentUser, "role">,
  _order: OrderPolicyRecord
): PolicyDecision {
  return canUseReceiverWorkflow(currentUser) ? allow() : deny("cannot_use_receiver_workflow");
}

export function canReceiverAcceptOrder(
  currentUser: Pick<CurrentUser, "role">,
  order: OrderPolicyRecord
): PolicyDecision {
  if (!canUseReceiverWorkflow(currentUser)) {
    return deny("cannot_use_receiver_workflow");
  }

  if (
    order.intakeStatus !== INTAKE_STATUSES.pendingReceive ||
    (order.sourceType !== "client_submission" && order.sourceType !== "receiver_self_entry")
  ) {
    return deny("order_not_pending_receive");
  }

  if (order.terminated) {
    return deny("order_terminated");
  }

  return allow();
}

export function canReceiverReturnOrder(
  currentUser: Pick<CurrentUser, "role">,
  order: OrderPolicyRecord
): PolicyDecision {
  if (!canUseReceiverWorkflow(currentUser)) {
    return deny("cannot_use_receiver_workflow");
  }

  if (order.sourceType !== "client_submission" || order.intakeStatus !== INTAKE_STATUSES.pendingReceive) {
    return deny("order_not_pending_client_submission");
  }

  if (order.terminated) {
    return deny("order_terminated");
  }

  return allow();
}

export function canReceiverMaintainTracking(
  currentUser: Pick<CurrentUser, "role">,
  order: OrderPolicyRecord
): PolicyDecision {
  if (!canUseReceiverWorkflow(currentUser)) {
    return deny("cannot_use_receiver_workflow");
  }

  if (
    order.intakeStatus !== INTAKE_STATUSES.received ||
    order.stage === null ||
    order.stage === ORDER_STAGES.done ||
    order.terminated
  ) {
    return deny("order_not_active_tracking");
  }

  return allow();
}

export function canReceiverCreateSelfEntry(currentUser: Pick<CurrentUser, "role">) {
  return canUseReceiverWorkflow(currentUser) ? allow() : deny("cannot_use_receiver_workflow");
}

export function canReceiverCorrectOrder(
  currentUser: Pick<CurrentUser, "role">,
  order: OrderPolicyRecord
): PolicyDecision {
  if (currentUser.role !== ROLES.receiver) {
    return deny("cannot_correct_order");
  }
  return order.terminated ? deny("order_terminated") : allow();
}

export function canReceiverAddInternalAttachment(
  currentUser: Pick<CurrentUser, "role">,
  order: OrderPolicyRecord
): PolicyDecision {
  if (!canUseReceiverWorkflow(currentUser)) {
    return deny("cannot_use_receiver_workflow");
  }

  if (order.intakeStatus === INTAKE_STATUSES.pendingReceive && !order.terminated) {
    return allow();
  }

  return canReceiverMaintainTracking(currentUser, order);
}

export function canReceiverAddMaterialRecord(
  currentUser: Pick<CurrentUser, "role">,
  order: OrderPolicyRecord
): PolicyDecision {
  if (!canUseReceiverWorkflow(currentUser)) {
    return deny("cannot_use_receiver_workflow");
  }

  if (order.intakeStatus !== INTAKE_STATUSES.received || order.terminated) {
    return deny("order_not_available_for_material_record");
  }

  return allow();
}
