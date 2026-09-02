import { Router } from "express";
import { ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import type { SystemOwnerMaintenanceService } from "./systemOwnerMaintenanceService.js";

export function createSystemOwnerMaintenanceRouter(
  service: SystemOwnerMaintenanceService
) {
  const router = Router();

  router.get(
    "/maintenance/snapshot",
    requireRoles(ROLES.systemOwner),
    async (req, res) => {
      res.json({ snapshot: await service.getSnapshot(req.currentUser!) });
    }
  );

  router.get(
    "/maintenance/runtime-status",
    requireRoles(ROLES.systemOwner),
    async (req, res) => {
      res.json({ runtimeStatus: await service.getRuntimeStatus(req.currentUser!) });
    }
  );

  router.post(
    "/maintenance/runtime-checks",
    requireRoles(ROLES.systemOwner),
    async (req, res) => {
      res.json(await service.runRuntimeChecks(req.currentUser!));
    }
  );

  router.get("/maintenance/endpoint-config", requireRoles(ROLES.systemOwner), async (req, res) => {
    res.json({ config: await service.getEndpointConfig(req.currentUser!) });
  });

  router.put("/maintenance/endpoint-config", requireRoles(ROLES.systemOwner), async (req, res) => {
    res.json({ config: await service.updateEndpointConfig(req.currentUser!, req.body ?? {}) });
  });

  router.get("/maintenance/lan-candidates", requireRoles(ROLES.systemOwner), (req, res) => {
    res.json({ candidates: service.detectLanEndpointCandidates(req.currentUser!) });
  });

  router.post("/maintenance/endpoint-guide", requireRoles(ROLES.systemOwner), (req, res) => {
    res
      .type("text/markdown; charset=utf-8")
      .setHeader("Content-Disposition", 'attachment; filename="system-owner-address-setup-guide.md"')
      .send(service.createEndpointGuideMarkdown(req.currentUser!));
  });

  router.get("/maintenance/miniapp-release-preview", requireRoles(ROLES.systemOwner), async (req, res) => {
    res.json({ config: await service.getMiniappReleasePreviewConfig(req.currentUser!) });
  });

  router.put("/maintenance/miniapp-release-preview", requireRoles(ROLES.systemOwner), async (req, res) => {
    res.json({ config: await service.updateMiniappReleasePreviewConfig(req.currentUser!, req.body ?? {}) });
  });

  router.post(
    "/maintenance/summary-markdown",
    requireRoles(ROLES.systemOwner),
    async (req, res) => {
      const today = new Date().toISOString().slice(0, 10);
      const markdown = await service.createSummaryMarkdown(req.currentUser!);
      res
        .type("text/markdown; charset=utf-8")
        .setHeader(
          "Content-Disposition",
          `attachment; filename="sample-room-maintenance-summary-${today}.md"`
        )
        .send(markdown);
    }
  );

  return router;
}
