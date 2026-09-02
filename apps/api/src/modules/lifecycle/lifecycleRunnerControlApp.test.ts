import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createInMemoryLifecycleRepositorySet } from "../../db/repositories/memory/inMemoryLifecycleRepositories.js";
import { createLifecycleRunnerControlApp } from "./lifecycleRunnerControlApp.js";
import { LifecycleSystemOwnerService, SingleMachineLifecycleRunnerService } from "./lifecycleService.js";
import { ROLES } from "@sample-room/shared";

const owner = { id: "owner", accountId: "owner", role: ROLES.systemOwner, displayName: "System Owner" } as const;
const token = "test-machine-credential";

async function startControl() {
  const repositories = createInMemoryLifecycleRepositorySet();
  const server = createLifecycleRunnerControlApp({ repositories, machineCredential: token }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  return { repositories, server, url: `http://127.0.0.1:${port}` };
}

async function request(url: string, path: string, body?: unknown, credential?: string) {
  return fetch(`${url}${path}`, {
    method: path === "/runner/current-job" || path === "/runner/active-jobs" ? "GET" : "POST",
    headers: { ...(credential ? { "x-lifecycle-runner-token": credential } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
}

describe("single-machine lifecycle runner control", () => {
  it("requires the machine credential and is reachable through an explicit loopback listener", async () => {
    const { server, url } = await startControl();
    try {
      expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
      await expect(request(url, "/runner/poll-claim")).resolves.toMatchObject({ status: 401 });
      await expect(request(url, "/runner/poll-claim", undefined, "system-owner-session")).resolves.toMatchObject({ status: 401 });
      const emptyPoll = await request(url, "/runner/poll-claim", undefined, token);
      expect(emptyPoll.status).toBe(200);
      expect(await emptyPoll.json()).toEqual({});
    } finally { server.close(); }
  });

  it("accepts only fixed progress fields and never a command or host-path payload", async () => {
    const { repositories, server, url } = await startControl();
    try {
      const ownerService = new LifecycleSystemOwnerService(repositories);
      const job = await ownerService.requestJob(owner, { action: "diagnostic", requestReason: "Runner test", idempotencyKey: "runner-api-typed", parameters: { profile: "standard" } });
      await request(url, "/runner/poll-claim", undefined, token);
      await request(url, `/runner/jobs/${job.id}/mark-running`, {}, token);
      const response = await request(url, `/runner/jobs/${job.id}/progress-event`, { phase: "checking", progress: 20, message: "Checking", powershell: "Remove-Item C:\\" }, token);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_runner_request" });
      expect((await request(url, "/runner/poll-claim", { scriptPath: "C:\\host.ps1" }, token)).status).toBe(400);
    } finally { server.close(); }
  });

  it("fails closed for private storage-migration endpoints even with the machine credential", async () => {
    const { repositories, server, url } = await startControl();
    try {
      const plan = await repositories.storageMigrationPlans.create({
        requestedBy: { actorId: "owner", actorName: "System Owner", actorRole: ROLES.systemOwner },
        targetPathProtected: "F:\\FactoryData",
        targetDisplayName: "F 盘",
        preflightSummary: { boundariesSafe: true }
      });
      expect((await fetch(`${url}/runner/storage-migration-plans/${plan.id}`)).status).toBe(401);
      const allowed = await fetch(`${url}/runner/storage-migration-plans/${plan.id}`, { headers: { "x-lifecycle-runner-token": token } });
      expect(allowed.status).toBe(501);
      expect(await allowed.json()).toEqual({ error: "lifecycle_action_not_available" });
      const rejected = await request(url, `/runner/storage-migration-plans/${plan.id}/status`, { status: "running", command: "docker compose down" }, token);
      expect(rejected.status).toBe(501);
      expect((await request(url, `/runner/storage-migration-plans/${plan.id}/status`, { status: "running" }, token)).status).toBe(501);
    } finally { server.close(); }
  });

  it("fails closed for private update-artifact endpoints even with the machine credential", async () => {
    const { repositories, server, url } = await startControl();
    try {
      const artifact = await repositories.updateArtifacts.register({
        version: "1.2.0",
        digest: "a".repeat(64),
        manifestSummary: { packageRelativeName: `quarantine/${"a".repeat(64)}.zip` },
        compatibilityInformation: { compatible: false },
        status: "discovered"
      });
      expect((await fetch(`${url}/runner/update-artifacts/${artifact.id}`)).status).toBe(401);
      expect((await fetch(`${url}/runner/update-artifacts/${artifact.id}`, { headers: { "x-lifecycle-runner-token": token } })).status).toBe(501);
      const injected = await request(url, `/runner/update-artifacts/${artifact.id}/verification`, {
        status: "verified",
        manifestSummary: {},
        compatibilityInformation: {},
        command: "docker compose down"
      }, token);
      expect(injected.status).toBe(501);
      const verified = await request(url, `/runner/update-artifacts/${artifact.id}/verification`, {
        status: "verified",
        manifestSummary: { title: "Safe package" },
        compatibilityInformation: { compatible: true }
      }, token);
      expect(verified.status).toBe(501);
      expect((await repositories.updateArtifacts.getById(artifact.id))?.status).toBe("discovered");
    } finally { server.close(); }
  });

  it("fails closed for the private pre-update recovery point endpoint", async () => {
    const { repositories, server, url } = await startControl();
    try {
      const response = await request(url, "/runner/recovery-points/pre-update", {
        requestReason: "Safety backup before update",
        appVersion: "1.0.0",
        storageLayoutVersion: "factory-data-root-v1"
      }, token);
      expect(response.status).toBe(501);
      expect(await response.json()).toEqual({ error: "lifecycle_action_not_available" });
      expect(await repositories.recoveryPoints.list()).toHaveLength(0);
    } finally { server.close(); }
  });

  it.each(["pre-restore", "pre-storage-migration"])("fails closed for private recovery point endpoint %s", async (operation) => {
    const { repositories, server, url } = await startControl();
    try {
      const response = await request(url, `/runner/recovery-points/${operation}`, {
        requestReason: "Future operation must remain unavailable",
        appVersion: "1.0.0",
        storageLayoutVersion: "factory-data-root-v1"
      }, token);
      expect(response.status).toBe(501);
      expect(await response.json()).toEqual({ error: "lifecycle_action_not_available" });
      expect(await repositories.recoveryPoints.list()).toHaveLength(0);
    } finally { server.close(); }
  });

  it("keeps one global task, releases a safe failure, and retains manual-review locks", async () => {
    const repositories = createInMemoryLifecycleRepositorySet();
    const ownerService = new LifecycleSystemOwnerService(repositories);
    const runner = new SingleMachineLifecycleRunnerService(repositories);
    const diagnostic = await ownerService.requestJob(owner, { action: "diagnostic", requestReason: "Safe failure", idempotencyKey: "safe-failure", parameters: { profile: "standard" } });
    await expect(ownerService.requestJob(owner, { action: "diagnostic", requestReason: "Duplicate", idempotencyKey: "blocked-queued", parameters: { profile: "standard" } })).rejects.toMatchObject({ statusCode: 409 });
    expect((await runner.pollAndClaim())?.id).toBe(diagnostic.id);
    await runner.markRunning(diagnostic.id);
    await runner.heartbeat(diagnostic.id);
    await runner.fail(diagnostic.id, "DIAGNOSTIC_FAILED", "The check failed before a system switch.");
    expect((await repositories.maintenanceLock.inspect())?.currentJobId).toBeUndefined();
    const next = await ownerService.requestJob(owner, { action: "diagnostic", requestReason: "Allowed after safe failure", idempotencyKey: "after-safe-failure", parameters: { profile: "standard" } });
    expect((await runner.pollAndClaim())?.id).toBe(next.id);
    await runner.markRunning(next.id);
    await runner.reportInterrupted(next.id, "Runner stopped before the task completed.");
    expect((await repositories.maintenanceLock.inspect())?.currentJobId).toBe(next.id);
    await expect(ownerService.requestJob(owner, { action: "diagnostic", requestReason: "Blocked by manual review", idempotencyKey: "blocked-manual", parameters: { profile: "standard" } })).rejects.toMatchObject({ statusCode: 409, message: "lifecycle_manual_review_required" });
  });

  it("does not reclaim a stale claimed or running task", async () => {
    const repositories = createInMemoryLifecycleRepositorySet();
    const ownerService = new LifecycleSystemOwnerService(repositories);
    const runner = new SingleMachineLifecycleRunnerService(repositories);
    await ownerService.requestJob(owner, { action: "diagnostic", requestReason: "No replay", idempotencyKey: "no-replay", parameters: { profile: "standard" } });
    await repositories.jobs.claimNextJob({ executorId: "factory-runner", now: "2030-01-01T00:00:00.000Z", leaseDurationMs: 1 });
    expect(await runner.pollAndClaim()).toBeUndefined();
  });

  it("lists active jobs for repair, preserves audit on cancellation, and claims only V1 actions", async () => {
    const { repositories, server, url } = await startControl();
    try {
      const actor = { actorId: "owner", actorName: "System Owner", actorRole: ROLES.systemOwner } as const;
      const artifact = await repositories.updateArtifacts.register({
        version: "9.9.9",
        digest: "b".repeat(64),
        manifestSummary: {},
        compatibilityInformation: {},
        status: "discovered"
      });
      const forbidden = await repositories.jobs.create({
        action: "apply_update",
        requestReason: "Old unconfirmed task",
        idempotencyKey: "old-update",
        updateArtifactId: artifact.id,
        parameters: { updateArtifactId: artifact.id },
        requestedBy: actor
      });
      const diagnostic = await repositories.jobs.create({
        action: "diagnostic",
        requestReason: "Allowed V1 task",
        idempotencyKey: "allowed-diagnostic",
        parameters: { profile: "standard" },
        requestedBy: actor
      });
      const active = await request(url, "/runner/active-jobs", undefined, token);
      expect(active.status).toBe(200);
      const activeBody = await active.json() as { jobs: Array<{ id: string; action: string; status: string }> };
      expect(activeBody.jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: forbidden.id, action: "apply_update", status: "queued" }),
        expect.objectContaining({ id: diagnostic.id, action: "diagnostic", status: "queued" })
      ]));

      const claimed = await request(url, "/runner/poll-claim", undefined, token);
      expect(await claimed.json()).toMatchObject({ job: { id: diagnostic.id, action: "diagnostic" } });
      expect((await repositories.jobs.getById(forbidden.id))?.status).toBe("queued");

      const cancelled = await request(url, `/runner/active-jobs/${forbidden.id}/cancel`, {}, token);
      expect(cancelled.status).toBe(200);
      expect((await repositories.jobs.getById(forbidden.id))?.status).toBe("cancelled");
      expect((await repositories.jobs.listEvents(forbidden.id)).map((event) => event.eventType))
        .toContain("job_cancelled_during_runner_repair");
    } finally { server.close(); }
  });

  it("refuses to cancel a running task during repair review", async () => {
    const { repositories, server, url } = await startControl();
    try {
      const service = new LifecycleSystemOwnerService(repositories);
      const job = await service.requestJob(owner, { action: "diagnostic", requestReason: "Running review", idempotencyKey: "running-review", parameters: { profile: "standard" } });
      await request(url, "/runner/poll-claim", undefined, token);
      await request(url, `/runner/jobs/${job.id}/mark-running`, {}, token);
      const response = await request(url, `/runner/active-jobs/${job.id}/cancel`, {}, token);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "running_lifecycle_job_requires_manual_review" });
      expect((await repositories.jobs.getById(job.id))?.status).toBe("running");
    } finally { server.close(); }
  });
});
