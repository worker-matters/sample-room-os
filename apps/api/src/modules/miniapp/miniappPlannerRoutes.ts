import { ACCOUNT_CLIENT_TYPES } from "@sample-room/shared";
import { Router, type Request, type RequestHandler, type Response } from "express";
import {
  attachmentPayloadFromRequest,
  attachmentUploadMiddleware,
  safeAttachmentPreviewMime,
  sendAttachmentDownload
} from "../files/attachmentRouteUtils.js";
import type { PlannerService } from "../planner/plannerService.js";
import type { PlannerOrderDto } from "../planner/plannerTypes.js";
import type { OrderChargeService } from "../pricing/orderChargeService.js";
import type { MiniappIdentityService } from "./miniappIdentityService.js";
import {
  attachmentForMiniapp,
  chargeForMiniapp,
  createMiniappIdentityMiddleware,
  miniappCurrentUser,
  miniappOrderScanToken,
  miniappRouteId
} from "./miniappRouteUtils.js";

function plannerOrderForMiniapp(order: PlannerOrderDto, currentUser: Awaited<ReturnType<MiniappIdentityService["resolvePlannerCurrentUser"]>>) {
  const thumbnail = order.attachments.find(
    (attachment) => attachment.category === "style_thumbnail" && attachment.mimeType.startsWith("image/") && attachment.hasFile
  ) ?? order.attachments.find(
    (attachment) => attachment.mimeType.startsWith("image/") && attachment.hasFile
  );
  return {
    ...order,
    attachments: order.attachments.map((attachment) =>
      attachmentForMiniapp(attachment, currentUser)
    ),
    ...(thumbnail ? { thumbnailAttachmentId: thumbnail.id } : {})
  };
}

const plannerUser = (req: Request) => miniappCurrentUser(req);

