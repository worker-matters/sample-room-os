import { describe, expect, it } from "vitest";
import { ORDER_STAGES, ROLES } from "@sample-room/shared";
import { InMemorySampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { createInMemoryStore } from "../../db/repositories/memory/inMemoryStore.js";
import { summarizePricing } from "./pricingCalculationService.js";
import {
  createReceiverSelfEntry,
  headers,
  repository,
  request,
  type JsonValue
} from "../receiver/testHelpers.js";

async function createFormalOrder(
  styleNo: string,
  quantity = 3,
  extraPayload: Record<string, unknown> = {}
) {
  const created = await createReceiverSelfEntry(styleNo, { quantity, ...extraPayload });
  expect(created.response.status).toBe(201);
  return (created.body.order as JsonValue).id as string;
}

async function addCharge(
  base: "receiver" | "planner" | "admin",
  orderId: string,
  role: "receiver" | "planner" | "boss",
  name: string,
  amount: number
) {
  return request(`/api/${base}/orders/${orderId}/charges`, {
    method: "POST",
    headers: headers(role),
    body: JSON.stringify({
      name,
      amount,
      explanation: `${name} explanation`,
      sourceScene: `${role}_order_charge`
    })
  });
}

async function savePricing(orderId: string, payload: Record<string, unknown>) {
  return request(`/api/admin/orders/${orderId}/pricing`, {
    method: "PUT",
    headers: headers("boss"),
    body: JSON.stringify(payload)
  });
}

async function confirmQuotation(orderId: string) {
  return request(`/api/admin/orders/${orderId}/pricing/confirm`, {
    method: "POST",
    headers: headers("boss")
  });
}

describe("order charges, quotation, finishing, and performance", () => {
  it("keeps order charges append-only across receiver, planner, boss, review, void, and pricing saves", async () => {
    const orderId = await createFormalOrder("COMMERCIAL-CHARGES");
    const receiverCharge = await addCharge("receiver", orderId, "receiver", "加急费", 20);
    const plannerCharge = await addCharge("planner", orderId, "planner", "补料费", 15);
    const bossCharge = await addCharge("admin", orderId, "boss", "运输费", 10);

    for (const response of [receiverCharge, plannerCharge]) {
      expect(response.response.status).toBe(201);
      expect(response.body.charge).toMatchObject({ status: "effective" });
    }
    expect(bossCharge.response.status).toBe(201);
    expect(bossCharge.body.charge).toMatchObject({
      status: "confirmed",
      creatorRole: "boss",
      reviewedByRole: "boss"
    });
    expect(receiverCharge.body.charge).toMatchObject({
      name: "加急费",
      amount: 20,
      creatorRole: "receiver",
      sourceScene: "receiver_order_charge"
    });
    expect(plannerCharge.body.charge).toMatchObject({ creatorRole: "planner" });

    const receiverChargeId = (receiverCharge.body.charge as JsonValue).id as string;
    const plannerChargeId = (plannerCharge.body.charge as JsonValue).id as string;
    const reviewed = await request(
      `/api/admin/orders/${orderId}/charges/${receiverChargeId}/review`,
      { method: "POST", headers: headers("boss") }
    );
    expect(reviewed.response.status).toBe(200);
    expect(reviewed.body.charge).toMatchObject({
      id: receiverChargeId,
      status: "confirmed",
      reviewedByRole: "boss"
    });
    expect(typeof (reviewed.body.charge as JsonValue).reviewedAt).toBe("string");

    const plannerVoidAttempt = await request(
      `/api/planner/orders/${orderId}/charges/${receiverChargeId}/void`,
      {
        method: "POST",
        headers: headers("planner"),
        body: JSON.stringify({ reason: "planner cannot void" })
      }
    );
    expect(plannerVoidAttempt.response.status).toBe(403);

    const voided = await request(`/api/admin/orders/${orderId}/charges/${plannerChargeId}/void`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ reason: "重复录入" })
    });
    expect(voided.response.status).toBe(200);
    expect(voided.body.charge).toMatchObject({
      id: plannerChargeId,
      status: "void",
      voidReason: "重复录入",
      voidedByRole: "boss"
    });

    const physicalDelete = await request(
      `/api/admin/orders/${orderId}/charges/${plannerChargeId}`,
      { method: "DELETE", headers: headers("boss") }
    );
    expect(physicalDelete.response.status).toBe(404);

    const firstPricing = await savePricing(orderId, {
      quotedPrice: 100,
      customerPatternFee: 30,
      internalPatternCost: 11,
      internalCuttingCost: 12,
      internalSewingCost: 13
    });
    expect(firstPricing.response.status).toBe(200);
    const secondPricing = await savePricing(orderId, { internalPatternCost: 20 });
    expect(secondPricing.response.status).toBe(200);

    const listed = await request(`/api/admin/orders/${orderId}/charges`, {
      headers: headers("boss")
    });
    expect(listed.response.status).toBe(200);
    expect(listed.body.charges).toHaveLength(2);
    expect((listed.body.charges as JsonValue[]).filter((charge) => charge.status === "void"))
      .toHaveLength(0);

    for (const [base, role] of [
      ["receiver", "receiver"],
      ["planner", "planner"]
    ] as const) {
      const roleList = await request(`/api/${base}/orders/${orderId}/charges`, {
        headers: headers(role)
      });
      expect(roleList.response.status).toBe(200);
      expect((roleList.body.charges as JsonValue[]).length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(roleList.body)).not.toContain("internalPatternCost");
      expect(JSON.stringify(roleList.body)).not.toContain("quotedPrice");
    }

    const legacyOverwrite = await savePricing(orderId, {
      quotedPrice: 99,
      extraCharges: [{ label: "legacy overwrite", amount: 999 }]
    });
    expect(legacyOverwrite.response.status).toBe(400);
  });

  it("lets receiver and planner maintain only their own effective or legacy pending charges", async () => {
    const orderId = await createFormalOrder("COMMERCIAL-CHARGE-OWNERSHIP");
    const createOwn = async (role: "receiver" | "planner", userId: string, name: string) =>
      request(`/api/${role}/orders/${orderId}/charges`, {
        method: "POST",
        headers: headers(role, { userId }),
        body: JSON.stringify({ name, amount: 12, explanation: "原说明", sourceScene: `${role}_order_list` })
      });

    const receiver = await createOwn("receiver", "receiver-charge-owner", "接单员费用");
    const planner = await createOwn("planner", "planner-charge-owner", "计划员费用");
    expect(receiver.body.charge).toMatchObject({ status: "effective" });
    expect(planner.body.charge).toMatchObject({ status: "effective" });
    expect(receiver.body.charge).not.toHaveProperty("reviewedAt");
    expect(planner.body.charge).not.toHaveProperty("reviewedAt");

    const receiverId = (receiver.body.charge as JsonValue).id as string;
    const plannerId = (planner.body.charge as JsonValue).id as string;
    const updatedEffective = await request(`/api/receiver/orders/${orderId}/charges/${receiverId}`, {
      method: "PATCH",
      headers: headers("receiver", { userId: "receiver-charge-owner" }),
      body: JSON.stringify({ amount: 18, explanation: "已更新" })
    });
    expect(updatedEffective.response.status).toBe(200);
    expect(updatedEffective.body.charge).toMatchObject({ status: "effective", amount: 18, explanation: "已更新" });

    await repository.updateOrderCharge(plannerId, { status: "pending" });
    const updatedLegacyPending = await request(`/api/planner/orders/${orderId}/charges/${plannerId}`, {
      method: "PATCH",
      headers: headers("planner", { userId: "planner-charge-owner" }),
      body: JSON.stringify({ amount: 16 })
    });
    expect(updatedLegacyPending.response.status).toBe(200);
    expect(updatedLegacyPending.body.charge).toMatchObject({ status: "effective", amount: 16 });
    expect(updatedLegacyPending.body.charge).not.toHaveProperty("reviewedAt");

    const nonOwnerEdit = await request(`/api/planner/orders/${orderId}/charges/${receiverId}`, {
      method: "PATCH",
      headers: headers("planner", { userId: "other-planner" }),
      body: JSON.stringify({ amount: 99 })
    });
    const nonOwnerDelete = await request(`/api/planner/orders/${orderId}/charges/${receiverId}`, {
      method: "DELETE",
      headers: headers("planner", { userId: "other-planner" })
    });
    expect(nonOwnerEdit.response.status).toBe(403);
    expect(nonOwnerDelete.response.status).toBe(403);

    await repository.updateOrderCharge(receiverId, { status: "confirmed" });
    const confirmedEdit = await request(`/api/receiver/orders/${orderId}/charges/${receiverId}`, {
      method: "PATCH",
      headers: headers("receiver", { userId: "receiver-charge-owner" }),
      body: JSON.stringify({ amount: 20 })
    });
    const confirmedDelete = await request(`/api/receiver/orders/${orderId}/charges/${receiverId}`, {
      method: "DELETE",
      headers: headers("receiver", { userId: "receiver-charge-owner" })
    });
    expect(confirmedEdit.response.status).toBe(403);
    expect(confirmedDelete.response.status).toBe(403);

    const legacyPending = await createOwn("planner", "planner-legacy-owner", "历史待确认费用");
    const legacyPendingId = (legacyPending.body.charge as JsonValue).id as string;
    await repository.updateOrderCharge(legacyPendingId, { status: "pending" });
    const deletedLegacyPending = await request(`/api/planner/orders/${orderId}/charges/${legacyPendingId}`, {
      method: "DELETE",
      headers: headers("planner", { userId: "planner-legacy-owner" })
    });
    expect(deletedLegacyPending.response.status).toBe(200);
    expect(deletedLegacyPending.body.charge).toMatchObject({ status: "cancelled" });
  });

  it("uses the authenticated planner AccountSession for scan-token charge access", async () => {
    const orderId = await createFormalOrder("COMMERCIAL-SCAN-CHARGE");
    await repository.createOrderScanToken({
      orderId,
      token: "planner-charge-token",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });

    const added = await request(
      "/api/planner/orders/by-scan-token/planner-charge-token/charges",
      {
        method: "POST",
        headers: headers("planner"),
        body: JSON.stringify({
          name: "scan charge",
          amount: 8,
          explanation: "verified at planning desk",
          sourceScene: "planner_qr_scan"
        })
      }
    );
    expect(added.response.status).toBe(201);

    const invalid = await request("/api/planner/orders/by-scan-token/not-found/charges", {
      method: "POST",
      headers: headers("planner"),
      body: JSON.stringify({
        name: "invalid",
        amount: 8,
        explanation: "must not save",
        sourceScene: "planner_qr_scan"
      })
    });
    expect(invalid.response.status).toBe(404);
  });

  it("preserves the first void audit fact under concurrent boss requests", async () => {
    const orderId = await createFormalOrder("COMMERCIAL-CONCURRENT-VOID");
    const created = await addCharge("admin", orderId, "boss", "并发作废测试", 9);
    const chargeId = (created.body.charge as JsonValue).id as string;
    const attempts = await Promise.all(
      ["first void reason", "second void reason"].map((reason) =>
        request(`/api/admin/orders/${orderId}/charges/${chargeId}/void`, {
          method: "POST",
          headers: headers("boss"),
          body: JSON.stringify({ reason })
        })
      )
    );
    expect(attempts.map((attempt) => attempt.response.status).sort()).toEqual([200, 404]);
    const stored = await repository.findOrderChargeById(chargeId);
    expect(stored).toMatchObject({ status: "void" });
    expect(["first void reason", "second void reason"]).toContain(stored?.voidReason);
  });

  it("keeps legacy extra charges read-only while combining them with confirmed new charges", async () => {
    const store = createInMemoryStore();
    const isolatedRepository = new InMemorySampleRoomRepository(store);
    const pricing = isolatedRepository.upsertPricingRecord("legacy-order", { quotedPrice: 10 });
    const snapshot = store.snapshot();
    snapshot.extraCharges.push(
      {
        id: "legacy-pattern",
        pricingRecordId: pricing.id,
        label: "\u5236\u7248\u5de5\u8d39",
        amount: 9,
        createdAt: "2025-01-01T00:00:00.000Z"
      },
      {
        id: "legacy-other",
        pricingRecordId: pricing.id,
        label: "legacy shipping",
        amount: 5,
        createdAt: "2025-01-01T00:00:00.000Z"
      }
    );
    store.restore(snapshot);
    const newCharge = await isolatedRepository.createOrderCharge({
      orderId: "legacy-order",
      name: "new charge",
      amount: 7,
      explanation: "new append-only charge",
      sourceScene: "test",
      creatorId: "receiver-a",
      creatorRole: "receiver"
    });
    await isolatedRepository.reviewEffectiveOrderCharge(newCharge.id, {
      status: "confirmed",
      reviewedAt: "2026-07-27T00:00:00.000Z",
      reviewedBy: "boss-a",
      reviewedByName: "老板",
      reviewedByRole: "boss"
    });

    isolatedRepository.upsertPricingRecord(
      "legacy-order",
      {
        quotedPrice: 20,
        extraCharges: [{ label: "attempted replacement", amount: 999 }]
      } as unknown as Parameters<InMemorySampleRoomRepository["upsertPricingRecord"]>[1]
    );
    const after = isolatedRepository.findPricingRecordByOrderId("legacy-order")!;
    expect(after.extraCharges).toHaveLength(2);
    expect(after.extraCharges.map((charge) => charge.id)).toEqual([
      "legacy-pattern",
      "legacy-other"
    ]);
    const summary = summarizePricing(
      { id: "legacy-order", quantity: 1, sampleRequestItems: ["sample_garment"] },
      after,
      isolatedRepository.listOrderChargesByOrderId("legacy-order")
    );
    expect(summary).toMatchObject({
      customerPatternFee: 0,
      internalPatternCost: 9,
      effectiveCustomerOtherCharges: 12,
      receivableTotal: 32
    });
  });

  it("separates customer quotation from internal costs and exposes only manually confirmed quotation", async () => {
    const orderId = await createFormalOrder("COMMERCIAL-QUOTE", 2);
    const initialCharge = await addCharge("receiver", orderId, "receiver", "客户加急费", 5);
    const initialChargeId = (initialCharge.body.charge as JsonValue).id as string;
    await request(`/api/admin/orders/${orderId}/charges/${initialChargeId}/confirm`, {
      method: "POST",
      headers: headers("boss")
    });

    const saved = await savePricing(orderId, {
      quotedPrice: 200,
      customerPatternFee: 40,
      internalPatternCost: 30,
      internalCuttingCost: 20,
      internalSewingCost: 10
    });
    expect(saved.response.status).toBe(200);
    expect(saved.body.summary).toMatchObject({
      sampleUnitPrice: 200,
      sampleAmount: 400,
      customerPatternFee: 40,
      effectiveCustomerOtherCharges: 5,
      receivableTotal: 445,
      internalPatternCost: 30,
      internalCuttingCost: 20,
      internalSewingCost: 10,
      internalTotalCost: 60,
      grossProfit: 380,
      quotationStatus: "draft"
    });

    const clientHeaders = headers("client_business_user", {
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active"
    });
    const beforeConfirm = await request(`/api/client/orders/${orderId}/quotation`, {
      headers: clientHeaders
    });
    expect(beforeConfirm.response.status).toBe(200);
    expect(beforeConfirm.body.quotation).toBeNull();

    const confirmed = await confirmQuotation(orderId);
    expect(confirmed.response.status).toBe(200);
    expect(confirmed.body.pricing).toMatchObject({ quotationStatus: "confirmed" });
    expect(typeof (confirmed.body.pricing as JsonValue).confirmedAt).toBe("string");

    const clientQuotation = await request(`/api/client/orders/${orderId}/quotation`, {
      headers: clientHeaders
    });
    expect(clientQuotation.response.status).toBe(200);
    expect(clientQuotation.body.quotation).toMatchObject({
      sampleUnitPrice: 200,
      sampleAmount: 400,
      customerPatternFee: 40,
      effectiveCustomerOtherCharges: 5,
      receivableTotal: 445,
      otherCharges: [{
        name: "客户加急费",
        amount: 5,
        note: "客户加急费 explanation"
      }],
      status: "confirmed"
    });
    const clientJson = JSON.stringify(clientQuotation.body);
    for (const forbidden of [
      "internalPatternCost",
      "internalCuttingCost",
      "internalSewingCost",
      "internalFinishingCost",
      "internalTotalCost",
      "grossProfit",
      "otherChargeNote",
      "workHours",
      "worker"
    ]) {
      expect(clientJson).not.toContain(forbidden);
    }
    expect(clientJson).not.toContain('"explanation":');

    const laterCharge = await addCharge("admin", orderId, "boss", "confirmed extra charge", 10);
    expect(laterCharge.response.status).toBe(201);
    expect(laterCharge.body.charge).toMatchObject({ status: "confirmed" });

    const updatedAfterAdd = await request(`/api/client/orders/${orderId}/quotation`, {
      headers: clientHeaders
    });
    expect(updatedAfterAdd.body.quotation).toMatchObject({
      effectiveCustomerOtherCharges: 15,
      receivableTotal: 455,
      otherCharges: expect.arrayContaining([
        expect.objectContaining({ name: "客户加急费", amount: 5 }),
        expect.objectContaining({ name: "confirmed extra charge", amount: 10 })
      ])
    });
    const bossAfterAdd = await request(`/api/admin/orders/${orderId}/pricing`, {
      headers: headers("boss")
    });
    expect(bossAfterAdd.body).toMatchObject({
      pricing: { quotationStatus: "confirmed" },
      quotationHasUnconfirmedChanges: false,
      reconciliationEligibility: { eligible: true },
      confirmedQuotation: { receivableTotal: 455 },
      summary: { receivableTotal: 455 }
    });

    await request(`/api/admin/orders/${orderId}/charges/${initialChargeId}/void`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ reason: "void after confirmation" })
    });
    const updatedAfterVoid = await request(`/api/client/orders/${orderId}/quotation`, {
      headers: clientHeaders
    });
    expect(updatedAfterVoid.body.quotation).toMatchObject({
      effectiveCustomerOtherCharges: 10,
      receivableTotal: 450,
      otherCharges: [expect.objectContaining({ name: "confirmed extra charge", amount: 10 })]
    });
    const bossAfterVoid = await request(`/api/admin/orders/${orderId}/pricing`, {
      headers: headers("boss")
    });
    expect(bossAfterVoid.body).toMatchObject({
      pricing: { quotationStatus: "confirmed" },
      quotationHasUnconfirmedChanges: false,
      reconciliationEligibility: { eligible: true },
      confirmedQuotation: { receivableTotal: 450 },
      summary: { receivableTotal: 450 }
    });

    const lockedBaseChange = await savePricing(orderId, { customerPatternFee: 50 });
    expect(lockedBaseChange.response.status).toBe(409);

    const updateStarted = await request(
      `/api/admin/orders/${orderId}/pricing/begin-update`,
      { method: "POST", headers: headers("boss") }
    );
    expect(updateStarted.response.status).toBe(200);
    expect(updateStarted.body).toMatchObject({
      pricing: { quotationStatus: "draft" },
      confirmedQuotation: { receivableTotal: 450 }
    });

    const changed = await savePricing(orderId, { customerPatternFee: 50 });
    expect(changed.response.status).toBe(200);
    const updatedAfterBossPricingChange = await request(`/api/client/orders/${orderId}/quotation`, {
      headers: clientHeaders
    });
    expect(updatedAfterBossPricingChange.body.quotation).toMatchObject({
      customerPatternFee: 40,
      effectiveCustomerOtherCharges: 10,
      receivableTotal: 450
    });
  });

  it("shows finishing by configured QC route and derives pieces only from sewing completion", async () => {
    const orderId = await createFormalOrder("COMMERCIAL-FINISHING", 99);
    await repository.createScanRecord({
      orderId,
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "complete",
      scanAction: "sewing_finish",
      workerId: "sewing-worker-1",
      workerName: "缝制甲",
      workHours: 2,
      pieces: 7
    });
    await repository.createScanRecord({
      orderId,
      stage: "qc_delivery",
      orderStage: ORDER_STAGES.qcDeliveryWaiting,
      action: "complete",
      scanAction: "qc_delivery_finish",
      workerId: "qc-worker-1",
      workerName: "组检甲",
      workHours: 0.5,
      pieces: 7
    });

    const beforeEntry = await request(`/api/admin/orders/${orderId}/pricing`, {
      headers: headers("boss")
    });
    expect(beforeEntry.response.status).toBe(200);
    expect(beforeEntry.body.finishing).toMatchObject({ amount: null, pieces: 7 });

    const saved = await savePricing(orderId, {
      quotedPrice: 100,
      customerPatternFee: 0,
      internalPatternCost: 10,
      internalFinishingCost: 0,
      finishingNote: "后整已确认"
    });
    expect(saved.response.status).toBe(200);
    expect(saved.body.finishing).toMatchObject({
      visible: true,
      pieces: 7,
      amount: 0,
      note: "后整已确认",
      anomaly: null
    });

    const missingPiecesOrderId = await createFormalOrder("COMMERCIAL-FINISHING-MISSING", 88);
    await repository.createScanRecord({
      orderId: missingPiecesOrderId,
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "complete",
      scanAction: "sewing_finish",
      workerId: "sewing-worker-2",
      workerName: "缝制乙",
      workHours: 1
    });
    await repository.createScanRecord({
      orderId: missingPiecesOrderId,
      stage: "qc_delivery",
      orderStage: ORDER_STAGES.qcDeliveryWaiting,
      action: "complete",
      scanAction: "qc_delivery_finish",
      workerId: "qc-worker-2",
      workerName: "组检乙",
      workHours: 0.5
    });
    const anomaly = await savePricing(missingPiecesOrderId, {
      quotedPrice: 100,
      internalFinishingCost: 10
    });
    expect(anomaly.response.status).toBe(200);
    expect(anomaly.body.finishing).toMatchObject({
      visible: true,
      amount: 10,
      anomaly: "finishing_pieces_missing"
    });
    expect((anomaly.body.finishing as JsonValue).pieces).toBeNull();
    expect((anomaly.body.finishing as JsonValue).pieces).not.toBe(88);

    const pendingSewingOrderId = await createFormalOrder("COMMERCIAL-FINISHING-PENDING");
    const pendingSewing = await savePricing(pendingSewingOrderId, {
      quotedPrice: 50,
      internalFinishingCost: 10
    });
    expect(pendingSewing.response.status).toBe(200);
    expect(pendingSewing.body.finishing).toMatchObject({
      visible: false,
      pieces: null,
      amount: 10,
      anomaly: "finishing_evidence_pending"
    });

    const noQcRouteOrderId = await createFormalOrder("COMMERCIAL-FINISHING-NO-ROUTE", 3, {
      sampleRequestItems: ["pattern_making"]
    });
    const hidden = await request(`/api/admin/orders/${noQcRouteOrderId}/pricing`, {
      headers: headers("boss")
    });
    expect(hidden.body.finishing).toMatchObject({ visible: false, amount: null, pieces: null });

    const quoteWithoutHiddenFields = await savePricing(noQcRouteOrderId, { quotedPrice: 60 });
    expect(quoteWithoutHiddenFields.response.status).toBe(200);
    const quoteWithBossUiNulls = await savePricing(noQcRouteOrderId, {
      quotedPrice: 70,
      internalFinishingCost: null,
      finishingNote: null
    });
    expect(quoteWithBossUiNulls.response.status).toBe(200);

    const zeroFinishingValue = await savePricing(noQcRouteOrderId, {
      quotedPrice: 80,
      internalFinishingCost: 0
    });
    expect(zeroFinishingValue.response.status).toBe(200);

    const exceptionalFinishingWithoutReason = await savePricing(noQcRouteOrderId, {
      internalFinishingCost: 8
    });
    expect(exceptionalFinishingWithoutReason.response.status).toBe(200);
    expect(exceptionalFinishingWithoutReason.body.pricing).toMatchObject({
      internalFinishingCost: 8
    });
    expect(exceptionalFinishingWithoutReason.body.pricing)
      .not.toHaveProperty("internalCostExceptionNote");
  });

  it("uses only current effective charges when creating immutable reconciliation snapshots", async () => {
    const orderId = await createFormalOrder("COMMERCIAL-SNAPSHOT", 1);
    const effective = await addCharge("receiver", orderId, "receiver", "有效费用", 12);
    const erroneous = await addCharge("planner", orderId, "planner", "错误费用", 30);
    const effectiveId = (effective.body.charge as JsonValue).id as string;
    const erroneousId = (erroneous.body.charge as JsonValue).id as string;
    await request(`/api/admin/orders/${orderId}/charges/${effectiveId}/confirm`, {
      method: "POST",
      headers: headers("boss")
    });
    await request(`/api/admin/orders/${orderId}/charges/${erroneousId}/void`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ reason: "错误" })
    });
    await savePricing(orderId, {
      quotedPrice: 100,
      customerPatternFee: 20,
      internalPatternCost: 11,
      internalCuttingCost: 12,
      internalSewingCost: 13,
      internalFinishingCost: 14
    });
    await confirmQuotation(orderId);

    await request(`/api/admin/orders/${orderId}/charges/${effectiveId}/void`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ reason: "found after quotation confirmation" })
    });

    const beforeStatement = await request(`/api/admin/orders/${orderId}/pricing`, {
      headers: headers("boss")
    });
    expect(beforeStatement.body).toMatchObject({
      pricing: { quotationStatus: "confirmed" },
      quotationHasUnconfirmedChanges: false,
      reconciliationEligibility: { eligible: true },
      confirmedQuotation: { effectiveCustomerOtherCharges: 0, receivableTotal: 120 },
      summary: { effectiveCustomerOtherCharges: 0, receivableTotal: 120 }
    });

    const generated = await request("/api/admin/reconciliation-statements", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ orderIds: [orderId] })
    });
    expect(generated.response.status).toBe(201);
    const lockedCharge = await addCharge("receiver", orderId, "receiver", "对账后费用", 1);
    expect(lockedCharge.response.status).toBe(409);
    const item = ((generated.body.statement as JsonValue).items as JsonValue[])[0]!;
    expect(item).toMatchObject({
      customerPatternFee: 20,
      otherChargeTotal: 0,
      receivableTotal: 120
    });

    const listed = await request("/api/admin/reconciliation-statements", {
      headers: headers("boss")
    });
    const statement = (listed.body.statements as JsonValue[]).find(
      (entry) => entry.id === (generated.body.statement as JsonValue).id
    )!;
    expect((statement.items as JsonValue[])[0]).toMatchObject({
      otherChargeTotal: 0,
      receivableTotal: 120,
      internalPatternCost: 11,
      internalCuttingCost: 12,
      internalSewingCost: 13,
      internalFinishingCost: 14,
      internalTotalCost: 50
    });
  });

  it("reports objective performance without double-counting pattern versions or assigning finishing employees", async () => {
    const orderId = await createFormalOrder("COMMERCIAL-PERFORMANCE", 4);
    const task = await repository.createPatternTask({
      orderId,
      status: "completed",
      patternMakerId: "pattern-maker-a",
      patternMakerName: "版师甲"
    });
    await repository.updatePatternTask(task.id, {
      completedAt: "2026-07-10T08:00:00.000Z"
    });
    await repository.createPatternDeliverable({
      orderId,
      patternTaskId: task.id,
      version: "V1",
      type: "pattern_file",
      fileName: "v1.dxf",
      visibility: "internal_only",
      uploadedBy: "pattern-maker-a",
      uploadedByName: "版师甲"
    });
    await repository.createPatternDeliverable({
      orderId,
      patternTaskId: task.id,
      version: "V2",
      type: "revision_note",
      textValue: "revision",
      visibility: "internal_only",
      uploadedBy: "pattern-maker-a",
      uploadedByName: "版师甲"
    });
    await repository.createScanRecord({
      orderId,
      stage: "pattern",
      orderStage: ORDER_STAGES.patternDoing,
      action: "complete",
      scanAction: "pattern_finish",
      workerId: "pattern-maker-a",
      workerName: "版师甲",
      actorType: "internal_account",
      actorRole: "pattern_maker",
      eventTime: "2026-07-10T08:00:00.000Z",
      workHours: 2
    });
    await repository.createScanRecord({
      orderId,
      stage: "cutting",
      orderStage: ORDER_STAGES.cuttingDoing,
      action: "complete",
      scanAction: "cutting_finish",
      actorAccountId: "formal-account-worker-cutting",
      workerProfileId: "formal-worker-profile-cutting",
      workerId: "cutting-a",
      workerName: "裁剪甲",
      eventTime: "2026-07-10T09:00:00.000Z",
      workHours: 1,
      pieces: 4
    });
    await repository.createScanRecord({
      orderId,
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "complete",
      scanAction: "sewing_finish",
      actorAccountId: "formal-account-worker-sewing",
      workerProfileId: "formal-worker-profile-sewing",
      workerId: "sewing-a",
      workerName: "缝制甲",
      eventTime: "2026-07-10T10:00:00.000Z",
      workHours: 3,
      pieces: 4
    });
    await repository.createScanRecord({
      orderId,
      stage: "qc_delivery",
      orderStage: ORDER_STAGES.qcDeliveryWaiting,
      action: "complete",
      scanAction: "qc_delivery_finish",
      actorAccountId: "formal-account-worker-qc",
      workerProfileId: "formal-worker-profile-qc",
      workerId: "qc-a",
      workerName: "组检甲",
      eventTime: "2026-07-10T11:00:00.000Z",
      workHours: 0.5,
      pieces: 4,
      qualityResult: "qualified",
      qualityScore: 92
    });
    await repository.updateOrder(orderId, { stage: ORDER_STAGES.done });
    await repository.createOrderComplaint({
      orderId,
      description: "test complaint",
      qcWorkerProfileId: "formal-worker-profile-qc",
      qcWorkerNameSnapshot: "组检甲",
      registeredByAccountId: "boss-user",
      registeredByName: "Boss"
    });
    await savePricing(orderId, {
      quotedPrice: 100,
      internalPatternCost: 20,
      internalCuttingCost: 30,
      internalSewingCost: 40,
      internalFinishingCost: 10
    });

    const report = await request(
      "/api/admin/performance?dateFrom=2026-07-01",
      { headers: headers("boss") }
    );
    expect(report.response.status).toBe(200);
    expect(report.body.overview).toMatchObject({
      pattern: {
        completedStyles: 1,
        totalHours: 2,
        averageHoursPerStyle: 2,
        internalCost: 20
      },
      cutting: {
        completedOrders: 1,
        completedPieces: 4,
        totalHours: 1,
        averageHoursPerPiece: 0.25,
        internalCost: 30
      },
      sewing: {
        completedOrders: 1,
        completedPieces: 4,
        totalHours: 3,
        averageHoursPerPiece: 0.75,
        internalCost: 40
      },
      finishing: { pieces: 4, amount: 10 }
    });
    expect(report.body.roleSummary).toMatchObject({
      pattern: { completedPatternTasks: 1, involvedOrders: 1 },
      cutting: { completedOrders: 1, completedPieces: 4 },
      sewing: {
        completedOrders: 1,
        completedPieces: 4,
        totalHours: 3,
        hourlyOutput: 4 / 3,
        averageQualityScore: 92,
        unratedOrders: 0
      },
      receiver: { formalOrders: 1 },
      finishing: { completedOrders: 1, completedPieces: 4, amount: 10 },
      qcDelivery: { completedOrders: 1, checkedPieces: 4, complaintOrders: 1, complaintRate: 100 }
    });
    expect(report.body.employees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: "pattern-maker-a", role: ROLES.patternMaker, stage: "pattern" }),
        expect.objectContaining({ workerProfileId: "formal-worker-profile-cutting", workerType: "cutting", stage: "cutting" }),
        expect.objectContaining({ workerProfileId: "formal-worker-profile-sewing", workerType: "sewing", stage: "sewing" })
      ])
    );
    expect((report.body.employees as JsonValue[]).some((row) => row.stage === "finishing"))
      .toBe(false);
    const overview = report.body.overview as JsonValue;
    expect(JSON.stringify(overview.finishing)).not.toContain("hours");
    expect(JSON.stringify(overview.finishing)).not.toContain("employee");
    expect(report.body.orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderId, stage: "pattern", workHours: 2, internalCost: 20 }),
        expect.objectContaining({ orderId, stage: "cutting", pieces: 4, internalCost: 30 }),
        expect.objectContaining({ orderId, stage: "sewing", pieces: 4, workHours: 3, internalCost: 40 }),
        expect.objectContaining({ orderId, stage: "finishing", pieces: 4, workHours: null, internalCost: 10 })
      ])
    );
    const compactReport = await request(
      "/api/admin/performance?dateFrom=2026-07-01&includeOrderDetails=false",
      { headers: headers("boss") }
    );
    expect(compactReport.response.status).toBe(200);
    expect(compactReport.body).not.toHaveProperty("orders");

    await repository.createScanRecord({
      orderId,
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "complete",
      scanAction: "sewing_finish",
      actorAccountId: "formal-account-worker-sewing-2",
      workerProfileId: "formal-worker-profile-sewing-2",
      workerId: "sewing-b",
      workerName: "接手缝制乙",
      eventTime: "2026-07-10T10:30:00.000Z",
      workHours: 2,
      pieces: 4,
      takeoverFromWorkerId: "sewing-a",
      takeoverFromWorkerName: "缝制甲",
      takeoverReason: "shift handoff"
    });
    const takeoverReport = await request(
      "/api/admin/performance?dateFrom=2026-07-10&dateTo=2026-07-10&stage=sewing",
      { headers: headers("boss") }
    );
    expect(takeoverReport.body.overview).toMatchObject({
      sewing: {
        completedOrders: 1,
        completedPieces: 4,
        totalHours: 2,
        internalCost: 40
      }
    });
    expect(takeoverReport.body.employees).toEqual([
      expect.objectContaining({ workerProfileId: "formal-worker-profile-sewing-2", workerType: "sewing", stage: "sewing" })
    ]);
    expect(takeoverReport.body.orders).toEqual([
      expect.objectContaining({
        orderId,
        stage: "sewing",
        employeeName: "缝制员工二号",
        pieces: 4,
        workHours: 2,
        internalCost: 40
      })
    ]);
    expect(takeoverReport.body.anomalies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orderId,
          stage: "sewing",
          code: "multiple_completion_records",
          recordCount: 2
        })
      ])
    );

    const clientAttempt = await request("/api/admin/performance", {
      headers: headers("client_business_user")
    });
    expect(clientAttempt.response.status).toBe(403);

    const systemOwnerAttempt = await request("/api/admin/performance?stage=sewing", {
      headers: headers("system_owner")
    });
    expect(systemOwnerAttempt.response.status).toBe(200);
  });

  it("keeps missing finishing amount and sewing pieces nullable with an explicit anomaly", async () => {
    const orderId = await createFormalOrder("COMMERCIAL-PERFORMANCE-MISSING");
    await repository.createScanRecord({
      orderId,
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "complete",
      scanAction: "sewing_finish",
      workerId: "sewing-missing",
      workerName: "Missing Pieces Worker",
      eventTime: "2026-07-10T10:00:00.000Z",
      workHours: 1
    });
    await repository.createScanRecord({
      orderId,
      stage: "qc_delivery",
      orderStage: ORDER_STAGES.qcDeliveryWaiting,
      action: "complete",
      scanAction: "qc_delivery_finish",
      workerId: "qc-missing",
      workerName: "QC Missing",
      eventTime: "2026-07-10T11:00:00.000Z",
      workHours: 0.5,
      qualityResult: "qualified"
    });
    await repository.updateOrder(orderId, { stage: ORDER_STAGES.done });

    const report = await request(
      "/api/admin/performance?dateFrom=2026-07-10&dateTo=2026-07-10&stage=finishing&q=COMMERCIAL-PERFORMANCE-MISSING",
      { headers: headers("boss") }
    );
    expect(report.response.status).toBe(200);
    expect(report.body.overview).toMatchObject({
      finishing: { pieces: null, amount: null }
    });
    expect(report.body.orders).toEqual([
      expect.objectContaining({
        orderId,
        stage: "finishing",
        pieces: null,
        workHours: null,
        internalCost: null
      })
    ]);
    expect(report.body.anomalies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orderId,
          stage: "finishing",
          code: "sewing_pieces_missing"
        })
      ])
    );
  });

  it("does not count boss-entered finishing amount before QC completion", async () => {
    const orderId = await createFormalOrder("COMMERCIAL-FINISHING-BOSS-SOURCE");
    const saved = await savePricing(orderId, {
      quotedPrice: 10.12345,
      internalFinishingCost: 12.34567
    });
    expect(saved.response.status).toBe(200);

    const report = await request(
      "/api/admin/performance?month=2026-07&stage=finishing&q=COMMERCIAL-FINISHING-BOSS-SOURCE",
      { headers: headers("boss") }
    );
    expect(report.response.status).toBe(200);
    expect(report.body.overview).toMatchObject({
      finishing: { pieces: null, amount: null }
    });
  });

  it("uses final completion records and keeps role filters mathematically consistent", async () => {
    const cuttingOrderId = await createFormalOrder("PERFORMANCE-FINAL-CUTTING", 7);
    await repository.createScanRecord({
      orderId: cuttingOrderId,
      stage: "cutting",
      orderStage: ORDER_STAGES.cuttingDoing,
      action: "complete",
      scanAction: "cutting_finish",
      workerId: "cutting-old",
      workerName: "裁剪旧记录",
      eventTime: "2026-07-14T01:00:00.000Z",
      workHours: 2,
      pieces: 5
    });
    await repository.createScanRecord({
      orderId: cuttingOrderId,
      stage: "cutting",
      orderStage: ORDER_STAGES.cuttingDoing,
      action: "complete",
      scanAction: "cutting_finish",
      workerId: "cutting-final",
      workerName: "裁剪最终记录",
      eventTime: "2026-07-14T02:00:00.000Z",
      workHours: 3,
      pieces: 7
    });

    const allCutting = await request(
      "/api/admin/performance?dateFrom=2026-07-14&dateTo=2026-07-14&stage=cutting&q=PERFORMANCE-FINAL-CUTTING",
      { headers: headers("boss") }
    );
    const allCuttingSummary = (allCutting.body.roleSummary as JsonValue).cutting;
    expect(allCuttingSummary).toEqual({ completedOrders: 1, completedPieces: 7 });
    expect(allCutting.body.employees).toEqual([
      expect.objectContaining({ workerProfileId: "cutting-final", workerType: "cutting", completedOrders: 1, completedPieces: 7 })
    ]);

    const oneCutting = await request(
      "/api/admin/performance?dateFrom=2026-07-14&dateTo=2026-07-14&stage=cutting&workerProfileId=cutting-final&q=PERFORMANCE-FINAL-CUTTING",
      { headers: headers("boss") }
    );
    expect((oneCutting.body.roleSummary as JsonValue).cutting).toEqual(allCuttingSummary);

    const sewingOrderId = await createFormalOrder("PERFORMANCE-SEWING-SCORE", 4);
    await repository.createScanRecord({
      orderId: sewingOrderId,
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "complete",
      scanAction: "sewing_finish",
      workerId: "sewing-score",
      workerName: "缝制评分测试",
      eventTime: "2026-07-14T03:00:00.000Z",
      workHours: 2,
      pieces: 4
    });
    await repository.createScanRecord({
      orderId: sewingOrderId,
      stage: "qc_delivery",
      orderStage: ORDER_STAGES.qcDeliveryWaiting,
      action: "complete",
      scanAction: "qc_delivery_finish",
      workerId: "qc-score",
      workerName: "组检评分测试",
      eventTime: "2026-07-14T04:00:00.000Z",
      pieces: 4,
      qualityResult: "qualified",
      qualityScore: 90
    });
    await repository.updateOrder(sewingOrderId, { stage: ORDER_STAGES.done });
    await repository.createOrderComplaint({
      orderId: sewingOrderId,
      description: "first complaint",
      qcWorkerProfileId: "qc-score",
      qcWorkerNameSnapshot: "组检评分测试",
      registeredByAccountId: "boss-user",
      registeredByName: "Boss"
    });
    await repository.createOrderComplaint({
      orderId: sewingOrderId,
      description: "second complaint for same order",
      qcWorkerProfileId: "qc-score",
      qcWorkerNameSnapshot: "组检评分测试",
      registeredByAccountId: "boss-user",
      registeredByName: "Boss"
    });

    const sewing = await request(
      "/api/admin/performance?dateFrom=2026-07-14&dateTo=2026-07-14&stage=sewing&q=PERFORMANCE-SEWING-SCORE",
      { headers: headers("boss") }
    );
    expect((sewing.body.roleSummary as JsonValue).sewing).toMatchObject({
      completedOrders: 1,
      completedPieces: 4,
      totalHours: 2,
      hourlyOutput: 2,
      averageQualityScore: 90,
      unratedOrders: 0
    });

    const qc = await request(
      "/api/admin/performance?dateFrom=2026-07-14&dateTo=2026-07-14&stage=qc_delivery&q=PERFORMANCE-SEWING-SCORE",
      { headers: headers("boss") }
    );
    expect((qc.body.roleSummary as JsonValue).qcDelivery).toEqual({
      completedOrders: 1,
      checkedPieces: 4,
      complaintOrders: 1,
      complaintRate: 100
    });

    const pendingOrderId = await createFormalOrder("PERFORMANCE-PENDING-RECEIVER");
    await repository.updateOrder(pendingOrderId, { intakeStatus: "pending_receive", stage: null });
    const pendingReceiver = await request(
      "/api/admin/performance?dateFrom=2026-07-01&dateTo=2026-07-31&stage=receiver&q=PERFORMANCE-PENDING-RECEIVER",
      { headers: headers("boss") }
    );
    expect((pendingReceiver.body.roleSummary as JsonValue).receiver).toEqual({ formalOrders: 0 });
  });

  it("calculates sewing rework rate from distinct normally reviewed orders", async () => {
    const createSewingOrder = async (
      suffix: string,
      qcRecords: Array<{ qualityResult: "qualified" | "rework"; qualityScore?: number }>,
      finalStage: "done" | "qc_delivery_waiting"
    ) => {
      const orderId = await createFormalOrder(`PERFORMANCE-REWORK-${suffix}`, 4);
      await repository.createScanRecord({
        orderId,
        stage: "sewing",
        orderStage: ORDER_STAGES.sewingDoing,
        action: "complete",
        scanAction: "sewing_finish",
        actorAccountId: "formal-account-worker-sewing",
        workerProfileId: "formal-worker-profile-sewing",
        workerId: "sewing-a",
        workerName: "缝制甲",
        eventTime: `2026-07-16T0${suffix === "A" ? 1 : suffix === "B" ? 2 : 3}:00:00.000Z`,
        workHours: 2,
        pieces: 4
      });
      for (const [index, qc] of qcRecords.entries()) {
        await repository.createScanRecord({
          orderId,
          stage: "qc_delivery",
          orderStage: ORDER_STAGES.qcDeliveryWaiting,
          action: "complete",
          scanAction: "qc_delivery_finish",
          actorAccountId: "formal-account-worker-qc",
          workerProfileId: "formal-worker-profile-qc",
          workerId: "qc-a",
          workerName: "组检甲",
          eventTime: `2026-07-16T${String(5 + index).padStart(2, "0")}:${suffix === "A" ? "10" : suffix === "B" ? "20" : "30"}:00.000Z`,
          pieces: 4,
          qualityResult: qc.qualityResult,
          ...(qc.qualityScore !== undefined ? { qualityScore: qc.qualityScore } : {})
        });
      }
      await repository.updateOrder(orderId, { stage: finalStage });
      return orderId;
    };

    const orderA = await createSewingOrder("A", [{ qualityResult: "qualified", qualityScore: 95 }], "done");
    await repository.createScanRecord({
      orderId: orderA,
      stage: "qc_delivery",
      orderStage: ORDER_STAGES.done,
      action: "termination_complete",
      scanAction: "termination_complete",
      workerId: "qc-a",
      workerName: "组检甲",
      eventTime: "2026-07-16T09:00:00.000Z",
      pieces: 4,
      qualityResult: "rework"
    });
    await createSewingOrder("B", [
      { qualityResult: "rework" },
      { qualityResult: "rework" },
      { qualityResult: "qualified", qualityScore: 90 }
    ], "done");
    await createSewingOrder("C", [{ qualityResult: "rework" }], "qc_delivery_waiting");

    const report = await request(
      "/api/admin/performance?dateFrom=2026-07-16&dateTo=2026-07-16&q=PERFORMANCE-REWORK-",
      { headers: headers("boss") }
    );
    expect(report.response.status).toBe(200);
    expect((report.body.roleSummary as JsonValue).sewing).toMatchObject({
      completedOrders: 3,
      averageQualityScore: 92.5,
      unratedOrders: 1,
      reworkRate: 200 / 3
    });
    expect((report.body.employees as JsonValue[]).find((row) => row.stage === "sewing")).toMatchObject({
      averageQualityScore: 92.5,
      unratedOrders: 1,
      reworkRate: 200 / 3
    });
    expect((report.body.roleSummary as JsonValue).finishing).toMatchObject({ completedOrders: 2 });
    expect((report.body.roleSummary as JsonValue).qcDelivery).toMatchObject({ completedOrders: 2 });
    expect((report.body.orders as JsonValue[]).filter(
      (row) => row.stage === "finishing" || row.stage === "qc_delivery"
    )).toHaveLength(4);
  });
});
