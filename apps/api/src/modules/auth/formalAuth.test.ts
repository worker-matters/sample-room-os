import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ROLES } from "@sample-room/shared";
import { createApp } from "../../app.js";
import { createInMemorySampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { createInMemoryRepositoryContext } from "../../db/repositories/memory/inMemoryRepositoryContext.js";
import {
  InMemoryIdentityStore
} from "../../db/repositories/memory/inMemoryIdentityRepositories.js";
import { FORMAL_LOGIN_DEV_PASSWORD } from "./devAuthAccounts.js";

type JsonValue = Record<string, unknown>;
let server: Server;
let baseUrl: string;
let identityStore: InMemoryIdentityStore;
let repository: ReturnType<typeof createInMemorySampleRoomRepository>;
let identityContext: ReturnType<typeof createInMemoryRepositoryContext>;

function formalEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, AUTH_MODE: "formal", PERSISTENCE_MODE: "memory", ...overrides };
}

async function startTestApp(envOverrides: NodeJS.ProcessEnv = {}) {
  identityStore = new InMemoryIdentityStore();
  repository = createInMemorySampleRoomRepository();
  identityContext = createInMemoryRepositoryContext(undefined, identityStore);
  const app = createApp({
    repository,
    identityRepositoryContext: identityContext,
    env: formalEnv(envOverrides)
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

async function login(
  identity: { username?: string; phoneNumber?: string },
  password = FORMAL_LOGIN_DEV_PASSWORD,
  clientType: "web" | "miniapp" | "android" = "web"
) {
  return jsonRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-app-version": "auth-test" },
    body: JSON.stringify({ ...identity, password, clientType })
  });
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("Account / AccountSession formal auth", () => {
  beforeEach(startTestApp);
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it("logs in a Business Account by username and returns the unified identity", async () => {
    const result = await login({ username: "receiver@sample-room.test" });
    expect(result.response.status).toBe(200);
    expect(result.body.user).toMatchObject({
      id: "formal-account-receiver",
      accountId: "formal-account-receiver",
      accountType: "business",
      role: ROLES.receiver,
      homeRoute: "/receiver/home"
    });
    expect(result.body).toMatchObject({ clientType: "web", expiresAt: expect.any(String) });
    expect(JSON.stringify(result.body)).not.toContain("passwordHash");
  });

  it("lets a signed-in System Owner maintain only its own account and password", async () => {
    const loggedIn = await login({ username: "system-owner@sample-room.test" });
    const token = loggedIn.body.token as string;
    const profile = await jsonRequest("/api/auth/account-security", {
      headers: bearer(token)
    });
    expect(profile.body.profile).toMatchObject({
      accountId: "formal-account-system-owner",
      username: "system-owner@sample-room.test",
      roleLabel: "System Owner"
    });

    const renamed = await jsonRequest("/api/auth/account-security/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json", ...bearer(token) },
      body: JSON.stringify({
        username: "system-owner-renamed@sample-room.test",
        displayName: "System Owner Renamed",
        contact: "factory-local",
        currentPassword: FORMAL_LOGIN_DEV_PASSWORD
      })
    });
    expect(renamed.response.status).toBe(200);
    expect(renamed.body).toMatchObject({
      signedOut: true,
      profile: {
        accountId: "formal-account-system-owner",
        username: "system-owner-renamed@sample-room.test",
        displayName: "System Owner Renamed",
        contact: "factory-local",
        roleLabel: "System Owner"
      }
    });
    expect((await login({ username: "system-owner@sample-room.test" })).response.status).toBe(401);

    const renamedLogin = await login({ username: "system-owner-renamed@sample-room.test" });
    const renamedToken = renamedLogin.body.token as string;
    const wrongCurrentPassword = await jsonRequest("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(renamedToken) },
      body: JSON.stringify({
        currentPassword: "wrong-password",
        newPassword: "SystemOwnerChanged123!",
        confirmPassword: "SystemOwnerChanged123!"
      })
    });
    expect(wrongCurrentPassword.response.status).toBe(401);
    expect(wrongCurrentPassword.body).toEqual({ error: "invalid_credentials" });

    const changed = await jsonRequest("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(renamedToken) },
      body: JSON.stringify({
        currentPassword: FORMAL_LOGIN_DEV_PASSWORD,
        newPassword: "SystemOwnerChanged123!",
        confirmPassword: "SystemOwnerChanged123!"
      })
    });
    expect(changed.body).toEqual({ ok: true });
    expect(
      (await login({ username: "system-owner-renamed@sample-room.test" })).response.status
    ).toBe(401);
    expect(
      (
        await login(
          { username: "system-owner-renamed@sample-room.test" },
          "SystemOwnerChanged123!"
        )
      ).response.status
    ).toBe(200);
  });

  it("logs in a Worker Account by phoneNumber and resolves its active WorkerProfile", async () => {
    const result = await login({ phoneNumber: "13800000001" }, FORMAL_LOGIN_DEV_PASSWORD, "android");
    expect(result.response.status).toBe(200);
    expect(result.body.user).toMatchObject({
      accountId: "formal-account-worker-cutting",
      accountType: "worker",
      role: ROLES.worker,
      homeRoute: "/worker/scan",
      activeWorkerProfileId: "formal-worker-profile-cutting"
    });
    expect(result.body).toMatchObject({ clientType: "android" });
  });

  it("does not mix Business recovery phone numbers with Worker login identifiers", async () => {
    const businessLogin = await login({ username: "receiver@sample-room.test" });
    const businessProfile = await jsonRequest("/api/auth/account-security", {
      headers: bearer(businessLogin.body.token as string)
    });
    const phoneCollisionLogin = await login({ phoneNumber: "13800000001" });
    const workerByUsername = await login({ username: "13800000001" });
    const ambiguous = await login({ username: "receiver@sample-room.test", phoneNumber: "13800000001" });
    expect(businessProfile.body.profile).toMatchObject({
      accountId: "formal-account-receiver",
      username: "receiver@sample-room.test",
      phoneNumber: "13800000001"
    });
    expect(phoneCollisionLogin.body.user).toMatchObject({
      accountId: "formal-account-worker-cutting",
      accountType: "worker"
    });
    expect(workerByUsername.response.status).toBe(401);
    expect(ambiguous.response.status).toBe(401);
  });

  it("rejects pending, suspended, unknown, and invalid-password accounts uniformly", async () => {
    const attempts = await Promise.all([
      login({ username: "pending@sample-room.test" }),
      login({ username: "suspended@sample-room.test" }),
      login({ username: "missing@sample-room.test" }),
      login({ username: "receiver@sample-room.test" }, "wrong-password")
    ]);
    for (const attempt of attempts) {
      expect(attempt.response.status).toBe(401);
      expect(attempt.body.error).toBe("invalid_credentials");
    }
  });

  it("does not account-lock inactive or unknown identifiers", async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect((await login({ username: "suspended@sample-room.test" })).response.status).toBe(401);
      expect((await login({ username: "still-missing@sample-room.test" })).response.status).toBe(401);
    }
  });

  it("sets Secure cookies only for HTTPS confirmed through a configured trusted proxy", async () => {
    const untrustedForwarded = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https"
      },
      body: JSON.stringify({
        username: "receiver@sample-room.test",
        password: FORMAL_LOGIN_DEV_PASSWORD,
        clientType: "web"
      })
    });
    expect(untrustedForwarded.headers.get("set-cookie")).not.toContain("Secure");

    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
    await startTestApp({ SAMPLE_ROOM_TRUST_PROXY: "loopback" });
    const trustedHttps = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https"
      },
      body: JSON.stringify({
        username: "planner@sample-room.test",
        password: FORMAL_LOGIN_DEV_PASSWORD,
        clientType: "web"
      })
    });
    const lanHttp = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "boss@sample-room.test",
        password: FORMAL_LOGIN_DEV_PASSWORD,
        clientType: "web"
      })
    });
    expect(trustedHttps.headers.get("set-cookie")).toContain("Secure");
    expect(lanHttp.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("locks repeated Web login failures without revealing whether the account exists", async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await login({ username: "receiver@sample-room.test" }, "wrong-password");
      expect(result.response.status).toBe(401);
      expect(result.body).toEqual({ error: "invalid_credentials" });
    }
    const lockTrigger = await login({ username: "receiver@sample-room.test" }, "wrong-password");
    const lockedCorrectPassword = await login({ username: "receiver@sample-room.test" });
    expect(lockTrigger.response.status).toBe(429);
    expect(lockedCorrectPassword.response.status).toBe(429);
    expect(lockTrigger.body).toEqual({ error: "invalid_credentials" });
    expect(lockedCorrectPassword.body).toEqual({ error: "invalid_credentials" });
  });

  it("serializes concurrent password failures for the same account", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        login({ username: "receiver@sample-room.test" }, `concurrent-wrong-${index}`)
      )
    );
    expect(attempts.filter((attempt) => attempt.response.status === 401)).toHaveLength(4);
    expect(attempts.filter((attempt) => attempt.response.status === 429)).toHaveLength(1);
    expect((await login({ username: "receiver@sample-room.test" })).response.status).toBe(429);
  });

  it("does not count invalid-client requests as account password failures", async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await login(
        { username: "receiver@sample-room.test" },
        `wrong-before-validation-${attempt}`
      )).response.status).toBe(401);
    }
    const invalidClient = await jsonRequest("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "receiver@sample-room.test",
        password: FORMAL_LOGIN_DEV_PASSWORD,
        clientType: "invalid-client"
      })
    });
    expect(invalidClient.response.status).toBe(400);
    expect((await login({ username: "receiver@sample-room.test" })).response.status).toBe(200);
  });

  it("applies the same protection to miniapp login and clears failures after success", async () => {
    const miniappLogin = (password: string) => jsonRequest("/api/miniapp/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "planner@sample-room.test", password })
    });
    expect((await miniappLogin("wrong-one")).response.status).toBe(401);
    expect((await miniappLogin("wrong-two")).response.status).toBe(401);
    expect((await miniappLogin(FORMAL_LOGIN_DEV_PASSWORD)).response.status).toBe(200);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await miniappLogin(`wrong-after-success-${attempt}`)).response.status).toBe(401);
    }
    expect((await miniappLogin("fifth-wrong-after-success")).response.status).toBe(429);

    const logs = await identityContext.operationLogs?.listOperationLogs();
    const loginLogs = logs?.filter((entry) => entry.action.startsWith("auth.login.")) ?? [];
    expect(loginLogs.some((entry) => entry.action === "auth.login.success")).toBe(true);
    expect(loginLogs.some((entry) => entry.action === "auth.login.failure")).toBe(true);
    expect(JSON.stringify(loginLogs)).not.toContain(FORMAL_LOGIN_DEV_PASSWORD);
    expect(JSON.stringify(loginLogs)).not.toContain("sessionToken");
  });

  it("limits one source IP to twenty login attempts in ten minutes", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await login({ username: "receiver@sample-room.test" })).response.status).toBe(200);
    }
    const limited = await login({ username: "receiver@sample-room.test" });
    expect(limited.response.status).toBe(429);
    expect(limited.body).toEqual({ error: "invalid_credentials" });
  });

  it("uses explicit client_admin and client_business_user roles", async () => {
    const admin = await login({ username: "client-admin@sample-room.test" });
    const business = await login({ username: "client-own@sample-room.test" });
    expect(admin.body.user).toMatchObject({
      role: ROLES.clientAdmin,
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin",
      clientAccessScope: "customer_all",
      homeRoute: "/client/home"
    });
    expect(business.body.user).toMatchObject({
      role: ROLES.clientBusinessUser,
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      clientAccessScope: "own",
      homeRoute: "/client/home"
    });
  });

  it("persists only a token hash in AccountSession and restores the current login", async () => {
    const result = await login({ username: "planner@sample-room.test" }, FORMAL_LOGIN_DEV_PASSWORD, "miniapp");
    const token = result.body.token as string;
    expect(identityStore.accountSessions).toHaveLength(1);
    expect(identityStore.accountSessions[0]).toMatchObject({
      accountId: "formal-account-planner",
      clientType: "miniapp",
      revokedAt: null,
      appVersion: "auth-test"
    });
    expect(identityStore.accountSessions[0]!.sessionTokenHash).not.toBe(token);

    const me = await jsonRequest("/api/auth/me", { headers: bearer(token) });
    expect(me.response.status).toBe(200);
    expect(me.body.user).toMatchObject({ accountId: "formal-account-planner", role: ROLES.planner });
    expect(identityStore.accountSessions[0]!.lastSeenAt).toEqual(expect.any(String));
  });

  it("refreshes and revokes an AccountSession", async () => {
    const result = await login({ username: "receiver@sample-room.test" });
    const token = result.body.token as string;
    const originalExpiry = identityStore.accountSessions[0]!.expiresAt;
    identityStore.accountSessions[0]!.expiresAt = new Date(Date.now() + 1000).toISOString();
    const refreshed = await jsonRequest("/api/auth/refresh", {
      method: "POST",
      headers: bearer(token)
    });
    expect(refreshed.response.status).toBe(200);
    expect(Date.parse(refreshed.body.expiresAt as string)).toBeGreaterThan(Date.parse(originalExpiry) - 1000);

    const logout = await jsonRequest("/api/auth/logout", { method: "POST", headers: bearer(token) });
    const me = await jsonRequest("/api/auth/me", { headers: bearer(token) });
    expect(logout.body).toEqual({ ok: true });
    expect(identityStore.accountSessions[0]!.revokedAt).toEqual(expect.any(String));
    expect(me.response.status).toBe(401);
  });

  it("rejects expired AccountSession tokens", async () => {
    const result = await login({ username: "receiver@sample-room.test" });
    const token = result.body.token as string;
    identityStore.accountSessions[0]!.expiresAt = new Date(Date.now() - 1).toISOString();
    const me = await jsonRequest("/api/auth/me", { headers: bearer(token) });
    expect(me.response.status).toBe(401);
  });

  it("rejects an existing session immediately after the Account is suspended", async () => {
    const result = await login({ username: "receiver@sample-room.test" });
    const account = identityStore.accounts.find((item) => item.id === "formal-account-receiver")!;
    account.status = "suspended";
    const me = await jsonRequest("/api/auth/me", {
      headers: bearer(result.body.token as string)
    });
    expect(me.response.status).toBe(401);
  });

  it("reloads the current client role and binding for every existing session", async () => {
    const result = await login({ username: "client-admin@sample-room.test" });
    const token = result.body.token as string;
    const account = identityStore.accounts.find((item) => item.id === "formal-account-client-admin")!;

    account.role = ROLES.clientBusinessUser;
    await repository.updateClientUser("mock-client-user-admin", {
      clientAccessScope: "own"
    });

    const downgraded = await jsonRequest("/api/auth/me", { headers: bearer(token) });
    expect(downgraded.response.status).toBe(200);
    expect(downgraded.body.user).toMatchObject({
      role: ROLES.clientBusinessUser,
      clientAccessScope: "own"
    });

    await repository.updateClientUser("mock-client-user-admin", { status: "archived" });
    const disabledProfile = await jsonRequest("/api/auth/me", { headers: bearer(token) });
    expect(disabledProfile.response.status).toBe(401);
  });

  it("changes a password through Account and revokes the current session", async () => {
    const result = await login({ username: "receiver@sample-room.test" });
    const token = result.body.token as string;
    const changed = await jsonRequest("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(token) },
      body: JSON.stringify({
        currentPassword: FORMAL_LOGIN_DEV_PASSWORD,
        newPassword: "ReceiverChanged123",
        confirmPassword: "ReceiverChanged123"
      })
    });
    const oldLogin = await login({ username: "receiver@sample-room.test" });
    const newLogin = await login({ username: "receiver@sample-room.test" }, "ReceiverChanged123");
    expect(changed.body).toEqual({ ok: true });
    expect(identityStore.accountSessions[0]!.revokedAt).toEqual(expect.any(String));
    expect(oldLogin.response.status).toBe(401);
    expect(newLogin.response.status).toBe(200);
  });

  it("keeps the existing administrator password-reset path backed by Account", async () => {
    const boss = await login({ username: "boss@sample-room.test" });
    const reset = await jsonRequest(
      "/api/system-owner/internal-accounts/formal-account-receiver/reset-password",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...bearer(boss.body.token as string)
        },
        body: JSON.stringify({ password: "RecoveredReceiver123" })
      }
    );
    const recovered = await login(
      { username: "receiver@sample-room.test" },
      "RecoveredReceiver123"
    );
    expect(reset.response.status).toBe(200);
    expect(recovered.response.status).toBe(200);
  });

  it("does not trust role or account identifiers supplied by the client", async () => {
    const result = await jsonRequest("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "receiver@sample-room.test",
        password: FORMAL_LOGIN_DEV_PASSWORD,
        accountId: "formal-account-boss",
        role: ROLES.boss,
        activeWorkerProfileId: "forged"
      })
    });
    expect(result.body.user).toMatchObject({
      accountId: "formal-account-receiver",
      role: ROLES.receiver
    });
    expect(result.body.user).not.toHaveProperty("activeWorkerProfileId");
  });
});
