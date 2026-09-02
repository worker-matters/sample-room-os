import { ROLES } from "@sample-room/shared";
import type {
  LifecycleJobCreateInput,
  LifecycleJobStatus,
  LifecycleRepositorySet,
  RecoveryPointCreateInput
} from "../../db/repositories/contracts/index.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { HttpError } from "../../shared/errors/httpError.js";
import {
  LifecycleConflictError,
  LifecycleTransitionError,
  assertSafeLifecycleText
} from "./lifecycleRules.js";

type OwnerJobRequest<T> = T extends LifecycleJobCreateInput ? Omit<T, "requestedBy"> : never;
export type LifecycleJobRequest = OwnerJobRequest<LifecycleJobCreateInput>;
export type RecoveryPointRequest = Omit<RecoveryPointCreateInput, "createdBy">;

export type LifecycleOperationHistoryItem = {
  id: string;
  operation: string;
  result: "in_progress" | "success" | "failed" | "needs_review" | "cancelled";
  requestedBy: string;
  requestReason: string;
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  subject?: string;
  dataSafety: string;
  nextStep: string;
  technicalCode?: string;
};

const USER_OPERATION_LABELS: Record<string, string> = {
  create_recovery_point: "创建系统恢复点",
  restore_recovery_point: "恢复系统",
  preflight_update: "检查系统更新包",
  apply_update: "系统更新",
  migrate_storage: "更换存储位置",
  diagnostic: "检查系统"
};

const V1_RUNNER_ACTIONS = ["diagnostic", "create_recovery_point"] as const;

function requireSystemOwner(currentUser: CurrentUser) {
  if (currentUser.role !== ROLES.systemOwner) throw new HttpError(403, "forbidden");
}

function snapshot(currentUser: CurrentUser) {
  return {
    actorId: currentUser.accountId ?? currentUser.id,
    actorName: currentUser.displayName?.trim() || currentUser.id,
    actorRole: currentUser.role
  };
}

/**
 * Domain boundary for the future System Owner HTTP API. It exposes no host
 * paths or commands and snapshots the requesting identity at write time.
 */
export class LifecycleSystemOwnerService {
  private submissionTail: Promise<void> = Promise.resolve();

  constructor(private readonly repositories: LifecycleRepositorySet) {}

  async createRecoveryPoint(currentUser: CurrentUser, input: RecoveryPointRequest) {
    requireSystemOwner(currentUser);
    return this.repositories.recoveryPoints.create({ ...input, createdBy: snapshot(currentUser) });
  }

  async requestRecoveryPoint(currentUser: CurrentUser, input: RecoveryPointRequest & { idempotencyKey: string }) {
    requireSystemOwner(currentUser);
    const requestedBy = snapshot(currentUser);
    return this.serializeSubmission(async () => {
      const existing = (await this.repositories.jobs.list({ limit: 100 })).find((job) => job.idempotencyKey === input.idempotencyKey);
      if (existing) {
        const recoveryPoint = existing.recoveryPointId ? await this.repositories.recoveryPoints.getById(existing.recoveryPointId) : undefined;
        if (recoveryPoint) return { recoveryPoint, job: existing };
        throw new HttpError(409, "lifecycle_idempotency_conflict");
      }

      const activeStatuses: LifecycleJobStatus[] = ["queued", "claimed", "running"];
      const active = await Promise.all(activeStatuses.map((status) => this.repositories.jobs.list({ status })));
      if (active.some((jobs) => jobs.length > 0)) throw new HttpError(409, "lifecycle_maintenance_in_progress");
      const lock = await this.repositories.maintenanceLock.inspect();
      if (lock?.currentJobId) throw new HttpError(409, "lifecycle_manual_review_required");

      const recoveryPoint = await this.repositories.recoveryPoints.create({ ...input, createdBy: requestedBy });
      try {
        const job = await this.repositories.jobs.create({
          action: "create_recovery_point",
          requestReason: input.requestReason,
          idempotencyKey: input.idempotencyKey,
          recoveryPointId: recoveryPoint.id,
          parameters: { recoveryPointId: recoveryPoint.id, kind: input.kind },
          requestedBy
        });
        await this.repositories.jobs.appendEvent({
          jobId: job.id,
          eventType: "job_requested",
          phase: "queued",
          progress: 0,
          message: "A system recovery point was requested",
          actorSnapshot: requestedBy,
          structuredMetadata: { action: job.action }
        });
        return { recoveryPoint, job };
      } catch (error) {
        // The unique database key remains the cross-process idempotency guard.
        // This process has already serialized its own submission, so an existing
        // key here can only be a concurrent process using the same request key.
        if (error instanceof LifecycleConflictError) {
          const duplicate = (await this.repositories.jobs.list({ limit: 100 })).find((job) => job.idempotencyKey === input.idempotencyKey);
          if (duplicate?.recoveryPointId) {
            const existingRecoveryPoint = await this.repositories.recoveryPoints.getById(duplicate.recoveryPointId);
            if (existingRecoveryPoint) return { recoveryPoint: existingRecoveryPoint, job: duplicate };
          }
        }
        await this.repositories.recoveryPoints.markFailed({
          id: recoveryPoint.id,
          failureCode: "RECOVERY_POINT_REQUEST_FAILED",
          failureReason: "The maintenance request could not be registered."
        });
        throw error;
      }
    });
  }

