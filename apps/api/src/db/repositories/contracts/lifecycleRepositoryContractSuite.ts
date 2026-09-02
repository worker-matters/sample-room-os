import { beforeEach, describe, expect, it } from "vitest";
import type {
  LifecycleJobCreateInput,
  LifecycleRepositorySet,
  RecoveryPointCreateInput
} from "./index.js";
import {
  LifecycleConflictError,
  LifecycleTransitionError,
  LifecycleValidationError
} from "../../../modules/lifecycle/lifecycleRules.js";

const actor = { actorId: "owner-1", actorName: "Owner At Request", actorRole: "system_owner" as const };
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);

const recoveryPointInput: RecoveryPointCreateInput = {
  kind: "daily_backup",
  createdBy: actor,
  requestReason: "Daily retention test",
  appVersion: "1.2.3",
  schemaFingerprint: "schema-v1",
  postgresVersion: "16.4",
  storageLayoutVersion: "layout-v1",
  retentionDays: 30,
  retainUntil: "2030-02-01T00:00:00.000Z"
};

const diagnosticJobInput = (idempotencyKey: string): LifecycleJobCreateInput => ({
  action: "diagnostic",
  requestedBy: actor,
  requestReason: "Repository contract diagnostic",
  idempotencyKey,
  parameters: { profile: "standard" }
});

