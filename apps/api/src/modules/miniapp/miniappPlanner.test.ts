import { SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import { describe, expect, it } from "vitest";
import { createClientOrder, headers, rawRequest, repository, request, type JsonValue } from "../receiver/testHelpers.js";
import { FORMAL_LOGIN_DEV_PASSWORD } from "../auth/devAuthAccounts.js";

async function login(username: string) {
  const result = await request("/api/miniapp/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: FORMAL_LOGIN_DEV_PASSWORD })
  });
  return { sessionToken: result.body.sessionToken as string, identity: result.body.identity as JsonValue };
}

const miniappHeaders = (sessionToken: string) => ({
  "content-type": "application/json",
  authorization: `Bearer ${sessionToken}`
});

async function acceptedOrder(styleNo: string) {
  const created = await createClientOrder(styleNo);
  const orderId = (created.body.order as JsonValue).id as string;
  await request(`/api/receiver/orders/${orderId}/accept`, {
    method: "POST",
    headers: headers("receiver"),
    body: JSON.stringify({
      patternStatus: "none",
      fabricStatus: "complete",
      trimStatus: "complete",
      sampleRequestItems: [SAMPLE_REQUEST_ITEMS.sampleGarment]
    })
  });
  return orderId;
}

describe("mini-program planner mobile adapter", () => {
  it("routes a signed-in planner Account to the planner workbench and returns the existing planner DTO", async () => {
    const bound = await login("planner@sample-room.test");
    expect(bound.identity).toMatchObject({
      status: "active",
      role: "planner",
      homeRoute: "/pages/planner/home"
    });
    const orderId = await acceptedOrder("MINI-PLANNER-LIST");
    const before = JSON.stringify(await repository.findOrderById(orderId));
    const result = await request("/api/miniapp/planner/orders", {
      headers: miniappHeaders(bound.sessionToken)
    });
    expect(result.response.status).toBe(200);
    expect(result.body.orders).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: orderId,
        styleNo: "MINI-PLANNER-LIST",
        stage: "sewing_waiting",
        stageLabel: "待缝制"
      })
    ]));
    expect(JSON.stringify(result.body)).not.toContain("storageKey");
    expect(JSON.stringify(result.body)).not.toContain("relativePath");
    expect(JSON.stringify(await repository.findOrderById(orderId))).toBe(before);
  });

  it("uses the planner Miniapp session for scan-charge without advancing production", async () => {
    const { sessionToken } = await login("planner@sample-room.test");
    const orderId = await acceptedOrder("MINI-PLANNER-CHARGE");
    const before = JSON.stringify(await repository.findOrderById(orderId));
    const link = await request(`/api/receiver/orders/${orderId}/scan-link`, { headers: headers("receiver") });
    const token = (link.body.scanLink as JsonValue).token as string;
    const context = await request("/api/miniapp/planner/scan-charge/resolve", {
      method: "POST",
      headers: miniappHeaders(sessionToken),
      body: JSON.stringify({ token })
    });
    expect(context.response.status).toBe(200);
    expect(context.body).toMatchObject({ order: { id: orderId }, charges: [] });
    expect(JSON.stringify(context.body)).not.toContain(token);

    const created = await request("/api/miniapp/planner/scan-charge/charges", {
      method: "POST",
      headers: miniappHeaders(sessionToken),
      body: JSON.stringify({
        token,
        charge: { name: "计划加急费", amount: 20, sourceScene: "planner_mobile_scan" }
      })
    });
    expect(created.response.status).toBe(201);
    expect(created.body.charge).toMatchObject({
      name: "计划加急费",
      explanation: "",
      canRename: true,
      canVoid: true
    });
    const chargeId = (created.body.charge as JsonValue).id as string;
    expect(JSON.stringify(created.body)).not.toContain("creatorId");
    expect(JSON.stringify(await repository.findOrderById(orderId))).toBe(before);

    const updated = await request(`/api/miniapp/planner/orders/${orderId}/charges/${chargeId}/display-name`, {
      method: "POST",
      headers: miniappHeaders(sessionToken),
      body: JSON.stringify({ name: "计划加急费（调整）", amount: 25, explanation: "夜间加急" })
    });
    expect(updated.response.status).toBe(200);
    expect(updated.body.charge).toMatchObject({
      id: chargeId,
      name: "计划加急费（调整）",
      amount: 25,
      explanation: "夜间加急"
    });

    const attachmentBody = new FormData();
    const pngBytes = Uint8Array.from(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    ));
    attachmentBody.append("files", new Blob([pngBytes], { type: "image/png" }), "charge-proof.png");
    attachmentBody.append("visibility", "client_visible");
    const uploaded = await request(
      `/api/miniapp/planner/orders/${orderId}/charges/${chargeId}/attachments`,
      { method: "POST", headers: { authorization: `Bearer ${sessionToken}` }, body: attachmentBody }
    );
    expect(uploaded.response.status).toBe(201);
    expect(uploaded.body.charge).toMatchObject({
      id: chargeId,
      attachments: [expect.objectContaining({
        fileName: "charge-proof.png",
        visibility: "internal_only",
        canRename: true,
        canDelete: true
      })]
    });
    const attachmentId = ((uploaded.body.charge as JsonValue).attachments as JsonValue[])[0]!.id as string;
    const preview = await rawRequest(
      `/api/miniapp/planner/orders/${orderId}/charges/${chargeId}/attachments/${attachmentId}/preview`,
      { headers: { authorization: `Bearer ${sessionToken}` } }
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toContain("image/png");
    expect(preview.headers.get("cache-control")).toContain("no-store");

    const ordinaryAttachments = await request(`/api/miniapp/planner/orders/${orderId}/attachments`, {
      headers: miniappHeaders(sessionToken)
    });
    expect((ordinaryAttachments.body.attachments as JsonValue[]).some((item) => item.id === attachmentId)).toBe(false);

    const listed = await request(`/api/miniapp/planner/orders/${orderId}/charges`, {
      headers: miniappHeaders(sessionToken)
    });
    expect(listed.response.status).toBe(200);
    expect(listed.body.charges).toEqual([
      expect.objectContaining({
        name: "计划加急费（调整）",
        amount: 25,
        canRename: true,
        canVoid: true,
        attachments: [expect.objectContaining({ visibility: "internal_only" })]
      })
    ]);
  });

  it("adds a planner charge directly from the mobile order list", async () => {
    const { sessionToken } = await login("planner@sample-room.test");
    const orderId = await acceptedOrder("MINI-PLANNER-LIST-CHARGE");
    const before = JSON.stringify(await repository.findOrderById(orderId));

    const initial = await request(`/api/miniapp/planner/orders/${orderId}/charges`, {
      headers: miniappHeaders(sessionToken)
    });
    expect(initial.response.status).toBe(200);
    expect(initial.body).toMatchObject({ chargeLocked: false, charges: [] });

    const created = await request(`/api/miniapp/planner/orders/${orderId}/charges`, {
      method: "POST",
      headers: miniappHeaders(sessionToken),
      body: JSON.stringify({
        charge: {
          name: "订单列表追加费",
          amount: 18,
          explanation: "手机订单列表录入",
          sourceScene: "planner_mobile_order_list"
        }
      })
    });
    expect(created.response.status).toBe(201);
    expect(created.body.charge).toMatchObject({
      name: "订单列表追加费",
      amount: 18,
      canRename: true,
      canVoid: true
    });
    expect(JSON.stringify(created.body)).not.toContain("creatorId");
    expect(JSON.stringify(await repository.findOrderById(orderId))).toBe(before);

    const pending = await createClientOrder("MINI-PLANNER-PENDING-CHARGE");
    const pendingOrderId = (pending.body.order as JsonValue).id as string;
    const rejected = await request(`/api/miniapp/planner/orders/${pendingOrderId}/charges`, {
      method: "POST",
      headers: miniappHeaders(sessionToken),
      body: JSON.stringify({ charge: { name: "不应写入", amount: 1 } })
    });
    expect(rejected.response.status).toBe(404);
  });

  it("keeps ordinary planner attachment upload separate from order state", async () => {
    const { sessionToken } = await login("planner@sample-room.test");
    const orderId = await acceptedOrder("MINI-PLANNER-ATTACHMENT");
    const before = JSON.stringify(await repository.findOrderById(orderId));
    const body = new FormData();
    body.append("files", new Blob(["planner note"], { type: "image/jpeg" }), "planner-note.jpg");
    body.append("category", "sample_room_upload");
    body.append("visibility", "internal_only");
    const result = await request(`/api/miniapp/planner/orders/${orderId}/attachments`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
      body
    });
    expect(result.response.status).toBe(201);
    expect(result.body.attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fileName: "planner-note.jpg",
        visibility: "internal_only",
        canRename: true,
        canDelete: true,
        hasFile: true
      })
    ]));
    expect(JSON.stringify(await repository.findOrderById(orderId))).toBe(before);
  });

  it("renames and deletes only the signed-in planner's mobile order attachments", async () => {
    const { sessionToken } = await login("planner@sample-room.test");
    const orderId = await acceptedOrder("MINI-PLANNER-ATTACHMENT-ACTIONS");
    const body = new FormData();
    body.append("files", new Blob(["planner note"], { type: "application/pdf" }), "planner-note.pdf");
    body.append("category", "sample_room_upload");
    body.append("visibility", "internal_only");
    const uploaded = await request(`/api/miniapp/planner/orders/${orderId}/attachments`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
      body
    });
    const attachmentId = ((uploaded.body.attachments as JsonValue[])[0]!.id) as string;

    const renamed = await request(
      `/api/miniapp/planner/orders/${orderId}/attachments/${attachmentId}/display-name`,
      {
        method: "PATCH",
        headers: miniappHeaders(sessionToken),
        body: JSON.stringify({ displayName: "生产资料终稿" })
      }
    );
    expect(renamed.response.status).toBe(200);
    expect(renamed.body.attachments).toEqual([
      expect.objectContaining({
        id: attachmentId,
        fileName: "生产资料终稿.pdf",
        canRename: true,
        canDelete: true
      })
    ]);

    const deleted = await request(
      `/api/miniapp/planner/orders/${orderId}/attachments/${attachmentId}`,
      { method: "DELETE", headers: miniappHeaders(sessionToken) }
    );
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.attachments).toEqual([]);
  });

  it("rejects missing sessions and receiver Accounts from planner routes", async () => {
    expect((await request("/api/miniapp/planner/orders")).response.status).toBe(401);

    const receiver = await login("receiver@sample-room.test");
    const rejected = await request("/api/miniapp/planner/orders", {
      headers: miniappHeaders(receiver.sessionToken)
    });
    expect(rejected.response.status).toBe(403);
    expect(rejected.body.error).toBe("planner_miniapp_identity_required");
  });
});
