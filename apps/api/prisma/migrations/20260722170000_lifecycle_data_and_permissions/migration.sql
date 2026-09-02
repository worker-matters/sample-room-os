-- LCM-01 is additive only: new enums, tables, indexes, constraints, and foreign keys.
CREATE TYPE "RecoveryPointKind" AS ENUM ('manual', 'daily_backup', 'monthly_snapshot', 'pre_update', 'pre_restore', 'pre_storage_migration');
CREATE TYPE "RecoveryPointStatus" AS ENUM ('pending', 'creating', 'completed', 'verified', 'failed');
CREATE TYPE "LifecycleJobAction" AS ENUM ('create_recovery_point', 'restore_recovery_point', 'preflight_update', 'apply_update', 'migrate_storage', 'diagnostic');
CREATE TYPE "LifecycleJobStatus" AS ENUM ('queued', 'claimed', 'running', 'completed', 'failed', 'cancelled');
CREATE TYPE "LifecycleArtifactKind" AS ENUM ('database_dump', 'file_archive', 'config_snapshot', 'manifest');

CREATE TABLE "RecoveryPoint" (
    "id" TEXT NOT NULL,
    "kind" "RecoveryPointKind" NOT NULL,
    "status" "RecoveryPointStatus" NOT NULL DEFAULT 'pending',
    "createdByActorId" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdByRole" TEXT NOT NULL,
    "requestReason" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "schemaFingerprint" TEXT NOT NULL,
    "postgresVersion" TEXT NOT NULL,
    "storageLayoutVersion" TEXT NOT NULL,
    "packageDigest" TEXT,
    "totalSizeBytes" BIGINT NOT NULL DEFAULT 0,
    "retentionDays" INTEGER,
    "retainUntil" TIMESTAMP(3),
    "retentionProtected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureReason" TEXT,
    CONSTRAINT "RecoveryPoint_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecoveryPoint_retentionDays_check" CHECK ("retentionDays" IS NULL OR "retentionDays" > 0),
    CONSTRAINT "RecoveryPoint_totalSizeBytes_check" CHECK ("totalSizeBytes" >= 0)
);

CREATE TABLE "RecoveryPointArtifact" (
    "id" TEXT NOT NULL,
    "recoveryPointId" TEXT NOT NULL,
    "kind" "LifecycleArtifactKind" NOT NULL,
    "relativeName" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecoveryPointArtifact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecoveryPointArtifact_sizeBytes_check" CHECK ("sizeBytes" >= 0),
    CONSTRAINT "RecoveryPointArtifact_verificationStatus_check" CHECK ("verificationStatus" IN ('pending', 'verified', 'failed')),
    CONSTRAINT "RecoveryPointArtifact_relativeName_check" CHECK (
        "relativeName" <> ''
        AND "relativeName" !~ '(^[A-Za-z]:[\\/])|(^[\\/]{1,2})|(^|[\\/])\.\.([\\/]|$)'
    )
);

CREATE TABLE "UpdateArtifact" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "manifestSummary" JSONB NOT NULL,
    "compatibilityInformation" JSONB NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'discovered',
    "failureReason" TEXT,
    CONSTRAINT "UpdateArtifact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UpdateArtifact_digest_check" CHECK ("digest" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "UpdateArtifact_status_check" CHECK ("status" IN ('discovered', 'verified', 'failed'))
);

CREATE TABLE "LifecycleJob" (
    "id" TEXT NOT NULL,
    "action" "LifecycleJobAction" NOT NULL,
    "status" "LifecycleJobStatus" NOT NULL DEFAULT 'queued',
    "requestedByActorId" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "requestedByRole" TEXT NOT NULL,
    "requestReason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "recoveryPointId" TEXT,
    "updateArtifactId" TEXT,
    "executorId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LifecycleJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LifecycleJobEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "phase" TEXT,
    "progress" INTEGER,
    "message" TEXT NOT NULL,
    "actorIdSnapshot" TEXT,
    "actorNameSnapshot" TEXT,
    "actorRoleSnapshot" TEXT,
    "executorIdSnapshot" TEXT,
    "structuredMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LifecycleJobEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LifecycleJobEvent_progress_check" CHECK ("progress" IS NULL OR "progress" BETWEEN 0 AND 100)
);

