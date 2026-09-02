import { ROLES } from "@sample-room/shared";
import { win32 } from "node:path";
import type { LifecycleRepositorySet, StorageMigrationPlanRecord } from "../../db/repositories/contracts/index.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { HttpError } from "../../shared/errors/httpError.js";
import { SingleMachineLifecycleRunnerService } from "./lifecycleService.js";
import { normalizeLocalNtfsPath } from "./lifecycleRules.js";

function requireOwner(user: CurrentUser) {
  if (user.role !== ROLES.systemOwner) throw new HttpError(403, "forbidden");
}

function driveLabel(path: string) {
  return `${win32.parse(path).root.slice(0, 1).toUpperCase()} 盘`;
}

export type StorageLocationView = { status: "normal" | "unavailable"; displayName: string; detailedPath?: string };

export class StorageMigrationService {
  constructor(
    private readonly repositories: LifecycleRepositorySet,
    private readonly locations: { dataRoot: string; backupRoot: string }
  ) {}

  async overview(user: CurrentUser) {
    requireOwner(user);
    const plans = await this.repositories.storageMigrationPlans.list(20);
    const readiness = SingleMachineLifecycleRunnerService.getStorageReadiness();
    return {
      data: this.locationView(this.locations.dataRoot, readiness?.dataAvailable === true),
      backup: this.locationView(this.locations.backupRoot, readiness?.backupAvailable === true),
      recent: plans.map((plan) => this.toOwnerView(plan))
    };
  }

  async preflight(user: CurrentUser, _targetPath: string) {
    requireOwner(user);
    throw new HttpError(501, "storage_location_change_not_available");
  }

  async execute(user: CurrentUser, _input: { planId: string; requestReason: string; idempotencyKey: string }) {
    requireOwner(user);
    throw new HttpError(501, "storage_location_change_not_available");
  }

  async getForRunner(id: string) { return this.repositories.storageMigrationPlans.getById(id); }
  async markForRunner(id: string, status: Parameters<LifecycleRepositorySet["storageMigrationPlans"]["markStatus"]>[1], reason?: string) {
    return this.repositories.storageMigrationPlans.markStatus(id, status, reason);
  }

  private locationView(path: string, available: boolean): StorageLocationView {
    if (!path) return { status: "unavailable", displayName: "未配置" };
    const normalized = normalizeLocalNtfsPath(path);
    return { status: available ? "normal" : "unavailable", displayName: driveLabel(normalized), detailedPath: normalized };
  }

  private toOwnerView(plan: StorageMigrationPlanRecord) {
    return {
      id: plan.id,
      targetDisplayName: plan.targetDisplayName,
      status: plan.status,
      createdAt: plan.createdAt,
      completedAt: plan.completedAt,
      failureReason: plan.failureReason
    };
  }
}
