import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { ROLES } from "@sample-room/shared";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import type { RepositoryContext } from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import { resolveSampleRoomStorageRoot } from "../files/storageConfig.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { RuntimeEndpointConfigService, type RuntimeEndpointConfig } from "./runtimeEndpointConfigService.js";
import type { MiniappDevelopmentPersonaService } from "../miniapp/miniappDevelopmentPersonaService.js";

export type SystemOwnerMaintenanceSnapshot = {
  generatedAt: string;
  mode: {
    authMode: string;
    persistenceMode: string;
  };
  counts: {
    orders: {
      total: number;
      active: number;
      terminated: number;
      pendingReceive: number;
      inProduction: number;
      completed: number;
    };
    accounts: {
      customers: number;
      activeCustomers: number;
      archivedCustomers: number;
      clientUsers: number;
      activeClientUsers: number;
      archivedClientUsers: number;
      businessUserRequests: number;
      pendingBusinessUserRequests: number;
    };
    workers: {
      workerAccounts: number;
      activeWorkerAccounts: number;
      suspendedWorkerAccounts: number;
      workerProfiles: number;
      activeWorkerProfiles: number;
      inactiveWorkerProfiles: number;
      endedWorkerProfiles: number;
      identityQrTokens: number;
      usableIdentityQrTokens: number;
    };
    scan: {
      records: number;
      ordersWithRecords: number;
    };
    patternAndCutting: {
      patternTasks: number;
      patternLibraryEntries: number;
      submittedCuttingVersions: number;
      pendingCuttingPrints: number;
    };
    pricing: {
      pricingRecords: number;
      recordsWithQuotedPrice: number;
      recordsWithCost: number;
      extraChargeRows: number;
    };
  };
  safety: {
    containsDatabaseUrl: false;
    containsStorageRoot: false;
    containsScanTokens: false;
    containsStorageKeys: false;
    containsPricingAmounts: false;
  };
  limitations: string[];
};

export type RuntimeConfigStatus = "configured_https" | "configured_http" | "configured_other" | "not_configured";
export type DatabaseConfigStatus = "postgresql_configured" | "configured_other" | "not_configured";
export type StorageRootStatus = "configured" | "not_configured";
export type RuntimeCheckStatus = "pass" | "warn" | "fail" | "skipped";

export type SystemOwnerRuntimeStatus = {
  generatedAt: string;
  appName: "sample-room-operation-cockpit-v2";
  mode: {
    nodeEnv: string;
    authMode: string;
    viteAuthMode: {
      available: boolean;
      value?: string;
      safeMessage?: string;
    };
    persistenceMode: string;
    port: {
      configured: boolean;
      value?: string;
    };
  };
  configuration: {
    publicBaseUrl: RuntimeConfigStatus;
    internalLanBaseUrl: RuntimeConfigStatus;
    databaseUrl: DatabaseConfigStatus;
    storageRoots: Array<{
      key: string;
      status: StorageRootStatus;
    }>;
  };
  safety: {
    redacted: true;
    containsDatabaseUrl: false;
    containsStorageRoot: false;
    containsPublicDomain: false;
    containsIpAddress: false;
    containsToken: false;
    containsStorageKey: false;
    containsCustomerData: false;
    containsAttachmentData: false;
  };
};

export type SystemOwnerRuntimeCheck = {
  key: string;
  label: string;
  status: RuntimeCheckStatus;
  safeMessage: string;
  checkedAt: string;
};

export type SystemOwnerRuntimeChecksResult = {
  generatedAt: string;
  checks: SystemOwnerRuntimeCheck[];
  safety: SystemOwnerRuntimeStatus["safety"];
};

type MaintenanceOptions = {
  authMode: string;
  persistenceMode: string;
  env?: NodeJS.ProcessEnv;
};

