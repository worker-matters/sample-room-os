import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  listRecoverableSystemOwners,
  recoverSystemOwner,
  validateRecoveryPassword
} from "./systemOwnerRecovery.js";
import { verifyPassword } from "../auth/password.js";

type RecoveryClient = Pick<PrismaClient, "account" | "$transaction">;

describe("System Owner factory-local emergency recovery", () => {
  it("requires 12 characters and at least three character classes", () => {
    expect(() => validateRecoveryPassword("Short1!")).toThrow("password_too_short");
    expect(() => validateRecoveryPassword("alllowercasepassword")).toThrow(
      "password_complexity_failed"
    );
    expect(() => validateRecoveryPassword("Factory-Owner-2026")).not.toThrow();
  });

  it("lists only unarchived System Owners with usernames", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "owner-1", username: "factory-owner", status: "suspended" }
    ]);
    const client = { account: { findMany } } as unknown as RecoveryClient;

    await expect(listRecoverableSystemOwners(client)).resolves.toEqual([
      { id: "owner-1", username: "factory-owner", status: "suspended" }
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        role: "system_owner",
        status: { not: "archived" },
        username: { not: null }
      }
    }));
  });

  it("updates the same owner, reactivates it, revokes sessions, and audits without credentials", async () => {
    const recoveredAt = new Date("2026-07-30T12:00:00.000Z");
    const update = vi.fn().mockResolvedValue({});
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const create = vi.fn().mockResolvedValue({});
    const transaction = {
      account: {
        findFirst: vi.fn().mockResolvedValue({
          id: "owner-1",
          username: "factory-owner",
          status: "suspended"
        }),
        update
      },
      accountSession: { updateMany },
      operationLog: { create }
    };
    const client = {
      $transaction: async (callback: (value: typeof transaction) => unknown) =>
        callback(transaction)
    } as unknown as RecoveryClient;

    const result = await recoverSystemOwner(
      client,
      "owner-1",
      "Factory-Owner-2026!",
      recoveredAt
    );

    expect(result).toEqual({
      username: "factory-owner",
      recoveredAt: recoveredAt.toISOString(),
      revokedSessionCount: 3
    });
    const updateData = update.mock.calls[0]![0].data;
    expect(update.mock.calls[0]![0].where).toEqual({ id: "owner-1" });
    expect(updateData).toMatchObject({
      status: "active",
      mustChangePasswordAtNextLogin: true,
      lastPasswordResetAt: recoveredAt
    });
    expect(verifyPassword("Factory-Owner-2026!", updateData.passwordHash)).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { accountId: "owner-1", revokedAt: null },
      data: { revokedAt: recoveredAt }
    });

    const serializedAudit = JSON.stringify(create.mock.calls[0]![0]);
    expect(serializedAudit).toContain("system_owner_emergency_recovery");
    expect(serializedAudit).toContain("factory_local_recovery");
    expect(serializedAudit).not.toContain("Factory-Owner-2026!");
    expect(serializedAudit).not.toContain(updateData.passwordHash);
    expect(serializedAudit).not.toContain("passwordHash");
  });

  it("makes no mutation when the selected owner is no longer recoverable", async () => {
    const update = vi.fn();
    const updateMany = vi.fn();
    const create = vi.fn();
    const transaction = {
      account: { findFirst: vi.fn().mockResolvedValue(null), update },
      accountSession: { updateMany },
      operationLog: { create }
    };
    const client = {
      $transaction: async (callback: (value: typeof transaction) => unknown) =>
        callback(transaction)
    } as unknown as RecoveryClient;

    await expect(
      recoverSystemOwner(client, "owner-1", "Factory-Owner-2026!")
    ).rejects.toMatchObject({ code: "owner_not_found" });
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
