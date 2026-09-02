import { timingSafeEqual } from "node:crypto";
import express from "express";
import type { LifecycleRepositorySet } from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import { FACTORY_RUNNER_ID, SingleMachineLifecycleRunnerService } from "./lifecycleService.js";
import { LifecycleValidationError } from "./lifecycleRules.js";

type RunnerControlOptions = { repositories: LifecycleRepositorySet; machineCredential: string; executorId?: typeof FACTORY_RUNNER_ID };

// Recovery points copy and verify the complete application/attachment set. Their duration therefore grows
// with production data. The retained single-machine maintenance lock already prevents automatic takeover,
// so this lease is an ownership guard rather than a short operation timeout. Keep a wide safety window.
const FACTORY_RUNNER_LEASE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function equalCredential(provided: string | undefined, expected: string) {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `invalid_${field}`);
  return value.trim();
}

function requireProgress(value: unknown) {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100) throw new HttpError(400, "invalid_progress");
  return value as number;
}

function requireByteCount(value: unknown, field: string) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new HttpError(400, `invalid_${field}`);
  return value;
}

function allowOnly(body: unknown, allowed: string[]) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "invalid_runner_request");
  if (Object.keys(body as Record<string, unknown>).some((key) => !allowed.includes(key))) {
    throw new HttpError(400, "invalid_runner_request");
  }
}

/**
 * A private, machine-credential-only control plane. It owns no host commands;
 * the Windows runner maps its typed action to a fixed local script.
 */
