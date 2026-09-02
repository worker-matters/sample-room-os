import { SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import { describe, expect, it } from "vitest";
import { createClientOrder, headers, request, type JsonValue } from "../receiver/testHelpers.js";
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

describe("mini-program client mobile adapter", () => {
  it("routes customer accounts and keeps own/customer-wide order scopes", async () => {
    await createClientOrder("CLIENT-OWN");
    await createClientOrder(
      "CLIENT-SECOND",
      headers("client_business_user", { userId: "formal-account-client-business-second", clientUserId: "mock-client-user-second" })
    );
    await createClientOrder(
      "CLIENT-OTHER",
      headers("client_business_user", {
        userId: "formal-account-client-business-other",
        customerId: "mock-customer-other",
        clientUserId: "mock-client-user-other"
      })
    );

    const own = await login("client-own@sample-room.test");
    expect(own.identity).toMatchObject({
      role: "client_business_user",
      homeRoute: "/pages/client/orders",
      canScanOrder: false
    });
    const ownOrders = await request("/api/miniapp/client/orders", {
      headers: miniappHeaders(own.sessionToken)
    });
    expect((ownOrders.body.orders as JsonValue[]).map((order) => order.styleNo)).toEqual(["CLIENT-OWN"]);

    const admin = await login("client-admin@sample-room.test");
    expect(admin.identity).toMatchObject({ role: "client_admin", homeRoute: "/pages/client/orders" });
    const adminOrders = await request("/api/miniapp/client/orders", {
      headers: miniappHeaders(admin.sessionToken)
    });
    expect(adminOrders.response.status, JSON.stringify(adminOrders.body)).toBe(200);
    expect((adminOrders.body.orders as JsonValue[]).map((order) => order.styleNo)).toEqual(
      expect.arrayContaining(["CLIENT-OWN", "CLIENT-SECOND"])
    );
    expect((adminOrders.body.orders as JsonValue[]).map((order) => order.styleNo)).not.toContain("CLIENT-OTHER");
    expect(adminOrders.body.clientAccessScope).toBe("customer_all");
  });

  it("returns shared per-task completion facts without leaking internal fields", async () => {
    const created = await createClientOrder("CLIENT-TASKS");
    const orderId = (created.body.order as JsonValue).id as string;
    await request(`/api/receiver/orders/${orderId}/accept`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        patternStatus: "none",
        fabricStatus: "complete",
        trimStatus: "complete",
        sampleRequestItems: [
          SAMPLE_REQUEST_ITEMS.patternMaking,
          SAMPLE_REQUEST_ITEMS.cutting,
          SAMPLE_REQUEST_ITEMS.sampleGarment
        ]
      })
    });
    const client = await login("client-own@sample-room.test");
    const result = await request("/api/miniapp/client/orders", {
      headers: miniappHeaders(client.sessionToken)
    });
    const order = (result.body.orders as JsonValue[]).find((item) => item.id === orderId)!;
    expect(order.orderTasks).toEqual([
      { item: "pattern_making", label: "制版", completed: false },
      { item: "cutting", label: "裁剪", completed: false },
      { item: "sample_garment", label: "生产样衣", completed: false }
    ]);
    const json = JSON.stringify(order);
    expect(json).not.toContain("storageKey");
    expect(json).not.toContain("patternMakerName");
    expect(json).not.toContain("workerName");
    expect(json).not.toContain("scanRecords");
  });

  it("reuses quick-photo intake and keeps customer supervisors read-only", async () => {
    const own = await login("client-own@sample-room.test");
    const quickBody = new FormData();
    quickBody.append("files", new Blob(["client photo"], { type: "image/jpeg" }), "client-photo.jpg");
    quickBody.append("category", "client_quick_photo");
    quickBody.append("visibility", "client_visible");
    const created = await request("/api/miniapp/client/orders/quick-photo", {
      method: "POST",
      headers: { authorization: `Bearer ${own.sessionToken}` },
      body: quickBody
    });
    expect(created.response.status).toBe(201);
    expect(created.body.order).toMatchObject({ intakeStatus: "pending_receive" });

    const admin = await login("client-admin@sample-room.test");
    const blocked = await request("/api/miniapp/client/orders/quick-photo", {
      method: "POST",
      headers: { authorization: `Bearer ${admin.sessionToken}` },
      body: quickBody
    });
    expect(blocked.response.status).toBe(403);
  });

  it("exposes registration controls only to the customer supervisor", async () => {
    const admin = await login("client-admin@sample-room.test");
    const opened = await request("/api/miniapp/client/business-user-registration/open", {
      method: "POST",
      headers: miniappHeaders(admin.sessionToken)
    });
    expect(opened.response.status).toBe(200);
    expect(opened.body.registration).toMatchObject({ enabled: true });

    const own = await login("client-own@sample-room.test");
    const blocked = await request("/api/miniapp/client/business-user-registration", {
      headers: miniappHeaders(own.sessionToken)
    });
    expect(blocked.response.status).toBe(403);
  });

  it("rejects non-client Miniapp identities", async () => {
    const receiverSession = (await login("receiver@sample-room.test")).sessionToken;
    const result = await request("/api/miniapp/client/orders", {
      headers: miniappHeaders(receiverSession)
    });
    expect(result.response.status).toBe(403);
    expect(result.body.error).toBe("client_miniapp_identity_required");
  });
});
