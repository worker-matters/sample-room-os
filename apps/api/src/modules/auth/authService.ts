import { randomBytes } from "node:crypto";
import {
  ACCOUNT_CLIENT_TYPES,
  ROLES,
  isClientRole,
  type AccountClientType,
  type Role
} from "@sample-room/shared";
import type {
  AccountRecord,
  AccountRepository,
  AccountSessionRepository,
  WorkerProfileRepository
} from "../../db/repositories/contracts/index.js";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "./currentUser.js";
import type { LoginResult } from "./authTypes.js";
import { toAuthenticatedUserDto } from "./authTypes.js";
import { verifyPassword, verifyPasswordAgainstDummyHash } from "./password.js";
import { hashSessionToken } from "./sessionStore.js";

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ANDROID_BIOMETRIC_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type LoginInput = {
  username?: unknown;
  phoneNumber?: unknown;
  password?: unknown;
  clientType?: unknown;
};

type SessionMetadata = {
  userAgent?: string | undefined;
  appVersion?: string | undefined;
};

export type LoginRejectionReason =
  | "invalid_credentials"
  | "password_mismatch"
  | "account_inactive";

export class LoginRejectedError extends HttpError {
  constructor(
    public readonly reason: LoginRejectionReason,
    public readonly accountId?: string,
    public readonly accountRole?: Role
  ) {
    super(401, "invalid_credentials");
    this.name = "LoginRejectedError";
  }
}

const normalizedText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

function parseClientType(value: unknown): AccountClientType {
  if (value === undefined || value === null || value === "") return ACCOUNT_CLIENT_TYPES.web;
  if (Object.values(ACCOUNT_CLIENT_TYPES).includes(value as AccountClientType)) {
    return value as AccountClientType;
  }
  throw new HttpError(400, "invalid_client_type");
}

export function accountHomeRoute(role: Role) {
  switch (role) {
    case ROLES.systemOwner: return "/system-owner";
    case ROLES.boss: return "/boss";
    case ROLES.receiver: return "/receiver/home";
    case ROLES.planner: return "/planner/home";
    case ROLES.patternMaker: return "/pattern-maker";
    case ROLES.clientAdmin:
    case ROLES.clientBusinessUser: return "/client/home";
    case ROLES.worker: return "/worker/scan";
  }
}

