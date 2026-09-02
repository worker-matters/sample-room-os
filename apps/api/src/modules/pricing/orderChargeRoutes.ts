import { Router, type RequestHandler } from "express";
import { ROLES, type Role } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import { attachmentPayloadFromRequest, attachmentUploadMiddleware } from "../files/attachmentRouteUtils.js";
import type { OrderChargeService } from "./orderChargeService.js";

function routeId(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new Error("route id is required");
  }
  return value;
}

function createAddRouter(
  service: OrderChargeService,
  role: "receiver" | "planner" | "boss",
  uploadSecurity: RequestHandler,
  allowedRoles: Role[] = [role]
) {
  const router = Router();
  const roleOnly = requireRoles(...allowedRoles);
  router.get("/orders/:id/charges", roleOnly, async (req, res) => {
    res.json({ charges: await service.list(routeId(req.params.id), req.currentUser!) });
  });
  router.post("/orders/:id/charges", roleOnly, async (req, res) => {
    res.status(201).json({
      charge: await service.create(routeId(req.params.id), req.body ?? {}, req.currentUser!)
    });
  });
  router.patch("/orders/:id/charges/:chargeId", roleOnly, async (req, res) => {
    res.json({
      charge: await service.update(
        routeId(req.params.id),
        routeId(req.params.chargeId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });
  router.delete("/orders/:id/charges/:chargeId", roleOnly, async (req, res) => {
    res.json({
      charge: await service.remove(
        routeId(req.params.id),
        routeId(req.params.chargeId),
        req.currentUser!
      )
    });
  });
  router.post("/orders/:id/charges/:chargeId/attachments", roleOnly, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    res.status(201).json({
      charge: await service.addAttachments(
        routeId(req.params.id),
        routeId(req.params.chargeId),
        attachmentPayloadFromRequest(req),
        req.currentUser!
      )
    });
  });
  router.patch("/orders/:id/charges/:chargeId/attachments/:attachmentId/display-name", roleOnly, async (req, res) => {
    res.json({
      charge: await service.renameAttachment(
        routeId(req.params.id),
        routeId(req.params.chargeId),
        routeId(req.params.attachmentId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });
  router.delete("/orders/:id/charges/:chargeId/attachments/:attachmentId", roleOnly, async (req, res) => {
    res.json({
      charge: await service.deleteAttachment(
        routeId(req.params.id),
        routeId(req.params.chargeId),
        routeId(req.params.attachmentId),
        req.currentUser!
      )
    });
  });
  if (role === ROLES.receiver || role === ROLES.planner) {
    router.get("/orders/by-scan-token/:token/charges", roleOnly, async (req, res) => {
      res.json(await service.scanSummary(routeId(req.params.token), req.currentUser!));
    });
    router.post("/orders/by-scan-token/:token/charges", roleOnly, async (req, res) => {
      res.status(201).json(await service.createFromScanToken(routeId(req.params.token), req.body ?? {}, req.currentUser!));
    });
    router.post("/orders/:id/charges/:chargeId/void", roleOnly, async (req, res) => {
      res.json({
        charge: await service.void(
          routeId(req.params.id),
          routeId(req.params.chargeId),
          req.body ?? {},
          req.currentUser!
        )
      });
    });
  }
  return router;
}

export function createReceiverOrderChargeRouter(service: OrderChargeService, uploadSecurity: RequestHandler) {
  return createAddRouter(service, ROLES.receiver, uploadSecurity);
}

export function createPlannerOrderChargeRouter(service: OrderChargeService, uploadSecurity: RequestHandler) {
  return createAddRouter(service, ROLES.planner, uploadSecurity);
}

export function createAdminOrderChargeRouter(service: OrderChargeService, uploadSecurity: RequestHandler) {
  const bossOrSystemOwner = requireRoles(ROLES.boss, ROLES.systemOwner);
  const router = createAddRouter(service, ROLES.boss, uploadSecurity, [ROLES.boss, ROLES.systemOwner]);
  router.post("/orders/:id/charges/:chargeId/review", bossOrSystemOwner, async (req, res) => {
    res.json({
      charge: await service.review(
        routeId(req.params.id),
        routeId(req.params.chargeId),
        req.currentUser!
      )
    });
  });
  router.post("/orders/:id/charges/:chargeId/confirm", bossOrSystemOwner, async (req, res) => {
    res.json({
      charge: await service.confirm(
        routeId(req.params.id),
        routeId(req.params.chargeId),
        req.currentUser!
      )
    });
  });
  router.post("/orders/:id/charges/:chargeId/reject", bossOrSystemOwner, async (req, res) => {
    res.json({
      charge: await service.reject(
        routeId(req.params.id),
        routeId(req.params.chargeId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });
  router.post("/orders/:id/charges/:chargeId/cancel-confirmation", bossOrSystemOwner, async (req, res) => {
    res.json({
      charge: await service.cancelConfirmation(
        routeId(req.params.id),
        routeId(req.params.chargeId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });
  router.post("/orders/:id/charges/:chargeId/void", bossOrSystemOwner, async (req, res) => {
    res.json({
      charge: await service.void(
        routeId(req.params.id),
        routeId(req.params.chargeId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });
  router.get("/orders/:id/charge-void-history", requireRoles(ROLES.boss, ROLES.systemOwner), async (req, res) => {
    res.json({ records: await service.listVoidHistory(routeId(req.params.id), req.currentUser!) });
  });
  return router;
}
