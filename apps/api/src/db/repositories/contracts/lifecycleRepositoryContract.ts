import type { Role } from "@sample-room/shared";

export const RECOVERY_POINT_KINDS = [
  "manual",
  "daily_backup",
  "monthly_snapshot",
  "pre_update",
  "pre_restore",
  "pre_storage_migration"
] as const;
export type RecoveryPointKind = (typeof RECOVERY_POINT_KINDS)[number];

export const RECOVERY_POINT_STATUSES = ["pending", "creating", "completed", "verified", "failed"] as const;
export type RecoveryPointStatus = (typeof RECOVERY_POINT_STATUSES)[number];

export const LIFECYCLE_JOB_ACTIONS = [
  "create_recovery_point",
  "restore_recovery_point",
  "preflight_update",
  "apply_update",
  "migrate_storage",
  "diagnostic"
] as const;
export type LifecycleJobAction = (typeof LIFECYCLE_JOB_ACTIONS)[number];

export const LIFECYCLE_JOB_STATUSES = ["queued", "claimed", "running", "completed", "failed", "cancelled"] as const;
export type LifecycleJobStatus = (typeof LIFECYCLE_JOB_STATUSES)[number];

export const LIFECYCLE_ARTIFACT_KINDS = ["database_dump", "file_archive", "config_snapshot", "manifest"] as const;
export type LifecycleArtifactKind = (typeof LIFECYCLE_ARTIFACT_KINDS)[number];
export type ArtifactVerificationStatus = "pending" | "verified" | "failed";

export const UPDATE_ARTIFACT_STATUSES = ["discovered", "verified", "failed"] as const;
export type UpdateArtifactStatus = (typeof UPDATE_ARTIFACT_STATUSES)[number];

export type ActorSnapshot = {
  actorId: string;
  actorName: string;
  actorRole: Role;
};

export type RecoveryPointArtifactRecord = {
  id: string;
  recoveryPointId: string;
  kind: LifecycleArtifactKind;
  relativeName: string;
  sizeBytes: string;
  sha256: string;
  verificationStatus: ArtifactVerificationStatus;
  createdAt: string;
};

export type RecoveryPointRecord = {
  id: string;
  kind: RecoveryPointKind;
  status: RecoveryPointStatus;
  createdBy: ActorSnapshot;
  requestReason: string;
  appVersion: string;
  schemaFingerprint: string;
  postgresVersion: string;
  storageLayoutVersion: string;
  packageDigest?: string | undefined;
  totalSizeBytes: string;
  retentionDays?: number | undefined;
  retainUntil?: string | undefined;
  retentionProtected: boolean;
  createdAt: string;
  completedAt?: string | undefined;
  verifiedAt?: string | undefined;
  failedAt?: string | undefined;
  failureCode?: string | undefined;
  failureReason?: string | undefined;
  artifacts: RecoveryPointArtifactRecord[];
};

export type RecoveryPointCreateInput = {
  kind: RecoveryPointKind;
  createdBy: ActorSnapshot;
  requestReason: string;
  appVersion: string;
  schemaFingerprint: string;
  postgresVersion: string;
  storageLayoutVersion: string;
  retentionDays?: number | undefined;
  retainUntil?: string | undefined;
  retentionProtected?: boolean | undefined;
};

export type RecoveryPointArtifactInput = {
  kind: LifecycleArtifactKind;
  relativeName: string;
  sizeBytes: string;
  sha256: string;
  verificationStatus: Extract<ArtifactVerificationStatus, "verified" | "failed">;
};

export interface RecoveryPointRepository {
  create(input: RecoveryPointCreateInput): Promise<RecoveryPointRecord>;
  getById(id: string): Promise<RecoveryPointRecord | undefined>;
  list(filters?: { kind?: RecoveryPointKind; status?: RecoveryPointStatus; limit?: number }): Promise<RecoveryPointRecord[]>;
  attachArtifact(recoveryPointId: string, input: RecoveryPointArtifactInput): Promise<RecoveryPointArtifactRecord>;
  markCreating(id: string, at?: string): Promise<RecoveryPointRecord>;
  markVerified(input: {
    id: string;
    packageDigest: string;
    totalSizeBytes: string;
    completedAt?: string;
    verifiedAt?: string;
  }): Promise<RecoveryPointRecord>;
  markFailed(input: { id: string; failureCode: string; failureReason: string; failedAt?: string }): Promise<RecoveryPointRecord>;
}

