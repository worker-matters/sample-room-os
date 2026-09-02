import { randomUUID } from "node:crypto";
import type {
  LifecycleJobCreateInput,
  LifecycleJobEventInput,
  LifecycleJobEventRecord,
  LifecycleJobRecord,
  LifecycleJobRepository,
  LifecycleRepositorySet,
  MaintenanceLockRecord,
  MaintenanceLockRepository,
  RecoveryPointArtifactInput,
  RecoveryPointArtifactRecord,
  RecoveryPointCreateInput,
  RecoveryPointRecord,
  RecoveryPointRepository,
  StorageMigrationPlanCreateInput,
  StorageMigrationPlanRecord,
  StorageMigrationPlanRepository,
  UpdateArtifactRecord,
  UpdateArtifactRegisterInput,
  UpdateArtifactRepository
} from "../contracts/index.js";
import { GLOBAL_MAINTENANCE_LOCK_SCOPE } from "../contracts/index.js";
import {
  LifecycleConflictError,
  LifecycleNotFoundError,
  LifecycleTransitionError,
  assertDecimalBytes,
  assertLifecycleJobCreateInput,
  assertLifecycleJobTransition,
  assertRecoveryPointArtifactInput,
  assertRecoveryPointCreateInput,
  assertRecoveryPointTransition,
  assertRestrictedJson,
  assertSafeLifecycleText,
  assertSha256,
  assertStorageMigrationPlanCreateInput,
  assertUpdateArtifactRegisterInput,
  assertUpdateArtifactVerificationInput,
  isLeaseActive,
  leaseExpiry,
  parseTimestamp
} from "../../../modules/lifecycle/lifecycleRules.js";

const copy = <T>(value: T): T => structuredClone(value);
const nowIso = (value?: string, fieldName = "timestamp") => parseTimestamp(value, fieldName).toISOString();

export class InMemoryLifecycleStore {
  readonly recoveryPoints = new Map<string, RecoveryPointRecord>();
  readonly jobs = new Map<string, LifecycleJobRecord>();
  readonly jobEvents = new Map<string, LifecycleJobEventRecord[]>();
  readonly updateArtifacts = new Map<string, UpdateArtifactRecord>();
  readonly storageMigrationPlans = new Map<string, StorageMigrationPlanRecord>();
  maintenanceLock?: MaintenanceLockRecord;
}

function requireRecord<T>(record: T | undefined, type: string, id: string): T {
  if (!record) throw new LifecycleNotFoundError(`${type} ${id} was not found`);
  return record;
}

