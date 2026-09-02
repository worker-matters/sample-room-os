import { request as httpRequest } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES } from "@sample-room/shared";
import { createApp } from "../../app.js";
import { createInMemorySampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { createInMemoryRepositoryContext } from "../../db/repositories/memory/inMemoryRepositoryContext.js";
import type { FileStorageAdapter } from "./fileStorageAdapter.js";
import { AttachmentUploadSecurity } from "./attachmentUploadSecurity.js";
import { HttpError } from "../../shared/errors/httpError.js";
import { FORMAL_LOGIN_DEV_PASSWORD } from "../auth/devAuthAccounts.js";
import { assertAttachmentRequestBytes, maxAttachmentRequestBytes } from "./attachmentRouteUtils.js";

let server: Server;
let port: number;
let saveCalls: number;
let repository: ReturnType<typeof createInMemorySampleRoomRepository>;
let storageRoot: string;

const storage: FileStorageAdapter = {
  async saveFile(input) {
    saveCalls += 1;
    return {
      storageKey: `test/${input.originalName}`,
      originalName: input.originalName,
      contentType: input.contentType,
        sizeBytes: input.buffer?.length ?? input.sizeBytes ?? 0,
      checksum: "test",
      createdAt: new Date().toISOString()
    };
  },
  async readFile() { return Buffer.alloc(0); },
  async statFile(storageKey) { return { storageKey, sizeBytes: 0 }; },
  async deleteFile() {},
  async fileExists() { return false; }
};

beforeEach(async () => {
  saveCalls = 0;
  storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sample-room-upload-boundary-"));
  repository = createInMemorySampleRoomRepository();
  const app = createApp({
    repository,
    identityRepositoryContext: createInMemoryRepositoryContext(),
    fileStorage: storage,
    env: {
      ...process.env,
      NODE_ENV: "test",
      AUTH_MODE: "formal",
      PERSISTENCE_MODE: "memory",
      SAMPLE_ROOM_STORAGE_ROOT: storageRoot
    }
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
  await fs.rm(storageRoot, { recursive: true, force: true });
});

describe("attachment upload authentication order", () => {
  it("rejects a simulated aggregate byte count above 300 MiB without allocating a large fixture", () => {
    expect(() => assertAttachmentRequestBytes(maxAttachmentRequestBytes + 1)).toThrow("upload_request_too_large");
    expect(() => assertAttachmentRequestBytes(maxAttachmentRequestBytes)).not.toThrow();
  });
  async function receiverSessionToken() {
    const response = await fetch(`http://127.0.0.1:${port}/api/miniapp/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "receiver@sample-room.test",
        password: FORMAL_LOGIN_DEV_PASSWORD
      })
    });
    const body = await response.json() as { sessionToken: string };
    return body.sessionToken;
  }

  async function plannerSessionToken() {
    const response = await fetch(`http://127.0.0.1:${port}/api/miniapp/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "planner@sample-room.test",
        password: FORMAL_LOGIN_DEV_PASSWORD
      })
    });
    const body = await response.json() as { sessionToken: string };
    return body.sessionToken;
  }

  it("rejects an unauthenticated multipart upload before storing file bytes", async () => {
    const formData = new FormData();
    formData.append("files", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
      type: "image/jpeg"
    }), "unauthenticated.jpg");
    const response = await fetch(`http://127.0.0.1:${port}/api/miniapp/receiver/intake`, {
      method: "POST",
      body: formData
    });
    expect(response.status).toBe(401);
    expect(saveCalls).toBe(0);
  });

  it("returns 401 before accepting an unauthenticated declared large body", async () => {
    const before = process.memoryUsage().heapUsed;
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port,
        path: "/api/miniapp/receiver/intake",
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=security-test",
          "content-length": String(100 * 1024 * 1024)
        }
      });
      request.on("response", (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      });
      request.on("error", reject);
      request.flushHeaders();
    });
    const heapGrowth = process.memoryUsage().heapUsed - before;
    expect(status).toBe(401);
    expect(saveCalls).toBe(0);
    expect(heapGrowth).toBeLessThan(5 * 1024 * 1024);
  });

  it("rejects the wrong role before accepting a declared large multipart body", async () => {
    const sessionToken = await plannerSessionToken();
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port,
        path: "/api/miniapp/receiver/intake",
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "multipart/form-data; boundary=security-test",
          "content-length": String(100 * 1024 * 1024)
        }
      });
      request.on("response", (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      });
      request.on("error", reject);
      request.flushHeaders();
    });
    expect(status).toBe(403);
    expect(saveCalls).toBe(0);
  });

  it("rejects a thirty-first file with 413", async () => {
    const sessionToken = await receiverSessionToken();
    const formData = new FormData();
    for (let index = 0; index < 31; index += 1) {
      formData.append("files", new Blob([`file-${index}`]), `file-${index}.txt`);
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/miniapp/receiver/intake`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
      body: formData
    });
    expect(response.status).toBe(413);
    expect((await response.json() as { error: string }).error).toBe("LIMIT_FILE_COUNT");
    expect(saveCalls).toBe(0);
  });

  it("allows multipart parsing to reach business validation with thirty files", async () => {
    const sessionToken = await receiverSessionToken();
    const formData = new FormData();
    for (let index = 0; index < 30; index += 1) {
      formData.append("files", new Blob([`file-${index}`]), `file-${index}.txt`);
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/miniapp/receiver/intake`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
      body: formData
    });
    expect(response.status).not.toBe(413);
  });

  it("rejects one file above 30 MiB with 413", async () => {
    const sessionToken = await receiverSessionToken();
    const formData = new FormData();
    const bytes = new Uint8Array(30 * 1024 * 1024 + 1);
    formData.append("files", new Blob([bytes]), "too-large.bin");
    formData.append("customerId", "mock-customer-active");
    formData.append("clientUserId", "mock-client-user-active");
    const response = await fetch(`http://127.0.0.1:${port}/api/receiver/orders/quick-photo`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
      body: formData
    });
    expect(response.status).toBe(413);
    expect((await response.json() as { error: string }).error).toBe("attachment_upload_limit_exceeded");
    expect(saveCalls).toBe(0);
    expect(await repository.listOrders()).toHaveLength(0);
    const temporaryFiles = await fs.readdir(path.join(storageRoot, ".tmp", "uploads")).catch(() => []);
    expect(temporaryFiles).toHaveLength(0);
  }, 30_000);

  it("accepts a file of exactly 30 MiB through the real multipart middleware", async () => {
    const sessionToken = await receiverSessionToken();
    const formData = new FormData();
    formData.append("customerId", "mock-customer-active");
    formData.append("clientUserId", "mock-client-user-active");
    formData.append("quantity", "1");
    formData.append("sampleRequestItems", JSON.stringify(["cutting"]));
    formData.append(
      "files",
      new Blob([
        new Uint8Array([0xff, 0xd8, 0xff]),
        new Uint8Array(30 * 1024 * 1024 - 3)
      ], { type: "image/jpeg" }),
      "exactly-30-mib.bin"
    );
    const response = await fetch(`http://127.0.0.1:${port}/api/receiver/orders/quick-photo`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
      body: formData
    });
    const responseBody = await response.clone().text();
    expect(response.status, responseBody).toBe(201);
    expect(saveCalls).toBe(1);
    const orders = await repository.listOrders();
    expect(orders).toHaveLength(1);
    expect(await repository.listOrderAttachments(orders[0]!.id)).toHaveLength(1);
    await vi.waitFor(async () => {
      const temporaryFiles = await fs.readdir(path.join(storageRoot, ".tmp", "uploads")).catch(() => []);
      expect(temporaryFiles).toHaveLength(0);
    }, { timeout: 2_000, interval: 25 });
  }, 30_000);

  it("rejects excessive multipart text fields before business logic", async () => {
    const sessionToken = await receiverSessionToken();
    const formData = new FormData();
    for (let index = 0; index < 41; index += 1) {
      formData.append(`field-${index}`, "value");
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/miniapp/receiver/intake`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
      body: formData
    });
    expect(response.status).toBe(413);
    expect((await response.json() as { error: string }).error).toBe("multipart_fields_too_large");
    expect(saveCalls).toBe(0);
  });

  it("rejects one multipart text field above 64 KiB", async () => {
    const sessionToken = await receiverSessionToken();
    const formData = new FormData();
    formData.append("remark", "x".repeat(64 * 1024 + 1));
    const response = await fetch(`http://127.0.0.1:${port}/api/miniapp/receiver/intake`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
      body: formData
    });
    expect(response.status).toBe(413);
    expect(saveCalls).toBe(0);
  });

  it("rejects aggregate multipart text fields above 128 KiB", async () => {
    const sessionToken = await receiverSessionToken();
    const formData = new FormData();
    for (let index = 0; index < 3; index += 1) {
      formData.append(`field-${index}`, "x".repeat(44 * 1024));
    }
    const response = await fetch(`http://127.0.0.1:${port}/api/miniapp/receiver/intake`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
      body: formData
    });
    expect(response.status).toBe(413);
    expect(saveCalls).toBe(0);
  });
});

