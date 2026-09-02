import os from "node:os";
import type { RepositoryContext } from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";

export const RUNTIME_ENDPOINT_SETTING_KEY = "runtime_endpoint_bases_v1";

export type RuntimeEndpointConfig = {
  publicWebBaseUrl: string;
  lanWebBaseUrl: string;
  publicApiBaseUrl: string;
  lanApiBaseUrl: string;
  updatedAt?: string;
  updatedBy?: string;
};

function normalize(value: unknown, label: string, options: { requiredHttps?: boolean } = {}) {
  if (typeof value !== "string" || !value.trim()) return "";
  let parsed: URL;
  try { parsed = new URL(value.trim()); }
  catch { throw new HttpError(400, `${label} must be a complete http(s) base URL.`); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== "/")) {
    throw new HttpError(400, `${label} must contain only protocol, host, and optional port.`);
  }
  if (options.requiredHttps && parsed.protocol !== "https:") {
    throw new HttpError(400, `${label} must use HTTPS.`);
  }
  return parsed.origin;
}

function envConfig(env: NodeJS.ProcessEnv): RuntimeEndpointConfig {
  return {
    publicWebBaseUrl: env.SAMPLE_ROOM_PUBLIC_WEB_BASE_URL?.trim() || env.SAMPLE_ROOM_PUBLIC_BASE_URL?.trim() || "",
    lanWebBaseUrl: env.SAMPLE_ROOM_LAN_WEB_BASE_URL?.trim() || "",
    publicApiBaseUrl: env.SAMPLE_ROOM_PUBLIC_API_BASE_URL?.trim() || "",
    lanApiBaseUrl: env.SAMPLE_ROOM_LAN_API_BASE_URL?.trim() || env.SAMPLE_ROOM_INTERNAL_LAN_BASE_URL?.trim() || ""
  };
}

export class RuntimeEndpointConfigService {
  constructor(
    private readonly repositories: RepositoryContext,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  async get(): Promise<RuntimeEndpointConfig> {
    const record = await this.repositories.systemSettings?.findSystemSetting(RUNTIME_ENDPOINT_SETTING_KEY);
    const value = record?.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return envConfig(this.env);
    return { ...envConfig(this.env), ...(value as RuntimeEndpointConfig), ...(typeof record.updatedAt === "string" ? { updatedAt: record.updatedAt } : {}), ...(typeof record.updatedBy === "string" ? { updatedBy: record.updatedBy } : {}) };
  }

  async update(currentUser: CurrentUser, input: Partial<RuntimeEndpointConfig>) {
    if (!this.repositories.systemSettings) throw new HttpError(503, "system settings repository unavailable.");
    const before = await this.get();
    const value: RuntimeEndpointConfig = {
      publicWebBaseUrl: normalize(input.publicWebBaseUrl, "publicWebBaseUrl", { requiredHttps: true }),
      lanWebBaseUrl: normalize(input.lanWebBaseUrl, "lanWebBaseUrl"),
      publicApiBaseUrl: normalize(input.publicApiBaseUrl, "publicApiBaseUrl", { requiredHttps: true }),
      lanApiBaseUrl: normalize(input.lanApiBaseUrl, "lanApiBaseUrl")
    };
    await this.repositories.systemSettings.upsertSystemSetting({ key: RUNTIME_ENDPOINT_SETTING_KEY, value, updatedBy: currentUser.accountId ?? currentUser.id });
    await this.repositories.operationLogs?.appendOperationLog({
      actorId: currentUser.accountId ?? currentUser.id,
      actorRole: currentUser.role,
      action: "runtime_endpoint_config_updated",
      targetType: "SystemSetting",
      targetId: RUNTIME_ENDPOINT_SETTING_KEY,
      before,
      after: value
    });
    return this.get();
  }

  async mobileConfig() {
    const config = await this.get();
    return {
      apiVersion: "v1" as const,
      lanApiBaseUrl: config.lanApiBaseUrl,
      publicApiBaseUrl: config.publicApiBaseUrl,
      updatedAt: config.updatedAt ?? null
    };
  }

  detectLanCandidates() {
    const addresses = Object.values(os.networkInterfaces()).flat().filter(
      (entry): entry is os.NetworkInterfaceInfo => Boolean(entry && entry.family === "IPv4" && !entry.internal)
    );
    return addresses.map((entry) => ({
      address: entry.address,
      lanWebBaseUrl: `http://${entry.address}:${this.env.WEB_PORT?.trim() || "5173"}`,
      lanApiBaseUrl: `http://${entry.address}:${this.env.PORT?.trim() || "3001"}`
    }));
  }
}
