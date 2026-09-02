import type { AuthAccountRecord, AuthAccountStatus } from "../../modules/auth/authTypes.js";
import type { ClientAccessScope, Role } from "@sample-room/shared";

export type AuthAccountCreateInput = {
  username: string;
  displayName: string;
  role: Role;
  passwordHash: string;
  status?: AuthAccountStatus | undefined;
  customerId?: string | undefined;
  clientUserId?: string | undefined;
  clientAccessScope?: ClientAccessScope | undefined;
  mustChangePasswordAtNextLogin?: boolean | undefined;
  lastPasswordResetAt?: string | undefined;
};

export type AuthAccountUpdateInput = {
  username?: string | undefined;
  displayName?: string | undefined;
  role?: Role | undefined;
  contact?: string | undefined;
  status?: AuthAccountStatus | undefined;
  passwordHash?: string | undefined;
  clientAccessScope?: ClientAccessScope | undefined;
  mustChangePasswordAtNextLogin?: boolean | undefined;
  lastPasswordResetAt?: string | undefined;
};

export interface AuthAccountRepository {
  listAuthAccounts(): Promise<AuthAccountRecord[]>;
  findAuthAccountById(id: string): Promise<AuthAccountRecord | undefined>;
  findAuthAccountByUsername(username: string): Promise<AuthAccountRecord | undefined>;
  findAuthAccountByClientUserId(clientUserId: string): Promise<AuthAccountRecord | undefined>;
  createAuthAccount(input: AuthAccountCreateInput): Promise<AuthAccountRecord>;
  updateAuthAccount(id: string, input: AuthAccountUpdateInput): Promise<AuthAccountRecord>;
  updateAuthAccountStatus(id: string, status: AuthAccountStatus): Promise<AuthAccountRecord>;
  recordSuccessfulLogin(id: string): Promise<void>;
}
