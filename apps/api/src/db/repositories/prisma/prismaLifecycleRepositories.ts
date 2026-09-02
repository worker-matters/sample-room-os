import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  ActorSnapshot,
  ArtifactVerificationStatus,
  LifecycleJobCreateInput,
  LifecycleJobEventInput,
  LifecycleJobEventRecord,
  LifecycleJobParameters,
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
  UpdateArtifactRepository,
  UpdateArtifactStatus
} from "../contracts/index.js";
import { GLOBAL_MAINTENANCE_LOCK_SCOPE } from "../contracts/index.js";
import {
  LifecycleConflictError,
  LifecycleNotFoundError,
  LifecycleTransitionError,
  assertDecimalBytes,
  assertLifecycleJobCreateInput,
  assertRecoveryPointArtifactInput,
  assertRecoveryPointCreateInput,
  assertRestrictedJson,
  assertSafeLifecycleText,
  assertSha256,
  assertStorageMigrationPlanCreateInput,
  assertUpdateArtifactRegisterInput,
  assertUpdateArtifactVerificationInput,
  leaseExpiry,
  parseTimestamp
} from "../../../modules/lifecycle/lifecycleRules.js";

type PrismaRecoveryPointWithArtifacts = Prisma.RecoveryPointGetPayload<{ include: { artifacts: true } }>;

function optionalIso(value: Date | null) {
  return value?.toISOString();
}

function actorSnapshot(actorId: string, actorName: string, actorRole: string): ActorSnapshot {
  return { actorId, actorName, actorRole: actorRole as ActorSnapshot["actorRole"] };
}

function mapArtifact(record: Prisma.RecoveryPointArtifactGetPayload<Record<string, never>>): RecoveryPointArtifactRecord {
  return {
    id: record.id,
    recoveryPointId: record.recoveryPointId,
    kind: record.kind,
    relativeName: record.relativeName,
    sizeBytes: record.sizeBytes.toString(),
    sha256: record.sha256,
    verificationStatus: record.verificationStatus as ArtifactVerificationStatus,
    createdAt: record.createdAt.toISOString()
  };
}

function mapRecoveryPoint(record: PrismaRecoveryPointWithArtifacts): RecoveryPointRecord {
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    createdBy: actorSnapshot(record.createdByActorId, record.createdByName, record.createdByRole),
    requestReason: record.requestReason,
    appVersion: record.appVersion,
    schemaFingerprint: record.schemaFingerprint,
    postgresVersion: record.postgresVersion,
    storageLayoutVersion: record.storageLayoutVersion,
    ...(record.packageDigest ? { packageDigest: record.packageDigest } : {}),
    totalSizeBytes: record.totalSizeBytes.toString(),
    ...(record.retentionDays !== null ? { retentionDays: record.retentionDays } : {}),
    ...(record.retainUntil ? { retainUntil: record.retainUntil.toISOString() } : {}),
    retentionProtected: record.retentionProtected,
    createdAt: record.createdAt.toISOString(),
    ...(record.completedAt ? { completedAt: record.completedAt.toISOString() } : {}),
    ...(record.verifiedAt ? { verifiedAt: record.verifiedAt.toISOString() } : {}),
    ...(record.failedAt ? { failedAt: record.failedAt.toISOString() } : {}),
    ...(record.failureCode ? { failureCode: record.failureCode } : {}),
    ...(record.failureReason ? { failureReason: record.failureReason } : {}),
    artifacts: record.artifacts.map(mapArtifact)
  };
}

