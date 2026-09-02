import type { Prisma } from "@prisma/client";
import type {
  AuthAccountCreateInput,
  AuthAccountRepository,
  AuthAccountUpdateInput
} from "../authAccountRepository.js";
import type { AuthAccountRecord, AuthAccountStatus } from "../../../modules/auth/authTypes.js";
import type { SampleRoomPrismaClient } from "./prismaClient.js";

const accountWithClientProfiles = { clientProfiles: true } satisfies Prisma.AccountInclude;
type PrismaAuthAccount = Prisma.AccountGetPayload<{ include: typeof accountWithClientProfiles }>;

function toLegacyStatus(status: PrismaAuthAccount["status"]): AuthAccountStatus {
  if (status === "suspended") return "disabled";
  if (status === "pending") return "archived";
  return "active";
}

function toAccountStatus(status: AuthAccountStatus): "active" | "suspended" | "pending" {
  if (status === "disabled") return "suspended";
  if (status === "archived") return "pending";
  return "active";
}

function mapAuthAccount(account: PrismaAuthAccount): AuthAccountRecord {
  const clientProfile = account.clientProfiles[0];
  return {
    id: account.id,
    username: account.username ?? account.phoneNumber ?? account.id,
    displayName: account.displayName,
    ...(account.phoneNumber ? { contact: account.phoneNumber } : {}),
    role: account.role,
    status: toLegacyStatus(account.status),
    passwordHash: account.passwordHash,
    ...(clientProfile ? { clientUserId: clientProfile.id, customerId: clientProfile.customerId, clientAccessScope: clientProfile.clientAccessScope } : {}),
    mustChangePasswordAtNextLogin: account.mustChangePasswordAtNextLogin,
    ...(account.lastPasswordResetAt ? { lastPasswordResetAt: account.lastPasswordResetAt.toISOString() } : {})
  };
}

export class PrismaAuthAccountRepository implements AuthAccountRepository {
  constructor(private readonly prisma: SampleRoomPrismaClient) {}

  async listAuthAccounts() { return (await this.prisma.account.findMany({ include: accountWithClientProfiles, orderBy: [{ role: "asc" }, { displayName: "asc" }] })).map(mapAuthAccount); }
  async findAuthAccountById(id: string) { const account = await this.prisma.account.findUnique({ where: { id }, include: accountWithClientProfiles }); return account ? mapAuthAccount(account) : undefined; }
  async findAuthAccountByUsername(username: string) { const account = await this.prisma.account.findUnique({ where: { username: username.trim().toLowerCase() }, include: accountWithClientProfiles }); return account ? mapAuthAccount(account) : undefined; }
  async findAuthAccountByClientUserId(clientUserId: string) { const clientUser = await this.prisma.clientUser.findUnique({ where: { id: clientUserId }, include: { account: { include: accountWithClientProfiles } } }); return clientUser?.account ? mapAuthAccount(clientUser.account) : undefined; }

  async createAuthAccount(input: AuthAccountCreateInput) {
    const account = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.account.create({
        data: {
          username: input.username.trim().toLowerCase(),
          phoneNumber: null,
          displayName: input.displayName,
          accountType: input.role === "worker" ? "worker" : "business",
          role: input.role,
          status: toAccountStatus(input.status ?? "active"),
          passwordHash: input.passwordHash,
          mustChangePasswordAtNextLogin: input.mustChangePasswordAtNextLogin === true,
          ...(input.lastPasswordResetAt ? { lastPasswordResetAt: new Date(input.lastPasswordResetAt) } : {})
        }
      });
      if (input.clientUserId) {
        const linked = await transaction.clientUser.updateMany({
          where: { id: input.clientUserId, accountId: null },
          data: {
            accountId: created.id,
            ...(input.clientAccessScope !== undefined
              ? { clientAccessScope: input.clientAccessScope }
              : {})
          }
        });
        if (linked.count !== 1) {
          throw new Error("customer salesperson already has a login account.");
        }
      }
      return transaction.account.findUniqueOrThrow({ where: { id: created.id }, include: accountWithClientProfiles });
    });
    return mapAuthAccount(account);
  }

  async updateAuthAccount(id: string, input: AuthAccountUpdateInput) {
    if (input.clientAccessScope !== undefined) await this.prisma.clientUser.updateMany({ where: { accountId: id }, data: { clientAccessScope: input.clientAccessScope } });
    const account = await this.prisma.account.update({
      where: { id },
      data: {
        ...(input.username !== undefined ? { username: input.username.trim().toLowerCase() } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.contact !== undefined ? { phoneNumber: input.contact } : {}),
        ...(input.status !== undefined ? { status: toAccountStatus(input.status) } : {}),
        ...(input.passwordHash !== undefined ? { passwordHash: input.passwordHash } : {}),
        ...(input.mustChangePasswordAtNextLogin !== undefined ? { mustChangePasswordAtNextLogin: input.mustChangePasswordAtNextLogin } : {}),
        ...(input.lastPasswordResetAt !== undefined ? { lastPasswordResetAt: new Date(input.lastPasswordResetAt) } : {})
      },
      include: accountWithClientProfiles
    });
    return mapAuthAccount(account);
  }

  async updateAuthAccountStatus(id: string, status: AuthAccountStatus) { return this.updateAuthAccount(id, { status }); }
  async recordSuccessfulLogin(id: string) { await this.prisma.account.update({ where: { id }, data: { lastLoginAt: new Date() } }); }
}