export class SystemOwnerMaintenanceService {
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    private readonly repository: SampleRoomRepository,
    private readonly identities: RepositoryContext,
    private readonly endpointConfig: RuntimeEndpointConfigService,
    private readonly miniappTestMode: MiniappDevelopmentPersonaService,
    private readonly options: MaintenanceOptions
  ) {
    this.env = options.env ?? process.env;
  }

  private ensureSystemOwner(currentUser: CurrentUser) {
    if (currentUser.role !== ROLES.systemOwner) {
      throw new HttpError(403, "forbidden");
    }
  }

  async getSnapshot(currentUser: CurrentUser): Promise<SystemOwnerMaintenanceSnapshot> {
    this.ensureSystemOwner(currentUser);
    return this.buildSnapshot();
  }

  async getRuntimeStatus(currentUser: CurrentUser): Promise<SystemOwnerRuntimeStatus> {
    this.ensureSystemOwner(currentUser);
    return this.buildRuntimeStatus();
  }

  async runRuntimeChecks(currentUser: CurrentUser): Promise<SystemOwnerRuntimeChecksResult> {
    this.ensureSystemOwner(currentUser);
    return this.buildRuntimeChecks();
  }

  async createSummaryMarkdown(currentUser: CurrentUser) {
    this.ensureSystemOwner(currentUser);
    const [snapshot, runtimeStatus, runtimeChecks] = await Promise.all([
      this.buildSnapshot(),
      this.buildRuntimeStatus(),
      this.buildRuntimeChecks()
    ]);

    return buildSummaryMarkdown(snapshot, runtimeStatus, runtimeChecks);
  }

  async getEndpointConfig(currentUser: CurrentUser) {
    this.ensureSystemOwner(currentUser);
    return this.endpointConfig.get();
  }

  async updateEndpointConfig(currentUser: CurrentUser, input: Partial<RuntimeEndpointConfig>) {
    this.ensureSystemOwner(currentUser);
    return this.endpointConfig.update(currentUser, input);
  }

  detectLanEndpointCandidates(currentUser: CurrentUser) {
    this.ensureSystemOwner(currentUser);
    return this.endpointConfig.detectLanCandidates();
  }

  createEndpointGuideMarkdown(currentUser: CurrentUser) {
    this.ensureSystemOwner(currentUser);
    return buildEndpointGuideMarkdown();
  }

  async getMiniappReleasePreviewConfig(currentUser: CurrentUser) {
    this.ensureSystemOwner(currentUser);
    return this.miniappTestMode.getReleasePreviewConfig();
  }

  async updateMiniappReleasePreviewConfig(
    currentUser: CurrentUser,
    input: { enabled?: unknown; username?: unknown; password?: unknown; expiresInHours?: unknown }
  ) {
    this.ensureSystemOwner(currentUser);
    return this.miniappTestMode.updateReleasePreviewConfig(currentUser, input);
  }

  private async buildSnapshot(): Promise<SystemOwnerMaintenanceSnapshot> {
    const [
      orders,
      customers,
      requests,
      accounts,
      workerProfiles,
      identityQrTokens,
      patternTasks,
      patternLibraryEntries,
      submittedCuttingVersions,
      pricingRecords
    ] = await Promise.all([
      this.repository.listOrders(),
      this.repository.listCustomers(),
      this.repository.listBusinessUserRequests(),
      this.identities.accounts.listAccounts(),
      this.identities.workerProfiles.listWorkerProfiles(),
      this.identities.identityQrTokens.listIdentityQrTokens(),
      this.repository.listPatternTasks(),
      this.repository.listPatternLibraryEntries(),
      this.repository.listSubmittedCuttingVersions(),
      this.repository.listPricingRecords()
    ]);

    const clientUsersByCustomer = await Promise.all(
      customers.map((customer) => this.repository.listClientUsersByCustomerId(customer.id))
    );
    const clientUsers = clientUsersByCustomer.flat();
    const scanRecordGroups = await Promise.all(
      orders.map((order) => this.repository.listScanRecordsByOrderId(order.id))
    );
    const scanRecords = scanRecordGroups.flat();

    return {
      generatedAt: new Date().toISOString(),
      mode: {
        authMode: this.options.authMode,
        persistenceMode: this.options.persistenceMode
      },
      counts: {
        orders: {
          total: orders.length,
          active: orders.filter((order) => !order.terminated).length,
          terminated: orders.filter((order) => order.terminated).length,
          pendingReceive: orders.filter((order) => order.intakeStatus === "pending_receive").length,
          inProduction: orders.filter(
            (order) => !order.terminated && order.stage !== null && order.stage !== "done"
          ).length,
          completed: orders.filter((order) => order.stage === "done").length
        },
        accounts: {
          customers: customers.length,
          activeCustomers: customers.filter((customer) => customer.status === "active").length,
          archivedCustomers: customers.filter((customer) => customer.status === "archived").length,
          clientUsers: clientUsers.length,
          activeClientUsers: clientUsers.filter((clientUser) => clientUser.status === "active").length,
          archivedClientUsers: clientUsers.filter((clientUser) => clientUser.status === "archived").length,
          businessUserRequests: requests.length,
          pendingBusinessUserRequests: requests.filter((request) => request.status === "pending").length
        },
        workers: {
          workerAccounts: accounts.filter((account) => account.accountType === "worker").length,
          activeWorkerAccounts: accounts.filter(
            (account) => account.accountType === "worker" && account.status === "active"
          ).length,
          suspendedWorkerAccounts: accounts.filter(
            (account) => account.accountType === "worker" && account.status === "suspended"
          ).length,
          workerProfiles: workerProfiles.length,
          activeWorkerProfiles: workerProfiles.filter((profile) => profile.status === "active").length,
          inactiveWorkerProfiles: workerProfiles.filter((profile) => profile.status === "inactive").length,
          endedWorkerProfiles: workerProfiles.filter((profile) => profile.status === "ended").length,
          identityQrTokens: identityQrTokens.length,
          usableIdentityQrTokens: identityQrTokens.filter(
            (token) => !token.usedAt && !token.revokedAt && Date.parse(token.expiresAt) > Date.now()
          ).length
        },
        scan: {
          records: scanRecords.length,
          ordersWithRecords: scanRecordGroups.filter((records) => records.length > 0).length
        },
        patternAndCutting: {
          patternTasks: patternTasks.length,
          patternLibraryEntries: patternLibraryEntries.length,
          submittedCuttingVersions: submittedCuttingVersions.length,
          pendingCuttingPrints: submittedCuttingVersions.filter(
            (submission) => submission.status === "pending_print"
          ).length
        },
        pricing: {
          pricingRecords: pricingRecords.length,
          recordsWithQuotedPrice: pricingRecords.filter(
            (pricing) => pricing.quotedPrice !== undefined
          ).length,
          recordsWithCost: pricingRecords.filter(
            (pricing) => pricing.costAmount !== undefined
          ).length,
          extraChargeRows: pricingRecords.reduce(
            (sum, pricing) => sum + pricing.extraCharges.length,
            0
          )
        }
      },
      safety: {
        containsDatabaseUrl: false,
        containsStorageRoot: false,
        containsScanTokens: false,
        containsStorageKeys: false,
        containsPricingAmounts: false
      },
      limitations: [
        "This is a read-only maintenance snapshot, not a backup package.",
        "Restore, import, update preflight, and operation-log export remain separate maintenance tasks.",
        "Counts intentionally omit database URLs, storage roots, scan tokens, storage keys, and pricing amounts."
      ]
    };
  }

  private buildRuntimeStatus(): SystemOwnerRuntimeStatus {
    return {
      generatedAt: new Date().toISOString(),
      appName: "sample-room-operation-cockpit-v2",
      mode: {
        nodeEnv: this.env.NODE_ENV ?? "development",
        authMode: this.options.authMode,
        viteAuthMode: viteAuthModeStatus(this.env),
        persistenceMode: this.options.persistenceMode,
        port: {
          configured: Boolean(this.env.PORT?.trim()),
          ...(this.env.PORT?.trim() ? { value: this.env.PORT.trim() } : {})
        }
      },
      configuration: {
        publicBaseUrl: baseUrlStatus(this.env.SAMPLE_ROOM_PUBLIC_BASE_URL),
        internalLanBaseUrl: baseUrlStatus(this.env.SAMPLE_ROOM_INTERNAL_LAN_BASE_URL),
        databaseUrl: databaseUrlStatus(this.env.DATABASE_URL),
        storageRoots: [
          { key: "SAMPLE_ROOM_STORAGE_ROOT", status: configuredStatus(this.env.SAMPLE_ROOM_STORAGE_ROOT) },
          { key: "SAMPLE_ROOM_ORDERS_ROOT", status: configuredStatus(this.env.SAMPLE_ROOM_ORDERS_ROOT) },
          {
            key: "SAMPLE_ROOM_CUTTING_INBOX_ROOT",
            status: configuredStatus(this.env.SAMPLE_ROOM_CUTTING_INBOX_ROOT)
          }
        ]
      },
      safety: safeRedactionFlags()
    };
  }

  private async buildRuntimeChecks(): Promise<SystemOwnerRuntimeChecksResult> {
    const checks = await Promise.all([
      safeCheck("api_health", "API health", async () => pass("API runtime is responding.")),
      safeCheck("prisma_availability", "Prisma availability", async () =>
        this.env.PERSISTENCE_MODE === "prisma" || this.options.persistenceMode === "prisma"
          ? pass("Prisma mode is selected for this API runtime.")
          : skipped("Prisma mode is not selected for this API runtime.")
      ),
      safeCheck("postgresql_connectivity", "PostgreSQL connectivity", async () => this.checkPostgreSql()),
      safeCheck("storage_root_exists", "Storage root existence", async () => this.checkStorageExists()),
      safeCheck("storage_root_writable", "Storage writable probe", async () => this.checkStorageWritable()),
      safeCheck("public_url_configured", "QR public base URL configured", async () =>
        baseUrlStatus(this.env.SAMPLE_ROOM_PUBLIC_BASE_URL) === "not_configured"
          ? warn("Public base URL is not configured.")
          : pass("Public base URL is configured without exposing the address.")
      ),
      safeCheck("attachment_api_boundary", "Attachment download API boundary", async () =>
        pass("Attachment upload, preview, download, and export must go through permission-checked Web/API routes.")
      )
    ]);

    return {
      generatedAt: new Date().toISOString(),
      checks,
      safety: safeRedactionFlags()
    };
  }

  private async checkPostgreSql(): Promise<Omit<SystemOwnerRuntimeCheck, "key" | "label" | "checkedAt">> {
    if (!this.env.DATABASE_URL?.trim()) {
      return skipped("DATABASE_URL is not configured.");
    }

    if (databaseUrlStatus(this.env.DATABASE_URL) !== "postgresql_configured") {
      return skipped("Configured database URL is not PostgreSQL.");
    }

    const prisma = new PrismaClient({ datasources: { db: { url: this.env.DATABASE_URL } } });
    try {
      await prisma.$queryRaw`SELECT 1`;
      return pass("PostgreSQL accepted a lightweight connectivity probe.");
    } catch {
      return warn("PostgreSQL connectivity probe did not complete.");
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  }

  private async checkStorageExists(): Promise<Omit<SystemOwnerRuntimeCheck, "key" | "label" | "checkedAt">> {
    const root = resolveSampleRoomStorageRoot(this.env);
    try {
      const stats = await fs.stat(root);
      return stats.isDirectory()
        ? pass("Storage root exists.")
        : warn("Configured storage root exists but is not a directory.");
    } catch {
      return warn("Storage root does not exist or cannot be accessed.");
    }
  }

  private async checkStorageWritable(): Promise<Omit<SystemOwnerRuntimeCheck, "key" | "label" | "checkedAt">> {
    const root = resolveSampleRoomStorageRoot(this.env);
    const probePath = path.join(root, `.maintenance-probe-${Date.now()}.tmp`);
    try {
      await fs.writeFile(probePath, "maintenance probe\n", { encoding: "utf8", flag: "wx" });
      await fs.unlink(probePath);
      return pass("Storage root accepted a temporary write/delete probe.");
    } catch {
      await fs.unlink(probePath).catch(() => undefined);
      return warn("Storage root write/delete probe did not complete.");
    }
  }
}

