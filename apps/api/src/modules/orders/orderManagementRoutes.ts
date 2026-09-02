import { Router, type RequestHandler } from "express";
import { ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import {
  attachmentPayloadFromRequest,
  attachmentUploadMiddleware,
  sendAttachmentDownload
} from "../files/attachmentRouteUtils.js";
import type { PatternWorkflowService } from "../patterns/patternWorkflowService.js";
import type { OrderManagementService } from "./orderManagementService.js";

function routeId(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new Error("route id is required");
  }

  return value;
}

export function createOrderManagementRouter(
  orderManagementService: OrderManagementService,
  patternWorkflowService?: PatternWorkflowService,
  uploadSecurity: RequestHandler = (_req, _res, next) => next()
) {
  const router = Router();
  const bossOrSystemOwner = requireRoles(ROLES.boss, ROLES.systemOwner);

  router.get("/orders", bossOrSystemOwner, async (req, res) => {
    res.json({ orders: await orderManagementService.listActiveOrders(req.currentUser!) });
  });

  router.get("/orders/terminated", bossOrSystemOwner, async (req, res) => {
    res.json({ orders: await orderManagementService.listTerminatedOrders(req.currentUser!) });
  });

  router.get("/orders/:id/detail", bossOrSystemOwner, async (req, res) => {
    res.json(await orderManagementService.getOrderDetail(routeId(req.params.id), req.currentUser!));
  });

  router.get("/orders/:id/qc-result", bossOrSystemOwner, async (req, res) => {
    res.json(await orderManagementService.getQcResult(routeId(req.params.id), req.currentUser!));
  });

  router.get("/orders/:id/qc-result/photos/:attachmentId/download", bossOrSystemOwner, async (req, res) => {
    sendAttachmentDownload(
      res,
      await orderManagementService.downloadQcResultPhoto(
        routeId(req.params.id),
        routeId(req.params.attachmentId),
        req.currentUser!
      )
    );
  });

  router.get("/orders/:id/qc-rework-records/:recordId/photos/:attachmentId/download", bossOrSystemOwner, async (req, res) => {
    sendAttachmentDownload(
      res,
      await orderManagementService.downloadQcReworkPhoto(
        routeId(req.params.id),
        routeId(req.params.recordId),
        routeId(req.params.attachmentId),
        req.currentUser!
      )
    );
  });

  router.get("/orders/:id/attachments/:attachmentId/download", bossOrSystemOwner, async (req, res) => {
    sendAttachmentDownload(
      res,
      await orderManagementService.downloadOrderAttachment(
        routeId(req.params.id),
        routeId(req.params.attachmentId),
        req.currentUser!
      )
    );
  });

  router.post("/orders/:id/attachments", bossOrSystemOwner, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    res.status(201).json({
      attachments: await orderManagementService.addOrderAttachments(
        routeId(req.params.id),
        attachmentPayloadFromRequest(req),
        req.currentUser!
      )
    });
  });

  router.patch("/orders/:id/attachments/:attachmentId/display-name", bossOrSystemOwner, async (req, res) => {
    res.json(
      await orderManagementService.renameOrderAttachment(
        routeId(req.params.id),
        routeId(req.params.attachmentId),
        req.body ?? {},
        req.currentUser!
      )
    );
  });

  router.patch("/orders/:id/attachments/:attachmentId/visibility", bossOrSystemOwner, async (req, res) => {
    res.json(
      await orderManagementService.changeOrderAttachmentVisibility(
        routeId(req.params.id),
        routeId(req.params.attachmentId),
        req.body ?? {},
        req.currentUser!
      )
    );
  });

  router.delete("/orders/:id/attachments/:attachmentId", bossOrSystemOwner, async (req, res) => {
    res.json(
      await orderManagementService.deleteOrderAttachment(
        routeId(req.params.id),
        routeId(req.params.attachmentId),
        req.currentUser!
      )
    );
  });

  router.post("/orders/:id/complaints", bossOrSystemOwner, async (req, res) => {
    res.status(201).json({
      complaint: await orderManagementService.registerComplaint(
        routeId(req.params.id),
        req.body,
        req.currentUser!
      )
    });
  });

  router.delete("/orders/:id/complaints/:complaintId", bossOrSystemOwner, async (req, res) => {
    res.json({
      complaint: await orderManagementService.deleteComplaint(
        routeId(req.params.id),
        routeId(req.params.complaintId),
        req.currentUser!
      )
    });
  });

  router.get("/orders/:id/pattern-deliverables/:deliverableId/download", bossOrSystemOwner, async (req, res) => {
    if (!patternWorkflowService) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    sendAttachmentDownload(
      res,
      await patternWorkflowService.downloadPatternDeliverable(
        routeId(req.params.id),
        routeId(req.params.deliverableId),
        req.currentUser!
      )
    );
  });

  router.patch("/orders/:id/pattern-deliverables/:deliverableId/display-name", bossOrSystemOwner, async (req, res) => {
    if (!patternWorkflowService) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({
      task: await patternWorkflowService.renamePatternDeliverable(
        routeId(req.params.id),
        routeId(req.params.deliverableId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });

  router.patch("/orders/:id/pattern-deliverables/:deliverableId/visibility", bossOrSystemOwner, async (req, res) => {
    if (!patternWorkflowService) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({
      task: await patternWorkflowService.changePatternDeliverableVisibility(
        routeId(req.params.id),
        routeId(req.params.deliverableId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });

  router.delete("/orders/:id/pattern-deliverables/:deliverableId", bossOrSystemOwner, async (req, res) => {
    if (!patternWorkflowService) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({
      task: await patternWorkflowService.deleteOwnPatternDeliverable(
        routeId(req.params.id),
        routeId(req.params.deliverableId),
        req.currentUser!
      )
    });
  });

  router.post("/orders/:id/terminate", bossOrSystemOwner, async (req, res) => {
    res.json({
      order: await orderManagementService.terminateOrder(routeId(req.params.id), req.body, req.currentUser!)
    });
  });

  router.post("/orders/:id/restore", bossOrSystemOwner, async (req, res) => {
    res.json({
      order: await orderManagementService.restoreOrder(routeId(req.params.id), req.currentUser!)
    });
  });

  return router;
}
