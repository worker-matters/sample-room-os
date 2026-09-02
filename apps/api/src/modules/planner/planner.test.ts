import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INTAKE_STATUSES,
  MATERIAL_STATUSES,
  ORDER_STAGES,
  PATTERN_STATUSES,
  ROLES
} from "@sample-room/shared";
import { createApp } from "../../app.js";
import type { FileStorageAdapter } from "../files/fileStorageAdapter.js";
import {
  createInMemorySampleRoomRepository,
  type SampleRoomRepository
} from "../../db/repositories/sampleRoomRepository.js";

let server: Server;
let baseUrl: string;
let repository: SampleRoomRepository;
let storedFiles: Map<string, Buffer>;

function headers(role: string, userId = `mock-${role}`) {
  return {
    "content-type": "application/json",
    "x-dev-role": role,
    "x-dev-user-id": userId
  };
}

async function jsonRequest(pathname: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = (await response.json()) as Record<string, unknown>;
  return { response, body };
}

beforeEach(async () => {
  repository = createInMemorySampleRoomRepository();
  storedFiles = new Map();
  const fileStorage: FileStorageAdapter = {
    async saveFile(input) {
      const storageKey = `test/${input.originalName}`;
      storedFiles.set(storageKey, input.buffer ?? Buffer.alloc(0));
      return {
        storageKey,
        originalName: input.originalName,
        contentType: input.contentType,
        sizeBytes: input.buffer?.length ?? input.sizeBytes ?? 0,
        checksum: "test-checksum",
        createdAt: new Date().toISOString()
      };
    },
    async readFile(storageKey) {
      const content = storedFiles.get(storageKey);
      if (!content) throw new Error("missing test file");
      return content;
    },
    async statFile(storageKey) {
      const content = storedFiles.get(storageKey);
      if (!content) throw new Error("missing test file");
      return { storageKey, sizeBytes: content.length };
    },
    async deleteFile(storageKey) {
      storedFiles.delete(storageKey);
    },
    async fileExists(storageKey) {
      return storedFiles.has(storageKey);
    }
  };
  const app = createApp({ repository, fileStorage, env: { ...process.env, AUTH_MODE: "dev" } });
  server = app.listen(0);

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
});

async function createSewingWaitingOrder() {
  return repository.createOrder({
    customerId: "mock-customer-active",
    clientUserId: "mock-client-user-active",
    sourceType: "receiver_self_entry",
    createdBy: "mock-receiver",
    styleNo: "PLANNER-SEW-001",
    styleName: "Planner Sewing Order",
    quantity: 8,
    sampleType: "first_sample",
    sampleRound: "round_1",
    deliveryDate: "2026-06-30",
    intakeStatus: INTAKE_STATUSES.received,
    stage: ORDER_STAGES.sewingWaiting,
    patternStatus: PATTERN_STATUSES.has,
    fabricStatus: MATERIAL_STATUSES.complete,
    trimStatus: MATERIAL_STATUSES.complete
  });
}

