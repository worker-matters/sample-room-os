import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@sample-room/shared";
import { createInMemoryLifecycleRepositorySet } from "../../db/repositories/memory/inMemoryLifecycleRepositories.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { LifecycleExecutorService, LifecycleSystemOwnerService } from "./lifecycleService.js";

const owner: CurrentUser = {
  id: "owner-account",
  accountId: "owner-account",
  role: ROLES.systemOwner,
  displayName: "Original Owner Name"
};

function user(role: Role): CurrentUser {
  return { id: `${role}-account`, accountId: `${role}-account`, role, displayName: `${role} user` };
}

describe("lifecycle authorization and executor boundaries", () => {
  it("rejects lifecycle reads and writes for every non-system_owner role", async () => {
    const repositories = createInMemoryLifecycleRepositorySet();
    const service = new LifecycleSystemOwnerService(repositories);
    for (const role of Object.values(ROLES).filter((role) => role !== ROLES.systemOwner)) {
      await expect(service.listJobs(user(role))).rejects.toMatchObject({ statusCode: 403, message: "forbidden" });
      await expect(service.createRecoveryPoint(user(role), {
        kind: "manual",
        requestReason: "must be forbidden",
        appVersion: "1.0.0",
        schemaFingerprint: "schema-v1",
        postgresVersion: "16",
        storageLayoutVersion: "layout-v1"
      })).rejects.toMatchObject({ statusCode: 403, message: "forbidden" });
      await expect(service.requestJob(user(role), {
        action: "diagnostic",
        requestReason: "must be forbidden",
        idempotencyKey: `forbidden-${role}`,
        parameters: { profile: "standard" }
      })).rejects.toMatchObject({ statusCode: 403, message: "forbidden" });
    }
  });

  it("persists immutable actor identity snapshots at request time", async () => {
    const repositories = createInMemoryLifecycleRepositorySet();
    const service = new LifecycleSystemOwnerService(repositories);
    const requestOwner = { ...owner };
    const point = await service.createRecoveryPoint(requestOwner, {
      kind: "manual",
      requestReason: "Snapshot actor",
      appVersion: "1.0.0",
      schemaFingerprint: "schema-v1",
      postgresVersion: "16",
      storageLayoutVersion: "layout-v1"
    });
    const job = await service.requestJob(requestOwner, {
      action: "diagnostic",
      requestReason: "Snapshot actor job",
      idempotencyKey: "actor-snapshot",
      parameters: { profile: "standard" }
    });
    requestOwner.displayName = "Renamed Later";
    expect((await service.getRecoveryPoint(requestOwner, point.id))?.createdBy).toEqual({
      actorId: "owner-account",
      actorName: "Original Owner Name",
      actorRole: "system_owner"
    });
    expect((await service.getJob(requestOwner, job.id))?.requestedBy.actorName).toBe("Original Owner Name");
    expect((await service.listJobEvents(requestOwner, job.id))[0]?.actorSnapshot?.actorName).toBe("Original Owner Name");
  });

  it("exposes only typed executor operations and no arbitrary command surface", async () => {
    const repositories = createInMemoryLifecycleRepositorySet();
    const ownerService = new LifecycleSystemOwnerService(repositories);
    const executor = new LifecycleExecutorService(repositories, "executor-a", 10_000);
    const job = await ownerService.requestJob(owner, {
      action: "diagnostic",
      requestReason: "Controlled executor test",
      idempotencyKey: "controlled-executor",
      parameters: { profile: "standard" }
    });
    expect(Object.keys(executor)).not.toContain("executeCommand");
    const claimed = await executor.claimNextJob("2030-01-01T00:00:00.000Z");
    expect(claimed?.id).toBe(job.id);
    await executor.markRunning(job.id, "2030-01-01T00:00:01.000Z");
    await executor.appendProgress({
      jobId: job.id,
      eventType: "diagnostic_progress",
      phase: "database_check",
      progress: 50,
      message: "Database connectivity verified",
      structuredMetadata: { check: "database" },
      createdAt: "2030-01-01T00:00:01.500Z"
    });
    await executor.markCompleted(job.id, "2030-01-01T00:00:02.000Z");
    expect((await ownerService.listJobEvents(owner, job.id)).map((event) => event.eventType)).toEqual([
      "job_requested",
      "job_claimed",
      "job_running",
      "diagnostic_progress",
      "job_completed"
    ]);
  });

  it("rejects storage migration jobs because LCM-05 is unavailable", async () => {
    const repositories = createInMemoryLifecycleRepositorySet();
    const service = new LifecycleSystemOwnerService(repositories);
    await expect(service.requestJob(owner, {
      action: "migrate_storage",
      requestReason: "Unsafe path test",
      idempotencyKey: "unsafe-storage-path",
      parameters: { migrationPlanId: "C:\\FactoryData", mode: "copy_verify_switch" }
    })).rejects.toMatchObject({ statusCode: 501, message: "lifecycle_action_not_available" });

    const plan = await repositories.storageMigrationPlans.create({
      requestedBy: { actorId: "owner-account", actorName: "Original Owner Name", actorRole: owner.role },
      targetPathProtected: "D:\\SampleRoomData",
      targetDisplayName: "D 盘",
      preflightSummary: { pathFormat: "local_ntfs" }
    });
    await expect(service.requestJob(owner, {
      action: "migrate_storage",
      requestReason: "Safe opaque storage ref",
      idempotencyKey: "safe-storage-ref",
      parameters: { migrationPlanId: plan.id, mode: "copy_verify_switch" }
    })).rejects.toMatchObject({ statusCode: 501, message: "lifecycle_action_not_available" });
  });

  it("allows only a verified recovery point to create one typed restore request", async () => {
    const repositories = createInMemoryLifecycleRepositorySet();
    const service = new LifecycleSystemOwnerService(repositories);
    const point = await service.createRecoveryPoint(owner, { kind: "manual", requestReason: "restore target", appVersion: "1.0.0", schemaFingerprint: "schema-v1", postgresVersion: "16", storageLayoutVersion: "layout-v1" });
    await expect(service.requestRestore(owner, { recoveryPointId: point.id, requestReason: "restore", idempotencyKey: "restore-pending", confirmationText: "confirmed" })).rejects.toMatchObject({ statusCode: 501, message: "automatic_restore_not_available" });
    await repositories.recoveryPoints.markCreating(point.id);
    for (const kind of ["database_dump", "file_archive", "config_snapshot", "manifest"] as const) {
      await repositories.recoveryPoints.attachArtifact(point.id, { kind, relativeName: `${kind}.fixture`, sizeBytes: "1", sha256: "a".repeat(64), verificationStatus: "verified" });
    }
    await repositories.recoveryPoints.markVerified({ id: point.id, packageDigest: "a".repeat(64), totalSizeBytes: "4" });
    await expect(service.requestRestore(owner, { recoveryPointId: point.id, requestReason: "restore", idempotencyKey: "restore-verified", confirmationText: "confirmed" }))
      .rejects.toMatchObject({ statusCode: 501, message: "automatic_restore_not_available" });
    expect(await repositories.jobs.list()).toHaveLength(0);
  });

  it("rejects generic recovery, restore, update, and migration jobs in V1", async () => {
    const repositories = createInMemoryLifecycleRepositorySet();
    const service = new LifecycleSystemOwnerService(repositories);
    const forbidden = [
      { action: "create_recovery_point", recoveryPointId: "point", parameters: { recoveryPointId: "point", kind: "manual" } },
      { action: "restore_recovery_point", recoveryPointId: "point", parameters: { recoveryPointId: "point" } },
      { action: "preflight_update", updateArtifactId: "update", parameters: { updateArtifactId: "update" } },
      { action: "apply_update", updateArtifactId: "update", parameters: { updateArtifactId: "update" } },
      { action: "migrate_storage", parameters: { migrationPlanId: "plan", mode: "copy_verify_switch" } }
    ] as const;
    for (const [index, request] of forbidden.entries()) {
      await expect(service.requestJob(owner, {
        ...request,
        requestReason: "V1 fail closed",
        idempotencyKey: `forbidden-${index}`
      })).rejects.toMatchObject({ statusCode: 501, message: "lifecycle_action_not_available" });
    }
    expect(await repositories.jobs.list()).toHaveLength(0);
  });

  it("returns user-facing operation history without protected paths or executor details", async () => {
    const repositories = createInMemoryLifecycleRepositorySet();
    const service = new LifecycleSystemOwnerService(repositories);
    const executor = new LifecycleExecutorService(repositories, "factory-runner", 10_000);
    const job = await service.requestJob(owner, {
      action: "diagnostic",
      requestReason: "检查系统状态",
      idempotencyKey: "history-diagnostic",
      parameters: { profile: "standard" }
    });
    await executor.claimNextJob();
    await executor.markRunning(job.id);
    await executor.markCompleted(job.id);

    const records = await service.listUserOperationHistory(owner);
    expect(records[0]).toMatchObject({
      operation: "检查系统",
      result: "success",
      requestedBy: "Original Owner Name",
      nextStep: "无需处理。"
    });
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("factory-runner");
    await expect(service.listUserOperationHistory(user(ROLES.boss))).rejects.toMatchObject({ statusCode: 403 });
  });
});