function fakeUploadRequest(accountId = "upload-account") {
  return Object.assign(new EventEmitter(), {
    currentUser: { id: accountId, accountId, role: ROLES.receiver },
    is: () => "multipart/form-data",
    header: () => undefined,
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    method: "POST",
    originalUrl: "/api/receiver/orders/test/attachments",
    aborted: false,
    complete: false,
    destroyed: false
  }) as unknown as Request & EventEmitter;
}

function fakeUploadResponse() {
  const response = new EventEmitter() as EventEmitter & Partial<Response>;
  response.statusCode = 200;
  response.setHeader = () => response as unknown as Response;
  return response as unknown as Response & EventEmitter;
}

async function enterUpload(
  security: AttachmentUploadSecurity,
  request: Request,
  response: Response
) {
  return new Promise<unknown>((resolve) => {
    void security.middleware(request, response, (error?: unknown) => resolve(error));
  });
}

describe("attachment upload resource guards", () => {
  it("limits concurrent uploads to twenty server-wide", async () => {
    const security = new AttachmentUploadSecurity(undefined, { NODE_ENV: "test" });
    const activeResponses: (Response & EventEmitter)[] = [];
    for (let index = 0; index < 20; index += 1) {
      const response = fakeUploadResponse();
      activeResponses.push(response);
      expect(await enterUpload(security, fakeUploadRequest(`account-${index}`), response))
        .toBeUndefined();
    }
    const rejected = await enterUpload(
      security,
      fakeUploadRequest("account-twenty-one"),
      fakeUploadResponse()
    );
    expect(rejected).toBeInstanceOf(HttpError);
    expect((rejected as HttpError).statusCode).toBe(429);
    activeResponses.forEach((response) => response.emit("finish"));
  });

  it("reserves all twenty slots before asynchronous disk checks finish", async () => {
    const diskResolvers: Array<(value: number) => void> = [];
    const security = new AttachmentUploadSecurity(
      undefined,
      { NODE_ENV: "development" },
      () => new Promise<number>((resolve) => diskResolvers.push(resolve))
    );
    const responses = Array.from({ length: 20 }, () => fakeUploadResponse());
    const pending = responses.map((response, index) =>
      enterUpload(security, fakeUploadRequest(`disk-account-${index}`), response)
    );
    await vi.waitFor(() => expect(diskResolvers).toHaveLength(20));
    const rejected = await enterUpload(
      security,
      fakeUploadRequest("disk-account-twenty-one"),
      fakeUploadResponse()
    );
    expect(rejected).toBeInstanceOf(HttpError);
    expect((rejected as HttpError).statusCode).toBe(429);
    diskResolvers.forEach((resolve) => resolve(30 * 1024 * 1024 * 1024));
    await expect(Promise.all(pending)).resolves.toEqual(Array(20).fill(undefined));
    responses.forEach((response) => response.emit("finish"));
  });

  it("releases a slot exactly once when the client aborts", async () => {
    const security = new AttachmentUploadSecurity(undefined, { NODE_ENV: "test" });
    const request = fakeUploadRequest("aborted-account");
    const response = fakeUploadResponse();
    expect(await enterUpload(security, request, response)).toBeUndefined();
    Object.assign(request, { aborted: true, destroyed: true });
    request.emit("aborted");
    response.emit("close");

    const replacements: (Response & EventEmitter)[] = [];
    for (let index = 0; index < 20; index += 1) {
      const replacement = fakeUploadResponse();
      replacements.push(replacement);
      expect(await enterUpload(
        security,
        fakeUploadRequest(`replacement-${index}`),
        replacement
      )).toBeUndefined();
    }
    replacements.forEach((replacement) => replacement.emit("finish"));
  });

  it("limits one account to six hundred upload requests in ten minutes", async () => {
    const security = new AttachmentUploadSecurity(undefined, { NODE_ENV: "test" });
    for (let index = 0; index < 600; index += 1) {
      const response = fakeUploadResponse();
      expect(await enterUpload(security, fakeUploadRequest(), response)).toBeUndefined();
      response.emit("finish");
    }
    const rejected = await enterUpload(security, fakeUploadRequest(), fakeUploadResponse());
    expect(rejected).toBeInstanceOf(HttpError);
    expect((rejected as HttpError).statusCode).toBe(429);
  });

  it("returns 507 when the configured storage volume is below 20 GiB free", async () => {
    const security = new AttachmentUploadSecurity(
      undefined,
      { NODE_ENV: "development" },
      async () => 0
    );
    const rejected = await enterUpload(security, fakeUploadRequest(), fakeUploadResponse());
    expect(rejected).toBeInstanceOf(HttpError);
    expect((rejected as HttpError).statusCode).toBe(507);
  });

  it("does not let an audit failure block a security rejection", async () => {
    const operationLogs = {
      async appendOperationLog() {
        throw new Error("audit unavailable");
      }
    } as unknown as ConstructorParameters<typeof AttachmentUploadSecurity>[0];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const security = new AttachmentUploadSecurity(operationLogs, { NODE_ENV: "test" });
    const responses: (Response & EventEmitter)[] = [];
    for (let index = 0; index < 20; index += 1) {
      const response = fakeUploadResponse();
      responses.push(response);
      expect(await enterUpload(security, fakeUploadRequest(`audit-${index}`), response))
        .toBeUndefined();
    }
    const rejected = await enterUpload(
      security,
      fakeUploadRequest("audit-twenty-one"),
      fakeUploadResponse()
    );
    expect(rejected).toBeInstanceOf(HttpError);
    expect((rejected as HttpError).statusCode).toBe(429);
    responses.forEach((response) => response.emit("finish"));
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(21));
    consoleError.mockRestore();
  });
});
