import { isAbsolute, posix, win32 } from "node:path";
import type {
  LifecycleJobAction,
  LifecycleJobCreateInput,
  LifecycleJobStatus,
  RecoveryPointArtifactInput,
  RecoveryPointCreateInput,
  RecoveryPointStatus,
  StorageMigrationPlanCreateInput,
  UpdateArtifactRegisterInput,
  UpdateArtifactVerificationInput
} from "../../db/repositories/contracts/index.js";

export class LifecycleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleConflictError";
  }
}

export class LifecycleNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleNotFoundError";
  }
}

export class LifecycleTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleTransitionError";
  }
}

export class LifecycleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleValidationError";
  }
}

const sha256Pattern = /^[a-f0-9]{64}$/;
const forbiddenJsonKeys = /^(command|cmd|powershell|script|scriptpath|executable|environment|env|environmentvariables|hostpath|absolutepath|storagerootdir|storagekey|recoverypackagepath|configpath|updatepackagepath|password|passwd|secret|token|privatekey|apikey)$/i;
const credentialAssignment = /\b(password|passwd|secret|token|private[_-]?key|api[_-]?key)\s*[:=]/i;
const credentialUrl = /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;
const embeddedAbsolutePath = /(^|\s)([A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|\/(?:data|var|etc|home|users?|mnt|opt|srv)(?:[\/]|\s|$))/i;

export const RECOVERY_POINT_TRANSITIONS: Readonly<Record<RecoveryPointStatus, readonly RecoveryPointStatus[]>> = {
  pending: ["creating", "failed"],
  creating: ["completed", "verified", "failed"],
  completed: ["verified", "failed"],
  verified: [],
  failed: []
};

export const LIFECYCLE_JOB_TRANSITIONS: Readonly<Record<LifecycleJobStatus, readonly LifecycleJobStatus[]>> = {
  queued: ["claimed", "cancelled"],
  claimed: ["running", "failed", "cancelled"],
  running: ["completed", "failed"],
  completed: [],
  failed: [],
  cancelled: []
};

export function assertRecoveryPointTransition(from: RecoveryPointStatus, to: RecoveryPointStatus) {
  if (!RECOVERY_POINT_TRANSITIONS[from].includes(to)) {
    throw new LifecycleTransitionError(`Illegal RecoveryPoint transition: ${from} -> ${to}`);
  }
}

export function assertLifecycleJobTransition(from: LifecycleJobStatus, to: LifecycleJobStatus) {
  if (!LIFECYCLE_JOB_TRANSITIONS[from].includes(to)) {
    throw new LifecycleTransitionError(`Illegal LifecycleJob transition: ${from} -> ${to}`);
  }
}

export function assertPositiveLeaseDuration(leaseDurationMs: number) {
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new LifecycleValidationError("leaseDurationMs must be a positive safe integer");
  }
}

export function leaseExpiry(now: Date, leaseDurationMs: number) {
  assertPositiveLeaseDuration(leaseDurationMs);
  return new Date(now.getTime() + leaseDurationMs);
}

export function parseTimestamp(value: string | undefined, fieldName: string) {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    throw new LifecycleValidationError(`${fieldName} must be an ISO timestamp`);
  }
  return parsed;
}

export function assertSha256(value: string, fieldName: string) {
  if (!sha256Pattern.test(value)) {
    throw new LifecycleValidationError(`${fieldName} must be a lowercase SHA256 digest`);
  }
}

export function assertDecimalBytes(value: string, fieldName: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new LifecycleValidationError(`${fieldName} must be a non-negative decimal integer`);
  }
}

export function assertControlledRelativeName(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.replaceAll("\\", "/");
  if (
    trimmed.length === 0 ||
    isAbsolute(trimmed) ||
    win32.isAbsolute(trimmed) ||
    posix.isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new LifecycleValidationError("relativeName must be a controlled relative artifact name");
  }
}

