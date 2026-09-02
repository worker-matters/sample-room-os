import { beforeEach, describe, expect, it } from "vitest";
import { ROLES, type Role } from "@sample-room/shared";
import { createInMemoryAuthAccountRepository } from "../../db/repositories/memory/inMemoryAuthAccountRepository.js";
import { InMemoryOperationLogRepository } from "../../db/repositories/memory/inMemorySystemRepositories.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { InternalAccountService } from "./internalAccountService.js";

const actor = (role: Role): CurrentUser => ({
  id: `${role}-account`,
  accountId: `${role}-account`,
  role,
  displayName: role
});

describe("InternalAccountService role permissions and audit", () => {
  let accounts: ReturnType<typeof createInMemoryAuthAccountRepository>;
  let operationLogs: InMemoryOperationLogRepository;
  let service: InternalAccountService;

  beforeEach(() => {
    accounts = createInMemoryAuthAccountRepository();
    operationLogs = new InMemoryOperationLogRepository();
    service = new InternalAccountService(accounts, operationLogs);
  });

  it("allows System Owner to create every internal Business Account role", async () => {
    for (const role of [ROLES.boss, ROLES.receiver, ROLES.planner, ROLES.patternMaker] as const) {
      const result = await service.createInternalAccount(actor(ROLES.systemOwner), {
        username: `new-${role}@example.test`,
        displayName: `New ${role}`,
        role,
        password: "TemporaryPassword123"
      });
      const stored = await accounts.findAuthAccountById(result.account.id);

      expect(result.account).toMatchObject({ role, status: "active" });
      expect(stored).toMatchObject({
        role,
        status: "active",
        mustChangePasswordAtNextLogin: true
      });
      expect(stored).not.toHaveProperty("clientUserId");
    }
  });

  it("allows boss to create ordinary internal roles but forbids creating boss", async () => {
    for (const role of [ROLES.receiver, ROLES.planner, ROLES.patternMaker] as const) {
      await expect(service.createInternalAccount(actor(ROLES.boss), {
        username: `boss-created-${role}@example.test`,
        displayName: `Boss Created ${role}`,
        role
      })).resolves.toMatchObject({ account: { role } });
    }

    await expect(service.createInternalAccount(actor(ROLES.boss), {
      username: "second-boss@example.test",
      displayName: "Second Boss",
      role: ROLES.boss
    })).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects non-manager actors and roles outside the internal account flow", async () => {
    for (const role of [
      ROLES.receiver,
      ROLES.planner,
      ROLES.patternMaker,
      ROLES.worker,
      ROLES.clientAdmin,
      ROLES.clientBusinessUser
    ] as const) {
      await expect(service.createInternalAccount(actor(role), {
        username: `forbidden-${role}@example.test`,
        displayName: `Forbidden ${role}`,
        role: ROLES.receiver
      })).rejects.toMatchObject({ statusCode: 403 });
    }

    for (const role of [
      ROLES.systemOwner,
      ROLES.worker,
      ROLES.clientAdmin,
      ROLES.clientBusinessUser
    ] as const) {
      await expect(service.createInternalAccount(actor(ROLES.systemOwner), {
        username: `invalid-target-${role}@example.test`,
        displayName: `Invalid Target ${role}`,
        role
      })).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it("returns conflict for duplicate usernames", async () => {
    const input = {
      username: "unique-internal@example.test",
      displayName: "Unique Internal",
      role: ROLES.receiver
    };
    await service.createInternalAccount(actor(ROLES.systemOwner), input);

    await expect(service.createInternalAccount(actor(ROLES.systemOwner), input))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("does not let a boss manage or reset a System Owner account", async () => {
    const owner = await accounts.createAuthAccount({
      username: "protected-owner@example.test",
      displayName: "Protected Owner",
      role: ROLES.systemOwner,
      passwordHash: "not-used"
    });

    await expect(service.updateInternalAccount(actor(ROLES.boss), owner.id, {
      status: "disabled"
    })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.resetInternalAccountPassword(actor(ROLES.boss), owner.id, {
      password: "ForbiddenReset123!"
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("audits create, profile update, status change, and password reset without credentials", async () => {
    const created = await service.createInternalAccount(actor(ROLES.systemOwner), {
      username: "audited-boss@example.test",
      displayName: "Audited Boss",
      role: ROLES.boss,
      password: "CreateSecret123"
    });
    await service.updateInternalAccount(actor(ROLES.systemOwner), created.account.id, {
      username: "audited-boss-updated@example.test",
      displayName: "Audited Boss Updated"
    });
    await service.updateInternalAccount(actor(ROLES.systemOwner), created.account.id, {
      status: "disabled"
    });
    await service.resetInternalAccountPassword(actor(ROLES.systemOwner), created.account.id, {
      password: "ResetSecret123"
    });

    const logs = await operationLogs.listOperationLogs();
    expect(logs.map((log) => log.action)).toEqual([
      "internal_account_created",
      "internal_account_profile_updated",
      "internal_account_disabled",
      "internal_account_password_reset",
      "internal_account_enabled"
    ]);
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorId: "system_owner-account",
        actorRole: ROLES.systemOwner,
        targetType: "Account",
        targetId: created.account.id,
        createdAt: expect.any(String)
      })
    ]));

    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("CreateSecret123");
    expect(serialized).not.toContain("ResetSecret123");
    expect(serialized).not.toContain("temporaryPassword");
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("sessionToken");
  });
});