export function runLifecycleRepositoryContractSuite(
  name: string,
  createRepositories: () => LifecycleRepositorySet | Promise<LifecycleRepositorySet>
) {
  describe(name, () => {
    let repositories: LifecycleRepositorySet;

    beforeEach(async () => {
      repositories = await createRepositories();
    });

    it("creates, assembles, verifies, and freezes a RecoveryPoint", async () => {
      const created = await repositories.recoveryPoints.create(recoveryPointInput);
      expect(created).toMatchObject({
        kind: "daily_backup",
        status: "pending",
        totalSizeBytes: "0",
        createdBy: actor,
        retentionDays: 30
      });

      await repositories.recoveryPoints.markCreating(created.id);
      const database = await repositories.recoveryPoints.attachArtifact(created.id, {
        kind: "database_dump",
        relativeName: "database/postgres.dump",
        sizeBytes: "10",
        sha256: digestA,
        verificationStatus: "verified"
      });
      await repositories.recoveryPoints.attachArtifact(created.id, {
        kind: "manifest",
        relativeName: "manifest.json",
        sizeBytes: "5",
        sha256: digestB,
        verificationStatus: "verified"
      });
      expect(database.relativeName).toBe("database/postgres.dump");

      const verified = await repositories.recoveryPoints.markVerified({
        id: created.id,
        packageDigest: digestA,
        totalSizeBytes: "15",
        completedAt: "2030-01-01T00:00:01.000Z",
        verifiedAt: "2030-01-01T00:00:02.000Z"
      });
      expect(verified).toMatchObject({
        status: "verified",
        packageDigest: digestA,
        totalSizeBytes: "15",
        completedAt: "2030-01-01T00:00:01.000Z",
        verifiedAt: "2030-01-01T00:00:02.000Z"
      });
      expect(verified.artifacts).toHaveLength(2);
      await expect(repositories.recoveryPoints.markFailed({
        id: created.id,
        failureCode: "LATE_FAILURE",
        failureReason: "must not overwrite verified core"
      })).rejects.toBeInstanceOf(LifecycleTransitionError);
      await expect(repositories.recoveryPoints.attachArtifact(created.id, {
        kind: "file_archive",
        relativeName: "late.tar",
        sizeBytes: "1",
        sha256: digestA,
        verificationStatus: "verified"
      })).rejects.toBeInstanceOf(LifecycleTransitionError);
    });

    it("records a failed RecoveryPoint without modifying legacy backup data", async () => {
      const point = await repositories.recoveryPoints.create({ ...recoveryPointInput, kind: "manual" });
      const failed = await repositories.recoveryPoints.markFailed({
        id: point.id,
        failureCode: "PG_DUMP_FAILED",
        failureReason: "test failure",
        failedAt: "2030-01-01T01:00:00.000Z"
      });
      expect(failed).toMatchObject({
        status: "failed",
        failureCode: "PG_DUMP_FAILED",
        failedAt: "2030-01-01T01:00:00.000Z"
      });
    });

    it("rejects absolute artifact paths and mismatched totals", async () => {
      const point = await repositories.recoveryPoints.create(recoveryPointInput);
      await repositories.recoveryPoints.markCreating(point.id);
      await expect(repositories.recoveryPoints.attachArtifact(point.id, {
        kind: "database_dump",
        relativeName: "C:\\factory-data\\backup.dump",
        sizeBytes: "10",
        sha256: digestA,
        verificationStatus: "verified"
      })).rejects.toBeInstanceOf(LifecycleValidationError);
      await repositories.recoveryPoints.attachArtifact(point.id, {
        kind: "database_dump",
        relativeName: "database.dump",
        sizeBytes: "10",
        sha256: digestA,
        verificationStatus: "verified"
      });
      await expect(repositories.recoveryPoints.markVerified({
        id: point.id,
        packageDigest: digestA,
        totalSizeBytes: "9"
      })).rejects.toBeInstanceOf(LifecycleTransitionError);
    });

    it("enforces UpdateArtifact digest uniqueness and restricted manifest JSON", async () => {
      const input = {
        version: "2.0.0",
        digest: digestA,
        manifestSummary: { files: 12, schemaTarget: "schema-v2" },
        compatibilityInformation: { minVersion: "1.0.0" },
        status: "discovered" as const
      };
      const artifact = await repositories.updateArtifacts.register(input);
      await expect(repositories.updateArtifacts.register(input)).rejects.toBeInstanceOf(LifecycleConflictError);
      await expect(repositories.updateArtifacts.findByDigest(digestA)).resolves.toEqual(artifact);
      const verified = await repositories.updateArtifacts.markVerification({
        id: artifact.id,
        status: "verified",
        manifestSummary: { title: "System update", changes: ["Safer update"] },
        compatibilityInformation: { compatible: true }
      });
      expect(verified).toMatchObject({ status: "verified" });
      expect(verified.failureReason).toBeUndefined();
      expect(verified.verifiedAt).toBeTruthy();
      await expect(repositories.updateArtifacts.markVerification({
        id: artifact.id,
        status: "failed",
        manifestSummary: {},
        compatibilityInformation: {},
        failureReason: "late failure"
      })).rejects.toBeInstanceOf(LifecycleTransitionError);
      await expect(repositories.updateArtifacts.register({
        ...input,
        digest: digestB,
        manifestSummary: { password: "not-allowed" }
      })).rejects.toBeInstanceOf(LifecycleValidationError);
    });

    it("stores an approved storage change plan outside lifecycle task parameters", async () => {
      const plan = await repositories.storageMigrationPlans.create({
        requestedBy: actor,
        targetPathProtected: "F:\\SampleRoomData",
        targetDisplayName: "F 盘",
        preflightSummary: { localNtfsFormat: true, boundariesSafe: true, hostChecksPending: true }
      });
      expect(plan).toMatchObject({ status: "prepared", targetDisplayName: "F 盘", requestedBy: actor });
      const running = await repositories.storageMigrationPlans.markStatus(plan.id, "running");
      expect(running.status).toBe("running");
      const completed = await repositories.storageMigrationPlans.markStatus(plan.id, "completed");
      expect(completed.completedAt).toBeTruthy();
      await expect(repositories.storageMigrationPlans.markStatus(plan.id, "failed", "late failure")).rejects.toBeInstanceOf(LifecycleTransitionError);
      await expect(repositories.storageMigrationPlans.create({
        requestedBy: actor,
        targetPathProtected: "\\\\server\\share",
        targetDisplayName: "network",
        preflightSummary: {}
      })).rejects.toBeInstanceOf(LifecycleValidationError);
    });

    it("enforces LifecycleJob idempotency and typed parameter allowlists", async () => {
      const job = await repositories.jobs.create(diagnosticJobInput("diagnostic-once"));
      expect(job).toMatchObject({ action: "diagnostic", status: "queued", requestedBy: actor });
      await expect(repositories.jobs.create(diagnosticJobInput("diagnostic-once"))).rejects.toBeInstanceOf(LifecycleConflictError);
      await expect(repositories.jobs.create({
        ...diagnosticJobInput("unsafe-command"),
        parameters: { command: "docker system prune" }
      } as unknown as LifecycleJobCreateInput)).rejects.toBeInstanceOf(LifecycleValidationError);
    });

    it("rejects plaintext credentials and host paths in event and error text", async () => {
      const job = await repositories.jobs.create(diagnosticJobInput("sensitive-text"));
      await repositories.jobs.claimNextJob({
        executorId: "executor-a",
        now: "2030-01-01T00:00:00.000Z",
        leaseDurationMs: 10_000
      });
      await expect(repositories.jobs.appendEvent({
        jobId: job.id,
        eventType: "unsafe_message",
        message: "Failure at C:\\FactoryData\\private"
      })).rejects.toBeInstanceOf(LifecycleValidationError);
      await expect(repositories.jobs.markFailed({
        id: job.id,
        executorId: "executor-a",
        errorCode: "DATABASE_ERROR",
        errorMessage: "password=cleartext",
        failedAt: "2030-01-01T00:00:01.000Z"
      })).rejects.toBeInstanceOf(LifecycleValidationError);
    });

    it("allows only legal job state transitions", async () => {
      const job = await repositories.jobs.create(diagnosticJobInput("state-machine"));
      const claimed = await repositories.jobs.claimNextJob({
        executorId: "executor-a",
        now: "2030-01-01T00:00:00.000Z",
        leaseDurationMs: 10_000
      });
      expect(claimed?.id).toBe(job.id);
      await expect(repositories.jobs.markCompleted({
        id: job.id,
        executorId: "executor-a",
        completedAt: "2030-01-01T00:00:01.000Z"
      })).rejects.toBeInstanceOf(LifecycleTransitionError);
      await repositories.jobs.markRunning({
        id: job.id,
        executorId: "executor-a",
        startedAt: "2030-01-01T00:00:01.000Z"
      });
      const completed = await repositories.jobs.markCompleted({
        id: job.id,
        executorId: "executor-a",
        completedAt: "2030-01-01T00:00:02.000Z"
      });
      expect(completed.status).toBe("completed");
      await expect(repositories.jobs.markCancelled({ id: job.id })).rejects.toBeInstanceOf(LifecycleTransitionError);
    });

    it("lets only one executor claim a single queued job", async () => {
      const job = await repositories.jobs.create(diagnosticJobInput("single-claim"));
      const [first, second] = await Promise.all([
        repositories.jobs.claimNextJob({ executorId: "executor-a", now: "2030-01-01T00:00:00.000Z", leaseDurationMs: 10_000 }),
        repositories.jobs.claimNextJob({ executorId: "executor-b", now: "2030-01-01T00:00:00.000Z", leaseDurationMs: 10_000 })
      ]);
      expect([first, second].filter(Boolean)).toHaveLength(1);
      expect([first?.id, second?.id].filter(Boolean)).toEqual([job.id]);
    });

    it("renews leases and safely reclaims only after expiry", async () => {
      const job = await repositories.jobs.create(diagnosticJobInput("lease-reclaim"));
      await repositories.jobs.claimNextJob({ executorId: "executor-a", now: "2030-01-01T00:00:00.000Z", leaseDurationMs: 1_000 });
      const renewed = await repositories.jobs.renewLease({
        id: job.id,
        executorId: "executor-a",
        now: "2030-01-01T00:00:00.500Z",
        leaseDurationMs: 1_000
      });
      expect(renewed.leaseExpiresAt).toBe("2030-01-01T00:00:01.500Z");
      await expect(repositories.jobs.claimNextJob({
        executorId: "executor-b",
        now: "2030-01-01T00:00:01.400Z",
        leaseDurationMs: 1_000
      })).resolves.toBeUndefined();
      const reclaimed = await repositories.jobs.claimNextJob({
        executorId: "executor-b",
        now: "2030-01-01T00:00:01.600Z",
        leaseDurationMs: 1_000
      });
      expect(reclaimed).toMatchObject({ id: job.id, executorId: "executor-b", status: "claimed" });
      await expect(repositories.jobs.renewLease({
        id: job.id,
        executorId: "executor-a",
        now: "2030-01-01T00:00:01.700Z",
        leaseDurationMs: 1_000
      })).rejects.toBeInstanceOf(Error);
    });

    it("keeps LifecycleJobEvent append-only and chronologically ordered", async () => {
      const job = await repositories.jobs.create(diagnosticJobInput("event-stream"));
      await repositories.jobs.appendEvent({
        jobId: job.id,
        eventType: "second",
        message: "second event",
        createdAt: "2030-01-01T00:00:02.000Z",
        executorIdSnapshot: "executor-a"
      });
      await repositories.jobs.appendEvent({
        jobId: job.id,
        eventType: "first",
        message: "first event",
        createdAt: "2030-01-01T00:00:01.000Z",
        actorSnapshot: actor
      });
      const events = await repositories.jobs.listEvents(job.id);
      expect(events.map((event) => event.eventType)).toEqual(["first", "second"]);
      expect("updateEvent" in repositories.jobs).toBe(false);
      expect("deleteEvent" in repositories.jobs).toBe(false);
    });

    it("serializes the global MaintenanceLock and permits expiry takeover", async () => {
      await repositories.jobs.create(diagnosticJobInput("lock-job-a"));
      await repositories.jobs.create(diagnosticJobInput("lock-job-b"));
      const firstJob = (await repositories.jobs.claimNextJob({
        executorId: "executor-a",
        now: "2030-01-01T00:00:00.000Z",
        leaseDurationMs: 10_000
      }))!;
      const secondJob = (await repositories.jobs.claimNextJob({
        executorId: "executor-b",
        now: "2030-01-01T00:00:00.000Z",
        leaseDurationMs: 10_000
      }))!;
      const [first, second] = await Promise.all([
        repositories.maintenanceLock.acquire({ currentJobId: firstJob.id, executorId: "executor-a", now: "2030-01-01T00:00:00.000Z", leaseDurationMs: 1_000 }),
        repositories.maintenanceLock.acquire({ currentJobId: secondJob.id, executorId: "executor-b", now: "2030-01-01T00:00:00.000Z", leaseDurationMs: 1_000 })
      ]);
      expect([first, second].filter(Boolean)).toHaveLength(1);
      const winner = first ?? second!;
      const renewed = await repositories.maintenanceLock.renew({
        currentJobId: winner.currentJobId!,
        executorId: winner.executorId!,
        now: "2030-01-01T00:00:00.500Z",
        leaseDurationMs: 1_000
      });
      expect(renewed.leaseExpiresAt).toBe("2030-01-01T00:00:01.500Z");
      const takeoverJob = winner.currentJobId === firstJob.id ? secondJob : firstJob;
      const takeoverExecutor = winner.executorId === "executor-a" ? "executor-b" : "executor-a";
      const takeover = await repositories.maintenanceLock.acquire({
        currentJobId: takeoverJob.id,
        executorId: takeoverExecutor,
        now: "2030-01-01T00:00:01.600Z",
        leaseDurationMs: 1_000
      });
      expect(takeover).toMatchObject({ currentJobId: takeoverJob.id, executorId: takeoverExecutor });
      await expect(repositories.maintenanceLock.release({
        currentJobId: winner.currentJobId!,
        executorId: winner.executorId!,
        releasedAt: "2030-01-01T00:00:01.700Z"
      })).resolves.toBe(false);
      await expect(repositories.maintenanceLock.release({
        currentJobId: takeoverJob.id,
        executorId: takeoverExecutor,
        releasedAt: "2030-01-01T00:00:01.700Z"
      })).resolves.toBe(true);
      await expect(repositories.maintenanceLock.inspect()).resolves.toMatchObject({ scope: "global_lifecycle" });
    });
  });
}
