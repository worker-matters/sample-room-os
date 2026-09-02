import { Router, type RequestHandler } from "express";
import { ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import { HttpError } from "../../shared/errors/httpError.js";
import { attachmentPayloadFromRequest, attachmentUploadMiddleware, sendAttachmentDownload } from "../files/attachmentRouteUtils.js";
import type { CollaborativePlannerService } from "./collaborativePlannerService.js";

function routeId(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new Error("route id is required");
  return value;
}

export function createPlannerRouter(plannerService: CollaborativePlannerService, uploadSecurity: RequestHandler) {
  const router = Router();
  const plannerRoles = requireRoles(ROLES.planner, ROLES.boss, ROLES.systemOwner);
  const plannerOnly = requireRoles(ROLES.planner);

  router.get("/orders", plannerRoles, async (req, res) => {
    res.json({ orders: await plannerService.listOrders(req.currentUser!) });
  });

  router.get("/orders/:id/sewing-collaboration", plannerRoles, async (req, res) => {
    res.json({
      collaboration: await plannerService.getSewingCollaboration(
        routeId(req.params.id),
        req.currentUser!
      )
    });
  });

  router.patch(
    "/orders/:id/sewing-collaboration/targets",
    plannerOnly,
    async (req, res) => {
      res.json({
        collaboration: await plannerService.updateParticipationTargets(
          routeId(req.params.id),
          req.body?.updates,
          req.body?.expectedRevision,
          req.currentUser!
        )
      });
    }
  );

  router.patch(
    "/orders/:id/sewing-collaboration/:participationId/target",
    plannerOnly,
    async (req, res) => {
      res.json({
        participation: await plannerService.updateParticipationTarget(
          routeId(req.params.id),
          routeId(req.params.participationId),
          req.body?.targetPieces,
          req.body?.expectedRevision,
          req.currentUser!
        )
      });
    }
  );

  router.post(
    "/orders/:id/sewing-collaboration/:participationId/cancel",
    plannerOnly,
    async (req, res) => {
      res.json({
        participation: await plannerService.cancelParticipation(
          routeId(req.params.id),
          routeId(req.params.participationId),
          req.body?.expectedRevision,
          req.currentUser!
        )
      });
    }
  );

  router.get("/orders/:id/attachments/:attachmentId/download", plannerRoles, async (req, res) => {
    sendAttachmentDownload(
      res,
      await plannerService.downloadOrderAttachment(
        routeId(req.params.id),
        routeId(req.params.attachmentId),
        req.currentUser!
      )
    );
  });

  router.post("/orders/:id/attachments", plannerOnly, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    res.status(201).json({
      attachments: await plannerService.addOrderAttachments(
        routeId(req.params.id),
        attachmentPayloadFromRequest(req),
        req.currentUser!
      )
    });
  });

  router.delete("/orders/:id/attachments/:attachmentId", plannerOnly, async (req, res) => {
    res.json({
      attachments: await plannerService.deleteOrderAttachment(
        routeId(req.params.id),
        routeId(req.params.attachmentId),
        req.currentUser!
      )
    });
  });

  router.patch("/orders/:id/attachments/:attachmentId/display-name", plannerOnly, async (req, res) => {
    res.json({
      attachments: await plannerService.renameOrderAttachment(
        routeId(req.params.id),
        routeId(req.params.attachmentId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });

  router.patch("/orders/:id/attachments/:attachmentId/visibility", plannerOnly, async (req, res) => {
    res.json({
      attachments: await plannerService.changeOrderAttachmentVisibility(
        routeId(req.params.id),
        routeId(req.params.attachmentId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });

  router.get("/orders/:id/pattern-deliverables/:deliverableId/download", plannerRoles, async (req, res) => {
    sendAttachmentDownload(
      res,
      await plannerService.downloadPatternDeliverable(
        routeId(req.params.id),
        routeId(req.params.deliverableId),
        req.currentUser!
      )
    );
  });

  router.get("/sewing-workers", plannerRoles, async () => {
    throw new HttpError(410, "planner sewing assignment is closed; sewing workers start tasks by scan.");
  });

  router.post("/orders/:id/assign-sewing", plannerRoles, async () => {
    throw new HttpError(410, "planner sewing assignment is closed; sewing workers start tasks by scan.");
  });

  return router;
}
