import type { ApiMode, MiniappHealthResponse } from "../types/contracts";

export interface EndpointConfig {
  lanApiBase: string;
  publicApiBase: string;
  expectedServiceId: string;
  timeoutMs: number;
  buildMode: "development" | "production";
}

export interface SelectedEndpoint {
  baseUrl: string;
  mode: Exclude<ApiMode, "undetected" | "unavailable">;
}

export type HealthProbe = (
  baseUrl: string,
  timeoutMs: number
) => Promise<MiniappHealthResponse>;

const isExpectedService = (
  health: MiniappHealthResponse,
  expectedServiceId: string
): boolean => health.ok === true && health.service === expectedServiceId;

const probeExpectedService = async (
  baseUrl: string,
  config: EndpointConfig,
  probe: HealthProbe
): Promise<boolean> => {
  if (!baseUrl.trim()) return false;
  try {
    return isExpectedService(await probe(baseUrl, config.timeoutMs), config.expectedServiceId);
  } catch {
    return false;
  }
};

const isHttpsPublicOrigin = (value: string): boolean => {
  const trimmed = value.trim();
  const match = /^https:\/\/([^/?#]+)\/?$/i.exec(trimmed);
  if (!match) return false;
  const authority = match[1] ?? "";
  if (!authority || authority.includes("@") || /\s/.test(authority)) return false;

  let host = authority;
  let port = "";
  if (authority.startsWith("[")) {
    const bracket = authority.indexOf("]");
    if (bracket < 2) return false;
    host = authority.slice(0, bracket + 1);
    const suffix = authority.slice(bracket + 1);
    if (suffix && !suffix.startsWith(":")) return false;
    port = suffix.slice(1);
    if (!/^\[[0-9a-f:]+\]$/i.test(host)) return false;
  } else {
    const segments = authority.split(":");
    if (segments.length > 2) return false;
    host = segments[0] ?? "";
    port = segments[1] ?? "";
    if (host.length > 253) return false;
    const labels = host.split(".");
    if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
      return false;
    }
    if (labels.length === 4 && labels.every((label) => /^\d+$/.test(label)) &&
      labels.some((label) => Number(label) > 255)) {
      return false;
    }
  }

  if (host.toLowerCase() === "localhost") return false;
  if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) return false;
  return true;
};

export const selectApiEndpoint = async (
  config: EndpointConfig,
  probe: HealthProbe
): Promise<SelectedEndpoint> => {
  if (config.buildMode === "production") {
    if (!config.publicApiBase.trim()) {
      throw new Error("正式版未配置公网 API 地址");
    }
    if (!isHttpsPublicOrigin(config.publicApiBase)) {
      throw new Error("正式版公网 API 必须是有效的 HTTPS 服务地址");
    }
    if (await probeExpectedService(config.publicApiBase, config, probe)) {
      return { baseUrl: config.publicApiBase.trim().replace(/\/$/, ""), mode: "public" };
    }
    throw new Error("样品间公网 API 当前不可用");
  }

  if (await probeExpectedService(config.lanApiBase, config, probe)) {
    return { baseUrl: config.lanApiBase, mode: "lan" };
  }

  if (config.publicApiBase.trim() && await probeExpectedService(config.publicApiBase, config, probe)) {
    return { baseUrl: config.publicApiBase, mode: "public" };
  }

  throw new Error(config.publicApiBase.trim() ? "样品间 API 当前不可用" : "请连接工厂 Wi-Fi 或检查开发服务器");
};
