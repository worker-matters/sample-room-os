import { Router } from "express";
import { CLIENT_ROLES, ROLES } from "@sample-room/shared";
import { requireRoles } from "../auth/currentUser.js";
import type { PricingService } from "./pricingService.js";
import { withPricingQuantityActor } from "./pricingQuantityActorContext.js";
import type { ReconciliationStatementListOptions } from "./reconciliationStatementService.js";

function routeId(value: string | string[] | undefined) {
  if (typeof value !== "string") {
    throw new Error("route id is required");
  }

  return value;
}

function queryFlag(value: unknown) {
  return value === "true";
}

function queryText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function paymentStatus(value: unknown) {
  return value === "pending" || value === "paid" ? value : undefined;
}

function attachmentDisposition(fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createPricingRouter(pricingService: PricingService) {
  const router = Router();
  const bossOrSystemOwner = requireRoles(ROLES.boss, ROLES.systemOwner);

  router.get("/pricing/orders", bossOrSystemOwner, async (req, res) => {
    res.json({ rows: await pricingService.listPricingRows(req.currentUser!) });
  });

  router.get("/orders/:id/pricing", bossOrSystemOwner, async (req, res) => {
    res.json(await pricingService.getOrderPricing(routeId(req.params.id), req.currentUser!));
  });

  router.put("/orders/:id/pricing", bossOrSystemOwner, async (req, res) => {
    res.json(
      await pricingService.saveOrderPricing(routeId(req.params.id), req.body, req.currentUser!)
    );
  });

  router.post("/orders/:id/pricing/initialize", bossOrSystemOwner, async (req, res) => {
    res.json(
      await pricingService.initializeRecommendations(routeId(req.params.id), req.currentUser!)
    );
  });

  router.post("/orders/:id/pricing/internal-costs", bossOrSystemOwner, async (req, res) => {
    res.status(201).json(
      await pricingService.createInternalCost(routeId(req.params.id), req.body ?? {}, req.currentUser!)
    );
  });

  router.patch("/orders/:id/pricing/internal-costs/:itemId", bossOrSystemOwner, async (req, res) => {
    res.json(
      await pricingService.updateInternalCost(
        routeId(req.params.id),
        routeId(req.params.itemId),
        req.body ?? {},
        req.currentUser!
      )
    );
  });

  router.delete("/orders/:id/pricing/internal-costs/:itemId", bossOrSystemOwner, async (req, res) => {
    res.json(
      await pricingService.deleteInternalCost(
        routeId(req.params.id),
        routeId(req.params.itemId),
        req.currentUser!
      )
    );
  });

  router.post("/orders/:id/pricing/customer-charges", bossOrSystemOwner, async (req, res) => {
    res.status(201).json(
      await pricingService.createCustomerCharge(routeId(req.params.id), req.body ?? {}, req.currentUser!)
    );
  });

  router.patch("/orders/:id/pricing/customer-charges/:itemId", bossOrSystemOwner, async (req, res) => {
    res.json(
      await pricingService.updateCustomerCharge(
        routeId(req.params.id),
        routeId(req.params.itemId),
        req.body ?? {},
        req.currentUser!
      )
    );
  });

  router.delete("/orders/:id/pricing/customer-charges/:itemId", bossOrSystemOwner, async (req, res) => {
    res.json(
      await pricingService.deleteCustomerCharge(
        routeId(req.params.id),
        routeId(req.params.itemId),
        req.currentUser!
      )
    );
  });

  router.post("/orders/:id/pricing/confirm", bossOrSystemOwner, async (req, res) => {
    res.json(await withPricingQuantityActor(
      req.currentUser!,
      () => pricingService.confirmQuotation(routeId(req.params.id), req.currentUser!),
      "pricing_confirm"
    ));
  });

  router.post("/orders/:id/pricing/begin-update", bossOrSystemOwner, async (req, res) => {
    res.json(await pricingService.beginQuotationUpdate(routeId(req.params.id), req.currentUser!));
  });

  router.get("/reconciliation-statements", bossOrSystemOwner, async (req, res) => {
    const options: ReconciliationStatementListOptions = {
      includeReturned: queryFlag(req.query.includeReturned)
    };
    const q = queryText(req.query.q);
    const customerId = queryText(req.query.customerId);
    const customerBusinessUserId = queryText(req.query.customerBusinessUserId);
    const status = paymentStatus(req.query.paymentStatus);
    const dateFrom = queryText(req.query.dateFrom);
    const dateTo = queryText(req.query.dateTo);

    if (q) {
      options.q = q;
    }
    if (customerId) {
      options.customerId = customerId;
    }
    if (customerBusinessUserId) {
      options.customerBusinessUserId = customerBusinessUserId;
    }
    if (status) {
      options.paymentStatus = status;
    }
    if (dateFrom) {
      options.dateFrom = dateFrom;
    }
    if (dateTo) {
      options.dateTo = dateTo;
    }

    res.json(await pricingService.listReconciliationStatements(req.currentUser!, options));
  });

  router.post("/reconciliation-statements", bossOrSystemOwner, async (req, res) => {
    res.status(201).json(await withPricingQuantityActor(
      req.currentUser!,
      () => pricingService.createReconciliationStatement(req.body, req.currentUser!),
      "statement_create"
    ));
  });

  router.post("/reconciliation-statements/bulk-download", bossOrSystemOwner, async (req, res) => {
    const download = await pricingService.downloadReconciliationStatements(req.body, req.currentUser!);
    res.setHeader("content-type", download.contentType);
    res.setHeader("content-disposition", attachmentDisposition(download.fileName));
    res.send(download.content);
  });

  router.post("/reconciliation-statements/:id/return", bossOrSystemOwner, async (req, res) => {
    res.json(await withPricingQuantityActor(
      req.currentUser!,
      () => pricingService.returnReconciliationStatement(routeId(req.params.id), req.currentUser!),
      "statement_return"
    ));
  });

  router.post("/reconciliation-statements/:id/mark-paid", bossOrSystemOwner, async (req, res) => {
    res.json(
      await pricingService.markReconciliationStatementPaid(routeId(req.params.id), req.currentUser!)
    );
  });

  router.post("/reconciliation-statements/:id/undo-paid", bossOrSystemOwner, async (req, res) => {
    res.json(
      await pricingService.undoReconciliationStatementPaid(routeId(req.params.id), req.currentUser!)
    );
  });

  router.post("/reconciliation-statements/:id/items/:itemId/return", bossOrSystemOwner, async (req, res) => {
    res.json(await withPricingQuantityActor(
      req.currentUser!,
      () => pricingService.returnReconciliationStatementItem(
        routeId(req.params.id),
        routeId(req.params.itemId),
        req.currentUser!
      ),
      "statement_return"
    ));
  });

  return router;
}

export function createClientQuotationRouter(pricingService: PricingService) {
  const router = Router();
  router.get("/orders/:id/quotation", requireRoles(...CLIENT_ROLES), async (req, res) => {
    res.json(await pricingService.getClientQuotation(routeId(req.params.id), req.currentUser!));
  });

  return router;
}
