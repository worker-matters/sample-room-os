export type NetworkAddressType = "LAN" | "PUBLIC";

export type NetworkConfigQrPayload = {
  addressType: NetworkAddressType;
  baseUrl: string;
  displayName?: string;
  apiVersion: "v1";
};

function normalizeBaseUrl(value: string, addressType: NetworkAddressType) {
  const parsed = new URL(value.trim());
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname && parsed.pathname !== "/")
  ) {
    throw new Error("网络配置地址必须只包含 http(s) 协议、主机和可选端口。");
  }
  if (addressType === "PUBLIC" && parsed.protocol !== "https:") {
    throw new Error("公网网络配置必须使用 HTTPS。");
  }
  return parsed.origin;
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function createNetworkConfigQrPayload(input: Omit<NetworkConfigQrPayload, "apiVersion">) {
  const payload: NetworkConfigQrPayload = {
    addressType: input.addressType,
    baseUrl: normalizeBaseUrl(input.baseUrl, input.addressType),
    ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
    apiVersion: "v1"
  };
  return `SRS2|NETWORK_CONFIG|1|${base64Url(JSON.stringify(payload))}`;
}
