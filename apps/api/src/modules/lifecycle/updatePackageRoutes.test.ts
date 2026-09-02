import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createInMemoryLifecycleRepositorySet } from "../../db/repositories/memory/inMemoryLifecycleRepositories.js";
import { SingleMachineLifecycleRunnerService } from "./lifecycleService.js";

let server: Server | undefined;
let baseUrl = "";
let updateRoot = "";

beforeEach(async () => {
  updateRoot = await mkdtemp(path.join(tmpdir(), "lcm-06-route-"));
  const repositories = createInMemoryLifecycleRepositorySet();
  new SingleMachineLifecycleRunnerService(repositories).notePresence();
  const app = createApp({
    lifecycleRepositories: repositories,
    env: {
      ...process.env,
      AUTH_MODE: "dev",
      PERSISTENCE_MODE: "memory",
      SAMPLE_ROOM_UPDATE_ROOT: updateRoot,
      SAMPLE_ROOM_APP_VERSION: "1.0.0"
    }
  });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  await rm(updateRoot, { recursive: true, force: true });
});

function packageBody(name = "Deploy-V1.2.0.zip") {
  const body = new FormData();
  body.append("package", new Blob(["isolated route fixture"], { type: "application/zip" }), name);
  return body;
}

describe("System Owner update package routes", () => {
  it("rejects ordinary users before upload handling", async () => {
    const response = await fetch(`${baseUrl}/api/system-owner/updates/packages`, {
      method: "POST",
      headers: { "x-dev-role": "boss" },
      body: packageBody()
    });
    expect(response.status).toBe(403);
  });

  it("fails closed for a system_owner package upload", async () => {
    const response = await fetch(`${baseUrl}/api/system-owner/updates/packages`, {
      method: "POST",
      headers: { "x-dev-role": "system_owner" },
      body: packageBody()
    });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: "automatic_update_not_available" });
  });

  it("fails closed before processing an update package filename", async () => {
    const response = await fetch(`${baseUrl}/api/system-owner/updates/packages`, {
      method: "POST",
      headers: { "x-dev-role": "system_owner" },
      body: packageBody("system-update.zip")
    });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: "automatic_update_not_available" });
  });

  it.each([
    ["/api/system-owner/restores/preflight", "automatic_restore_not_available"],
    ["/api/system-owner/restores/execute", "automatic_restore_not_available"],
    ["/api/system-owner/updates/execute", "automatic_update_not_available"]
  ])("fails closed for unavailable first-production operation %s", async (route, error) => {
    const response = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dev-role": "system_owner"
      },
      body: "{}"
    });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error });
  });
});
