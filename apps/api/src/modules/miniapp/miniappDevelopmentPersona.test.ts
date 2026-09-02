import { describe, expect, it } from "vitest";
import { request } from "../receiver/testHelpers.js";
import { developmentPersonasEnabled } from "./miniappDevelopmentPersonaService.js";

const loginTestMode = () => request("/api/miniapp/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "miniapp-test", password: "SampleRoom@123" })
});

const loginPersona = (key: string, testModeToken: string) => request(`/api/miniapp/dev/personas/${key}/login`, {
  method: "POST",
  headers: { authorization: `Bearer ${testModeToken}`, "content-type": "application/json" },
  body: "{}"
});

describe("mini-program development personas", () => {
  it("publishes fixed labels without exposing credentials or Account IDs", async () => {
    const testMode = await loginTestMode();
    const result = await request("/api/miniapp/dev/personas", {
      headers: { authorization: `Bearer ${String(testMode.body.testModeToken)}` }
    });
    expect(result.response.status).toBe(200);
    expect(result.body.personas).toEqual(expect.arrayContaining([
      { key: "receiver", label: "接单员" },
      { key: "client-admin", label: "客户主管" },
      { key: "cutting", label: "裁剪" }
    ]));
    const json = JSON.stringify(result.body);
    expect(json).not.toContain("accountId");
    expect(json).not.toContain("phoneNumber");
    expect(json).not.toContain("password");
  });

  it("creates real AccountSessions for fixed Business and Worker Accounts", async () => {
    const testMode = await loginTestMode();
    const testModeToken = String(testMode.body.testModeToken);
    const receiver = await loginPersona("receiver", testModeToken);
    const cutting = await loginPersona("cutting", testModeToken);
    expect(receiver.body.identity).toMatchObject({
      identityType: "account",
      accountId: "formal-account-receiver",
      role: "receiver"
    });
    expect(cutting.body.identity).toMatchObject({
      identityType: "account",
      accountId: "formal-account-worker-cutting",
      role: "worker",
      workerType: "cutting"
    });
    expect((await request("/api/miniapp/receiver/orders", {
      headers: { authorization: `Bearer ${String(receiver.body.sessionToken)}` }
    })).response.status).toBe(200);
  });

  it("requires and revokes the restricted test-mode session", async () => {
    expect((await request("/api/miniapp/dev/personas")).response.status).toBe(401);
    const testMode = await loginTestMode();
    const token = String(testMode.body.testModeToken);
    expect(testMode.body).toMatchObject({ testMode: true, homeRoute: "/pages/dev/test-mode" });
    expect((await request("/api/miniapp/dev/test-mode/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    })).response.status).toBe(200);
    expect((await request("/api/miniapp/dev/personas", {
      headers: { authorization: `Bearer ${token}` }
    })).response.status).toBe(401);
  });

  it("is unavailable in production and requires explicit non-production memory configuration", () => {
    expect(developmentPersonasEnabled({ NODE_ENV: "production", ENABLE_MINIAPP_FAKE_PERSONAS: "true", PERSISTENCE_MODE: "memory" })).toBe(false);
    expect(developmentPersonasEnabled({ NODE_ENV: "development", ENABLE_MINIAPP_FAKE_PERSONAS: "true", PERSISTENCE_MODE: "prisma" })).toBe(false);
    expect(developmentPersonasEnabled({ NODE_ENV: "development", ENABLE_MINIAPP_FAKE_PERSONAS: "true", PERSISTENCE_MODE: "memory" })).toBe(true);
  });
});