  async requestJob(currentUser: CurrentUser, input: LifecycleJobRequest) {
    requireSystemOwner(currentUser);
    if (input.action !== "diagnostic") {
      throw new HttpError(501, "lifecycle_action_not_available");
    }
    const requestedBy = snapshot(currentUser);
    return this.serializeSubmission(async () => {
      const existing = (await this.repositories.jobs.list({ limit: 100 })).find((job) => job.idempotencyKey === input.idempotencyKey);
      if (existing) return existing;
      const activeStatuses: LifecycleJobStatus[] = ["queued", "claimed", "running"];
      const active = await Promise.all(activeStatuses.map((status) => this.repositories.jobs.list({ status })));
      if (active.some((jobs) => jobs.length > 0)) {
        throw new HttpError(409, "lifecycle_maintenance_in_progress");
      }
      const lock = await this.repositories.maintenanceLock.inspect();
      if (lock?.currentJobId) throw new HttpError(409, "lifecycle_manual_review_required");

      try {
        const job = await this.repositories.jobs.create({ ...input, requestedBy } as LifecycleJobCreateInput);
        await this.repositories.jobs.appendEvent({
          jobId: job.id,
          eventType: "job_requested",
          phase: "queued",
          progress: 0,
          message: `Typed lifecycle job ${job.action} was requested`,
          actorSnapshot: requestedBy,
          structuredMetadata: { action: job.action }
        });
        return job;
      } catch (error) {
        if (!(error instanceof LifecycleConflictError)) throw error;
        const existing = (await this.repositories.jobs.list({ limit: 100 })).find((job) => job.idempotencyKey === input.idempotencyKey);
        if (existing) return existing;
        throw error;
      }
    });
  }

  async requestRestore(currentUser: CurrentUser, input: { recoveryPointId: string; requestReason: string; idempotencyKey: string; confirmationText: string }) {
    requireSystemOwner(currentUser);
    void input;
    throw new HttpError(501, "automatic_restore_not_available");
  }

  private async serializeSubmission<T>(operation: () => Promise<T>) {
    const prior = this.submissionTail;
    let release!: () => void;
    this.submissionTail = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try { return await operation(); } finally { release(); }
  }

  async getRecoveryPoint(currentUser: CurrentUser, id: string) {
    requireSystemOwner(currentUser);
    return this.repositories.recoveryPoints.getById(id);
  }

  async listRecoveryPoints(currentUser: CurrentUser) {
    requireSystemOwner(currentUser);
    return this.repositories.recoveryPoints.list();
  }

  async getJob(currentUser: CurrentUser, id: string) {
    requireSystemOwner(currentUser);
    return this.repositories.jobs.getById(id);
  }

