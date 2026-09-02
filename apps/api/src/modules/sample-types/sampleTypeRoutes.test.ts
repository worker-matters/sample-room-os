import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ROLES } from "@sample-room/shared";
import { createApp } from "../../app.js";
import { createInMemoryRepositoryContext } from "../../db/repositories/memory/inMemoryRepositoryContext.js";
import { createInMemorySampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";

let server: Server;
let baseUrl: string;
let repositories: ReturnType<typeof createInMemoryRepositoryContext>;

const roleHeaders = (role: string) => ({
  "content-type": "application/json",
  "x-dev-role": role,
  "x-dev-user-id": `${role}-actor`
});

async function jsonRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { response, body: await response.json() as Record<string, unknown> };
}

describe("sample type API", () => {
  beforeEach(async () => {
    repositories = createInMemoryRepositoryContext();
    const app = createApp({
      repository: createInMemorySampleRoomRepository(),
      identityRepositoryContext: repositories,
      env: { ...process.env, AUTH_MODE: "dev", PERSISTENCE_MODE: "memory" }
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("allows boss and System Owner management but forbids other roles", async () => {
    const boss = await jsonRequest("/api/admin/sample-types", {
      method: "POST", headers: roleHeaders(ROLES.boss), body: JSON.stringify({ name: "展示样" })
    });
    expect(boss.response.status).toBe(201);
    const items = boss.body.items as Array<{ code: string; name: string }>;
    const custom = items.at(-1)!;

    const owner = await jsonRequest(`/api/admin/sample-types/${custom.code}`, {
      method: "PATCH", headers: roleHeaders(ROLES.systemOwner), body: JSON.stringify({ name: "确认样" })
    });
    expect(owner.response.status).toBe(200);
    expect((owner.body.items as Array<{ name: string }>).at(-1)?.name).toBe("确认样");

    const forbidden = await jsonRequest("/api/admin/sample-types", {
      method: "POST", headers: roleHeaders(ROLES.receiver), body: JSON.stringify({ name: "不可新增" })
    });
    expect(forbidden.response.status).toBe(403);
  });

  it("returns authenticated form options and permits a new order to use a dynamic code", async () => {
    const created = await jsonRequest("/api/admin/sample-types", {
      method: "POST", headers: roleHeaders(ROLES.boss), body: JSON.stringify({ name: "展示样" })
    });
    const custom = (created.body.items as Array<{ code: string }>).at(-1)!;
    const options = await jsonRequest("/api/form-options/sample-types", { headers: roleHeaders(ROLES.planner) });
    expect(options.response.status).toBe(200);
    expect(options.body.items).toEqual(expect.arrayContaining([{ value: custom.code, label: "展示样" }]));

    const order = await jsonRequest("/api/client/orders", {
      method: "POST",
      headers: roleHeaders(ROLES.clientBusinessUser),
      body: JSON.stringify({
        styleNo: "DYNAMIC-001", styleName: "动态类型测试", quantity: 1,
        sampleType: custom.code, sampleRound: "round_1", patternStatus: "none",
        deliveryDate: "2026-08-10"
      })
    });
    expect(order.response.status).toBe(201);
    expect((order.body.order as { sampleType: string }).sampleType).toBe(custom.code);

    const logs = await repositories.operationLogs!.listOperationLogs();
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "sample_type_created", targetId: custom.code })
    ]));
  });
});
