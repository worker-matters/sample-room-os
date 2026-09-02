import { Router, type Request, type RequestHandler, type Response } from "express";
import { HttpError } from "../../shared/errors/httpError.js";
import {
  attachmentPayloadFromRequest,
  attachmentUploadMiddleware,
  bodyWithUploadedAttachments,
  sendAttachmentDownload,
  safeAttachmentPreviewMime
} from "../files/attachmentRouteUtils.js";
import type { ReceiverOrderDto } from "../orders/orderTypes.js";
import type { OrderChargeService } from "../pricing/orderChargeService.js";
import type { ReceiverService } from "../receiver/receiverService.js";
import { actionLabel, productionStageLabels } from "../scan/scanWorkflow.js";
import type { ScanRecord } from "../scan/scanTypes.js";
import type { MiniappIdentityService } from "./miniappIdentityService.js";
import {
  attachmentForMiniapp,
  chargeForMiniapp,
  createMiniappIdentityMiddleware,
  miniappCurrentUser,
  miniappOrderScanToken,
  miniappRouteId
} from "./miniappRouteUtils.js";

function receiverScanRecordForMiniapp(record: ScanRecord) {
  return {
    id: record.id,
    stage: record.stage,
    stageLabel: productionStageLabels[record.stage],
    action: record.action,
    actionLabel: record.action === "termination_complete" ? "终止完成" : actionLabel(record.scanAction),
    workerName: record.workerName,
    eventTime: record.eventTime,
    ...(record.workHours !== undefined ? { workHours: record.workHours } : {}),
    ...(record.pieces !== undefined ? { pieces: record.pieces } : {}),
    ...(record.qualityResult ? { qualityResult: record.qualityResult } : {}),
    ...(record.note ? { note: record.note } : {})
  };
}

function receiverOrderForMiniapp(order: ReceiverOrderDto, scanRecords: ScanRecord[]) {
  const thumbnail = order.attachments.find(
    (attachment) => attachment.category === "style_thumbnail" && attachment.mimeType.startsWith("image/") && attachment.hasFile
  ) ?? order.attachments.find(
    (attachment) => attachment.mimeType.startsWith("image/") && attachment.hasFile
  );
  return {
    id: order.id,
    orderNo: order.orderNo,
    customerId: order.customerId,
    customerName: order.customerName,
    salespersonId: order.salespersonId,
    salespersonName: order.salespersonName,
    styleNo: order.styleNo,
    styleName: order.styleName,
    quantity: order.quantity,
    sampleType: order.sampleType,
    sampleRound: order.sampleRound,
    deliveryDate: order.deliveryDate,
    ...(order.remark ? { remark: order.remark } : {}),
    intakeStatus: order.intakeStatus,
    stage: order.stage,
    patternStatus: order.patternStatus,
    fabricStatus: order.fabricStatus,
    trimStatus: order.trimStatus,
    sampleRequestItems: order.sampleRequestItems,
    createdAt: order.createdAt,
    completionStatus: order.completionStatus,
    ...(thumbnail ? { thumbnailAttachmentId: thumbnail.id } : {}),
    ...(order.patternTask
      ? {
          patternTask: {
            status: order.patternTask.status,
            ...(order.patternTask.patternMakerName ? { patternMakerName: order.patternTask.patternMakerName } : {}),
            requirements: order.patternTask.requirements,
            completedRequirements: order.patternTask.completedRequirements,
            ...(order.patternTask.deliverables?.length
              ? {
                  deliverables: order.patternTask.deliverables.map((deliverable) => ({
                    id: deliverable.id,
                    version: deliverable.version,
                    type: deliverable.type,
                    ...(deliverable.fileName ? { fileName: deliverable.fileName } : {}),
                    ...(deliverable.uploadedByName ? { uploadedByName: deliverable.uploadedByName } : {}),
                    createdAt: deliverable.createdAt
                  }))
                }
              : {})
          }
        }
      : {}),
    scanRecords: scanRecords.map(receiverScanRecordForMiniapp)
  };
}

const receiverUser = (req: Request) => miniappCurrentUser(req);

