import { SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createInMemorySampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { createClientOrder, headers, repository, request, type JsonValue } from "../receiver/testHelpers.js";

async function acceptedOrderWithToken() {
  const created = await createClientOrder("MINIAPP-READONLY");
  const orderId = (created.body.order as JsonValue).id as string;
  await request(`/api/receiver/orders/${orderId}/accept`, {
    method: "POST",
    headers: headers("receiver"),
    body: JSON.stringify({
      patternStatus: "none",
      fabricStatus: "complete",
      trimStatus: "complete",
      sampleRequestItems: [SAMPLE_REQUEST_ITEMS.cutting]
    })
  });
  const link = await request(`/api/receiver/orders/${orderId}/scan-link`, { headers: headers("receiver") });
  return { orderId, token: (link.body.scanLink as JsonValue).token as string };
}

describe("mini-program read-only order scan", () => {
  it("exposes a public, stable, non-sensitive health response", async () => {
    const result = await request("/api/miniapp/health");
    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({ ok: true, service: "sample-room-api", apiVersion: "v1" });
  });

  it("resolves the existing plain-text token without writing order, token, or scan data", async () => {
    const { orderId, token } = await acceptedOrderWithToken();
    const before = JSON.stringify({
      order: await repository.findOrderById(orderId),
      token: await repository.findOrderScanToken(token),
      records: await repository.listScanRecordsByOrderId(orderId)
    });
    const result = await request("/api/miniapp/scan/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: `SRS2|ORDER|${token}` })
    });
    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({
      objectType: "order",
      readOnly: true,
      developmentMode: true,
      currentStage: "cutting",
      order: { orderNo: expect.any(String), styleNo: "MINIAPP-READONLY", quantity: 3 }
    });
    expect(JSON.stringify(result.body)).not.toContain(token);
    const tokenOnlyResult = await request("/api/miniapp/scan/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    });
    expect(tokenOnlyResult.response.status).toBe(200);
    expect(tokenOnlyResult.body).toMatchObject({ objectType: "order", readOnly: true });
    expect(JSON.stringify(tokenOnlyResult.body)).not.toContain(token);
    const after = JSON.stringify({
      order: await repository.findOrderById(orderId),
      token: await repository.findOrderScanToken(token),
      records: await repository.listScanRecordsByOrderId(orderId)
    });
    expect(after).toBe(before);
  });

  it.each(["SRS1|ORDER|order_scan_12345678", "SRS2|CLIENT|order_scan_12345678", "SRS2|ORDER|"])(
    "rejects invalid mini-program order payload %s",
    async (payload) => {
      const result = await request("/api/miniapp/scan/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload })
      });
      expect(result.response.status).toBe(400);
      expect(result.body).toEqual({ error: "invalid_order_qr_payload" });
    }
  );

  it("refuses an unsafe production runtime before exposing scan resolve", () => {
    expect(() => createApp({
      repository: createInMemorySampleRoomRepository(),
      env: { NODE_ENV: "production", AUTH_MODE: "dev", PERSISTENCE_MODE: "memory" }
    })).toThrow("AUTH_MODE=formal");
  });
});