function mapJob(record: Prisma.LifecycleJobGetPayload<Record<string, never>>): LifecycleJobRecord {
  return {
    id: record.id,
    action: record.action,
    status: record.status,
    requestedBy: actorSnapshot(record.requestedByActorId, record.requestedByName, record.requestedByRole),
    requestReason: record.requestReason,
    idempotencyKey: record.idempotencyKey,
    parameters: record.parameters as LifecycleJobParameters,
    ...(record.recoveryPointId ? { recoveryPointId: record.recoveryPointId } : {}),
    ...(record.updateArtifactId ? { updateArtifactId: record.updateArtifactId } : {}),
    ...(record.executorId ? { executorId: record.executorId } : {}),
    ...(optionalIso(record.leaseExpiresAt) ? { leaseExpiresAt: optionalIso(record.leaseExpiresAt)! } : {}),
    ...(optionalIso(record.heartbeatAt) ? { heartbeatAt: optionalIso(record.heartbeatAt)! } : {}),
    ...(optionalIso(record.startedAt) ? { startedAt: optionalIso(record.startedAt)! } : {}),
    ...(optionalIso(record.completedAt) ? { completedAt: optionalIso(record.completedAt)! } : {}),
    ...(optionalIso(record.failedAt) ? { failedAt: optionalIso(record.failedAt)! } : {}),
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function mapEvent(record: Prisma.LifecycleJobEventGetPayload<Record<string, never>>): LifecycleJobEventRecord {
  const hasActor = record.actorIdSnapshot && record.actorNameSnapshot && record.actorRoleSnapshot;
  return {
    id: record.id,
    jobId: record.jobId,
    eventType: record.eventType,
    ...(record.phase ? { phase: record.phase } : {}),
    ...(record.progress !== null ? { progress: record.progress } : {}),
    message: record.message,
    ...(hasActor ? { actorSnapshot: actorSnapshot(record.actorIdSnapshot!, record.actorNameSnapshot!, record.actorRoleSnapshot!) } : {}),
    ...(record.executorIdSnapshot ? { executorIdSnapshot: record.executorIdSnapshot } : {}),
    ...(record.structuredMetadata ? { structuredMetadata: record.structuredMetadata as Record<string, unknown> } : {}),
    createdAt: record.createdAt.toISOString()
  };
}

function mapLock(record: Prisma.MaintenanceLockGetPayload<Record<string, never>>): MaintenanceLockRecord {
  return {
    scope: GLOBAL_MAINTENANCE_LOCK_SCOPE,
    ...(record.currentJobId ? { currentJobId: record.currentJobId } : {}),
    ...(record.executorId ? { executorId: record.executorId } : {}),
    ...(record.leaseExpiresAt ? { leaseExpiresAt: record.leaseExpiresAt.toISOString() } : {}),
    ...(record.heartbeatAt ? { heartbeatAt: record.heartbeatAt.toISOString() } : {}),
    ...(record.acquiredAt ? { acquiredAt: record.acquiredAt.toISOString() } : {}),
    updatedAt: record.updatedAt.toISOString()
  };
}

function mapUpdateArtifact(record: Prisma.UpdateArtifactGetPayload<Record<string, never>>): UpdateArtifactRecord {
  return {
    id: record.id,
    version: record.version,
    digest: record.digest,
    manifestSummary: record.manifestSummary as Record<string, unknown>,
    compatibilityInformation: record.compatibilityInformation as Record<string, unknown>,
    discoveredAt: record.discoveredAt.toISOString(),
    ...(record.verifiedAt ? { verifiedAt: record.verifiedAt.toISOString() } : {}),
    status: record.status as UpdateArtifactStatus,
    ...(record.failureReason ? { failureReason: record.failureReason } : {})
  };
}

function mapStorageMigrationPlan(record: Prisma.StorageMigrationPlanGetPayload<Record<string, never>>): StorageMigrationPlanRecord {
  return {
    id: record.id,
    requestedBy: actorSnapshot(record.requestedByActorId, record.requestedByName, record.requestedByRole),
    targetPathProtected: record.targetPathProtected,
    targetDisplayName: record.targetDisplayName,
    preflightSummary: record.preflightSummary as Record<string, unknown>,
    status: record.status as StorageMigrationPlanRecord["status"],
    createdAt: record.createdAt.toISOString(),
    ...(record.verifiedAt ? { verifiedAt: record.verifiedAt.toISOString() } : {}),
    ...(record.completedAt ? { completedAt: record.completedAt.toISOString() } : {}),
    ...(record.failedAt ? { failedAt: record.failedAt.toISOString() } : {}),
    ...(record.failureReason ? { failureReason: record.failureReason } : {})
  };
}

function translateUniqueConflict(error: unknown, entity: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new LifecycleConflictError(`${entity} already exists`);
  }
  throw error;
}

export class PrismaRecoveryPointRepository implements RecoveryPointRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: RecoveryPointCreateInput) {
    assertRecoveryPointCreateInput(input);
    const record = await this.prisma.recoveryPoint.create({
      data: {
        kind: input.kind,
        createdByActorId: input.createdBy.actorId,
        createdByName: input.createdBy.actorName,
        createdByRole: input.createdBy.actorRole,
        requestReason: input.requestReason,
        appVersion: input.appVersion,
        schemaFingerprint: input.schemaFingerprint,
        postgresVersion: input.postgresVersion,
        storageLayoutVersion: input.storageLayoutVersion,
        ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
        ...(input.retainUntil ? { retainUntil: parseTimestamp(input.retainUntil, "retainUntil") } : {}),
        retentionProtected: input.retentionProtected ?? false
      },
      include: { artifacts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } }
    });
    return mapRecoveryPoint(record);
  }

  async getById(id: string) {
    const record = await this.prisma.recoveryPoint.findUnique({
      where: { id },
      include: { artifacts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } }
    });
    return record ? mapRecoveryPoint(record) : undefined;
  }

  async list(filters: Parameters<RecoveryPointRepository["list"]>[0] = {}) {
    const records = await this.prisma.recoveryPoint.findMany({
      where: { ...(filters.kind ? { kind: filters.kind } : {}), ...(filters.status ? { status: filters.status } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: filters.limit ?? 100,
      include: { artifacts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } }
    });
    return records.map(mapRecoveryPoint);
  }

  async attachArtifact(recoveryPointId: string, input: RecoveryPointArtifactInput) {
    assertRecoveryPointArtifactInput(input);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<Array<{ status: string }>>`
          SELECT "status"::text AS "status"
          FROM "RecoveryPoint"
          WHERE "id" = ${recoveryPointId}
          FOR UPDATE
        `;
        if (!rows[0]) throw new LifecycleNotFoundError(`RecoveryPoint ${recoveryPointId} was not found`);
        if (rows[0].status !== "creating") {
          throw new LifecycleTransitionError("Artifacts can only be attached while a RecoveryPoint is creating");
        }
        return mapArtifact(await transaction.recoveryPointArtifact.create({
          data: {
            recoveryPointId,
            kind: input.kind,
            relativeName: input.relativeName,
            sizeBytes: BigInt(input.sizeBytes),
            sha256: input.sha256,
            verificationStatus: input.verificationStatus
          }
        }));
      });
    } catch (error) {
      translateUniqueConflict(error, "RecoveryPointArtifact relativeName");
    }
  }

  async markCreating(id: string) {
    const updated = await this.prisma.recoveryPoint.updateMany({ where: { id, status: "pending" }, data: { status: "creating" } });
    if (updated.count === 0) await this.throwRecoveryPointStateError(id, "creating");
    return (await this.getById(id))!;
  }

  async markVerified(input: Parameters<RecoveryPointRepository["markVerified"]>[0]) {
    assertSha256(input.packageDigest, "packageDigest");
    assertDecimalBytes(input.totalSizeBytes, "totalSizeBytes");
    const completedAt = parseTimestamp(input.completedAt, "completedAt");
    const verifiedAt = input.verifiedAt ? parseTimestamp(input.verifiedAt, "verifiedAt") : completedAt;
    await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ status: string }>>`
        SELECT "status"::text AS "status"
        FROM "RecoveryPoint"
        WHERE "id" = ${input.id}
        FOR UPDATE
      `;
      if (!rows[0]) throw new LifecycleNotFoundError(`RecoveryPoint ${input.id} was not found`);
      if (rows[0].status !== "creating" && rows[0].status !== "completed") {
        throw new LifecycleTransitionError(`Cannot mark RecoveryPoint ${rows[0].status} as verified`);
      }
      const aggregate = await transaction.recoveryPointArtifact.aggregate({
        where: { recoveryPointId: input.id, verificationStatus: "verified" },
        _count: true,
        _sum: { sizeBytes: true }
      });
      const allCount = await transaction.recoveryPointArtifact.count({ where: { recoveryPointId: input.id } });
      if (allCount === 0 || aggregate._count !== allCount) {
        throw new LifecycleTransitionError("All RecoveryPoint artifacts must be present and verified");
      }
      if ((aggregate._sum.sizeBytes ?? 0n) !== BigInt(input.totalSizeBytes)) {
        throw new LifecycleTransitionError("totalSizeBytes must equal the sum of RecoveryPoint artifacts");
      }
      await transaction.recoveryPoint.update({
        where: { id: input.id },
        data: { status: "verified", packageDigest: input.packageDigest, totalSizeBytes: BigInt(input.totalSizeBytes), completedAt, verifiedAt }
      });
    });
    return (await this.getById(input.id))!;
  }

  async markFailed(input: Parameters<RecoveryPointRepository["markFailed"]>[0]) {
    assertSafeLifecycleText(input.failureReason, "failureReason");
    const failedAt = parseTimestamp(input.failedAt, "failedAt");
    const updated = await this.prisma.recoveryPoint.updateMany({
      where: { id: input.id, status: { in: ["pending", "creating", "completed"] } },
      data: { status: "failed", failedAt, failureCode: input.failureCode, failureReason: input.failureReason }
    });
    if (updated.count === 0) await this.throwRecoveryPointStateError(input.id, "failed");
    return (await this.getById(input.id))!;
  }

  private async throwRecoveryPointStateError(id: string, target: string): Promise<never> {
    const existing = await this.prisma.recoveryPoint.findUnique({ where: { id }, select: { status: true } });
    if (!existing) throw new LifecycleNotFoundError(`RecoveryPoint ${id} was not found`);
    throw new LifecycleTransitionError(`Cannot mark RecoveryPoint ${existing.status} as ${target}`);
  }
}