export function createMiniappPlannerRouter(
  identityService: MiniappIdentityService,
  plannerService: PlannerService,
  orderChargeService: OrderChargeService,
  uploadSecurity: RequestHandler
) {
  const router = Router();
  router.use(
    createMiniappIdentityMiddleware((token) =>
      identityService.resolvePlannerCurrentUser(token)
    )
  );

  router.get("/orders", async (req, res) => {
    const currentUser = plannerUser(req);
    const orders = await plannerService.listOrders(currentUser);
    const visibleOrders = currentUser.sessionClientType === ACCOUNT_CLIENT_TYPES.android
      ? orders.filter((order) => !order.terminated)
      : orders;
    res.json({
      orders: visibleOrders.map((order) => plannerOrderForMiniapp(order, currentUser))
    });
  });

  router.get("/orders/:id/charges", async (req, res) => {
    const currentUser = plannerUser(req);
    const orderId = miniappRouteId(req.params.id);
    await plannerService.listOrderAttachments(orderId, currentUser);
    const summary = await orderChargeService.summary(orderId, currentUser);
    res.json({
      chargeLocked: summary.chargeLocked,
      charges: summary.charges
        .map((charge) => chargeForMiniapp(charge, currentUser))
    });
  });

  router.post("/orders/:id/charges", async (req, res) => {
    const currentUser = plannerUser(req);
    const orderId = miniappRouteId(req.params.id);
    await plannerService.listOrderAttachments(orderId, currentUser);
    res.status(201).json({
      charge: chargeForMiniapp(
        await orderChargeService.create(
          orderId,
          req.body?.charge ?? {},
          currentUser
        ),
        currentUser
      )
    });
  });

  router.get("/orders/:id/attachments/:attachmentId/download", async (req, res) => {
    const currentUser = plannerUser(req);
    sendAttachmentDownload(
      res,
      await plannerService.downloadOrderAttachment(
        miniappRouteId(req.params.id),
        miniappRouteId(req.params.attachmentId),
        currentUser
      )
    );
  });

  router.get("/orders/:id/attachments/:attachmentId/preview", async (req, res) => {
    const currentUser = plannerUser(req);
    const preview = await plannerService.downloadOrderAttachment(
      miniappRouteId(req.params.id),
      miniappRouteId(req.params.attachmentId),
      currentUser
    );
    const safeMime = safeAttachmentPreviewMime(preview.content);
    if (!safeMime || (!safeMime.startsWith("image/") && safeMime !== "application/pdf")) {
      res.status(415).json({ error: "attachment_preview_not_supported" });
      return;
    }
    res.setHeader("Content-Type", safeMime);
    res.setHeader("Content-Length", preview.content.length.toString());
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", "inline");
    res.send(preview.content);
  });

  router.get("/orders/:id/attachments", async (req, res) => {
    const currentUser = plannerUser(req);
    res.json({
      attachments: (
        await plannerService.listOrderAttachments(
          miniappRouteId(req.params.id),
          currentUser
        )
      ).map((attachment) => attachmentForMiniapp(attachment, currentUser))
    });
  });

  router.get("/orders/:id/pattern-deliverables/:deliverableId/download", async (req, res) => {
    const currentUser = plannerUser(req);
    sendAttachmentDownload(
      res,
      await plannerService.downloadPatternDeliverable(
        miniappRouteId(req.params.id),
        miniappRouteId(req.params.deliverableId),
        currentUser
      )
    );
  });

  router.post("/orders/:id/attachments", uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    const currentUser = plannerUser(req);
    res.status(201).json({
      attachments: (
        await plannerService.addOrderAttachments(
          miniappRouteId(req.params.id),
          attachmentPayloadFromRequest(req),
          currentUser
        )
      ).map((attachment) => attachmentForMiniapp(attachment, currentUser))
    });
  });

  const renameOrderAttachment = async (req: Request, res: Response) => {
    const currentUser = plannerUser(req);
    res.json({
      attachments: (
        await plannerService.renameOrderAttachment(
          miniappRouteId(req.params.id),
          miniappRouteId(req.params.attachmentId),
          req.body ?? {},
          currentUser
        )
      ).map((attachment) => attachmentForMiniapp(attachment, currentUser))
    });
  };
  router.patch("/orders/:id/attachments/:attachmentId/display-name", renameOrderAttachment);
  router.post("/orders/:id/attachments/:attachmentId/display-name", renameOrderAttachment);

  router.post("/orders/:id/attachments/:attachmentId/visibility", async (req, res) => {
    const currentUser = plannerUser(req);
    res.json({
      attachments: (
        await plannerService.changeOrderAttachmentVisibility(
          miniappRouteId(req.params.id),
          miniappRouteId(req.params.attachmentId),
          req.body ?? {},
          currentUser
        )
      ).map((attachment) => attachmentForMiniapp(attachment, currentUser))
    });
  });

  router.delete("/orders/:id/attachments/:attachmentId", async (req, res) => {
    const currentUser = plannerUser(req);
    res.json({
      attachments: (
        await plannerService.deleteOrderAttachment(
          miniappRouteId(req.params.id),
          miniappRouteId(req.params.attachmentId),
          currentUser
        )
      ).map((attachment) => attachmentForMiniapp(attachment, currentUser))
    });
  });

  router.post("/scan-charge/resolve", async (req, res) => {
    const currentUser = plannerUser(req);
    const summary = await orderChargeService.scanSummary(
      miniappOrderScanToken(req.body?.token),
      currentUser
    );
    res.json({
      order: summary.order,
      chargeLocked: summary.chargeLocked,
      charges: summary.charges.map((charge) => chargeForMiniapp(charge, currentUser))
    });
  });

  router.post("/scan-charge/charges", async (req, res) => {
    const currentUser = plannerUser(req);
    const result = await orderChargeService.createFromScanToken(
      miniappOrderScanToken(req.body?.token),
      req.body?.charge ?? {},
      currentUser
    );
    res.status(201).json({
      orderId: result.orderId,
      charge: chargeForMiniapp(result.charge, currentUser)
    });
  });

  router.post(
    "/orders/:id/charges/:chargeId/attachments",
    uploadSecurity,
    attachmentUploadMiddleware,
    async (req, res) => {
      const currentUser = plannerUser(req);
      const charge = await orderChargeService.addAttachments(
        miniappRouteId(req.params.id),
        miniappRouteId(req.params.chargeId),
        attachmentPayloadFromRequest(req),
        currentUser
      );
      res.status(201).json({ charge: chargeForMiniapp(charge, currentUser) });
    }
  );

  router.delete("/orders/:id/charges/:chargeId/attachments/:attachmentId", async (req, res) => {
    const currentUser = plannerUser(req);
    const charge = await orderChargeService.deleteAttachment(
      miniappRouteId(req.params.id),
      miniappRouteId(req.params.chargeId),
      miniappRouteId(req.params.attachmentId),
      currentUser
    );
    res.json({ charge: chargeForMiniapp(charge, currentUser) });
  });

  router.patch(
    "/orders/:id/charges/:chargeId/attachments/:attachmentId/display-name",
    async (req, res) => {
      const currentUser = plannerUser(req);
      const charge = await orderChargeService.renameAttachment(
        miniappRouteId(req.params.id),
        miniappRouteId(req.params.chargeId),
        miniappRouteId(req.params.attachmentId),
        req.body ?? {},
        currentUser
      );
      res.json({ charge: chargeForMiniapp(charge, currentUser) });
    }
  );

  router.get(
    "/orders/:id/charges/:chargeId/attachments/:attachmentId/preview",
    async (req, res) => {
      const currentUser = plannerUser(req);
      const preview = await orderChargeService.downloadAttachment(
        miniappRouteId(req.params.id),
        miniappRouteId(req.params.chargeId),
        miniappRouteId(req.params.attachmentId),
        currentUser
      );
      const safeMime = safeAttachmentPreviewMime(preview.content);
      if (!safeMime || (!safeMime.startsWith("image/") && safeMime !== "application/pdf")) {
        res.status(415).json({ error: "attachment_preview_not_supported" });
        return;
      }
      res.setHeader("Content-Type", safeMime);
      res.setHeader("Content-Length", preview.content.length.toString());
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", "inline");
      res.send(preview.content);
    }
  );

  router.post("/orders/:id/charges/:chargeId/display-name", async (req, res) => {
    const currentUser = plannerUser(req);
    const charge = await orderChargeService.update(
      miniappRouteId(req.params.id),
      miniappRouteId(req.params.chargeId),
      { name: req.body?.name, amount: req.body?.amount, explanation: req.body?.explanation },
      currentUser
    );
    res.json({ charge: chargeForMiniapp(charge, currentUser) });
  });

  router.post("/orders/:id/charges/:chargeId/void", async (req, res) => {
    const currentUser = plannerUser(req);
    const charge = await orderChargeService.void(
      miniappRouteId(req.params.id),
      miniappRouteId(req.params.chargeId),
      {},
      currentUser
    );
    res.json({ charge: chargeForMiniapp(charge, currentUser) });
  });

  return router;
}
