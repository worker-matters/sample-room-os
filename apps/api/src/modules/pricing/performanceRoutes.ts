import { Router } from "express";
import { ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { PerformanceService } from "./performanceService.js";
import type { PerformanceQuery, PerformanceStage } from "./performanceTypes.js";

const stages = new Set<PerformanceStage>([
  "pattern",
  "cutting",
  "sewing",
  "receiver",
  "finishing",
  "qc_delivery"
]);

function queryText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function routeId(value: string | string[] | undefined) {
  if (typeof value !== "string" || !value) throw new Error("route id is required");
  return value;
}

export function createPerformanceRouter(service: PerformanceService) {
  const router = Router();
  const bossOrSystemOwner = requireRoles(ROLES.boss, ROLES.systemOwner);

  router.get("/performance", bossOrSystemOwner, async (req, res) => {
    const stageText = queryText(req.query.stage);
    if (stageText && !stages.has(stageText as PerformanceStage)) {
      throw new HttpError(400, "stage is invalid.");
    }
    const options: PerformanceQuery = {};
    const dateFrom = queryText(req.query.dateFrom);
    const dateTo = queryText(req.query.dateTo);
    const accountId = queryText(req.query.accountId);
    const workerProfileId = queryText(req.query.workerProfileId);
    const q = queryText(req.query.q);
    const includeOrderDetails = req.query.includeOrderDetails !== "false";
    if (dateFrom) options.dateFrom = dateFrom;
    if (dateTo) options.dateTo = dateTo;
    if (stageText) options.stage = stageText as PerformanceStage;
    if (accountId) options.accountId = accountId;
    if (workerProfileId) options.workerProfileId = workerProfileId;
    if (q) options.q = q;
    options.includeOrderDetails = includeOrderDetails;
    res.json(await service.getReport(options, req.currentUser!));
  });

  router.patch(
    "/performance/orders/:orderId/scan-records/:scanRecordId/pieces",
    bossOrSystemOwner,
    async (req, res) => {
      res.json({
        correction: await service.correctProcessPieces(
          routeId(req.params.orderId),
          routeId(req.params.scanRecordId),
          req.body?.pieces,
          req.currentUser!,
          req.body?.reason
        )
      });
    }
  );

  return router;
}
