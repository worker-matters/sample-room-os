import { readSheet } from "read-excel-file/node";
import { describe, expect, it, vi } from "vitest";
import { summarizePricing } from "./pricingCalculationService.js";
import {
  createStatementDownload,
  createStatementExcelBuffer,
  createStatementWorksheet,
  safeFilenamePart,
  statementExcelFileName,
  statementInfoRowHeight
} from "./reconciliationStatementExportService.js";
import type { ReconciliationStatementRecord } from "./pricingTypes.js";
import { ReconciliationStatementService } from "./reconciliationStatementService.js";
import {
  createClientOrder,
  createReceiverSelfEntry,
  headers,
  rawRequest,
  repository,
  request,
  type JsonValue
} from "../receiver/testHelpers.js";

async function confirmQuotation(orderId: string) {
  return request(`/api/admin/orders/${orderId}/pricing/confirm`, {
    method: "POST",
    headers: headers("boss")
  });
}

async function addOrderCharge(orderId: string, name: string, amount: number) {
  const created = await request(`/api/receiver/orders/${orderId}/charges`, {
    method: "POST",
    headers: headers("receiver"),
    body: JSON.stringify({
      name,
      amount,
      explanation: `${name} confirmed`,
      sourceScene: "pricing_regression"
    })
  });
  const chargeId = (created.body.charge as JsonValue).id as string;
  return request(`/api/admin/orders/${orderId}/charges/${chargeId}/confirm`, {
    method: "POST",
    headers: headers("boss")
  });
}

async function createReceivedOrder(
  styleNo: string,
  requestHeaders: Record<string, string> = headers("client_business_user"),
  extraPayload: Record<string, unknown> = {}
) {
  const created = await createClientOrder(styleNo, requestHeaders, extraPayload);
  const orderId = (created.body.order as JsonValue).id as string;
  const accepted = await request(`/api/receiver/orders/${orderId}/accept`, {
    method: "POST",
    headers: headers("receiver"),
    body: JSON.stringify({ patternStatus: "none" })
  });

  expect(created.response.status).toBe(201);
  expect(accepted.response.status).toBe(200);
  return accepted;
}