  async listJobs(currentUser: CurrentUser) {
    requireSystemOwner(currentUser);
    return this.repositories.jobs.list();
  }

  async listUserOperationHistory(currentUser: CurrentUser): Promise<LifecycleOperationHistoryItem[]> {
    requireSystemOwner(currentUser);
    const [jobs, recoveryPoints, updateArtifacts, storagePlans] = await Promise.all([
      this.repositories.jobs.list({ limit: 100 }),
      this.repositories.recoveryPoints.list({ limit: 100 }),
      this.repositories.updateArtifacts.list({ limit: 100 }),
      this.repositories.storageMigrationPlans.list(100)
    ]);
    const recoveryPointById = new Map(recoveryPoints.map((point) => [point.id, point]));
    const updateById = new Map(updateArtifacts.map((artifact) => [artifact.id, artifact]));
    const storagePlanById = new Map(storagePlans.map((plan) => [plan.id, plan]));

    return jobs.map((job) => {
      const needsReview = job.errorCode === "MANUAL_REVIEW_REQUIRED";
      const result: LifecycleOperationHistoryItem["result"] = needsReview
        ? "needs_review"
        : ["queued", "claimed", "running"].includes(job.status)
          ? "in_progress"
          : job.status === "completed"
            ? "success"
            : job.status === "cancelled"
              ? "cancelled"
              : "failed";
      const migrationPlanId = "migrationPlanId" in job.parameters ? job.parameters.migrationPlanId : undefined;
      const recoveryPoint = job.recoveryPointId ? recoveryPointById.get(job.recoveryPointId) : undefined;
      const updateArtifact = job.updateArtifactId ? updateById.get(job.updateArtifactId) : undefined;
      const storagePlan = migrationPlanId ? storagePlanById.get(migrationPlanId) : undefined;
      const subject = recoveryPoint
        ? `${new Date(recoveryPoint.createdAt).toLocaleString("zh-CN")} 的系统恢复点`
        : updateArtifact
          ? `V${updateArtifact.version}`
          : storagePlan?.targetDisplayName;
      const dataSafety = needsReview
        ? "当前系统状态尚未确认，请勿继续新的维护操作。"
        : result === "failed"
          ? "本次操作未完成；系统已优先保留或恢复原有数据。"
          : result === "in_progress"
            ? "系统正在按既定保护流程处理，请勿重复操作。"
            : "本次操作已完成，系统状态已记录。";
      const nextStep = needsReview
        ? "请先进入“检查系统”确认当前状态。"
        : result === "failed"
          ? job.action === "apply_update"
            ? "请进入“备份与恢复”，选择更新前的系统恢复点恢复。"
            : "请先运行“检查系统”，根据检查结果重新操作。"
          : result === "in_progress"
            ? "请等待操作完成；刷新页面后仍可继续查看。"
            : "无需处理。";
      const finishedAt = job.completedAt ?? job.failedAt;

      return {
        id: job.id,
        operation: USER_OPERATION_LABELS[job.action] ?? "系统维护",
        result,
        requestedBy: job.requestedBy.actorName,
        requestReason: job.requestReason,
        requestedAt: job.createdAt,
        ...(job.startedAt ? { startedAt: job.startedAt } : {}),
        ...(finishedAt ? { finishedAt } : {}),
        ...(subject ? { subject } : {}),
        dataSafety,
        nextStep,
        ...(job.errorCode ? { technicalCode: job.errorCode } : {})
      };
    });
  }

  async listJobEvents(currentUser: CurrentUser, jobId: string) {
    requireSystemOwner(currentUser);
    return this.repositories.jobs.listEvents(jobId);
  }

  async cancelJob(currentUser: CurrentUser, id: string) {
    requireSystemOwner(currentUser);
    const actor = snapshot(currentUser);
    const job = await this.repositories.jobs.markCancelled({ id });
    await this.repositories.jobs.appendEvent({
      jobId: id,
      eventType: "job_cancelled",
      phase: "cancelled",
      message: "Lifecycle job was cancelled by System Owner",
      actorSnapshot: actor
    });
    return job;
  }
}

