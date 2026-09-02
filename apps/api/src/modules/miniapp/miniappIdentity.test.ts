import { describe, expect, it } from "vitest";
import { request } from "../receiver/testHelpers.js";
import { FORMAL_LOGIN_DEV_PASSWORD } from "../auth/devAuthAccounts.js";

const login = (payload: Record<string, unknown>) => request("/api/miniapp/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...payload, password: FORMAL_LOGIN_DEV_PASSWORD })
});

const bearer = (token: unknown) => ({ authorization: `Bearer ${String(token)}` });

describe("mini-program Account identity", () => {
  it("logs in a Business Account and restores the same AccountSession identity", async () => {
    const signedIn = await login({
      username: "receiver@sample-room.test",
      role: "boss",
      accountId: "spoofed-account"
    });
    expect(signedIn.response.status).toBe(200);
    expect(signedIn.body.identity).toMatchObject({
      status: "active",
      identityType: "account",
      accountId: "formal-account-receiver",
      accountType: "business",
      role: "receiver",
      homeRoute: "/pages/receiver/home",
      canScanOrder: true
    });
    const restored = await request("/api/miniapp/session", {
      headers: bearer(signedIn.body.sessionToken)
    });
    expect(restored.response.status).toBe(200);
    expect(restored.body.identity).toEqual(signedIn.body.identity);
  });

  it("logs in a Worker Account by phone and derives its active WorkerProfile", async () => {
    const signedIn = await login({ phoneNumber: "13800000001" });
    expect(signedIn.response.status).toBe(200);
    expect(signedIn.body.identity).toMatchObject({
      identityType: "account",
      accountId: "formal-account-worker-cutting",
      accountType: "worker",
      role: "worker",
      workerType: "cutting",
      activeWorkerProfileId: "formal-worker-profile-cutting",
      homeRoute: "/pages/worker/home",
      canScanOrder: true
    });
  });

  it("keeps client roles explicit and removes their order scanner", async () => {
    const admin = await login({ username: "client-admin@sample-room.test" });
    const business = await login({ username: "client-own@sample-room.test" });
    expect(admin.body.identity).toMatchObject({ role: "client_admin", canScanOrder: false });
    expect(business.body.identity).toMatchObject({ role: "client_business_user", canScanOrder: false });
  });

  it("rejects invalid credentials and does not accept a role or Account ID as identity", async () => {
    const wrong = await request("/api/miniapp/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "receiver@sample-room.test",
        password: "wrong-password",
        role: "boss",
        accountId: "formal-account-boss"
      })
    });
    expect(wrong.response.status).toBe(401);
    expect(wrong.body).toEqual({ error: "invalid_credentials" });
  });

  it("does not expose the removed WeChat binding identity routes", async () => {
    const removed = await request("/api/miniapp/bindings/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(removed.response.status).toBe(404);
  });

  it("refreshes and revokes the AccountSession through the Miniapp adapter", async () => {
    const signedIn = await login({ username: "planner@sample-room.test" });
    const token = signedIn.body.sessionToken;
    const refreshed = await request("/api/miniapp/auth/refresh", {
      method: "POST",
      headers: bearer(token)
    });
    expect(refreshed.response.status).toBe(200);
    expect(refreshed.body.identity).toMatchObject({ role: "planner" });
    const loggedOut = await request("/api/miniapp/auth/logout", {
      method: "POST",
      headers: bearer(token)
    });
    expect(loggedOut.body).toEqual({ ok: true });
    expect((await request("/api/miniapp/session", { headers: bearer(token) })).response.status).toBe(401);
  });

  it("does not leak passwords, hashes, AppSecret or session_key", async () => {
    const signedIn = await login({ username: "boss@sample-room.test" });
    const json = JSON.stringify(signedIn.body);
    expect(json).not.toContain(FORMAL_LOGIN_DEV_PASSWORD);
    expect(json).not.toContain("passwordHash");
    expect(json).not.toContain("session_key");
    expect(json).not.toContain("AppSecret");
  });
});
