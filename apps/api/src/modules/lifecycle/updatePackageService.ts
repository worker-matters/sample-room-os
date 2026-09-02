import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { ROLES } from "@sample-room/shared";
import type { LifecycleRepositorySet, UpdateArtifactRecord } from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { LifecycleSystemOwnerService, SingleMachineLifecycleRunnerService } from "./lifecycleService.js";

const packageNamePattern = /^Deploy-V(\d+\.\d+\.\d+)\.zip$/i;

function requireOwner(user: CurrentUser) {
  if (user.role !== ROLES.systemOwner) throw new HttpError(403, "forbidden");
}

async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function safeArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 20) : [];
}

export type SystemUpdatePackageView = {
  id: string;
  version: string;
  displayVersion: string;
  status: "checking" | "ready" | "rejected";
  title: string;
  changes: string[];
  databaseImpact: string;
  attachmentImpact: string;
  configurationImpact: string;
  riskLevel: "低" | "中" | "高" | "待检查";
  estimatedDowntime: string;
  compatible: boolean | undefined;
  discoveredAt: string;
  failure?: {
    whatHappened: string;
    dataSafety: string;
    nextStep: string;
    technicalCode: string;
  };
};

export class UpdatePackageService {
  private readonly lifecycle: LifecycleSystemOwnerService;
  readonly quarantineRoot: string;

  constructor(
    private readonly repositories: LifecycleRepositorySet,
    private readonly options: {
      updateRoot: string;
      currentVersion: string;
      maxUploadBytes?: number;
      runnerOnline?: () => boolean;
    }
  ) {
    this.lifecycle = new LifecycleSystemOwnerService(repositories);
    this.quarantineRoot = resolve(options.updateRoot, "quarantine");
  }

  get maxUploadBytes() {
    return this.options.maxUploadBytes ?? 8 * 1024 * 1024 * 1024;
  }

  async overview(user: CurrentUser) {
    requireOwner(user);
    const [artifacts, jobs] = await Promise.all([
      this.repositories.updateArtifacts.list({ limit: 30 }),
      this.repositories.jobs.list({ limit: 100 })
    ]);
    const updateJobs = jobs.filter((job) => job.action === "preflight_update" || job.action === "apply_update");
    const activeJob = jobs.find((job) => ["queued", "claimed", "running"].includes(job.status));
    const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    return {
      currentVersion: this.options.currentVersion.startsWith("V") ? this.options.currentVersion : `V${this.options.currentVersion}`,
      packages: artifacts.map((artifact) => this.ownerView(artifact)),
      currentTask: updateJobs.find((job) => ["queued", "claimed", "running"].includes(job.status)),
      latestUpdate: updateJobs.find((job) => job.action === "apply_update"),
      updateHistory: updateJobs.filter((job) => job.action === "apply_update").slice(0, 20).map((job) => ({
        id: job.id,
        displayVersion: job.updateArtifactId ? `V${artifactsById.get(job.updateArtifactId)?.version ?? "-"}` : "-",
        status: job.errorCode === "MANUAL_REVIEW_REQUIRED" ? "needs_review" : job.status,
        startedAt: job.startedAt ?? job.createdAt,
        completedAt: job.completedAt ?? job.failedAt,
        errorCode: job.errorCode
      })),
      maintenanceInProgress: Boolean(activeJob),
      maintenanceServiceOnline: this.runnerOnline()
    };
  }

  async registerUpload(user: CurrentUser, file: Express.Multer.File) {
    requireOwner(user);
    void file;
    if (this.v1FailClosed()) throw new HttpError(501, "automatic_update_not_available");
    if (!file || !file.path) throw new HttpError(400, "update_package_required");
    const match = packageNamePattern.exec(basename(file.originalname));
    if (!match) {
      await rm(file.path, { force: true });
      throw new HttpError(400, "update_package_filename_invalid");
    }
    if (file.size <= 0 || file.size > this.maxUploadBytes) {
      await rm(file.path, { force: true });
      throw new HttpError(413, "update_package_size_invalid");
    }
    if (!this.runnerOnline()) {
      await rm(file.path, { force: true });
      throw new HttpError(409, "maintenance_service_offline");
    }
    const active = (await this.repositories.jobs.list({ limit: 100 })).find((job) => ["queued", "claimed", "running"].includes(job.status));
    if (active) {
      await rm(file.path, { force: true });
      throw new HttpError(409, "lifecycle_job_already_active");
    }

    const digest = await sha256(file.path);
    const existing = await this.repositories.updateArtifacts.findByDigest(digest);
    if (existing) {
      await rm(file.path, { force: true });
      return { updatePackage: this.ownerView(existing), job: await this.ensurePreflightJob(user, existing), duplicate: true };
    }

    await mkdir(this.quarantineRoot, { recursive: true });
    const relativeName = `quarantine/${digest}.zip`;
    const target = join(this.quarantineRoot, `${digest}.zip`);
    await rename(file.path, target);
    let registered = false;
    try {
      const artifact = await this.repositories.updateArtifacts.register({
        version: match[1]!,
        digest,
        manifestSummary: {
          packageRelativeName: relativeName,
          originalFileName: basename(file.originalname),
          sizeBytes: String(file.size),
          title: `系统更新 V${match[1]!}`,
          changes: []
        },
        compatibilityInformation: { currentVersion: this.options.currentVersion, status: "pending_check" },
        status: "discovered"
      });
      registered = true;
      const job = await this.ensurePreflightJob(user, artifact);
      return { updatePackage: this.ownerView(artifact), job, duplicate: false };
    } catch (error) {
      // Once registered, keep the package quarantined. A later identical upload can
      // safely attach the missing typed preflight task without losing the artifact.
      if (!registered) await rm(target, { force: true });
      throw error;
    }
  }

