import type {
  AuthAccountCreateInput,
  AuthAccountRepository,
  AuthAccountUpdateInput
} from "../authAccountRepository.js";
import type { AuthAccountRecord, AuthAccountStatus } from "../../../modules/auth/authTypes.js";
import { FORMAL_LOGIN_DEV_ACCOUNTS } from "../../../modules/auth/devAuthAccounts.js";

export class InMemoryAuthAccountRepository implements AuthAccountRepository {
  private readonly accounts = FORMAL_LOGIN_DEV_ACCOUNTS.map((account) => ({ ...account }));
  private nextAccountNumber = 1;

  async listAuthAccounts(): Promise<AuthAccountRecord[]> {
    return this.accounts.map((account) => ({ ...account }));
  }

  async findAuthAccountById(id: string): Promise<AuthAccountRecord | undefined> {
    const account = this.accounts.find((candidate) => candidate.id === id);
    return account ? { ...account } : undefined;
  }

  async findAuthAccountByUsername(username: string): Promise<AuthAccountRecord | undefined> {
    const normalized = username.trim().toLowerCase();
    const account = this.accounts.find((candidate) => candidate.username.toLowerCase() === normalized);
    return account ? { ...account } : undefined;
  }

  async findAuthAccountByClientUserId(clientUserId: string): Promise<AuthAccountRecord | undefined> {
    const account = this.accounts.find((candidate) => candidate.clientUserId === clientUserId);
    return account ? { ...account } : undefined;
  }

  async createAuthAccount(input: AuthAccountCreateInput): Promise<AuthAccountRecord> {
    const account: AuthAccountRecord = {
      id: `formal-user-generated-${this.nextAccountNumber++}`,
      username: input.username.trim().toLowerCase(),
      displayName: input.displayName,
      role: input.role,
      status: input.status ?? "active",
      passwordHash: input.passwordHash,
      ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
      ...(input.clientUserId !== undefined ? { clientUserId: input.clientUserId } : {}),
      ...(input.clientAccessScope !== undefined ? { clientAccessScope: input.clientAccessScope } : {}),
      mustChangePasswordAtNextLogin: input.mustChangePasswordAtNextLogin === true,
      ...(input.lastPasswordResetAt !== undefined
        ? { lastPasswordResetAt: input.lastPasswordResetAt }
        : {})
    };
    this.accounts.push(account);
    return account;
  }

  async updateAuthAccount(id: string, input: AuthAccountUpdateInput): Promise<AuthAccountRecord> {
    const index = this.accounts.findIndex((account) => account.id === id);
    if (index < 0) {
      throw new Error("Auth account not found.");
    }

    if (input.username) {
      const normalizedUsername = input.username.trim().toLowerCase();
      const duplicate = this.accounts.find(
        (account) =>
          account.id !== id && account.username.toLowerCase() === normalizedUsername
      );
      if (duplicate) {
        throw new Error("Auth account username already exists.");
      }
    }

    const updated = {
      ...this.accounts[index]!,
      ...(input.username !== undefined ? { username: input.username.trim().toLowerCase() } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.contact !== undefined ? { contact: input.contact } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.passwordHash !== undefined ? { passwordHash: input.passwordHash } : {}),
      ...(input.clientAccessScope !== undefined ? { clientAccessScope: input.clientAccessScope } : {}),
      ...(input.mustChangePasswordAtNextLogin !== undefined
        ? { mustChangePasswordAtNextLogin: input.mustChangePasswordAtNextLogin }
        : {}),
      ...(input.lastPasswordResetAt !== undefined
        ? { lastPasswordResetAt: input.lastPasswordResetAt }
        : {})
    };
    this.accounts[index] = updated;
    return updated;
  }

  async updateAuthAccountStatus(id: string, status: AuthAccountStatus): Promise<AuthAccountRecord> {
    return this.updateAuthAccount(id, { status });
  }

  async recordSuccessfulLogin(_id: string): Promise<void> {
    // Memory mode does not persist last-login metadata.
  }
}

export function createInMemoryAuthAccountRepository() {
  return new InMemoryAuthAccountRepository();
}