function ordered<T extends { id: string; createdAt: string }>(records: T[]) {
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export class InMemoryRecoveryPointRepository implements RecoveryPointRepository {
  constructor(private readonly store: InMemoryLifecycleStore) {}

  async create(input: RecoveryPointCreateInput) {
    assertRecoveryPointCreateInput(input);
    const record: RecoveryPointRecord = {
      id: randomUUID(),
      kind: input.kind,
      status: "pending",
      createdBy: copy(input.createdBy),
      requestReason: input.requestReason,
      appVersion: input.appVersion,
      schemaFingerprint: input.schemaFingerprint,
      postgresVersion: input.postgresVersion,
      storageLayoutVersion: input.storageLayoutVersion,
      totalSizeBytes: "0",
      ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
      ...(input.retainUntil ? { retainUntil: nowIso(input.retainUntil, "retainUntil") } : {}),
      retentionProtected: input.retentionProtected ?? false,
      createdAt: new Date().toISOString(),
      artifacts: []
    };
    this.store.recoveryPoints.set(record.id, record);
    return copy(record);
  }

  async getById(id: string) {
    const record = this.store.recoveryPoints.get(id);
    return record ? copy(record) : undefined;
  }

  async list(filters: Parameters<RecoveryPointRepository["list"]>[0] = {}) {
    const limit = filters.limit ?? 100;
    return copy(
      ordered([...this.store.recoveryPoints.values()])
        .filter((record) => !filters.kind || record.kind === filters.kind)
        .filter((record) => !filters.status || record.status === filters.status)
        .reverse()
        .slice(0, limit)
    );
  }

  async attachArtifact(recoveryPointId: string, input: RecoveryPointArtifactInput) {
    assertRecoveryPointArtifactInput(input);
    const recoveryPoint = requireRecord(this.store.recoveryPoints.get(recoveryPointId), "RecoveryPoint", recoveryPointId);
    if (recoveryPoint.status !== "creating") {
      throw new LifecycleTransitionError("Artifacts can only be attached while a RecoveryPoint is creating");
    }
    if (recoveryPoint.artifacts.some((artifact) => artifact.relativeName === input.relativeName)) {
      throw new LifecycleConflictError(`Artifact relativeName already exists: ${input.relativeName}`);
    }
    const artifact: RecoveryPointArtifactRecord = {
      id: randomUUID(),
      recoveryPointId,
      ...input,
      createdAt: new Date().toISOString()
    };
    recoveryPoint.artifacts.push(artifact);
    return copy(artifact);
  }

  async markCreating(id: string) {
    const record = requireRecord(this.store.recoveryPoints.get(id), "RecoveryPoint", id);
    assertRecoveryPointTransition(record.status, "creating");
    record.status = "creating";
    return copy(record);
  }

  async markVerified(input: Parameters<RecoveryPointRepository["markVerified"]>[0]) {
    const record = requireRecord(this.store.recoveryPoints.get(input.id), "RecoveryPoint", input.id);
    assertRecoveryPointTransition(record.status, "verified");
    assertSha256(input.packageDigest, "packageDigest");
    assertDecimalBytes(input.totalSizeBytes, "totalSizeBytes");
    if (record.artifacts.length === 0 || record.artifacts.some((artifact) => artifact.verificationStatus !== "verified")) {
      throw new LifecycleTransitionError("All RecoveryPoint artifacts must be present and verified");
    }
    const artifactTotal = record.artifacts.reduce((sum, artifact) => sum + BigInt(artifact.sizeBytes), 0n);
    if (artifactTotal !== BigInt(input.totalSizeBytes)) {
      throw new LifecycleTransitionError("totalSizeBytes must equal the sum of RecoveryPoint artifacts");
    }
    const completedAt = nowIso(input.completedAt, "completedAt");
    record.status = "verified";
    record.packageDigest = input.packageDigest;
    record.totalSizeBytes = input.totalSizeBytes;
    record.completedAt = completedAt;
    record.verifiedAt = input.verifiedAt ? nowIso(input.verifiedAt, "verifiedAt") : completedAt;
    return copy(record);
  }

  async markFailed(input: Parameters<RecoveryPointRepository["markFailed"]>[0]) {
    assertSafeLifecycleText(input.failureReason, "failureReason");
    const record = requireRecord(this.store.recoveryPoints.get(input.id), "RecoveryPoint", input.id);
    assertRecoveryPointTransition(record.status, "failed");
    record.status = "failed";
    record.failedAt = nowIso(input.failedAt, "failedAt");
    record.failureCode = input.failureCode;
    record.failureReason = input.failureReason;
    return copy(record);
  }
}

function assertOwnedActiveLease(job: LifecycleJobRecord, executorId: string, at: Date) {
  if (job.executorId !== executorId) throw new LifecycleConflictError("LifecycleJob is owned by another executor");
  if (!isLeaseActive(job.leaseExpiresAt, at)) throw new LifecycleConflictError("LifecycleJob lease has expired");
}

export class InMemoryLifecycleJobRepository implements LifecycleJobRepository {
  constructor(private readonly store: InMemoryLifecycleStore) {}

  async create(input: LifecycleJobCreateInput) {
    assertLifecycleJobCreateInput(input);
    if ("recoveryPointId" in input) {
      requireRecord(this.store.recoveryPoints.get(input.recoveryPointId), "RecoveryPoint", input.recoveryPointId);
    }
    if ("updateArtifactId" in input) {
      requireRecord(this.store.updateArtifacts.get(input.updateArtifactId), "UpdateArtifact", input.updateArtifactId);
    }
    if (input.action === "migrate_storage") {
      requireRecord(this.store.storageMigrationPlans.get(input.parameters.migrationPlanId), "StorageMigrationPlan", input.parameters.migrationPlanId);
    }
    if ([...this.store.jobs.values()].some((job) => job.idempotencyKey === input.idempotencyKey)) {
      throw new LifecycleConflictError(`LifecycleJob idempotencyKey already exists: ${input.idempotencyKey}`);
    }
    const createdAt = new Date().toISOString();
    const record: LifecycleJobRecord = {
      id: randomUUID(),
      action: input.action,
      status: "queued",
      requestedBy: copy(input.requestedBy),
      requestReason: input.requestReason,
      idempotencyKey: input.idempotencyKey,
      parameters: copy(input.parameters),
      ...("recoveryPointId" in input ? { recoveryPointId: input.recoveryPointId } : {}),
      ...("updateArtifactId" in input ? { updateArtifactId: input.updateArtifactId } : {}),
      createdAt,
      updatedAt: createdAt
    };
    this.store.jobs.set(record.id, record);
    return copy(record);
  }

  async getById(id: string) {
    const record = this.store.jobs.get(id);
    return record ? copy(record) : undefined;
  }

  async list(filters: Parameters<LifecycleJobRepository["list"]>[0] = {}) {
    const limit = filters.limit ?? 100;
    return copy(
      ordered([...this.store.jobs.values()])
        .filter((record) => !filters.action || record.action === filters.action)
        .filter((record) => !filters.status || record.status === filters.status)
        .reverse()
        .slice(0, limit)
    );
  }

  async claimNextJob(input: Parameters<LifecycleJobRepository["claimNextJob"]>[0]) {
    const now = parseTimestamp(input.now, "now");
    const candidate = ordered([...this.store.jobs.values()]).find(
      (job) => (!input.allowedActions || input.allowedActions.includes(job.action)) &&
        (job.status === "queued" || (job.status === "claimed" && !isLeaseActive(job.leaseExpiresAt, now)))
    );
    if (!candidate) return undefined;
    if (candidate.status === "queued") assertLifecycleJobTransition(candidate.status, "claimed");
    candidate.status = "claimed";
    candidate.executorId = input.executorId;
    candidate.heartbeatAt = now.toISOString();
    candidate.leaseExpiresAt = leaseExpiry(now, input.leaseDurationMs).toISOString();
    candidate.updatedAt = now.toISOString();
    return copy(candidate);
  }

  async renewLease(input: Parameters<LifecycleJobRepository["renewLease"]>[0]) {
    const now = parseTimestamp(input.now, "now");
    const job = requireRecord(this.store.jobs.get(input.id), "LifecycleJob", input.id);
    if (job.status !== "claimed" && job.status !== "running") {
      throw new LifecycleTransitionError(`Cannot renew lease for LifecycleJob in ${job.status}`);
    }
    assertOwnedActiveLease(job, input.executorId, now);
    job.heartbeatAt = now.toISOString();
    job.leaseExpiresAt = leaseExpiry(now, input.leaseDurationMs).toISOString();
    job.updatedAt = now.toISOString();
    return copy(job);
  }

  async appendEvent(input: LifecycleJobEventInput) {
    requireRecord(this.store.jobs.get(input.jobId), "LifecycleJob", input.jobId);
    if (input.progress !== undefined && (!Number.isInteger(input.progress) || input.progress < 0 || input.progress > 100)) {
      throw new LifecycleTransitionError("LifecycleJobEvent progress must be between 0 and 100");
    }
    if (input.structuredMetadata) assertRestrictedJson(input.structuredMetadata, "structuredMetadata");
    assertSafeLifecycleText(input.message, "message");
    const event: LifecycleJobEventRecord = {
      ...copy(input),
      id: randomUUID(),
      createdAt: nowIso(input.createdAt, "createdAt")
    };
    const events = this.store.jobEvents.get(input.jobId) ?? [];
    events.push(event);
    this.store.jobEvents.set(input.jobId, events);
    return copy(event);
  }

  async listEvents(jobId: string) {
    return copy(ordered([...(this.store.jobEvents.get(jobId) ?? [])]));
  }

  async markRunning(input: Parameters<LifecycleJobRepository["markRunning"]>[0]) {
    const at = parseTimestamp(input.startedAt, "startedAt");
    const job = requireRecord(this.store.jobs.get(input.id), "LifecycleJob", input.id);
    assertOwnedActiveLease(job, input.executorId, at);
    assertLifecycleJobTransition(job.status, "running");
    job.status = "running";
    job.startedAt = at.toISOString();
    job.updatedAt = at.toISOString();
    return copy(job);
  }

  async markCompleted(input: Parameters<LifecycleJobRepository["markCompleted"]>[0]) {
    const at = parseTimestamp(input.completedAt, "completedAt");
    const job = requireRecord(this.store.jobs.get(input.id), "LifecycleJob", input.id);
    assertOwnedActiveLease(job, input.executorId, at);
    assertLifecycleJobTransition(job.status, "completed");
    job.status = "completed";
    job.completedAt = at.toISOString();
    job.heartbeatAt = at.toISOString();
    job.leaseExpiresAt = undefined;
    job.updatedAt = at.toISOString();
    return copy(job);
  }

  async markFailed(input: Parameters<LifecycleJobRepository["markFailed"]>[0]) {
    assertSafeLifecycleText(input.errorMessage, "errorMessage");
    const at = parseTimestamp(input.failedAt, "failedAt");
    const job = requireRecord(this.store.jobs.get(input.id), "LifecycleJob", input.id);
    assertOwnedActiveLease(job, input.executorId, at);
    assertLifecycleJobTransition(job.status, "failed");
    job.status = "failed";
    job.failedAt = at.toISOString();
    job.errorCode = input.errorCode;
    job.errorMessage = input.errorMessage;
    job.heartbeatAt = at.toISOString();
    job.leaseExpiresAt = undefined;
    job.updatedAt = at.toISOString();
    return copy(job);
  }

  async markManualReviewRequired(input: Parameters<LifecycleJobRepository["markManualReviewRequired"]>[0]) {
    assertSafeLifecycleText(input.errorMessage, "errorMessage");
    const at = parseTimestamp(input.failedAt, "failedAt");
    const job = requireRecord(this.store.jobs.get(input.id), "LifecycleJob", input.id);
    if (job.executorId !== input.executorId || (job.status !== "claimed" && job.status !== "running")) {
      throw new LifecycleConflictError("LifecycleJob is not an interrupted job owned by this executor");
    }
    job.status = "failed";
    job.failedAt = at.toISOString();
    job.errorCode = "MANUAL_REVIEW_REQUIRED";
    job.errorMessage = input.errorMessage;
    job.heartbeatAt = at.toISOString();
    job.leaseExpiresAt = undefined;
    job.updatedAt = at.toISOString();
    return copy(job);
  }

  async markCancelled(input: Parameters<LifecycleJobRepository["markCancelled"]>[0]) {
    const at = parseTimestamp(input.cancelledAt, "cancelledAt");
    const job = requireRecord(this.store.jobs.get(input.id), "LifecycleJob", input.id);
    assertLifecycleJobTransition(job.status, "cancelled");
    job.status = "cancelled";
    job.completedAt = at.toISOString();
    job.leaseExpiresAt = undefined;
    job.executorId = undefined;
    job.updatedAt = at.toISOString();
    return copy(job);
  }
}

export class InMemoryMaintenanceLockRepository implements MaintenanceLockRepository {
  constructor(private readonly store: InMemoryLifecycleStore) {}

  async acquire(input: Parameters<MaintenanceLockRepository["acquire"]>[0]) {
    const now = parseTimestamp(input.now, "now");
    const job = requireRecord(this.store.jobs.get(input.currentJobId), "LifecycleJob", input.currentJobId);
    if (
      job.executorId !== input.executorId ||
      (job.status !== "claimed" && job.status !== "running") ||
      !isLeaseActive(job.leaseExpiresAt, now)
    ) {
      return undefined;
    }
    const current = this.store.maintenanceLock;
    if (current?.currentJobId && isLeaseActive(current.leaseExpiresAt, now) &&
      (current.currentJobId !== input.currentJobId || current.executorId !== input.executorId)) {
      return undefined;
    }
    const acquiredAt = current?.currentJobId === input.currentJobId && current.executorId === input.executorId
      ? current.acquiredAt ?? now.toISOString()
      : now.toISOString();
    this.store.maintenanceLock = {
      scope: GLOBAL_MAINTENANCE_LOCK_SCOPE,
      currentJobId: input.currentJobId,
      executorId: input.executorId,
      leaseExpiresAt: leaseExpiry(now, input.leaseDurationMs).toISOString(),
      heartbeatAt: now.toISOString(),
      acquiredAt,
      updatedAt: now.toISOString()
    };
    return copy(this.store.maintenanceLock);
  }

  async renew(input: Parameters<MaintenanceLockRepository["renew"]>[0]) {
    const now = parseTimestamp(input.now, "now");
    const current = this.store.maintenanceLock;
    const job = this.store.jobs.get(input.currentJobId);
    if (!current || current.currentJobId !== input.currentJobId || current.executorId !== input.executorId) {
      throw new LifecycleConflictError("MaintenanceLock is owned by another job or executor");
    }
    if (!isLeaseActive(current.leaseExpiresAt, now)) throw new LifecycleConflictError("MaintenanceLock lease has expired");
    if (!job || job.executorId !== input.executorId || (job.status !== "claimed" && job.status !== "running") || !isLeaseActive(job.leaseExpiresAt, now)) {
      throw new LifecycleConflictError("LifecycleJob ownership or lease is invalid");
    }
    current.heartbeatAt = now.toISOString();
    current.leaseExpiresAt = leaseExpiry(now, input.leaseDurationMs).toISOString();
    current.updatedAt = now.toISOString();
    return copy(current);
  }

  async release(input: Parameters<MaintenanceLockRepository["release"]>[0]) {
    const current = this.store.maintenanceLock;
    if (!current || current.currentJobId !== input.currentJobId || current.executorId !== input.executorId) return false;
    const releasedAt = nowIso(input.releasedAt, "releasedAt");
    this.store.maintenanceLock = {
      scope: GLOBAL_MAINTENANCE_LOCK_SCOPE,
      updatedAt: releasedAt
    };
    return true;
  }

  async inspect() {
    return this.store.maintenanceLock ? copy(this.store.maintenanceLock) : undefined;
  }
}

export class InMemoryUpdateArtifactRepository implements UpdateArtifactRepository {
  constructor(private readonly store: InMemoryLifecycleStore) {}

  async register(input: UpdateArtifactRegisterInput) {
    assertUpdateArtifactRegisterInput(input);
    if ([...this.store.updateArtifacts.values()].some((artifact) => artifact.digest === input.digest)) {
      throw new LifecycleConflictError(`UpdateArtifact digest already exists: ${input.digest}`);
    }
    const record: UpdateArtifactRecord = {
      id: randomUUID(),
      version: input.version,
      digest: input.digest,
      manifestSummary: copy(input.manifestSummary),
      compatibilityInformation: copy(input.compatibilityInformation),
      discoveredAt: nowIso(input.discoveredAt, "discoveredAt"),
      ...(input.verifiedAt ? { verifiedAt: nowIso(input.verifiedAt, "verifiedAt") } : {}),
      status: input.status,
      ...(input.failureReason ? { failureReason: input.failureReason } : {})
    };
    this.store.updateArtifacts.set(record.id, record);
    return copy(record);
  }

  async findByDigest(digest: string) {
    const record = [...this.store.updateArtifacts.values()].find((artifact) => artifact.digest === digest);
    return record ? copy(record) : undefined;
  }

  async getById(id: string) {
    const record = this.store.updateArtifacts.get(id);
    return record ? copy(record) : undefined;
  }

  async list(filters: Parameters<UpdateArtifactRepository["list"]>[0] = {}) {
    const limit = filters.limit ?? 100;
    return copy(
      [...this.store.updateArtifacts.values()]
        .filter((record) => !filters.status || record.status === filters.status)
        .sort((left, right) => left.discoveredAt.localeCompare(right.discoveredAt) || left.id.localeCompare(right.id))
        .reverse()
        .slice(0, limit)
    );
  }

  async markVerification(input: Parameters<UpdateArtifactRepository["markVerification"]>[0]) {
    assertUpdateArtifactVerificationInput(input);
    const current = requireRecord(this.store.updateArtifacts.get(input.id), "UpdateArtifact", input.id);
    if (current.status !== "discovered") throw new LifecycleTransitionError("UpdateArtifact verification is already final");
    const updated: UpdateArtifactRecord = {
      ...current,
      status: input.status,
      manifestSummary: copy(input.manifestSummary),
      compatibilityInformation: copy(input.compatibilityInformation),
      ...(input.status === "verified" ? { verifiedAt: nowIso(input.verifiedAt, "verifiedAt") } : {}),
      ...(input.failureReason ? { failureReason: input.failureReason } : {})
    };
    this.store.updateArtifacts.set(updated.id, updated);
    return copy(updated);
  }
}

export class InMemoryStorageMigrationPlanRepository implements StorageMigrationPlanRepository {
  constructor(private readonly store: InMemoryLifecycleStore) {}

  async create(input: StorageMigrationPlanCreateInput) {
    assertStorageMigrationPlanCreateInput(input);
    const record: StorageMigrationPlanRecord = {
      id: randomUUID(),
      requestedBy: copy(input.requestedBy),
      targetPathProtected: input.targetPathProtected,
      targetDisplayName: input.targetDisplayName,
      preflightSummary: copy(input.preflightSummary),
      status: "prepared",
      createdAt: new Date().toISOString()
    };
    this.store.storageMigrationPlans.set(record.id, record);
    return copy(record);
  }

  async getById(id: string) {
    const record = this.store.storageMigrationPlans.get(id);
    return record ? copy(record) : undefined;
  }

  async list(limit = 100) {
    return copy(ordered([...this.store.storageMigrationPlans.values()]).reverse().slice(0, limit));
  }

  async markStatus(id: string, status: Parameters<StorageMigrationPlanRepository["markStatus"]>[1], failureReason?: string) {
    const record = requireRecord(this.store.storageMigrationPlans.get(id), "StorageMigrationPlan", id);
    const allowed: Record<StorageMigrationPlanRecord["status"], StorageMigrationPlanRecord["status"][]> = {
      prepared: ["running", "failed"],
      running: ["completed", "failed", "manual_review_required"],
      completed: [], failed: [], manual_review_required: []
    };
    if (!allowed[record.status].includes(status)) throw new LifecycleTransitionError(`StorageMigrationPlan ${record.status} cannot transition to ${status}`);
    if (failureReason) assertSafeLifecycleText(failureReason, "failureReason");
    record.status = status;
    const at = new Date().toISOString();
    if (status === "running") record.verifiedAt = at;
    if (status === "completed") record.completedAt = at;
    if (status === "failed" || status === "manual_review_required") {
      record.failedAt = at;
      if (failureReason) record.failureReason = failureReason;
    }
    return copy(record);
  }
}

export function createInMemoryLifecycleRepositorySet(
  store: InMemoryLifecycleStore = new InMemoryLifecycleStore()
): LifecycleRepositorySet {
  return {
    recoveryPoints: new InMemoryRecoveryPointRepository(store),
    jobs: new InMemoryLifecycleJobRepository(store),
    maintenanceLock: new InMemoryMaintenanceLockRepository(store),
    updateArtifacts: new InMemoryUpdateArtifactRepository(store),
    storageMigrationPlans: new InMemoryStorageMigrationPlanRepository(store)
  };
}