export class PrismaLifecycleJobRepository implements LifecycleJobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: LifecycleJobCreateInput) {
    assertLifecycleJobCreateInput(input);
    try {
      return mapJob(await this.prisma.lifecycleJob.create({
        data: {
          action: input.action,
          requestedByActorId: input.requestedBy.actorId,
          requestedByName: input.requestedBy.actorName,
          requestedByRole: input.requestedBy.actorRole,
          requestReason: input.requestReason,
          idempotencyKey: input.idempotencyKey,
          parameters: input.parameters as Prisma.InputJsonValue,
          ...("recoveryPointId" in input ? { recoveryPointId: input.recoveryPointId } : {}),
          ...("updateArtifactId" in input ? { updateArtifactId: input.updateArtifactId } : {})
        }
      }));
    } catch (error) {
      translateUniqueConflict(error, "LifecycleJob idempotencyKey");
    }
  }

  async getById(id: string) {
    const record = await this.prisma.lifecycleJob.findUnique({ where: { id } });
    return record ? mapJob(record) : undefined;
  }

  async list(filters: Parameters<LifecycleJobRepository["list"]>[0] = {}) {
    return (await this.prisma.lifecycleJob.findMany({
      where: { ...(filters.action ? { action: filters.action } : {}), ...(filters.status ? { status: filters.status } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: filters.limit ?? 100
    })).map(mapJob);
  }

  async claimNextJob(input: Parameters<LifecycleJobRepository["claimNextJob"]>[0]) {
    const now = parseTimestamp(input.now, "now");
    const expiresAt = leaseExpiry(now, input.leaseDurationMs);
    const actionFilter = input.allowedActions?.length
      ? Prisma.sql`AND "action"::text IN (${Prisma.join(input.allowedActions)})`
      : Prisma.empty;
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "LifecycleJob"
        WHERE ("status" = 'queued'::"LifecycleJobStatus"
           OR ("status" = 'claimed'::"LifecycleJobStatus" AND "leaseExpiresAt" <= ${now}))
        ${actionFilter}
        ORDER BY "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      if (!rows[0]) return undefined;
      return mapJob(await transaction.lifecycleJob.update({
        where: { id: rows[0].id },
        data: { status: "claimed", executorId: input.executorId, heartbeatAt: now, leaseExpiresAt: expiresAt }
      }));
    });
  }

  async renewLease(input: Parameters<LifecycleJobRepository["renewLease"]>[0]) {
    const now = parseTimestamp(input.now, "now");
    const updated = await this.prisma.lifecycleJob.updateMany({
      where: {
        id: input.id,
        executorId: input.executorId,
        status: { in: ["claimed", "running"] },
        leaseExpiresAt: { gt: now }
      },
      data: { heartbeatAt: now, leaseExpiresAt: leaseExpiry(now, input.leaseDurationMs) }
    });
    if (updated.count === 0) await this.throwJobStateError(input.id, "renew lease");
    return (await this.getById(input.id))!;
  }

  async appendEvent(input: LifecycleJobEventInput) {
    if (input.progress !== undefined && (!Number.isInteger(input.progress) || input.progress < 0 || input.progress > 100)) {
      throw new LifecycleTransitionError("LifecycleJobEvent progress must be between 0 and 100");
    }
    if (input.structuredMetadata) assertRestrictedJson(input.structuredMetadata, "structuredMetadata");
    assertSafeLifecycleText(input.message, "message");
    return mapEvent(await this.prisma.lifecycleJobEvent.create({
      data: {
        jobId: input.jobId,
        eventType: input.eventType,
        ...(input.phase ? { phase: input.phase } : {}),
        ...(input.progress !== undefined ? { progress: input.progress } : {}),
        message: input.message,
        ...(input.actorSnapshot ? {
          actorIdSnapshot: input.actorSnapshot.actorId,
          actorNameSnapshot: input.actorSnapshot.actorName,
          actorRoleSnapshot: input.actorSnapshot.actorRole
        } : {}),
        ...(input.executorIdSnapshot ? { executorIdSnapshot: input.executorIdSnapshot } : {}),
        ...(input.structuredMetadata ? { structuredMetadata: input.structuredMetadata as Prisma.InputJsonValue } : {}),
        ...(input.createdAt ? { createdAt: parseTimestamp(input.createdAt, "createdAt") } : {})
      }
    }));
  }

  async listEvents(jobId: string) {
    return (await this.prisma.lifecycleJobEvent.findMany({
      where: { jobId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    })).map(mapEvent);
  }

  async markRunning(input: Parameters<LifecycleJobRepository["markRunning"]>[0]) {
    const at = parseTimestamp(input.startedAt, "startedAt");
    const updated = await this.prisma.lifecycleJob.updateMany({
      where: { id: input.id, executorId: input.executorId, status: "claimed", leaseExpiresAt: { gt: at } },
      data: { status: "running", startedAt: at }
    });
    if (updated.count === 0) await this.throwJobStateError(input.id, "running");
    return (await this.getById(input.id))!;
  }

  async markCompleted(input: Parameters<LifecycleJobRepository["markCompleted"]>[0]) {
    const at = parseTimestamp(input.completedAt, "completedAt");
    const updated = await this.prisma.lifecycleJob.updateMany({
      where: { id: input.id, executorId: input.executorId, status: "running", leaseExpiresAt: { gt: at } },
      data: { status: "completed", completedAt: at, heartbeatAt: at, leaseExpiresAt: null }
    });
    if (updated.count === 0) await this.throwJobStateError(input.id, "completed");
    return (await this.getById(input.id))!;
  }

  async markFailed(input: Parameters<LifecycleJobRepository["markFailed"]>[0]) {
    assertSafeLifecycleText(input.errorMessage, "errorMessage");
    const at = parseTimestamp(input.failedAt, "failedAt");
    const updated = await this.prisma.lifecycleJob.updateMany({
      where: { id: input.id, executorId: input.executorId, status: { in: ["claimed", "running"] }, leaseExpiresAt: { gt: at } },
      data: { status: "failed", failedAt: at, errorCode: input.errorCode, errorMessage: input.errorMessage, heartbeatAt: at, leaseExpiresAt: null }
    });
    if (updated.count === 0) await this.throwJobStateError(input.id, "failed");
    return (await this.getById(input.id))!;
  }

  async markManualReviewRequired(input: Parameters<LifecycleJobRepository["markManualReviewRequired"]>[0]) {
    assertSafeLifecycleText(input.errorMessage, "errorMessage");
    const at = parseTimestamp(input.failedAt, "failedAt");
    const updated = await this.prisma.lifecycleJob.updateMany({
      where: { id: input.id, executorId: input.executorId, status: { in: ["claimed", "running"] } },
      data: {
        status: "failed",
        failedAt: at,
        errorCode: "MANUAL_REVIEW_REQUIRED",
        errorMessage: input.errorMessage,
        heartbeatAt: at,
        leaseExpiresAt: null
      }
    });
    if (updated.count === 0) await this.throwJobStateError(input.id, "manual review required");
    return (await this.getById(input.id))!;
  }

  async markCancelled(input: Parameters<LifecycleJobRepository["markCancelled"]>[0]) {
    const at = parseTimestamp(input.cancelledAt, "cancelledAt");
    const updated = await this.prisma.lifecycleJob.updateMany({
      where: { id: input.id, status: { in: ["queued", "claimed"] } },
      data: { status: "cancelled", completedAt: at, executorId: null, leaseExpiresAt: null }
    });
    if (updated.count === 0) await this.throwJobStateError(input.id, "cancelled");
    return (await this.getById(input.id))!;
  }

  private async throwJobStateError(id: string, target: string): Promise<never> {
    const existing = await this.prisma.lifecycleJob.findUnique({
      where: { id },
      select: { status: true, executorId: true, leaseExpiresAt: true }
    });
    if (!existing) throw new LifecycleNotFoundError(`LifecycleJob ${id} was not found`);
    throw new LifecycleTransitionError(`Cannot transition LifecycleJob ${existing.status} to ${target}; ownership or lease is invalid`);
  }
}

