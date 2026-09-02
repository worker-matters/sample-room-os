import { Router, type RequestHandler } from "express";
import type { MiniappIdentityService } from "./miniappIdentityService.js";
import type { ScanResolveService } from "../scan/scanResolveService.js";
import { HttpError } from "../../shared/errors/httpError.js";
import { miniappSessionToken } from "./miniappSession.js";
import { createMiniappReceiverRouter } from "./miniappReceiverRoutes.js";
import { createMiniappPlannerRouter } from "./miniappPlannerRoutes.js";
import type { ReceiverService } from "../receiver/receiverService.js";
import type { PlannerService } from "../planner/plannerService.js";
import type { OrderChargeService } from "../pricing/orderChargeService.js";
import type { OrderService } from "../orders/orderService.js";
import type { PricingService } from "../pricing/pricingService.js";
import type { BusinessUserRequestService } from "../accounts/businessUserRequestService.js";
import { createMiniappClientRouter } from "./miniappClientRoutes.js";
import type { MiniappDevelopmentPersonaService } from "./miniappDevelopmentPersonaService.js";
import type { PerformanceService } from "../pricing/performanceService.js";
import { createMiniappBossRouter } from "./miniappBossRoutes.js";
import { createMiniappPersonalRouter } from "./miniappPersonalRoutes.js";
import type { LoginProtectionService } from "../auth/loginProtectionService.js";
import type { ScanWorkflowService } from "../scan/scanService.js";
import type { RuntimeEndpointConfigService } from "../system-owner/runtimeEndpointConfigService.js";

const routeId = (value: string | string[] | undefined) => {
  if (typeof value !== "string") throw new Error("route id is required");
  return value;
};

export function createMiniappRouter(
  service: MiniappIdentityService,
  scanResolveService: ScanResolveService,
  receiverService: ReceiverService,
  plannerService: PlannerService,
  orderChargeService: OrderChargeService,
  orderService: OrderService,
  pricingService: PricingService,
  businessUserRequestService: BusinessUserRequestService,
  developmentPersonaService: MiniappDevelopmentPersonaService,
  performanceService: PerformanceService,
  scanWorkflowService: ScanWorkflowService,
  loginProtectionService: LoginProtectionService,
  uploadSecurity: RequestHandler,
  env: NodeJS.ProcessEnv,
  endpointConfig: RuntimeEndpointConfigService
) {
  const router = Router();
  router.get("/health", (_req, res) => res.json({ ok: true, service: "sample-room-api", apiVersion: "v1" }));
  router.get("/network-config", async (_req, res) => {
    const config = await endpointConfig.mobileConfig();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ...config
    });
  });
  router.get("/dev/personas", (req, res) => {
    res.json({ personas: developmentPersonaService.listForSession(miniappSessionToken(req)) });
  });
  router.post("/dev/personas/:key/login", async (req, res) => {
    res.json(await developmentPersonaService.login(routeId(req.params.key), miniappSessionToken(req)));
  });
  router.post("/dev/test-mode/logout", (req, res) => {
    res.json(developmentPersonaService.logoutTestMode(miniappSessionToken(req)));
  });
  router.post("/scan/resolve", async (req, res) => {
    const sessionToken = miniappSessionToken(req);
    let developmentMode = false;
    if (sessionToken) {
      const { identity } = await service.resolveBySessionToken(sessionToken);
      if (identity.status !== "active" || !identity.canScanOrder) throw new HttpError(403, "forbidden");
    } else if (env.NODE_ENV === "production") {
      throw new HttpError(401, "miniapp_identity_required");
    } else {
      developmentMode = true;
    }
    res.json({
      ...(await scanResolveService.resolveMiniappReadOnly(req.body ?? {})),
      developmentMode
    });
  });
  router.post("/auth/login", async (req, res) => {
    const payload = req.body ?? {};
    res.json(await loginProtectionService.execute(req, "miniapp", payload, async () => {
      const testMode = await developmentPersonaService.tryLoginTestMode(payload);
      return testMode ?? service.login(payload);
    }));
  });
  router.post("/auth/refresh", async (req, res) => res.json(await service.refresh(miniappSessionToken(req))));
  router.post("/auth/logout", async (req, res) => res.json(await service.logout(miniappSessionToken(req))));
  router.get("/session", async (req, res) => res.json({ identity: (await service.resolveBySessionToken(miniappSessionToken(req))).identity }));
  router.use("/receiver", createMiniappReceiverRouter(service, receiverService, orderChargeService, uploadSecurity));
  router.use("/planner", createMiniappPlannerRouter(service, plannerService, orderChargeService, uploadSecurity));
  router.use("/boss", createMiniappBossRouter(service, pricingService, orderChargeService, uploadSecurity));
  router.use("/me", createMiniappPersonalRouter(service, performanceService, scanWorkflowService));
  router.use(
    "/client",
    createMiniappClientRouter(service, orderService, pricingService, businessUserRequestService, uploadSecurity)
  );

  return router;
}