function safeRedactionFlags(): SystemOwnerRuntimeStatus["safety"] {
  return {
    redacted: true,
    containsDatabaseUrl: false,
    containsStorageRoot: false,
    containsPublicDomain: false,
    containsIpAddress: false,
    containsToken: false,
    containsStorageKey: false,
    containsCustomerData: false,
    containsAttachmentData: false
  };
}

function configuredStatus(value: string | undefined): StorageRootStatus {
  return value?.trim() ? "configured" : "not_configured";
}

function baseUrlStatus(value: string | undefined): RuntimeConfigStatus {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "not_configured";
  }
  if (/^https:\/\//i.test(trimmed)) {
    return "configured_https";
  }
  if (/^http:\/\//i.test(trimmed)) {
    return "configured_http";
  }
  return "configured_other";
}

function databaseUrlStatus(value: string | undefined): DatabaseConfigStatus {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "not_configured";
  }
  return /^postgresql:\/\//i.test(trimmed) || /^postgres:\/\//i.test(trimmed)
    ? "postgresql_configured"
    : "configured_other";
}

function viteAuthModeStatus(env: NodeJS.ProcessEnv): SystemOwnerRuntimeStatus["mode"]["viteAuthMode"] {
  const value = env.VITE_AUTH_MODE?.trim();
  if (value) {
    return { available: true, value };
  }

  return {
    available: false,
    safeMessage: "Frontend build auth mode is not exposed to the API runtime."
  };
}

