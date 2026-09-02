import { createHash } from "node:crypto";
import type { Request } from "express";

const SESSION_COOKIE_NAME = "sample_room_session";

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function authSessionCookieName() {
  return SESSION_COOKIE_NAME;
}

export function extractAuthToken(req: Request): string | undefined {
  const authorization = req.header("authorization");
  const bearerPrefix = "Bearer ";
  if (authorization?.startsWith(bearerPrefix)) {
    const token = authorization.slice(bearerPrefix.length).trim();
    return token.length > 0 ? token : undefined;
  }

  const cookie = req.header("cookie");
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    if (rawName === SESSION_COOKIE_NAME) {
      const rawValue = rawValueParts.join("=");
      return rawValue.length > 0 ? decodeURIComponent(rawValue) : undefined;
    }
  }
  return undefined;
}