export const FACTORY_RUNNER_ID = "factory-runner" as const;

/** Single-machine runner boundary. It never invokes a host command. */
export class SingleMachineLifecycleRunnerService {
  private static lastSeenAt?: Date;
  private static backupReadiness?: { estimatedSizeBytes: string; availableSpaceBytes: string; canStart: boolean; calculatedAt: Date };
  private static storageReadiness?: { dataAvailable: boolean; backupAvailable: boolean; calculatedAt: Date };
  private claimTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly repositories: LifecycleRepositorySet,
    private readonly executorId = FACTORY_RUNNER_ID,
    private readonly leaseDurationMs = 60_000
  ) {}

  notePresence() {
    SingleMachineLifecycleRunnerService.lastSeenAt = new Date();
  }

  static getPresence() {
    const lastSeenAt = this.lastSeenAt;
    const online = Boolean(lastSeenAt && Date.now() - lastSeenAt.getTime() <= 20_000);
    return { online, lastSeenAt };
  }

  reportBackupReadiness(input: { estimatedSizeBytes: string; availableSpaceBytes: string; canStart: boolean }) {
    SingleMachineLifecycleRunnerService.backupReadiness = { ...input, calculatedAt: new Date() };
  }

  static getBackupReadiness() {
    const readiness = this.backupReadiness;
    if (!readiness || Date.now() - readiness.calculatedAt.getTime() > 90_000) return undefined;
    return readiness;
  }

  reportStorageReadiness(input: { dataAvailable: boolean; backupAvailable: boolean }) {
    SingleMachineLifecycleRunnerService.storageReadiness = { ...input, calculatedAt: new Date() };
  }

  static getStorageReadiness() {
    const readiness = this.storageReadiness;
    if (!readiness || Date.now() - readiness.calculatedAt.getTime() > 90_000) return undefined;
    return readiness;
  }

  async pollAndClaim() {
    return this.serializeClaim(async () => {
      const lock = await this.repositories.maintenanceLock.inspect();
      // A retained lock means an interrupted high-risk operation, even if its
      // old lease has elapsed. Only a later explicit human workflow may clear it.
      if (lock?.currentJobId) return undefined;
      const activeStatuses: LifecycleJobStatus[] = ["claimed", "running"];
      const active = await Promise.all(activeStatuses.map((status) => this.repositories.jobs.list({ status })));
      if (active.some((jobs) => jobs.length > 0)) return undefined;
      const job = await this.repositories.jobs.claimNextJob({
        executorId: this.executorId,
        leaseDurationMs: this.leaseDurationMs,
        allowedActions: V1_RUNNER_ACTIONS
      });
      if (!job) return undefined;
      const acquired = await this.repositories.maintenanceLock.acquire({ currentJobId: job.id, executorId: this.executorId, leaseDurationMs: this.leaseDurationMs });
      if (!acquired) {
        await this.repositories.jobs.markFailed({
          id: job.id,
          executorId: this.executorId,
          errorCode: "MAINTENANCE_LOCK_UNAVAILABLE",
          errorMessage: "System maintenance is already in progress. Please wait for it to finish."
        });
        return undefined;
      }
      await this.repositories.jobs.appendEvent({
        jobId: job.id,
        eventType: "runner_claimed",
        phase: "claimed",
        progress: 0,
        message: "Maintenance task was accepted by the factory runner.",
        executorIdSnapshot: this.executorId
      });
      return job;
    });
  }

  async markRunning(id: string) {
    const job = await this.repositories.jobs.markRunning({ id, executorId: this.executorId });
    await this.repositories.jobs.appendEvent({ jobId: id, eventType: "runner_started", phase: "running", progress: 0, message: "Maintenance task started.", executorIdSnapshot: this.executorId });
    return job;
  }

  async heartbeat(id: string) {
    const job = await this.repositories.jobs.renewLease({ id, executorId: this.executorId, leaseDurationMs: this.leaseDurationMs });
    await this.repositories.maintenanceLock.renew({ currentJobId: id, executorId: this.executorId, leaseDurationMs: this.leaseDurationMs });
    return job;
  }

  async appendProgress(input: { jobId: string; phase: string; progress: number; message: string }) {
    assertSafeLifecycleText(input.message, "message");
    return this.repositories.jobs.appendEvent({ ...input, eventType: "runner_progress", executorIdSnapshot: this.executorId });
  }

  async complete(id: string) {
    const job = await this.repositories.jobs.getById(id);
    if (!job) throw new LifecycleTransitionError("LifecycleJob was not found");
    if (!V1_RUNNER_ACTIONS.includes(job.action as (typeof V1_RUNNER_ACTIONS)[number])) throw new HttpError(409, "not_implemented");
    const completed = await this.repositories.jobs.markCompleted({ id, executorId: this.executorId });
    await this.repositories.jobs.appendEvent({ jobId: id, eventType: "runner_completed", phase: "completed", progress: 100, message: "Maintenance task completed.", executorIdSnapshot: this.executorId });
    await this.repositories.maintenanceLock.release({ currentJobId: id, executorId: this.executorId });
    return completed;
  }

  async fail(id: string, errorCode: string, errorMessage: string, manualReviewRequired = false) {
    assertSafeLifecycleText(errorMessage, "errorMessage");
    const failed = manualReviewRequired || errorCode === "MANUAL_REVIEW_REQUIRED"
      ? await this.repositories.jobs.markManualReviewRequired({ id, executorId: this.executorId, errorMessage })
      : await this.repositories.jobs.markFailed({ id, executorId: this.executorId, errorCode, errorMessage });
    const returnedToPreRestore = errorCode === "RESTORE_INTERRUPTED_RETURNED_TO_PRE_RESTORE";
    await this.repositories.jobs.appendEvent({
      jobId: id,
      eventType: manualReviewRequired || errorCode === "MANUAL_REVIEW_REQUIRED" ? "runner_manual_review_required" : "runner_failed",
      phase: "failed",
      message: manualReviewRequired || errorCode === "MANUAL_REVIEW_REQUIRED"
        ? "System state needs review. Do not start another maintenance task."
        : returnedToPreRestore
          ? "System restore did not complete. The system was returned to the safety backup created before the restore."
          : "Maintenance task failed before any system switch.",
      executorIdSnapshot: this.executorId,
      structuredMetadata: { errorCode: failed.errorCode }
    });
    if (!(manualReviewRequired || errorCode === "MANUAL_REVIEW_REQUIRED")) {
      await this.repositories.maintenanceLock.release({ currentJobId: id, executorId: this.executorId });
    }
    return failed;
  }

  async reportInterrupted(id: string, message: string) {
    return this.fail(id, "MANUAL_REVIEW_REQUIRED", message, true);
  }

  async inspectCurrentJob() {
    const lock = await this.repositories.maintenanceLock.inspect();
    if (!lock?.currentJobId) return { job: undefined, requiresManualReview: false };
    const job = await this.repositories.jobs.getById(lock.currentJobId);
    return { job, requiresManualReview: job?.errorCode === "MANUAL_REVIEW_REQUIRED" };
  }

  async listActiveJobsForRepair() {
    const statuses: LifecycleJobStatus[] = ["queued", "claimed", "running"];
    const groups = await Promise.all(statuses.map((status) => this.repositories.jobs.list({ status, limit: 100 })));
    return groups.flat().sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map((job) => ({
      id: job.id,
      action: job.action,
      createdAt: job.createdAt,
      status: job.status
    }));
  }

  async cancelActiveJobForRepair(id: string) {
    const job = await this.repositories.jobs.getById(id);
    if (!job || !["queued", "claimed", "running"].includes(job.status)) throw new HttpError(409, "lifecycle_job_not_active");
    if (job.status === "running") throw new HttpError(409, "running_lifecycle_job_requires_manual_review");
    const cancelled = await this.repositories.jobs.markCancelled({ id });
    await this.repositories.jobs.appendEvent({
      jobId: id,
      eventType: "job_cancelled_during_runner_repair",
      phase: "cancelled",
      message: "Maintenance task was cancelled during controlled Lifecycle Runner repair.",
      executorIdSnapshot: this.executorId
    });
    if (job.status === "claimed" && job.executorId) {
      await this.repositories.maintenanceLock.release({ currentJobId: id, executorId: job.executorId });
    }
    return cancelled;
  }

  async markRecoveryPointCreating(id: string) {
    return this.repositories.recoveryPoints.markCreating(id);
  }

  async getRecoveryPointForRunner(id: string) {
    return this.repositories.recoveryPoints.getById(id);
  }

  async createPreRestoreRecoveryPoint(input: { requestReason: string; appVersion: string; storageLayoutVersion: string }) {
    return this.repositories.recoveryPoints.create({
      kind: "pre_restore",
      requestReason: input.requestReason,
      appVersion: input.appVersion,
      schemaFingerprint: "detected-by-runner",
      postgresVersion: "detected-by-runner",
      storageLayoutVersion: input.storageLayoutVersion,
      createdBy: { actorId: this.executorId, actorName: "Factory maintenance service", actorRole: ROLES.systemOwner }
    });
  }

  async createPreStorageMigrationRecoveryPoint(input: { requestReason: string; appVersion: string; storageLayoutVersion: string }) {
    return this.repositories.recoveryPoints.create({
      kind: "pre_storage_migration",
      requestReason: input.requestReason,
      appVersion: input.appVersion,
      schemaFingerprint: "detected-by-runner",
      postgresVersion: "detected-by-runner",
      storageLayoutVersion: input.storageLayoutVersion,
      createdBy: { actorId: this.executorId, actorName: "Factory maintenance service", actorRole: ROLES.systemOwner }
    });
  }

  async createPreUpdateRecoveryPoint(input: { requestReason: string; appVersion: string; storageLayoutVersion: string }) {
    return this.repositories.recoveryPoints.create({
      kind: "pre_update",
      requestReason: input.requestReason,
      appVersion: input.appVersion,
      schemaFingerprint: "detected-by-runner",
      postgresVersion: "detected-by-runner",
      storageLayoutVersion: input.storageLayoutVersion,
      retentionProtected: true,
      createdBy: { actorId: this.executorId, actorName: "Factory maintenance service", actorRole: ROLES.systemOwner }
    });
  }

  async getUpdateArtifact(id: string) {
    return this.repositories.updateArtifacts.getById(id);
  }

  async markUpdateArtifact(input: Parameters<LifecycleRepositorySet["updateArtifacts"]["markVerification"]>[0]) {
    return this.repositories.updateArtifacts.markVerification(input);
  }

  async getStorageMigrationPlan(id: string) {
    return this.repositories.storageMigrationPlans.getById(id);
  }

  async markStorageMigrationPlan(id: string, status: Parameters<LifecycleRepositorySet["storageMigrationPlans"]["markStatus"]>[1], failureReason?: string) {
    return this.repositories.storageMigrationPlans.markStatus(id, status, failureReason);
  }

  async attachRecoveryPointArtifact(id: string, input: Parameters<LifecycleRepositorySet["recoveryPoints"]["attachArtifact"]>[1]) {
    return this.repositories.recoveryPoints.attachArtifact(id, input);
  }

  async verifyRecoveryPoint(input: Parameters<LifecycleRepositorySet["recoveryPoints"]["markVerified"]>[0]) {
    return this.repositories.recoveryPoints.markVerified(input);
  }

  async failRecoveryPoint(input: Parameters<LifecycleRepositorySet["recoveryPoints"]["markFailed"]>[0]) {
    return this.repositories.recoveryPoints.markFailed(input);
  }

  private async serializeClaim<T>(operation: () => Promise<T>) {
    const prior = this.claimTail;
    let release!: () => void;
    this.claimTail = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try { return await operation(); } finally { release(); }
  }
}

