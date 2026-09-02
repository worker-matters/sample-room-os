import { request as nodeHttpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ATTACHMENT_VISIBILITY, ROLES } from "@sample-room/shared";
import { createApp } from "../../app.js";
import {
  createInMemorySampleRoomRepository,
  type SampleRoomRepository
} from "../../db/repositories/sampleRoomRepository.js";
import { LocalFileStorageAdapter } from "../files/localFileStorageAdapter.js";

type JsonValue = Record<string, unknown>;

let server: Server;
let baseUrl: string;
let repository: SampleRoomRepository;
let storageRoot: string;
let storage: LocalFileStorageAdapter;

function jsonHeaders(
  role: string,
  options: { userId?: string; customerId?: string; clientUserId?: string; scope?: string } = {}
) {
  return {
    "content-type": "application/json",
    ...devHeaders(role, options)
  };
}

function devHeaders(
  role: string,
  options: { userId?: string; customerId?: string; clientUserId?: string; scope?: string } = {}
) {
  const result: Record<string, string> = {
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

  if (options.scope) {
    result["x-dev-client-access-scope"] = options.scope;
  }

  return result;
}

async function jsonRequest(pathname: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = (await response.json()) as JsonValue;
  return { response, body };
}

async function downloadRequest(pathname: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const content = Buffer.from(await response.arrayBuffer());
  return { response, content };
}

function uploadForm(
  fileName: string,
  content: string,
  category = "client_reference",
  options: { visibility?: string; contentType?: string } = {}
) {
  const form = new FormData();
  form.append("files", new Blob([content], { type: options.contentType ?? "text/plain" }), fileName);
  form.append("category", category);
  if (options.visibility) {
    form.append("visibility", options.visibility);
  }
  return form;
}

async function createClientOrder(styleNo: string) {
  return jsonRequest("/api/client/orders", {
    method: "POST",
    headers: jsonHeaders(ROLES.clientBusinessUser),
    body: JSON.stringify({
      styleNo,
      styleName: `File Storage ${styleNo}`,
      quantity: 1,
      sampleType: "first_sample",
      sampleRound: "round_1",
      patternStatus: "none",
      deliveryDate: "2026-06-30"
    })
  });
}

async function createReceiverSelfEntry(styleNo: string) {
  const body = new FormData();
  const payload = {
    customerId: "mock-customer-active",
    clientUserId: "mock-client-user-active",
    patternStatus: "has",
    styleNo,
    styleName: `Receiver File Storage ${styleNo}`,
    quantity: 1,
    sampleType: "first_sample",
    sampleRound: "round_1",
    deliveryDate: "2026-07-08"
  };
  body.append("multipartPayload", JSON.stringify(payload));
  body.append(
    "files",
    new Blob(["required sample sheet"], { type: "application/pdf" }),
    `${styleNo}-sample-sheet.pdf`
  );
  body.append("category", "receiver_quick_photo");
  body.append("visibility", ATTACHMENT_VISIBILITY.clientVisible);

  return jsonRequest("/api/receiver/orders/self-entry", {
    method: "POST",
    headers: devHeaders(ROLES.receiver),
    body
  });
}

describe("attachment file storage API", () => {
  beforeEach(async () => {
    storageRoot = await mkdtemp(path.join(os.tmpdir(), "sample-room-api-storage-"));
    storage = new LocalFileStorageAdapter(storageRoot);
    repository = createInMemorySampleRoomRepository();
    server = createApp({ repository, fileStorage: storage, env: { ...process.env, AUTH_MODE: "dev" } }).listen(0);

    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test API did not bind to a TCP port.");
    }

    baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
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
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("stores and downloads client-visible file bytes with client/customer isolation", async () => {
    const created = await createClientOrder("FILE-CLIENT-001");
    const orderId = (created.body.order as JsonValue).id as string;
    const fileText = "client-visible attachment bytes";
    const chineseFileName = "客户打样单_中文文件名.xlsx";
    const mojibakeFileName = Buffer.from(chineseFileName, "utf8").toString("latin1");

    const uploaded = await jsonRequest(`/api/client/orders/${orderId}/attachments`, {
      method: "POST",
      headers: devHeaders(ROLES.clientBusinessUser),
      body: uploadForm(mojibakeFileName, fileText, "client_reference", {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        visibility: ATTACHMENT_VISIBILITY.internalOnly
      })
    });
    const attachment = (uploaded.body.attachments as JsonValue[])[0]!;
    const stored = (await repository.listOrderAttachments(orderId))[0]!;

    expect(uploaded.response.status).toBe(201);
    expect(attachment).toMatchObject({
      fileName: chineseFileName,
      mimeType: "application/octet-stream",
      hasFile: true,
      visibility: "client_visible"
    });
    expect(attachment).not.toHaveProperty("storageKey");
    expect(stored.storageKey).toMatch(/^Orders\//);
    await expect(storage.fileExists(stored.storageKey!)).resolves.toBe(true);

    const ownDownload = await downloadRequest(
      `/api/client/orders/${orderId}/attachments/${attachment.id as string}/download`,
      { headers: devHeaders(ROLES.clientBusinessUser) }
    );
    expect(ownDownload.response.status).toBe(200);
    expect(ownDownload.response.headers.get("content-disposition") ?? "").toContain(
      `filename*=UTF-8''${encodeURIComponent(chineseFileName)}`
    );
    expect(ownDownload.content.toString("utf8")).toBe(fileText);

    const customerAdminDownload = await downloadRequest(
      `/api/client/orders/${orderId}/attachments/${attachment.id as string}/download`,
      {
        headers: devHeaders(ROLES.clientBusinessUser, {
          userId: "mock-client-user-admin",
          customerId: "mock-customer-active",
          clientUserId: "mock-client-user-admin",
          scope: "customer_all"
        })
      }
    );
    expect(customerAdminDownload.response.status).toBe(200);
    expect(customerAdminDownload.content.toString("utf8")).toBe(fileText);

    const otherCustomerDownload = await downloadRequest(
      `/api/client/orders/${orderId}/attachments/${attachment.id as string}/download`,
      {
        headers: devHeaders(ROLES.clientBusinessUser, {
          userId: "mock-client-user-other",
          customerId: "mock-customer-other",
          clientUserId: "mock-client-user-other",
          scope: "own"
        })
      }
    );
    expect(otherCustomerDownload.response.status).toBe(404);
  });

  it("stores receiver client-visible file bytes and exposes them to allowed same-customer clients", async () => {
    const created = await createReceiverSelfEntry("FILE-RECEIVER-001");
    const orderId = (created.body.order as JsonValue).id as string;
    const fileText = "receiver client-visible attachment bytes";

    const uploaded = await jsonRequest(`/api/receiver/orders/${orderId}/attachments`, {
      method: "POST",
      headers: devHeaders(ROLES.receiver),
      body: uploadForm("receiver-note.txt", fileText, "client_result", {
        visibility: ATTACHMENT_VISIBILITY.clientVisible
      })
    });
    const attachment = (uploaded.body.attachments as JsonValue[])[0]!;
    const stored = (await repository.listOrderAttachments(orderId)).find(
      (item) => item.fileName === "receiver-note.txt"
    )!;

    expect(uploaded.response.status).toBe(201);
    expect(attachment).toMatchObject({
      fileName: "receiver-note.txt",
      hasFile: true,
      visibility: "client_visible"
    });
    expect(attachment).not.toHaveProperty("storageKey");
    await expect(storage.fileExists(stored.storageKey!)).resolves.toBe(true);

    const receiverDownload = await downloadRequest(
      `/api/receiver/orders/${orderId}/attachments/${attachment.id as string}/download`,
      { headers: devHeaders(ROLES.receiver) }
    );
    expect(receiverDownload.response.status).toBe(200);
    expect(receiverDownload.content.toString("utf8")).toBe(fileText);

    const clientList = await jsonRequest(`/api/client/orders/${orderId}/attachments`, {
      headers: jsonHeaders(ROLES.clientBusinessUser)
    });
    expect((clientList.body.attachments as JsonValue[]).map((item) => item.fileName)).toEqual(
      expect.arrayContaining(["FILE-RECEIVER-001-sample-sheet.pdf", "receiver-note.txt"])
    );

    const clientDownload = await downloadRequest(
      `/api/client/orders/${orderId}/attachments/${attachment.id as string}/download`,
      { headers: devHeaders(ROLES.clientBusinessUser) }
    );
    expect(clientDownload.response.status).toBe(200);
    expect(clientDownload.content.toString("utf8")).toBe(fileText);

    const customerAdminDownload = await downloadRequest(
      `/api/client/orders/${orderId}/attachments/${attachment.id as string}/download`,
      {
        headers: devHeaders(ROLES.clientBusinessUser, {
          userId: "mock-client-user-admin",
          customerId: "mock-customer-active",
          clientUserId: "mock-client-user-admin",
          scope: "customer_all"
        })
      }
    );
    expect(customerAdminDownload.response.status).toBe(200);
    expect(customerAdminDownload.content.toString("utf8")).toBe(fileText);

    const otherCustomerDownload = await downloadRequest(
      `/api/client/orders/${orderId}/attachments/${attachment.id as string}/download`,
      {
        headers: devHeaders(ROLES.clientBusinessUser, {
          userId: "mock-client-user-other",
          customerId: "mock-customer-other",
          clientUserId: "mock-client-user-other",
          scope: "own"
        })
      }
    );
    expect(otherCustomerDownload.response.status).toBe(404);
  });

  it("downloads the receiver-selected style thumbnail through the manager read-only endpoint", async () => {
    const body = new FormData();
    body.append("multipartPayload", JSON.stringify({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      quantity: 1,
      sampleRequestItems: ["cutting"],
      thumbnailAttachmentIndex: 1
    }));
    body.append("files", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "sample-sheet.jpg");
    body.append("files", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "chosen-thumbnail.jpg");
    body.append("attachmentMetadata", JSON.stringify([
      { category: "receiver_sample_sheet", visibility: "internal_only" },
      { category: "receiver_quick_photo", visibility: "internal_only" }
    ]));

    const created = await jsonRequest("/api/receiver/orders/quick-photo", {
      method: "POST",
      headers: devHeaders(ROLES.receiver),
      body
    });
    const orderId = (created.body.order as JsonValue).id as string;
    const storedAttachments = await repository.listOrderAttachments(orderId);
    const thumbnail = storedAttachments.find((attachment) => attachment.category === "style_thumbnail");

    expect(created.response.status).toBe(201);
    expect(thumbnail).toMatchObject({
      fileName: "chosen-thumbnail.jpg",
      mimeType: "image/jpeg"
    });
    expect(thumbnail?.storageKey).toBeTruthy();

    const selected = await jsonRequest(`/api/receiver/orders/${orderId}/sample-sheet-attachment`, {
      method: "PATCH",
      headers: jsonHeaders(ROLES.receiver),
      body: JSON.stringify({ attachmentId: thumbnail!.id })
    });
    expect(selected.response.status).toBe(200);
    expect((selected.body.attachments as JsonValue[]).find((attachment) => attachment.id === thumbnail!.id))
      .toMatchObject({ category: "style_thumbnail" });
    expect((selected.body.attachments as JsonValue[]).find((attachment) => attachment.fileName === "sample-sheet.jpg"))
      .toMatchObject({ category: "receiver_attachment" });

    const [bossList, systemOwnerList] = await Promise.all([
      jsonRequest("/api/admin/orders", { headers: jsonHeaders(ROLES.boss) }),
      jsonRequest("/api/admin/orders", { headers: jsonHeaders(ROLES.systemOwner) })
    ]);
    const bossOrder = (bossList.body.orders as JsonValue[]).find((order) => order.id === orderId)!;
    const systemOwnerOrder = (systemOwnerList.body.orders as JsonValue[]).find(
      (order) => order.id === orderId
    )!;
    const bossThumbnail = (bossOrder.attachments as JsonValue[]).find(
      (attachment) => attachment.category === "style_thumbnail"
    )!;
    const systemOwnerThumbnail = (systemOwnerOrder.attachments as JsonValue[]).find(
      (attachment) => attachment.category === "style_thumbnail"
    )!;

    expect(bossThumbnail).toMatchObject({
      id: thumbnail?.id,
      category: "style_thumbnail",
      hasFile: true
    });
    expect(systemOwnerThumbnail).toEqual(bossThumbnail);
    expect(JSON.stringify(bossOrder)).not.toContain("storageKey");
    expect(JSON.stringify(bossOrder)).not.toContain("checksum");
    expect(JSON.stringify(bossOrder)).not.toContain("relativePath");

    const downloadPath =
      `/api/admin/orders/${orderId}/attachments/${thumbnail!.id}/download`;
    const receiverDownloadPath =
      `/api/receiver/orders/${orderId}/attachments/${thumbnail!.id}/download`;
    const [
      bossDownload,
      systemOwnerDownload,
      clientDownload,
      workerDownload,
      receiverDownload,
      systemOwnerReceiverWorkflowDownload
    ] =
      await Promise.all([
        downloadRequest(downloadPath, { headers: devHeaders(ROLES.boss) }),
        downloadRequest(downloadPath, { headers: devHeaders(ROLES.systemOwner) }),
        downloadRequest(downloadPath, { headers: devHeaders(ROLES.clientBusinessUser) }),
        downloadRequest(downloadPath, { headers: devHeaders(ROLES.worker) }),
        downloadRequest(receiverDownloadPath, { headers: devHeaders(ROLES.receiver) }),
        downloadRequest(receiverDownloadPath, { headers: devHeaders(ROLES.systemOwner) })
      ]);

    expect(bossDownload.response.status).toBe(200);
    expect(bossDownload.content).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(systemOwnerDownload.response.status).toBe(200);
    expect(systemOwnerDownload.content).toEqual(bossDownload.content);
    expect(clientDownload.response.status).toBe(403);
    expect(workerDownload.response.status).toBe(403);
    expect(receiverDownload.response.status).toBe(200);
    expect(systemOwnerReceiverWorkflowDownload.response.status).toBe(403);
  });

  it("stores receiver internal file bytes without exposing them to clients", async () => {
    const created = await createReceiverSelfEntry("FILE-RECEIVER-002");
    const orderId = (created.body.order as JsonValue).id as string;
    const fileText = "receiver internal attachment bytes";

    const uploaded = await jsonRequest(`/api/receiver/orders/${orderId}/attachments`, {
      method: "POST",
      headers: devHeaders(ROLES.receiver),
      body: uploadForm("receiver-internal-note.txt", fileText, "internal_pattern", {
        visibility: ATTACHMENT_VISIBILITY.internalOnly
      })
    });
    const attachment = (uploaded.body.attachments as JsonValue[])[0]!;
    const stored = (await repository.listOrderAttachments(orderId)).find(
      (item) => item.fileName === "receiver-internal-note.txt"
    )!;

    expect(uploaded.response.status).toBe(201);
    expect(attachment).toMatchObject({
      fileName: "receiver-internal-note.txt",
      hasFile: true,
      visibility: "internal_only"
    });
    expect(attachment).not.toHaveProperty("storageKey");
    await expect(storage.fileExists(stored.storageKey!)).resolves.toBe(true);

    const receiverDownload = await downloadRequest(
      `/api/receiver/orders/${orderId}/attachments/${attachment.id as string}/download`,
      { headers: devHeaders(ROLES.receiver) }
    );
    expect(receiverDownload.response.status).toBe(200);
    expect(receiverDownload.content.toString("utf8")).toBe(fileText);

    const clientList = await jsonRequest(`/api/client/orders/${orderId}/attachments`, {
      headers: jsonHeaders(ROLES.clientBusinessUser)
    });
    expect((clientList.body.attachments as JsonValue[]).map((item) => item.fileName)).toEqual([
      "FILE-RECEIVER-002-sample-sheet.pdf"
    ]);

    const clientDownload = await downloadRequest(
      `/api/client/orders/${orderId}/attachments/${attachment.id as string}/download`,
      { headers: devHeaders(ROLES.clientBusinessUser) }
    );
    expect(clientDownload.response.status).toBe(404);

    const customerAdminDownload = await downloadRequest(
      `/api/client/orders/${orderId}/attachments/${attachment.id as string}/download`,
      {
        headers: devHeaders(ROLES.clientBusinessUser, {
          userId: "mock-client-user-admin",
          customerId: "mock-customer-active",
          clientUserId: "mock-client-user-admin",
          scope: "customer_all"
        })
      }
    );
    expect(customerAdminDownload.response.status).toBe(404);

    const managerPath =
      `/api/admin/orders/${orderId}/attachments/${attachment.id as string}/download`;
    const [clientManagerDownload, workerManagerDownload] = await Promise.all([
      downloadRequest(managerPath, { headers: devHeaders(ROLES.clientBusinessUser) }),
      downloadRequest(managerPath, { headers: devHeaders(ROLES.worker) })
    ]);
    expect(clientManagerDownload.response.status).toBe(403);
    expect(workerManagerDownload.response.status).toBe(403);
  });

  it("moves the existing receiver file when selecting and replacing the sample sheet", async () => {
    const created = await createReceiverSelfEntry("FILE-SAMPLE-SHEET-MOVE");
    const orderId = (created.body.order as JsonValue).id as string;
    const uploaded = await jsonRequest(`/api/receiver/orders/${orderId}/attachments`, {
      method: "POST",
      headers: devHeaders(ROLES.receiver),
      body: uploadForm("replacement.pdf", "%PDF-replacement", "receiver_attachment", { contentType: "application/pdf", visibility: "client_visible" })
    });
    const replacementId = ((uploaded.body.attachments as JsonValue[])[0] as JsonValue).id as string;
    const before = await repository.listOrderAttachments(orderId);
    const oldSample = before.find((attachment) => attachment.category === "receiver_sample_sheet")!;
    const replacement = before.find((attachment) => attachment.id === replacementId)!;
    const selected = await jsonRequest(`/api/receiver/orders/${orderId}/sample-sheet-attachment`, {
      method: "PATCH",
      headers: jsonHeaders(ROLES.receiver),
      body: JSON.stringify({ attachmentId: replacementId })
    });
    expect(selected.response.status).toBe(200);
    const after = await repository.listOrderAttachments(orderId);
    const nextSample = after.find((attachment) => attachment.id === replacementId)!;
    const demoted = after.find((attachment) => attachment.id === oldSample.id)!;
    expect(nextSample.storageKey).toContain("/03_接单员/打样单/");
    expect(demoted.storageKey).toContain("/03_接单员/普通附件/");
    await expect(storage.fileExists(replacement.storageKey!)).resolves.toBe(false);
    await expect(storage.fileExists(oldSample.storageKey!)).resolves.toBe(false);
    await expect(storage.fileExists(nextSample.storageKey!)).resolves.toBe(true);
    await expect(storage.fileExists(demoted.storageKey!)).resolves.toBe(true);
  });

  it("restores moved sample-sheet files when the database update fails", async () => {
    const created = await createReceiverSelfEntry("FILE-SAMPLE-SHEET-ROLLBACK");
    const orderId = (created.body.order as JsonValue).id as string;
    const uploaded = await jsonRequest(`/api/receiver/orders/${orderId}/attachments`, {
      method: "POST",
      headers: devHeaders(ROLES.receiver),
      body: uploadForm("rollback.pdf", "%PDF-rollback", "receiver_attachment", { contentType: "application/pdf", visibility: "client_visible" })
    });
    const replacementId = ((uploaded.body.attachments as JsonValue[])[0] as JsonValue).id as string;
    const before = await repository.listOrderAttachments(orderId);
    const originalKeys = new Map(before.map((attachment) => [attachment.id, attachment.storageKey]));
    repository.withTransaction = async () => { throw new Error("forced database failure"); };
    const selected = await jsonRequest(`/api/receiver/orders/${orderId}/sample-sheet-attachment`, {
      method: "PATCH",
      headers: jsonHeaders(ROLES.receiver),
      body: JSON.stringify({ attachmentId: replacementId })
    });
    expect(selected.response.status).toBe(500);
    const after = await repository.listOrderAttachments(orderId);
    expect(after.map((attachment) => ({ id: attachment.id, category: attachment.category, storageKey: attachment.storageKey })))
      .toEqual(before.map((attachment) => ({ id: attachment.id, category: attachment.category, storageKey: attachment.storageKey })));
    for (const storageKey of originalKeys.values()) await expect(storage.fileExists(storageKey!)).resolves.toBe(true);
  });

  it("downloads only client-visible pattern deliverables through the client endpoint", async () => {
    const created = await createClientOrder("CLIENT-PATTERN-DOWNLOAD");
    const orderId = ((created.body.order as JsonValue).id) as string;
    const task = await repository.createPatternTask({
      orderId,
      status: "completed",
      requirements: ["pattern_making"],
      completedRequirements: ["pattern_making"]
    });
    const visibleStored = await storage.saveFile({
      orderId,
      orderFolderRelativePath: "test/2026/Q3/test/PATTERN",
      category: "pattern_file",
      uploaderRole: "pattern_maker",
      originalName: "visible.dxf",
      contentType: "application/octet-stream",
      buffer: Buffer.from("visible-pattern")
    });
    const internalStored = await storage.saveFile({
      orderId,
      orderFolderRelativePath: "test/2026/Q3/test/PATTERN",
      category: "pattern_file",
      uploaderRole: "pattern_maker",
      originalName: "internal.dxf",
      contentType: "application/octet-stream",
      buffer: Buffer.from("internal-pattern")
    });
    const visible = await repository.createPatternDeliverable({
      orderId,
      patternTaskId: task.id,
      version: "V1",
      type: "pattern_file",
      fileName: visibleStored.originalName,
      mimeType: visibleStored.contentType,
      size: visibleStored.sizeBytes,
      storageKey: visibleStored.storageKey,
      visibility: "client_visible",
      uploadedBy: "mock-pattern-maker"
    });
    const internal = await repository.createPatternDeliverable({
      orderId,
      patternTaskId: task.id,
      version: "V2",
      type: "pattern_file",
      fileName: internalStored.originalName,
      mimeType: internalStored.contentType,
      size: internalStored.sizeBytes,
      storageKey: internalStored.storageKey,
      visibility: "internal_only",
      uploadedBy: "mock-pattern-maker"
    });

    const visibleDownload = await downloadRequest(
      `/api/client/orders/${orderId}/pattern-deliverables/${visible.id}/download`,
      { headers: devHeaders(ROLES.clientBusinessUser) }
    );
    const internalDownload = await downloadRequest(
      `/api/client/orders/${orderId}/pattern-deliverables/${internal.id}/download`,
      { headers: devHeaders(ROLES.clientBusinessUser) }
    );
    expect(visibleDownload.response.status).toBe(200);
    expect(visibleDownload.content.toString()).toBe("visible-pattern");
    expect(internalDownload.response.status).toBe(404);
  });

  it("rejects a previously-started upload at final attachment linking after termination", async () => {
    const created = await createClientOrder("FILE-TERMINATION-RACE");
    const orderId = (created.body.order as JsonValue).id as string;
    const before = await repository.listOrderAttachments(orderId);

    const boundary = "sample-room-termination-race";
    const uploadResult = new Promise<{ status: number; body: JsonValue }>((resolve, reject) => {
      const request = nodeHttpRequest(`${baseUrl}/api/client/orders/${orderId}/attachments`, {
        method: "POST",
        headers: {
          ...devHeaders(ROLES.clientBusinessUser),
          "content-type": `multipart/form-data; boundary=${boundary}`
        }
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve({
          status: response.statusCode ?? 0,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonValue
        }));
      });
      request.on("error", reject);
      request.write(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="category"\r\n\r\nclient_reference\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="must-not-link.txt"\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        "upload started but not finished"
      );
      setTimeout(() => {
        request.end(` after termination\r\n--${boundary}--\r\n`);
      }, 100);
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const terminated = await jsonRequest(`/api/admin/orders/${orderId}/terminate`, {
      method: "POST",
      headers: jsonHeaders(ROLES.boss),
      body: JSON.stringify({ reason: "upload completed after termination" })
    });
    expect(terminated.response.status).toBe(200);

    const uploaded = await uploadResult;
    expect(uploaded.status).toBe(409);
    expect(uploaded.body.error).toBe("订单已终止，无法继续修改。");
    expect(await repository.listOrderAttachments(orderId)).toEqual(before);

    const storedPaths = await readdir(storageRoot, { recursive: true });
    expect(storedPaths.some((value) => value.toString().includes("must-not-link"))).toBe(false);
    await expect.poll(
      async () => readdir(path.join(storageRoot, ".tmp", "uploads")),
      { interval: 20, timeout: 1000 }
    ).toEqual([]);
  });
});