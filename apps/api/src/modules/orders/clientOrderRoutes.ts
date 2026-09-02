import { Router, type RequestHandler } from "express";
import { CLIENT_ACCESS_SCOPES, CLIENT_ROLES, ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import {
  attachmentPayloadFromRequest,
  attachmentUploadMiddleware,
  bodyWithUploadedAttachments,
  excelImportUploadMiddleware,
  sendAttachmentDownload
} from "../files/attachmentRouteUtils.js";
import type { OrderService } from "./orderService.js";

function routeId(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new Error("route id is required");
  }

  return value;
}

const requireOwnScopeClientUploader: RequestHandler = (req, res, next) => {
  const currentUser = req.currentUser;
  if (
    currentUser?.role !== ROLES.clientBusinessUser ||
    currentUser.clientAccessScope !== CLIENT_ACCESS_SCOPES.own ||
    !currentUser.customerId ||
    !currentUser.clientUserId
  ) {
    res.status(403).json({
      error: currentUser?.role === ROLES.clientAdmin
        ? "customer admin accounts cannot create sample requests in this phase."
        : "forbidden"
    });
    return;
  }
  next();
};

export function createClientOrderRouter(orderService: OrderService, uploadSecurity: RequestHandler) {
  const router = Router();

  router.get("/orders", requireRoles(...CLIENT_ROLES), async (req, res) => {
    res.json(await orderService.listClientOrders(req.currentUser!, req.query));
  });

  router.post("/orders", requireRoles(...CLIENT_ROLES), requireOwnScopeClientUploader, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    const order = await orderService.createClientOrder(
      req.currentUser!,
      bodyWithUploadedAttachments(req)
    );
    res.status(201).json({ order });
  });

  router.post("/orders/quick-photo", requireRoles(...CLIENT_ROLES), requireOwnScopeClientUploader, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    const order = await orderService.createClientQuickPhotoOrder(
      req.currentUser!,
      bodyWithUploadedAttachments(req)
    );
    res.status(201).json({ order });
  });

  router.post("/orders/excel-import/preview", requireRoles(...CLIENT_ROLES), requireOwnScopeClientUploader, uploadSecurity, excelImportUploadMiddleware, async (req, res) => {
    res.json(await orderService.previewClientExcelImport(
      req.currentUser!,
      bodyWithUploadedAttachments(req)
    ));
  });

  router.post("/orders/excel-import/confirm", requireRoles(...CLIENT_ROLES), async (req, res) => {
    res.status(201).json(await orderService.confirmClientExcelImport(req.currentUser!, req.body));
  });

  router.get("/orders/:id/attachments", requireRoles(...CLIENT_ROLES), async (req, res) => {
    res.json({
      attachments: await orderService.listClientOrderAttachments(req.currentUser!, routeId(req.params.id))
    });
  });

  router.post("/orders/:id/attachments", requireRoles(...CLIENT_ROLES), uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    const attachments = await orderService.addClientOrderAttachments(
      req.currentUser!,
      routeId(req.params.id),
      attachmentPayloadFromRequest(req)
    );
    res.status(201).json({ attachments });
  });

  router.patch("/orders/:id/supplement", requireRoles(...CLIENT_ROLES), uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    const order = await orderService.supplementClientOrder(
      req.currentUser!,
      routeId(req.params.id),
      bodyWithUploadedAttachments(req)
    );
    res.json({ order });
  });

  router.get("/orders/:id/attachments/:attachmentId/download", requireRoles(...CLIENT_ROLES), async (req, res) => {
    sendAttachmentDownload(
      res,
      await orderService.downloadClientOrderAttachment(
        req.currentUser!,
        routeId(req.params.id),
        routeId(req.params.attachmentId)
      )
    );
  });

  router.delete("/orders/:id/attachments/:attachmentId", requireRoles(...CLIENT_ROLES), async (req, res) => {
    res.json({
      attachments: await orderService.deleteClientOrderAttachment(
        req.currentUser!,
        routeId(req.params.id),
        routeId(req.params.attachmentId)
      )
    });
  });

  router.get("/orders/:id/pattern-deliverables/:deliverableId/download", requireRoles(...CLIENT_ROLES), async (req, res) => {
    sendAttachmentDownload(
      res,
      await orderService.downloadClientPatternDeliverable(
        req.currentUser!,
        routeId(req.params.id),
        routeId(req.params.deliverableId)
      )
    );
  });

  return router;
}
