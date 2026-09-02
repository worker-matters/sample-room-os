export type OrderQrSourceFormat =
  | "plain_text"
  | "legacy_url"
  | "relative_path"
  | "bare_token";

export type ParsedOrderQrPayload = {
  version: "SRS2" | "legacy";
  type: "ORDER";
  token: string;
  sourceFormat: OrderQrSourceFormat;
};

export type OrderQrFormat = "legacy_url" | "plain_text";

const opaqueTokenPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{7,255}$/;
const bareOrderTokenPattern = /^order_scan_[A-Za-z0-9_-]+$/;

function validToken(value: string) {
  if (!opaqueTokenPattern.test(value)) {
    throw new Error("invalid_order_qr_payload");
  }
  return value;
}

function tokenFromPath(pathname: string) {
  const match = pathname.match(/^\/scan\/([^/]+)\/?$/);
  if (!match) throw new Error("invalid_order_qr_payload");
  try {
    return validToken(decodeURIComponent(match[1]!));
  } catch {
    throw new Error("invalid_order_qr_payload");
  }
}

export function parseOrderQrPayload(payload: string): ParsedOrderQrPayload {
  const value = payload.trim();
  if (!value) throw new Error("invalid_order_qr_payload");

  if (value.startsWith("SRS2|")) {
    const parts = value.split("|");
    if (parts.length !== 3 || parts[0] !== "SRS2" || parts[1] !== "ORDER") {
      throw new Error("invalid_order_qr_payload");
    }
    return {
      version: "SRS2",
      type: "ORDER",
      token: validToken(parts[2]!),
      sourceFormat: "plain_text"
    };
  }

  if (value.startsWith("/")) {
    return {
      version: "legacy",
      type: "ORDER",
      token: tokenFromPath(value),
      sourceFormat: "relative_path"
    };
  }

  if (value.startsWith("https://")) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("invalid_order_qr_payload");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("invalid_order_qr_payload");
    }
    return {
      version: "legacy",
      type: "ORDER",
      token: tokenFromPath(url.pathname),
      sourceFormat: "legacy_url"
    };
  }

  if (bareOrderTokenPattern.test(value)) {
    return {
      version: "legacy",
      type: "ORDER",
      token: validToken(value),
      sourceFormat: "bare_token"
    };
  }

  throw new Error("invalid_order_qr_payload");
}

export function formatOrderQrPayload(
  token: string,
  format: OrderQrFormat,
  legacyValue: string
) {
  const safeToken = validToken(token);
  return format === "plain_text" ? `SRS2|ORDER|${safeToken}` : legacyValue;
}
