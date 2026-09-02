import { randomBytes } from "node:crypto";
import { CLIENT_ACCESS_SCOPES, ROLES, type Role } from "@sample-room/shared";
import type {
  AuthAccountCreateInput,
  AuthAccountRepository
} from "../../db/repositories/authAccountRepository.js";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { HttpError } from "../../shared/errors/httpError.js";
import { publicUrlForPath } from "../../shared/urls/publicUrl.js";
import type { RuntimeEndpointConfigService } from "../system-owner/runtimeEndpointConfigService.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { createTemporaryPassword, hashPassword } from "../auth/password.js";
import {
  canClientAdminCreateBusinessUserRequest,
  canClientViewBusinessUserRequest,
  canReviewBusinessUserRequest,
  hasActiveClientBinding
} from "../auth/permissionPolicy.js";
import type {
  ClientUserRecord,
  CustomerRecord,
  RecordStatus
} from "../orders/orderTypes.js";
import type {
  BusinessUserRequestRecord,
  BusinessUserRequestStatus
} from "./businessUserRequestTypes.js";

type CreateBusinessUserRequestPayload = {
  businessUserName?: unknown;
  contact?: unknown;
  roleNote?: unknown;
  note?: unknown;
};

type SubmitBusinessUserRegistrationPayload = CreateBusinessUserRequestPayload & {
  username?: unknown;
  password?: unknown;
};

type CreateCustomerPayload = {
  customerName?: unknown;
};

type CreateClientUserProfilePayload = {
  displayName?: unknown;
  contact?: unknown;
};

type CreateClientUserLoginPayload = {
  username?: unknown;
  password?: unknown;
  role?: unknown;
};

type UpdateClientUserLoginRolePayload = {
  role?: unknown;
};

type UpdateCustomerAccountPayload = {
  name?: unknown;
};

type UpdateClientUserAccountPayload = {
  displayName?: unknown;
  username?: unknown;
  contact?: unknown;
  clientAccessScope?: unknown;
};

type ResetClientUserPasswordPayload = {
  password?: unknown;
};

type ReviewBusinessUserRequestPayload = {
  status?: unknown;
  reviewNote?: unknown;
  targetClientUserId?: unknown;
};

export type BusinessUserLoginCredential = {
  username: string;
  temporaryPassword: string;
};

export type PublicBusinessUserRequestRecord = Omit<
  BusinessUserRequestRecord,
  "requestedPasswordHash"
>;

export type BusinessUserRequestReviewResult = {
  request: PublicBusinessUserRequestRecord;
  loginCredential?: BusinessUserLoginCredential | undefined;
};

export type ClientUserAccountSummary = ClientUserRecord & {
  hasLoginAccount: boolean;
  loginUsername?: string | undefined;
  loginStatus?: string | undefined;
  loginRole?: Role | undefined;
  historicalOrderCount?: number | undefined;
};

export type CustomerAccountSummary = CustomerRecord & {
  clientUsers: ClientUserAccountSummary[];
};

export type BusinessUserRegistrationInfo = {
  enabled: boolean;
  message?: string | undefined;
  code?: {
    token: string;
    urlPath: string;
    recommendedUrl?: string | undefined;
    absoluteUrl?: string | undefined;
    customerId: string;
    customerName: string;
    createdByClientUserId: string;
    createdByName: string;
    createdAt: string;
  } | undefined;
};

export type BulkRowResult<T> = {
  index: number;
  status: "valid" | "created" | "failed";
  data?: T | undefined;
  error?: string | undefined;
};

type AccountStatusPayload = {
  status?: unknown;
};

type RegistrationCodeRecord = NonNullable<BusinessUserRegistrationInfo["code"]> & {
  enabled: boolean;
};

function roleForClientScope(scope: ClientUserRecord["clientAccessScope"]) {
  return scope === CLIENT_ACCESS_SCOPES.customerAll
    ? ROLES.clientAdmin
    : ROLES.clientBusinessUser;
}

