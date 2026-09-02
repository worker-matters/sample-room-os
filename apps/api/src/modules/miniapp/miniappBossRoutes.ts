import { Router, type Request, type RequestHandler } from "express";
import type { OrderChargeService } from "../pricing/orderChargeService.js";
import { createAdminOrderChargeRouter } from "../pricing/orderChargeRoutes.js";
import type { PricingService } from "../pricing/pricingService.js";
import { createPricingRouter } from "../pricing/pricingRoutes.js";
import type { MiniappIdentityService } from "./miniappIdentityService.js";
import { miniappSessionToken } from "./miniappSession.js";

function routeId(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new Error("route id is required");
  }
  return value;
}

function attachmentDisposition(fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createMiniappBossRouter(
  identityService: MiniappIdentityService,
  pricingService: PricingService,
  orderChargeService: OrderChargeService,
  uploadSecurity: RequestHandler
) {
  const router = Router();

  router.use(async (req: Request, _res, next) => {
    req.currentUser = await identityService.resolveBossCurrentUser(miniappSessionToken(req));
    next();
  });

  // WeChat's request API does not support PATCH. These explicit POST aliases
  // reuse the same service validation and permission checks as the Web routes.
  router.post("/orders/:id/pricing/internal-costs/:itemId/update", async (req, res) => {
    res.json(
      await pricingService.updateInternalCost(
        routeId(req.params.id),
        routeId(req.params.itemId),
        req.body ?? {},
        req.currentUser!
      )
    );
  });
  router.post("/orders/:id/pricing/customer-charges/:itemId/update", async (req, res) => {
    res.json(
      await pricingService.updateCustomerCharge(
        routeId(req.params.id),
        routeId(req.params.itemId),
        req.body ?? {},
        req.currentUser!
      )
    );
  });
  router.get("/reconciliation-statements/:id/download", async (req, res) => {
    const download = await pricingService.downloadReconciliationStatements(
      { statementIds: [routeId(req.params.id)] },
      req.currentUser!
    );
    res.setHeader("content-type", download.contentType);
    res.setHeader("content-disposition", attachmentDisposition(download.fileName));
    res.send(download.content);
  });

  router.use(createPricingRouter(pricingService));
  router.use(createAdminOrderChargeRouter(orderChargeService, uploadSecurity));

  return router;
}