describe("boss pricing and reconciliation API", () => {
  it("lists pending-receive and received orders for boss and system owner and keeps pricing stats aligned", async () => {
    const pending = await createClientOrder("PRICE-PENDING-RECEIVE", headers("client_business_user"), {
      sampleRequestItems: ["cutting"]
    });
    const pendingOrder = pending.body.order as JsonValue;

    const unpriced = await createReceivedOrder("PRICE-FORMAL-UNPRICED");
    const unpricedOrderId = (unpriced.body.order as JsonValue).id as string;
    const priced = await createReceivedOrder("PRICE-FORMAL-PRICED");
    const pricedOrderId = (priced.body.order as JsonValue).id as string;
    await request(`/api/admin/orders/${pricedOrderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({ quotedPrice: 100, costAmount: 0 })
    });
    await confirmQuotation(pricedOrderId);

    const bossRows = await request("/api/admin/pricing/orders", {
      headers: headers("boss")
    });
    const systemOwnerRows = await request("/api/admin/pricing/orders", {
      headers: headers("system_owner")
    });
    const rows = bossRows.body.rows as JsonValue[];
    const rowIds = rows.map((row) => (row.order as JsonValue).id);
    const pricedCount = rows.filter(
      (row) =>
        (row.summary as JsonValue).quotationStatus === "confirmed" &&
        row.quotationHasUnconfirmedChanges !== true
    ).length;

    expect(pending.response.status).toBe(201);
    expect(pendingOrder).toMatchObject({
      intakeStatus: "pending_receive",
      stage: null
    });
    expect(bossRows.response.status).toBe(200);
    expect(systemOwnerRows.response.status).toBe(200);
    expect(systemOwnerRows.body.rows).toEqual(bossRows.body.rows);
    expect(rowIds).toEqual(expect.arrayContaining([pendingOrder.id, unpricedOrderId, pricedOrderId]));
    expect({ unpriced: rows.length - pricedCount, priced: pricedCount }).toEqual({
      unpriced: 2,
      priced: 1
    });

    const corrected = await request(
      `/api/receiver/orders/${pendingOrder.id as string}/correction`,
      {
        method: "PATCH",
        headers: headers("receiver"),
        body: JSON.stringify({ sampleRequestItems: ["sample_garment"] })
      }
    );
    const accepted = await request(
      `/api/receiver/orders/${pendingOrder.id as string}/accept`,
      {
        method: "POST",
        headers: headers("receiver"),
        body: JSON.stringify({ patternStatus: "none" })
      }
    );
    const refreshedBossRows = await request("/api/admin/pricing/orders", {
      headers: headers("boss")
    });
    const refreshedSystemOwnerRows = await request("/api/admin/pricing/orders", {
      headers: headers("system_owner")
    });
    const refreshedRows = refreshedBossRows.body.rows as JsonValue[];
    const refreshedPricedCount = refreshedRows.filter(
      (row) =>
        (row.summary as JsonValue).quotationStatus === "confirmed" &&
        row.quotationHasUnconfirmedChanges !== true
    ).length;

    expect(corrected.response.status).toBe(200);
    expect(accepted.body.order).toMatchObject({ intakeStatus: "received" });
    expect(
      refreshedRows.map((row) => (row.order as JsonValue).id)
    ).toContain(pendingOrder.id);
    expect(refreshedSystemOwnerRows.body.rows).toEqual(refreshedBossRows.body.rows);
    expect({
      unpriced: refreshedRows.length - refreshedPricedCount,
      priced: refreshedPricedCount
    }).toEqual({ unpriced: 2, priced: 1 });
  });

  it("keeps terminated orders and their existing pricing row in pending pricing", async () => {
    const created = await createReceivedOrder("PRICE-TERMINATION-REGRESSION");
    const orderId = (created.body.order as JsonValue).id as string;
    await request(`/api/admin/orders/${orderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({ quotedPrice: 120, costAmount: 70 })
    });

    const terminated = await request(`/api/admin/orders/${orderId}/terminate`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ reason: "pricing list regression" })
    });
    const rowsWhileTerminated = await request("/api/admin/pricing/orders", {
      headers: headers("boss")
    });
    expect(terminated.response.status).toBe(200);
    const terminatedPricingRow = (rowsWhileTerminated.body.rows as JsonValue[]).find(
      (row) => (row.order as JsonValue).id === orderId
    );
    expect(terminatedPricingRow).toMatchObject({
      order: { id: orderId, terminated: true },
      pricing: { orderId }
    });

    const restored = await request(`/api/admin/orders/${orderId}/restore`, {
      method: "POST",
      headers: headers("boss")
    });
    const rowsAfterRestore = await request("/api/admin/pricing/orders", {
      headers: headers("boss")
    });
    const restoredPricingRow = (rowsAfterRestore.body.rows as JsonValue[]).find(
      (row) => (row.order as JsonValue).id === orderId
    );
    expect(restored.response.status).toBe(200);
    expect(restoredPricingRow).toMatchObject({ pricing: { orderId } });
  });

  it("lets boss save order pricing while append-only charges remain independent", async () => {
    const created = await createReceivedOrder("PRICE-001");
    const orderId = (created.body.order as JsonValue).id as string;

    await addOrderCharge(orderId, "加急费", 20);
    await addOrderCharge(orderId, "特殊辅料", 10);
    const saved = await request(`/api/admin/orders/${orderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({
        quotedPrice: 120,
        costAmount: 70,
        note: "internal pricing note"
      })
    });

    expect(saved.response.status).toBe(200);
    expect(saved.body.summary).toMatchObject({
      orderId,
      quotedPrice: 120,
      sampleAmount: 360,
      stageCostTotal: 70,
      otherChargeTotal: 30,
      costAmount: 70,
      extraChargeTotal: 30,
      receivableTotal: 390,
      grossProfit: 290
    });
    expect(saved.body.pricing).toMatchObject({ orderId, note: "internal pricing note" });
    expect(saved.body.pricing).toMatchObject({ extraCharges: [] });

    const rows = await request("/api/admin/pricing/orders", {
      headers: headers("system_owner")
    });
    expect(rows.response.status).toBe(200);
    expect(rows.body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          order: expect.objectContaining({ id: orderId, styleNo: "PRICE-001" }),
          summary: expect.objectContaining({ receivableTotal: 390 })
        })
      ])
    );
  });

  it("uses task applicability as a recommendation hint without blocking real manual costs", async () => {
    const created = await createReceiverSelfEntry("PRICE-COST-APPLICABILITY", {
      sampleRequestItems: ["pattern_making"]
    });
    expect(created.response.status).toBe(201);
    const orderId = (created.body.order as JsonValue).id as string;

    const detail = await request(`/api/admin/orders/${orderId}/pricing`, {
      headers: headers("boss")
    });
    expect(detail.response.status).toBe(200);
    expect(detail.body.costApplicability).toEqual({
      pattern: true,
      cutting: false,
      sewing: false,
      finishing: false
    });
    expect(detail.body.patternTask).toMatchObject({
      requirements: ["pattern_making"]
    });

    const initialized = await request(`/api/admin/orders/${orderId}/pricing/initialize`, {
      method: "POST",
      headers: headers("boss")
    });
    expect(initialized.response.status).toBe(200);

    const manualCuttingCost = await request(`/api/admin/orders/${orderId}/pricing/internal-costs`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({
        name: "临时裁剪复核",
        category: "cutting",
        amount: 15,
        note: "客户临时要求裁片复核"
      })
    });
    expect(manualCuttingCost.response.status).toBe(201);
    expect(manualCuttingCost.body.costApplicability).toEqual(detail.body.costApplicability);
    expect(manualCuttingCost.body.pricing).not.toHaveProperty("internalCostExceptionNote");
    expect((manualCuttingCost.body.pricing as JsonValue).internalCostItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "临时裁剪复核",
          category: "cutting",
          amount: 15,
          sourceType: "manual"
        })
      ])
    );
  });

  it("recommends finishing with sewing and uses controlled customer quote names", async () => {
    const created = await createReceiverSelfEntry("PRICE-SMALL-SAMPLE", {
      sampleRequestItems: ["pattern_revision", "sample_small"]
    });
    expect(created.response.status).toBe(201);
    const orderId = (created.body.order as JsonValue).id as string;

    const initialized = await request(`/api/admin/orders/${orderId}/pricing/initialize`, {
      method: "POST",
      headers: headers("boss")
    });
    expect(initialized.response.status).toBe(200);
    expect((initialized.body.pricing as JsonValue).internalCostItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "缝制成本",
          category: "sewing",
          sourceTask: "生产小样"
        }),
        expect.objectContaining({
          name: "后整成本",
          category: "finishing",
          sourceTask: "生产小样"
        })
      ])
    );
    expect((initialized.body.pricing as JsonValue).customerChargeItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "小样费", sourceTask: "生产小样" }),
        expect.objectContaining({ name: "版费", sourceTask: "改版" })
      ])
    );
  });

  it("calculates receivable from unit quote, quantity, pattern fee, and other charges", async () => {
    const created = await createReceivedOrder("PRICE-FORMULA", headers("client_business_user"), {
      quantity: 2
    });
    const orderId = (created.body.order as JsonValue).id as string;

    const saved = await request(`/api/admin/orders/${orderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({
        quotedPrice: 200,
        customerPatternFee: 100,
        internalPatternCost: 100,
        internalCuttingCost: 200,
        internalSewingCost: 100
      })
    });

    await addOrderCharge(orderId, "\u4ee3\u6536\u6750\u6599\u8d39", 20);
    const refreshed = await request(`/api/admin/orders/${orderId}/pricing`, {
      headers: headers("boss")
    });

    expect(saved.response.status).toBe(200);
    expect(refreshed.body.summary).toMatchObject({
      orderId,
      quotedPrice: 200,
      sampleAmount: 400,
      stageCostTotal: 400,
      patternFeeTotal: 100,
      otherChargeTotal: 20,
      extraChargeTotal: 20,
      receivableTotal: 520,
      costAmount: 400,
      grossProfit: 100
    });

    const rows = await request("/api/admin/pricing/orders", {
      headers: headers("boss")
    });
    const row = (rows.body.rows as JsonValue[]).find((entry) => {
      const order = entry.order as JsonValue;
      return order.id === orderId;
    })!;

    expect(row.summary).toMatchObject({
      sampleAmount: 400,
      patternFeeTotal: 100,
      receivableTotal: 520,
      costAmount: 400,
      grossProfit: 100
    });
  });

  it("keeps zero quantity safe and never reclassifies legacy stage cost as customer pattern fee", () => {
    const summary = summarizePricing(
      { id: "zero-quantity-order", quantity: 0 },
      {
        id: "pricing-zero",
        orderId: "zero-quantity-order",
        quotedPrice: 350,
        quotationStatus: "draft",
        createdAt: "2026-06-21T00:00:00.000Z",
        updatedAt: "2026-06-21T00:00:00.000Z",
        extraCharges: [
          {
            id: "charge-pattern",
            pricingRecordId: "pricing-zero",
            label: "\u5236\u7248\u5de5\u8d39",
            amount: 100,
            createdAt: "2026-06-21T00:00:00.000Z"
          },
          {
            id: "charge-cutting",
            pricingRecordId: "pricing-zero",
            label: "\u88c1\u526a\u5de5\u8d39",
            amount: 200,
            createdAt: "2026-06-21T00:00:00.000Z"
          },
          {
            id: "charge-sewing",
            pricingRecordId: "pricing-zero",
            label: "\u7f1d\u5236\u5de5\u8d39",
            amount: 300,
            createdAt: "2026-06-21T00:00:00.000Z"
          },
          {
            id: "charge-other",
            pricingRecordId: "pricing-zero",
            label: "\u8fd0\u8d39",
            amount: 50,
            note: "\u5ba2\u6237\u786e\u8ba4",
            createdAt: "2026-06-21T00:00:00.000Z"
          }
        ]
      }
    );

    expect(summary).toMatchObject({
      sampleAmount: 0,
      stageCostTotal: 600,
      patternFeeTotal: 0,
      otherChargeTotal: 50,
      receivableTotal: 50,
      costAmount: 600,
      grossProfit: -600
    });
  });

  it("does not calculate a sample amount from the compatibility quantity of a pattern-only order", () => {
    const summary = summarizePricing(
      {
        id: "pattern-only-order",
        quantity: 7,
        sampleRequestItems: ["pattern_making"]
      },
      {
        id: "pattern-only-pricing",
        orderId: "pattern-only-order",
        quotedPrice: 300,
        customerPatternFee: 500,
        quotationStatus: "draft",
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
        extraCharges: []
      }
    );

    expect(summary).toMatchObject({ sampleAmount: 0, receivableTotal: 500 });
  });

  it("keeps pass-through other charges in receivable but out of gross profit and margin revenue", () => {
    const onlyOtherCharge = summarizePricing(
      { id: "other-only", quantity: 1 },
      {
        id: "other-only-pricing",
        orderId: "other-only",
        quotedPrice: 0,
        customerPatternFee: 0,
        internalPatternCost: 0,
        quotationStatus: "draft",
        createdAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
        extraCharges: [{ id: "other-only-charge", pricingRecordId: "other-only-pricing", label: "实报实销", amount: 1231, createdAt: "2026-07-11T00:00:00.000Z" }]
      }
    );
    expect(onlyOtherCharge).toMatchObject({ receivableTotal: 1231, grossProfit: 0 });

    const mixed = summarizePricing(
      { id: "mixed", quantity: 1, sampleRequestItems: ["sample_garment"] },
      {
        id: "mixed-pricing",
        orderId: "mixed",
        quotedPrice: 1000,
        customerPatternFee: 200,
        internalPatternCost: 700,
        quotationStatus: "draft",
        createdAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
        extraCharges: [{ id: "mixed-charge", pricingRecordId: "mixed-pricing", label: "实报实销", amount: 300, createdAt: "2026-07-11T00:00:00.000Z" }]
      }
    );
    expect(mixed).toMatchObject({ receivableTotal: 1500, grossProfit: 500 });
  });

  it("creates statement snapshots, removes priced orders from pending pricing, and blocks paid returns", async () => {
    const first = await createReceivedOrder("STATEMENT-001", headers("client_business_user"), {
      quantity: 2
    });
    const second = await createReceivedOrder("STATEMENT-002", headers("client_business_user"), {
      quantity: 1
    });
    const firstOrderId = (first.body.order as JsonValue).id as string;
    const secondOrderId = (second.body.order as JsonValue).id as string;

    await addOrderCharge(firstOrderId, "\u4ee3\u6536\u6750\u6599\u8d39", 20);
    await request(`/api/admin/orders/${firstOrderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({
        quotedPrice: 200,
        costAmount: 20,
        customerPatternFee: 100,
        note: "客户版备注"
      })
    });
    await request(`/api/admin/orders/${secondOrderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({
        quotedPrice: 100,
        costAmount: 0
      })
    });
    await confirmQuotation(firstOrderId);
    await confirmQuotation(secondOrderId);

    const created = await request("/api/admin/reconciliation-statements", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ orderIds: [firstOrderId, secondOrderId] })
    });

    expect(created.response.status).toBe(201);
    expect(created.body.statement).toMatchObject({
      customerName: "Mock Active Customer",
      salespersonName: "客户 A 普通业务员",
      orderCount: 2,
      receivableAmount: 620,
      paidAmount: 0,
      status: "pending_payment",
      items: expect.arrayContaining([
        expect.objectContaining({
          orderId: firstOrderId,
          quotedPrice: 200,
          sampleAmount: 400,
          patternFeeTotal: 100,
          otherChargeTotal: 20,
          otherChargeNote: "\u4ee3\u6536\u6750\u6599\u8d39：\u4ee3\u6536\u6750\u6599\u8d39 confirmed",
          receivableTotal: 520,
          remark: "客户版备注"
        }),
        expect.objectContaining({
          orderId: secondOrderId,
          quotedPrice: 100,
          sampleAmount: 100,
          receivableTotal: 100
        })
      ])
    });
    const createdStatement = created.body.statement as JsonValue;
    const statementId = createdStatement.id as string;
    const firstStatementItemId = ((createdStatement.items as JsonValue[])[0]!.id) as string;

    const pendingRows = await request("/api/admin/pricing/orders", {
      headers: headers("boss")
    });
    expect((pendingRows.body.rows as JsonValue[]).some((row) => {
      const order = row.order as JsonValue;
      return order.id === firstOrderId || order.id === secondOrderId;
    })).toBe(false);

    const beginUpdateInPendingStatement = await request(
      `/api/admin/orders/${firstOrderId}/pricing/begin-update`,
      { method: "POST", headers: headers("boss") }
    );
    expect(beginUpdateInPendingStatement.response.status).toBe(200);
    const updatedPricing = await request(`/api/admin/orders/${firstOrderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({
        quotedPrice: 250,
        costAmount: 30,
        customerPatternFee: 100
      })
    });
    expect(updatedPricing.response.status).toBe(200);
    const updatedInternalCost = await request(
      `/api/admin/orders/${firstOrderId}/pricing/internal-costs`,
      {
        method: "POST",
        headers: headers("boss"),
        body: JSON.stringify({
          name: "更新报价人工成本",
          category: "sewing",
          amount: 30
        })
      }
    );
    expect(updatedInternalCost.response.status).toBe(201);

    const draftStatementResponse = await request("/api/admin/reconciliation-statements", {
      headers: headers("boss")
    });
    const draftStatement = (draftStatementResponse.body.statements as JsonValue[]).find(
      (statement) => statement.id === statementId
    )!;
    expect(draftStatement.receivableAmount).toBe(620);
    expect((draftStatement.items as JsonValue[])[0]).toMatchObject({
      quotedPrice: 200,
      sampleAmount: 400,
      receivableTotal: 520
    });

    const reconfirmed = await confirmQuotation(firstOrderId);
    expect(reconfirmed.response.status).toBe(200);

    const refreshedStatementResponse = await request("/api/admin/reconciliation-statements", {
      headers: headers("boss")
    });
    const refreshedStatement = (refreshedStatementResponse.body.statements as JsonValue[]).find(
      (statement) => statement.id === statementId
    )!;
    expect(refreshedStatement.receivableAmount).toBe(720);
    expect((refreshedStatement.items as JsonValue[])[0]).toMatchObject({
      quotedPrice: 250,
      sampleAmount: 500,
      patternFeeTotal: 100,
      customerPatternFee: 100,
      otherChargeTotal: 20,
      otherChargeNote: "代收材料费：代收材料费 confirmed",
      receivableTotal: 620,
      internalBaseCost: 30,
      internalTotalCost: 30,
      customerChargeSnapshot: expect.any(Array),
      internalCostSnapshot: expect.arrayContaining([
        expect.objectContaining({ amount: 30 })
      ])
    });

    const paid = await request(`/api/admin/reconciliation-statements/${statementId}/mark-paid`, {
      method: "POST",
      headers: headers("boss")
    });
    expect(paid.response.status).toBe(200);
    expect(paid.body.statement).toMatchObject({
      status: "paid",
      paidAmount: 720
    });

    const returnedPaid = await request(`/api/admin/reconciliation-statements/${statementId}/return`, {
      method: "POST",
      headers: headers("boss")
    });
    expect(returnedPaid.response.status).toBe(409);

    const returnedPaidItem = await request(
      `/api/admin/reconciliation-statements/${statementId}/items/${firstStatementItemId}/return`,
      { method: "POST", headers: headers("boss") }
    );
    expect(returnedPaidItem.response.status).toBe(409);

    const beginUpdateInPaidStatement = await request(
      `/api/admin/orders/${firstOrderId}/pricing/begin-update`,
      { method: "POST", headers: headers("boss") }
    );
    expect(beginUpdateInPaidStatement.response.status).toBe(409);

    const undone = await request(`/api/admin/reconciliation-statements/${statementId}/undo-paid`, {
      method: "POST",
      headers: headers("boss")
    });
    expect(undone.response.status).toBe(200);
    expect(undone.body.statement).toMatchObject({
      status: "pending_payment",
      paidAmount: 0
    });
    expect(undone.body.statement).not.toHaveProperty("paidAt");
    expect(undone.body.statement).not.toHaveProperty("paidBy");

    const returnedAfterUndo = await request(
      `/api/admin/reconciliation-statements/${statementId}/return`,
      { method: "POST", headers: headers("boss") }
    );
    expect(returnedAfterUndo.response.status).toBe(200);
    expect(returnedAfterUndo.body.statement).toMatchObject({
      status: "returned",
      receivableAmount: 720
    });

    const blockedAfterReturn = await request(`/api/admin/orders/${firstOrderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({ quotedPrice: 300, costAmount: 40, customerPatternFee: 100 })
    });
    expect(blockedAfterReturn.response.status).toBe(409);

    const beginUpdateAfterReturn = await request(
      `/api/admin/orders/${firstOrderId}/pricing/begin-update`,
      { method: "POST", headers: headers("boss") }
    );
    expect(beginUpdateAfterReturn.response.status).toBe(200);

    const changedAfterReturn = await request(`/api/admin/orders/${firstOrderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({ quotedPrice: 300, costAmount: 40, customerPatternFee: 100 })
    });
    expect(changedAfterReturn.response.status).toBe(200);
    expect((await confirmQuotation(firstOrderId)).response.status).toBe(200);

    const returnedHistoryResponse = await request(
      "/api/admin/reconciliation-statements?includeReturned=true",
      { headers: headers("boss") }
    );
    const returnedHistory = (returnedHistoryResponse.body.statements as JsonValue[]).find(
      (statement) => statement.id === statementId
    )!;
    expect(returnedHistory.receivableAmount).toBe(720);
    expect((returnedHistory.items as JsonValue[])[0]).toMatchObject({
      quotedPrice: 250,
      sampleAmount: 500,
      receivableTotal: 620
    });
  });

  it("allows only one concurrent statement creation and releases the order after a whole return", async () => {
    const createdOrder = await createReceivedOrder("STATEMENT-CONCURRENT");
    const orderId = (createdOrder.body.order as JsonValue).id as string;
    await request(`/api/admin/orders/${orderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({ quotedPrice: 88, costAmount: 0 })
    });
    await confirmQuotation(orderId);

    const options = {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ orderIds: [orderId] })
    } satisfies RequestInit;
    const responses = await Promise.all([
      rawRequest("/api/admin/reconciliation-statements", options),
      rawRequest("/api/admin/reconciliation-statements", options)
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);

    const conflictResponse = responses.find((response) => response.status === 409)!;
    expect(await conflictResponse.json()).toMatchObject({
      error: "部分订单已由其他操作生成对账单，列表已刷新。"
    });
    const createdResponse = responses.find((response) => response.status === 201)!;
    const createdBody = (await createdResponse.json()) as JsonValue;
    const statement = createdBody.statement as JsonValue;
    const statementId = statement.id as string;
    expect((statement.items as JsonValue[]).filter((item) => item.orderId === orderId)).toHaveLength(1);

    const returned = await request(`/api/admin/reconciliation-statements/${statementId}/return`, {
      method: "POST",
      headers: headers("boss")
    });
    expect(returned.response.status).toBe(200);
    expect(returned.body.statement).toMatchObject({ status: "returned" });
    expect(((returned.body.statement as JsonValue).items as JsonValue[])[0]).toMatchObject({
      orderId,
      returnedAt: expect.any(String),
      returnedBy: expect.any(String)
    });

    await confirmQuotation(orderId);
    const regenerated = await request("/api/admin/reconciliation-statements", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ orderIds: [orderId] })
    });
    expect(regenerated.response.status).toBe(201);
  });

  it("rolls back quotation confirmation when the pending statement snapshot cannot update", async () => {
    const createdOrder = await createReceivedOrder("STATEMENT-SYNC-ROLLBACK");
    const orderId = (createdOrder.body.order as JsonValue).id as string;
    await request(`/api/admin/orders/${orderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({ quotedPrice: 100, costAmount: 10 })
    });
    expect((await confirmQuotation(orderId)).response.status).toBe(200);
    const created = await request("/api/admin/reconciliation-statements", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ orderIds: [orderId] })
    });
    const statement = created.body.statement as JsonValue;
    const statementId = statement.id as string;
    expect(statement.receivableAmount).toBe(300);

    expect((await request(`/api/admin/orders/${orderId}/pricing/begin-update`, {
      method: "POST",
      headers: headers("boss")
    })).response.status).toBe(200);
    await request(`/api/admin/orders/${orderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({ quotedPrice: 180, costAmount: 20 })
    });

    const originalUpdate = repository.updateReconciliationStatementItem.bind(repository);
    repository.updateReconciliationStatementItem = async () => {
      throw new Error("forced statement snapshot failure");
    };
    try {
      expect((await confirmQuotation(orderId)).response.status).toBe(500);
    } finally {
      repository.updateReconciliationStatementItem = originalUpdate;
    }

    const pricing = await repository.findPricingRecordByOrderId(orderId);
    expect(pricing).toMatchObject({
      quotationStatus: "draft",
      quotedPrice: 180,
      confirmedSampleUnitPrice: 100,
      confirmedReceivableTotal: 300
    });
    const statements = await request("/api/admin/reconciliation-statements", {
      headers: headers("boss")
    });
    const unchanged = (statements.body.statements as JsonValue[]).find(
      (item) => item.id === statementId
    )!;
    expect(unchanged.receivableAmount).toBe(300);
    expect((unchanged.items as JsonValue[])[0]).toMatchObject({
      quotedPrice: 100,
      receivableTotal: 300
    });
  });

  it("returns an entire pending statement and releases all orders back to pending pricing", async () => {
    const createdOrder = await createReceivedOrder("STATEMENT-RETURN");
    const orderId = (createdOrder.body.order as JsonValue).id as string;

    await request(`/api/admin/orders/${orderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({ quotedPrice: 88, costAmount: 0 })
    });
    await confirmQuotation(orderId);
    const statement = await request("/api/admin/reconciliation-statements", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ orderIds: [orderId] })
    });
    const statementId = ((statement.body.statement as JsonValue).id) as string;

    const returned = await request(`/api/admin/reconciliation-statements/${statementId}/return`, {
      method: "POST",
      headers: headers("boss")
    });
    expect(returned.response.status).toBe(200);
    expect(returned.body.statement).toMatchObject({ status: "returned" });

    const defaultStatements = await request("/api/admin/reconciliation-statements", {
      headers: headers("boss")
    });
    expect((defaultStatements.body.statements as JsonValue[]).some((record) => record.id === statementId)).toBe(false);

    const allStatements = await request("/api/admin/reconciliation-statements?includeReturned=true", {
      headers: headers("boss")
    });
    expect((allStatements.body.statements as JsonValue[]).some((record) => record.id === statementId)).toBe(true);

    const pendingRows = await request("/api/admin/pricing/orders", {
      headers: headers("boss")
    });
    expect(pendingRows.body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          order: expect.objectContaining({ id: orderId }),
          summary: expect.objectContaining({ receivableTotal: 264 })
        })
      ])
    );
  });

  it("returns one statement item without a reason and keeps the remaining statement effective", async () => {
    const first = await createReceivedOrder("STATEMENT-ITEM-RETURN-A");
    const second = await createReceivedOrder("STATEMENT-ITEM-RETURN-B");
    const firstOrderId = (first.body.order as JsonValue).id as string;
    const secondOrderId = (second.body.order as JsonValue).id as string;

    for (const [orderId, quotedPrice] of [[firstOrderId, 100], [secondOrderId, 200]] as const) {
      await request(`/api/admin/orders/${orderId}/pricing`, {
        method: "PUT",
        headers: headers("boss"),
        body: JSON.stringify({ quotedPrice, costAmount: 0 })
      });
      await confirmQuotation(orderId);
    }

    const created = await request("/api/admin/reconciliation-statements", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ orderIds: [firstOrderId, secondOrderId] })
    });
    const statement = created.body.statement as JsonValue;
    const statementId = statement.id as string;
    const firstItem = (statement.items as JsonValue[]).find((item) => item.orderId === firstOrderId)!;
    const secondItem = (statement.items as JsonValue[]).find((item) => item.orderId === secondOrderId)!;

    const returned = await request(
      `/api/admin/reconciliation-statements/${statementId}/items/${firstItem.id as string}/return`,
      { method: "POST", headers: headers("boss") }
    );
    expect(returned.response.status).toBe(200);
    expect(returned.body.statement).toMatchObject({
      status: "pending_payment",
      orderCount: 1,
      receivableAmount: secondItem.receivableTotal
    });
    expect((returned.body.statement as JsonValue).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderId: firstOrderId, returnedAt: expect.any(String), returnedBy: expect.any(String) }),
        expect.objectContaining({ orderId: secondOrderId })
      ])
    );

    const pendingRows = await request("/api/admin/pricing/orders", { headers: headers("boss") });
    const pendingOrderIds = (pendingRows.body.rows as JsonValue[]).map((row) => (row.order as JsonValue).id);
    expect(pendingOrderIds).toContain(firstOrderId);
    expect(pendingOrderIds).not.toContain(secondOrderId);

    const unauthorized = await request(
      `/api/admin/reconciliation-statements/${statementId}/items/${secondItem.id as string}/return`,
      { method: "POST", headers: headers("receiver") }
    );
    expect(unauthorized.response.status).toBe(403);

    const returnedLastItem = await request(
      `/api/admin/reconciliation-statements/${statementId}/items/${secondItem.id as string}/return`,
      { method: "POST", headers: headers("boss") }
    );
    expect(returnedLastItem.response.status).toBe(200);
    expect(returnedLastItem.body.statement).toMatchObject({
      status: "returned",
      orderCount: 0,
      receivableAmount: 0,
      returnedAt: expect.any(String),
      returnedBy: expect.any(String)
    });
    expect((returnedLastItem.body.statement as JsonValue).items).toHaveLength(2);
  });

  it("filters reconciliation statements and downloads customer statement files", async () => {
    const first = await createReceivedOrder("STATEMENT-DOWNLOAD-A");
    const firstOrder = first.body.order as JsonValue;
    const firstOrderId = firstOrder.id as string;
    await request(`/api/admin/orders/${firstOrderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({ quotedPrice: 66, costAmount: 0 })
    });
    await confirmQuotation(firstOrderId);
    const firstStatement = await request("/api/admin/reconciliation-statements", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ orderIds: [firstOrderId] })
    });
    const firstStatementRecord = firstStatement.body.statement as JsonValue;
    const firstStatementId = firstStatementRecord.id as string;

    const second = await createReceivedOrder("STATEMENT-DOWNLOAD-B");
    const secondOrderId = ((second.body.order as JsonValue).id) as string;
    await request(`/api/admin/orders/${secondOrderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({ quotedPrice: 77, costAmount: 0 })
    });
    await confirmQuotation(secondOrderId);
    const secondStatement = await request("/api/admin/reconciliation-statements", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ orderIds: [secondOrderId] })
    });
    const secondStatementId = ((secondStatement.body.statement as JsonValue).id) as string;

    const customerFilter =
      (firstOrder.customerId as string | undefined) ?? (firstStatementRecord.customerName as string);
    const businessUserFilter =
      (firstOrder.clientUserId as string | undefined) ?? (firstStatementRecord.salespersonName as string);
    const generatedDate = new Date(firstStatementRecord.generatedAt as string).toLocaleDateString("sv-SE");
    const filtered = await request(
      `/api/admin/reconciliation-statements?q=${encodeURIComponent("STATEMENT-DOWNLOAD-A")}` +
        `&customerId=${encodeURIComponent(customerFilter)}` +
        `&customerBusinessUserId=${encodeURIComponent(businessUserFilter)}` +
        "&paymentStatus=pending" +
        `&dateFrom=${generatedDate}&dateTo=${generatedDate}`,
      { headers: headers("boss") }
    );
    expect(filtered.response.status).toBe(200);
    expect(filtered.body.statements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstStatementId,
          status: "pending_payment",
          items: expect.arrayContaining([
            expect.objectContaining({ orderId: firstOrderId, orderNo: expect.any(String) })
          ])
        })
      ])
    );

    const singleDownload = await rawRequest("/api/admin/reconciliation-statements/bulk-download", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ statementIds: [firstStatementId] })
    });
    expect(singleDownload.status).toBe(200);
    expect(singleDownload.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(singleDownload.headers.get("content-disposition")).toContain("filename*=");
    expect(Buffer.from(await singleDownload.arrayBuffer()).subarray(0, 2).toString("utf8")).toBe("PK");

    const selectedColumnDownload = await rawRequest("/api/admin/reconciliation-statements/bulk-download", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({
        statementIds: [firstStatementId],
        columns: ["orderNo", "receivableTotal"]
      })
    });
    expect(selectedColumnDownload.status).toBe(200);
    const selectedRows = await readSheet(Buffer.from(await selectedColumnDownload.arrayBuffer()), 1);
    expect(selectedRows.find((row) => row.includes("订单号"))?.filter((cell) => cell !== null))
      .toEqual(["订单号", "应收总计"]);

    const invalidColumnDownload = await request("/api/admin/reconciliation-statements/bulk-download", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ statementIds: [firstStatementId], columns: ["internalPatternCost"] })
    });
    expect(invalidColumnDownload.response.status).toBe(400);

    const bulkDownload = await rawRequest("/api/admin/reconciliation-statements/bulk-download", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ statementIds: [firstStatementId, secondStatementId] })
    });
    expect(bulkDownload.status).toBe(200);
    expect(bulkDownload.headers.get("content-type")).toContain("application/zip");
    expect(bulkDownload.headers.get("content-disposition")).toContain("filename*=");
    expect(Buffer.from(await bulkDownload.arrayBuffer()).subarray(0, 2).toString("utf8")).toBe("PK");
  });

  it("loads export-only sample labels and thumbnails without making thumbnail failures fatal", async () => {
    const createdOrder = await createReceivedOrder("STATEMENT-EXPORT-CONTEXT");
    const order = createdOrder.body.order as JsonValue;
    const orderId = order.id as string;
    for (const [eventTime, qualityResult] of [
      ["2026-06-20T08:00:00.000Z", "qualified"],
      ["2026-06-21T08:00:00.000Z", "rework"],
      ["2026-06-22T08:00:00.000Z", "qualified"]
    ] as const) {
      await repository.createScanRecord({
        orderId,
        stage: "qc_delivery",
        orderStage: "qc_delivery_waiting",
        action: "complete",
        scanAction: "qc_delivery_finish",
        workerId: "qc-export",
        workerName: "组检导出测试",
        eventTime,
        qualityResult
      });
    }
    await repository.createScanRecord({
      orderId,
      stage: "qc_delivery",
      orderStage: "done",
      action: "termination_complete",
      scanAction: "termination_complete",
      workerId: "qc-export",
      workerName: "组检导出测试",
      eventTime: "2026-06-23T08:00:00.000Z",
      qualityResult: "qualified"
    });
    await repository.createOrderAttachment({
      orderId,
      fileName: "style-thumbnail.png",
      mimeType: "image/png",
      size: 24,
      category: "style_thumbnail",
      uploadedBy: "mock-receiver",
      uploadedByRole: "receiver",
      visibility: "internal_only",
      storageKey: "orders/context/style-thumbnail.png"
    });
    await request(`/api/admin/orders/${orderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({ quotedPrice: 88, costAmount: 0 })
    });
    await confirmQuotation(orderId);
    const createdStatement = await request("/api/admin/reconciliation-statements", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ orderIds: [orderId] })
    });
    const statementId = ((createdStatement.body.statement as JsonValue).id) as string;
    const thumbnailBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", "base64");
    const readFile = vi.fn(async () => thumbnailBytes);
    const service = new ReconciliationStatementService(repository, {
      fileStorage: { readFile },
      sampleTypeService: {
        listOptions: async () => [{ value: "first_sample", label: "首样" }]
      }
    });
    const manager = { id: "mock-boss", role: "boss" as const };

    const downloaded = await service.downloadReconciliationStatements({ statementIds: [statementId] }, manager);
    const rows = await readSheet(downloaded.content, 1);
    const headerIndex = rows.findIndex((row) => row.includes("缩略图"));
    expect(rows[headerIndex]?.slice(0, 3)).toEqual(["接单日期", "交样日期", "缩略图"]);
    expect(rows[headerIndex]).toEqual(expect.arrayContaining(["缩略图", "样品类型", "轮次"]));
    expect(rows[headerIndex + 1]?.slice(0, 2)).toEqual([
      new Date(order.createdAt as string).toISOString().slice(0, 10),
      "2026-06-22"
    ]);
    expect(rows[headerIndex + 1]).toEqual(expect.arrayContaining(["首样", "第 1 轮"]));
    expect(downloaded.content.toString("utf8")).toContain("xl/media/image1.png");
    expect(readFile).toHaveBeenCalledOnce();

    await repository.createScanRecord({
      orderId,
      stage: "qc_delivery",
      orderStage: "qc_delivery_waiting",
      action: "complete",
      scanAction: "qc_delivery_finish",
      workerId: "qc-export",
      workerName: "组检导出测试",
      eventTime: "2026-06-24T08:00:00.000Z",
      qualityResult: "rework"
    });
    const unfinishedDelivery = await service.downloadReconciliationStatements({
      statementIds: [statementId],
      columns: ["deliveryDate", "styleNo"]
    }, manager);
    const unfinishedRows = await readSheet(unfinishedDelivery.content, 1);
    const unfinishedHeaderIndex = unfinishedRows.findIndex((row) => row.includes("交样日期"));
    expect(unfinishedRows[unfinishedHeaderIndex + 1]).toEqual([null, "STATEMENT-EXPORT-CONTEXT"]);

    readFile.mockClear();
    await service.downloadReconciliationStatements({
      statementIds: [statementId],
      columns: ["styleNo"]
    }, manager);
    expect(readFile).not.toHaveBeenCalled();

    readFile.mockRejectedValueOnce(new Error("missing thumbnail"));
    const withoutThumbnail = await service.downloadReconciliationStatements({ statementIds: [statementId] }, manager);
    expect(withoutThumbnail.content.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(withoutThumbnail.content.toString("utf8")).not.toContain("xl/media/image1.png");
  });

  it("exports customer statement Excel with pattern fee, other note, safe filenames, and no internal fields", async () => {
    const statement: ReconciliationStatementRecord = {
      id: "statement-export",
      statementNo: "DZ-20260621-003",
      customerName: "Mock/Active:Customer",
      salespersonName: "客户A*普通?业务员",
      billingPeriod: "2026-06-21",
      orderCount: 3,
      receivableAmount: 1510,
      paidAmount: 0,
      status: "pending_payment",
      generatedAt: "2026-06-21T10:30:00.000Z",
      items: [
        {
          id: "statement-item-export",
          statementId: "statement-export",
          orderId: "order-export",
          orderNo: "ORD-001",
          orderCreatedAt: "2026-06-18T12:30:00.000Z",
          folderCode: "SR-001",
          styleNo: "STYLE-001",
          styleName: "客户款名",
          customerName: "Mock/Active:Customer",
          salespersonName: "客户A*普通?业务员",
          quantity: 1,
          quotedPrice: 350,
          sampleAmount: 350,
          patternFeeTotal: 100,
          otherChargeTotal: 100,
          otherChargeNote: "加急费",
          receivableTotal: 550,
          generatedAt: "2026-06-21T10:30:00.000Z"
        },
        {
          id: "statement-item-export-2",
          statementId: "statement-export",
          orderId: "order-export-2",
          orderNo: "ORD-002-LONG-CUSTOMER-REFERENCE",
          folderCode: "SR-002-LONG",
          styleNo: "STYLE-002-LONG",
          styleName: "长客户款名用于验证 Excel 自动换行和列宽",
          customerName: "Mock/Active:Customer",
          salespersonName: "客户A*普通业务员",
          quantity: 3,
          quotedPrice: 200,
          sampleAmount: 600,
          patternFeeTotal: 100,
          otherChargeTotal: 260,
          otherChargeNote: "材料代收代付和加急处理说明",
          receivableTotal: 960,
          generatedAt: "2026-06-21T10:30:00.000Z"
        },
        {
          id: "statement-item-export-empty-quantity",
          statementId: "statement-export",
          orderId: "order-export-empty-quantity",
          orderNo: "ORD-EMPTY-QUANTITY",
          folderCode: "SR-EMPTY",
          styleNo: "STYLE-EMPTY",
          styleName: "空数量兼容行",
          customerName: "Mock/Active:Customer",
          salespersonName: "客户A*普通业务员",
          quantity: undefined as unknown as number,
          quotedPrice: 0,
          sampleAmount: 0,
          patternFeeTotal: 0,
          otherChargeTotal: 0,
          receivableTotal: 0,
          generatedAt: "2026-06-21T10:30:00.000Z"
        }
      ]
    };

    const fileName = statementExcelFileName(statement);
    expect(fileName).toBe("Mock_Active_Customer_客户A_普通_业务员_对账单_DZ-20260621-003.xlsx");
    expect(/[\\/:*?"<>|]/.test(fileName)).toBe(false);
    expect(safeFilenamePart(undefined, "未知客户")).toBe("未知客户");

    const thumbnailBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", "base64");
    const exportContext = {
      "order-export": {
        deliveryCompletedAt: "2026-06-22T08:00:00.000Z",
        sampleType: "产前样",
        sampleRound: "第 1 轮",
        otherChargeNote: "加急费：客户要求加急",
        thumbnail: {
          bytes: thumbnailBytes,
          extension: "png" as const,
          width: 1,
          height: 1,
          altText: "STYLE-001"
        }
      }
    };
    const excelBuffer = createStatementExcelBuffer(statement, undefined, exportContext);
    const rows = await readSheet(excelBuffer, 1);
    const headerIndex = rows.findIndex((row) => row.includes("缩略图"));
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    expect(rows[headerIndex]).toEqual([
      "接单日期",
      "交样日期",
      "缩略图",
      "款号",
      "款名",
      "样品类型",
      "轮次",
      "数量",
      "样衣单价",
      "样衣总价",
      "版费",
      "其他费用",
      "其他费用明细说明",
      "应收总计"
    ]);
    expect(rows[headerIndex + 1]).toEqual([
      "2026-06-18",
      "2026-06-22",
      null,
      "STYLE-001",
      "客户款名",
      "产前样",
      "第 1 轮",
      1,
      350,
      350,
      100,
      100,
      "加急费：客户要求加急",
      550
    ]);
    expect(rows[headerIndex + 2]?.slice(0, 2)).toEqual([null, null]);
    expect(excelBuffer.toString("utf8")).toContain("xl/media/image1.png");
    expect(excelBuffer.toString("utf8")).toContain("xl/drawings/drawing1.xml");
    expect(rows.find((row) => row[0] === "样衣总件数")?.filter((cell) => cell !== null))
      .toEqual(["样衣总件数", 4, "件"]);
    expect(rows.find((row) => row[0] === "应收合计")?.filter((cell) => cell !== null))
      .toEqual(["应收合计", 1510, "元"]);
    const flat = rows.flat().map(String).join(" ");
    expect(flat).toContain("样衣总件数");
    expect(flat).toContain("样衣单价");
    expect(flat).not.toContain("报价单价");
    for (const forbidden of ["缝制金额", "制版成本", "裁剪成本", "缝制成本", "成本合计", "毛利", "利润", "毛利率", "工时"]) {
      expect(flat).not.toContain(forbidden);
    }

    const worksheet = createStatementWorksheet(statement);
    expect(worksheet["!cols"]?.map((column) => column.wch)).toEqual([
      14,
      14,
      15,
      20,
      28,
      14,
      12,
      10,
      14,
      14,
      12,
      14,
      34,
      14
    ]);
    expect(worksheet["!rows"]?.some((row) => (row.hpt ?? 0) >= 26)).toBe(true);
    expect(worksheet.A1?.s?.alignment).toMatchObject({ wrapText: true, vertical: "top" });
    expect(statementInfoRowHeight("Mock Active Customer", 20, 36)).toBe(36);
    expect(statementInfoRowHeight("客户 A 普通业务员", 20, 33)).toBe(33);
    expect(statementInfoRowHeight("ACME", 20, 36)).toBe(22);
    expect(worksheet["!rows"][1]?.hpt).toBe(36);
    const shortNameWorksheet = createStatementWorksheet({
      ...statement,
      customerName: "ACME",
      salespersonName: "Li"
    });
    expect(shortNameWorksheet["!rows"][1]?.hpt).toBe(22);
    expect(shortNameWorksheet["!rows"][2]?.hpt).toBe(22);
    expect(worksheet["!cellStyleIds"][0]).toEqual([1, 2]);
    expect(worksheet["!cellStyleIds"][6]).toEqual(Array(14).fill(3));
    expect(worksheet["!cellStyleIds"][7]).toEqual([5, 5, 4, ...Array(11).fill(5)]);
    expect(worksheet["!cellStyleIds"][8]).toEqual([5, 5, 4, ...Array(11).fill(5)]);
    expect(worksheet["!cellStyleIds"].at(-2)).toEqual([6, 7, 7]);
    expect(worksheet["!cellStyleIds"].at(-1)).toEqual([6, 7, 8]);
    const excelXml = excelBuffer.toString("utf8");
    expect(excelXml).toContain('<font><b/><sz val="12"/><name val="宋体"/><charset val="134"/></font>');
    expect(excelXml).toContain('<font><b/><sz val="12"/><name val="Calibri"/><charset val="134"/></font>');
    expect(excelXml).toContain('<left style="thin"><color auto="1"/></left>');
    expect(excelXml).toContain('<alignment horizontal="center" vertical="center" wrapText="1"/>');

    const selectedRows = await readSheet(
      createStatementExcelBuffer(statement, ["orderNo", "styleNo", "receivableTotal"]),
      1
    );
    expect(selectedRows.find((row) => row.includes("订单号"))).toEqual([
      "订单号",
      "款号",
      "应收总计"
    ]);
    expect(selectedRows.flat().map(String)).not.toContain("样衣单价");
    expect(selectedRows.flat().map(String)).not.toContain("内部成本合计");

    const zipDownload = createStatementDownload([statement, { ...statement, id: "statement-export-2" }]);
    expect(zipDownload.fileName).toMatch(/^对账单批量下载_\d{4}-\d{2}-\d{2}_\d{4}\.zip$/);
    expect(zipDownload.content.toString("utf8")).toContain(fileName);
  });

  it("rejects statement generation for unpriced or mixed customer selections", async () => {
    const unpriced = await createReceivedOrder("STATEMENT-UNPRICED");
    const unpricedOrderId = (unpriced.body.order as JsonValue).id as string;

    const unpricedAttempt = await request("/api/admin/reconciliation-statements", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ orderIds: [unpricedOrderId] })
    });
    expect(unpricedAttempt.response.status).toBe(400);
    expect(unpricedAttempt.body.error).toBe("存在未定价订单，请先完成定价后再生成对账单");

    const activeCustomerOrder = await createReceivedOrder("STATEMENT-MIX-A");
    const otherCustomerOrder = await createReceivedOrder(
      "STATEMENT-MIX-B",
      headers("client_business_user", {
        customerId: "mock-customer-other",
        clientUserId: "mock-client-user-other"
      })
    );
    const activeOrderId = (activeCustomerOrder.body.order as JsonValue).id as string;
    const otherOrderId = (otherCustomerOrder.body.order as JsonValue).id as string;
    for (const orderId of [activeOrderId, otherOrderId]) {
      await request(`/api/admin/orders/${orderId}/pricing`, {
        method: "PUT",
        headers: headers("boss"),
        body: JSON.stringify({ quotedPrice: 50, costAmount: 0 })
      });
      await confirmQuotation(orderId);
    }

    const mixedAttempt = await request("/api/admin/reconciliation-statements", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ orderIds: [activeOrderId, otherOrderId] })
    });
    expect(mixedAttempt.response.status).toBe(400);
    expect(mixedAttempt.body.error).toBe("请选择同一客户和业务员的订单生成对账单");
  });

  it("blocks client and receiver access to pricing while keeping client DTO redacted", async () => {
    const created = await createReceivedOrder("PRICE-SAFE");
    const orderId = (created.body.order as JsonValue).id as string;

    await request(`/api/admin/orders/${orderId}/pricing`, {
      method: "PUT",
      headers: headers("boss"),
      body: JSON.stringify({
        quotedPrice: 200,
        costAmount: 90
      })
    });

    const clientAttempt = await request(`/api/admin/orders/${orderId}/pricing`, {
      headers: headers("client_business_user")
    });
    expect(clientAttempt.response.status).toBe(403);

    const receiverAttempt = await request(`/api/admin/orders/${orderId}/pricing`, {
      headers: headers("receiver")
    });
    expect(receiverAttempt.response.status).toBe(403);

    const clientOrders = await request("/api/client/orders", {
      headers: headers("client_business_user")
    });
    const order = (clientOrders.body.orders as JsonValue[]).find(
      (entry) => entry.id === orderId
    )!;

    expect(order).not.toHaveProperty("pricing");
    expect(order).not.toHaveProperty("quotedPrice");
    expect(order).not.toHaveProperty("costAmount");
    expect(order).not.toHaveProperty("internalCostExceptionNote");
    expect(order).not.toHaveProperty("extraCharges");
    expect(order).not.toHaveProperty("receivableTotal");
    expect(order).not.toHaveProperty("grossProfit");
  });

  it("returns worker-hour references for completed production stages", async () => {
    const created = await createReceivedOrder("PRICE-HOURS");
    const orderId = (created.body.order as JsonValue).id as string;

    repository.createScanRecord({
      orderId,
      stage: "pattern",
      orderStage: "pattern_doing",
      action: "complete",
      scanAction: "pattern_finish",
      workerId: "worker-pattern",
      workerName: "版师张三",
      workHours: 2.5,
      note: "排版完成"
    });
    repository.createScanRecord({
      orderId,
      stage: "cutting",
      orderStage: "cutting_doing",
      action: "complete",
      scanAction: "cutting_finish",
      workerId: "worker-cutting",
      workerName: "裁剪李四",
      workHours: 1.25,
      pieces: 3
    });

    const rows = await request("/api/admin/pricing/orders", {
      headers: headers("boss")
    });
    const row = (rows.body.rows as JsonValue[]).find((entry) => {
      const order = entry.order as JsonValue;
      return order.id === orderId;
    })!;

    expect(row.stageWork).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "cutting",
          stageLabel: "裁剪",
          workHours: 1.25,
          pieces: 3,
          workerNames: ["裁剪李四"]
        }),
        expect.objectContaining({
          stage: "pattern",
          stageLabel: "制版",
          workHours: 2.5,
          workerNames: ["版师张三"],
          note: "排版完成"
        })
      ])
    );
    expect(JSON.stringify(row)).not.toContain("passwordHash");
  });

  it("returns neutral comprehensive pattern-task completion notes for boss pricing reference", async () => {
    const created = await createClientOrder("PRICE-NO-SAMPLE");
    const orderId = (created.body.order as JsonValue).id as string;

    const accepted = await request(`/api/receiver/orders/${orderId}/accept`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        patternStatus: "none",
        fabricStatus: "missing",
        trimStatus: "missing",
        sampleRequestItems: ["pattern_making"]
      })
    });
    expect(accepted.response.status).toBe(200);
    const workbench = await request("/api/pattern-maker/workbench", {
      headers: headers("pattern_maker", { userId: "pattern-maker-pricing" })
    });
    const pending = (workbench.body.pending as JsonValue[]).find(
      (candidate) => candidate.orderId === orderId
    )!;
    const received = await request(`/api/pattern-maker/tasks/${pending.id as string}/start`, {
      method: "POST",
      headers: headers("pattern_maker", { userId: "pattern-maker-pricing" })
    });
    expect(received.response.status).toBe(200);
    const task = received.body.task as JsonValue;

    const upload = new FormData();
    upload.append("deliverableType", "pattern_file");
    upload.append("taskCategory", "pattern_making");
    upload.append("files", new Blob(["pricing pattern result"], { type: "application/octet-stream" }), "pricing-pattern.dxf");
    const uploaded = await request(`/api/pattern-maker/tasks/${task.id as string}/deliverable-versions`, {
      method: "POST",
      headers: {
        "x-dev-role": "pattern_maker",
        "x-dev-user-id": "pattern-maker-pricing"
      },
      body: upload
    });
    expect(uploaded.response.status).toBe(201);

    const completed = await request(`/api/pattern-maker/tasks/${task.id}/complete`, {
      method: "POST",
      headers: headers("pattern_maker", { userId: "pattern-maker-pricing" }),
      body: JSON.stringify({
        workHours: 1.25,
        note: "客户来版，完成排版归档",
        completedRequirements: task.requirements,
        deliverableType: "process_note",
        taskCategory: "pattern_making",
        textValue: "排版归档记录"
      })
    });
    expect(completed.response.status).toBe(200);

    const rows = await request("/api/admin/pricing/orders", {
      headers: headers("boss")
    });
    const row = (rows.body.rows as JsonValue[]).find((entry) => {
      const order = entry.order as JsonValue;
      return order.id === orderId;
    })!;

    expect(row.order).toMatchObject({ id: orderId, stage: "done" });
    expect(row.patternTask).toMatchObject({
      status: "completed",
      note: expect.stringContaining("综合版师任务完成")
    });
    expect(JSON.stringify(row.patternTask)).not.toContain("无需打样");
    expect(row.stageWork).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "pattern",
          workHours: 1.25
        })
      ])
    );
    expect(JSON.stringify(row)).not.toContain("passwordHash");
  });
});
