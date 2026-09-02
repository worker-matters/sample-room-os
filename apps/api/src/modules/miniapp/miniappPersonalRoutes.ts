import { Router } from "express";
import { ROLES } from "@sample-room/shared";
import type { PerformanceService } from "../pricing/performanceService.js";
import type { PerformanceQuery } from "../pricing/performanceTypes.js";
import { safeAttachmentPreviewMime } from "../files/attachmentRouteUtils.js";
import type { ScanWorkflowService } from "../scan/scanService.js";
import type { MiniappIdentityService } from "./miniappIdentityService.js";
import { miniappSessionToken } from "./miniappSession.js";
import { HttpError } from "../../shared/errors/httpError.js";

function queryText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function createMiniappPersonalRouter(
  identityService: MiniappIdentityService,
  performanceService: PerformanceService,
  scanWorkflowService: ScanWorkflowService
) {
  const router = Router();

  const currentWorker = async (req: Parameters<typeof miniappSessionToken>[0]) => {
    const currentUser = req.currentUser;
    if (currentUser?.role === ROLES.worker) {
      if (!currentUser.activeWorkerProfileId || !currentUser.activeWorkerType) {
        throw new HttpError(403, "worker_miniapp_identity_required");
      }
      return currentUser;
    }

    const bearerToken = miniappSessionToken(req);
    if (bearerToken) {
      return identityService.resolveWorkerCurrentUser(bearerToken);
    }

    throw new HttpError(403, "worker_miniapp_identity_required");
  };

  const routeId = (value: string | string[] | undefined) => {
    if (typeof value !== "string" || !value) throw new Error("route id is required");
    return value;
  };

  router.get("/performance", async (req, res) => {
    const currentUser = await currentWorker(req);
    const options: PerformanceQuery = {};
    const dateFrom = queryText(req.query.dateFrom);
    const dateTo = queryText(req.query.dateTo);
    const month = queryText(req.query.month);
    if (dateFrom) options.dateFrom = dateFrom;
    if (dateTo) options.dateTo = dateTo;
    if (month) options.month = month;
    const report = await performanceService.getOwnWorkerReport(options, currentUser);
    res.json({
      ...report,
      records: report.records.map((record) => ({
        orderId: record.orderId,
        ...(record.scanRecordId ? { scanRecordId: record.scanRecordId } : {}),
        styleNo: record.styleNo,
        styleName: record.styleName,
        completedAt: record.completedAt,
        pieces: record.pieces,
        workHours: record.workHours,
        ...(record.qualityScore !== undefined ? { qualityScore: record.qualityScore } : {}),
        ...(record.reworkCount !== undefined ? { reworkCount: record.reworkCount } : {}),
        ...(record.complaintCount !== undefined ? { complaintCount: record.complaintCount } : {})
      }))
    });
  });

  router.patch("/performance/orders/:orderId/scan-records/:scanRecordId/pieces", async (req, res) => {
    await currentWorker(req);
    throw new HttpError(403, "员工不能修改已提交的绩效件数，请联系老板或 System Owner 纠正。");
  });

  router.get("/sewing-tasks", async (req, res) => {
    res.json({ tasks: await scanWorkflowService.listOwnSewingTasks(await currentWorker(req)) });
  });

  router.get("/sewing-tasks/:orderId", async (req, res) => {
    res.json({
      state: await scanWorkflowService.getOwnSewingTaskState(
        routeId(req.params.orderId),
        await currentWorker(req)
      )
    });
  });

  router.get("/sewing-tasks/:orderId/thumbnail", async (req, res) => {
    const thumbnail = await scanWorkflowService.getOwnSewingTaskThumbnail(
      routeId(req.params.orderId),
      await currentWorker(req)
    );
    const safeMime = safeAttachmentPreviewMime(thumbnail.content);
    if (!safeMime?.startsWith("image/")) {
      res.status(404).json({ error: "thumbnail not found." });
      return;
    }
    res.setHeader("Content-Type", safeMime);
    res.setHeader("Content-Length", thumbnail.content.length.toString());
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(thumbnail.content);
  });

  router.post("/sewing-tasks/:orderId/complete", async (req, res) => {
    res.json({
      state: await scanWorkflowService.completeOwnSewingTask(
        routeId(req.params.orderId),
        await currentWorker(req),
        req.body ?? {}
      )
    });
  });

  return router;
}
