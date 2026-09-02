import { describe, expect, it } from "vitest";
import { ORDER_STAGES, ROLES } from "@sample-room/shared";
import { createClientOrder, headers, identityRepositories, rawRequest, repository, request, type JsonValue } from "../receiver/testHelpers.js";

function expectNoRealSensitiveValue(value: string) {
  expect(value).not.toMatch(/postgresql:\/\//i);
  expect(value).not.toMatch(/mysql:\/\//i);
  expect(value).not.toMatch(/mongodb:\/\//i);
  expect(value).not.toMatch(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
  expect(value).not.toMatch(/https?:\/\/(?:\d{1,3}\.){3}\d{1,3}/i);
  expect(value).not.toMatch(/\b192\.168\.\d{1,3}\.\d{1,3}\b/);
  expect(value).not.toMatch(/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  expect(value).not.toMatch(/\b172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b/);
  expect(value).not.toMatch(/[A-Z]:\\/i);
  expect(value).not.toMatch(/\\\\[^\\]+\\[^\\]+/);
  expect(value).not.toContain("secret-scan-token");
  expect(value).not.toContain("secret-registration-token");
  expect(value).not.toContain("secret-device-token");
  expect(value).not.toContain("orders/secret/internal.pdf");
  expect(value).not.toContain("secret-checksum");
  expect(value).not.toContain("secret-internal.pdf");
  expect(value).not.toContain("Mock Style MAINT-001");
}

describe("system owner maintenance snapshot API", () => {
  it("returns read-only operational counts only to system owner", async () => {
    const created = await createClientOrder("MAINT-001");
    const orderId = (created.body.order as JsonValue).id as string;
    await repository.updateOrder(orderId, { stage: ORDER_STAGES.patternDoing });
    await repository.createOrderAttachment({
      orderId,
      fileName: "secret-internal.pdf",
      mimeType: "application/pdf",
      size: 12,
      category: "internal",
      uploadedBy: "mock-receiver",
      uploadedByRole: ROLES.receiver,
      visibility: "internal_only",
      storageKey: "orders/secret/internal.pdf",
      checksum: "secret-checksum"
    });
    await identityRepositories.identityQrTokens.createIdentityQrToken({
      tokenHash: "f".repeat(64),
      purpose: "REGISTER_WORKER",
      initialRole: ROLES.worker,
      workerType: "cutting",
      issuedByAccountId: "formal-account-boss",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    await repository.createOrderScanToken({
      orderId,
      token: "secret-scan-token",
      stage: ORDER_STAGES.patternDoing
    });
    await repository.createScanRecord({
      orderId,
      stage: "pattern",
      orderStage: ORDER_STAGES.patternDoing,
      action: "start",
      scanAction: "pattern_start",
      actorAccountId: "formal-account-worker-cutting",
      workerProfileId: "formal-worker-profile-cutting",
      actorType: "production_worker",
      actorRole: ROLES.worker,
      workerId: "formal-worker-profile-cutting",
      workerName: "Cutting Worker"
    });
    await repository.upsertPricingRecord(orderId, {
      quotedPrice: 200,
      costAmount: 90
    });

    const systemOwner = await request("/api/system-owner/maintenance/snapshot", {
      headers: headers("system_owner")
    });
    const bossAttempt = await request("/api/system-owner/maintenance/snapshot", {
      headers: headers("boss")
    });
    const clientAttempt = await request("/api/system-owner/maintenance/snapshot", {
      headers: headers("client_business_user")
    });
    const responseText = JSON.stringify(systemOwner.body);

    expect(systemOwner.response.status).toBe(200);
    expect(systemOwner.body.snapshot).toMatchObject({
      counts: {
        orders: expect.objectContaining({ total: 1, inProduction: 1 }),
        workers: expect.objectContaining({
          workerAccounts: 7,
          workerProfiles: 7,
          identityQrTokens: 1,
          usableIdentityQrTokens: 1
        }),
        scan: expect.objectContaining({ records: 1, ordersWithRecords: 1 }),
        pricing: expect.objectContaining({
          pricingRecords: 1,
          recordsWithQuotedPrice: 1,
          recordsWithCost: 1,
          extraChargeRows: 0
        })
      },
      safety: {
        containsDatabaseUrl: false,
        containsStorageRoot: false,
        containsScanTokens: false,
        containsStorageKeys: false,
        containsPricingAmounts: false
      }
    });
    expect(responseText).not.toContain("secret-scan-token");
    expect(responseText).not.toContain("secret-registration-token");
    expect(responseText).not.toContain("secret-device-token");
    expect(responseText).not.toContain("orders/secret/internal.pdf");
    expect(responseText).not.toContain("secret-checksum");
    expect(responseText).not.toContain("quotedPrice");
    expect(responseText).not.toContain("costAmount");
    expect(bossAttempt.response.status).toBe(403);
    expect(clientAttempt.response.status).toBe(403);
  });

  it("returns redacted runtime status and runtime checks to system owner only", async () => {
    const status = await request("/api/system-owner/maintenance/runtime-status", {
      headers: headers("system_owner")
    });
    const checks = await request("/api/system-owner/maintenance/runtime-checks", {
      method: "POST",
      headers: headers("system_owner")
    });
    const bossAttempt = await request("/api/system-owner/maintenance/runtime-status", {
      headers: headers("boss")
    });
    const responseText = JSON.stringify({ status: status.body, checks: checks.body });

    expect(status.response.status).toBe(200);
    expect(status.body.runtimeStatus).toMatchObject({
      safety: {
        redacted: true,
        containsDatabaseUrl: false,
        containsStorageRoot: false,
        containsToken: false,
        containsStorageKey: false
      }
    });
    expect(checks.response.status).toBe(200);
    expect(checks.body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "api_health" }),
        expect.objectContaining({ key: "attachment_api_boundary" })
      ])
    );
    expectNoRealSensitiveValue(responseText);
    expect(bossAttempt.response.status).toBe(403);
  });

  it("downloads a generated maintenance summary markdown without leaking real values", async () => {
    const created = await createClientOrder("MAINT-001");
    const orderId = (created.body.order as JsonValue).id as string;
    await repository.createOrderAttachment({
      orderId,
      fileName: "secret-internal.pdf",
      mimeType: "application/pdf",
      size: 12,
      category: "internal",
      uploadedBy: "mock-receiver",
      uploadedByRole: ROLES.receiver,
      visibility: "internal_only",
      storageKey: "orders/secret/internal.pdf",
      checksum: "secret-checksum"
    });
    await identityRepositories.identityQrTokens.createIdentityQrToken({
      tokenHash: "e".repeat(64),
      purpose: "REGISTER_WORKER",
      initialRole: ROLES.worker,
      workerType: "sewing",
      issuedByAccountId: "formal-account-boss",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    await repository.createOrderScanToken({
      orderId,
      token: "secret-scan-token",
      stage: ORDER_STAGES.patternDoing
    });

    const systemOwner = await rawRequest("/api/system-owner/maintenance/summary-markdown", {
      method: "POST",
      headers: headers("system_owner")
    });
    const bossAttempt = await rawRequest("/api/system-owner/maintenance/summary-markdown", {
      method: "POST",
      headers: headers("boss")
    });
    const markdown = await systemOwner.text();

    expect(systemOwner.status).toBe(200);
    expect(systemOwner.headers.get("content-type")).toContain("text/markdown");
    expect(systemOwner.headers.get("content-disposition")).toContain(
      "sample-room-maintenance-summary-"
    );
    expect(markdown).toContain("# Sample Room System Maintenance Summary");
    expect(markdown).toContain("DATABASE_URL");
    expect(markdown).toContain("passwords");
    expect(markdown).toContain("tokens");
    expect(markdown).toContain("storageKey");
    expect(markdown).toContain("UNC path");
    expect(markdown).toContain("## 4. Health Check Results");
    expectNoRealSensitiveValue(markdown);
    expect(bossAttempt.status).toBe(403);
  });

  it("lets only system owner persist audited Web/API base addresses and download the novice guide", async () => {
    const updated = await request("/api/system-owner/maintenance/endpoint-config", {
      method: "PUT",
      headers: headers("system_owner"),
      body: JSON.stringify({
        publicWebBaseUrl: "https://scan.example.com/",
        publicApiBaseUrl: "https://api.example.com/",
        lanWebBaseUrl: "http://192.168.10.20:5173/",
        lanApiBaseUrl: "http://192.168.10.20:3001/"
      })
    });
    expect(updated.response.status).toBe(200);
    expect(updated.body.config).toMatchObject({
      publicWebBaseUrl: "https://scan.example.com",
      publicApiBaseUrl: "https://api.example.com",
      lanWebBaseUrl: "http://192.168.10.20:5173",
      lanApiBaseUrl: "http://192.168.10.20:3001"
    });
    const published = await request("/api/miniapp/network-config");
    expect(published.response.status).toBe(200);
    expect(published.response.headers.get("cache-control")).toContain("no-store");
    expect(published.body).toMatchObject({
      apiVersion: "v1",
      publicApiBaseUrl: "https://api.example.com",
      lanApiBaseUrl: "http://192.168.10.20:3001"
    });
    expect(published.body).not.toHaveProperty("updatedBy");
    expect(published.body).not.toHaveProperty("publicWebBaseUrl");
    const workerQr = await request("/api/workers/registration-tokens", {
      method: "POST",
      headers: headers("boss", { userId: "formal-account-boss" }),
      body: JSON.stringify({ workerType: "cutting" })
    });
    const registrationUrls = workerQr.body.registrationUrls as JsonValue;
    expect(registrationUrls.public).toMatch(/^https:\/\/scan\.example\.com\/workers\/register\//);
    expect(registrationUrls.lan).toMatch(/^http:\/\/192\.168\.10\.20:5173\/workers\/register\//);
    const bossAttempt = await request("/api/system-owner/maintenance/endpoint-config", {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({ publicWebBaseUrl: "https://bad.example.com" })
    });
    expect(bossAttempt.response.status).toBe(403);

    const guide = await rawRequest("/api/system-owner/maintenance/endpoint-guide", {
      method: "POST",
      headers: headers("system_owner")
    });
    expect(guide.status).toBe(200);
    expect(await guide.text()).toContain("Web 基础地址");
  });

  it("lets only system owner manage an expiring release-safe mini-program preview", async () => {
    const enabled = await request("/api/system-owner/maintenance/miniapp-release-preview", {
      method: "PUT",
      headers: headers("system_owner"),
      body: JSON.stringify({
        enabled: true,
        username: "release-preview-test",
        password: "PreviewOnly@123",
        expiresInHours: 1
      })
    });
    expect(enabled.response.status).toBe(200);
    expect(enabled.body.config).toMatchObject({
      enabled: true,
      configured: true,
      username: "release-preview-test"
    });
    expect(JSON.stringify(enabled.body)).not.toContain("PreviewOnly@123");
    expect(JSON.stringify(enabled.body)).not.toContain("passwordHash");

    expect((await request("/api/system-owner/maintenance/miniapp-release-preview", {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({ enabled: false, username: "release-preview-test" })
    })).response.status).toBe(403);

    const login = await request("/api/miniapp/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "release-preview-test", password: "PreviewOnly@123" })
    });
    expect(login.body).toMatchObject({ testMode: true, mode: "release_preview" });
    const preview = await request("/api/miniapp/dev/personas/receiver/login", {
      method: "POST",
      headers: { authorization: `Bearer ${String(login.body.testModeToken)}`, "content-type": "application/json" },
      body: "{}"
    });
    expect(preview.body).toEqual({ preview: true, personaKey: "receiver", mode: "release_preview" });
    expect(preview.body).not.toHaveProperty("sessionToken");
    expect(preview.body).not.toHaveProperty("accountId");

    const disabled = await request("/api/system-owner/maintenance/miniapp-release-preview", {
      method: "PUT",
      headers: headers("system_owner"),
      body: JSON.stringify({ enabled: false, username: "release-preview-test" })
    });
    expect((disabled.body.config as JsonValue).enabled).toBe(false);
    expect((await request("/api/miniapp/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "release-preview-test", password: "PreviewOnly@123" })
    })).response.status).toBe(401);
  });
});
