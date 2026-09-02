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
import { FIXED_IDENTITY_ACCOUNTS, FIXED_WORKER_PROFILES } from "../../fixtures/identityFixtures.js";

export class InMemoryIdentityStore {
  readonly accounts: AccountRecord[] = structuredClone(FIXED_IDENTITY_ACCOUNTS);
  readonly workerProfiles: WorkerProfileRecord[] = structuredClone(FIXED_WORKER_PROFILES);
  readonly accountSessions: AccountSessionRecord[] = [];
  readonly identityQrTokens: IdentityQrTokenRecord[] = [];
  readonly receiverQrPrintSettings = new Map<string, Record<string, unknown>>();

  snapshot() {
    return copy({
      accounts: this.accounts,
      workerProfiles: this.workerProfiles,
      accountSessions: this.accountSessions,
      identityQrTokens: this.identityQrTokens,
      receiverQrPrintSettings: Array.from(this.receiverQrPrintSettings.entries())
    });
  }

  restore(snapshot: ReturnType<InMemoryIdentityStore["snapshot"]>) {
    this.accounts.splice(0, this.accounts.length, ...snapshot.accounts);
    this.workerProfiles.splice(0, this.workerProfiles.length, ...snapshot.workerProfiles);
    this.accountSessions.splice(0, this.accountSessions.length, ...snapshot.accountSessions);
    this.identityQrTokens.splice(0, this.identityQrTokens.length, ...snapshot.identityQrTokens);
    this.receiverQrPrintSettings.clear();
    snapshot.receiverQrPrintSettings.forEach(([accountId, settings]) => {
      this.receiverQrPrintSettings.set(accountId, settings);
    });
  }
}

const copy = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();

export class InMemoryAccountRepository implements AccountRepository {
  constructor(private readonly store: InMemoryIdentityStore) {}
  async listAccounts() { return copy(this.store.accounts); }
  async findAccountById(id: string) { const value = this.store.accounts.find((item) => item.id === id); return value ? copy(value) : undefined; }
  async findAccountByUsername(username: string) { const normalized = username.trim().toLowerCase(); const value = this.store.accounts.find((item) => item.username?.toLowerCase() === normalized); return value ? copy(value) : undefined; }
  async findAccountByPhoneNumber(phoneNumber: string, accountType?: AccountRecord["accountType"]) { const value = this.store.accounts.find((item) => item.phoneNumber === phoneNumber && (!accountType || item.accountType === accountType)); return value ? copy(value) : undefined; }
  async createAccount(input: AccountCreateInput) {
    const timestamp = now();
    const record: AccountRecord = { id: `account-${this.store.accounts.length + 1}`, ...input, status: input.status ?? "pending", mustChangePasswordAtNextLogin: input.mustChangePasswordAtNextLogin ?? false, lastPasswordResetAt: input.lastPasswordResetAt ?? null, lastLoginAt: null, createdAt: timestamp, updatedAt: timestamp };
    this.store.accounts.push(record);
    return copy(record);
  }
  async updateAccount(id: string, input: AccountUpdateInput) {
    const index = this.store.accounts.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("Account not found.");
    const record = { ...this.store.accounts[index]!, ...input, updatedAt: now() };
    this.store.accounts[index] = record;
    return copy(record);
  }

  async findReceiverQrPrintSettings(accountId: string) {
    const value = this.store.receiverQrPrintSettings.get(accountId);
    return value ? structuredClone(value) : undefined;
  }

  async updateReceiverQrPrintSettings(accountId: string, settings: Record<string, unknown>) {
    this.store.receiverQrPrintSettings.set(accountId, structuredClone(settings));
    return structuredClone(settings);
  }
}