export class PrismaMaintenanceLockRepository implements MaintenanceLockRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async acquire(input: Parameters<MaintenanceLockRepository["acquire"]>[0]) {
    const now = parseTimestamp(input.now, "now");
    const expiresAt = leaseExpiry(now, input.leaseDurationMs);
    const rows = await this.prisma.$queryRaw<Array<Prisma.MaintenanceLockGetPayload<Record<string, never>>>>`
      INSERT INTO "MaintenanceLock" (
        "scope", "currentJobId", "executorId", "leaseExpiresAt", "heartbeatAt", "acquiredAt", "updatedAt"
      )
      SELECT ${GLOBAL_MAINTENANCE_LOCK_SCOPE}, "id", ${input.executorId}, ${expiresAt}, ${now}, ${now}, ${now}
      FROM "LifecycleJob"
      WHERE "id" = ${input.currentJobId}
        AND "executorId" = ${input.executorId}
        AND "status" IN ('claimed'::"LifecycleJobStatus", 'running'::"LifecycleJobStatus")
        AND "leaseExpiresAt" > ${now}
      ON CONFLICT ("scope") DO UPDATE SET
        "currentJobId" = EXCLUDED."currentJobId",
        "executorId" = EXCLUDED."executorId",
        "leaseExpiresAt" = EXCLUDED."leaseExpiresAt",
        "heartbeatAt" = EXCLUDED."heartbeatAt",
        "acquiredAt" = CASE
          WHEN "MaintenanceLock"."currentJobId" = EXCLUDED."currentJobId"
           AND "MaintenanceLock"."executorId" = EXCLUDED."executorId"
          THEN "MaintenanceLock"."acquiredAt"
          ELSE EXCLUDED."acquiredAt"
        END,
        "updatedAt" = EXCLUDED."updatedAt"
      WHERE "MaintenanceLock"."currentJobId" IS NULL
         OR "MaintenanceLock"."leaseExpiresAt" <= ${now}
         OR ("MaintenanceLock"."currentJobId" = ${input.currentJobId} AND "MaintenanceLock"."executorId" = ${input.executorId})
      RETURNING *
    `;
    return rows[0] ? mapLock(rows[0]) : undefined;
  }

  async renew(input: Parameters<MaintenanceLockRepository["renew"]>[0]) {
    const now = parseTimestamp(input.now, "now");
    const updated = await this.prisma.maintenanceLock.updateMany({
      where: {
        scope: GLOBAL_MAINTENANCE_LOCK_SCOPE,
        currentJobId: input.currentJobId,
        executorId: input.executorId,
        leaseExpiresAt: { gt: now },
        currentJob: {
          executorId: input.executorId,
          status: { in: ["claimed", "running"] },
          leaseExpiresAt: { gt: now }
        }
      },
      data: { heartbeatAt: now, leaseExpiresAt: leaseExpiry(now, input.leaseDurationMs) }
    });
    if (updated.count === 0) throw new LifecycleConflictError("MaintenanceLock ownership or lease is invalid");
    return mapLock((await this.prisma.maintenanceLock.findUnique({ where: { scope: GLOBAL_MAINTENANCE_LOCK_SCOPE } }))!);
  }

  async release(input: Parameters<MaintenanceLockRepository["release"]>[0]) {
    const releasedAt = parseTimestamp(input.releasedAt, "releasedAt");
    const updated = await this.prisma.maintenanceLock.updateMany({
      where: { scope: GLOBAL_MAINTENANCE_LOCK_SCOPE, currentJobId: input.currentJobId, executorId: input.executorId },
      data: { currentJobId: null, executorId: null, leaseExpiresAt: null, heartbeatAt: null, acquiredAt: null, updatedAt: releasedAt }
    });
    return updated.count === 1;
  }

  async inspect() {
    const record = await this.prisma.maintenanceLock.findUnique({ where: { scope: GLOBAL_MAINTENANCE_LOCK_SCOPE } });
    return record ? mapLock(record) : undefined;
  }
}

