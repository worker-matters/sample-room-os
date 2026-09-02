import { afterEach, beforeEach } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../../app.js";
import {
  createInMemorySampleRoomRepository,
  type SampleRoomRepository
} from "../../db/repositories/sampleRoomRepository.js";
import { createInMemoryRepositoryContext } from "../../db/repositories/memory/inMemoryRepositoryContext.js";
import type { RepositoryContext } from "../../db/repositories/contracts/index.js";

export type JsonValue = Record<string, unknown>;

let server: Server;
let baseUrl: string;
export let repository: SampleRoomRepository;
export let identityRepositories: RepositoryContext;

beforeEach(async () => {
  repository = createInMemorySampleRoomRepository();
  identityRepositories = createInMemoryRepositoryContext();
  const app = createApp({
    repository,
    identityRepositoryContext: identityRepositories,
    env: { ...process.env, AUTH_MODE: "dev" }
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a port.");
      }

      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

export function headers(
  role: string,
  options: { userId?: string; customerId?: string; clientUserId?: string } = {}
) {
  const result: Record<string, string> = {
    "content-type": "application/json",
    "x-dev-role": role
  };

  if (options.userId) {
    result["x-dev-user-id"] = options.userId;
  }

  if (options.customerId) {
    result["x-dev-customer-id"] = options.customerId;
  }

  if (options.clientUserId) {
    result["x-dev-client-user-id"] = options.clientUserId;
  }

  return result;
}

export async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = (await response.json()) as JsonValue;
  return { response, body };
}

export async function rawRequest(path: string, options: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

export async function createClientOrder(
  styleNo = "ST-001",
  requestHeaders: Record<string, string> = headers("client_business_user"),
  extraPayload: Record<string, unknown> = {}
) {
  return request("/api/client/orders", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({
      styleNo,
      styleName: `Mock Style ${styleNo}`,
      quantity: 3,
      sampleType: "first_sample",
      sampleRound: "round_1",
      patternStatus: "none",
      deliveryDate: "2026-06-30",
      customerId: "payload-must-not-win",
      clientUserId: "payload-must-not-win",
      ...extraPayload
    })
  });
}

export async function createBusinessUserRequest(
  requestHeaders: Record<string, string>,
  extraPayload: Record<string, unknown> = {}
) {
  return request("/api/client/business-user-requests", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({
      businessUserName: "New Client User",
      contact: "new-user@example.com",
      roleNote: "Account request role note",
      note: "Please add this user for alpha testing.",
      ...extraPayload
    })
  });
}

export async function createReceiverSelfEntry(
  styleNo = "SELF-001",
  extraPayload: Record<string, unknown> = {}
) {
  const payload = {
    customerId: "mock-customer-active",
    clientUserId: "mock-client-user-active",
    patternStatus: "has",
    styleNo,
    styleName: `Self Style ${styleNo}`,
    quantity: 3,
    sampleType: "first_sample",
    sampleRound: "round_1",
    deliveryDate: "2026-06-30",
    ...extraPayload
  };
  const body = new FormData();
  body.append("multipartPayload", JSON.stringify(payload));
  body.append("files", new Blob(["sample sheet"], { type: "application/pdf" }), `${styleNo}-sample-sheet.pdf`);
  body.append("category", "receiver_quick_photo");
  const { "content-type": _contentType, ...requestHeaders } = headers("receiver");
  return request("/api/receiver/orders/self-entry", {
    method: "POST",
    headers: requestHeaders,
    body
  });
}
