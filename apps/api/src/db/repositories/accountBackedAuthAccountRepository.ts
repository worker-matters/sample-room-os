import type {
  AuthAccountCreateInput,
  AuthAccountRepository,
  AuthAccountUpdateInput
} from "./authAccountRepository.js";
import type { AccountRecord, AccountRepository } from "./contracts/index.js";
import type { SampleRoomRepository } from "./sampleRoomRepository.js";
import type { AuthAccountRecord, AuthAccountStatus } from "../../modules/auth/authTypes.js";

const legacyStatus = (status: "active" | "pending" | "suspended" | "archived"): AuthAccountStatus =>
  status === "active" ? "active" : status === "suspended" ? "disabled" : "archived";
const accountStatus = (status: AuthAccountStatus) =>
  status === "active" ? "active" as const : status === "archived" ? "pending" as const : "suspended" as const;

/**
 * Temporary adapter for account-management and performance modules that still
 * consume the Phase 1 AuthAccountRepository interface. Account is the only
 * backing identity; no independent User store is created.
 */
export class AccountBackedAuthAccountRepository implements AuthAccountRepository {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly repository: SampleRoomRepository
  ) {}

  private async legacy(account: AccountRecord): Promise<AuthAccountRecord> {
    const client = await this.repository.findClientUserByAccountId(account.id);
    return {
      id: account.id,
      username: account.username ?? account.phoneNumber ?? "",
      displayName: account.displayName,
      ...(account.phoneNumber ? { contact: account.phoneNumber } : {}),
      role: account.role,
      status: legacyStatus(account.status),
      passwordHash: account.passwordHash,
      ...(client
        ? {
            customerId: client.customerId,
            clientUserId: client.id,
            clientAccessScope: client.clientAccessScope
          }
        : {}),
      mustChangePasswordAtNextLogin: account.mustChangePasswordAtNextLogin,
      ...(account.lastPasswordResetAt ? { lastPasswordResetAt: account.lastPasswordResetAt } : {})
    } satisfies AuthAccountRecord;
  }

  async listAuthAccounts() {
    return Promise.all((await this.accounts.listAccounts()).map((item) => this.legacy(item)));
  }
  async findAuthAccountById(id: string) {
    const account = await this.accounts.findAccountById(id);
    return account ? this.legacy(account) : undefined;
  }
  async findAuthAccountByUsername(username: string) {
    const account = await this.accounts.findAccountByUsername(username);
    return account ? this.legacy(account) : undefined;
  }
  async findAuthAccountByClientUserId(clientUserId: string) {
    const client = await this.repository.findClientUserById(clientUserId);
    return client?.accountId ? this.findAuthAccountById(client.accountId) : undefined;
  }
  async createAuthAccount(input: AuthAccountCreateInput) {
    const requestedStatus = input.status ?? "active";
    const created = await this.accounts.createAccount({
      username: input.username,
      phoneNumber: null,
      displayName: input.displayName,
      accountType: "business",
      role: input.role,
      passwordHash: input.passwordHash,
      // Keep the new identity unusable until its unique ClientUser link succeeds.
      status: input.clientUserId ? "suspended" : accountStatus(requestedStatus),
      mustChangePasswordAtNextLogin: input.mustChangePasswordAtNextLogin ?? false,
      lastPasswordResetAt: input.lastPasswordResetAt ?? null
    });
    if (input.clientUserId) {
      const client = await this.repository.findClientUserById(input.clientUserId);
      if (!client || client.accountId) {
        throw new Error("customer salesperson already has a login account.");
      }
      await this.repository.updateClientUser(input.clientUserId, {
        accountId: created.id,
        ...(input.clientAccessScope !== undefined
          ? { clientAccessScope: input.clientAccessScope }
          : {})
      });
      if (requestedStatus !== "disabled") {
        const activated = await this.accounts.updateAccount(created.id, {
          status: accountStatus(requestedStatus)
        });
        return (await this.legacy(activated))!;
      }
    }
    return (await this.legacy(created))!;
  }
  async updateAuthAccount(id: string, input: AuthAccountUpdateInput) {
    const updated = await this.accounts.updateAccount(id, {
      ...(input.username !== undefined ? { username: input.username } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.contact !== undefined ? { phoneNumber: input.contact || null } : {}),
      ...(input.status !== undefined ? { status: accountStatus(input.status) } : {}),
      ...(input.passwordHash !== undefined ? { passwordHash: input.passwordHash } : {}),
      ...(input.mustChangePasswordAtNextLogin !== undefined
        ? { mustChangePasswordAtNextLogin: input.mustChangePasswordAtNextLogin }
        : {}),
      ...(input.lastPasswordResetAt !== undefined
        ? { lastPasswordResetAt: input.lastPasswordResetAt }
        : {})
    });
    if (input.clientAccessScope !== undefined) {
      const client = await this.repository.findClientUserByAccountId(id);
      if (client) await this.repository.updateClientUser(client.id, { clientAccessScope: input.clientAccessScope });
    }
    return (await this.legacy(updated))!;
  }
  async updateAuthAccountStatus(id: string, status: AuthAccountStatus) {
    return this.updateAuthAccount(id, { status });
  }
  async recordSuccessfulLogin(id: string) {
    await this.accounts.updateAccount(id, { lastLoginAt: new Date().toISOString() });
  }
}
