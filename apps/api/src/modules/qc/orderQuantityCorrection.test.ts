import { describe, expect, it } from "vitest";
import { ORDER_STAGES } from "@sample-room/shared";
import {
  createReceiverSelfEntry,
  headers,
  repository,
  request,
  type JsonValue
} from "../receiver/testHelpers.js";

async function createSampleOrder(styleNo: string, quantity = 1) {
  const created = await createReceiverSelfEntry(styleNo, {
    quantity,
    sampleRequestItems: ["sample_garment"]
  });
  expect(created.response.status).toBe(201);
  return (created.body.order as JsonValue).id as string;
}

async function initializeSamplePricing(orderId: string) {
  const initialized = await request(`/api/admin/orders/${orderId}/pricing/initialize`, {
    method: "POST",
    headers: headers("boss")
  });
  expect(initialized.response.status).toBe(200);
  const items = (initialized.body.pricing as JsonValue).customerChargeItems as JsonValue[];
  const sampleCharge = items.find((item) => item.name === "样衣费");
  expect(sampleCharge).toBeTruthy();
  return sampleCharge!.id as string;
}

async function setSamplePricing(orderId: string, itemId: string, unitPrice: number, quantity: number) {
  const priced = await request(
    `/api/admin/orders/${orderId}/pricing/customer-charges/${itemId}`,
    {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ unitPrice, quantity })
    }
  );
  expect(priced.response.status).toBe(200);
  return priced;
}

async function confirmPricing(orderId: string) {
  const confirmed = await request(`/api/admin/orders/${orderId}/pricing/confirm`, {
    method: "POST",
    headers: headers("boss")
  });
  expect(confirmed.response.status).toBe(200);
  return confirmed;
}

async function createStatement(orderId: string) {
  const created = await request("/api/admin/reconciliation-statements", {
    method: "POST",
    headers: headers("boss"),
    body: JSON.stringify({ orderIds: [orderId] })
  });
  expect(created.response.status).toBe(201);
  return created.body.statement as JsonValue;
}