function assertSafeString(value: string, fieldName: string) {
  if (win32.isAbsolute(value) || posix.isAbsolute(value) || value.startsWith("\\\\")) {
    throw new LifecycleValidationError(`${fieldName} must not contain an absolute host path`);
  }
}

export function assertSafeLifecycleText(value: string, fieldName: string) {
  if (credentialAssignment.test(value) || credentialUrl.test(value)) {
    throw new LifecycleValidationError(`${fieldName} must not contain plaintext credentials or keys`);
  }
  if (embeddedAbsolutePath.test(value)) {
    throw new LifecycleValidationError(`${fieldName} must not contain an absolute host path`);
  }
}

export function assertRestrictedJson(value: unknown, fieldName = "parameters"): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LifecycleValidationError(`${fieldName} must be a JSON object`);
  }

  const visit = (current: unknown, path: string): void => {
    if (current === null || typeof current === "boolean") return;
    if (typeof current === "string") {
      assertSafeString(current, path);
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new LifecycleValidationError(`${path} must contain finite JSON numbers`);
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (current && typeof current === "object") {
      for (const [key, nested] of Object.entries(current)) {
        if (forbiddenJsonKeys.test(key)) {
          throw new LifecycleValidationError(`${path}.${key} is not allowed in lifecycle JSON`);
        }
        visit(nested, `${path}.${key}`);
      }
      return;
    }
    throw new LifecycleValidationError(`${path} contains a non-JSON value`);
  };
  visit(value, fieldName);
}

