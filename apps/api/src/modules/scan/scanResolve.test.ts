import { describe, expect, it } from "vitest";
import { ORDER_STAGES, SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import {
  createClientOrder,
  headers,
  repository,
  request,
  type JsonValue
} from "../receiver/testHelpers.js";
import { ScanTestIdentityProvider } from "./scanTestIdentity.js";
import { createInMemoryRepositoryContext } from "../../db/repositories/memory/inMemoryRepositoryContext.js";

async function acceptedOrder(styleNo: string, items: string[]) {
  const created = await createClientOrder(styleNo);
  const orderId = (created.body.order as JsonValue).id as string;
  const accepted = await request(`/api/receiver/orders/${orderId}/accept`, {
    method: "POST",
    headers: headers("receiver"),
    body: JSON.stringify({
      patternStatus: "none",
      fabricStatus: "complete",
      trimStatus: "complete",
      sampleRequestItems: items
    })
  });
  expect(accepted.response.status).toBe(200);
  const link = await request(`/api/receiver/orders/${orderId}/scan-link`, {
    headers: headers("receiver")
  });
  return {
    orderId,
    token: (link.body.scanLink as JsonValue).token as string
  };
}

function testHeaders(identity: string) {
  return {
    "content-type": "application/json",
    "x-test-scan-identity": identity
  };
}

async function resolve(payload: string, identity: string) {
  return request("/api/scan/resolve", {
    method: "POST",
    headers: testHeaders(identity),
    body: JSON.stringify({ payload })
  });
}

describe("unified order scan resolver", () => {
  it("never enables client-declared test identities in production", async () => {
    const identities = createInMemoryRepositoryContext();
    const provider = new ScanTestIdentityProvider(
      identities.accounts,
      identities.workerProfiles,
      {
      NODE_ENV: "production",
      ENABLE_SCAN_TEST_IDENTITIES: "true"
      }
    );
    await expect(provider.resolve("boss")).rejects.toMatchObject({
      statusCode: 403,
      message: "scan_test_identity_disabled"
    });
  });

  it("resolves plain text, legacy URL, relative path, and bare token without echoing token", async () => {
    const { token } = await acceptedOrder("RESOLVE-FORMATS", [SAMPLE_REQUEST_ITEMS.cutting]);
    for (const payload of [
      `SRS2|ORDER|${token}`,
      `https://factory.example/scan/${token}`,
      `/scan/${token}`,
      token
    ]) {
      const result = await resolve(payload, "cutting");
      expect(result.response.status).toBe(200);
      expect(result.body.allowedActions).toContain("complete");
      expect(JSON.stringify(result.body)).not.toContain(token);
    }

    const invalid = await resolve("https://factory.example/client/register/not-an-order", "cutting");
    expect(invalid.response.status).toBe(400);
    expect(invalid.body).toEqual({ error: "invalid_order_qr_payload" });
  });

  it("uses the original token to return the latest order data to workers, receivers, and planners", async () => {
    const { orderId, token } = await acceptedOrder("LATEST-BEFORE", [SAMPLE_REQUEST_ITEMS.cutting]);
    await repository.updateOrder(orderId, {
      styleNo: "LATEST-AFTER",
      styleName: "Latest After",
      quantity: 9
    });

    const worker = await resolve(token, "cutting");
    const receiver = await resolve(token, "receiver");
    const planner = await resolve(token, "planner");
    const reusedLink = await request(`/api/receiver/orders/${orderId}/scan-link`, {
      headers: headers("receiver")
    });

    for (const result of [worker, receiver, planner]) {
      expect(result.response.status).toBe(200);
      expect(result.body.order).toMatchObject({
        styleNo: "LATEST-AFTER",
        styleName: "Latest After",
        quantity: 9
      });
    }
    expect((reusedLink.body.scanLink as JsonValue).token).toBe(token);
  });

  it("rejects revoked tokens", async () => {
    const { token } = await acceptedOrder("RESOLVE-REVOKED", [SAMPLE_REQUEST_ITEMS.cutting]);
    const originalFind = repository.findOrderScanToken.bind(repository);
    repository.findOrderScanToken = async (value) => {
      const record = await originalFind(value);
      return record && value === token
        ? { ...record, revokedAt: new Date().toISOString() }
        : record;
    };

    const result = await resolve(`SRS2|ORDER|${token}`, "cutting");
    expect(result.response.status).toBe(404);
    expect(result.body).toEqual({ error: "scan token not found." });
  });

  it("derives worker permissions from the dynamic route and rejects the wrong stage", async () => {
    const { token } = await acceptedOrder("RESOLVE-WORKERS", [
      SAMPLE_REQUEST_ITEMS.cutting,
      SAMPLE_REQUEST_ITEMS.sampleGarment
    ]);
    const cutting = await resolve(token, "cutting");
    const sewing = await resolve(token, "sewing");
    const qc = await resolve(token, "qc_delivery");
    expect(cutting.body.allowedActions).toEqual(["complete"]);
    expect(sewing.body.allowedActions).toEqual([]);
    expect((sewing.body.state as JsonValue).blockedReason).toBe("wrong_stage");
    expect(qc.body.allowedActions).toEqual([]);
  });

  it.each([
    ["cutting-only", [SAMPLE_REQUEST_ITEMS.cutting], "cutting", ["complete"]],
    ["garment", [SAMPLE_REQUEST_ITEMS.sampleGarment], "sewing", ["start"]],
    ["small-sample", [SAMPLE_REQUEST_ITEMS.sampleSmall], "sewing", ["start"]],
    [
      "both-sample-types",
      [SAMPLE_REQUEST_ITEMS.sampleGarment, SAMPLE_REQUEST_ITEMS.sampleSmall],
      "sewing",
      ["start"]
    ],
    [
      "cutting-and-garment",
      [SAMPLE_REQUEST_ITEMS.cutting, SAMPLE_REQUEST_ITEMS.sampleGarment],
      "cutting",
      ["complete"]
    ],
    [
      "cutting-and-small-sample",
      [SAMPLE_REQUEST_ITEMS.cutting, SAMPLE_REQUEST_ITEMS.sampleSmall],
      "cutting",
      ["complete"]
    ],
    ["pattern-only", [SAMPLE_REQUEST_ITEMS.patternRevision], "cutting", []]
  ])(
    "covers the %s dynamic production-route combination",
    async (_name, items, identity, expectedActions) => {
      const { token } = await acceptedOrder(`RESOLVE-ROUTE-${_name}`, items);
      const result = await resolve(token, identity);
      expect(result.response.status).toBe(200);
      expect(result.body.allowedActions).toEqual(expectedActions);
    }
  );

  it("reports an unfinished pattern gate before treating a pattern-only order as complete", async () => {
    const { token } = await acceptedOrder("RESOLVE-PATTERN-WAITING", [
      SAMPLE_REQUEST_ITEMS.patternRevision
    ]);
    const result = await resolve(token, "cutting");

    expect(result.response.status).toBe(200);
    expect(result.body.allowedActions).toEqual([]);
    expect(result.body.state).toMatchObject({
      allowedAction: "blocked",
      blockedReason: "workflow_invalid",
      message: "等待版师任务：制版/改版有效交付物尚未齐全。"
    });
  });

  it("runs start and complete, blocks repetition, and attributes both writes to one WorkerProfile", async () => {
    const { orderId, token } = await acceptedOrder("RESOLVE-SEWING", [
      SAMPLE_REQUEST_ITEMS.sampleGarment
    ]);
    const initial = await resolve(token, "sewing");
    const workerProfileId = ((initial.body.actor as JsonValue).workerProfileId as string);
    expect(initial.body.allowedActions).toEqual(["start"]);

    const started = await request(`/api/scan/${token}/start`, {
      method: "POST",
      headers: testHeaders("sewing")
    });
    expect(started.response.status).toBe(200);
    const repeated = await request(`/api/scan/${token}/start`, {
      method: "POST",
      headers: testHeaders("sewing")
    });
    expect(repeated.response.status).toBe(409);

    const completed = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: testHeaders("sewing"),
      body: JSON.stringify({ workHours: 1.5, pieces: 3, note: "Simulator completion" })
    });
    expect(completed.response.status).toBe(200);
    const records = await repository.listScanRecordsByOrderId(orderId);
    expect(records.map((record) => record.actorAccountId)).toEqual([
      "formal-account-worker-sewing",
      "formal-account-worker-sewing"
    ]);
    expect(records.map((record) => record.workerProfileId)).toEqual([
      workerProfileId,
      workerProfileId
    ]);
  });

  it("returns no executable worker actions after termination", async () => {
    const { orderId, token } = await acceptedOrder("RESOLVE-TERMINATED", [
      SAMPLE_REQUEST_ITEMS.cutting
    ]);
    await repository.updateOrder(orderId, { terminated: true, stage: ORDER_STAGES.done });
    const result = await resolve(token, "cutting");
    expect(result.response.status).toBe(200);
    expect(result.body.allowedActions).toEqual([]);
    expect(["terminated", "done"]).toContain(
      (result.body.state as JsonValue).blockedReason
    );
  });

  it("returns account actions for receiver, planner, and boss", async () => {
    const { token } = await acceptedOrder("RESOLVE-ACCOUNTS", [SAMPLE_REQUEST_ITEMS.cutting]);
    expect((await resolve(token, "receiver")).body.allowedActions).toEqual(["record_charge"]);
    expect((await resolve(token, "planner")).body.allowedActions).toEqual(["record_charge"]);
    expect((await resolve(token, "boss")).body.allowedActions).toEqual(["view_order"]);
  });

  it("rejects all customer scans before lookup without leaking summary, token, or actions", async () => {
    const { token } = await acceptedOrder("RESOLVE-CLIENT-DENY", [SAMPLE_REQUEST_ITEMS.cutting]);
    for (const identity of ["client_supervisor", "client_salesperson"]) {
      const sameCustomer = await resolve(token, identity);
      expect(sameCustomer.response.status).toBe(403);
      expect(sameCustomer.body).toEqual({ error: "forbidden" });
      expect(JSON.stringify(sameCustomer.body)).not.toContain(token);
    }

    const crossCustomer = await resolve("order_scan_cross_customer_unknown", "client_salesperson");
    expect(crossCustomer.response.status).toBe(403);
    expect(crossCustomer.body).toEqual({ error: "forbidden" });
    expect(crossCustomer.body).not.toHaveProperty("order");
    expect(crossCustomer.body).not.toHaveProperty("allowedActions");
  });
});
