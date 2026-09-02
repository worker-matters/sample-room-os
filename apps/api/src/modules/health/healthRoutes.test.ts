import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";

let server: Server | undefined;
let baseUrl: string;
let tempRoot: string;

async function startApp(env: NodeJS.ProcessEnv = {}) {
  const app = createApp({
    env: {
      ...process.env,
      AUTH_MODE: "formal",
      PERSISTENCE_MODE: "memory",
      ...env
    }
  });
  const startedServer = app.listen(0);
  server = startedServer;

  await new Promise<void>((resolve, reject) => {
    startedServer.once("listening", resolve);
    startedServer.once("error", reject);
  });

  const address = startedServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Test API did not bind to a TCP port.");
  }

  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), "sample-room-health-test-"));
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }

    if (!server?.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  await rm(tempRoot, { recursive: true, force: true });
});

describe("deployment health routes", () => {
  it("serves application health without a formal login session", async () => {
    await startApp();

    const response = await fetch(`${baseUrl}/api/health`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body).toEqual({ ok: true, service: "sample-room-api-v2" });
  });
  server = undefined;

  it("adds browser security headers and rejects unknown development browser origins", async () => {
    await startApp();
    const response = await fetch(`${baseUrl}/health`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self' ws://127.0.0.1:37989"
    );
    expect(response.headers.get("content-security-policy")).not.toContain("connect-src *");
    expect(response.headers.get("content-security-policy")).not.toContain("connect-src ws:");
    expect(response.headers.get("content-security-policy")).toContain("frame-src 'self' blob:");
    expect(response.headers.get("content-security-policy")).not.toContain("upgrade-insecure-requests");
    expect(response.headers.get("x-powered-by")).toBeNull();

    const allowed = await fetch(`${baseUrl}/health`, {
      headers: { origin: "http://localhost:5173" }
    });
    const denied = await fetch(`${baseUrl}/health`, {
      headers: { origin: "https://untrusted.example" }
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(denied.status).toBe(403);
  });

  it("rejects a trust-proxy configuration that trusts every source", () => {
    expect(() => createApp({
      env: {
        ...process.env,
        AUTH_MODE: "formal",
        PERSISTENCE_MODE: "memory",
        SAMPLE_ROOM_TRUST_PROXY: "0.0.0.0/0"
      }
    })).toThrow("actual reverse proxy");
  });

  it("fails closed before repository startup when formal production requirements are missing", () => {
    const baseProductionEnv = {
      ...process.env,
      NODE_ENV: "production",
      AUTH_MODE: "formal",
      PERSISTENCE_MODE: "prisma",
      DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
      SAMPLE_ROOM_STORAGE_ROOT: tempRoot
    };
    expect(() => createApp({
      env: { ...baseProductionEnv, AUTH_MODE: "dev" }
    })).toThrow("AUTH_MODE=formal");
    expect(() => createApp({
      env: { ...baseProductionEnv, PERSISTENCE_MODE: "memory" }
    })).toThrow("PERSISTENCE_MODE=prisma");
    expect(() => createApp({
      env: { ...baseProductionEnv, DATABASE_URL: "" }
    })).toThrow("DATABASE_URL");
    expect(() => createApp({
      env: { ...baseProductionEnv, SAMPLE_ROOM_STORAGE_ROOT: "" }
    })).toThrow("SAMPLE_ROOM_STORAGE_ROOT");
  });

  it("serves the built web app when a web dist root is configured", async () => {
    await mkdir(path.join(tempRoot, "assets"));
    await writeFile(path.join(tempRoot, "index.html"), "<html><body>Sample Room Web</body></html>");
    await writeFile(path.join(tempRoot, "assets", "app-123.js"), "console.log('pad')");
    await writeFile(path.join(tempRoot, "pad-web-ui-manifest.json"), JSON.stringify({
      formatVersion: 1,
      uiVersion: "2026.08.11.000001",
      bundleSha256: "a".repeat(64),
      downloadBasePath: "/api/tablet/web-ui/files/",
      files: [{ path: "index.html", size: 41, sha256: "b".repeat(64) }]
    }));
    await startApp({ SAMPLE_ROOM_WEB_DIST_ROOT: tempRoot });

    const webResponse = await fetch(`${baseUrl}/`);
    const loginResponse = await fetch(`${baseUrl}/login`);
    const assetResponse = await fetch(`${baseUrl}/assets/app-123.js`);
    const manifestResponse = await fetch(`${baseUrl}/api/tablet/web-ui/manifest`);
    const packageFileResponse = await fetch(`${baseUrl}/api/tablet/web-ui/files/index.html`);
    const apiResponse = await fetch(`${baseUrl}/api/not-found`);

    expect(webResponse.status).toBe(200);
    expect(await webResponse.text()).toContain("Sample Room Web");
    expect(loginResponse.status).toBe(200);
    expect(await loginResponse.text()).toContain("Sample Room Web");
    expect(webResponse.headers.get("cache-control")).toContain("no-cache");
    expect(assetResponse.headers.get("cache-control")).toContain("immutable");
    expect(manifestResponse.headers.get("cache-control")).toContain("no-store");
    expect((await manifestResponse.json() as { uiVersion: string }).uiVersion).toBe("2026.08.11.000001");
    expect(packageFileResponse.headers.get("cache-control")).toContain("no-store");
    expect(await packageFileResponse.text()).toContain("Sample Room Web");
    expect(apiResponse.status).toBe(404);

    await writeFile(path.join(tempRoot, "pad-web-ui-manifest.json"), JSON.stringify({
      formatVersion: 1,
      uiVersion: "2026.08.11.000002",
      bundleSha256: "c".repeat(64),
      downloadBasePath: "/api/tablet/web-ui/files/",
      files: [{ path: "index.html", size: 41, sha256: "d".repeat(64) }]
    }));
    const refreshedManifestResponse = await fetch(`${baseUrl}/api/tablet/web-ui/manifest`);
    expect(refreshedManifestResponse.status).toBe(200);
    expect((await refreshedManifestResponse.json() as { uiVersion: string }).uiVersion).toBe("2026.08.11.000002");
  });

  it("finds the built web app when the production command starts from the api workspace", async () => {
    const originalCwd = process.cwd();
    const fakeApiCwd = path.join(tempRoot, "apps", "api");
    const fakeWebDist = path.join(tempRoot, "apps", "web", "dist");
    await mkdir(fakeApiCwd, { recursive: true });
    await mkdir(fakeWebDist, { recursive: true });
    await writeFile(path.join(fakeWebDist, "index.html"), "<html><body>Workspace Web</body></html>");

    try {
      process.chdir(fakeApiCwd);
      await startApp();

      const response = await fetch(`${baseUrl}/`);

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Workspace Web");
    } finally {
      process.chdir(originalCwd);
    }
  });
});
