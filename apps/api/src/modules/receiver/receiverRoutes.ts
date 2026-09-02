import { Router, type RequestHandler } from "express";
import { ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import {
  attachmentPayloadFromRequest,
  attachmentUploadMiddleware,
  bodyWithUploadedAttachments,
  sendAttachmentDownload
} from "../files/attachmentRouteUtils.js";
import type { PatternWorkflowService } from "../patterns/patternWorkflowService.js";
import type { ScanWorkflowService } from "../scan/scanService.js";
import type { ReceiverService } from "./receiverService.js";

function routeId(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new Error("route id is required");
  }

  return value;
}

export function createReceiverRouter(
  receiverService: ReceiverService,
  scanWorkflowService: ScanWorkflowService | undefined,
  patternWorkflowService: PatternWorkflowService | undefined,
  uploadSecurity: RequestHandler
) {
  const router = Router();
  const receiverOrBoss = requireRoles(ROLES.receiver, ROLES.boss);
  const scanManager = requireRoles(ROLES.receiver, ROLES.boss, ROLES.systemOwner);
  const receiverOnly = requireRoles(ROLES.receiver);

  router.get("/pending-receive", receiverOrBoss, async (_req, res) => {
    res.json({ orders: await receiverService.listPendingReceive() });
  });

  router.post("/orders/:id/accept", receiverOrBoss, async (req, res) => {
    const order = await receiverService.acceptOrder(
      routeId(req.params.id),
      req.body,
      req.currentUser!
    );
    res.json({ order });
  });

  router.post("/orders/:id/return", receiverOrBoss, async (req, res) => {
    res.json({
      order: await receiverService.returnOrder(routeId(req.params.id), req.body, req.currentUser!)
    });
  });

  router.get("/tracking", receiverOrBoss, async (_req, res) => {
    res.json({ orders: await receiverService.listTracking() });
  });

  router.patch("/orders/:id/tracking", receiverOrBoss, async (req, res) => {
    res.json({
      order: await receiverService.updateTracking(routeId(req.params.id), req.body, req.currentUser!)
    });
  });

  router.patch("/orders/:id/correction", receiverOnly, async (req, res) => {
    res.json({
      order: await receiverService.correctOrder(routeId(req.params.id), req.body, req.currentUser!)
    });
  });

  router.get("/orders/:id/attachments", receiverOrBoss, async (req, res) => {
    res.json({
      attachments: await receiverService.listOrderAttachments(routeId(req.params.id), req.currentUser!)
    });
  });

  router.post("/orders/:id/attachments", receiverOrBoss, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    const attachments = await receiverService.addOrderAttachments(
      routeId(req.params.id),
      attachmentPayloadFromRequest(req),
      req.currentUser!
    );
    res.status(201).json({ attachments });
  });

  router.delete("/orders/:id/attachments/:attachmentId", receiverOrBoss, async (req, res) => {
    res.json({
      attachments: await receiverService.deleteOrderAttachment(
        routeId(req.params.id),
        routeId(req.params.attachmentId),
        req.currentUser!
      )
    });
  });

  router.patch("/orders/:id/attachments/:attachmentId/display-name", receiverOrBoss, async (req, res) => {
    res.json({
      attachments: await receiverService.renameOrderAttachment(
        routeId(req.params.id),
        routeId(req.params.attachmentId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });

  router.patch("/orders/:id/attachments/:attachmentId/visibility", receiverOrBoss, async (req, res) => {
    res.json({
      attachments: await receiverService.changeOrderAttachmentVisibility(
        routeId(req.params.id),
        routeId(req.params.attachmentId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });

  router.get("/orders/:id/attachments/:attachmentId/download", receiverOrBoss, async (req, res) => {
    sendAttachmentDownload(
      res,
      await receiverService.downloadOrderAttachment(
        routeId(req.params.id),
        routeId(req.params.attachmentId),
        req.currentUser!
      )
    );
  });

  router.patch("/orders/:id/sample-sheet-attachment", receiverOnly, async (req, res) => {
    if (typeof req.body?.attachmentId !== "string" || req.body.attachmentId.trim().length === 0) {
      res.status(400).json({ error: "attachmentId is required." });
      return;
    }
    res.json({
      attachments: await receiverService.selectSampleSheetAttachment(
        routeId(req.params.id),
        req.body.attachmentId,
        req.currentUser!
      )
    });
  });

  router.get("/orders/:id/attachment-logs", receiverOrBoss, async (req, res) => {
    res.json({
      logs: await receiverService.listAttachmentLogs(routeId(req.params.id), req.currentUser!)
    });
  });

  router.get("/orders/:id/pattern-deliverables/:deliverableId/download", receiverOrBoss, async (req, res) => {
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

  router.get("/orders/:id/scan-link", scanManager, async (req, res) => {
    if (!scanWorkflowService) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    res.json({
      scanLink: await scanWorkflowService.ensureOrderScanLink(
        routeId(req.params.id),
        req.currentUser!
      )
    });
  });

  router.get("/orders/:id/scan-records", scanManager, async (req, res) => {
    if (!scanWorkflowService) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    res.json({
      records: await scanWorkflowService.listOrderScanRecords(
        routeId(req.params.id),
        req.currentUser!
      )
    });
  });

  router.post("/orders/self-entry", receiverOrBoss, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    const order = await receiverService.createSelfEntry(bodyWithUploadedAttachments(req), req.currentUser!);
    res.status(201).json({ order });
  });

  router.post("/orders/quick-photo", receiverOnly, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    const payload = bodyWithUploadedAttachments(req);
    const order = await receiverService.createQuickPhotoEntry(
      {
        ...payload,
        sampleRequestItems: payload.sampleRequestItems ?? []
      },
      req.currentUser!
    );
    res.status(201).json({ order });
  });

  router.get("/self-entry-options", receiverOrBoss, async (_req, res) => {
    res.json(await receiverService.listSelfEntryOptions());
  });

  router.get("/orders", receiverOrBoss, async (_req, res) => {
    res.json({ orders: await receiverService.listOrders() });
  });

  return router;
}
