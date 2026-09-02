import type { Prisma } from "@prisma/client";
import type {
  AccountCreateInput,
  AccountRecord,
  AccountRepository,
  AccountSessionRecord,
  AccountSessionRepository,
  AccountUpdateInput,
  IdentityQrTokenRecord,
  IdentityQrTokenRepository,
  WorkerProfileRecord,
  WorkerProfileRepository
} from "../contracts/index.js";
type IdentityPrismaClient = Pick<
  Prisma.TransactionClient,
  "account" | "workerProfile" | "accountSession" | "identityQrToken"
>;

const iso = (value: Date | null) => value?.toISOString() ?? null;

function mapAccount(record: Prisma.AccountGetPayload<object>): AccountRecord {
  return {
    id: record.id,
    username: record.username,
    phoneNumber: record.phoneNumber,
    displayName: record.displayName,
    accountType: record.accountType,
    role: record.role,
    status: record.status,
    passwordHash: record.passwordHash,
    mustChangePasswordAtNextLogin: record.mustChangePasswordAtNextLogin,
    lastPasswordResetAt: iso(record.lastPasswordResetAt),
    lastLoginAt: iso(record.lastLoginAt),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function mapWorkerProfile(record: Prisma.WorkerProfileGetPayload<object>): WorkerProfileRecord {
  return { ...record, effectiveAt: record.effectiveAt.toISOString(), endedAt: iso(record.endedAt), createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
}

function mapAccountSession(record: Prisma.AccountSessionGetPayload<object>): AccountSessionRecord {
  return { ...record, createdAt: record.createdAt.toISOString(), lastSeenAt: iso(record.lastSeenAt), expiresAt: record.expiresAt.toISOString(), revokedAt: iso(record.revokedAt) };
}

function mapIdentityQrToken(record: Prisma.IdentityQrTokenGetPayload<object>): IdentityQrTokenRecord {
  return { ...record, expiresAt: record.expiresAt.toISOString(), usedAt: iso(record.usedAt), revokedAt: iso(record.revokedAt), createdAt: record.createdAt.toISOString() };
}

export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly prisma: IdentityPrismaClient) {}
  async listAccounts() { return (await this.prisma.account.findMany({ orderBy: [{ role: "asc" }, { displayName: "asc" }] })).map(mapAccount); }
  async findAccountById(id: string) { const record = await this.prisma.account.findUnique({ where: { id } }); return record ? mapAccount(record) : undefined; }
  async findAccountByUsername(username: string) { const record = await this.prisma.account.findUnique({ where: { username: username.trim().toLowerCase() } }); return record ? mapAccount(record) : undefined; }
  async findAccountByPhoneNumber(phoneNumber: string, accountType?: AccountRecord["accountType"]) { const record = await this.prisma.account.findFirst({ where: { phoneNumber, ...(accountType ? { accountType } : {}) } }); return record ? mapAccount(record) : undefined; }
  async createAccount(input: AccountCreateInput) { const record = await this.prisma.account.create({ data: { ...input, username: input.username?.trim().toLowerCase() ?? null, status: input.status ?? "pending", mustChangePasswordAtNextLogin: input.mustChangePasswordAtNextLogin ?? false, lastPasswordResetAt: input.lastPasswordResetAt ? new Date(input.lastPasswordResetAt) : null } }); return mapAccount(record); }
  async updateAccount(id: string, input: AccountUpdateInput) { const record = await this.prisma.account.update({ where: { id }, data: { ...input, ...(input.username !== undefined ? { username: input.username?.trim().toLowerCase() ?? null } : {}), ...(input.lastPasswordResetAt !== undefined ? { lastPasswordResetAt: input.lastPasswordResetAt ? new Date(input.lastPasswordResetAt) : null } : {}), ...(input.lastLoginAt !== undefined ? { lastLoginAt: input.lastLoginAt ? new Date(input.lastLoginAt) : null } : {}) } }); return mapAccount(record); }
  async findReceiverQrPrintSettings(accountId: string) {
    const record = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { receiverQrPrintSettings: true }
    });
    const value = record?.receiverQrPrintSettings;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  }
  async updateReceiverQrPrintSettings(accountId: string, settings: Record<string, unknown>) {
    const record = await this.prisma.account.update({
      where: { id: accountId },
      data: { receiverQrPrintSettings: settings as Prisma.InputJsonValue },
      select: { receiverQrPrintSettings: true }
    });
    return record.receiverQrPrintSettings as Record<string, unknown>;
  }
}

