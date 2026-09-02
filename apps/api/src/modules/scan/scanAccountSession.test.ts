import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import { createApp } from "../../app.js";
import { createInMemoryRepositoryContext } from "../../db/repositories/memory/inMemoryRepositoryContext.js";
import { InMemoryIdentityStore } from "../../db/repositories/memory/inMemoryIdentityRepositories.js";
import {
  createInMemorySampleRoomRepository,
  type SampleRoomRepository
} from "../../db/repositories/sampleRoomRepository.js";
import { FORMAL_LOGIN_DEV_PASSWORD } from "../auth/devAuthAccounts.js";

type JsonValue = Record<string, unknown>;

let server: Server;
let baseUrl: string;
let repository: SampleRoomRepository;
let identityStore: InMemoryIdentityStore;

async function jsonRequest(pathname: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = (await response.json()) as JsonValue;
  return { response, body };
}

async function login(identity: { username?: string; phoneNumber?: string }) {
  return jsonRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...identity,
      password: FORMAL_LOGIN_DEV_PASSWORD,
      clientType: "miniapp"
    })
  });
}

const bearer = (token: string) => ({
  "content-type": "application/json",
  authorization: `Bearer ${token}`
});

async function acceptedCuttingOrder() {
  const client = await login({ username: "client-own@sample-room.test" });
  const created = await jsonRequest("/api/client/orders", {
    method: "POST",
    headers: bearer(client.body.token as string),
    body: JSON.stringify({
      styleNo: "FORMAL-SCAN-CUTTING",
      styleName: "Formal scan cutting",
      quantity: 3,
      sampleType: "first_sample",
      sampleRound: "round_1",
      patternStatus: "none",
      deliveryDate: "2026-07-31"
    })
  });
  expect(created.response.status).toBe(201);
  const orderId = (created.body.order as JsonValue).id as string;

  const receiver = await login({ username: "receiver@sample-room.test" });
  const receiverHeaders = bearer(receiver.body.token as string);
  const accepted = await jsonRequest(`/api/receiver/orders/${orderId}/accept`, {
    method: "POST",
    headers: receiverHeaders,
    body: JSON.stringify({
      patternStatus: "none",
      fabricStatus: "complete",
      trimStatus: "complete",
      sampleRequestItems: [SAMPLE_REQUEST_ITEMS.cutting]
    })
  });
  expect(accepted.response.status).toBe(200);
  const link = await jsonRequest(`/api/receiver/orders/${orderId}/scan-link`, {
    headers: receiverHeaders
  });
  expect(link.response.status).toBe(200);
  return {
    orderId,
    token: (link.body.scanLink as JsonValue).token as string
  };
}

describe("Scan AccountSession actor resolution", () => {
  beforeEach(async () => {
    repository = createInMemorySampleRoomRepository();
    identityStore = new InMemoryIdentityStore();
    const app = createApp({
      repository,
      identityRepositoryContext: createInMemoryRepositoryContext(undefined, identityStore),
      env: { ...process.env, AUTH_MODE: "formal", PERSISTENCE_MODE: "memory" }
    });
    server = app.listen(0);
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test API did not bind.");
    baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it("resolves a production actor from AccountSession and writes both actor identifiers", async () => {
    const { orderId, token } = await acceptedCuttingOrder();
    const worker = await login({ phoneNumber: "13800000001" });
    const workerHeaders = bearer(worker.body.token as string);

    const state = await jsonRequest(`/api/scan/${token}`, { headers: workerHeaders });
    expect(state.response.status).toBe(200);
    expect(state.body.state).toMatchObject({ allowedAction: "complete", stage: "cutting" });

    const completed = await jsonRequest(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify({ workHours: 1, pieces: 3, note: "formal session scan" })
    });
    expect(completed.response.status).toBe(200);
    expect(await repository.listScanRecordsByOrderId(orderId)).toEqual([
      expect.objectContaining({
        actorAccountId: "formal-account-worker-cutting",
        workerProfileId: "formal-worker-profile-cutting",
        actorType: "production_worker"
      })
    ]);
  });

  it("rejects an existing AccountSession immediately after its Account is suspended", async () => {
    const { token } = await acceptedCuttingOrder();
    const worker = await login({ phoneNumber: "13800000001" });
    const account = identityStore.accounts.find(
      (item) => item.id === "formal-account-worker-cutting"
    )!;
    account.status = "suspended";

    const result = await jsonRequest(`/api/scan/${token}`, {
      headers: bearer(worker.body.token as string)
    });
    expect(result.response.status).toBe(401);
    expect(result.body).toEqual({ error: "unauthenticated" });
  });
});