describe("planner workflow API", () => {
  it("lets planners upload arbitrary attachment formats and delete only their own records", async () => {
    const order = await createSewingWaitingOrder();
    const uploaded = await jsonRequest(`/api/planner/orders/${order.id}/attachments`, {
      method: "POST",
      headers: headers(ROLES.planner, "planner-owner"),
      body: JSON.stringify({
        attachments: [{ fileName: "工艺资料.custom-format", mimeType: "application/octet-stream", size: 17 }]
      })
    });
    const attachment = (uploaded.body.attachments as Array<Record<string, unknown>>)[0]!;
    expect(uploaded.response.status).toBe(201);
    expect(attachment).toMatchObject({
      fileName: "工艺资料.custom-format",
      uploadedBy: "planner-owner",
      uploadedByRole: ROLES.planner,
      category: "planner_upload",
      visibility: "internal_only"
    });

    const denied = await jsonRequest(`/api/planner/orders/${order.id}/attachments/${attachment.id}`, {
      method: "DELETE",
      headers: headers(ROLES.planner, "planner-other")
    });
    expect(denied.response.status).toBe(403);

    const deleted = await jsonRequest(`/api/planner/orders/${order.id}/attachments/${attachment.id}`, {
      method: "DELETE",
      headers: headers(ROLES.planner, "planner-owner")
    });
    expect(deleted.response.status).toBe(200);
    expect(await repository.listOrderAttachments(order.id)).toEqual([]);
    expect(await repository.listAttachmentAuditLogs(order.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "upload", originalFileName: "工艺资料.custom-format" }),
        expect.objectContaining({ action: "delete", actorId: "planner-owner" })
      ])
    );
  });

  it("lets planner see current order stages and keeps client users out", async () => {
    const order = await createSewingWaitingOrder();
    storedFiles.set("planner/reference.jpg", Buffer.from("planner-reference"));
    storedFiles.set("planner/pattern.dxf", Buffer.from("planner-pattern"));
    const attachment = await repository.createOrderAttachment({
      orderId: order.id,
      fileName: "reference.jpg",
      mimeType: "image/jpeg",
      size: 17,
      category: "client_reference",
      uploadedBy: "mock-client-user-active",
      uploadedByRole: ROLES.clientBusinessUser,
      visibility: "client_visible",
      storageKey: "planner/reference.jpg"
    });
    const task = await repository.createPatternTask({
      orderId: order.id,
      status: "active",
      requirements: ["pattern_making"],
      patternMakerId: "mock-pattern-maker",
      patternMakerName: "Pattern Maker"
    });
    const deliverable = await repository.createPatternDeliverable({
      orderId: order.id,
      patternTaskId: task.id,
      version: "V1",
      type: "pattern_file",
      fileName: "pattern.dxf",
      mimeType: "application/octet-stream",
      size: 15,
      storageKey: "planner/pattern.dxf",
      taskCategory: "pattern_making",
      visibility: "internal_only",
      uploadedBy: "mock-pattern-maker"
    });

    const plannerList = await jsonRequest("/api/planner/orders", {
      headers: headers(ROLES.planner, "mock-planner")
    });
    const clientAttempt = await jsonRequest("/api/planner/orders", {
      headers: {
        ...headers(ROLES.clientBusinessUser, "mock-client-user-active"),
        "x-dev-customer-id": "mock-customer-active",
        "x-dev-client-user-id": "mock-client-user-active"
      }
    });

    expect(plannerList.response.status).toBe(200);
    expect((plannerList.body.orders as Array<Record<string, unknown>>)[0]).toMatchObject({
      styleNo: "PLANNER-SEW-001",
      stage: ORDER_STAGES.sewingWaiting,
      stageLabel: "待缝制",
      sampleRequestItems: expect.any(Array),
      completionStatus: "in_progress",
      attachmentCount: 1,
      attachments: [expect.objectContaining({ id: attachment.id, hasFile: true })],
      patternTask: {
        status: "active",
        completedRequirements: ["pattern_making"],
        deliverables: [expect.objectContaining({ id: deliverable.id, fileName: "pattern.dxf" })]
      },
      scanRecords: []
    });
    const serialized = JSON.stringify(plannerList.body);
    expect(serialized).not.toContain("scanToken");
    expect(serialized).not.toContain("storageKey");
    expect(serialized).not.toContain("localPath");
    expect(serialized).not.toContain("internalCost");
    expect(serialized).not.toContain("profit");
    expect(clientAttempt.response.status).toBe(403);

    const attachmentDownload = await fetch(
      `${baseUrl}/api/planner/orders/${order.id}/attachments/${attachment.id}/download`,
      { headers: headers(ROLES.planner, "mock-planner") }
    );
    const deliverableDownload = await fetch(
      `${baseUrl}/api/planner/orders/${order.id}/pattern-deliverables/${deliverable.id}/download`,
      { headers: headers(ROLES.planner, "mock-planner") }
    );
    const receiverDenied = await fetch(
      `${baseUrl}/api/planner/orders/${order.id}/attachments/${attachment.id}/download`,
      { headers: headers(ROLES.receiver, "mock-receiver") }
    );
    expect(attachmentDownload.status).toBe(200);
    expect(await attachmentDownload.text()).toBe("planner-reference");
    expect(deliverableDownload.status).toBe(200);
    expect(await deliverableDownload.text()).toBe("planner-pattern");
    expect(receiverDenied.status).toBe(403);
  });

  it("returns the order source and a safe current creator display name", async () => {
    await repository.createOrder({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      sourceType: "receiver_self_entry",
      createdBy: "formal-account-receiver",
      styleNo: "PLANNER-CREATOR-MAPPED",
      styleName: "Mapped creator",
      quantity: 1,
      sampleType: "first_sample",
      sampleRound: "round_1",
      deliveryDate: "2026-06-30",
      intakeStatus: INTAKE_STATUSES.received,
      stage: ORDER_STAGES.sewingWaiting,
      patternStatus: PATTERN_STATUSES.none,
      fabricStatus: MATERIAL_STATUSES.complete,
      trimStatus: MATERIAL_STATUSES.complete
    });
    await repository.createOrder({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      sourceType: "client_submission",
      createdBy: "internal-account-id-not-for-display",
      styleNo: "PLANNER-CREATOR-FALLBACK",
      styleName: "Fallback creator",
      quantity: 1,
      sampleType: "first_sample",
      sampleRound: "round_1",
      deliveryDate: "2026-06-30",
      intakeStatus: INTAKE_STATUSES.received,
      stage: ORDER_STAGES.sewingWaiting,
      patternStatus: PATTERN_STATUSES.none,
      fabricStatus: MATERIAL_STATUSES.complete,
      trimStatus: MATERIAL_STATUSES.complete
    });

    const plannerList = await jsonRequest("/api/planner/orders", {
      headers: headers(ROLES.planner, "mock-planner")
    });
    const orders = plannerList.body.orders as Array<Record<string, unknown>>;
    const mapped = orders.find((order) => order.styleNo === "PLANNER-CREATOR-MAPPED");
    const fallback = orders.find((order) => order.styleNo === "PLANNER-CREATOR-FALLBACK");

    expect(plannerList.response.status).toBe(200);
    expect(mapped).toMatchObject({
      sourceType: "receiver_self_entry",
      createdByName: "Receiver"
    });
    expect(fallback).toMatchObject({
      sourceType: "client_submission",
      createdByName: "客户 A 普通业务员"
    });
    expect(mapped).not.toHaveProperty("createdBy");
    expect(fallback).not.toHaveProperty("createdBy");
    expect(JSON.stringify(plannerList.body)).not.toContain("internal-account-id-not-for-display");
  });

  it("hides receiver intake-only orders from planner visibility", async () => {
    await repository.createOrder({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      sourceType: "client_submission",
      createdBy: "mock-client-user-active",
      styleNo: "PLANNER-PENDING-RECEIVE",
      styleName: "Planner Pending Receive",
      quantity: 1,
      sampleType: "first_sample",
      sampleRound: "round_1",
      deliveryDate: "2026-06-30",
      intakeStatus: INTAKE_STATUSES.pendingReceive,
      stage: null,
      patternStatus: PATTERN_STATUSES.none,
      fabricStatus: MATERIAL_STATUSES.missing,
      trimStatus: MATERIAL_STATUSES.missing
    });
    await repository.createOrder({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      sourceType: "client_submission",
      createdBy: "mock-client-user-active",
      styleNo: "PLANNER-NEEDS-SUPPLEMENT",
      styleName: "Planner Needs Supplement",
      quantity: 1,
      sampleType: "first_sample",
      sampleRound: "round_1",
      deliveryDate: "2026-06-30",
      intakeStatus: INTAKE_STATUSES.needsClientSupplement,
      stage: null,
      patternStatus: PATTERN_STATUSES.none,
      fabricStatus: MATERIAL_STATUSES.missing,
      trimStatus: MATERIAL_STATUSES.missing
    });
    await createSewingWaitingOrder();

    const plannerList = await jsonRequest("/api/planner/orders", {
      headers: headers(ROLES.planner, "mock-planner")
    });
    const styleNos = (plannerList.body.orders as Array<Record<string, unknown>>).map(
      (order) => order.styleNo
    );

    expect(plannerList.response.status).toBe(200);
    expect(styleNos).toEqual(["PLANNER-SEW-001"]);
    expect(styleNos).not.toContain("PLANNER-PENDING-RECEIVE");
    expect(styleNos).not.toContain("PLANNER-NEEDS-SUPPLEMENT");
  });

  it("closes system-side sewing assignment because sewing workers start tasks by scan", async () => {
    const order = await createSewingWaitingOrder();

    const assigned = await jsonRequest(`/api/planner/orders/${order.id}/assign-sewing`, {
      method: "POST",
      headers: headers(ROLES.planner, "mock-planner"),
      body: JSON.stringify({ workerProfileId: "must-not-be-used" })
    });
    expect(assigned.response.status).toBe(410);
    expect(assigned.body.error).toBe(
      "planner sewing assignment is closed; sewing workers start tasks by scan."
    );
    const updated = await repository.findOrderById(order.id);
    const records = await repository.listScanRecordsByOrderId(order.id);
    const receiverAttempt = await jsonRequest(`/api/planner/orders/${order.id}/assign-sewing`, {
      method: "POST",
      headers: headers(ROLES.receiver, "mock-receiver"),
      body: JSON.stringify({ workerProfileId: "must-not-be-used" })
    });

    expect(updated?.stage).toBe(ORDER_STAGES.sewingWaiting);
    expect(records).toHaveLength(0);
    expect(receiverAttempt.response.status).toBe(403);
  });
});
