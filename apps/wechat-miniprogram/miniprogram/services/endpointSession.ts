import type { MiniappGlobalData } from "../app";
import { environment } from "../config/environment";
import { probeMiniappHealth } from "./apiClient";
import { selectApiEndpoint } from "./endpointSelector";

export async function ensureSessionEndpoint(globalData: MiniappGlobalData) {
  if (globalData.apiBase && (globalData.apiMode === "lan" || globalData.apiMode === "public")) {
    return { baseUrl: globalData.apiBase, mode: globalData.apiMode } as const;
  }
  const endpoint = await selectApiEndpoint({
    lanApiBase: environment.lanApiBase,
    publicApiBase: environment.publicApiBase,
    expectedServiceId: environment.expectedServiceId,
    timeoutMs: environment.healthTimeoutMs,
    buildMode: environment.buildMode
  }, probeMiniappHealth);
  globalData.apiBase = endpoint.baseUrl;
  globalData.apiMode = endpoint.mode;
  return endpoint;
}

export function invalidateSessionEndpoint(globalData: MiniappGlobalData) {
  delete globalData.apiBase;
  globalData.apiMode = "undetected";
}
