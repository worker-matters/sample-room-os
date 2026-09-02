import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ROLES } from "@sample-room/shared";
import { createApp } from "../../app.js";
import {
  InMemoryIdentityStore
} from "../../db/repositories/memory/inMemoryIdentityRepositories.js";
import { createInMemoryRepositoryContext } from "../../db/repositories/memory/inMemoryRepositoryContext.js";
import { createInMemorySampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { FORMAL_LOGIN_DEV_PASSWORD } from "../auth/devAuthAccounts.js";

type JsonValue = Record<string, unknown>;
let server: Server;
let baseUrl: string;
let identityStore: InMemoryIdentityStore;
let repository: ReturnType<typeof createInMemorySampleRoomRepository>;
let repositoryContext: ReturnType<typeof createInMemoryRepositoryContext>;

function formalEnv(): NodeJS.ProcessEnv {
  return { ...process.env, AUTH_MODE: "formal", PERSISTENCE_MODE: "memory" };
}

async function startTestApp() {
  identityStore = new InMemoryIdentityStore();
  repository = createInMemorySampleRoomRepository();
  repositoryContext = createInMemoryRepositoryContext(undefined, identityStore);
  const app = createApp({
    repository,
    identityRepositoryContext: repositoryContext,
    env: formalEnv()
  });
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test API did not bind.");
  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function jsonRequest(pathname: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = (await response.json()) as JsonValue;
  return { response, body };
}

async function login(identity: { username?: string; phoneNumber?: string }, password = FORMAL_LOGIN_DEV_PASSWORD) {
  return jsonRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...identity, password, clientType: "web" })
  });
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function createInternalAccount(
  token: string,
  input: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
) {
  return jsonRequest("/api/system-owner/internal-accounts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...bearer(token),
      ...extraHeaders
    },
    body: JSON.stringify(input)
  });
}

describe("formal internal account API authorization", () => {
  beforeEach(startTestApp);
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it("creates boss as a Business Account through a System Owner AccountSession", async () => {
    const owner = await login({ username: "system-owner@sample-room.test" });
    const workerProfileCount = identityStore.workerProfiles.length;
    const created = await createInternalAccount(owner.body.token as string, {
      username: "factory-boss@example.test",
      displayName: "Factory Boss",
      role: ROLES.boss,
      password: "FactoryBossTemporary123"
    });

    expect(created.response.status).toBe(201);
    expect(created.body.account).toMatchObject({
      username: "factory-boss@example.test",
      displayName: "Factory Boss",
      role: ROLES.boss,
      status: "active"
    });
    const account = identityStore.accounts.find((item) => item.username === "factory-boss@example.test");
    expect(account).toMatchObject({
      accountType: "business",
      role: ROLES.boss,
      status: "active",
      mustChangePasswordAtNextLogin: true
    });
    expect(identityStore.workerProfiles).toHaveLength(workerProfileCount);
    expect(identityStore.workerProfiles.some((profile) => profile.accountId === account!.id)).toBe(false);
    expect(await repository.findClientUserByAccountId(account!.id)).toBeUndefined();

    const newBossLogin = await login(
      { username: "factory-boss@example.test" },
      "FactoryBossTemporary123"
    );
    expect(newBossLogin.response.status).toBe(200);
    expect(newBossLogin.body.user).toMatchObject({
      accountId: account!.id,
      accountType: "business",
      role: ROLES.boss,
      mustChangePassword: true
    });
    const blockedBeforePasswordChange = await jsonRequest("/api/system-owner/internal-accounts", {
      headers: bearer(newBossLogin.body.token as string)
    });
    expect(blockedBeforePasswordChange.response.status).toBe(403);
    expect(blockedBeforePasswordChange.body).toEqual({ error: "password_change_required" });

    const logs = await repositoryContext.operationLogs!.listOperationLogs();
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorId: "formal-account-system-owner",
        actorRole: ROLES.systemOwner,
        action: "internal_account_created",
        targetType: "Account",
        targetId: account!.id
      })
    ]));
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain("FactoryBossTemporary123");
    expect(serializedLogs).not.toContain("passwordHash");
  });

  it("enforces the System Owner and boss creation matrices", async () => {
    const owner = await login({ username: "system-owner@sample-room.test" });
    const boss = await login({ username: "boss@sample-room.test" });

    for (const role of [ROLES.boss, ROLES.receiver, ROLES.planner, ROLES.patternMaker] as const) {
      const result = await createInternalAccount(owner.body.token as string, {
        username: `owner-created-${role}@example.test`,
        displayName: `Owner Created ${role}`,
        role
      });
      expect(result.response.status).toBe(201);
    }

    for (const role of [ROLES.receiver, ROLES.planner, ROLES.patternMaker] as const) {
      const result = await createInternalAccount(boss.body.token as string, {
        username: `boss-created-${role}@example.test`,
        displayName: `Boss Created ${role}`,
        role
      });
      expect(result.response.status).toBe(201);
    }

    const forbiddenBoss = await createInternalAccount(
      boss.body.token as string,
      {
        username: "boss-created-boss@example.test",
        displayName: "Boss Created Boss",
        role: ROLES.boss,
        actorRole: ROLES.systemOwner,
        accountId: "formal-account-system-owner"
      },
      {
        "x-dev-role": ROLES.systemOwner,
        "x-dev-user-id": "formal-account-system-owner"
      }
    );
    expect(forbiddenBoss.response.status).toBe(403);
  });

  it("rejects unauthorized actors, out-of-flow target roles, and duplicate usernames", async () => {
    const unauthorizedIdentities = [
      { username: "receiver@sample-room.test" },
      { username: "planner@sample-room.test" },
      { username: "pattern-maker@sample-room.test" },
      { phoneNumber: "13800000001" },
      { username: "client-admin@sample-room.test" },
      { username: "client-own@sample-room.test" }
    ];
    for (const [index, identity] of unauthorizedIdentities.entries()) {
      const session = await login(identity);
      const result = await createInternalAccount(
        session.body.token as string,
        {
          username: `unauthorized-${index}@example.test`,
          displayName: `Unauthorized ${index}`,
          role: ROLES.receiver
        },
        {
          "x-dev-role": ROLES.systemOwner,
          "x-dev-user-id": "formal-account-system-owner"
        }
      );
      expect(result.response.status).toBe(403);
    }

    const owner = await login({ username: "system-owner@sample-room.test" });
    for (const role of [
      ROLES.systemOwner,
      ROLES.worker,
      ROLES.clientAdmin,
      ROLES.clientBusinessUser
    ] as const) {
      const result = await createInternalAccount(owner.body.token as string, {
        username: `invalid-${role}@example.test`,
        displayName: `Invalid ${role}`,
        role
      });
      expect(result.response.status).toBe(400);
    }

    const first = await createInternalAccount(owner.body.token as string, {
      username: "duplicate-internal@example.test",
      displayName: "Duplicate Internal",
      role: ROLES.receiver
    });
    const duplicate = await createInternalAccount(owner.body.token as string, {
      username: "DUPLICATE-INTERNAL@example.test",
      displayName: "Duplicate Internal Again",
      role: ROLES.planner
    });
    expect(first.response.status).toBe(201);
    expect(duplicate.response.status).toBe(409);
  });
});