export class PrismaUpdateArtifactRepository implements UpdateArtifactRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async register(input: UpdateArtifactRegisterInput) {
    assertUpdateArtifactRegisterInput(input);
    try {
      return mapUpdateArtifact(await this.prisma.updateArtifact.create({
        data: {
          version: input.version,
          digest: input.digest,
          manifestSummary: input.manifestSummary as Prisma.InputJsonValue,
          compatibilityInformation: input.compatibilityInformation as Prisma.InputJsonValue,
          ...(input.discoveredAt ? { discoveredAt: parseTimestamp(input.discoveredAt, "discoveredAt") } : {}),
          ...(input.verifiedAt ? { verifiedAt: parseTimestamp(input.verifiedAt, "verifiedAt") } : {}),
          status: input.status,
          ...(input.failureReason ? { failureReason: input.failureReason } : {})
        }
      }));
    } catch (error) {
      translateUniqueConflict(error, "UpdateArtifact digest");
    }
  }

  async findByDigest(digest: string) {
    const record = await this.prisma.updateArtifact.findUnique({ where: { digest } });
    return record ? mapUpdateArtifact(record) : undefined;
  }

  async getById(id: string) {
    const record = await this.prisma.updateArtifact.findUnique({ where: { id } });
    return record ? mapUpdateArtifact(record) : undefined;
  }

  async list(filters: Parameters<UpdateArtifactRepository["list"]>[0] = {}) {
    return (await this.prisma.updateArtifact.findMany({
      where: filters.status ? { status: filters.status } : {},
      orderBy: [{ discoveredAt: "desc" }, { id: "desc" }],
      take: filters.limit ?? 100
    })).map(mapUpdateArtifact);
  }

  async markVerification(input: Parameters<UpdateArtifactRepository["markVerification"]>[0]) {
    assertUpdateArtifactVerificationInput(input);
    const updated = await this.prisma.updateArtifact.updateMany({
      where: { id: input.id, status: "discovered" },
      data: {
        status: input.status,
        manifestSummary: input.manifestSummary as Prisma.InputJsonValue,
        compatibilityInformation: input.compatibilityInformation as Prisma.InputJsonValue,
        verifiedAt: input.status === "verified" ? parseTimestamp(input.verifiedAt, "verifiedAt") : null,
        failureReason: input.failureReason ?? null
      }
    });
    if (updated.count !== 1) {
      const existing = await this.prisma.updateArtifact.findUnique({ where: { id: input.id } });
      if (!existing) throw new LifecycleNotFoundError(`UpdateArtifact not found: ${input.id}`);
      throw new LifecycleTransitionError("UpdateArtifact verification is already final");
    }
    return mapUpdateArtifact((await this.prisma.updateArtifact.findUnique({ where: { id: input.id } }))!);
  }
}