/**
 * Narrow data-plane boundary for the later Executor. Every method operates on
 * pre-registered typed jobs; there is deliberately no command/script method.
 */
export class LifecycleExecutorService {
  constructor(
    private readonly repositories: LifecycleRepositorySet,
    private readonly executorId: string,
    private readonly leaseDurationMs = 60_000
  ) {}

  async claimNextJob(now?: string) {
    const job = await this.repositories.jobs.claimNextJob({
      executorId: this.executorId,
      leaseDurationMs: this.leaseDurationMs,
      ...(now ? { now } : {})
    });
    if (job) {
      await this.repositories.jobs.appendEvent({
        jobId: job.id,
        eventType: "job_claimed",
        phase: "claimed",
        progress: 0,
        message: "Lifecycle job was claimed by an executor",
        executorIdSnapshot: this.executorId,
        ...(now ? { createdAt: now } : {})
      });
    }
    return job;
  }

  renewJobLease(id: string, now?: string) {
    return this.repositories.jobs.renewLease({
      id,
      executorId: this.executorId,
      leaseDurationMs: this.leaseDurationMs,
      ...(now ? { now } : {})
    });
  }

  async markRunning(id: string, startedAt?: string) {
    const job = await this.repositories.jobs.markRunning({ id, executorId: this.executorId, ...(startedAt ? { startedAt } : {}) });
    await this.repositories.jobs.appendEvent({
      jobId: id,
      eventType: "job_running",
      phase: "running",
      message: "Lifecycle job execution started",
      executorIdSnapshot: this.executorId,
      ...(startedAt ? { createdAt: startedAt } : {})
    });
    return job;
  }