export class InMemoryWorkerProfileRepository implements WorkerProfileRepository {
  constructor(private readonly store: InMemoryIdentityStore) {}
  async listWorkerProfiles() { return copy(this.store.workerProfiles); }
  async listWorkerProfilesByAccountId(accountId: string) { return copy(this.store.workerProfiles.filter((item) => item.accountId === accountId)); }
  async findWorkerProfileById(id: string) { const value = this.store.workerProfiles.find((item) => item.id === id); return value ? copy(value) : undefined; }
  async findActiveWorkerProfileByAccountId(accountId: string) { const value = this.store.workerProfiles.find((item) => item.accountId === accountId && item.status === "active"); return value ? copy(value) : undefined; }
  async createWorkerProfile(input: { accountId: string; workerType: WorkerProfileRecord["workerType"]; status?: WorkerProfileRecord["status"]; effectiveAt?: string }) {
    if (this.store.workerProfiles.some((item) => item.accountId === input.accountId && item.workerType === input.workerType)) throw new Error("Account already has a WorkerProfile for this workerType.");
    if ((input.status ?? "active") === "active" && this.store.workerProfiles.some((item) => item.accountId === input.accountId && item.status === "active")) throw new Error("Account already has an active WorkerProfile.");
    const timestamp = now();
    const record: WorkerProfileRecord = { id: `worker-profile-${this.store.workerProfiles.length + 1}`, accountId: input.accountId, workerType: input.workerType, status: input.status ?? "active", effectiveAt: input.effectiveAt ?? timestamp, endedAt: null, createdAt: timestamp, updatedAt: timestamp };
    this.store.workerProfiles.push(record);
    return copy(record);
  }
  async updateWorkerProfile(id: string, input: Partial<Pick<WorkerProfileRecord, "workerType" | "status" | "effectiveAt" | "endedAt">>) {
    const index = this.store.workerProfiles.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("WorkerProfile not found.");
    if (input.status === "active" && this.store.workerProfiles.some((item) => item.id !== id && item.accountId === this.store.workerProfiles[index]!.accountId && item.status === "active")) throw new Error("Account already has an active WorkerProfile.");
    const record = { ...this.store.workerProfiles[index]!, ...input, updatedAt: now() };
    this.store.workerProfiles[index] = record;
    return copy(record);
  }
}

export class InMemoryAccountSessionRepository implements AccountSessionRepository {
  constructor(private readonly store: InMemoryIdentityStore) {}
  async createAccountSession(input: Omit<AccountSessionRecord, "id" | "createdAt" | "lastSeenAt" | "revokedAt">) { const record: AccountSessionRecord = { id: `account-session-${this.store.accountSessions.length + 1}`, ...input, createdAt: now(), lastSeenAt: null, revokedAt: null }; this.store.accountSessions.push(record); return copy(record); }
  async findAccountSessionByTokenHash(tokenHash: string) { const value = this.store.accountSessions.find((item) => item.sessionTokenHash === tokenHash); return value ? copy(value) : undefined; }
  async updateAccountSession(id: string, input: Partial<Pick<AccountSessionRecord, "lastSeenAt" | "expiresAt" | "revokedAt">>) { const index = this.store.accountSessions.findIndex((item) => item.id === id); if (index < 0) throw new Error("AccountSession not found."); const record = { ...this.store.accountSessions[index]!, ...input }; this.store.accountSessions[index] = record; return copy(record); }
}

export class InMemoryIdentityQrTokenRepository implements IdentityQrTokenRepository {
  constructor(private readonly store: InMemoryIdentityStore) {}
  async listIdentityQrTokens() { return copy(this.store.identityQrTokens); }
  async findIdentityQrTokenById(id: string) { const value = this.store.identityQrTokens.find((item) => item.id === id); return value ? copy(value) : undefined; }
  async createIdentityQrToken(input: Omit<IdentityQrTokenRecord, "id" | "createdAt" | "usedAt" | "revokedAt" | "usedByAccountId" | "revokedByAccountId">) { const record: IdentityQrTokenRecord = { id: `identity-qr-token-${this.store.identityQrTokens.length + 1}`, ...input, usedByAccountId: null, revokedByAccountId: null, usedAt: null, revokedAt: null, createdAt: now() }; this.store.identityQrTokens.push(record); return copy(record); }
  async findIdentityQrTokenByHash(tokenHash: string) { const value = this.store.identityQrTokens.find((item) => item.tokenHash === tokenHash); return value ? copy(value) : undefined; }
  async consumeIdentityQrToken(id: string, usedByAccountId: string, usedAt: string) { const record = this.store.identityQrTokens.find((item) => item.id === id); if (!record || record.usedAt || record.revokedAt || Date.parse(record.expiresAt) <= Date.now()) return false; record.usedByAccountId = usedByAccountId; record.usedAt = usedAt; return true; }
  async revokeIdentityQrToken(id: string, revokedByAccountId: string, revokedAt: string) { const record = this.store.identityQrTokens.find((item) => item.id === id); if (!record || record.usedAt || record.revokedAt) return false; record.revokedByAccountId = revokedByAccountId; record.revokedAt = revokedAt; return true; }
  async updateIdentityQrToken(id: string, input: Partial<Pick<IdentityQrTokenRecord, "usedAt" | "revokedAt" | "usedByAccountId" | "revokedByAccountId">>) { const index = this.store.identityQrTokens.findIndex((item) => item.id === id); if (index < 0) throw new Error("IdentityQrToken not found."); const record = { ...this.store.identityQrTokens[index]!, ...input }; this.store.identityQrTokens[index] = record; return copy(record); }
}
