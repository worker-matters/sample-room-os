import { Router, type RequestHandler } from "express";
import { ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import { HttpError } from "../../shared/errors/httpError.js";
import {
  attachmentPayloadFromRequest,
  attachmentUploadMiddleware,
  sendAttachmentDownload
} from "../files/attachmentRouteUtils.js";
import type { PatternWorkflowService } from "./patternWorkflowService.js";

function routeId(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new Error("route id is required");
  }

  return value;
}

export function createPatternMakerRouter(service: PatternWorkflowService, uploadSecurity: RequestHandler) {
  const router = Router();
  const patternMakerOnly = requireRoles(ROLES.patternMaker);

  router.get("/tasks", patternMakerOnly, async (req, res) => {
    res.json({ tasks: await service.listPatternTasks(req.currentUser!) });
  });

  router.get("/workbench", patternMakerOnly, async (req, res) => {
    res.json(await service.getPatternWorkbench(req.currentUser!));
  });

  router.get("/archive", patternMakerOnly, async (req, res) => {
    res.json({ tasks: await service.listPatternArchive(req.currentUser!) });
  });

  router.post("/tasks/:taskId/link-pattern", patternMakerOnly, async (req, res) => {
    res.json({
      task: await service.linkPatternLibraryEntry(
        routeId(req.params.taskId),
        routeId(req.body?.libraryEntryId),
        req.currentUser!
      )
    });
  });

  router.post("/tasks/:taskId/resume", patternMakerOnly, async (req, res) => {
    res.json({
      task: await service.resumePausedTask(routeId(req.params.taskId), req.currentUser!)
    });
  });

  router.post("/tasks/:taskId/start", patternMakerOnly, async (req, res) => {
    res.json({
      task: await service.startTask(routeId(req.params.taskId), req.currentUser!)
    });
  });

  router.post("/tasks/:taskId/complete", patternMakerOnly, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    res.json({
      task: await service.completeTask(
        routeId(req.params.taskId),
        attachmentPayloadFromRequest(req),
        req.currentUser!
      )
    });
  });

  router.post("/tasks/:taskId/operation", patternMakerOnly, async (req, res) => {
    res.json({
      task: await service.recordTaskOperation(
        routeId(req.params.taskId),
        req.body,
        req.currentUser!
      )
    });
  });

  router.post("/tasks/:taskId/submit-cutting-version", patternMakerOnly, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    res.status(201).json({
      submission: await service.submitCuttingVersion(
        routeId(req.params.taskId),
        attachmentPayloadFromRequest(req),
        req.currentUser!
      )
    });
  });

  router.post("/tasks/:taskId/supplement-version", patternMakerOnly, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    res.status(201).json({
      submission: await service.supplementPatternVersion(
        routeId(req.params.taskId),
        attachmentPayloadFromRequest(req),
        req.currentUser!
      )
    });
  });

  router.get("/orders/:orderId/folder", patternMakerOnly, async (req, res) => {
    res.json({
      folder: await service.getOrderFolder(routeId(req.params.orderId), req.currentUser!)
    });
  });

  router.post("/orders/:orderId/folder/generate", patternMakerOnly, async (req, res) => {
    res.status(201).json({
      folder: await service.generateOrderFolder(routeId(req.params.orderId), req.currentUser!)
    });
  });

  router.get("/orders/:orderId/attachments", patternMakerOnly, async (req, res) => {
    res.json(await service.listPatternOrderAttachments(
      routeId(req.params.orderId),
      req.currentUser!
    ));
  });

  router.post("/orders/:orderId/attachments", patternMakerOnly, async () => {
    throw new HttpError(410, "use the versioned pattern-deliverable endpoint.");
  });

  router.patch("/orders/:orderId/attachments/:attachmentId", patternMakerOnly, async (req, res) => {
    res.json({
      attachments: await service.updatePatternOrderAttachment(
        routeId(req.params.orderId),
        routeId(req.params.attachmentId),
        req.body,
        req.currentUser!
      )
    });
  });

  router.delete("/orders/:orderId/attachments/:attachmentId", patternMakerOnly, async (req, res) => {
    res.json({
      attachments: await service.deletePatternOrderAttachment(
        routeId(req.params.orderId),
        routeId(req.params.attachmentId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });

  router.get("/orders/:orderId/attachments/:attachmentId/download", patternMakerOnly, async (req, res) => {
    sendAttachmentDownload(
      res,
      await service.downloadPatternOrderAttachment(
        routeId(req.params.orderId),
        routeId(req.params.attachmentId),
        req.currentUser!
      )
    );
  });

  router.post("/tasks/:taskId/deliverable-versions", patternMakerOnly, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    res.status(201).json({
      task: await service.appendPatternDeliverableVersion(
        routeId(req.params.taskId),
        attachmentPayloadFromRequest(req),
        req.currentUser!
      )
    });
  });

  router.get("/orders/:orderId/pattern-deliverables/:deliverableId/download", patternMakerOnly, async (req, res) => {
    sendAttachmentDownload(
      res,
      await service.downloadPatternDeliverable(
        routeId(req.params.orderId),
        routeId(req.params.deliverableId),
        req.currentUser!
      )
    );
  });

  router.patch("/orders/:orderId/pattern-deliverables/:deliverableId/display-name", patternMakerOnly, async (req, res) => {
    res.json({
      task: await service.renamePatternDeliverable(
        routeId(req.params.orderId),
        routeId(req.params.deliverableId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });

  router.patch("/orders/:orderId/pattern-deliverables/:deliverableId/visibility", patternMakerOnly, async (req, res) => {
    res.json({
      task: await service.changePatternDeliverableVisibility(
        routeId(req.params.orderId),
        routeId(req.params.deliverableId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });

  router.delete("/orders/:orderId/pattern-deliverables/:deliverableId", patternMakerOnly, async (req, res) => {
    res.json({
      task: await service.deleteOwnPatternDeliverable(
        routeId(req.params.orderId),
        routeId(req.params.deliverableId),
        req.currentUser!
      )
    });
  });

  return router;
}

export function createPatternLibraryRouter(service: PatternWorkflowService) {
  const router = Router();
  const internalUsers = requireRoles(ROLES.patternMaker, ROLES.boss, ROLES.systemOwner);

  router.get("/", internalUsers, async (req, res) => {
    res.json({ entries: await service.listPatternLibraryEntries(req.currentUser!) });
  });

  router.post("/", internalUsers, async (req, res) => {
    res.status(201).json({
      entry: await service.createPatternLibraryEntry(req.body, req.currentUser!)
    });
  });

  return router;
}

export function createCuttingRoomRouter(service: PatternWorkflowService) {
  const router = Router();
  const internalUsers = requireRoles(
    ROLES.boss,
    ROLES.systemOwner
  );

  router.get("/submissions", internalUsers, async (req, res) => {
    res.json({ submissions: await service.listCuttingInbox(req.currentUser!) });
  });

  router.post("/submissions/:submissionId/mark-printed", internalUsers, async (req, res) => {
    res.json({
      submission: await service.updateCuttingInboxStatus(
        routeId(req.params.submissionId),
        "printed",
        req.body,
        req.currentUser!
      )
    });
  });

  router.post("/submissions/:submissionId/mark-cut", internalUsers, async (req, res) => {
    res.json({
      submission: await service.updateCuttingInboxStatus(
        routeId(req.params.submissionId),
        "cut",
        req.body,
        req.currentUser!
      )
    });
  });

  return router;
}
