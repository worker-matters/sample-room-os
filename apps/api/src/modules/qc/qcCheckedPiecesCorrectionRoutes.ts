import { Router } from "express";
import { ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import type { QcCheckedPiecesCorrectionService } from "./qcCheckedPiecesCorrectionService.js";

function routeId(value: string | string[] | undefined) {
  if (typeof value !== "string" || !value) throw new Error("route id is required");
  return value;
}

export function createQcCheckedPiecesCorrectionRouter(
  service: QcCheckedPiecesCorrectionService
) {
  const router = Router();
  const bossOrSystemOwner = requireRoles(ROLES.boss, ROLES.systemOwner);

  router.get("/orders/:id/process-pieces", bossOrSystemOwner, async (req, res) => {
    res.json(await service.processPieces(routeId(req.params.id), req.currentUser!));
  });

  router.get("/orders/:id/qc-result/effective-pieces", bossOrSystemOwner, async (req, res) => {
    res.json(await service.latest(routeId(req.params.id), req.currentUser!));
  });

  router.patch("/orders/:id/qc-result/pieces", bossOrSystemOwner, async (req, res) => {
    const correction = await service.correct(
      routeId(req.params.id),
      req.body ?? {},
      req.currentUser!
    );
    res.json({
      correction,
      ...(await service.latest(routeId(req.params.id), req.currentUser!))
    });
  });

  return router;
}
