import { Router } from "express";
import { ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import { SingleMachineLifecycleRunnerService, type LifecycleSystemOwnerService } from "./lifecycleService.js";
import type { FormalAuthService } from "../auth/authService.js";
import type { StorageMigrationService } from "./storageMigrationService.js";
import type { UpdatePackageService } from "./updatePackageService.js";

/** Future UI-facing maintenance task API. It accepts only typed LCM-01 jobs. */
export function createLifecycleSystemOwnerRouter(service: LifecycleSystemOwnerService, _authService?: FormalAuthService, storageMigrationService?: StorageMigrationService, updatePackageService?: UpdatePackageService) {
  const router = Router();
  const updateUpload = {
    single: (_fieldName: string): import("express").RequestHandler => (_req, res) => {
      res.status(501).json({ error: "automatic_update_not_available" });
    }
  };
  router.use(requireRoles(ROLES.systemOwner));

  router.post("/lifecycle/jobs", async (req, res) => {
    if (req.body?.action !== "diagnostic") return res.status(501).json({ error: "lifecycle_action_not_available" });
    res.status(201).json({ job: await service.requestJob(req.currentUser!, req.body ?? {}) });
  });
  router.get("/lifecycle/overview", async (req, res) => {
    const [recoveryPoints, jobs] = await Promise.all([service.listRecoveryPoints(req.currentUser!), service.listJobs(req.currentUser!)]);
    res.json({ recentRecoveryPoint: recoveryPoints[0], currentTask: jobs.find((job) => ["queued", "claimed", "running"].includes(job.status)), latestTask: jobs[0], recoveryPoints, runner: SingleMachineLifecycleRunnerService.getPresence(), backupReadiness: SingleMachineLifecycleRunnerService.getBackupReadiness() });
  });
  router.get("/lifecycle/history", async (req, res) => {
    res.json({ records: await service.listUserOperationHistory(req.currentUser!) });
  });
  router.get("/recovery-points", async (req, res) => res.json({ recoveryPoints: await service.listRecoveryPoints(req.currentUser!) }));
  router.get("/recovery-points/:id", async (req, res) => res.json({ recoveryPoint: await service.getRecoveryPoint(req.currentUser!, req.params.id) }));
  router.post("/recovery-points/preflight", async (req, res) => {
    const overview = await service.listJobs(req.currentUser!);
    const active = overview.find((job) => ["queued", "claimed", "running"].includes(job.status));
    const runner = SingleMachineLifecycleRunnerService.getPresence();
    const readiness = SingleMachineLifecycleRunnerService.getBackupReadiness();
    const canStart = !active && runner.online && readiness?.canStart === true;
    res.json({ canStart, estimatedSizeBytes: readiness?.estimatedSizeBytes ?? null, availableSpaceBytes: readiness?.availableSpaceBytes ?? null, runner, message: active ? "系统正在维护，请等待当前维护任务完成。" : !runner.online ? "系统维护服务未启动，暂时不能创建系统恢复点。" : !readiness ? "正在读取备份磁盘空间，请稍候刷新。" : !readiness.canStart ? "备份磁盘空间不足，请更换备份位置或清理空间。" : "备份空间检查通过。" });
  });
  router.post("/recovery-points", async (req, res) => {
    const body = req.body ?? {};
    if (body.confirmed !== true) return res.status(400).json({ error: "recovery_point_confirmation_required" });
    if (!SingleMachineLifecycleRunnerService.getPresence().online) return res.status(409).json({ error: "runner_offline", message: "系统维护服务未启动，暂时不能创建系统恢复点。" });
    const readiness = SingleMachineLifecycleRunnerService.getBackupReadiness();
    if (!readiness || !readiness.canStart) return res.status(409).json({ error: "recovery_point_preflight_required", message: "备份磁盘空间不足，请更换备份位置或清理空间。" });
    const reason = typeof body.requestReason === "string" && body.requestReason.trim() ? body.requestReason.trim() : "手动安全备份";
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.trim() ? body.idempotencyKey.trim() : `recovery-point-${Date.now()}`;
    res.status(201).json(await service.requestRecoveryPoint(req.currentUser!, {
      kind: "manual",
      requestReason: reason,
      idempotencyKey,
      appVersion: process.env.SAMPLE_ROOM_APP_VERSION ?? process.env.npm_package_version ?? "factory-release",
      schemaFingerprint: "managed-by-runner",
      postgresVersion: "detected-by-runner",
      storageLayoutVersion: "factory-two-data-roots-v2"
    }));
  });
  router.post("/restores/preflight", async (_req, res) => {
    res.status(501).json({
      error: "automatic_restore_not_available",
      message: "当前版本暂未开放自动恢复，请使用已验证的系统恢复点联系维护人员执行人工冷恢复。"
    });
  });
  router.post("/restores/execute", async (_req, res) => {
    res.status(501).json({
      error: "automatic_restore_not_available",
      message: "当前版本暂未开放自动恢复，请使用已验证的系统恢复点联系维护人员执行人工冷恢复。"
    });
  });
  router.get("/storage/overview", async (req, res) => {
    if (!storageMigrationService) return res.status(503).json({ error: "storage_management_unavailable" });
    res.json(await storageMigrationService.overview(req.currentUser!));
  });
  router.post("/storage/preflight", async (req, res) => {
    res.status(501).json({
      error: "storage_location_change_not_available",
      message: "当前版本暂未开放"
    });
  });
  router.post("/storage/execute", async (req, res) => {
    res.status(501).json({
      error: "storage_location_change_not_available",
      message: "当前版本暂未开放"
    });
  });
  router.get("/updates/overview", async (req, res) => {
    if (!updatePackageService) return res.status(503).json({ error: "system_update_unavailable" });
    res.json(await updatePackageService.overview(req.currentUser!));
  });
  router.post("/updates/packages", updateUpload?.single("package") ?? ((_req, res) => res.status(503).json({ error: "system_update_unavailable" })), async (req, res) => {
    if (!updatePackageService) return res.status(503).json({ error: "system_update_unavailable" });
    if (!req.file) return res.status(400).json({ error: "update_package_required", message: "请选择系统更新包。" });
    res.status(201).json(await updatePackageService.registerUpload(req.currentUser!, req.file));
  });
  router.post("/updates/execute", async (_req, res) => {
    res.status(501).json({
      error: "automatic_update_not_available",
      message: "当前版本暂未开放自动更新，请在完成备份后由维护人员使用正式部署包更新。"
    });
  });
  router.get("/lifecycle-jobs/:id", async (req, res) => res.json({ job: await service.getJob(req.currentUser!, req.params.id) }));
  router.get("/lifecycle-jobs/:id/events", async (req, res) => res.json({ events: await service.listJobEvents(req.currentUser!, req.params.id) }));
  router.get("/lifecycle/jobs", async (req, res) => {
    res.json({ jobs: await service.listJobs(req.currentUser!) });
  });
  router.get("/lifecycle/jobs/:id", async (req, res) => {
    res.json({ job: await service.getJob(req.currentUser!, req.params.id) });
  });
  router.get("/lifecycle/jobs/:id/events", async (req, res) => {
    res.json({ events: await service.listJobEvents(req.currentUser!, req.params.id) });
  });
  return router;
}
