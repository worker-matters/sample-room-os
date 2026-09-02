import { SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import { describe, expect, it } from "vitest";
import { FORMAL_LOGIN_DEV_PASSWORD } from "../auth/devAuthAccounts.js";
import {
  createClientOrder,
  headers,
  rawRequest,
  repository,
  request,
  type JsonValue
} from "../receiver/testHelpers.js";

async function login(username: string) {
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

async function receivedOrder(styleNo: string) {
  const created = await createClientOrder(styleNo);
  const orderId = (created.body.order as JsonValue).id as string;
  const accepted = await request(`/api/receiver/orders/${orderId}/accept`, {
    method: "POST",
    headers: headers("receiver"),
    body: JSON.stringify({
      patternStatus: "none",
      sampleRequestItems: [SAMPLE_REQUEST_ITEMS.sampleGarment]
    })
  });
  expect(accepted.response.status).toBe(200);
  return orderId;
}

async function createCustomerCharge(
  sessionToken: string,
  orderId: string,
  amount: number
) {
  return request(`/api/miniapp/boss/orders/${orderId}/pricing/customer-charges`, {
    method: "POST",
    headers: mobileHeaders(sessionToken),
    body: JSON.stringify({
      name: "客户样衣费",
      pricingMethod: "fixed",
      amount,
      sourceTask: "生产样衣"
    })
  });
}

describe("boss mobile pricing adapter", () => {
  it("reuses the dynamic pricing and reconciliation services for boss and System Owner", async () => {
    const bossToken = await login("boss@sample-room.test");
    const systemOwnerToken = await login("system-owner@sample-room.test");
    const orderId = await receivedOrder("MOBILE-BOSS-PRICING");

    const initialized = await request(
      `/api/miniapp/boss/orders/${orderId}/pricing/initialize`,
      { method: "POST", headers: mobileHeaders(bossToken) }
    );
    expect(initialized.response.status).toBe(200);
    expect(initialized.body.pricing).toMatchObject({
      customerChargeItems: [
        expect.objectContaining({ name: "样衣费", pricingMethod: "unit_quantity" })
      ]
    });
    const recommendedId = (
      (initialized.body.pricing as JsonValue).customerChargeItems as JsonValue[]
    )[0]!.id as string;
    const updatedRecommendation = await request(
      `/api/miniapp/boss/orders/${orderId}/pricing/customer-charges/${recommendedId}/update`,
      {
        method: "POST",
        headers: mobileHeaders(bossToken),
        body: JSON.stringify({ unitPrice: 0, quantity: 3 })
      }
    );
    expect(updatedRecommendation.response.status).toBe(200);

    const createdCharge = await createCustomerCharge(bossToken, orderId, 680);
    expect(createdCharge.response.status).toBe(201);
    expect(createdCharge.body.summary).toMatchObject({
      customerQuoteSubtotal: 680,
      receivableTotal: 680
    });

    const confirmed = await request(
      `/api/miniapp/boss/orders/${orderId}/pricing/confirm`,
      { method: "POST", headers: mobileHeaders(bossToken) }
    );
    expect(confirmed.response.status).toBe(200);

    const rows = await request("/api/miniapp/boss/pricing/orders", {
      headers: mobileHeaders(systemOwnerToken)
    });
    expect(rows.response.status).toBe(200);
    expect(rows.body.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        order: expect.objectContaining({
          id: orderId,
          customerName: "Mock Active Customer",
          salespersonName: expect.any(String)
        }),
        reconciliationEligibility: { eligible: true }
      })
    ]));

    const statement = await request("/api/miniapp/boss/reconciliation-statements", {
      method: "POST",
      headers: mobileHeaders(bossToken),
      body: JSON.stringify({ orderIds: [orderId] })
    });
    expect(statement.response.status).toBe(201);
    expect(statement.body.statement).toMatchObject({
      orderCount: 1,
      receivableAmount: 680,
      items: [expect.objectContaining({ orderId, receivableTotal: 680 })]
    });
    const statementId = (statement.body.statement as JsonValue).id as string;
    const downloaded = await rawRequest(
      `/api/miniapp/boss/reconciliation-statements/${statementId}/download`,
      { headers: mobileHeaders(bossToken) }
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  it("keeps charge-only changes eligible and snapshots the latest effective charges", async () => {
    const bossToken = await login("boss@sample-room.test");
    const orderId = await receivedOrder("MOBILE-BOSS-DYNAMIC-CHARGE");
    await createCustomerCharge(bossToken, orderId, 500);

    const extra = await request(`/api/miniapp/boss/orders/${orderId}/charges`, {
      method: "POST",
      headers: mobileHeaders(bossToken),
      body: JSON.stringify({ name: "快递费", amount: 20, sourceScene: "boss_mobile" })
    });
    const chargeId = (extra.body.charge as JsonValue).id as string;
    await request(`/api/miniapp/boss/orders/${orderId}/pricing/confirm`, {
      method: "POST",
      headers: mobileHeaders(bossToken)
    });
    await repository.updateOrderCharge(chargeId, {
      status: "void",
      archivedAt: new Date().toISOString(),
      voidReason: "simulated live charge change"
    });

    const rows = await request("/api/miniapp/boss/pricing/orders", {
      headers: mobileHeaders(bossToken)
    });
    const row = (rows.body.rows as JsonValue[]).find(
      (candidate) => (candidate.order as JsonValue).id === orderId
    );
    expect(row).toMatchObject({
      quotationHasUnconfirmedChanges: false,
      confirmedQuotation: { receivableTotal: 500 },
      summary: { receivableTotal: 500 },
      reconciliationEligibility: { eligible: true }
    });

    const statement = await request("/api/miniapp/boss/reconciliation-statements", {
      method: "POST",
      headers: mobileHeaders(bossToken),
      body: JSON.stringify({ orderIds: [orderId] })
    });
    expect(statement.response.status).toBe(201);
    expect(statement.body.statement).toMatchObject({
      receivableAmount: 500,
      items: [expect.objectContaining({ orderId, otherChargeTotal: 0, receivableTotal: 500 })]
    });
  });

  it("does not open manager pricing to ordinary mobile Accounts", async () => {
    const receiverToken = await login("receiver@sample-room.test");
    const rejected = await request("/api/miniapp/boss/pricing/orders", {
      headers: mobileHeaders(receiverToken)
    });
    expect(rejected.response.status).toBe(403);
    expect(rejected.body.error).toBe("boss_miniapp_identity_required");
  });
});