  async markCompleted(id: string, completedAt?: string) {
    const job = await this.repositories.jobs.markCompleted({ id, executorId: this.executorId, ...(completedAt ? { completedAt } : {}) });
    await this.repositories.jobs.appendEvent({
      jobId: id,
      eventType: "job_completed",
      phase: "completed",
      progress: 100,
      message: "Lifecycle job execution completed",
      executorIdSnapshot: this.executorId,
      ...(completedAt ? { createdAt: completedAt } : {})
    });
    return job;
  }

  async markFailed(id: string, errorCode: string, errorMessage: string, failedAt?: string) {
    const job = await this.repositories.jobs.markFailed({
      id,
      executorId: this.executorId,
      errorCode,
      errorMessage,
      ...(failedAt ? { failedAt } : {})
    });
    await this.repositories.jobs.appendEvent({
      jobId: id,
      eventType: "job_failed",
      phase: "failed",
      message: "Lifecycle job execution failed",
      executorIdSnapshot: this.executorId,
      structuredMetadata: { errorCode },
      ...(failedAt ? { createdAt: failedAt } : {})
    });
    return job;
  }

  appendProgress(input: {
    jobId: string;
    eventType: string;
    phase?: string;
    progress?: number;
    message: string;
    structuredMetadata?: Record<string, unknown>;
    createdAt?: string;
  }) {
    return this.repositories.jobs.appendEvent({
      ...input,
      executorIdSnapshot: this.executorId
    });
  }

  acquireMaintenanceLock(currentJobId: string, now?: string) {
    return this.repositories.maintenanceLock.acquire({
      currentJobId,
      executorId: this.executorId,
      leaseDurationMs: this.leaseDurationMs,
      ...(now ? { now } : {})
    });
  }

  renewMaintenanceLock(currentJobId: string, now?: string) {
    return this.repositories.maintenanceLock.renew({
      currentJobId,
      executorId: this.executorId,
      leaseDurationMs: this.leaseDurationMs,
      ...(now ? { now } : {})
    });
  }

  releaseMaintenanceLock(currentJobId: string, releasedAt?: string) {
    return this.repositories.maintenanceLock.release({
      currentJobId,
      executorId: this.executorId,
      ...(releasedAt ? { releasedAt } : {})
    });
  }
}
