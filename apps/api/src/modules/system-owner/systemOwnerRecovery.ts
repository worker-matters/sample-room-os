import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "../auth/password.js";

type RecoveryClient = Pick<PrismaClient, "account" | "$transaction">;

export type RecoverableSystemOwner = {
  id: string;
  username: string;
  status: "active" | "suspended" | "pending";
};

export class SystemOwnerRecoveryError extends Error {
  constructor(
    readonly code: "invalid_password" | "owner_not_found",
    message: string
  ) {
    super(message);
  }
}

export function validateRecoveryPassword(password: string) {
  if (password.length < 12) {
    throw new SystemOwnerRecoveryError("invalid_password", "password_too_short");
  }

  const characterClasses = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password)
  ].filter(Boolean).length;
  if (characterClasses < 3) {
    throw new SystemOwnerRecoveryError("invalid_password", "password_complexity_failed");
  }
}

export async function listRecoverableSystemOwners(
  client: RecoveryClient
): Promise<RecoverableSystemOwner[]> {
  const accounts = await client.account.findMany({
    where: {
      role: "system_owner",
      status: { not: "archived" },
      username: { not: null }
    },
    select: { id: true, username: true, status: true },
    orderBy: { username: "asc" }
  });

  return accounts.map((account) => {
    if (account.status === "archived") {
      throw new Error("archived_owner_returned_by_recovery_query");
    }
    return {
      id: account.id,
      username: account.username!,
      status: account.status
    };
  });
}

export async function recoverSystemOwner(
  client: RecoveryClient,
  accountId: string,
  newPassword: string,
  recoveredAt = new Date()
) {
  validateRecoveryPassword(newPassword);
  const passwordHash = hashPassword(newPassword);

  return client.$transaction(async (transaction) => {
    const account = await transaction.account.findFirst({
      where: {
        id: accountId,
        role: "system_owner",
        status: { not: "archived" },
        username: { not: null }
      },
      select: { id: true, username: true, status: true }
    });
    if (!account?.username) {
      throw new SystemOwnerRecoveryError("owner_not_found", "owner_not_found");
    }

    await transaction.account.update({
      where: { id: account.id },
      data: {
        passwordHash,
        status: "active",
        mustChangePasswordAtNextLogin: true,
        lastPasswordResetAt: recoveredAt
      }
    });
    const revoked = await transaction.accountSession.updateMany({
      where: { accountId: account.id, revokedAt: null },
      data: { revokedAt: recoveredAt }
    });
    await transaction.operationLog.create({
      data: {
        actorAccountId: null,
        actorRole: null,
        action: "system_owner_emergency_recovery",
        targetType: "Account",
        targetId: account.id,
        before: { status: account.status },
        after: {
          status: "active",
          mustChangePasswordAtNextLogin: true
        },
        payload: {
          source: "factory_local_recovery",
          revokedSessionCount: revoked.count
        },
        createdAt: recoveredAt
      }
    });

    return {
      username: account.username,
      recoveredAt: recoveredAt.toISOString(),
      revokedSessionCount: revoked.count
    };
  });
}
