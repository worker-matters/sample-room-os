import { ROLES, type Role } from "@sample-room/shared";
import type { AuthAccountRepository } from "../../db/repositories/authAccountRepository.js";
import type { OperationLogRepository } from "../../db/repositories/contracts/index.js";
import type { AuthAccountRecord, AuthAccountStatus } from "../auth/authTypes.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { createTemporaryPassword, hashPassword } from "../auth/password.js";
import { HttpError } from "../../shared/errors/httpError.js";

const MANAGED_INTERNAL_ROLES = new Set<Role>([
  ROLES.receiver,
  ROLES.planner,
  ROLES.patternMaker,
  ROLES.boss
]);

const CREATABLE_INTERNAL_ROLES = new Set<Role>([
  ROLES.boss,
  ROLES.receiver,
  ROLES.planner,
  ROLES.patternMaker
]);

export type InternalAccountSummary = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  status: AuthAccountStatus;
};

type UpdateInternalAccountPayload = {
  username?: unknown;
  displayName?: unknown;
  status?: unknown;
  password?: unknown;
};

type CreateInternalAccountPayload = {
  username?: unknown;
  displayName?: unknown;
  role?: unknown;
  password?: unknown;
};

type ResetPasswordPayload = {
  password?: unknown;
};

function requireAccountManager(currentUser: CurrentUser) {
  if (currentUser.role !== ROLES.boss && currentUser.role !== ROLES.systemOwner) {
    throw new HttpError(403, "forbidden");
  }
}

function toSummary(account: AuthAccountRecord): InternalAccountSummary {
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    status: account.status
  };
}

function optionalTrimmedText(value: unknown, field: string) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${field} must be a non-empty string.`);
  }

  return value.trim();
}

function optionalAccountStatus(value: unknown): AuthAccountStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "active" || value === "disabled") {
    return value;
  }

  throw new HttpError(400, "status must be active or disabled.");
}

function requireCreatableInternalRole(currentUser: CurrentUser, value: unknown): Role {
  if (typeof value !== "string" || !CREATABLE_INTERNAL_ROLES.has(value as Role)) {
    throw new HttpError(400, "role must be boss, receiver, planner, or pattern_maker.");
  }

  if (value === ROLES.boss && currentUser.role !== ROLES.systemOwner) {
    throw new HttpError(403, "forbidden");
  }

  return value as Role;
}

function normalizePassword(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.length < 8) {
    throw new HttpError(400, "password must be at least 8 characters.");
  }

  return value;
}

export class InternalAccountService {
  constructor(
    private readonly accounts: AuthAccountRepository,
    private readonly operationLogs: OperationLogRepository
  ) {}

  private async appendAuditLog(
    currentUser: CurrentUser,
    action: string,
    targetId: string,
    before: InternalAccountSummary | undefined,
    after: InternalAccountSummary
  ) {
    await this.operationLogs.appendOperationLog({
      actorId: currentUser.accountId ?? currentUser.id,
      actorRole: currentUser.role,
      action,
      targetType: "Account",
      targetId,
      ...(before ? { before } : {}),
      after
    });
  }

  private async listManagedAccounts() {
    const accounts = await this.accounts.listAuthAccounts();
    return accounts
      .filter((account) => MANAGED_INTERNAL_ROLES.has(account.role))
      .sort((left, right) =>
        `${left.role}:${left.username}`.localeCompare(`${right.role}:${right.username}`)
      );
  }

  private async findManagedAccount(id: string) {
    const account = (await this.listManagedAccounts()).find((candidate) => candidate.id === id);
    if (!account) {
      throw new HttpError(404, "internal account not found.");
    }

    return account;
  }

  async listInternalAccounts(currentUser: CurrentUser): Promise<InternalAccountSummary[]> {
    requireAccountManager(currentUser);
    return (await this.listManagedAccounts()).map(toSummary);
  }

  async createInternalAccount(
    currentUser: CurrentUser,
    payload: CreateInternalAccountPayload
  ): Promise<{ account: InternalAccountSummary; temporaryPassword: string }> {
    requireAccountManager(currentUser);

    const username = optionalTrimmedText(payload.username, "username");
    const displayName = optionalTrimmedText(payload.displayName, "displayName");
    const role = requireCreatableInternalRole(currentUser, payload.role);
    const password = normalizePassword(payload.password) ?? createTemporaryPassword();

    if (!username || !displayName) {
      throw new HttpError(400, "username and displayName are required.");
    }

    const duplicate = await this.accounts.findAuthAccountByUsername(username.toLowerCase());
    if (duplicate) {
      throw new HttpError(409, "username already exists.");
    }

    const created = await this.accounts.createAuthAccount({
      username,
      displayName,
      role,
      status: "active",
      passwordHash: hashPassword(password),
      mustChangePasswordAtNextLogin: true,
      lastPasswordResetAt: new Date().toISOString()
    });
    const summary = toSummary(created);
    await this.appendAuditLog(currentUser, "internal_account_created", created.id, undefined, summary);

    return {
      account: summary,
      temporaryPassword: password
    };
  }

  async updateInternalAccount(
    currentUser: CurrentUser,
    id: string,
    payload: UpdateInternalAccountPayload
  ): Promise<InternalAccountSummary> {
    requireAccountManager(currentUser);
    const existing = await this.findManagedAccount(id);

    const username = optionalTrimmedText(payload.username, "username");
    const displayName = optionalTrimmedText(payload.displayName, "displayName");
    const status = optionalAccountStatus(payload.status);
    const password = normalizePassword(payload.password);

    if (username) {
      const duplicate = await this.accounts.findAuthAccountByUsername(username.toLowerCase());
      if (duplicate && duplicate.id !== id) {
        throw new HttpError(409, "username already exists.");
      }
    }

    const updated = await this.accounts.updateAuthAccount(id, {
      ...(username !== undefined ? { username } : {}),
      ...(displayName !== undefined ? { displayName } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(password !== undefined
        ? {
            passwordHash: hashPassword(password),
            lastPasswordResetAt: new Date().toISOString()
          }
        : {})
    });
    const summary = toSummary(updated);

    if (username !== undefined || displayName !== undefined) {
      await this.appendAuditLog(currentUser, "internal_account_profile_updated", id, toSummary(existing), summary);
    }
    if (status !== undefined && status !== existing.status) {
      await this.appendAuditLog(
        currentUser,
        status === "active" ? "internal_account_enabled" : "internal_account_disabled",
        id,
        toSummary(existing),
        summary
      );
    }
    if (password !== undefined) {
      await this.appendAuditLog(currentUser, "internal_account_password_reset", id, toSummary(existing), summary);
    }

    return summary;
  }

  async resetInternalAccountPassword(
    currentUser: CurrentUser,
    id: string,
    payload: ResetPasswordPayload
  ): Promise<{ account: InternalAccountSummary; temporaryPassword: string }> {
    requireAccountManager(currentUser);
    const existing = await this.findManagedAccount(id);

    const password = normalizePassword(payload.password) ?? createTemporaryPassword();
    const updated = await this.accounts.updateAuthAccount(id, {
      passwordHash: hashPassword(password),
      status: "active",
      lastPasswordResetAt: new Date().toISOString()
    });
    const summary = toSummary(updated);
    await this.appendAuditLog(currentUser, "internal_account_password_reset", id, toSummary(existing), summary);
    if (existing.status !== "active") {
      await this.appendAuditLog(currentUser, "internal_account_enabled", id, toSummary(existing), summary);
    }

    return {
      account: summary,
      temporaryPassword: password
    };
  }
}