function checkedAt() {
  return new Date().toISOString();
}

function pass(safeMessage: string) {
  return { status: "pass" as const, safeMessage };
}

function warn(safeMessage: string) {
  return { status: "warn" as const, safeMessage };
}

function skipped(safeMessage: string) {
  return { status: "skipped" as const, safeMessage };
}

async function safeCheck(
  key: string,
  label: string,
  run: () => Promise<Omit<SystemOwnerRuntimeCheck, "key" | "label" | "checkedAt">>
): Promise<SystemOwnerRuntimeCheck> {
  try {
    return { key, label, ...(await run()), checkedAt: checkedAt() };
  } catch {
    return {
      key,
      label,
      status: "warn",
      safeMessage: "This check could not complete. No sensitive details were included.",
      checkedAt: checkedAt()
    };
  }
}

function line(label: string, value: string) {
  return `- ${label}: ${value}`;
}

function buildSummaryMarkdown(
  snapshot: SystemOwnerMaintenanceSnapshot,
  runtimeStatus: SystemOwnerRuntimeStatus,
  runtimeChecks: SystemOwnerRuntimeChecksResult
) {
  const viteAuthMode = runtimeStatus.mode.viteAuthMode.available
    ? runtimeStatus.mode.viteAuthMode.value ?? "available"
    : "not_available";
  const storageSummary = runtimeStatus.configuration.storageRoots
    .map((root) => `${root.key}=${root.status}`)
    .join(", ");

  return [
    "# Sample Room System Maintenance Summary",
    "",
    "## 1. Report Metadata",
    line("generatedAt", new Date().toISOString()),
    line("app name", runtimeStatus.appName),
    line("report purpose", "Safe local maintenance summary for manual troubleshooting handoff."),
    line("redaction notice", "This report intentionally includes field names but excludes real sensitive values."),
    "",
    "## 2. Current Runtime Status",
    line("NODE_ENV", runtimeStatus.mode.nodeEnv),
    line("AUTH_MODE", runtimeStatus.mode.authMode),
    line("VITE_AUTH_MODE", viteAuthMode),
    line("PERSISTENCE_MODE", runtimeStatus.mode.persistenceMode),
    line("PORT", runtimeStatus.mode.port.configured ? "configured" : "not_configured"),
    line("PUBLIC_BASE_URL status", runtimeStatus.configuration.publicBaseUrl),
    line("INTERNAL_LAN_BASE_URL status", runtimeStatus.configuration.internalLanBaseUrl),
    line("DATABASE_URL status", runtimeStatus.configuration.databaseUrl),
    line("storage roots status", storageSummary),
    "",
    "## 3. Deployment Boundary",
    "- factory server is primary system server",
    "- Oray/FRP only exposes Web/API",
    "- PostgreSQL must not be exposed publicly",
    "- SMB must not be exposed publicly",
    "- RDP/SSH/WinRM must not be exposed through Oray/FRP",
    "- external users use Web/API upload/download/preview/export",
    "- factory LAN computers may use SMB/open-folder workflows only inside LAN",
    "",
    "## 4. Health Check Results",
    ...runtimeChecks.checks.map(
      (check) =>
        `- ${check.label}: ${check.status}; ${check.safeMessage}; checkedAt=${check.checkedAt}`
    ),
    "",
    "## 5. Safety Redaction",
    "- This report does not include real DATABASE_URL values.",
    "- This report does not include passwords.",
    "- This report does not include tokens.",
    "- This report does not include real public domain values.",
    "- This report does not include real IP address values.",
    "- This report does not include local disk paths.",
    "- This report does not include UNC path values.",
    "- This report does not include storageKey values.",
    "- This report does not include customer data.",
    "- This report does not include attachments.",
    "- This report does not include photos.",
    "- This report does not include exported Excel files.",
    "",
    "## 6. User Problem Description",
    "- What page did you open?",
    "- What button did you click?",
    "- What error appeared?",
    "- Did it happen on local LAN, public tunnel, or local dev?",
    "- Did it happen after restarting API?",
    "- Did it happen after changing .env?",
    "- Screenshots or copied error message:",
    "",
    "## 7. Questions For GPT",
    "1. Is this likely a deployment, database, file storage, auth, or frontend issue?",
    "2. What should be checked first?",
    "3. What should I ask Codex to inspect next?",
    "4. Is this safe to continue using locally?",
    "",
    "<!-- Snapshot generatedAt is included for correlation only. -->",
    `<!-- maintenanceSnapshotGeneratedAt=${snapshot.generatedAt} -->`
  ].join("\n");
}

