import { Router, type Request, type RequestHandler } from "express";
import {
  CLIENT_ACCESS_SCOPES,
  ROLES,
  isSampleRequestItemComplete,
  sampleRequestItemOptions
} from "@sample-room/shared";
import type { BusinessUserRequestService } from "../accounts/businessUserRequestService.js";
import {
  attachmentPayloadFromRequest,
  attachmentUploadMiddleware,
  bodyWithUploadedAttachments,
  sendAttachmentDownload
} from "../files/attachmentRouteUtils.js";
import type { ClientOrderDto } from "../orders/orderTypes.js";
import type { OrderService } from "../orders/orderService.js";
import type { PricingService } from "../pricing/pricingService.js";
import type { MiniappIdentityService } from "./miniappIdentityService.js";
import {
  createMiniappIdentityMiddleware,
  miniappCurrentUser,
  miniappRouteId
} from "./miniappRouteUtils.js";

const taskLabels = new Map(sampleRequestItemOptions.map((option) => [option.value, option.label]));

function clientOrderForMiniapp(
  order: ClientOrderDto,
  quotation: Awaited<ReturnType<PricingService["getClientQuotation"]>>["quotation"]
) {
  const thumbnail = order.attachments.find(
    (attachment) => attachment.mimeType.startsWith("image/") && attachment.hasFile
  );
  return {
    id: order.id,
    orderNo: order.orderNo,
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
    ...(order.returnReason ? { returnReason: order.returnReason } : {}),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    orderTasks: order.sampleRequestItems.map((item) => ({
      item,
      label: taskLabels.get(item) ?? item,
      completed: isSampleRequestItemComplete({
        item,
        orderStage: order.stage,
        completedPatternRequirements: order.patternTask?.completedRequirements ?? []
      })
    })),
    attachments: order.attachments,
    ...(thumbnail ? { thumbnailAttachmentId: thumbnail.id } : {}),
    ...(order.patternTask?.deliverables.length
      ? { patternDeliverables: order.patternTask.deliverables }
      : {}),
    quotation
  };
}

const clientUser = (req: Request) => miniappCurrentUser(req);

const requireClientUploader: RequestHandler = (req, res, next) => {
  const currentUser = clientUser(req);
  if (
    currentUser.role !== ROLES.clientBusinessUser ||
    currentUser.clientAccessScope !== CLIENT_ACCESS_SCOPES.own ||
    !currentUser.customerId ||
    !currentUser.clientUserId
  ) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
};

export function createMiniappClientRouter(
  identityService: MiniappIdentityService,
  orderService: OrderService,
  pricingService: PricingService,
  businessUserRequestService: BusinessUserRequestService,
  uploadSecurity: RequestHandler
) {
  const router = Router();
  router.use(
    createMiniappIdentityMiddleware((token) =>
      identityService.resolveClientCurrentUser(token)
    )
  );

  router.get("/orders", async (req, res) => {
    const currentUser = clientUser(req);
    const result = await orderService.listClientOrders(currentUser, req.query);
    res.json({
      clientAccessScope: result.clientAccessScope,
      clientUsers: result.clientUsers,
      orders: await Promise.all(result.orders.map(async (order) => {
        const { quotation } = await pricingService.getClientQuotation(order.id, currentUser);
        return clientOrderForMiniapp(order, quotation);
      }))
    });
  });

  router.get("/orders/:id/attachments/:attachmentId/download", async (req, res) => {
    const currentUser = clientUser(req);
    sendAttachmentDownload(
      res,
      await orderService.downloadClientOrderAttachment(
        currentUser,
        miniappRouteId(req.params.id),
        miniappRouteId(req.params.attachmentId)
      )
    );
  });

  router.get("/orders/:id/pattern-deliverables/:deliverableId/download", async (req, res) => {
    const currentUser = clientUser(req);
    sendAttachmentDownload(
      res,
      await orderService.downloadClientPatternDeliverable(
        currentUser,
        miniappRouteId(req.params.id),
        miniappRouteId(req.params.deliverableId)
      )
    );
  });

  router.post("/orders/quick-photo", requireClientUploader, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    const currentUser = clientUser(req);
    const order = await orderService.createClientQuickPhotoOrder(
      currentUser,
      bodyWithUploadedAttachments(req)
    );
    res.status(201).json({ order: clientOrderForMiniapp(order, null) });
  });

  router.post("/orders/:id/supplement", requireClientUploader, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    const currentUser = clientUser(req);
    const order = await orderService.supplementClientOrder(
      currentUser,
      miniappRouteId(req.params.id),
      bodyWithUploadedAttachments(req)
    );
    const { quotation } = await pricingService.getClientQuotation(order.id, currentUser);
    res.json({ order: clientOrderForMiniapp(order, quotation) });
  });

  router.post("/orders/:id/attachments", requireClientUploader, uploadSecurity, attachmentUploadMiddleware, async (req, res) => {
    const currentUser = clientUser(req);
    res.status(201).json({
      attachments: await orderService.addClientOrderAttachments(
        currentUser,
        miniappRouteId(req.params.id),
        attachmentPayloadFromRequest(req)
      )
    });
  });

  router.get("/business-user-registration", async (req, res) => {
    const currentUser = clientUser(req);
    res.json({
      registration: await businessUserRequestService.getClientBusinessUserRegistrationCode(currentUser),
      requests: await businessUserRequestService.listClientRequests(currentUser)
    });
  });

  router.post("/business-user-registration/open", async (req, res) => {
    const currentUser = clientUser(req);
    res.json({
      registration: await businessUserRequestService.openClientBusinessUserRegistrationCode(currentUser)
    });
  });

  router.post("/business-user-registration/close", async (req, res) => {
    const currentUser = clientUser(req);
    res.json({
      registration: await businessUserRequestService.closeClientBusinessUserRegistrationCode(currentUser)
    });
  });

  return router;
}