describe("order, process and settlement quantity boundaries", () => {
  it("keeps completed process pieces as evidence without changing order quantity", async () => {
    const orderId = await createSampleOrder("ORDER-QTY-EVIDENCE", 3);
    await repository.createScanRecord({
      orderId,
      stage: "cutting",
      orderStage: ORDER_STAGES.cuttingDoing,
      action: "complete",
      scanAction: "cutting_finish",
      workerId: "cutting-evidence",
      workerName: "Cutting Evidence",
      workHours: 1,
      pieces: 5
    });
    await repository.createScanRecord({
      orderId,
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "complete",
      scanAction: "sewing_finish",
      workerId: "sewing-evidence",
      workerName: "Sewing Evidence",
      workHours: 1,
      pieces: 4
    });
    await repository.createScanRecord({
      orderId,
      stage: "qc_delivery",
      orderStage: ORDER_STAGES.done,
      action: "complete",
      scanAction: "qc_delivery_finish",
      workerId: "qc-evidence",
      workerName: "QC Evidence",
      pieces: 2,
      qualityResult: "qualified",
      qualityScore: 95
    });
    await repository.updateOrder(orderId, { stage: ORDER_STAGES.done });

    expect((await repository.findOrderById(orderId))?.quantity).toBe(3);
    const reference = await request(`/api/admin/orders/${orderId}/process-pieces`, {
      headers: headers("boss")
    });
    expect(reference.response.status).toBe(200);
    expect(reference.body.result).toMatchObject({
      orderId,
      cutting: 5,
      sewing: 4,
      qc: 2
    });
  });

  it("returns the aggregated effective sewing pieces for collaborative pricing summaries", async () => {
    const orderId = await createSampleOrder("ORDER-QTY-COLLABORATIVE-SEWING", 20);
    await repository.createScanRecord({
      orderId,
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "start",
      scanAction: "sewing_start",
      workerProfileId: "sewing-profile-a",
      workerId: "sewing-a",
      workerName: "Sewing A"
    });
    await repository.createScanRecord({
      orderId,
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "start",
      scanAction: "sewing_start",
      workerProfileId: "sewing-profile-b",
      workerId: "sewing-b",
      workerName: "Sewing B",
      collaborationJoin: true
    });
    await repository.createScanRecord({
      orderId,
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "complete",
      scanAction: "sewing_finish",
      workerProfileId: "sewing-profile-b",
      workerId: "sewing-b",
      workerName: "Sewing B",
      workHours: 1,
      pieces: 8
    });
    await repository.createScanRecord({
      orderId,
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "complete",
      scanAction: "sewing_finish",
      workerProfileId: "sewing-profile-a",
      workerId: "sewing-a",
      workerName: "Sewing A",
      workHours: 1,
      pieces: 12
    });

    const reference = await request(`/api/admin/orders/${orderId}/process-pieces`, {
      headers: headers("boss")
    });
    expect(reference.response.status).toBe(200);
    expect(reference.body.result).toMatchObject({ orderId, sewing: 20 });
  });

  it("keeps pricing draft quantity local, then confirmation immediately synchronizes the order and audit", async () => {
    const orderId = await createSampleOrder("ORDER-QTY-PENDING-CONFIRM", 1);
    const sampleChargeId = await initializeSamplePricing(orderId);

    const priced = await setSamplePricing(orderId, sampleChargeId, 200, 3);
    expect(priced.body.summary).toMatchObject({ customerQuoteSubtotal: 600 });
    expect((await repository.findOrderById(orderId))?.quantity).toBe(1);

    await confirmPricing(orderId);
    const confirmedOrder = await repository.findOrderById(orderId);
    expect(confirmedOrder?.quantity).toBe(3);
    expect(confirmedOrder?.correctionLogs).toEqual([
      expect.objectContaining({
        fieldName: "quantity",
        changedByRole: "boss",
        oldValue: 1,
        newValue: 3
      })
    ]);

    const statement = await createStatement(orderId);
    expect((await repository.findOrderById(orderId))?.quantity).toBe(3);
    expect(statement.items).toEqual([
      expect.objectContaining({
        orderId,
        quantity: 3,
        sampleAmount: 600,
        receivableTotal: 600
      })
    ]);
    expect((await repository.findOrderById(orderId))?.correctionLogs).toHaveLength(1);
  });

  it("updates a pending statement and order only when the revised quotation is confirmed", async () => {
    const orderId = await createSampleOrder("ORDER-QTY-STATEMENT-UPDATE", 1);
    const sampleChargeId = await initializeSamplePricing(orderId);
    await setSamplePricing(orderId, sampleChargeId, 200, 3);
    await confirmPricing(orderId);

    await createStatement(orderId);
    expect((await repository.findOrderById(orderId))?.quantity).toBe(3);

    const begin = await request(`/api/admin/orders/${orderId}/pricing/begin-update`, {
      method: "POST",
      headers: headers("boss")
    });
    expect(begin.response.status).toBe(200);

    await setSamplePricing(orderId, sampleChargeId, 200, 4);
    expect((await repository.findOrderById(orderId))?.quantity).toBe(3);
    const beforeConfirm = await repository.listReconciliationStatements();
    expect(beforeConfirm[0]?.items[0]?.quantity).toBe(3);

    await confirmPricing(orderId);
    const afterOrder = await repository.findOrderById(orderId);
    expect(afterOrder?.quantity).toBe(4);
    expect(afterOrder?.correctionLogs).toEqual([
      expect.objectContaining({ oldValue: 1, newValue: 3, fieldName: "quantity" }),
      expect.objectContaining({ oldValue: 3, newValue: 4, fieldName: "quantity" })
    ]);
    const afterConfirm = await repository.listReconciliationStatements();
    expect(afterConfirm[0]?.items[0]).toMatchObject({
      orderId,
      quantity: 4,
      sampleAmount: 800,
      receivableTotal: 800
    });
  });

  it("keeps returned reconciliation orders priced until an explicit pricing update begins", async () => {
    const orderId = await createSampleOrder("ORDER-QTY-RETURN-PRICED", 1);
    const sampleChargeId = await initializeSamplePricing(orderId);
    await setSamplePricing(orderId, sampleChargeId, 200, 3);
    await confirmPricing(orderId);
    const statement = await createStatement(orderId);
    const item = (statement.items as JsonValue[])[0]!;

    const returned = await request(
      `/api/admin/reconciliation-statements/${statement.id}/items/${item.id}/return`,
      {
        method: "POST",
        headers: headers("boss")
      }
    );
    expect(returned.response.status).toBe(200);

    const pricing = await repository.findPricingRecordByOrderId(orderId);
    expect(pricing?.quotationStatus).toBe("confirmed");

    const rows = await request("/api/admin/pricing/orders", {
      headers: headers("boss")
    });
    expect(rows.response.status).toBe(200);
    const returnedRow = (rows.body.rows as JsonValue[]).find(
      (row) => (row.order as JsonValue).id === orderId
    );
    expect(returnedRow).toBeTruthy();
    expect((returnedRow!.pricing as JsonValue).quotationStatus).toBe("confirmed");
    expect(returnedRow!.quotationHasUnconfirmedChanges).toBe(false);
  });
});
