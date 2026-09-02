import { SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import { describe, expect, it } from "vitest";
import { createClientOrder, headers, identityRepositories, repository, request, type JsonValue } from "../receiver/testHelpers.js";
import { FORMAL_LOGIN_DEV_PASSWORD } from "../auth/devAuthAccounts.js";

async function login(username: string) {
  const result = await request("/api/miniapp/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: FORMAL_LOGIN_DEV_PASSWORD })
  });
  return result;
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
      sampleRequestItems: [SAMPLE_REQUEST_ITEMS.sampleGarment, SAMPLE_REQUEST_ITEMS.cutting]
    })
  });
  return orderId;
}

describe("mini-program receiver Phase 1 adapter", () => {
  it("restores a fake receiver identity and exposes the existing read-only order list", async () => {
    const sessionToken = (await login("receiver@sample-room.test")).body.sessionToken as string;
    const orderId = await acceptedOrder("MINI-RECEIVER-LIST");
    const before = JSON.stringify(await repository.findOrderById(orderId));
    const result = await request("/api/miniapp/receiver/orders", {
      headers: miniappHeaders(sessionToken)
    });
    expect(result.response.status).toBe(200);
    expect(result.body.orders).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: orderId,
        styleNo: "MINI-RECEIVER-LIST",
        intakeStatus: "received",
        scanRecords: []
      })
    ]));
    expect(JSON.stringify(result.body)).not.toContain("storageKey");
    expect(JSON.stringify(result.body)).not.toContain("relativePath");
    expect(JSON.stringify(await repository.findOrderById(orderId))).toBe(before);
  });

  it("creates a field-complete intake through the existing receiver service and file pipeline", async () => {
    const sessionToken = (await login("receiver@sample-room.test")).body.sessionToken as string;
    const body = new FormData();
    const fields = {
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      styleNo: "MINI-INTAKE-001",
      styleName: "小程序现场录入",
      quantity: "2",
      sampleType: "first_sample",
      sampleRound: "round_1",
      deliveryDate: "2026-08-01",
      remark: "微信小程序录入",
      patternStatus: "none",
      fabricStatus: "missing",
      trimStatus: "partial",
      sampleRequestItems: JSON.stringify([SAMPLE_REQUEST_ITEMS.sampleGarment, SAMPLE_REQUEST_ITEMS.cutting])
    };
    body.append("multipartPayload", JSON.stringify(fields));
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    body.append("files", new Blob([jpegBytes], { type: "image/jpeg" }), "miniapp-intake.jpg");
    body.append("files", new Blob([jpegBytes], { type: "image/jpeg" }), "miniapp-thumbnail.jpg");
    body.append("thumbnailAttachmentIndex", "1");
    body.append("category", "receiver_quick_photo");
    body.append("visibility", "client_visible");
    const result = await request("/api/miniapp/receiver/intake", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
      body
    });
    expect(result.response.status).toBe(201);
    expect(result.body.order).toMatchObject({
      styleNo: "MINI-INTAKE-001",
      styleName: "小程序现场录入",
      quantity: 2,
      fabricStatus: "missing",
      trimStatus: "partial"
    });
    const order = result.body.order as JsonValue;
    const attachments = await repository.listOrderAttachments(order.id as string);
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({ fileName: "miniapp-intake.jpg", category: "receiver_sample_sheet" });
    expect(attachments[1]).toMatchObject({ fileName: "miniapp-thumbnail.jpg", category: "style_thumbnail" });
    expect(result.body.order).toMatchObject({ thumbnailAttachmentId: attachments[1]?.id });
    expect(JSON.stringify(result.body)).not.toContain("storageKey");
  });

  it("creates quick-photo intake as pending correction while preserving optional order fields", async () => {
    const sessionToken = (await login("receiver@sample-room.test")).body.sessionToken as string;
    const body = new FormData();
    body.append("multipartPayload", JSON.stringify({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      styleNo: "MINI-QUICK-OPTIONAL",
      styleName: "可选完整信息",
      quantity: "4",
      sampleType: "first_sample",
      sampleRound: "round_1",
      deliveryDate: "2026-08-08",
      remark: "拍照简录补充字段"
    }));
    body.append("files", new Blob(["quick image"], { type: "image/jpeg" }), "quick-intake.jpg");
    body.append("category", "receiver_quick_photo");
    body.append("visibility", "client_visible");

    const result = await request("/api/miniapp/receiver/quick-photo", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
      body
    });

    expect(result.response.status).toBe(201);
    expect(result.body.order).toMatchObject({
      styleNo: "MINI-QUICK-OPTIONAL",
      styleName: "可选完整信息",
      quantity: 4,
      deliveryDate: "2026-08-08",
      remark: "拍照简录补充字段",
      intakeStatus: "pending_receive",
      stage: null,
      sampleRequestItems: []
    });
  });

  it("uploads an internal material record to a completed formal order without changing the order", async () => {
    const sessionToken = (await login("receiver@sample-room.test")).body.sessionToken as string;
    const orderId = await acceptedOrder("MINI-MATERIAL-RECORD");
    await repository.updateOrder(orderId, { stage: "done" });
    const before = JSON.stringify(await repository.findOrderById(orderId));
    const body = new FormData();
    body.append("files", new Blob(["material image"], { type: "image/jpeg" }), "material-record.jpg");
    body.append("category", "receiver_material_record");
    body.append("visibility", "client_visible");

    const result = await request(`/api/miniapp/receiver/orders/${orderId}/attachments`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
      body
    });

    expect(result.response.status).toBe(201);
    expect(result.body.attachments).toEqual([
      expect.objectContaining({
        fileName: "material-record.jpg",
        category: "receiver_material_record",
        visibility: "internal_only",
        canRename: true,
        canDelete: true,
        hasFile: true
      })
    ]);
    expect(JSON.stringify(await repository.findOrderById(orderId))).toBe(before);
  });

  it("lists, renames, and deletes the signed-in receiver's mobile order attachments", async () => {
    const sessionToken = (await login("receiver@sample-room.test")).body.sessionToken as string;
    const orderId = await acceptedOrder("MINI-RECEIVER-ATTACHMENT-ACTIONS");
    const body = new FormData();
    body.append("files", new Blob(["material image"], { type: "image/jpeg" }), "material-record.jpg");
    body.append("category", "receiver_material_record");
    body.append("visibility", "internal_only");
    const uploaded = await request(`/api/miniapp/receiver/orders/${orderId}/attachments`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
      body
    });
    const attachmentId = ((uploaded.body.attachments as JsonValue[])[0]!.id) as string;

    const listed = await request(`/api/miniapp/receiver/orders/${orderId}/attachments`, {
      headers: miniappHeaders(sessionToken)
    });
    expect(listed.body.attachments).toEqual([
      expect.objectContaining({
        id: attachmentId,
        canRename: true,
        canDelete: true
      })
    ]);

    const renamed = await request(
      `/api/miniapp/receiver/orders/${orderId}/attachments/${attachmentId}/display-name`,
      {
        method: "PATCH",
        headers: miniappHeaders(sessionToken),
        body: JSON.stringify({ displayName: "蓝色主布到货记录" })
      }
    );
    expect(renamed.response.status).toBe(200);
    expect(renamed.body.attachments).toEqual([
      expect.objectContaining({
        id: attachmentId,
        fileName: "蓝色主布到货记录.jpg",
        canRename: true,
        canDelete: true
      })
    ]);

    const deleted = await request(
      `/api/miniapp/receiver/orders/${orderId}/attachments/${attachmentId}`,
      { method: "DELETE", headers: miniappHeaders(sessionToken) }
    );
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.attachments).toEqual([]);
  });

  it("uses Miniapp session as the receiver scan-charge gate and reuses OrderChargeService", async () => {
    const sessionToken = (await login("receiver@sample-room.test")).body.sessionToken as string;
    const orderId = await acceptedOrder("MINI-SCAN-CHARGE");
    const link = await request(`/api/receiver/orders/${orderId}/scan-link`, { headers: headers("receiver") });
    const token = (link.body.scanLink as JsonValue).token as string;
    const context = await request("/api/miniapp/receiver/scan-charge/resolve", {
      method: "POST",
      headers: miniappHeaders(sessionToken),
      body: JSON.stringify({ token })
    });
    expect(context.response.status).toBe(200);
    expect(context.body).toMatchObject({ order: { id: orderId, styleNo: "MINI-SCAN-CHARGE" }, charges: [] });
    expect(JSON.stringify(context.body)).not.toContain(token);

    const created = await request("/api/miniapp/receiver/scan-charge/charges", {
      method: "POST",
      headers: miniappHeaders(sessionToken),
      body: JSON.stringify({
        token,
        charge: { name: "加急费", amount: 35, sourceScene: "receiver_mobile_scan" }
      })
    });
    expect(created.response.status).toBe(201);
    expect(created.body.charge).toMatchObject({
      name: "加急费",
      amount: 35,
      explanation: "",
      canRename: true,
      canVoid: true
    });
    expect(JSON.stringify(created.body)).not.toContain("creatorId");
    expect(JSON.stringify(created.body)).not.toContain(token);
    expect(await repository.listOrderChargesByOrderId(orderId)).toHaveLength(1);

    const listed = await request(`/api/miniapp/receiver/orders/${orderId}/charges`, {
      headers: miniappHeaders(sessionToken)
    });
    expect(listed.response.status).toBe(200);
    expect(listed.body.charges).toEqual([
      expect.objectContaining({ name: "加急费", amount: 35, canRename: true, canVoid: true })
    ]);

    const chargeId = (created.body.charge as JsonValue).id as string;
    const renamed = await request(
      `/api/miniapp/receiver/orders/${orderId}/charges/${chargeId}/display-name`,
      {
        method: "POST",
        headers: miniappHeaders(sessionToken),
        body: JSON.stringify({ name: "改名后的加急费" })
      }
    );
    expect(renamed.body.charge).toMatchObject({
      name: "改名后的加急费",
      canRename: true
    });

    const removed = await request(
      `/api/miniapp/receiver/orders/${orderId}/charges/${chargeId}/void`,
      { method: "POST", headers: miniappHeaders(sessionToken), body: JSON.stringify({}) }
    );
    expect(removed.response.status).toBe(200);
    expect(removed.body.charge).toMatchObject({ status: "void", canRename: false, canVoid: false });
  });

  it("rejects missing, non-receiver and suspended Account sessions without trusting request role fields", async () => {
    expect((await request("/api/miniapp/receiver/orders")).response.status).toBe(401);

    const planner = (await login("planner@sample-room.test")).body.sessionToken as string;
    expect((await request("/api/miniapp/receiver/orders", {
      headers: miniappHeaders(planner)
    })).response.status).toBe(403);
    expect((await request("/api/miniapp/receiver/orders", {
      headers: miniappHeaders(planner),
      method: "GET"
    })).body.error).toBe("receiver_miniapp_identity_required");

    const receiver = (await login("receiver@sample-room.test")).body.sessionToken as string;
    await identityRepositories.accounts.updateAccount("formal-account-receiver", { status: "suspended" });
    expect((await request("/api/miniapp/receiver/orders", {
      headers: { ...miniappHeaders(receiver), "x-dev-role": "receiver", "x-dev-user-id": "spoofed-receiver" }
    })).response.status).toBe(401);
  });
});