export class FormalAuthService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly workerProfiles: WorkerProfileRepository,
    private readonly sessions: AccountSessionRepository,
    private readonly repository: SampleRoomRepository,
    private readonly sessionTtlMs = DEFAULT_SESSION_TTL_MS
  ) {}

  private async currentUserForAccount(account: AccountRecord): Promise<CurrentUser> {
    const activeWorkerProfile = account.accountType === "worker"
      ? await this.workerProfiles.findActiveWorkerProfileByAccountId(account.id)
      : undefined;
    const clientUser = isClientRole(account.role)
      ? await this.repository.findClientUserByAccountId(account.id)
      : undefined;

    if (account.role === ROLES.worker && (!activeWorkerProfile || account.accountType !== "worker")) {
      throw new HttpError(403, "worker account is missing an active WorkerProfile.");
    }

    if (isClientRole(account.role)) {
      const customer = clientUser
        ? await this.repository.findCustomerById(clientUser.customerId)
        : undefined;
      const expectedScope = account.role === ROLES.clientAdmin ? "customer_all" : "own";
      if (
        !clientUser || clientUser.status !== "active" ||
        !customer || customer.status !== "active" ||
        clientUser.clientAccessScope !== expectedScope
      ) {
        throw new HttpError(403, "client account is missing an active customer binding.");
      }
    }

    return {
      id: account.id,
      accountId: account.id,
      accountType: account.accountType,
      role: account.role,
      homeRoute: accountHomeRoute(account.role),
      displayName: account.displayName,
      ...(account.phoneNumber ? { phoneNumber: account.phoneNumber } : {}),
      ...(activeWorkerProfile ? { activeWorkerProfileId: activeWorkerProfile.id } : {}),
      ...(activeWorkerProfile ? { activeWorkerType: activeWorkerProfile.workerType } : {}),
      ...(clientUser
        ? {
            customerId: clientUser.customerId,
            clientUserId: clientUser.id,
            clientAccessScope: clientUser.clientAccessScope
          }
        : {}),
      mustChangePassword: account.mustChangePasswordAtNextLogin
    };
  }

  private async accountForLogin(input: LoginInput, password: string) {
    const username = normalizedText(input.username).toLowerCase();
    const phoneNumber = normalizedText(input.phoneNumber);
    if ((username && phoneNumber) || (!username && !phoneNumber)) {
      throw new LoginRejectedError("invalid_credentials");
    }
    const account = username
      ? await this.accounts.findAccountByUsername(username)
      : await this.accounts.findAccountByPhoneNumber(phoneNumber, "worker");
    if (
      !account ||
      (username && account.accountType !== "business") ||
      (phoneNumber && account.accountType !== "worker")
    ) {
      verifyPasswordAgainstDummyHash(password);
      throw new LoginRejectedError("invalid_credentials");
    }
    return account;
  }

  async login(input: LoginInput, metadata: SessionMetadata = {}): Promise<LoginResult> {
    const password = typeof input.password === "string" ? input.password : "";
    if (!password) throw new LoginRejectedError("invalid_credentials");
    const clientType = parseClientType(input.clientType);
    const account = await this.accountForLogin(input, password);
    if (account.status !== "active") {
      verifyPasswordAgainstDummyHash(password);
      throw new LoginRejectedError("account_inactive", account.id, account.role);
    }
    if (!verifyPassword(password, account.passwordHash)) {
      throw new LoginRejectedError("password_mismatch", account.id, account.role);
    }

    const currentUser = await this.currentUserForAccount(account);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.sessionTtlMs).toISOString();
    await this.sessions.createAccountSession({
      accountId: account.id,
      sessionTokenHash: hashSessionToken(token),
      clientType,
      deviceIdHash: null,
      deviceLabel: null,
      userAgent: metadata.userAgent ?? null,
      appVersion: metadata.appVersion ?? null,
      expiresAt
    });
    await this.accounts.updateAccount(account.id, { lastLoginAt: new Date().toISOString() });
    return { token, expiresAt, clientType, user: toAuthenticatedUserDto(currentUser) };
  }

  async authenticate(token: string | undefined): Promise<CurrentUser | undefined> {
    if (!token) return undefined;
    const session = await this.sessions.findAccountSessionByTokenHash(hashSessionToken(token));
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) return undefined;
    const account = await this.accounts.findAccountById(session.accountId);
    if (!account || account.status !== "active") return undefined;
    try {
      const currentUser = await this.currentUserForAccount(account);
      await this.sessions.updateAccountSession(session.id, { lastSeenAt: new Date().toISOString() });
      return { ...currentUser, sessionClientType: session.clientType };
    } catch {
      return undefined;
    }
  }

  async verifyCurrentPassword(currentUser: CurrentUser, password: string) {
    if (!password) return false;
    const accountId = currentUser.accountId ?? currentUser.id;
    const account = await this.accounts.findAccountById(accountId);
    return Boolean(account && account.status === "active" && verifyPassword(password, account.passwordHash));
  }

  async refresh(token: string | undefined): Promise<LoginResult> {
    if (!token) throw new HttpError(401, "unauthenticated");
    const session = await this.sessions.findAccountSessionByTokenHash(hashSessionToken(token));
    const currentUser = await this.authenticate(token);
    if (!session || !currentUser) throw new HttpError(401, "unauthenticated");
    const expiresAt = new Date(Date.now() + this.sessionTtlMs).toISOString();
    await this.sessions.updateAccountSession(session.id, {
      expiresAt,
      lastSeenAt: new Date().toISOString()
    });
    return {
      token,
      expiresAt,
      clientType: session.clientType,
      user: toAuthenticatedUserDto(currentUser)
    };
  }

  async refreshAndroidBiometricSession(token: string | undefined): Promise<LoginResult> {
    if (!token) throw new HttpError(401, "unauthenticated");
    const session = await this.sessions.findAccountSessionByTokenHash(hashSessionToken(token));
    const currentUser = await this.authenticate(token);
    if (!session || !currentUser) throw new HttpError(401, "unauthenticated");
    if (session.clientType !== ACCOUNT_CLIENT_TYPES.android) {
      throw new HttpError(403, "android_session_required");
    }
    const account = await this.accounts.findAccountById(session.accountId);
    const passwordResetAt = account?.lastPasswordResetAt
      ? Date.parse(account.lastPasswordResetAt)
      : Number.NaN;
    if (Number.isFinite(passwordResetAt) && passwordResetAt > Date.parse(session.createdAt)) {
      throw new HttpError(401, "unauthenticated");
    }
    const expiresAt = new Date(Date.now() + ANDROID_BIOMETRIC_SESSION_TTL_MS).toISOString();
    await this.sessions.updateAccountSession(session.id, {
      expiresAt,
      lastSeenAt: new Date().toISOString()
    });
    return {
      token,
      expiresAt,
      clientType: session.clientType,
      user: toAuthenticatedUserDto(currentUser)
    };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const session = await this.sessions.findAccountSessionByTokenHash(hashSessionToken(token));
    if (session && !session.revokedAt) {
      await this.sessions.updateAccountSession(session.id, { revokedAt: new Date().toISOString() });
    }
  }
}
