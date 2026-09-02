import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import type { AuthAccountRepository } from "./db/repositories/authAccountRepository.js";
import type { LifecycleRepositorySet, RepositoryContext } from "./db/repositories/contracts/index.js";
import { mockCurrentUser } from "./modules/auth/currentUser.js";
import { getAuthMode } from "./modules/auth/authMode.js";
import { AccountSecurityService } from "./modules/auth/accountSecurityService.js";
import { createAuthRouter } from "./modules/auth/authRoutes.js";
import { FormalAuthService } from "./modules/auth/authService.js";
import { createFormalCurrentUserMiddleware } from "./modules/auth/formalCurrentUser.js";
import {
  createClientBusinessUserRequestRouter,
  createSystemOwnerBusinessUserRequestRouter
} from "./modules/accounts/businessUserRequestRoutes.js";
import { BusinessUserRequestService } from "./modules/accounts/businessUserRequestService.js";
import { createInternalAccountRouter } from "./modules/accounts/internalAccountRoutes.js";
import { InternalAccountService } from "./modules/accounts/internalAccountService.js";
import { createClientOrderRouter } from "./modules/orders/clientOrderRoutes.js";
import { createOrderManagementRouter } from "./modules/orders/orderManagementRoutes.js";
import { OrderManagementService } from "./modules/orders/orderManagementService.js";
import { OrderService } from "./modules/orders/orderService.js";
import {
  createClientQuotationRouter,
  createPricingRouter
} from "./modules/pricing/pricingRoutes.js";
import { PricingService } from "./modules/pricing/pricingService.js";
import { OrderChargeService } from "./modules/pricing/orderChargeService.js";
import {
  createAdminOrderChargeRouter,
  createPlannerOrderChargeRouter,
  createReceiverOrderChargeRouter
} from "./modules/pricing/orderChargeRoutes.js";
import { PerformanceService } from "./modules/pricing/performanceService.js";
import { createPerformanceRouter } from "./modules/pricing/performanceRoutes.js";
import { createPlannerRouter } from "./modules/planner/plannerRoutes.js";
import { CollaborativePlannerService } from "./modules/planner/collaborativePlannerService.js";
import { createReceiverRouter } from "./modules/receiver/receiverRoutes.js";
import { ReceiverService } from "./modules/receiver/receiverService.js";
import { ReceiverPrintSettingsService } from "./modules/receiver/receiverPrintSettingsService.js";
import { createReceiverPrintSettingsRouter } from "./modules/receiver/receiverPrintSettingsRoutes.js";
import { SampleTypeService } from "./modules/sample-types/sampleTypeService.js";
import {
  createSampleTypeManagementRouter,
  createSampleTypeReadRouter
} from "./modules/sample-types/sampleTypeRoutes.js";
import {
  createCuttingRoomRouter,
  createPatternLibraryRouter,
  createPatternMakerRouter
} from "./modules/patterns/patternWorkflowRoutes.js";
import { PatternWorkflowService } from "./modules/patterns/patternWorkflowService.js";
import { createScanRouter } from "./modules/scan/scanRoutes.js";
import { CollaborativeScanWorkflowService } from "./modules/scan/collaborativeScanService.js";
import { QcEvidenceUploadBatchStore } from "./modules/scan/qcEvidenceUploadBatchStore.js";
import { ScanResolveService } from "./modules/scan/scanResolveService.js";
import { ScanTestIdentityProvider } from "./modules/scan/scanTestIdentity.js";
import { createQcTabletRouter } from "./modules/qc/qcTabletRoutes.js";
import { QcTabletService } from "./modules/qc/qcTabletService.js";
import { createQcCheckedPiecesCorrectionRouter } from "./modules/qc/qcCheckedPiecesCorrectionRoutes.js";
import { QcCheckedPiecesCorrectionService } from "./modules/qc/qcCheckedPiecesCorrectionService.js";
import { createSystemOwnerMaintenanceRouter } from "./modules/system-owner/systemOwnerMaintenanceRoutes.js";
import { SystemOwnerMaintenanceService } from "./modules/system-owner/systemOwnerMaintenanceService.js";
import { RuntimeEndpointConfigService } from "./modules/system-owner/runtimeEndpointConfigService.js";
import {
  AndroidAppReleaseService,
  createPublicAndroidAppReleaseRouter,
  createSystemOwnerAndroidAppReleaseRouter
} from "./modules/system-owner/androidAppReleaseRoutes.js";
import { createWorkerRouter } from "./modules/workers/workerRoutes.js";
import { WorkerIdentityService } from "./modules/workers/workerIdentityService.js";
import {
  type SampleRoomRepository
} from "./db/repositories/sampleRoomRepository.js";
import { withQcCheckedPiecesCorrections } from "./db/repositories/qcCheckedPiecesAwareRepository.js";
import { AccountBackedAuthAccountRepository } from "./db/repositories/accountBackedAuthAccountRepository.js";
import {
  createRuntimeRepositoryContext,
  createRuntimeLifecycleRepositorySet,
  createRuntimeSampleRoomRepository
} from "./db/repositories/runtimeRepository.js";
import type { FileStorageAdapter } from "./modules/files/fileStorageAdapter.js";
import { createLocalFileStorageAdapter } from "./modules/files/localFileStorageAdapter.js";
import { maxAttachmentMegabytes } from "./modules/files/attachmentRouteUtils.js";
import { HttpError } from "./shared/errors/httpError.js";
import { MiniappIdentityService } from "./modules/miniapp/miniappIdentityService.js";
import { createMiniappRouter } from "./modules/miniapp/miniappRoutes.js";
import { MiniappDevelopmentPersonaService } from "./modules/miniapp/miniappDevelopmentPersonaService.js";
import { LifecycleSystemOwnerService } from "./modules/lifecycle/lifecycleService.js";
import { createLifecycleSystemOwnerRouter } from "./modules/lifecycle/lifecycleRoutes.js";
import { StorageMigrationService } from "./modules/lifecycle/storageMigrationService.js";
import { UpdatePackageService } from "./modules/lifecycle/updatePackageService.js";
import { LoginProtectionService } from "./modules/auth/loginProtectionService.js";
import { AttachmentUploadSecurity } from "./modules/files/attachmentUploadSecurity.js";
import { resolveSampleRoomStorageRoot } from "./modules/files/storageConfig.js";
import { configureHttpSecurity } from "./shared/httpSecurity.js";
import {
  assertProductionRuntimeSafety,
  configuredUpdateUploadBytes
} from "./shared/productionRuntimeSafety.js";

