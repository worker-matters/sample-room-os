import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ROLES } from "@sample-room/shared";
import {
  headers,
  identityRepositories,
  request,
  type JsonValue
} from "../receiver/testHelpers.js";

const bossHeaders = () => headers("boss", { userId: "formal-account-boss" });

async function issueToken(workerType: string) {
  const result = await request("/api/workers/registration-tokens", {
    method: "POST",
    headers: bossHeaders(),
    body: JSON.stringify({ workerType })
  });
  expect(result.response.status).toBe(201);
  const urls = result.body.registrationUrls as JsonValue;
  const registrationUrl = (urls.public ?? urls.lan) as string;
  const rawToken = new URL(registrationUrl).pathname.split("/").pop()!;
  return {
    token: result.body.token as JsonValue,
    registrationUrls: urls,
    payload: `REGISTER|${rawToken}`
  };
}

describe("Account and WorkerProfile identity QR flows", () => {
  beforeEach(async () => {
    await identityRepositories.systemSettings!.upsertSystemSetting({
      key: "runtime_endpoint_bases_v1",
      value: {
        publicWebBaseUrl: "https://scan.example.com",
        lanWebBaseUrl: "http://192.168.10.20:5173",
        publicApiBaseUrl: "",
        lanApiBaseUrl: ""
      },
      updatedBy: "formal-account-system-owner"
    });
  });

  it("registers multiple Worker Accounts from one reusable token-defined position", async () => {
    const issued = await issueToken("cutting");
    const payload = issued.payload as string;
    const rawToken = payload.split("|")[1]!;

    expect(payload).toMatch(/^REGISTER\|[A-Za-z0-9_-]{32,256}$/);
    const storedTokens = await identityRepositories.identityQrTokens.listIdentityQrTokens();
    expect(storedTokens).toHaveLength(1);
    expect(storedTokens[0]).toMatchObject({
      purpose: "REGISTER_WORKER",
      initialRole: ROLES.worker,
      workerType: "cutting",
      usedAt: null,
      revokedAt: null
    });
    expect(Date.parse(storedTokens[0]!.expiresAt)).toBeGreaterThan(Date.now());
    expect(storedTokens[0]!.tokenHash).toBe(
      createHash("sha256").update(rawToken).digest("hex")
    );
    expect(JSON.stringify(storedTokens[0])).not.toContain(rawToken);

    const resolved = await request("/api/workers/registration/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload })
    });
    expect(resolved.response.status).toBe(200);
    expect(resolved.body.registration).toMatchObject({
      enabled: true,
      workerType: "cutting"
    });

    const first = await request("/api/workers/registration/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload,
        phoneNumber: "13900000001",
        password: "worker-password",
        name: "New Cutting Worker"
      })
    });
    expect(first.response.status).toBe(201);
    expect(first.body.account).toMatchObject({
      phoneNumber: "13900000001",
      accountType: "worker",
      role: ROLES.worker,
      status: "active"
    });
    expect(first.body.workerProfile).toMatchObject({
      workerType: "cutting",
      status: "active"
    });

    const firstAccount = await identityRepositories.accounts.findAccountByPhoneNumber(
      "13900000001",
      "worker"
    );
    expect(firstAccount).toBeDefined();
    expect(await identityRepositories.workerProfiles.findActiveWorkerProfileByAccountId(firstAccount!.id))
      .toMatchObject({ workerType: "cutting", status: "active" });

    const tokenAfterFirstRegistration = (await identityRepositories.identityQrTokens.listIdentityQrTokens())[0]!;
    expect(tokenAfterFirstRegistration.usedAt).toBeNull();
    expect(tokenAfterFirstRegistration.usedByAccountId).toBeNull();
    expect(tokenAfterFirstRegistration.revokedAt).toBeNull();

    const second = await request("/api/workers/registration/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload,
        phoneNumber: "13900000006",
        password: "worker-password",
        name: "Second Cutting Worker"
      })
    });
    expect(second.response.status).toBe(201);
    expect(second.body.workerProfile).toMatchObject({ workerType: "cutting", status: "active" });

    const resolvedAgain = await request("/api/workers/registration/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload })
    });
    expect(resolvedAgain.response.status).toBe(200);
    expect(resolvedAgain.body.registration).toMatchObject({ enabled: true, workerType: "cutting" });

    const workerManagement = await request("/api/workers", { headers: bossHeaders() });
    expect(workerManagement.response.status).toBe(200);
    expect(workerManagement.body.workers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        account: expect.objectContaining({ id: firstAccount!.id, role: ROLES.worker }),
        currentWorkerProfile: expect.objectContaining({ workerType: "cutting", status: "active" })
      }),
      expect.objectContaining({
        account: expect.objectContaining({ phoneNumber: "13900000006", role: ROLES.worker }),
        currentWorkerProfile: expect.objectContaining({ workerType: "cutting", status: "active" })
      })
    ]));
  });

  it("rejects client-selected positions, revoked tokens, and legacy expired tokens", async () => {
    const issued = await issueToken("sewing");
    const payload = issued.payload as string;

    const selectedPosition = await request("/api/workers/registration/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload,
        phoneNumber: "13900000002",
        password: "worker-password",
        name: "New Sewing Worker",
        workerType: "cutting"
      })
    });
    expect(selectedPosition.response.status).toBe(400);

    const registered = await request("/api/workers/registration/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload,
        phoneNumber: "13900000002",
        password: "worker-password",
        name: "New Sewing Worker"
      })
    });
    expect(registered.response.status).toBe(201);
    expect((registered.body.workerProfile as JsonValue).workerType).toBe("sewing");

    const tokenId = (issued.token as JsonValue).id as string;
    const revoked = await request(`/api/workers/identity-tokens/${tokenId}`, {
      method: "DELETE",
      headers: bossHeaders()
    });
    expect(revoked.response.status).toBe(200);
    const revokedAttempt = await request("/api/workers/registration/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload,
        phoneNumber: "13900000004",
        password: "worker-password",
        name: "Revoked Worker"
      })
    });
    expect(revokedAttempt.response.status).toBe(409);

    const expiredRaw = "x".repeat(43);
    await identityRepositories.identityQrTokens.createIdentityQrToken({
      tokenHash: createHash("sha256").update(expiredRaw).digest("hex"),
      purpose: "REGISTER_WORKER",
      initialRole: ROLES.worker,
      workerType: "cutting",
      issuedByAccountId: "formal-account-boss",
      expiresAt: new Date(Date.now() - 1_000).toISOString()
    });
    const expired = await request("/api/workers/registration/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload: `REGISTER|${expiredRaw}`,
        phoneNumber: "13900000005",
        password: "worker-password",
        name: "Expired Worker"
      })
    });
    expect(expired.response.status).toBe(409);
  });

  it("lets the boss directly change and restore a stable historical WorkerProfile", async () => {
    const changed = await request("/api/workers/formal-account-worker-cutting/change-stage", {
      method: "POST",
      headers: bossHeaders(),
      body: JSON.stringify({ workerType: "sewing" })
    });
    expect(changed.response.status).toBe(200);
    expect(changed.body.previousWorkerProfile).toMatchObject({
      id: "formal-worker-profile-cutting",
      status: "inactive"
    });
    expect(changed.body.workerProfile).toMatchObject({ workerType: "sewing", status: "active" });

    const profilesAfterChange = await identityRepositories.workerProfiles
      .listWorkerProfilesByAccountId("formal-account-worker-cutting");
    expect(profilesAfterChange.filter((profile) => profile.status === "active")).toHaveLength(1);
    expect(profilesAfterChange.find((profile) => profile.id === "formal-worker-profile-cutting"))
      .toMatchObject({ status: "inactive" });

    const current = profilesAfterChange.find((profile) => profile.status === "active")!;
    const restored = await request(
      "/api/workers/formal-account-worker-cutting/worker-profiles/formal-worker-profile-cutting/restore",
      { method: "POST", headers: bossHeaders() }
    );
    expect(restored.response.status).toBe(200);
    expect(restored.body.workerProfile).toMatchObject({
      id: "formal-worker-profile-cutting",
      workerType: "cutting",
      status: "active",
      endedAt: null
    });

    const profilesAfterRestore = await identityRepositories.workerProfiles
      .listWorkerProfilesByAccountId("formal-account-worker-cutting");
    expect(profilesAfterRestore.filter((profile) => profile.status === "active")).toHaveLength(1);
    expect(profilesAfterRestore.find((profile) => profile.id === current.id))
      .toMatchObject({ status: "inactive" });
  });

  it("does not allow non-boss roles to change another worker position", async () => {
    const result = await request("/api/workers/formal-account-worker-cutting/change-stage", {
      method: "POST",
      headers: headers("receiver", { userId: "formal-account-receiver" }),
      body: JSON.stringify({ workerType: "qc_delivery" })
    });
    expect(result.response.status).toBe(403);

    const removedDeviceEntry = await request("/api/workers/registration-gate", {
      headers: bossHeaders()
    });
    expect(removedDeviceEntry.response.status).toBe(404);
  });

  it("archives a Worker Account and restores the same Account and profile IDs by phone registration", async () => {
    const firstIssue = await issueToken("qc_delivery");
    const first = await request("/api/workers/registration/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: firstIssue.payload, phoneNumber: "13900000088", password: "worker-password", name: "Restorable Worker" })
    });
    const accountId = (first.body.account as JsonValue).id as string;
    const profileId = (first.body.workerProfile as JsonValue).id as string;

    const archived = await request("/api/workers/archive", {
      method: "POST",
      headers: bossHeaders(),
      body: JSON.stringify({ accountIds: [accountId] })
    });
    expect(archived.response.status).toBe(200);
    expect(await identityRepositories.accounts.findAccountById(accountId)).toMatchObject({ status: "archived" });

    const restoreIssue = await issueToken("qc_delivery");
    const restored = await request("/api/workers/registration/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: restoreIssue.payload, phoneNumber: "13900000088", password: "new-worker-password", name: "Restorable Worker" })
    });
    expect(restored.response.status).toBe(201);
    expect(restored.body).toMatchObject({ restored: true, account: { id: accountId, status: "active" }, workerProfile: { id: profileId, status: "active" } });
  });

  it("lets the boss edit, suspend, and restore a Worker Account without changing its profile history", async () => {
    const before = await identityRepositories.workerProfiles
      .listWorkerProfilesByAccountId("formal-account-worker-cutting");
    const updated = await request("/api/workers/formal-account-worker-cutting", {
      method: "PATCH",
      headers: bossHeaders(),
      body: JSON.stringify({
        displayName: "Cutting Worker Updated",
        phoneNumber: "13900000999",
        password: "temporary-password",
        status: "suspended"
      })
    });
    expect(updated.response.status).toBe(200);
    expect(updated.body.account).toMatchObject({
      displayName: "Cutting Worker Updated",
      phoneNumber: "13900000999",
      status: "suspended"
    });
    expect(updated.body).not.toHaveProperty("password");
    expect(updated.body).not.toHaveProperty("passwordHash");

    const restored = await request("/api/workers/formal-account-worker-cutting", {
      method: "PATCH",
      headers: bossHeaders(),
      body: JSON.stringify({ status: "active" })
    });
    expect(restored.response.status).toBe(200);
    expect(restored.body.account).toMatchObject({ status: "active" });
    expect(await identityRepositories.workerProfiles
      .listWorkerProfilesByAccountId("formal-account-worker-cutting")).toEqual(before);
  });
});