export class PrismaWorkerProfileRepository implements WorkerProfileRepository {
  constructor(private readonly prisma: IdentityPrismaClient) {}
  async listWorkerProfiles() { return (await this.prisma.workerProfile.findMany({ orderBy: { effectiveAt: "desc" } })).map(mapWorkerProfile); }
  async listWorkerProfilesByAccountId(accountId: string) { return (await this.prisma.workerProfile.findMany({ where: { accountId }, orderBy: { effectiveAt: "desc" } })).map(mapWorkerProfile); }
  async findWorkerProfileById(id: string) { const record = await this.prisma.workerProfile.findUnique({ where: { id } }); return record ? mapWorkerProfile(record) : undefined; }
  async findActiveWorkerProfileByAccountId(accountId: string) { const record = await this.prisma.workerProfile.findFirst({ where: { accountId, status: "active" }, orderBy: { effectiveAt: "desc" } }); return record ? mapWorkerProfile(record) : undefined; }
  async createWorkerProfile(input: { accountId: string; workerType: WorkerProfileRecord["workerType"]; status?: WorkerProfileRecord["status"]; effectiveAt?: string }) { const record = await this.prisma.workerProfile.create({ data: { ...input, status: input.status ?? "active", effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : new Date() } }); return mapWorkerProfile(record); }
  async updateWorkerProfile(id: string, input: Partial<Pick<WorkerProfileRecord, "workerType" | "status" | "effectiveAt" | "endedAt">>) { const record = await this.prisma.workerProfile.update({ where: { id }, data: { ...input, ...(input.effectiveAt !== undefined ? { effectiveAt: new Date(input.effectiveAt) } : {}), ...(input.endedAt !== undefined ? { endedAt: input.endedAt ? new Date(input.endedAt) : null } : {}) } }); return mapWorkerProfile(record); }
}

export class PrismaAccountSessionRepository implements AccountSessionRepository {
  constructor(private readonly prisma: IdentityPrismaClient) {}
  async createAccountSession(input: Omit<AccountSessionRecord, "id" | "createdAt" | "lastSeenAt" | "revokedAt">) { const record = await this.prisma.accountSession.create({ data: { ...input, expiresAt: new Date(input.expiresAt) } }); return mapAccountSession(record); }
  async findAccountSessionByTokenHash(tokenHash: string) { const record = await this.prisma.accountSession.findUnique({ where: { sessionTokenHash: tokenHash } }); return record ? mapAccountSession(record) : undefined; }
  async updateAccountSession(id: string, input: Partial<Pick<AccountSessionRecord, "lastSeenAt" | "expiresAt" | "revokedAt">>) { const record = await this.prisma.accountSession.update({ where: { id }, data: { ...(input.lastSeenAt !== undefined ? { lastSeenAt: input.lastSeenAt ? new Date(input.lastSeenAt) : null } : {}), ...(input.expiresAt !== undefined ? { expiresAt: new Date(input.expiresAt) } : {}), ...(input.revokedAt !== undefined ? { revokedAt: input.revokedAt ? new Date(input.revokedAt) : null } : {}) } }); return mapAccountSession(record); }
}

export class PrismaIdentityQrTokenRepository implements IdentityQrTokenRepository {
  constructor(private readonly prisma: IdentityPrismaClient) {}
  async listIdentityQrTokens() { return (await this.prisma.identityQrToken.findMany({ orderBy: { createdAt: "desc" } })).map(mapIdentityQrToken); }
  async findIdentityQrTokenById(id: string) { const record = await this.prisma.identityQrToken.findUnique({ where: { id } }); return record ? mapIdentityQrToken(record) : undefined; }
  async createIdentityQrToken(input: Omit<IdentityQrTokenRecord, "id" | "createdAt" | "usedAt" | "revokedAt" | "usedByAccountId" | "revokedByAccountId">) { const record = await this.prisma.identityQrToken.create({ data: { ...input, expiresAt: new Date(input.expiresAt) } }); return mapIdentityQrToken(record); }
  async findIdentityQrTokenByHash(tokenHash: string) { const record = await this.prisma.identityQrToken.findUnique({ where: { tokenHash } }); return record ? mapIdentityQrToken(record) : undefined; }
  async consumeIdentityQrToken(id: string, usedByAccountId: string, usedAt: string) { const result = await this.prisma.identityQrToken.updateMany({ where: { id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { usedByAccountId, usedAt: new Date(usedAt) } }); return result.count === 1; }
  async revokeIdentityQrToken(id: string, revokedByAccountId: string, revokedAt: string) { const result = await this.prisma.identityQrToken.updateMany({ where: { id, usedAt: null, revokedAt: null }, data: { revokedByAccountId, revokedAt: new Date(revokedAt) } }); return result.count === 1; }
  async updateIdentityQrToken(id: string, input: Partial<Pick<IdentityQrTokenRecord, "usedAt" | "revokedAt" | "usedByAccountId" | "revokedByAccountId">>) { const record = await this.prisma.identityQrToken.update({ where: { id }, data: { ...input, ...(input.usedAt !== undefined ? { usedAt: input.usedAt ? new Date(input.usedAt) : null } : {}), ...(input.revokedAt !== undefined ? { revokedAt: input.revokedAt ? new Date(input.revokedAt) : null } : {}) } }); return mapIdentityQrToken(record); }
}