type AppOptions = {
  repository?: SampleRoomRepository;
  fileStorage?: FileStorageAdapter;
  authAccountRepository?: AuthAccountRepository;
  identityRepositoryContext?: RepositoryContext;
  lifecycleRepositories?: LifecycleRepositorySet;
  env?: NodeJS.ProcessEnv;
};

function webDistRootCandidates(env: NodeJS.ProcessEnv) {
  const configuredRoot = env.SAMPLE_ROOM_WEB_DIST_ROOT?.trim();
  if (configuredRoot) {
    return [path.resolve(configuredRoot)];
  }

  return [
    path.resolve(process.cwd(), "apps/web/dist"),
    path.resolve(process.cwd(), "../web/dist"),
    path.resolve(process.cwd(), "../../apps/web/dist")
  ];
}

function mountBuiltWebApp(app: express.Express, env: NodeJS.ProcessEnv) {
  const root = webDistRootCandidates(env).find((candidate) =>
    existsSync(path.join(candidate, "index.html"))
  );

  if (!root) {
    return;
  }

  const indexPath = path.join(root, "index.html");
  const indexHtml = readFileSync(indexPath, "utf8");
  const padUiManifestPath = path.join(root, "pad-web-ui-manifest.json");

  if (existsSync(padUiManifestPath)) {
    app.get("/api/tablet/web-ui/manifest", (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (!existsSync(padUiManifestPath)) {
        res.status(503).json({ error: "pad_web_ui_manifest_unavailable" });
        return;
      }
      res.type("json").send(readFileSync(padUiManifestPath, "utf8"));
    });
    app.use("/api/tablet/web-ui/files", express.static(root, {
      dotfiles: "deny",
      index: false,
      setHeaders(res) {
        res.setHeader("Cache-Control", "no-store");
      }
    }));
  }

  app.use(express.static(root, {
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }
    }
  }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    if (req.path === "/health" || req.path.startsWith("/api")) {
      next();
      return;
    }

    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(indexHtml);
  });
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const env = options.env ?? process.env;
  assertProductionRuntimeSafety(env);
  configureHttpSecurity(app, env);
  const authMode = getAuthMode(env);
  const repository = withQcCheckedPiecesCorrections(
    options.repository ?? createRuntimeSampleRoomRepository(env)
  );
  const fileStorage = options.fileStorage ?? createLocalFileStorageAdapter(env);
  app.set(
    "sampleRoomStorageRoot",
    (fileStorage as { root?: string }).root ?? resolveSampleRoomStorageRoot(env)
  );
  const identityRepositories =
    options.identityRepositoryContext ?? createRuntimeRepositoryContext(env);
  const operationLogs = identityRepositories.operationLogs;
  if (!operationLogs) {
    throw new Error("Internal account audit logging requires an OperationLog repository.");
  }
  const systemSettings = identityRepositories.systemSettings;
  if (!systemSettings) {
    throw new Error("Sample type management requires a SystemSetting repository.");
  }
  const lifecycleRepositories = options.lifecycleRepositories ?? createRuntimeLifecycleRepositorySet(env);
  const authAccountRepository =
    options.authAccountRepository ??
    new AccountBackedAuthAccountRepository(identityRepositories.accounts, repository);
  const authService = new FormalAuthService(
    identityRepositories.accounts,
    identityRepositories.workerProfiles,
    identityRepositories.accountSessions,
    repository
  );
  const accountSecurityService = new AccountSecurityService(
    repository,
    identityRepositories.accounts
  );
  const sampleTypeService = new SampleTypeService(systemSettings, operationLogs);
  const orderService = new OrderService(repository, sampleTypeService, fileStorage, env);
  const orderManagementService = new OrderManagementService(
    repository,
    fileStorage,
    identityRepositories.accounts,
    operationLogs
  );
  const qcCheckedPiecesCorrectionService = new QcCheckedPiecesCorrectionService(
    repository,
    operationLogs
  );
  const pricingService = new PricingService(repository, { fileStorage, sampleTypeService });
  const orderChargeService = new OrderChargeService(repository, fileStorage, operationLogs);
  const performanceService = new PerformanceService(
    repository,
    identityRepositories.accounts,
    identityRepositories.workerProfiles
  );
  const plannerService = new CollaborativePlannerService(
    repository,
    identityRepositories.accounts,
    fileStorage,
    operationLogs
  );
  const receiverService = new ReceiverService(
    repository,
    identityRepositories.accounts,
    sampleTypeService,
    fileStorage,
    env,
    operationLogs
  );
  const receiverPrintSettingsService = new ReceiverPrintSettingsService(identityRepositories.accounts);
  const runtimeEndpointConfigService = new RuntimeEndpointConfigService(identityRepositories, env);
  const businessUserRequestService = new BusinessUserRequestService(repository, authAccountRepository, runtimeEndpointConfigService);
  const internalAccountService = new InternalAccountService(
    authAccountRepository,
    operationLogs
  );
  const miniappIdentityService = new MiniappIdentityService(authService);
  const loginProtectionService = new LoginProtectionService(operationLogs);
  const attachmentUploadSecurity = new AttachmentUploadSecurity(operationLogs, env);
  const miniappDevelopmentPersonaService = new MiniappDevelopmentPersonaService(
    miniappIdentityService,
    identityRepositories,
    env
  );
  const scanWorkflowService = new CollaborativeScanWorkflowService(
    repository,
    identityRepositories.accounts,
    identityRepositories.workerProfiles,
    fileStorage,
    env
  );
  const scanResolveService = new ScanResolveService(scanWorkflowService);
  const scanTestIdentityProvider = new ScanTestIdentityProvider(
    identityRepositories.accounts,
    identityRepositories.workerProfiles,
    env
  );
  const workerIdentityService = new WorkerIdentityService(identityRepositories, runtimeEndpointConfigService, env);
  const qcTabletService = new QcTabletService(
    repository,
    identityRepositories.accounts,
    identityRepositories.workerProfiles,
    fileStorage,
    scanWorkflowService,
    performanceService
  );
  const patternWorkflowService = new PatternWorkflowService(
    repository,
    env,
    fileStorage,
    operationLogs,
    identityRepositories.accounts
  );
  const systemOwnerMaintenanceService = new SystemOwnerMaintenanceService(
    repository,
    identityRepositories,
    runtimeEndpointConfigService,
    miniappDevelopmentPersonaService,
    {
      authMode,
      persistenceMode: env.PERSISTENCE_MODE ?? "memory",
      env
    }
  );
  const lifecycleSystemOwnerService = new LifecycleSystemOwnerService(lifecycleRepositories);
  const storageMigrationService = new StorageMigrationService(lifecycleRepositories, {
    dataRoot: env.FACTORY_DATA_ROOT_HOST ?? "C:\\SampleRoomData",
    backupRoot: env.FACTORY_BACKUP_ROOT_HOST ?? "C:\\SampleRoomBackups"
  });
  const updatePackageRoot = env.SAMPLE_ROOM_UPDATE_ROOT ?? path.resolve(process.cwd(), ".tmp", "system-updates");
  const updatePackageService = new UpdatePackageService(lifecycleRepositories, {
    updateRoot: updatePackageRoot,
    currentVersion: env.SAMPLE_ROOM_APP_VERSION ?? process.env.npm_package_version ?? "0.1.0",
    maxUploadBytes: configuredUpdateUploadBytes(env)
  });
  const androidAppReleaseService = new AndroidAppReleaseService(
    systemSettings,
    operationLogs,
    { updateRoot: updatePackageRoot }
  );

  // 2 MiB accommodates the confirmed 1000-row Excel preview payload while
  // still bounding ordinary JSON requests.
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "sample-room-api-v2" });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "sample-room-api-v2" });
  });

  app.use(authMode === "dev" ? mockCurrentUser : createFormalCurrentUserMiddleware(authService));

  // One maintenance window for every business write. Reads, health checks and
  // the System Owner lifecycle surface remain available while the host Runner
  // creates a consistent RecoveryPoint.
  app.use(async (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.path.startsWith("/api/system-owner/lifecycle") || req.path.startsWith("/api/system-owner/recovery-points") || req.path.startsWith("/api/system-owner/storage") || req.path.startsWith("/api/system-owner/updates")) {
      next();
      return;
    }
    const lock = await lifecycleRepositories.maintenanceLock.inspect();
    if (lock?.currentJobId) {
      res.status(423).json({ error: "system_maintenance_in_progress", message: "系统正在创建系统恢复点，暂时不能新增或修改内容，请稍后重试。" });
      return;
    }
    next();
  });

  app.use(
    "/api/auth",
    createAuthRouter(authMode, authService, accountSecurityService, loginProtectionService)
  );
  app.use(
    "/api/miniapp",
    createPublicAndroidAppReleaseRouter(androidAppReleaseService)
  );
  app.use(
    "/api/miniapp",
    createMiniappRouter(
      miniappIdentityService,
      scanResolveService,
      receiverService,
      plannerService,
      orderChargeService,
      orderService,
      pricingService,
      businessUserRequestService,
      miniappDevelopmentPersonaService,
      performanceService,
      scanWorkflowService,
      loginProtectionService,
      attachmentUploadSecurity.middleware,
      env,
      runtimeEndpointConfigService
    )
  );
  app.use("/api/client", createClientOrderRouter(orderService, attachmentUploadSecurity.middleware));
  app.use("/api/form-options", createSampleTypeReadRouter(sampleTypeService));
  app.use("/api/client", createClientQuotationRouter(pricingService));
  app.use("/api/admin", createOrderManagementRouter(orderManagementService, patternWorkflowService, attachmentUploadSecurity.middleware));
  app.use("/api/admin", createQcCheckedPiecesCorrectionRouter(qcCheckedPiecesCorrectionService));
  app.use("/api/admin", createPricingRouter(pricingService));
  app.use("/api/admin", createAdminOrderChargeRouter(orderChargeService, attachmentUploadSecurity.middleware));
  app.use("/api/admin", createPerformanceRouter(performanceService));
  app.use("/api/admin", createSampleTypeManagementRouter(sampleTypeService));
  app.use("/api/planner", createPlannerRouter(plannerService, attachmentUploadSecurity.middleware));
  app.use("/api/planner", createPlannerOrderChargeRouter(orderChargeService, attachmentUploadSecurity.middleware));
  app.use("/api/client", createClientBusinessUserRequestRouter(businessUserRequestService));
  app.use("/api/receiver", createReceiverRouter(receiverService, scanWorkflowService, patternWorkflowService, attachmentUploadSecurity.middleware));
  app.use("/api/receiver", createReceiverPrintSettingsRouter(receiverPrintSettingsService));
  app.use("/api/receiver", createReceiverOrderChargeRouter(orderChargeService, attachmentUploadSecurity.middleware));
  app.use("/api/pattern-maker", createPatternMakerRouter(patternWorkflowService, attachmentUploadSecurity.middleware));
  app.use("/api/pattern-library", createPatternLibraryRouter(patternWorkflowService));
  app.use("/api/cutting-room", createCuttingRoomRouter(patternWorkflowService));
  app.use("/api/workers", createWorkerRouter(workerIdentityService));
  app.use(
    "/api/scan",
    createScanRouter(
      scanWorkflowService,
      scanResolveService,
      scanTestIdentityProvider,
      attachmentUploadSecurity.middleware,
      new QcEvidenceUploadBatchStore(path.join((fileStorage as { root?: string }).root ?? resolveSampleRoomStorageRoot(env), ".tmp", "qc-evidence-batches"))
    )
  );
  app.use("/api/qc", createQcTabletRouter(qcTabletService, attachmentUploadSecurity.middleware));
  app.use(
    "/api/system-owner",
    createSystemOwnerBusinessUserRequestRouter(businessUserRequestService)
  );
  app.use(
    "/api/system-owner",
    createInternalAccountRouter(internalAccountService)
  );
  app.use(
    "/api/system-owner",
    createSystemOwnerMaintenanceRouter(systemOwnerMaintenanceService)
  );
  app.use(
    "/api/system-owner",
    createSystemOwnerAndroidAppReleaseRouter(androidAppReleaseService)
  );
  app.use("/api/system-owner", createLifecycleSystemOwnerRouter(lifecycleSystemOwnerService, authService, storageMigrationService, updatePackageService));

  mountBuiltWebApp(app, env);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: "attachment_upload_limit_exceeded",
          maxFileMegabytes: maxAttachmentMegabytes
        });
        return;
      }
      if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
        res.status(413).json({ error: error.code });
        return;
      }
      if (["LIMIT_FIELD_COUNT", "LIMIT_FIELD_VALUE", "LIMIT_PART_COUNT"].includes(error.code)) {
        res.status(413).json({ error: "multipart_fields_too_large" });
        return;
      }
      res.status(400).json({ error: error.message });
      return;
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status?: unknown }).status === 413
    ) {
      res.status(413).json({ error: "request_body_too_large" });
      return;
    }

    res.status(500).json({ error: "internal_server_error" });
  });

  return app;
}