function requireText(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} is required.`);
  }

  return value.trim();
}

function requirePassword(value: unknown, field = "password") {
  const password = requireText(value, field);
  if (password.length < 8) {
    throw new HttpError(400, `${field} must be at least 8 characters.`);
  }

  return password;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeReviewStatus(value: unknown): Exclude<BusinessUserRequestStatus, "pending"> {
  if (value === "approved" || value === "rejected") {
    return value;
  }

  throw new HttpError(400, "review status must be approved or rejected.");
}

function sameContact(left: string | undefined, right: string) {
  return left?.trim().toLowerCase() === right.trim().toLowerCase();
}

function normalizeRecordStatus(value: unknown): RecordStatus {
  if (value === "active" || value === "archived") {
    return value;
  }

  throw new HttpError(400, "status must be active or archived.");
}

function usernameBaseFromContact(contact: string) {
  const normalized = contact.trim().toLowerCase();
  if (normalized.includes("@")) {
    return normalized;
  }

  return `${normalized.replace(/[^a-z0-9]+/g, "-") || "client-user"}@sample-room.local`;
}

function normalizeClientAccessScope(value: unknown) {
  if (value === CLIENT_ACCESS_SCOPES.own || value === CLIENT_ACCESS_SCOPES.customerAll) {
    return value;
  }

  throw new HttpError(400, "clientAccessScope must be own or customer_all.");
}

function normalizeClientRole(value: unknown): typeof ROLES.clientAdmin | typeof ROLES.clientBusinessUser {
  if (value === ROLES.clientAdmin || value === ROLES.clientBusinessUser) {
    return value;
  }

  throw new HttpError(400, "role must be client_admin or client_business_user.");
}

function scopeForClientRole(role: typeof ROLES.clientAdmin | typeof ROLES.clientBusinessUser) {
  return role === ROLES.clientAdmin
    ? CLIENT_ACCESS_SCOPES.customerAll
    : CLIENT_ACCESS_SCOPES.own;
}

function normalizedBusinessKey(value: string) {
  return value.trim().toLocaleLowerCase("zh-Hans-CN");
}

function publicBusinessUserRequest(
  request: BusinessUserRequestRecord
): PublicBusinessUserRequestRecord {
  const { requestedPasswordHash: _passwordHash, ...publicRequest } = request;
  return publicRequest;
}

function normalizeUsername(value: unknown) {
  return requireText(value, "username").toLowerCase();
}

function newRegistrationToken() {
  return randomBytes(18).toString("base64url");
}

function usernameWithSuffix(base: string, suffix: number) {
  if (suffix === 0) {
    return base;
  }

  const atIndex = base.indexOf("@");
  if (atIndex > 0) {
    return `${base.slice(0, atIndex)}+${suffix}${base.slice(atIndex)}`;
  }

  return `${base}-${suffix}`;
}

function archivedMetadata(status: RecordStatus, currentUser: CurrentUser) {
  return status === "archived"
    ? { archivedAt: new Date().toISOString(), archivedBy: currentUser.id }
    : {};
}

export class BusinessUserRequestService {
  private readonly registrationCodesByCustomerId = new Map<string, RegistrationCodeRecord>();

  constructor(
    private readonly repository: SampleRoomRepository,
    private readonly authAccounts?: AuthAccountRepository,
    private readonly endpointConfig?: RuntimeEndpointConfigService
  ) {}

  private isSupervisor(clientUser: ClientUserRecord) {
    return clientUser.clientAccessScope === CLIENT_ACCESS_SCOPES.customerAll;
  }

  private sortClientUsers(clientUsers: ClientUserAccountSummary[]) {
    return [...clientUsers].sort((left, right) => {
      if (this.isSupervisor(left) !== this.isSupervisor(right)) {
        return this.isSupervisor(left) ? -1 : 1;
      }

      if (left.status !== right.status) {
        return left.status === "active" ? -1 : 1;
      }

      return left.displayName.localeCompare(right.displayName, "zh-Hans-CN");
    });
  }

  private async findClientUserOrThrow(clientUserId: string) {
    const clientUser = await this.repository.findClientUserById(clientUserId);
    if (!clientUser) {
      throw new HttpError(404, "client user not found.");
    }

    return clientUser;
  }

  private async customerAccountSummary(customer: CustomerRecord): Promise<CustomerAccountSummary> {
    const clientUsers = await this.repository.listClientUsersByCustomerId(customer.id);
    const accounts = await Promise.all(
      clientUsers.map((clientUser) => this.clientUserSummary(clientUser))
    );

    return {
      ...customer,
      clientUsers: this.sortClientUsers(accounts)
    };
  }

  private async requireCustomerAdminBinding(currentUser: CurrentUser) {
    if (!currentUser.customerId || !currentUser.clientUserId) {
      throw new HttpError(403, "client user session is missing customer binding.");
    }

    const customer = await this.repository.findCustomerById(currentUser.customerId);
    const clientUser = await this.repository.findClientUserById(currentUser.clientUserId);

    if (!customer || !clientUser || !hasActiveClientBinding(currentUser, customer, clientUser).allowed) {
      throw new HttpError(403, "client user is not bound to an active customer.");
    }

    if (!canClientAdminCreateBusinessUserRequest(currentUser, customer.id, clientUser).allowed) {
      throw new HttpError(
        403,
        "only customer admin accounts can request new business-user accounts."
      );
    }

    return { customer, clientUser };
  }

  async createClientRequest(
    currentUser: CurrentUser,
    payload: CreateBusinessUserRequestPayload
  ): Promise<PublicBusinessUserRequestRecord> {
    const { customer, clientUser } = await this.requireCustomerAdminBinding(currentUser);

    return publicBusinessUserRequest(await this.repository.createBusinessUserRequest({
      customerId: customer.id,
      customerName: customer.name,
      requestedByClientUserId: clientUser.id,
      requestedByName: clientUser.displayName,
      businessUserName: requireText(payload.businessUserName, "businessUserName"),
      contact: requireText(payload.contact, "contact"),
      roleNote: optionalText(payload.roleNote),
      note: optionalText(payload.note),
      source: "supervisor_request"
    }));
  }

  async getClientBusinessUserRegistrationCode(
    currentUser: CurrentUser
  ): Promise<BusinessUserRegistrationInfo> {
    const { customer } = await this.requireCustomerAdminBinding(currentUser);
    return this.registrationInfo(this.registrationCodesByCustomerId.get(customer.id));
  }

  async openClientBusinessUserRegistrationCode(
    currentUser: CurrentUser
  ): Promise<BusinessUserRegistrationInfo> {
    const { customer, clientUser } = await this.requireCustomerAdminBinding(currentUser);
    const token = newRegistrationToken();
    const record: RegistrationCodeRecord = {
      enabled: true,
      token,
      urlPath: `/client/register/${token}`,
      customerId: customer.id,
      customerName: customer.name,
      createdByClientUserId: clientUser.id,
      createdByName: clientUser.displayName,
      createdAt: new Date().toISOString()
    };
    this.registrationCodesByCustomerId.set(customer.id, record);
    return this.registrationInfo(record);
  }

  async closeClientBusinessUserRegistrationCode(
    currentUser: CurrentUser
  ): Promise<BusinessUserRegistrationInfo> {
    const { customer } = await this.requireCustomerAdminBinding(currentUser);
    const existing = this.registrationCodesByCustomerId.get(customer.id);
    if (!existing) {
      return this.registrationInfo();
    }

    const closed: RegistrationCodeRecord = { ...existing, enabled: false };
    this.registrationCodesByCustomerId.set(customer.id, closed);
    return this.registrationInfo(closed);
  }

  async getPublicBusinessUserRegistrationCode(
    token: string
  ): Promise<BusinessUserRegistrationInfo> {
    const record = this.findRegistrationCodeByToken(token);
    if (!record) {
      throw new HttpError(404, "business user registration code not found.");
    }

    return this.registrationInfo(record);
  }

  async submitPublicBusinessUserRegistration(
    token: string,
    payload: SubmitBusinessUserRegistrationPayload
  ): Promise<PublicBusinessUserRequestRecord> {
    const record = this.findRegistrationCodeByToken(token);
    if (!record || !record.enabled) {
      throw new HttpError(404, "business user registration code not found or closed.");
    }

    const username = normalizeUsername(payload.username);
    const password = requirePassword(payload.password);
    await this.requireAvailableUsername(username);

    return publicBusinessUserRequest(await this.repository.createBusinessUserRequest({
      customerId: record.customerId,
      customerName: record.customerName,
      requestedByClientUserId: record.createdByClientUserId,
      requestedByName: record.createdByName,
      businessUserName: requireText(payload.businessUserName, "businessUserName"),
      contact: requireText(payload.contact, "contact"),
      roleNote: optionalText(payload.roleNote),
      note: optionalText(payload.note),
      source: "supervisor_registration_code",
      requestedUsername: username,
      requestedPasswordHash: hashPassword(password)
    }));
  }

  async listClientRequests(currentUser: CurrentUser): Promise<PublicBusinessUserRequestRecord[]> {
    const { clientUser } = await this.requireCustomerAdminBinding(currentUser);
    const requests = await this.repository.listBusinessUserRequests();
    return requests
      .filter(
        (request) => canClientViewBusinessUserRequest(currentUser, clientUser, request).allowed
      )
      .map(publicBusinessUserRequest);
  }

  async listAllRequests(currentUser: CurrentUser): Promise<PublicBusinessUserRequestRecord[]> {
    if (!canReviewBusinessUserRequest(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }

    return (await this.repository.listBusinessUserRequests()).map(publicBusinessUserRequest);
  }

  private async findRequest(id: string): Promise<BusinessUserRequestRecord> {
    const requests = await this.repository.listBusinessUserRequests();
    const request = requests
      .find((businessUserRequest) => businessUserRequest.id === id);

    if (!request) {
      throw new HttpError(404, "business user request not found.");
    }

    return request;
  }

  private async resolveApprovedClientUser(
    request: BusinessUserRequestRecord,
    targetClientUserId?: unknown
  ): Promise<ClientUserRecord> {
    if (request.createdClientUserId) {
      const clientUser = await this.repository.findClientUserById(request.createdClientUserId);
      if (clientUser) {
        return clientUser;
      }
    }

    const clientUsers = await this.repository.listClientUsersByCustomerId(request.customerId);
    if (targetClientUserId !== undefined) {
      const targetId = requireText(targetClientUserId, "targetClientUserId");
      const target = clientUsers.find((clientUser) => clientUser.id === targetId);
      if (!target || target.status !== "active") {
        throw new HttpError(409, "selected customer salesperson profile is not active under this customer.");
      }
      return target;
    }

    const matchingProfiles = clientUsers.filter(
      (clientUser) =>
        clientUser.status === "active" &&
        sameContact(clientUser.contact, request.contact)
    );
    if (matchingProfiles.length > 1) {
      throw new HttpError(
        409,
        "multiple customer salesperson profiles match this contact; select targetClientUserId explicitly."
      );
    }
    if (matchingProfiles[0]) {
      return matchingProfiles[0];
    }

    return this.repository.createClientUser({
      customerId: request.customerId,
      displayName: request.businessUserName,
      contact: request.contact,
      status: "active",
      clientAccessScope: CLIENT_ACCESS_SCOPES.own
    });
  }

  private async uniqueUsername(contact: string) {
    if (!this.authAccounts) {
      return usernameBaseFromContact(contact);
    }

    const base = usernameBaseFromContact(contact);
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate = usernameWithSuffix(base, suffix);
      const existing = await this.authAccounts.findAuthAccountByUsername(candidate);
      if (!existing) {
        return candidate;
      }
    }

    throw new HttpError(409, "could not allocate login username.");
  }

  private async requireAvailableUsername(username: string) {
    if (!this.authAccounts) {
      return;
    }

    const existing = await this.authAccounts.findAuthAccountByUsername(username);
    if (existing) {
      throw new HttpError(409, "username is already in use.");
    }
  }

  private async requireAvailableUsernameForAccount(username: string, accountId: string) {
    if (!this.authAccounts) {
      return;
    }

    const existing = await this.authAccounts.findAuthAccountByUsername(username);
    if (existing && existing.id !== accountId) {
      throw new HttpError(409, "username is already in use.");
    }
  }

  private async registrationInfo(record?: RegistrationCodeRecord): Promise<BusinessUserRegistrationInfo> {
    if (!record) {
      return {
        enabled: false,
        message: "business user registration code is not enabled."
      };
    }

    const configured = await this.endpointConfig?.get();
    const publicUrl = configured?.publicWebBaseUrl
      ? `${configured.publicWebBaseUrl}${record.urlPath}`
      : publicUrlForPath(record.urlPath);

    return {
      enabled: record.enabled,
      ...(record.enabled ? {} : { message: "business user registration code is closed." }),
      code: {
        token: record.token,
        urlPath: record.urlPath,
        ...(publicUrl ? { recommendedUrl: publicUrl, absoluteUrl: publicUrl } : {}),
        customerId: record.customerId,
        customerName: record.customerName,
        createdByClientUserId: record.createdByClientUserId,
        createdByName: record.createdByName,
        createdAt: record.createdAt
      }
    };
  }

  private findRegistrationCodeByToken(token: string) {
    return [...this.registrationCodesByCustomerId.values()]
      .find((record) => record.token === token);
  }

  private async clientUserSummary(clientUser: ClientUserRecord): Promise<ClientUserAccountSummary> {
    const login = this.authAccounts
      ? await this.authAccounts.findAuthAccountByClientUserId(clientUser.id)
      : undefined;

    return {
      ...clientUser,
      hasLoginAccount: Boolean(login),
      ...(login
        ? {
            loginUsername: login.username,
            loginStatus: login.status,
            loginRole: login.role
          }
        : {})
    };
  }

  private async updateCustomerLoginStatuses(
    customerId: string,
    status: "active" | "disabled"
  ): Promise<void> {
    if (!this.authAccounts) {
      return;
    }

    const clientUsers = await this.repository.listClientUsersByCustomerId(customerId);
    const logins = await Promise.all(
      clientUsers.map((clientUser) => this.authAccounts!.findAuthAccountByClientUserId(clientUser.id))
    );
    await Promise.all(
      logins
        .filter((login): login is NonNullable<typeof login> => Boolean(login))
        .map((login) => this.authAccounts!.updateAuthAccountStatus(login.id, status))
    );
  }

  private async ensureClientUserLoginAccount(
    clientUser: ClientUserRecord,
    request: BusinessUserRequestRecord
  ): Promise<BusinessUserLoginCredential | undefined> {
    if (!this.authAccounts) {
      return undefined;
    }

    const existing = await this.authAccounts.findAuthAccountByClientUserId(clientUser.id);
    if (existing) {
      throw new HttpError(
        409,
        "selected customer salesperson profile already has a login account; keep the request pending for explicit review."
      );
    }

    if (request.requestedUsername && request.requestedPasswordHash) {
      await this.requireAvailableUsername(request.requestedUsername);
      const input: AuthAccountCreateInput = {
        username: request.requestedUsername,
        displayName: request.businessUserName,
        role: ROLES.clientBusinessUser,
        status: "active",
        passwordHash: request.requestedPasswordHash,
        customerId: request.customerId,
        clientUserId: clientUser.id,
        clientAccessScope: CLIENT_ACCESS_SCOPES.own
      };
      const account = await this.authAccounts.createAuthAccount(input);
      await this.repository.updateClientUser(clientUser.id, { accountId: account.id, status: "active" });
      return undefined;
    }

    const username = await this.uniqueUsername(request.contact);
    const temporaryPassword = createTemporaryPassword();
    const input: AuthAccountCreateInput = {
      username,
      displayName: request.businessUserName,
      role: ROLES.clientBusinessUser,
      status: "active",
      passwordHash: hashPassword(temporaryPassword),
      customerId: request.customerId,
      clientUserId: clientUser.id,
      clientAccessScope: CLIENT_ACCESS_SCOPES.own,
      mustChangePasswordAtNextLogin: true,
      lastPasswordResetAt: new Date().toISOString()
    };
    const account = await this.authAccounts.createAuthAccount(input);
    await this.repository.updateClientUser(clientUser.id, { accountId: account.id, status: "active" });
    return {
      username: account.username,
      temporaryPassword
    };
  }

  async reviewRequest(
    currentUser: CurrentUser,
    id: string,
    payload: ReviewBusinessUserRequestPayload
  ): Promise<BusinessUserRequestReviewResult> {
    if (!canReviewBusinessUserRequest(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }

    const request = await this.findRequest(id);
    const status = normalizeReviewStatus(payload.status);

    if (request.status !== "pending") {
      if (request.status === status) {
        return { request: publicBusinessUserRequest(request) };
      }

      throw new HttpError(409, "business user request has already been reviewed.");
    }

    const approvedClientUser =
      status === "approved"
        ? await this.resolveApprovedClientUser(request, payload.targetClientUserId)
        : undefined;
    const loginCredential = approvedClientUser
      ? await this.ensureClientUserLoginAccount(approvedClientUser, request)
      : undefined;

    const updated = await this.repository.updateBusinessUserRequest(request.id, {
      status,
      reviewedBy: currentUser.id,
      reviewedByRole: currentUser.role,
      ...(approvedClientUser ? { createdClientUserId: approvedClientUser.id } : {}),
      reviewNote:
        optionalText(payload.reviewNote) ??
        (status === "approved"
          ? "Approved and created or linked an active own-scope client business user login account."
          : "Rejected. No business user account was created.")
    });

    return {
      request: publicBusinessUserRequest(updated),
      ...(loginCredential ? { loginCredential } : {})
    };
  }

  async listCustomerAccounts(currentUser: CurrentUser): Promise<CustomerAccountSummary[]> {
    if (!canReviewBusinessUserRequest(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }

    const [customers, orders] = await Promise.all([
      this.repository.listCustomers(),
      this.repository.listOrders()
    ]);
    const orderCounts = new Map<string, number>();
    for (const order of orders) {
      orderCounts.set(order.clientUserId, (orderCounts.get(order.clientUserId) ?? 0) + 1);
    }
    const summaries = await Promise.all(
      customers.map((customer) => this.customerAccountSummary(customer))
    );
    return summaries.map((customer) => ({
      ...customer,
      clientUsers: customer.clientUsers.map((clientUser) => ({
        ...clientUser,
        historicalOrderCount: orderCounts.get(clientUser.id) ?? 0
      }))
    }));
  }

  private requireCustomerManager(currentUser: CurrentUser) {
    if (!canReviewBusinessUserRequest(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }
  }

  private async findCustomerOrThrow(customerId: string) {
    const customer = await this.repository.findCustomerById(customerId);
    if (!customer) {
      throw new HttpError(404, "customer not found.");
    }
    return customer;
  }

  private async validateNewCustomerName(customerName: string) {
    const duplicate = (await this.repository.listCustomers())
      .find((customer) => normalizedBusinessKey(customer.name) === normalizedBusinessKey(customerName));
    if (duplicate) {
      throw new HttpError(409, "customer name already exists.");
    }
  }

  async createCustomer(
    currentUser: CurrentUser,
    payload: CreateCustomerPayload
  ): Promise<CustomerAccountSummary> {
    this.requireCustomerManager(currentUser);
    const customerName = requireText(payload.customerName, "customerName");
    await this.validateNewCustomerName(customerName);
    const customer = await this.repository.createCustomer({
      name: customerName,
      status: "active"
    });
    return this.customerAccountSummary(customer);
  }

  private normalizeBulkRows(payload: unknown) {
    const rows = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as { rows?: unknown }).rows
      : undefined;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 200) {
      throw new HttpError(400, "rows must contain between 1 and 200 items.");
    }
    return rows;
  }

  async previewBulkCustomers(currentUser: CurrentUser, payload: unknown) {
    this.requireCustomerManager(currentUser);
    const rows = this.normalizeBulkRows(payload);
    const existingNames = new Set(
      (await this.repository.listCustomers()).map((customer) => normalizedBusinessKey(customer.name))
    );
    const batchNames = new Set<string>();

    return rows.map((row, index): BulkRowResult<{ customerName: string }> => {
      try {
        const customerName = requireText(
          typeof row === "object" && row !== null ? (row as { customerName?: unknown }).customerName : undefined,
          "customerName"
        );
        const key = normalizedBusinessKey(customerName);
        if (existingNames.has(key) || batchNames.has(key)) {
          throw new HttpError(409, "duplicate customer name.");
        }
        batchNames.add(key);
        return { index, status: "valid", data: { customerName } };
      } catch (error) {
        return {
          index,
          status: "failed",
          error: error instanceof Error ? error.message : "invalid customer row."
        };
      }
    });
  }

  async bulkCreateCustomers(currentUser: CurrentUser, payload: unknown) {
    const preview = await this.previewBulkCustomers(currentUser, payload);
    const results: BulkRowResult<CustomerAccountSummary>[] = [];
    for (const row of preview) {
      if (row.status === "failed" || !row.data) {
        results.push({ index: row.index, status: "failed", error: row.error });
        continue;
      }
      try {
        const customer = await this.createCustomer(currentUser, row.data);
        results.push({ index: row.index, status: "created", data: customer });
      } catch (error) {
        results.push({
          index: row.index,
          status: "failed",
          error: error instanceof Error ? error.message : "customer creation failed."
        });
      }
    }
    return results;
  }

  private async validateNewClientUser(customerId: string, displayName: string, contact?: string) {
    const profiles = await this.repository.listClientUsersByCustomerId(customerId);
    const normalizedContact = contact?.trim().toLowerCase();
    const duplicate = profiles.find((profile) =>
      normalizedContact
        ? profile.contact?.trim().toLowerCase() === normalizedContact
        : normalizedBusinessKey(profile.displayName) === normalizedBusinessKey(displayName) &&
          !profile.contact
    );
    if (duplicate) {
      throw new HttpError(409, "customer salesperson profile already exists.");
    }
  }

  async createClientUserProfile(
    currentUser: CurrentUser,
    customerId: string,
    payload: CreateClientUserProfilePayload
  ): Promise<ClientUserAccountSummary> {
    this.requireCustomerManager(currentUser);
    const customer = await this.findCustomerOrThrow(customerId);
    if (customer.status !== "active") {
      throw new HttpError(409, "cannot add a salesperson to an inactive customer.");
    }
    const displayName = requireText(payload.displayName, "displayName");
    const contact = optionalText(payload.contact);
    await this.validateNewClientUser(customer.id, displayName, contact);
    const profile = await this.repository.createClientUser({
      customerId: customer.id,
      displayName,
      ...(contact ? { contact } : {}),
      status: "active",
      clientAccessScope: CLIENT_ACCESS_SCOPES.own
    });
    return this.clientUserSummary(profile);
  }

  async previewBulkClientUsers(currentUser: CurrentUser, customerId: string, payload: unknown) {
    this.requireCustomerManager(currentUser);
    await this.findCustomerOrThrow(customerId);
    const rows = this.normalizeBulkRows(payload);
    const existing = await this.repository.listClientUsersByCustomerId(customerId);
    const existingContacts = new Set(
      existing.map((profile) => profile.contact?.trim().toLowerCase()).filter(Boolean)
    );
    const existingNamesWithoutContact = new Set(
      existing.filter((profile) => !profile.contact).map((profile) => normalizedBusinessKey(profile.displayName))
    );
    const batchKeys = new Set<string>();

    return rows.map((row, index): BulkRowResult<{ displayName: string; contact?: string }> => {
      try {
        const objectRow = typeof row === "object" && row !== null ? row as CreateClientUserProfilePayload : {};
        const displayName = requireText(objectRow.displayName, "displayName");
        const contact = optionalText(objectRow.contact);
        const key = contact ? `contact:${contact.toLowerCase()}` : `name:${normalizedBusinessKey(displayName)}`;
        if (
          batchKeys.has(key) ||
          (contact ? existingContacts.has(contact.toLowerCase()) : existingNamesWithoutContact.has(normalizedBusinessKey(displayName)))
        ) {
          throw new HttpError(409, "duplicate customer salesperson profile.");
        }
        batchKeys.add(key);
        return { index, status: "valid", data: { displayName, ...(contact ? { contact } : {}) } };
      } catch (error) {
        return {
          index,
          status: "failed",
          error: error instanceof Error ? error.message : "invalid salesperson row."
        };
      }
    });
  }

  async bulkCreateClientUsers(currentUser: CurrentUser, customerId: string, payload: unknown) {
    const preview = await this.previewBulkClientUsers(currentUser, customerId, payload);
    const results: BulkRowResult<ClientUserAccountSummary>[] = [];
    for (const row of preview) {
      if (row.status === "failed" || !row.data) {
        results.push({ index: row.index, status: "failed", error: row.error });
        continue;
      }
      try {
        const profile = await this.createClientUserProfile(currentUser, customerId, row.data);
        results.push({ index: row.index, status: "created", data: profile });
      } catch (error) {
        results.push({
          index: row.index,
          status: "failed",
          error: error instanceof Error ? error.message : "salesperson creation failed."
        });
      }
    }
    return results;
  }

  async createClientUserLogin(
    currentUser: CurrentUser,
    clientUserId: string,
    payload: CreateClientUserLoginPayload
  ): Promise<{ clientUser: ClientUserAccountSummary; loginCredential: BusinessUserLoginCredential }> {
    this.requireCustomerManager(currentUser);
    if (!this.authAccounts) {
      throw new HttpError(503, "account repository unavailable.");
    }
    const profile = await this.findClientUserOrThrow(clientUserId);
    const customer = await this.findCustomerOrThrow(profile.customerId);
    if (await this.authAccounts.findAuthAccountByClientUserId(profile.id)) {
      throw new HttpError(409, "customer salesperson already has a login account.");
    }
    const username = normalizeUsername(payload.username);
    const password = optionalText(payload.password) ?? createTemporaryPassword();
    const role = normalizeClientRole(payload.role);
    const scope = scopeForClientRole(role);
    requirePassword(password);
    await this.requireAvailableUsername(username);
    await this.authAccounts.createAuthAccount({
      username,
      displayName: profile.displayName,
      role,
      status: customer.status === "active" && profile.status === "active" ? "active" : "disabled",
      passwordHash: hashPassword(password),
      customerId: customer.id,
      clientUserId: profile.id,
      clientAccessScope: scope,
      mustChangePasswordAtNextLogin: true,
      lastPasswordResetAt: new Date().toISOString()
    });
    const updated = await this.findClientUserOrThrow(profile.id);
    return {
      clientUser: await this.clientUserSummary(updated),
      loginCredential: { username, temporaryPassword: password }
    };
  }

  async updateClientUserLoginRole(
    currentUser: CurrentUser,
    clientUserId: string,
    payload: UpdateClientUserLoginRolePayload
  ) {
    this.requireCustomerManager(currentUser);
    if (!this.authAccounts) throw new HttpError(503, "account repository unavailable.");
    const profile = await this.findClientUserOrThrow(clientUserId);
    const login = await this.authAccounts.findAuthAccountByClientUserId(profile.id);
    if (!login) throw new HttpError(409, "customer salesperson has no login account.");
    const role = normalizeClientRole(payload.role);
    const scope = scopeForClientRole(role);
    await this.repository.updateClientUser(profile.id, { clientAccessScope: scope });
    await this.authAccounts.updateAuthAccount(login.id, { role, clientAccessScope: scope });
    return this.clientUserSummary(await this.findClientUserOrThrow(profile.id));
  }

  async updateClientUserLoginStatus(
    currentUser: CurrentUser,
    clientUserId: string,
    payload: AccountStatusPayload
  ) {
    this.requireCustomerManager(currentUser);
    if (!this.authAccounts) throw new HttpError(503, "account repository unavailable.");
    const profile = await this.findClientUserOrThrow(clientUserId);
    const login = await this.authAccounts.findAuthAccountByClientUserId(profile.id);
    if (!login) throw new HttpError(409, "customer salesperson has no login account.");
    const status = normalizeRecordStatus(payload.status);

    if (status === "active") {
      await this.authAccounts.updateAuthAccountStatus(login.id, "active");
      const customer = await this.findCustomerOrThrow(profile.customerId);
      if (customer.status !== "active") {
        await this.repository.updateCustomer(customer.id, { status: "active" });
      }
    } else {
      await this.authAccounts.updateAuthAccountStatus(login.id, "disabled");
    }

    return this.clientUserSummary(profile);
  }

  async updateCustomerStatus(
    currentUser: CurrentUser,
    customerId: string,
    payload: AccountStatusPayload
  ): Promise<CustomerAccountSummary> {
    if (!canReviewBusinessUserRequest(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }

    const status = normalizeRecordStatus(payload.status);
    const existing = await this.findCustomerOrThrow(customerId);
    let customer: CustomerRecord;

    if (status === "archived") {
      customer = await this.repository.updateCustomer(existing.id, {
        status,
        ...archivedMetadata(status, currentUser)
      });
      await this.updateCustomerLoginStatuses(existing.id, "disabled");
    } else {
      await this.updateCustomerLoginStatuses(existing.id, "active");
      customer = await this.repository.updateCustomer(existing.id, { status });
    }

    return this.customerAccountSummary(customer);
  }

  async updateCustomerAccount(
    currentUser: CurrentUser,
    customerId: string,
    payload: UpdateCustomerAccountPayload
  ): Promise<CustomerAccountSummary> {
    if (!canReviewBusinessUserRequest(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }

    const name = requireText(payload.name, "name");
    const customer = await this.repository.updateCustomer(customerId, { name });
    return this.customerAccountSummary(customer);
  }

  private async updateClientUserAccountCore(
    existing: ClientUserRecord,
    payload: UpdateClientUserAccountPayload
  ): Promise<ClientUserAccountSummary> {
    const patch: Partial<Pick<ClientUserRecord, "displayName" | "contact">> = {};
    if (payload.displayName !== undefined) {
      patch.displayName = requireText(payload.displayName, "displayName");
    }
    if (payload.contact !== undefined) {
      patch.contact = typeof payload.contact === "string" ? payload.contact.trim() : "";
    }

    const updated =
      Object.keys(patch).length > 0
        ? await this.repository.updateClientUser(existing.id, patch)
        : existing;

    const login = this.authAccounts
      ? await this.authAccounts.findAuthAccountByClientUserId(updated.id)
      : undefined;
    const loginPatch: {
      username?: string;
      displayName?: string;
      role?: Role;
      clientAccessScope?: ClientUserRecord["clientAccessScope"];
    } = {};

    if (payload.username !== undefined) {
      if (!login) {
        throw new HttpError(409, "client user login account is not created.");
      }
      const username = normalizeUsername(payload.username);
      await this.requireAvailableUsernameForAccount(username, login.id);
      loginPatch.username = username;
    }

    if (login && patch.displayName !== undefined) {
      loginPatch.displayName = updated.displayName;
    }
    if (login) {
      loginPatch.role = roleForClientScope(updated.clientAccessScope);
      loginPatch.clientAccessScope = updated.clientAccessScope;
    }

    if (login && Object.keys(loginPatch).length > 0) {
      await this.authAccounts!.updateAuthAccount(login.id, {
        ...loginPatch
      });
    }

    return this.clientUserSummary(updated);
  }

  async updateClientUserAccount(
    currentUser: CurrentUser,
    clientUserId: string,
    payload: UpdateClientUserAccountPayload
  ): Promise<ClientUserAccountSummary> {
    if (!canReviewBusinessUserRequest(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }

    const existing = await this.findClientUserOrThrow(clientUserId);
    if (payload.clientAccessScope !== undefined) {
      const nextScope = normalizeClientAccessScope(payload.clientAccessScope);
      if (nextScope !== existing.clientAccessScope) {
        throw new HttpError(409, "client user access scope cannot be changed here.");
      }
    }

    return this.updateClientUserAccountCore(existing, payload);
  }

  private async resetClientUserPasswordCore(
    clientUser: ClientUserRecord,
    payload: ResetClientUserPasswordPayload
  ): Promise<{ clientUser: ClientUserAccountSummary; loginCredential?: BusinessUserLoginCredential }> {
    const password = optionalText(payload.password) ?? createTemporaryPassword();
    requirePassword(password);
    if (!this.authAccounts) throw new HttpError(503, "account repository unavailable.");
    const login = await this.authAccounts.findAuthAccountByClientUserId(clientUser.id);
    if (!login) {
      throw new HttpError(409, "customer salesperson has no login account.");
    }
    const updatedLogin = await this.authAccounts.updateAuthAccount(login.id, {
      displayName: clientUser.displayName,
      passwordHash: hashPassword(password),
      clientAccessScope: clientUser.clientAccessScope,
      mustChangePasswordAtNextLogin: true,
      lastPasswordResetAt: new Date().toISOString()
    });
    const summary = await this.clientUserSummary(clientUser);
    return {
      clientUser: summary,
      loginCredential: { username: updatedLogin.username, temporaryPassword: password }
    };
  }

  async resetClientUserPassword(
    currentUser: CurrentUser,
    clientUserId: string,
    payload: ResetClientUserPasswordPayload
  ): Promise<{ clientUser: ClientUserAccountSummary; loginCredential?: BusinessUserLoginCredential }> {
    if (!canReviewBusinessUserRequest(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }

    const clientUser = await this.findClientUserOrThrow(clientUserId);
    return this.resetClientUserPasswordCore(clientUser, payload);
  }

  async listClientManagedBusinessUsers(currentUser: CurrentUser): Promise<ClientUserAccountSummary[]> {
    const { customer } = await this.requireCustomerAdminBinding(currentUser);
    const clientUsers = await this.repository.listClientUsersByCustomerId(customer.id);
    const accounts = await Promise.all(
      clientUsers.map((clientUser) => this.clientUserSummary(clientUser))
    );
    return this.sortClientUsers(accounts);
  }

  private async requireManagedOwnScopeBusinessUser(
    currentUser: CurrentUser,
    clientUserId: string
  ): Promise<ClientUserRecord> {
    const { customer, clientUser: supervisor } = await this.requireCustomerAdminBinding(currentUser);
    const target = await this.findClientUserOrThrow(clientUserId);
    if (target.customerId !== customer.id) {
      throw new HttpError(403, "cannot manage business users from another customer.");
    }
    if (target.id === supervisor.id) {
      throw new HttpError(409, "customer supervisor cannot manage their own login account here.");
    }
    if (this.isSupervisor(target)) {
      throw new HttpError(409, "customer supervisor account cannot be managed here.");
    }

    return target;
  }

  async updateClientManagedBusinessUserAccount(
    currentUser: CurrentUser,
    clientUserId: string,
    payload: UpdateClientUserAccountPayload
  ): Promise<ClientUserAccountSummary> {
    const target = await this.requireManagedOwnScopeBusinessUser(currentUser, clientUserId);
    if (payload.clientAccessScope !== undefined) {
      const nextScope = normalizeClientAccessScope(payload.clientAccessScope);
      if (nextScope !== CLIENT_ACCESS_SCOPES.own) {
        throw new HttpError(409, "customer supervisor cannot change business user role.");
      }
    }

    return this.updateClientUserAccountCore(target, payload);
  }

  async resetClientManagedBusinessUserPassword(
    currentUser: CurrentUser,
    clientUserId: string,
    payload: ResetClientUserPasswordPayload
  ): Promise<{ clientUser: ClientUserAccountSummary; loginCredential?: BusinessUserLoginCredential }> {
    const target = await this.requireManagedOwnScopeBusinessUser(currentUser, clientUserId);
    return this.resetClientUserPasswordCore(target, payload);
  }

  async updateClientManagedBusinessUserStatus(
    currentUser: CurrentUser,
    clientUserId: string,
    payload: AccountStatusPayload
  ): Promise<ClientUserAccountSummary> {
    await this.requireCustomerAdminBinding(currentUser);
    const target = await this.requireManagedOwnScopeBusinessUser(currentUser, clientUserId);

    const status = normalizeRecordStatus(payload.status);
    const updated = await this.repository.updateClientUser(target.id, {
      status,
      ...archivedMetadata(status, currentUser)
    });
    return this.clientUserSummary(updated);
  }

  async updateClientUserStatus(
    currentUser: CurrentUser,
    clientUserId: string,
    payload: AccountStatusPayload
  ): Promise<ClientUserAccountSummary> {
    if (!canReviewBusinessUserRequest(currentUser).allowed) {
      throw new HttpError(403, "forbidden");
    }

    const status = normalizeRecordStatus(payload.status);
    const clientUser = await this.repository.updateClientUser(clientUserId, {
      status,
      ...archivedMetadata(status, currentUser)
    });
    return this.clientUserSummary(clientUser);
  }
}