function buildEndpointGuideMarkdown() {
  return `# Sample Room OS 地址设置（小白步骤）

## 先认识两个地址

- Web 基础地址：人用浏览器打开的网页入口。Worker 注册二维码和客户业务员注册链接使用它。
- API 基础地址：微信小程序和 Android App 在后台请求数据的服务器入口，通常是 API 的 3001 端口或它的 HTTPS 公网域名。

## 局域网地址怎么找

1. 确认运行样品间系统的电脑与手机连接同一个工厂 Wi-Fi。
2. 在 System Owner 的“系统维护”页面点击“检测本机局域网地址”。
3. 选择能被手机访问的候选地址。开发环境常见 Web 地址为 http://局域网IP:5173，API 地址为 http://局域网IP:3001。
4. 先在手机浏览器打开 API地址/api/miniapp/health。看到 ok=true 和 service=sample-room-api 才算成功。
5. Windows 防火墙若拦截，请由管理员只放行 Web/API 所需端口；不要开放数据库、SMB、远程桌面等端口。

## 公网地址怎么找

1. 公网 Web 地址是 FRP/向日葵映射后给网页使用的 HTTPS 域名，例如 https://scan.example.com。
2. 公网 API 地址是映射到 API 服务的 HTTPS 域名，例如 https://api.example.com；也可以由同一域名反向代理 /api。
3. 不要填写 FRP 密钥、密码、内网文件路径或数据库地址。
4. 将地址分别填入“公网 Web 基础地址”和“公网 API 基础地址”，点击保存。

## 微信小程序额外步骤

1. System Owner 页面保存地址只会告诉系统该请求哪个 API。
2. 正式微信小程序还必须在微信公众平台的小程序后台，把公网 API 的 HTTPS 域名加入 request 合法域名；上传文件使用的域名还要加入 uploadFile 合法域名。
3. 微信正式版不能依靠“开发者工具不校验合法域名”。建议长期保持一个稳定 HTTPS 域名，只调整 DNS、反向代理或 FRP 后端目标。

## Android App

Android 可以从系统运行时配置读取 LAN/API 地址，无需重新编译；但生产环境仍应使用 HTTPS，并限制可接受的域名范围。

## 改完后的检查

1. 手机浏览器分别打开 Web 地址和 API健康检查地址。
2. 生成一个 Worker 注册二维码，分别测试公网和局域网版本。
3. 客户业务员二维码只能显示公网 Web 地址。
4. 微信小程序测试 LAN 优先、公网回退；写操作不要自动重复提交。
`;
}
