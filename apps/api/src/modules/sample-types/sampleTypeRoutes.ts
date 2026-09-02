import { Router } from "express";
import { ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import type { SampleTypeService } from "./sampleTypeService.js";

function routeCode(value: string | string[] | undefined) {
  if (typeof value !== "string" || value.length === 0) throw new Error("route code is required");
  return value;
}

export function createSampleTypeReadRouter(service: SampleTypeService) {
  const router = Router();
  router.get("/sample-types", requireRoles(...Object.values(ROLES)), async (_req, res) => {
    res.json({ items: await service.listOptions() });
  });
  return router;
}

export function createSampleTypeManagementRouter(service: SampleTypeService) {
  const router = Router();
  const canManage = requireRoles(ROLES.boss, ROLES.systemOwner);

  router.post("/sample-types", canManage, async (req, res) => {
    res.status(201).json({ items: await service.create(req.body?.name, req.currentUser!) });
  });
  router.patch("/sample-types/:code", canManage, async (req, res) => {
    res.json({ items: await service.rename(routeCode(req.params.code), req.body?.name, req.currentUser!) });
  });
  router.post("/sample-types/:code/move", canManage, async (req, res) => {
    res.json({
      items: await service.move(routeCode(req.params.code), req.body?.direction, req.currentUser!)
    });
  });
  return router;
}