export type LifecycleJobParameters =
  | { recoveryPointId: string; kind: RecoveryPointKind }
  | { recoveryPointId: string }
  | { updateArtifactId: string }
  | { migrationPlanId: string; mode: "copy_verify_switch" }
  | { profile: "standard" };

type LifecycleJobCreateBase = {
  requestedBy: ActorSnapshot;
  requestReason: string;
  idempotencyKey: string;
};

export type LifecycleJobCreateInput = LifecycleJobCreateBase & (
  | {
      action: "create_recovery_point";
      parameters: { recoveryPointId: string; kind: RecoveryPointKind };
      recoveryPointId: string;
    }
  | {
      action: "restore_recovery_point";
      parameters: { recoveryPointId: string };
      recoveryPointId: string;
    }
  | {
      action: "preflight_update" | "apply_update";
      parameters: { updateArtifactId: string };
      updateArtifactId: string;
    }
  | {
      action: "migrate_storage";
      parameters: { migrationPlanId: string; mode: "copy_verify_switch" };
    }
  | {
      action: "diagnostic";
      parameters: { profile: "standard" };
    }
);

export type LifecycleJobRecord = {
  id: string;
  action: LifecycleJobAction;
  status: LifecycleJobStatus;
  requestedBy: ActorSnapshot;
  requestReason: string;
  idempotencyKey: string;
  parameters: LifecycleJobParameters;
  recoveryPointId?: string | undefined;
  updateArtifactId?: string | undefined;
  executorId?: string | undefined;
  leaseExpiresAt?: string | undefined;
  heartbeatAt?: string | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  failedAt?: string | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

export type LifecycleJobEventRecord = {
  id: string;
  jobId: string;
  eventType: string;
  phase?: string | undefined;
  progress?: number | undefined;
  message: string;
  actorSnapshot?: ActorSnapshot | undefined;
  executorIdSnapshot?: string | undefined;
  structuredMetadata?: Record<string, unknown> | undefined;
  createdAt: string;
};

export type LifecycleJobEventInput = Omit<LifecycleJobEventRecord, "id" | "createdAt"> & {
  createdAt?: string;
};

export interface LifecycleJobRepository {
  create(input: LifecycleJobCreateInput): Promise<LifecycleJobRecord>;
  getById(id: string): Promise<LifecycleJobRecord | undefined>;
  list(filters?: { action?: LifecycleJobAction; status?: LifecycleJobStatus; limit?: number }): Promise<LifecycleJobRecord[]>;
  claimNextJob(input: { executorId: string; now?: string; leaseDurationMs: number; allowedActions?: readonly LifecycleJobAction[] }): Promise<LifecycleJobRecord | undefined>;
  renewLease(input: { id: string; executorId: string; now?: string; leaseDurationMs: number }): Promise<LifecycleJobRecord>;
  appendEvent(input: LifecycleJobEventInput): Promise<LifecycleJobEventRecord>;
  listEvents(jobId: string): Promise<LifecycleJobEventRecord[]>;
  markRunning(input: { id: string; executorId: string; startedAt?: string }): Promise<LifecycleJobRecord>;
  markCompleted(input: { id: string; executorId: string; completedAt?: string }): Promise<LifecycleJobRecord>;
  markFailed(input: { id: string; executorId: string; errorCode: string; errorMessage: string; failedAt?: string }): Promise<LifecycleJobRecord>;
  /**
   * Records an interrupted single-machine runner without reclaiming or
   * replaying the job. This deliberately does not require an active lease.
   */
  markManualReviewRequired(input: { id: string; executorId: string; errorMessage: string; failedAt?: string }): Promise<LifecycleJobRecord>;
  markCancelled(input: { id: string; cancelledAt?: string }): Promise<LifecycleJobRecord>;
}

export const GLOBAL_MAINTENANCE_LOCK_SCOPE = "global_lifecycle" as const;

export type MaintenanceLockRecord = {
  scope: typeof GLOBAL_MAINTENANCE_LOCK_SCOPE;
  currentJobId?: string | undefined;
  executorId?: string | undefined;
  leaseExpiresAt?: string | undefined;
  heartbeatAt?: string | undefined;
  acquiredAt?: string | undefined;
  updatedAt: string;
};

export interface MaintenanceLockRepository {
  acquire(input: { currentJobId: string; executorId: string; now?: string; leaseDurationMs: number }): Promise<MaintenanceLockRecord | undefined>;
  renew(input: { currentJobId: string; executorId: string; now?: string; leaseDurationMs: number }): Promise<MaintenanceLockRecord>;
  release(input: { currentJobId: string; executorId: string; releasedAt?: string }): Promise<boolean>;
  inspect(): Promise<MaintenanceLockRecord | undefined>;
}

export type UpdateArtifactRecord = {
  id: string;
  version: string;
  digest: string;
  manifestSummary: Record<string, unknown>;
  compatibilityInformation: Record<string, unknown>;
  discoveredAt: string;
  verifiedAt?: string | undefined;
  status: UpdateArtifactStatus;
  failureReason?: string | undefined;
};

export type UpdateArtifactRegisterInput = Omit<UpdateArtifactRecord, "id" | "discoveredAt"> & {
  discoveredAt?: string;
};

export type UpdateArtifactVerificationInput = {
  id: string;
  status: Extract<UpdateArtifactStatus, "verified" | "failed">;
  manifestSummary: Record<string, unknown>;
  compatibilityInformation: Record<string, unknown>;
  verifiedAt?: string;
  failureReason?: string;
};

export interface UpdateArtifactRepository {
  register(input: UpdateArtifactRegisterInput): Promise<UpdateArtifactRecord>;
  findByDigest(digest: string): Promise<UpdateArtifactRecord | undefined>;
  getById(id: string): Promise<UpdateArtifactRecord | undefined>;
  list(filters?: { status?: UpdateArtifactStatus; limit?: number }): Promise<UpdateArtifactRecord[]>;
  markVerification(input: UpdateArtifactVerificationInput): Promise<UpdateArtifactRecord>;
}

export const STORAGE_MIGRATION_PLAN_STATUSES = ["prepared", "running", "completed", "failed", "manual_review_required"] as const;
export type StorageMigrationPlanStatus = (typeof STORAGE_MIGRATION_PLAN_STATUSES)[number];

export type StorageMigrationPlanRecord = {
  id: string;
  requestedBy: ActorSnapshot;
  targetPathProtected: string;
  targetDisplayName: string;
  preflightSummary: Record<string, unknown>;
  status: StorageMigrationPlanStatus;
  createdAt: string;
  verifiedAt?: string;
  completedAt?: string;
  failedAt?: string;
  failureReason?: string;
};

export type StorageMigrationPlanCreateInput = {
  requestedBy: ActorSnapshot;
  targetPathProtected: string;
  targetDisplayName: string;
  preflightSummary: Record<string, unknown>;
};

export interface StorageMigrationPlanRepository {
  create(input: StorageMigrationPlanCreateInput): Promise<StorageMigrationPlanRecord>;
  getById(id: string): Promise<StorageMigrationPlanRecord | undefined>;
  list(limit?: number): Promise<StorageMigrationPlanRecord[]>;
  markStatus(id: string, status: StorageMigrationPlanStatus, failureReason?: string): Promise<StorageMigrationPlanRecord>;
}

export type LifecycleRepositorySet = {
  recoveryPoints: RecoveryPointRepository;
  jobs: LifecycleJobRepository;
  maintenanceLock: MaintenanceLockRepository;
  updateArtifacts: UpdateArtifactRepository;
  storageMigrationPlans: StorageMigrationPlanRepository;
};
