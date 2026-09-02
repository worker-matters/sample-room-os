import type { Express } from "express";

function values(raw: string | undefined) {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const unsafeBroadProxyRanges = new Set([
  "*",
  "all",
  "true",
  "0.0.0.0/0",
  "0/0",
  "::/0",
  "[::]/0",
  "::0/0",
  "0:0:0:0:0:0:0:0/0",
  "::ffff:0:0/0"
]);

export function configureTrustedProxy(app: Express, env: NodeJS.ProcessEnv) {
  const trusted = values(env.SAMPLE_ROOM_TRUST_PROXY);
  if (trusted.some((value) => unsafeBroadProxyRanges.has(value.toLowerCase()))) {
    throw new Error("SAMPLE_ROOM_TRUST_PROXY must identify only the actual reverse proxy.");
  }
  app.set("trust proxy", trusted.length > 0 ? trusted.join(", ") : false);
  return trusted;
}

export function configuredPublicHttpsHosts(env: NodeJS.ProcessEnv) {
  const hosts = values(env.SAMPLE_ROOM_PUBLIC_HTTPS_HOSTS);
  for (const value of [
    env.SAMPLE_ROOM_PUBLIC_WEB_BASE_URL,
    env.SAMPLE_ROOM_PUBLIC_API_BASE_URL,
    env.SAMPLE_ROOM_PUBLIC_BASE_URL
  ]) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "https:") hosts.push(parsed.hostname);
    } catch {
      // Runtime endpoint validation reports malformed configured public URLs.
    }
  }
  return new Set(hosts.map((host) => host.toLowerCase()));
}
