import { describe, expect, it } from "vitest";
import { ORDER_STAGES, SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import {
  createClientOrder,
  createReceiverSelfEntry,
  headers,
  repository,
  request,
  type JsonValue
} from "./testHelpers.js";

describe("receiver correction API regressions", () => {
  async function createAcceptedOrder(styleNo: string, sampleRequestItems: string[]) {
    const created = await createClientOrder(styleNo, headers("client_business_user"), {
      sampleRequestItems
    });
    const id = (created.body.order as JsonValue).id as string;
    const accepted = await request(`/api/receiver/orders/${id}/accept`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        patternStatus: "has",
        fabricStatus: "complete",
        trimStatus: "complete",
        sampleRequestItems
      })
    });
    expect(accepted.response.status).toBe(200);
    return id;
  }

  async function createActiveStatement(orderId: string) {
    const order = await repository.findOrderById(orderId);
    expect(order).toBeTruthy();
    await repository.createReconciliationStatement({
      statementNo: `TEST-${orderId}`,
      customerName: order!.customerName,
      salespersonName: order!.salespersonName,
      billingPeriod: "2026-08",
      receivableAmount: 0,
      items: [{
        orderId,
        orderNo: order!.orderNo,
        styleNo: order!.styleNo,
        styleName: order!.styleName,
        customerName: order!.customerName,
        salespersonName: order!.salespersonName,
        quantity: order!.quantity,
        quotedPrice: 0,
        sampleAmount: 0,
        otherChargeTotal: 0,
        receivableTotal: 0
      }]
    });
  }

  it("lets receiver correct always-editable fields on a customer-submitted order", async () => {
    const created = await createClientOrder("CORRECT-CUSTOMER");
    const id = (created.body.order as JsonValue).id as string;

    const corrected = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver", { userId: "formal-account-receiver" }),
      body: JSON.stringify({
        styleNo: "CORRECTED-STYLE",
        styleName: "Corrected Style",
        sampleType: "fit_sample",
        sampleRound: "round_2",
        remark: "Corrected from paper sheet."
      })
    });

    expect(corrected.response.status).toBe(200);
    expect(corrected.body.order).toMatchObject({
      styleNo: "CORRECTED-STYLE",
      styleName: "Corrected Style",
      sampleType: "fit_sample",
      sampleRound: "round_2",
      remark: "Corrected from paper sheet.",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active"
    });
    expect((corrected.body.order as JsonValue).correctionLogs as JsonValue[]).toHaveLength(5);
    expect(((corrected.body.order as JsonValue).correctionLogs as JsonValue[])[0]).toMatchObject({
      changedByRole: "receiver",
      changedByAccountId: "formal-account-receiver",
      fieldName: "styleNo",
      oldValue: "CORRECT-CUSTOMER",
      newValue: "CORRECTED-STYLE"
    });
  });

  it("lets receiver correct always-editable fields on a receiver self-entry order", async () => {
    const created = await createReceiverSelfEntry("CORRECT-SELF");
    const id = (created.body.order as JsonValue).id as string;

    const corrected = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ styleName: "Corrected Self Entry" })
    });

    expect(corrected.response.status).toBe(200);
    expect(corrected.body.order).toMatchObject({
      id,
      styleName: "Corrected Self Entry",
      sourceType: "receiver_self_entry"
    });
  });

  it("lets receiver correct quantity before reconciliation", async () => {
    const created = await createReceiverSelfEntry("QTY-EDITABLE");
    const id = (created.body.order as JsonValue).id as string;

    const corrected = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ quantity: 8 })
    });

    expect(corrected.response.status).toBe(200);
    expect(corrected.body.order).toMatchObject({ id, quantity: 8 });
    expect((corrected.body.order as JsonValue).correctionLogs as JsonValue[]).toEqual([
      expect.objectContaining({ fieldName: "quantity", oldValue: 3, newValue: 8 })
    ]);
  });

  it("still lets receiver correct quantity after sewing starts when the order is not reconciled", async () => {
    const created = await createReceiverSelfEntry("QTY-AFTER-SEWING");
    const id = (created.body.order as JsonValue).id as string;
    await repository.createScanRecord({
      orderId: id,
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "start",
      scanAction: "sewing_start",
      workerId: "mock-sewing-worker",
      workerName: "Mock Sewing Worker"
    });

    const corrected = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ quantity: 9 })
    });

    expect(corrected.response.status).toBe(200);
    expect(corrected.body.order).toMatchObject({ id, quantity: 9 });
    expect((await repository.findOrderById(id))?.quantity).toBe(9);
  });

  it("does not lock quantity while the cutting form is open but no record has been submitted", async () => {
    const id = await createAcceptedOrder("CUTTING-NOT-LOCKED", [SAMPLE_REQUEST_ITEMS.cutting]);
    await repository.updateOrder(id, { stage: ORDER_STAGES.cuttingDoing });

    const corrected = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ quantity: 7 })
    });

    expect(corrected.response.status).toBe(200);
    expect(corrected.body.order).toMatchObject({
      id,
      quantity: 7,
      stage: ORDER_STAGES.cuttingDoing
    });
  });

  it("still lets receiver correct quantity after cutting completes while production-route guards remain intact", async () => {
    const id = await createAcceptedOrder("CUTTING-SUBMITTED", [
      SAMPLE_REQUEST_ITEMS.sampleGarment,
      SAMPLE_REQUEST_ITEMS.cutting
    ]);
    await repository.createScanRecord({
      orderId: id,
      stage: "cutting",
      orderStage: ORDER_STAGES.sewingWaiting,
      action: "complete",
      scanAction: "cutting_finish",
      workerId: "mock-cutting-worker",
      workerName: "Mock Cutting Worker",
      workHours: 1,
      pieces: 3
    });
    await repository.updateOrder(id, { stage: ORDER_STAGES.sewingWaiting });

    const corrected = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({
        quantity: 9,
        styleNo: "CUTTING-SUBMITTED-CORRECTED",
        styleName: "Display information corrected",
        sampleRound: "round_2",
        deliveryDate: "2026-07-08"
      })
    });
    expect(corrected.response.status).toBe(200);
    expect(corrected.body.order).toMatchObject({
      id,
      quantity: 9,
      styleNo: "CUTTING-SUBMITTED-CORRECTED",
      styleName: "Display information corrected",
      sampleRound: "round_2",
      deliveryDate: "2026-07-08",
      stage: ORDER_STAGES.sewingWaiting
    });
    expect(await repository.listScanRecordsByOrderId(id)).toHaveLength(1);
  });

  it("locks receiver quantity correction after the order enters an active reconciliation statement", async () => {
    const created = await createReceiverSelfEntry("QTY-RECONCILED");
    const id = (created.body.order as JsonValue).id as string;
    await createActiveStatement(id);

    const blocked = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ quantity: 9 })
    });

    expect(blocked.response.status).toBe(409);
    expect(blocked.body.error).toBe("订单已进入对账单，件数请由老板在对账单中调整。");
    expect((await repository.findOrderById(id))?.quantity).toBe(3);

    const listed = await request("/api/receiver/orders", { headers: headers("receiver") });
    const row = ((listed.body.orders as JsonValue[]) ?? []).find((order) => order.id === id);
    expect(row).toMatchObject({ id, quantityCorrectionLocked: true });
  });

  it("rejects protected owner and system fields from receiver correction", async () => {
    const created = await createReceiverSelfEntry("PROTECTED-CORRECT");
    const id = (created.body.order as JsonValue).id as string;

    const blockedCustomer = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ customerId: "mock-customer-other" })
    });
    const blockedStatus = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ intakeStatus: "received" })
    });

    expect(blockedCustomer.response.status).toBe(400);
    expect(blockedCustomer.body.error).toBe("customerId cannot be corrected.");
    expect(blockedStatus.response.status).toBe(400);
    expect(blockedStatus.body.error).toBe("intakeStatus cannot be corrected.");
    expect(await repository.findOrderById(id)).toMatchObject({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active"
    });
  });

  it("validates receiver correction quantity and delivery date", async () => {
    const created = await createReceiverSelfEntry("VALIDATE-CORRECT");
    const id = (created.body.order as JsonValue).id as string;

    const invalidQuantity = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ quantity: 0 })
    });
    const invalidDate = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ deliveryDate: "2026-99-99" })
    });
    const validDate = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ deliveryDate: "2026-07-08" })
    });

    expect(invalidQuantity.response.status).toBe(400);
    expect(invalidDate.response.status).toBe(400);
    expect(validDate.response.status).toBe(200);
    expect(validDate.body.order).toMatchObject({ deliveryDate: "2026-07-08" });
  });

  it("does not add correction log rows when no meaningful field changes", async () => {
    const created = await createReceiverSelfEntry("NO-OP-CORRECT");
    const id = (created.body.order as JsonValue).id as string;

    const noOp = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ styleNo: "NO-OP-CORRECT", quantity: 3 })
    });

    expect(noOp.response.status).toBe(200);
    expect((noOp.body.order as JsonValue).correctionLogs).toEqual([]);
  });

  it("blocks client users from receiver correction APIs", async () => {
    const created = await createClientOrder("CLIENT-CANNOT-CORRECT");
    const id = (created.body.order as JsonValue).id as string;

    const blocked = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("client_business_user"),
      body: JSON.stringify({ styleNo: "BAD" })
    });

    expect(blocked.response.status).toBe(403);
    expect(blocked.body.error).toBe("forbidden");
  });

  it("keeps accept and status maintenance flows working after receiver correction", async () => {
    const created = await createClientOrder("CORRECT-THEN-ACCEPT");
    const id = (created.body.order as JsonValue).id as string;

    await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ styleName: "Corrected Then Accept" })
    });
    const accepted = await request(`/api/receiver/orders/${id}/accept`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        patternStatus: "has",
        fabricStatus: "partial",
        trimStatus: "missing"
      })
    });
    const maintained = await request(`/api/receiver/orders/${id}/tracking`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ fabricStatus: "complete" })
    });

    expect(accepted.response.status).toBe(200);
    expect(maintained.response.status).toBe(200);
    expect(maintained.body.order).toMatchObject({
      styleName: "Corrected Then Accept",
      intakeStatus: "received",
      fabricStatus: "complete"
    });
  });
});
