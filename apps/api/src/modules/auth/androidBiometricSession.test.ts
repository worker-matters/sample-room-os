import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createInMemorySampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { createInMemoryRepositoryContext } from "../../db/repositories/memory/inMemoryRepositoryContext.js";
import { InMemoryIdentityStore } from "../../db/repositories/memory/inMemoryIdentityRepositories.js";
import { FORMAL_LOGIN_DEV_PASSWORD } from "./devAuthAccounts.js";

type JsonValue = Record<string, unknown>;
let server: Server;
let baseUrl: string;
let identityContext: ReturnType<typeof createInMemoryRepositoryContext>;

async function jsonRequest(pathname: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = (await response.json()) as JsonValue;
  return { response, body };
}

async function login(
  identity: { username?: string; phoneNumber?: string },
  clientType: "web" | "android"
) {
  return jsonRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...identity, password: FORMAL_LOGIN_DEV_PASSWORD, clientType })
  });
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("Android biometric quick-login session", () => {
  beforeEach(async () => {
    const identityStore = new InMemoryIdentityStore();
    const repository = createInMemorySampleRoomRepository();
    identityContext = createInMemoryRepositoryContext(undefined, identityStore);
    const app = createApp({
      repository,
      identityRepositoryContext: identityContext,
      env: { ...process.env, AUTH_MODE: "formal", PERSISTENCE_MODE: "memory" }
    });
    server = app.listen(0);
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test API did not bind.");
    baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it("extends only an authenticated Android session to the biometric window", async () => {
    const loggedIn = await login({ phoneNumber: "13800000001" }, "android");
    expect(loggedIn.response.status).toBe(200);
    const token = loggedIn.body.token as string;
    const originalExpiry = Date.parse(loggedIn.body.expiresAt as string);

    const refreshed = await jsonRequest("/api/auth/android-biometric-session", {
      method: "POST",
      headers: bearer(token)
    });

    expect(refreshed.response.status).toBe(200);
    expect(refreshed.body).toMatchObject({ token, clientType: "android" });
    expect(Date.parse(refreshed.body.expiresAt as string) - originalExpiry)
      .toBeGreaterThan(20 * 24 * 60 * 60 * 1000);
  });

  it("does not extend Web sessions through the Android biometric endpoint", async () => {
    const loggedIn = await login({ username: "planner@sample-room.test" }, "web");
    const token = loggedIn.body.token as string;

    const refreshed = await jsonRequest("/api/auth/android-biometric-session", {
      method: "POST",
      headers: bearer(token)
    });

    expect(refreshed.response.status).toBe(403);
    expect(refreshed.body).toEqual({ error: "android_session_required" });
  });

  it("rejects a revoked Android session", async () => {
    const loggedIn = await login({ phoneNumber: "13800000001" }, "android");
    const token = loggedIn.body.token as string;
    await jsonRequest("/api/auth/logout", { method: "POST", headers: bearer(token) });

    const refreshed = await jsonRequest("/api/auth/android-biometric-session", {
      method: "POST",
      headers: bearer(token)
    });

    expect(refreshed.response.status).toBe(401);
    expect(refreshed.body).toEqual({ error: "unauthenticated" });
  });

  it("rejects biometric quick login after a worker password reset", async () => {
    const loggedIn = await login({ phoneNumber: "13800000001" }, "android");
    const token = loggedIn.body.token as string;
    await identityContext.accounts.updateAccount("formal-account-worker-cutting", {
      lastPasswordResetAt: new Date(Date.now() + 1_000).toISOString()
    });

    const refreshed = await jsonRequest("/api/auth/android-biometric-session", {
      method: "POST",
      headers: bearer(token)
    });

    expect(refreshed.response.status).toBe(401);
    expect(refreshed.body).toEqual({ error: "unauthenticated" });
  });

  it("rejects a planner biometric session after the System Owner resets the password", async () => {
    const planner = await login({ username: "planner@sample-room.test" }, "android");
    const owner = await login({ username: "system-owner@sample-room.test" }, "web");
    expect(planner.response.status).toBe(200);
    expect(owner.response.status).toBe(200);

    const reset = await jsonRequest(
      "/api/system-owner/internal-accounts/formal-account-planner/reset-password",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...bearer(owner.body.token as string)
        },
        body: JSON.stringify({ password: "PlannerResetPassword123" })
      }
    );
    expect(reset.response.status).toBe(200);

    const refreshed = await jsonRequest("/api/auth/android-biometric-session", {
      method: "POST",
      headers: bearer(planner.body.token as string)
    });

    expect(refreshed.response.status).toBe(401);
    expect(refreshed.body).toEqual({ error: "unauthenticated" });
  });
});
