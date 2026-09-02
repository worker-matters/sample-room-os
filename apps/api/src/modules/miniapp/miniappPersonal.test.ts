import { ORDER_STAGES, ROLES, SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import type { Server } from "node:http";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createInMemoryRepositoryContext } from "../../db/repositories/memory/inMemoryRepositoryContext.js";
import { createInMemorySampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { FORMAL_LOGIN_DEV_PASSWORD } from "../auth/devAuthAccounts.js";
import {
  createReceiverSelfEntry,
  repository,
  request,
  type JsonValue
} from "../receiver/testHelpers.js";

async function workerLogin(phoneNumber = "13800000001") {
  const result = await request("/api/miniapp/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      phoneNumber,
      password: FORMAL_LOGIN_DEV_PASSWORD
    })
  });
  return result.body.sessionToken as string;
}

async function businessLogin(username: string) {
  const result = await request("/api/miniapp/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: FORMAL_LOGIN_DEV_PASSWORD })
  });
  return result.body.sessionToken as string;
}

const mobileHeaders = (sessionToken: string) => ({
  "content-type": "application/json",
  authorization: `Bearer ${sessionToken}`
});

describe("personal mobile account and performance adapter", () => {
  it("returns only the authenticated Worker's current-position performance", async () => {
    const order = await createReceiverSelfEntry("MOBILE-PERFORMANCE-OWN");
    const orderId = (order.body.order as JsonValue).id as string;
    await repository.createScanRecord({
      orderId,
      actorAccountId: "formal-account-worker-cutting",
      workerProfileId: "formal-worker-profile-cutting",
      actorType: "production_worker",
      actorRole: ROLES.worker,
      workerId: "formal-worker-profile-cutting",
      workerName: "裁剪员工一号",
      stage: "cutting",
      orderStage: ORDER_STAGES.cuttingDoing,
      action: "complete",
      scanAction: "cutting_finish",
      eventTime: "2026-07-20T08:00:00.000Z",
      workHours: 1.5,
      pieces: 6
    });

    const sessionToken = await workerLogin();
    const result = await request(
      "/api/miniapp/me/performance?dateFrom=2026-07-20&dateTo=2026-07-20" +
        "&accountId=formal-account-worker-sewing&workerProfileId=formal-worker-profile-sewing",
      { headers: mobileHeaders(sessionToken) }
    );

    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({
      worker: {
        displayName: expect.any(String),
        workerType: "cutting"
      },
      summary: {
        completedOrders: 1,
        completedPieces: 6,
        totalHours: 1.5
      },
      records: [
        {
          styleNo: "MOBILE-PERFORMANCE-OWN",
          styleName: "Self Style MOBILE-PERFORMANCE-OWN",
          completedAt: "2026-07-20T08:00:00.000Z",
          pieces: 6,
          workHours: 1.5
        }
      ]
    });
    const json = JSON.stringify(result.body);
    expect(json).not.toContain("Mock Active Customer");
    expect(json).not.toContain("customerName");
    expect(json).not.toContain("internalCost");
    expect(json).not.toContain("internalStageAmount");
    expect(json).not.toContain("grossProfit");
    expect(json).not.toContain("orderNo");
    expect(json).not.toContain("formal-account-worker-sewing");
  });

  it("rejects non-Worker Accounts from personal performance", async () => {
    const receiverToken = await businessLogin("receiver@sample-room.test");
    const result = await request("/api/miniapp/me/performance", {
      headers: mobileHeaders(receiverToken)
    });
    expect(result.response.status).toBe(403);
    expect(result.body.error).toBe("worker_miniapp_identity_required");
  });

  it("lists only the signed-in sewing worker's live tasks and completes one without exposing a scan token", async () => {
    const created = await createReceiverSelfEntry("MOBILE-SEWING-TASK", {
      patternStatus: "none",
      sampleRequestItems: [SAMPLE_REQUEST_ITEMS.sampleGarment]
    });
    const orderId = (created.body.order as JsonValue).id as string;
    await repository.updateOrder(orderId, { stage: ORDER_STAGES.sewingDoing });
    await repository.createOrderScanToken({ orderId, token: "private-sewing-task-token" });
    await repository.createScanRecord({
      orderId,
      actorAccountId: "formal-account-worker-sewing",
      workerProfileId: "formal-worker-profile-sewing",
      actorType: "production_worker",
      actorRole: ROLES.worker,
      workerId: "formal-worker-profile-sewing",
      workerName: "缝制员工一号",
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "start",
      scanAction: "sewing_start"
    });
    const token = await workerLogin("13800000002");
    const list = await request("/api/miniapp/me/sewing-tasks", { headers: mobileHeaders(token) });
    expect(list.response.status).toBe(200);
    expect(list.body.tasks).toEqual([
      expect.objectContaining({
        orderId,
        styleNo: "MOBILE-SEWING-TASK",
        styleName: "Self Style MOBILE-SEWING-TASK",
        quantity: 3,
        sampleType: "first_sample"
      })
    ]);
    expect(JSON.stringify(list.body)).not.toContain("private-sewing-task-token");

    const detail = await request(`/api/miniapp/me/sewing-tasks/${orderId}`, {
      headers: mobileHeaders(token)
    });
    expect(detail.body.state).toMatchObject({
      allowedAction: "complete",
      stage: "sewing",
      order: { sampleType: "first_sample" }
    });

    const completed = await request(`/api/miniapp/me/sewing-tasks/${orderId}/complete`, {
      method: "POST",
      headers: mobileHeaders(token),
      body: JSON.stringify({ pieces: 3, workHours: 2, note: "" })
    });
    expect(completed.response.status).toBe(200);
    const after = await request("/api/miniapp/me/sewing-tasks", { headers: mobileHeaders(token) });
    expect(after.body.tasks).toEqual([]);
  });

  it("hides a terminated owned sewing task and rejects all production submission until restore", async () => {
    const created = await createReceiverSelfEntry("MOBILE-TERMINATED-SEWING-TASK", {
      patternStatus: "none",
      sampleRequestItems: [SAMPLE_REQUEST_ITEMS.sampleGarment]
    });
    const orderId = (created.body.order as JsonValue).id as string;
    await repository.updateOrder(orderId, {
      stage: ORDER_STAGES.sewingDoing,
      terminated: true,
      terminatedAt: "2026-08-17T08:00:00.000Z"
    });
    await repository.createOrderScanToken({ orderId, token: "private-terminated-sewing-task-token" });
    await repository.createScanRecord({
      orderId,
      actorAccountId: "formal-account-worker-sewing",
      workerProfileId: "formal-worker-profile-sewing",
      actorType: "production_worker",
      actorRole: ROLES.worker,
      workerId: "formal-worker-profile-sewing",
      workerName: "缝制员工一号",
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "start",
      scanAction: "sewing_start"
    });
    const token = await workerLogin("13800000002");

    const list = await request("/api/miniapp/me/sewing-tasks", { headers: mobileHeaders(token) });
    expect(list.body.tasks).toEqual([]);
    const detail = await request(`/api/miniapp/me/sewing-tasks/${orderId}`, {
      headers: mobileHeaders(token)
    });
    expect(detail.response.status).toBe(409);
    expect(detail.body).toEqual({ error: "订单已终止" });
    const before = await repository.listScanRecordsByOrderId(orderId);

    const rejected = await request(`/api/miniapp/me/sewing-tasks/${orderId}/complete`, {
      method: "POST",
      headers: mobileHeaders(token),
      body: JSON.stringify({ pieces: 2, workHours: 1.5, note: "按普通任务提交" })
    });
    expect(rejected.response.status).toBe(409);
    expect(rejected.body).toEqual({ error: "订单已终止" });
    expect(await repository.listScanRecordsByOrderId(orderId)).toEqual(before);

    await repository.updateOrder(orderId, { terminated: false });
    const restoredList = await request("/api/miniapp/me/sewing-tasks", { headers: mobileHeaders(token) });
    expect(restoredList.body.tasks).toEqual([
      expect.objectContaining({ orderId, styleNo: "MOBILE-TERMINATED-SEWING-TASK" })
    ]);
    const completed = await request(`/api/miniapp/me/sewing-tasks/${orderId}/complete`, {
      method: "POST",
      headers: mobileHeaders(token),
      body: JSON.stringify({ pieces: 2, workHours: 1.5, note: "恢复后正常完成" })
    });
    expect(completed.response.status).toBe(200);
    expect(await repository.listScanRecordsByOrderId(orderId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "complete",
          note: "恢复后正常完成"
        })
      ])
    );
  });

  it("keeps the existing account-security API usable with a mobile Account session", async () => {
    const app = createApp({
      repository: createInMemorySampleRoomRepository(),
      identityRepositoryContext: createInMemoryRepositoryContext(),
      env: { ...process.env, AUTH_MODE: "formal", PERSISTENCE_MODE: "memory" }
    });
    let server: Server | undefined;
    try {
      const baseUrl = await new Promise<string>((resolve) => {
        server = app.listen(0, () => {
          const address = server!.address();
          if (!address || typeof address === "string") {
            throw new Error("Test server did not expose a port.");
          }
          resolve(`http://127.0.0.1:${address.port}`);
        });
      });
      const loginResponse = await fetch(`${baseUrl}/api/miniapp/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phoneNumber: "13800000001",
          password: FORMAL_LOGIN_DEV_PASSWORD
        })
      });
      const loginBody = await loginResponse.json() as JsonValue;
      const response = await fetch(`${baseUrl}/api/auth/account-security`, {
        headers: mobileHeaders(loginBody.sessionToken as string)
      });
      const body = await response.json() as JsonValue;
      expect(response.status).toBe(200);
      expect(body.profile).toMatchObject({
        accountType: "worker",
        phoneNumber: "13800000001"
      });
      expect(JSON.stringify(body)).not.toContain("passwordHash");
    } finally {
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close((error) => error ? reject(error) : resolve());
        });
      }
    }
  });
});