export function normalizeLocalNtfsPath(value: string) {
  const trimmed = value.trim().replaceAll("/", "\\");
  if (!/^[A-Za-z]:\\[^:*?"<>|]+$/.test(trimmed) || trimmed.startsWith("\\\\")) {
    throw new LifecycleValidationError("target storage location must be a local NTFS directory");
  }
  const normalized = win32.normalize(trimmed).replace(/[\\]+$/, "");
  if (/^[A-Za-z]:$/.test(normalized)) throw new LifecycleValidationError("target storage location must not be a drive root");
  return normalized;
}

export function assertStorageMigrationPlanCreateInput(input: StorageMigrationPlanCreateInput) {
  assertNonEmpty(input.requestedBy.actorId, "requestedBy.actorId");
  assertNonEmpty(input.requestedBy.actorName, "requestedBy.actorName");
  normalizeLocalNtfsPath(input.targetPathProtected);
  assertNonEmpty(input.targetDisplayName, "targetDisplayName");
  assertSafeLifecycleText(input.targetDisplayName, "targetDisplayName");
  assertRestrictedJson(input.preflightSummary, "preflightSummary");
}

function assertNonEmpty(value: string, fieldName: string) {
  if (!value.trim()) throw new LifecycleValidationError(`${fieldName} is required`);
}

export function assertRecoveryPointCreateInput(input: RecoveryPointCreateInput) {
  assertNonEmpty(input.createdBy.actorId, "createdBy.actorId");
  assertNonEmpty(input.createdBy.actorName, "createdBy.actorName");
  assertNonEmpty(input.requestReason, "requestReason");
  assertSafeLifecycleText(input.requestReason, "requestReason");
  assertNonEmpty(input.appVersion, "appVersion");
  assertNonEmpty(input.schemaFingerprint, "schemaFingerprint");
  assertNonEmpty(input.postgresVersion, "postgresVersion");
  assertNonEmpty(input.storageLayoutVersion, "storageLayoutVersion");
  if (input.retentionDays !== undefined && (!Number.isInteger(input.retentionDays) || input.retentionDays <= 0)) {
    throw new LifecycleValidationError("retentionDays must be a positive integer");
  }
  if (input.retainUntil) parseTimestamp(input.retainUntil, "retainUntil");
}

export function assertRecoveryPointArtifactInput(input: RecoveryPointArtifactInput) {
  assertControlledRelativeName(input.relativeName);
  assertDecimalBytes(input.sizeBytes, "sizeBytes");
  assertSha256(input.sha256, "sha256");
}

function expectedParameterKeys(action: LifecycleJobAction) {
  switch (action) {
    case "create_recovery_point": return ["kind", "recoveryPointId"];
    case "restore_recovery_point": return ["recoveryPointId"];
    case "preflight_update":
    case "apply_update": return ["updateArtifactId"];
    case "migrate_storage": return ["migrationPlanId", "mode"];
    case "diagnostic": return ["profile"];
  }
}

export function assertLifecycleJobCreateInput(input: LifecycleJobCreateInput) {
  assertNonEmpty(input.requestedBy.actorId, "requestedBy.actorId");
  assertNonEmpty(input.requestedBy.actorName, "requestedBy.actorName");
  assertNonEmpty(input.requestReason, "requestReason");
  assertSafeLifecycleText(input.requestReason, "requestReason");
  assertNonEmpty(input.idempotencyKey, "idempotencyKey");
  assertRestrictedJson(input.parameters);
  const actualKeys = Object.keys(input.parameters).sort();
  const expectedKeys = expectedParameterKeys(input.action).sort();
  if (actualKeys.join("|") !== expectedKeys.join("|")) {
    throw new LifecycleValidationError(`parameters do not match typed action ${input.action}`);
  }
  if (input.action === "create_recovery_point" || input.action === "restore_recovery_point") {
    if (!input.parameters.recoveryPointId.trim() || input.parameters.recoveryPointId !== input.recoveryPointId) {
      throw new LifecycleValidationError(`${input.action} recoveryPointId must match its typed reference`);
    }
  }
  if (input.action === "preflight_update" || input.action === "apply_update") {
    if (!input.parameters.updateArtifactId.trim() || input.parameters.updateArtifactId !== input.updateArtifactId) {
      throw new LifecycleValidationError(`${input.action} updateArtifactId must match its typed reference`);
    }
  }
  if (input.action === "migrate_storage" && input.parameters.mode !== "copy_verify_switch") {
    throw new LifecycleValidationError("migrate_storage mode must be copy_verify_switch");
  }
  if (input.action === "migrate_storage" && !input.parameters.migrationPlanId.trim()) {
    throw new LifecycleValidationError("migrate_storage migrationPlanId is required");
  }
  if (input.action === "diagnostic" && input.parameters.profile !== "standard") {
    throw new LifecycleValidationError("diagnostic profile must be standard");
  }
}

export function assertUpdateArtifactRegisterInput(input: UpdateArtifactRegisterInput) {
  assertNonEmpty(input.version, "version");
  assertSha256(input.digest, "digest");
  assertRestrictedJson(input.manifestSummary, "manifestSummary");
  assertRestrictedJson(input.compatibilityInformation, "compatibilityInformation");
  if (input.discoveredAt) parseTimestamp(input.discoveredAt, "discoveredAt");
  if (input.verifiedAt) parseTimestamp(input.verifiedAt, "verifiedAt");
  if (input.failureReason) assertSafeLifecycleText(input.failureReason, "failureReason");
}

export function assertUpdateArtifactVerificationInput(input: UpdateArtifactVerificationInput) {
  assertNonEmpty(input.id, "id");
  assertRestrictedJson(input.manifestSummary, "manifestSummary");
  assertRestrictedJson(input.compatibilityInformation, "compatibilityInformation");
  if (input.verifiedAt) parseTimestamp(input.verifiedAt, "verifiedAt");
  if (input.failureReason) assertSafeLifecycleText(input.failureReason, "failureReason");
  if (input.status === "failed" && !input.failureReason?.trim()) {
    throw new LifecycleValidationError("failureReason is required when update verification fails");
  }
}

export function isLeaseActive(leaseExpiresAt: string | undefined, now: Date) {
  return Boolean(leaseExpiresAt && new Date(leaseExpiresAt).getTime() > now.getTime());
}