  async execute(user: CurrentUser, input: { updateArtifactId: string; requestReason: string; idempotencyKey: string }) {
    requireOwner(user);
    void input;
    if (this.v1FailClosed()) throw new HttpError(501, "automatic_update_not_available");
    const artifact = await this.repositories.updateArtifacts.getById(input.updateArtifactId);
    if (!artifact || artifact.status !== "verified") throw new HttpError(409, "update_package_not_ready");
    const compatible = artifact.compatibilityInformation.compatible;
    if (compatible !== true) throw new HttpError(409, "update_package_incompatible");
    const currentVersion = this.options.currentVersion.replace(/^V/i, "");
    const checkedCurrentVersion = typeof artifact.compatibilityInformation.currentVersion === "string"
      ? artifact.compatibilityInformation.currentVersion.replace(/^V/i, "")
      : undefined;
    if (artifact.version === currentVersion || checkedCurrentVersion !== currentVersion) throw new HttpError(409, "update_package_requires_new_check");
    if (!this.runnerOnline()) throw new HttpError(409, "maintenance_service_offline");
    return this.lifecycle.requestJob(user, {
      action: "apply_update",
      requestReason: input.requestReason,
      idempotencyKey: input.idempotencyKey,
      updateArtifactId: artifact.id,
      parameters: { updateArtifactId: artifact.id }
    });
  }

  async getForRunner(id: string) {
    return this.repositories.updateArtifacts.getById(id);
  }

  async markForRunner(input: Parameters<LifecycleRepositorySet["updateArtifacts"]["markVerification"]>[0]) {
    return this.repositories.updateArtifacts.markVerification(input);
  }

  private runnerOnline() {
    return this.options.runnerOnline?.() ?? SingleMachineLifecycleRunnerService.getPresence().online;
  }

  private async findPreflightJob(id: string) {
    return (await this.repositories.jobs.list({ action: "preflight_update", limit: 100 })).find((job) => job.updateArtifactId === id);
  }

  private async ensurePreflightJob(user: CurrentUser, artifact: UpdateArtifactRecord) {
    void user;
    void artifact;
    if (this.v1FailClosed()) throw new HttpError(501, "automatic_update_not_available");
    const existing = await this.findPreflightJob(artifact.id);
    if (existing || artifact.status !== "discovered") return existing;
    return this.lifecycle.requestJob(user, {
      action: "preflight_update",
      requestReason: `检查系统更新 V${artifact.version}`,
      idempotencyKey: `update-preflight-${artifact.digest}`,
      updateArtifactId: artifact.id,
      parameters: { updateArtifactId: artifact.id }
    });
  }

  private ownerView(artifact: UpdateArtifactRecord): SystemUpdatePackageView {
    const summary = artifact.manifestSummary;
    const compatibility = artifact.compatibilityInformation;
    const status = artifact.status === "verified" ? "ready" : artifact.status === "failed" ? "rejected" : "checking";
    const risk = summary.riskLevel;
    return {
      id: artifact.id,
      version: artifact.version,
      displayVersion: `V${artifact.version}`,
      status,
      title: typeof summary.title === "string" ? summary.title : `系统更新 V${artifact.version}`,
      changes: safeArray(summary.changes),
      databaseImpact: typeof summary.databaseImpact === "string" ? summary.databaseImpact : "正在检查",
      attachmentImpact: typeof summary.attachmentImpact === "string" ? summary.attachmentImpact : "正在检查",
      configurationImpact: typeof summary.configurationImpact === "string" ? summary.configurationImpact : "正在检查",
      riskLevel: risk === "low" ? "低" : risk === "medium" ? "中" : risk === "high" ? "高" : "待检查",
      estimatedDowntime: typeof summary.estimatedDowntime === "string" ? summary.estimatedDowntime : "正在估算",
      compatible: typeof compatibility.compatible === "boolean"
        ? compatibility.compatible
          && artifact.version !== this.options.currentVersion.replace(/^V/i, "")
          && (typeof compatibility.currentVersion !== "string" || compatibility.currentVersion.replace(/^V/i, "") === this.options.currentVersion.replace(/^V/i, ""))
        : undefined,
      discoveredAt: artifact.discoveredAt,
      ...(artifact.failureReason ? {
        failure: {
          whatHappened: "更新包无法使用。",
          dataSafety: "当前系统和业务数据没有发生变化。",
          nextStep: "请选择由系统供应方提供的正确更新包后重新上传。",
          technicalCode: artifact.failureReason
        }
      } : {})
    };
  }

  private v1FailClosed() {
    return true;
  }
}