export function createLifecycleRunnerControlApp(options: RunnerControlOptions) {
  const app = express();
  const service = new SingleMachineLifecycleRunnerService(
    options.repositories,
    options.executorId ?? FACTORY_RUNNER_ID,
    FACTORY_RUNNER_LEASE_DURATION_MS
  );
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use((req, res, next) => {
    if (!equalCredential(req.header("x-lifecycle-runner-token")?.trim(), options.machineCredential)) {
      res.status(401).json({ error: "runner_unauthorized" });
      return;
    }
    service.notePresence();
    next();
  });

  app.post("/runner/poll-claim", async (req, res) => { allowOnly(req.body ?? {}, []); res.json({ job: await service.pollAndClaim() }); });
  app.get("/runner/active-jobs", async (_req, res) => { res.json({ jobs: await service.listActiveJobsForRepair() }); });
  app.post("/runner/active-jobs/:id/cancel", async (req, res) => {
    allowOnly(req.body ?? {}, []);
    res.json({ job: await service.cancelActiveJobForRepair(req.params.id) });
  });
  app.post("/runner/jobs/:id/mark-running", async (req, res) => { allowOnly(req.body ?? {}, []); res.json({ job: await service.markRunning(req.params.id) }); });
  app.post("/runner/jobs/:id/heartbeat", async (req, res) => { allowOnly(req.body ?? {}, []); res.json({ job: await service.heartbeat(req.params.id) }); });
  app.post("/runner/jobs/:id/progress-event", async (req, res) => {
    const body = req.body ?? {};
    allowOnly(body, ["phase", "progress", "message"]);
    const event = await service.appendProgress({
      jobId: req.params.id,
      phase: requireString(body.phase, "phase"),
      progress: requireProgress(body.progress),
      message: requireString(body.message, "message")
    });
    res.status(201).json({ event });
  });
  app.post("/runner/jobs/:id/complete", async (req, res) => { allowOnly(req.body ?? {}, []); res.json({ job: await service.complete(req.params.id) }); });
  app.post("/runner/jobs/:id/fail", async (req, res) => {
    const body = req.body ?? {};
    allowOnly(body, ["errorCode", "errorMessage", "requiresManualReview"]);
    res.json({ job: await service.fail(req.params.id, requireString(body.errorCode, "errorCode"), requireString(body.errorMessage, "errorMessage"), body.requiresManualReview === true) });
  });
  app.post("/runner/jobs/:id/report-interrupted", async (req, res) => {
    const body = req.body ?? {};
    allowOnly(body, ["message"]);
    res.json({ job: await service.reportInterrupted(req.params.id, requireString(body.message, "message")) });
  });
  app.post("/runner/backup-readiness", async (req, res) => {
    const body = req.body ?? {};
    allowOnly(body, ["estimatedSizeBytes", "availableSpaceBytes", "canStart"]);
    if (typeof body.canStart !== "boolean") throw new HttpError(400, "invalid_canStart");
    service.reportBackupReadiness({
      estimatedSizeBytes: requireByteCount(body.estimatedSizeBytes, "estimatedSizeBytes"),
      availableSpaceBytes: requireByteCount(body.availableSpaceBytes, "availableSpaceBytes"),
      canStart: body.canStart
    });
    res.status(204).end();
  });
  app.post("/runner/storage-readiness", async (req, res) => {
    const body = req.body ?? {};
    allowOnly(body, ["dataAvailable", "backupAvailable"]);
    if (typeof body.dataAvailable !== "boolean" || typeof body.backupAvailable !== "boolean") throw new HttpError(400, "invalid_storage_readiness");
    service.reportStorageReadiness({ dataAvailable: body.dataAvailable, backupAvailable: body.backupAvailable });
    res.status(204).end();
  });
  app.post("/runner/recovery-points/:id/creating", async (req, res) => { allowOnly(req.body ?? {}, []); res.json({ recoveryPoint: await service.markRecoveryPointCreating(req.params.id) }); });
  app.get("/runner/recovery-points/:id", async (req, res) => res.json({ recoveryPoint: await service.getRecoveryPointForRunner(req.params.id) }));
  const v1NotAvailable = (_req: express.Request, res: express.Response) => res.status(501).json({ error: "lifecycle_action_not_available" });
  app.post("/runner/recovery-points/pre-restore", v1NotAvailable);
  app.post("/runner/recovery-points/pre-storage-migration", v1NotAvailable);
  app.post("/runner/recovery-points/pre-update", v1NotAvailable);
  app.get("/runner/update-artifacts/:id", v1NotAvailable);
  app.post("/runner/update-artifacts/:id/verification", v1NotAvailable);
  app.get("/runner/storage-migration-plans/:id", v1NotAvailable);
  app.post("/runner/storage-migration-plans/:id/status", v1NotAvailable);
  app.post("/runner/recovery-points/:id/artifacts", async (req, res) => {
    const body = req.body ?? {};
    allowOnly(body, ["kind", "relativeName", "sizeBytes", "sha256", "verificationStatus"]);
    res.status(201).json({ artifact: await service.attachRecoveryPointArtifact(req.params.id, body) });
  });
  app.post("/runner/recovery-points/:id/verify", async (req, res) => {
    const body = req.body ?? {};
    allowOnly(body, ["packageDigest", "totalSizeBytes"]);
    res.json({ recoveryPoint: await service.verifyRecoveryPoint({ id: req.params.id, packageDigest: requireString(body.packageDigest, "packageDigest"), totalSizeBytes: requireString(body.totalSizeBytes, "totalSizeBytes") }) });
  });
  app.post("/runner/recovery-points/:id/fail", async (req, res) => {
    const body = req.body ?? {};
    allowOnly(body, ["failureCode", "failureReason"]);
    res.json({ recoveryPoint: await service.failRecoveryPoint({ id: req.params.id, failureCode: requireString(body.failureCode, "failureCode"), failureReason: requireString(body.failureReason, "failureReason") }) });
  });
  app.get("/runner/current-job", async (_req, res) => res.json(await service.inspectCurrentJob()));

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof HttpError) return res.status(error.statusCode).json({ error: error.message });
    if (error instanceof LifecycleValidationError) return res.status(400).json({ error: "invalid_runner_request" });
    return res.status(500).json({ error: "runner_control_error" });
  });
  return app;
}