CREATE TABLE "MaintenanceLock" (
    "scope" TEXT NOT NULL,
    "currentJobId" TEXT,
    "executorId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "acquiredAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaintenanceLock_pkey" PRIMARY KEY ("scope"),
    CONSTRAINT "MaintenanceLock_global_singleton_check" CHECK ("scope" = 'global_lifecycle'),
    CONSTRAINT "MaintenanceLock_ownership_check" CHECK (
        ("currentJobId" IS NULL AND "executorId" IS NULL AND "leaseExpiresAt" IS NULL)
        OR ("currentJobId" IS NOT NULL AND "executorId" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    )
);

CREATE INDEX "RecoveryPoint_status_createdAt_idx" ON "RecoveryPoint"("status", "createdAt");
CREATE INDEX "RecoveryPoint_kind_createdAt_idx" ON "RecoveryPoint"("kind", "createdAt");
CREATE INDEX "RecoveryPoint_retainUntil_idx" ON "RecoveryPoint"("retainUntil");
CREATE UNIQUE INDEX "RecoveryPointArtifact_recoveryPointId_relativeName_key" ON "RecoveryPointArtifact"("recoveryPointId", "relativeName");
CREATE INDEX "RecoveryPointArtifact_recoveryPointId_createdAt_idx" ON "RecoveryPointArtifact"("recoveryPointId", "createdAt");
CREATE INDEX "RecoveryPointArtifact_sha256_idx" ON "RecoveryPointArtifact"("sha256");
CREATE UNIQUE INDEX "UpdateArtifact_digest_key" ON "UpdateArtifact"("digest");
CREATE INDEX "UpdateArtifact_version_discoveredAt_idx" ON "UpdateArtifact"("version", "discoveredAt");
CREATE INDEX "UpdateArtifact_status_discoveredAt_idx" ON "UpdateArtifact"("status", "discoveredAt");
CREATE UNIQUE INDEX "LifecycleJob_idempotencyKey_key" ON "LifecycleJob"("idempotencyKey");
CREATE INDEX "LifecycleJob_status_createdAt_idx" ON "LifecycleJob"("status", "createdAt");
CREATE INDEX "LifecycleJob_action_createdAt_idx" ON "LifecycleJob"("action", "createdAt");
CREATE INDEX "LifecycleJob_recoveryPointId_idx" ON "LifecycleJob"("recoveryPointId");
CREATE INDEX "LifecycleJob_updateArtifactId_idx" ON "LifecycleJob"("updateArtifactId");
CREATE INDEX "LifecycleJob_executorId_leaseExpiresAt_idx" ON "LifecycleJob"("executorId", "leaseExpiresAt");
CREATE INDEX "LifecycleJobEvent_jobId_createdAt_id_idx" ON "LifecycleJobEvent"("jobId", "createdAt", "id");
CREATE INDEX "MaintenanceLock_currentJobId_idx" ON "MaintenanceLock"("currentJobId");
CREATE INDEX "MaintenanceLock_leaseExpiresAt_idx" ON "MaintenanceLock"("leaseExpiresAt");

ALTER TABLE "RecoveryPointArtifact"
  ADD CONSTRAINT "RecoveryPointArtifact_recoveryPointId_fkey"
  FOREIGN KEY ("recoveryPointId") REFERENCES "RecoveryPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LifecycleJob"
  ADD CONSTRAINT "LifecycleJob_recoveryPointId_fkey"
  FOREIGN KEY ("recoveryPointId") REFERENCES "RecoveryPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LifecycleJob"
  ADD CONSTRAINT "LifecycleJob_updateArtifactId_fkey"
  FOREIGN KEY ("updateArtifactId") REFERENCES "UpdateArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LifecycleJobEvent"
  ADD CONSTRAINT "LifecycleJobEvent_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "LifecycleJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceLock"
  ADD CONSTRAINT "MaintenanceLock_currentJobId_fkey"
  FOREIGN KEY ("currentJobId") REFERENCES "LifecycleJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
