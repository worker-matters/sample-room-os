import { ROLES, isClientRole, type Role } from "@sample-room/shared";
import type {
  AccountRecord,
  AccountRepository
} from "../../db/repositories/contracts/index.js";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { ClientUserRecord, CustomerRecord } from "../orders/orderTypes.js";
import type { CurrentUser } from "./currentUser.js";
import { hashPassword, verifyPassword } from "./password.js";

type UpdateOwnProfilePayload = {
  username?: unknown;
  displayName?: unknown;
  contact?: unknown;
  phoneNumber?: unknown;
  currentPassword?: unknown;
};
type ChangePasswordPayload = {
  currentPassword?: unknown;
  newPassword?: unknown;
  confirmPassword?: unknown;
};

export type AccountSecurityProfile = {
  userId: string;
  accountId: string;
  accountType: AccountRecord["accountType"];
  username: string | null;
  phoneNumber: string | null;
  displayName: string;
  contact?: string | undefined;
  customerId?: string | undefined;
  customerName?: string | undefined;
  clientUserId?: string | undefined;
  clientAccessScope?: ClientUserRecord["clientAccessScope"] | undefined;
  roleLabel: string;
  status: AccountRecord["status"];
  mustChangePassword: boolean;
};

const text = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${field} is required.`);
  }
  return value.trim();
};
const optionalText = (value: unknown) => typeof value === "string" ? value.trim() : "";
function roleLabel(role: Role) {
  switch (role) {
    case ROLES.systemOwner: return "System Owner";
    case ROLES.boss: return "老板";
    case ROLES.receiver: return "接单员";
    case ROLES.planner: return "计划员";
    case ROLES.patternMaker: return "版师";
    case ROLES.clientAdmin: return "客户主管";
    case ROLES.clientBusinessUser: return "客户业务员";
    case ROLES.worker: return "生产员工";
  }
}

export class AccountSecurityService {
  constructor(
    private readonly repository: SampleRoomRepository,
    private readonly accounts: AccountRepository
  ) {}

  private accountId(user: CurrentUser) {
    return user.accountId ?? user.id;
  }

  private async activeAccount(user: CurrentUser) {
    const account = await this.accounts.findAccountById(this.accountId(user));
    if (!account || account.status !== "active") {
      throw new HttpError(403, "active login account is required.");
    }
    return account;
  }

  private async clientBinding(
    account: AccountRecord
  ): Promise<{ customer: CustomerRecord; clientUser: ClientUserRecord }> {
    if (!isClientRole(account.role)) {
      throw new HttpError(403, "account security is not available for this role.");
    }
    const clientUser = await this.repository.findClientUserByAccountId(account.id);
    const customer = clientUser
      ? await this.repository.findCustomerById(clientUser.customerId)
      : undefined;
    if (!customer || !clientUser || clientUser.status !== "active") {
      throw new HttpError(403, "client account is missing customer binding.");
    }
    return { customer, clientUser };
  }

  private profile(
    account: AccountRecord,
    customer?: CustomerRecord,
    client?: ClientUserRecord
  ): AccountSecurityProfile {
    return {
      userId: account.id,
      accountId: account.id,
      accountType: account.accountType,
      username: account.username,
      phoneNumber: account.phoneNumber,
      displayName: client?.displayName ?? account.displayName,
      ...(client?.contact || account.phoneNumber
        ? { contact: client?.contact ?? account.phoneNumber ?? undefined }
        : {}),
      ...(customer ? { customerId: customer.id, customerName: customer.name } : {}),
      ...(client
        ? { clientUserId: client.id, clientAccessScope: client.clientAccessScope }
        : {}),
      roleLabel: roleLabel(account.role),
      status: account.status,
      mustChangePassword: account.mustChangePasswordAtNextLogin
    };
  }

  async getProfile(user: CurrentUser) {
    const account = await this.activeAccount(user);
    if (!isClientRole(account.role)) return this.profile(account);
    const { customer, clientUser } = await this.clientBinding(account);
    return this.profile(account, customer, clientUser);
  }

  async updateOwnProfile(user: CurrentUser, payload: UpdateOwnProfilePayload) {
    const account = await this.activeAccount(user);
    const accountPatch: Parameters<AccountRepository["updateAccount"]>[1] = {};
    const currentPassword = () => {
      if (!verifyPassword(text(payload.currentPassword, "currentPassword"), account.passwordHash)) {
        throw new HttpError(401, "invalid_credentials");
      }
    };

    if (payload.username !== undefined) {
      if (account.accountType !== "business") {
        throw new HttpError(400, "worker accounts use phoneNumber as the login identifier.");
      }
      const username = text(payload.username, "username").toLowerCase();
      if (username !== account.username) {
        currentPassword();
        const existing = await this.accounts.findAccountByUsername(username);
        if (existing && existing.id !== account.id) throw new HttpError(409, "username_already_exists");
        accountPatch.username = username;
      }
    }
    const phoneInput = payload.phoneNumber ?? payload.contact;
    if (phoneInput !== undefined) {
      const phoneNumber = optionalText(phoneInput) || null;
      if (account.accountType === "worker" && phoneNumber !== account.phoneNumber) {
        currentPassword();
        if (!phoneNumber) throw new HttpError(400, "phoneNumber is required for worker accounts.");
        const existing = await this.accounts.findAccountByPhoneNumber(phoneNumber, "worker");
        if (existing && existing.id !== account.id) throw new HttpError(409, "phone_number_already_exists");
      }
      accountPatch.phoneNumber = phoneNumber;
    }
    if (payload.displayName !== undefined) {
      accountPatch.displayName = text(payload.displayName, "displayName");
    }

    let clientBinding: { customer: CustomerRecord; clientUser: ClientUserRecord } | undefined;
    if (isClientRole(account.role)) {
      clientBinding = await this.clientBinding(account);
      const clientPatch: Partial<Pick<ClientUserRecord, "displayName" | "contact">> = {};
      if (payload.displayName !== undefined) clientPatch.displayName = accountPatch.displayName!;
      if (phoneInput !== undefined) clientPatch.contact = optionalText(phoneInput);
      if (Object.keys(clientPatch).length) {
        clientBinding.clientUser = await this.repository.updateClientUser(
          clientBinding.clientUser.id,
          clientPatch
        );
      }
    }

    const updated = Object.keys(accountPatch).length
      ? await this.accounts.updateAccount(account.id, accountPatch)
      : account;
    return this.profile(updated, clientBinding?.customer, clientBinding?.clientUser);
  }

  async changePassword(user: CurrentUser, payload: ChangePasswordPayload) {
    const account = await this.activeAccount(user);
    const currentPassword = text(payload.currentPassword, "currentPassword");
    const newPassword = text(payload.newPassword, "newPassword");
    if (newPassword.length < 8) {
      throw new HttpError(400, "newPassword must be at least 8 characters.");
    }
    if (newPassword !== text(payload.confirmPassword, "confirmPassword")) {
      throw new HttpError(400, "password confirmation does not match.");
    }
    if (!verifyPassword(currentPassword, account.passwordHash)) {
      throw new HttpError(401, "invalid_credentials");
    }
    await this.accounts.updateAccount(account.id, {
      passwordHash: hashPassword(newPassword),
      mustChangePasswordAtNextLogin: false,
      lastPasswordResetAt: new Date().toISOString()
    });
    return { ok: true as const };
  }

}
