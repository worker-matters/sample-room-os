import type {
  AccountClientType,
  AccountStatus,
  AccountType,
  IdentityQrPurpose,
  Role,
  WorkerProfileStatus,
  WorkerType
} from "@sample-room/shared";

export type AccountRecord = {
  id: string;
  username: string | null;
  phoneNumber: string | null;
  displayName: string;
  accountType: AccountType;
  role: Role;
  status: AccountStatus;
  passwordHash: string;
  mustChangePasswordAtNextLogin: boolean;
  lastPasswordResetAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccountCreateInput = Pick<
  AccountRecord,
  "username" | "phoneNumber" | "displayName" | "accountType" | "role" | "passwordHash"
> & Partial<Pick<AccountRecord, "status" | "mustChangePasswordAtNextLogin" | "lastPasswordResetAt">>;

export type AccountUpdateInput = Partial<
  Pick<
    AccountRecord,
    | "username"
    | "phoneNumber"
    | "displayName"
    | "role"
    | "status"
    | "passwordHash"
    | "mustChangePasswordAtNextLogin"
    | "lastPasswordResetAt"
    | "lastLoginAt"
  >
>;

export type WorkerProfileRecord = {
  id: string;
  accountId: string;
  workerType: WorkerType;
  status: WorkerProfileStatus;
  effectiveAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccountSessionRecord = {
  id: string;
  accountId: string;
  sessionTokenHash: string;
  clientType: AccountClientType;
  deviceIdHash: string | null;
  deviceLabel: string | null;
  userAgent: string | null;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
};

export type IdentityQrTokenRecord = {
  id: string;
  tokenHash: string;
  purpose: IdentityQrPurpose;
  initialRole: Role | null;
  workerType: WorkerType | null;
  issuedByAccountId: string;
  usedByAccountId: string | null;
  revokedByAccountId: string | null;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export interface AccountRepository {
  listAccounts(): Promise<AccountRecord[]>;
  findAccountById(id: string): Promise<AccountRecord | undefined>;
  findAccountByUsername(username: string): Promise<AccountRecord | undefined>;
  findAccountByPhoneNumber(
    phoneNumber: string,
    accountType?: AccountType
  ): Promise<AccountRecord | undefined>;
  createAccount(input: AccountCreateInput): Promise<AccountRecord>;
  updateAccount(id: string, input: AccountUpdateInput): Promise<AccountRecord>;
  findReceiverQrPrintSettings(accountId: string): Promise<Record<string, unknown> | undefined>;
  updateReceiverQrPrintSettings(
    accountId: string,
    settings: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
}

export interface WorkerProfileRepository {
  listWorkerProfiles(): Promise<WorkerProfileRecord[]>;
  listWorkerProfilesByAccountId(accountId: string): Promise<WorkerProfileRecord[]>;
  findWorkerProfileById(id: string): Promise<WorkerProfileRecord | undefined>;
  findActiveWorkerProfileByAccountId(accountId: string): Promise<WorkerProfileRecord | undefined>;
  createWorkerProfile(input: {
    accountId: string;
    workerType: WorkerType;
    status?: WorkerProfileStatus;
    effectiveAt?: string;
  }): Promise<WorkerProfileRecord>;
  updateWorkerProfile(
    id: string,
    input: Partial<Pick<WorkerProfileRecord, "workerType" | "status" | "effectiveAt" | "endedAt">>
  ): Promise<WorkerProfileRecord>;
}

export interface AccountSessionRepository {
  createAccountSession(
    input: Omit<AccountSessionRecord, "id" | "createdAt" | "lastSeenAt" | "revokedAt">
  ): Promise<AccountSessionRecord>;
  findAccountSessionByTokenHash(tokenHash: string): Promise<AccountSessionRecord | undefined>;
  updateAccountSession(
    id: string,
    input: Partial<Pick<AccountSessionRecord, "lastSeenAt" | "expiresAt" | "revokedAt">>
  ): Promise<AccountSessionRecord>;
}

export interface IdentityQrTokenRepository {
  listIdentityQrTokens(): Promise<IdentityQrTokenRecord[]>;
  findIdentityQrTokenById(id: string): Promise<IdentityQrTokenRecord | undefined>;
  createIdentityQrToken(
    input: Omit<IdentityQrTokenRecord, "id" | "createdAt" | "usedAt" | "revokedAt" | "usedByAccountId" | "revokedByAccountId">
  ): Promise<IdentityQrTokenRecord>;
  findIdentityQrTokenByHash(tokenHash: string): Promise<IdentityQrTokenRecord | undefined>;
  consumeIdentityQrToken(id: string, usedByAccountId: string, usedAt: string): Promise<boolean>;
  revokeIdentityQrToken(id: string, revokedByAccountId: string, revokedAt: string): Promise<boolean>;
  updateIdentityQrToken(
    id: string,
    input: Partial<Pick<IdentityQrTokenRecord, "usedAt" | "revokedAt" | "usedByAccountId" | "revokedByAccountId">>
  ): Promise<IdentityQrTokenRecord>;
}

export type IdentityRepositorySet = {
  accounts: AccountRepository;
  workerProfiles: WorkerProfileRepository;
  accountSessions: AccountSessionRepository;
  identityQrTokens: IdentityQrTokenRepository;
};
