import { Router, type Request, type RequestHandler } from "express";
import { ROLES } from "@sample-room/shared";
import { HttpError } from "../../shared/errors/httpError.js";
import {
  attachmentPayloadFromRequest,
  attachmentUploadMiddleware,
  safeAttachmentPreviewMime,
  sendAttachmentDownload
} from "../files/attachmentRouteUtils.js";
import type { QcTabletService } from "./qcTabletService.js";

function routeId(value: string | string[] | undefined) {
  if (typeof value !== "string" || !value) throw new Error("route id is required");
  return value;
}

function queryText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function filters(req: Request) {
  return {
    ...(queryText(req.query.q) ? { q: queryText(req.query.q) } : {}),
    ...(queryText(req.query.customerId) ? { customerId: queryText(req.query.customerId) } : {}),
    ...(queryText(req.query.clientUserId) ? { clientUserId: queryText(req.query.clientUserId) } : {}),
    ...(queryText(req.query.dateFrom) ? { dateFrom: queryText(req.query.dateFrom) } : {}),
    ...(queryText(req.query.dateTo) ? { dateTo: queryText(req.query.dateTo) } : {})
  };
}

export const requireQcDeliveryWorker: RequestHandler = (req, _res, next) => {
  const currentUser = req.currentUser;
  if (
    currentUser?.role !== ROLES.worker ||
    currentUser.accountType !== "worker" ||
    currentUser.activeWorkerType !== "qc_delivery" ||
    !currentUser.activeWorkerProfileId
  ) {
    next(new HttpError(403, "QC_DELIVERY_WORKER_REQUIRED"));
    return;
  }
  next();
};

export function createQcTabletRouter(service: QcTabletService, uploadSecurity: RequestHandler) {
  const router = Router();

  router.get("/me/rework-orders", requireQcDeliveryWorker, async (req, res) => {
    res.json(await service.listReworkOrders(filters(req), req.currentUser!));
  });

  router.get("/me/completed-orders", requireQcDeliveryWorker, async (req, res) => {
    res.json(await service.listCompletedOrders(filters(req), req.currentUser!));
  });

  router.get("/me/orders/:orderId", requireQcDeliveryWorker, async (req, res) => {
    res.json({ order: await service.getOrder(routeId(req.params.orderId), req.currentUser!) });
  });

  router.get("/me/orders/:orderId/thumbnail", requireQcDeliveryWorker, async (req, res) => {
    const thumbnail = await service.thumbnail(routeId(req.params.orderId), req.currentUser!);
    const safeMime = safeAttachmentPreviewMime(thumbnail.content);
    if (!safeMime?.startsWith("image/")) {
      res.status(404).json({ error: "thumbnail not found." });
      return;
    }
    res.setHeader("Content-Type", safeMime);
    res.setHeader("Content-Length", thumbnail.content.length.toString());
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(thumbnail.content);
  });

  router.post(
    "/me/orders/:orderId/reinspect",
    requireQcDeliveryWorker,
    uploadSecurity,
    attachmentUploadMiddleware,
    async (req, res) => {
      res.json({
        state: await service.reinspect(
          routeId(req.params.orderId),
          attachmentPayloadFromRequest(req),
          req.currentUser!
        )
      });
    }
  );

  router.post(
    "/me/orders/:orderId/photos",
    requireQcDeliveryWorker,
    uploadSecurity,
    attachmentUploadMiddleware,
    async (req, res) => {
      res.status(201).json({
        attachments: await service.addPhotos(
          routeId(req.params.orderId),
          attachmentPayloadFromRequest(req),
          req.currentUser!
        )
      });
    }
  );

  router.patch("/me/orders/:orderId/photos/:attachmentId", requireQcDeliveryWorker, async (req, res) => {
    res.json({
      attachments: await service.updatePhoto(
        routeId(req.params.orderId),
        routeId(req.params.attachmentId),
        req.body ?? {},
        req.currentUser!
      )
    });
  });

  router.delete("/me/orders/:orderId/photos/:attachmentId", requireQcDeliveryWorker, async (req, res) => {
    res.json({
      attachments: await service.deletePhoto(
        routeId(req.params.orderId),
        routeId(req.params.attachmentId),
        req.currentUser!
      )
    });
  });

  router.get("/me/orders/:orderId/photos/:attachmentId/download", requireQcDeliveryWorker, async (req, res) => {
    sendAttachmentDownload(
      res,
      await service.downloadPhoto(
        routeId(req.params.orderId),
        routeId(req.params.attachmentId),
        req.currentUser!
      )
    );
  });

  router.get("/me/performance", requireQcDeliveryWorker, async (req, res) => {
    res.json(await service.ownPerformance(filters(req), req.currentUser!));
  });

  return router;
}