export class PrismaStorageMigrationPlanRepository implements StorageMigrationPlanRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: StorageMigrationPlanCreateInput) {
    assertStorageMigrationPlanCreateInput(input);
    return mapStorageMigrationPlan(await this.prisma.storageMigrationPlan.create({
      data: {
        requestedByActorId: input.requestedBy.actorId,
        requestedByName: input.requestedBy.actorName,
        requestedByRole: input.requestedBy.actorRole,
        targetPathProtected: input.targetPathProtected,
        targetDisplayName: input.targetDisplayName,
        preflightSummary: input.preflightSummary as Prisma.InputJsonValue
      }
    }));
  }

  async getById(id: string) {
    const record = await this.prisma.storageMigrationPlan.findUnique({ where: { id } });
    return record ? mapStorageMigrationPlan(record) : undefined;
  }

  async list(limit = 100) {
    return (await this.prisma.storageMigrationPlan.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit })).map(mapStorageMigrationPlan);
  }

  async markStatus(id: string, status: Parameters<StorageMigrationPlanRepository["markStatus"]>[1], failureReason?: string) {
    if (failureReason) assertSafeLifecycleText(failureReason, "failureReason");
    const allowedFrom = status === "running" ? ["prepared"] : status === "completed" || status === "manual_review_required" ? ["running"] : ["prepared", "running"];
    const now = new Date();
    const updated = await this.prisma.storageMigrationPlan.updateMany({
      where: { id, status: { in: allowedFrom } },
      data: {
        status,
        ...(status === "running" ? { verifiedAt: now } : {}),
        ...(status === "completed" ? { completedAt: now } : {}),
        ...(status === "failed" || status === "manual_review_required" ? { failedAt: now, failureReason: failureReason ?? null } : {})
      }
    });
    if (updated.count === 0) throw new LifecycleTransitionError("StorageMigrationPlan is missing or already final");
    return (await this.getById(id))!;
  }
}

export function createPrismaLifecycleRepositorySet(prisma: PrismaClient): LifecycleRepositorySet {
  return {
    recoveryPoints: new PrismaRecoveryPointRepository(prisma),
    jobs: new PrismaLifecycleJobRepository(prisma),
    maintenanceLock: new PrismaMaintenanceLockRepository(prisma),
    updateArtifacts: new PrismaUpdateArtifactRepository(prisma),
    storageMigrationPlans: new PrismaStorageMigrationPlanRepository(prisma)
  };
}