export function createMiniappReceiverRouter(
  identityService: MiniappIdentityService,
  receiverService: ReceiverService,
  orderChargeService: OrderChargeService,
  uploadSecurity: RequestHandler
) {
  const router = Router();
  router.use(
    createMiniappIdentityMiddleware((token) =>
      identityService.resolveReceiverCurrentUser(token)
    )
  );

  router.get("/orders", async (req, res) => {
    const currentUser = receiverUser(req);
    const orders = await receiverService.listOrders();
    res.json({
      orders: await Promise.all(
        orders
          .filter((order) => order.intakeStatus === "received")
          .map(async (order) => receiverOrderForMiniapp(
            order,
            await receiverService.listOrderScanRecords(order.id, currentUser)
          ))
      )
    });
  });

  router.get("/orders/:id/attachments/:attachmentId/download", async (req, res) => {
    const currentUser = receiverUser(req);
    sendAttachmentDownload(
      res,
      await receiverService.downloadOrderAttachment(
        miniappRouteId(req.params.id),
        miniappRouteId(req.params.attachmentId),
        currentUser
      )
    );
  });

  router.get("/orders/:id/attachments", async (req, res) => {
    const currentUser = receiverUser(req);
    res.json({
      attachments: (
        await receiverService.listOrderAttachments(
          miniappRouteId(req.params.id),
          currentUser
        )
      ).map((attachment) => attachmentForMiniapp(attachment, currentUser))
    });
  });

  router.get("/orders/:id/charges", async (req, res) => {
    const currentUser = receiverUser(req);
    res.json({
      charges: (await orderChargeService.list(miniappRouteId(req.params.id), currentUser))
        .map((charge) => chargeForMiniapp(charge, currentUser))
    });
  });

  router.get("/self-entry-options", async (req, res) => {
    receiverUser(req);
    res.json(await receiverService.listSelfEntryOptions());
  });

  router.post("/intake", uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    const currentUser = receiverUser(req);
    const order = await receiverService.createSelfEntry(
      bodyWithUploadedAttachments(req),
      currentUser
    );
    const fullOrder = (await receiverService.listOrders()).find((item) => item.id === order.id);
    if (!fullOrder) throw new HttpError(500, "created_order_not_found");
    res.status(201).json({
      order: receiverOrderForMiniapp(
        fullOrder,
        await receiverService.listOrderScanRecords(fullOrder.id, currentUser)
      )
    });
  });

  router.post("/quick-photo", uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    const currentUser = receiverUser(req);
    const order = await receiverService.createQuickPhotoEntry(
      bodyWithUploadedAttachments(req),
      currentUser
    );
    res.status(201).json({
      order: receiverOrderForMiniapp(
        order,
        await receiverService.listOrderScanRecords(order.id, currentUser)
      )
    });
  });

  router.post("/orders/:id/attachments", uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    const currentUser = receiverUser(req);
    res.status(201).json({
      attachments: (
        await receiverService.addOrderAttachments(
          miniappRouteId(req.params.id),
          attachmentPayloadFromRequest(req),
          currentUser
        )
      ).map((attachment) => attachmentForMiniapp(attachment, currentUser))
    });
  });

  const renameOrderAttachment = async (req: Request, res: Response) => {
    const currentUser = receiverUser(req);
    res.json({
      attachments: (
        await receiverService.renameOrderAttachment(
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
    const currentUser = receiverUser(req);
    res.json({
      attachments: (
        await receiverService.changeOrderAttachmentVisibility(
          miniappRouteId(req.params.id),
          miniappRouteId(req.params.attachmentId),
          req.body ?? {},
          currentUser
        )
      ).map((attachment) => attachmentForMiniapp(attachment, currentUser))
    });
  });

  router.delete("/orders/:id/attachments/:attachmentId", async (req, res) => {
    const currentUser = receiverUser(req);
    res.json({
      attachments: (
        await receiverService.deleteOrderAttachment(
          miniappRouteId(req.params.id),
          miniappRouteId(req.params.attachmentId),
          currentUser
        )
      ).map((attachment) => attachmentForMiniapp(attachment, currentUser))
    });
  });

  router.post("/scan-charge/resolve", async (req, res) => {
    const currentUser = receiverUser(req);
    const summary = await orderChargeService.scanSummary(miniappOrderScanToken(req.body?.token), currentUser);
    res.json({
      order: summary.order,
      chargeLocked: summary.chargeLocked,
      charges: summary.charges.map((charge) => chargeForMiniapp(charge, currentUser))
    });
  });

  router.post("/scan-charge/charges", async (req, res) => {
    const currentUser = receiverUser(req);
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
      const currentUser = receiverUser(req);
      const charge = await orderChargeService.addAttachments(
        miniappRouteId(req.params.id),
        miniappRouteId(req.params.chargeId),
        attachmentPayloadFromRequest(req),
        currentUser
      );
      res.status(201).json({ charge: chargeForMiniapp(charge, currentUser) });
    }
  );

  router.patch(
    "/orders/:id/charges/:chargeId/attachments/:attachmentId/display-name",
    async (req, res) => {
      const currentUser = receiverUser(req);
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
      const currentUser = receiverUser(req);
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

  router.delete("/orders/:id/charges/:chargeId/attachments/:attachmentId", async (req, res) => {
    const currentUser = receiverUser(req);
    const charge = await orderChargeService.deleteAttachment(
      miniappRouteId(req.params.id),
      miniappRouteId(req.params.chargeId),
      miniappRouteId(req.params.attachmentId),
      currentUser
    );
    res.json({ charge: chargeForMiniapp(charge, currentUser) });
  });

  router.post("/orders/:id/charges/:chargeId/display-name", async (req, res) => {
    const currentUser = receiverUser(req);
    const charge = await orderChargeService.update(
      miniappRouteId(req.params.id),
      miniappRouteId(req.params.chargeId),
      { name: req.body?.name, amount: req.body?.amount, explanation: req.body?.explanation },
      currentUser
    );
    res.json({ charge: chargeForMiniapp(charge, currentUser) });
  });

  router.post("/orders/:id/charges/:chargeId/void", async (req, res) => {
    const currentUser = receiverUser(req);
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
