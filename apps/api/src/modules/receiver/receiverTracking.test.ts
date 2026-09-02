import { ATTACHMENT_VISIBILITY, ROLES } from "@sample-room/shared";
import { describe, expect, it } from "vitest";
import { createReceiverSelfEntry, headers, repository, request, type JsonValue } from "./testHelpers.js";

const requiredSampleSheet = {
  attachments: [
    {
      fileName: "sample-sheet.pdf",
      mimeType: "application/pdf",
      size: 12
    }
  ]
};

const physicalSampleTasks = ["sample_garment", "cutting"];

describe("receiver tracking API regressions", () => {
  it("returns active charge and material-record counts with each order", async () => {
    const created = await createReceiverSelfEntry("COUNT-001");
    const id = (created.body.order as JsonValue).id as string;
    await repository.createOrderAttachment({
      orderId: id,
      fileName: "fabric.jpg",
      mimeType: "image/jpeg",
      size: 12,
      category: "receiver_material_record",
      uploadedBy: "mock-receiver",
      uploadedByRole: ROLES.receiver,
      visibility: ATTACHMENT_VISIBILITY.internalOnly
    });
    await repository.createOrderAttachment({
      orderId: id,
      fileName: "charge.jpg",
      mimeType: "image/jpeg",
      size: 12,
      category: "order_charge",
      uploadedBy: "mock-receiver",
      uploadedByRole: ROLES.receiver,
      visibility: ATTACHMENT_VISIBILITY.internalOnly
    });
    await repository.createOrderCharge({
      orderId: id,
      name: "快递费",
      amount: 18,
      explanation: "寄样",
      sourceScene: "receiver_order_charge",
      creatorId: "mock-receiver",
      creatorRole: ROLES.receiver,
      status: "effective"
    });

    const listed = await request("/api/receiver/orders", { headers: headers("receiver") });
    const order = (listed.body.orders as JsonValue[]).find((item) => item.id === id);
    expect(order).toMatchObject({ chargeCount: 1, materialRecordCount: 1, attachmentCount: 2 });
  });

  it("keeps the physical cutting stage when pattern status changes", async () => {
    const created = await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active",
        patternStatus: "none",
        styleNo: "TRACK-001",
        styleName: "Tracking Style",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        deliveryDate: "2026-06-30",
        sampleRequestItems: physicalSampleTasks,
        ...requiredSampleSheet
      })
    });
    const id = (created.body.order as JsonValue).id as string;

    const updated = await request(`/api/receiver/orders/${id}/tracking`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ patternStatus: "has" })
    });

    expect(updated.body.order).toMatchObject({
      stage: "cutting_waiting",
      patternStatus: "has"
    });
  });

  it("updates tracking fabric status without changing stage", async () => {
    const created = await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active",
        patternStatus: "has",
        styleNo: "FABRIC-STAGE",
        styleName: "Fabric Stage",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        deliveryDate: "2026-06-30",
        sampleRequestItems: physicalSampleTasks,
        ...requiredSampleSheet
      })
    });
    const id = (created.body.order as JsonValue).id as string;

    const updated = await request(`/api/receiver/orders/${id}/tracking`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ fabricStatus: "complete" })
    });

    expect(updated.body.order).toMatchObject({
      stage: "cutting_waiting",
      fabricStatus: "complete"
    });
  });

  it("updates tracking trim status without changing stage", async () => {
    const created = await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active",
        patternStatus: "none",
        styleNo: "TRIM-STAGE",
        styleName: "Trim Stage",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        deliveryDate: "2026-06-30",
        sampleRequestItems: physicalSampleTasks,
        ...requiredSampleSheet
      })
    });
    const id = (created.body.order as JsonValue).id as string;

    const updated = await request(`/api/receiver/orders/${id}/tracking`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ trimStatus: "partial" })
    });

    expect(updated.body.order).toMatchObject({
      stage: "cutting_waiting",
      trimStatus: "partial"
    });
  });

  it("returns the same tracking status through the shared web and mobile API", async () => {
    const created = await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active",
        patternStatus: "none",
        styleNo: "SHARED-API",
        styleName: "Shared API",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        deliveryDate: "2026-06-30",
        sampleRequestItems: physicalSampleTasks,
        ...requiredSampleSheet
      })
    });
    const id = (created.body.order as JsonValue).id as string;

    await request(`/api/receiver/orders/${id}/tracking`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({
        patternStatus: "has",
        fabricStatus: "complete",
        trimStatus: "complete"
      })
    });
    const tracking = await request("/api/receiver/tracking", {
      headers: headers("receiver")
    });
    const order = (tracking.body.orders as JsonValue[]).find((item) => item.id === id)!;

    expect(order).toMatchObject({
      stage: "cutting_waiting",
      patternStatus: "has",
      fabricStatus: "complete",
      trimStatus: "complete"
    });
  });

  it("uses the same receiver status maintenance API for orders found from all orders", async () => {
    const created = await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active",
        patternStatus: "none",
        styleNo: "ALL-MAINTAIN",
        styleName: "All Maintain",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        deliveryDate: "2026-06-30",
        sampleRequestItems: physicalSampleTasks,
        ...requiredSampleSheet
      })
    });
    const id = (created.body.order as JsonValue).id as string;
    const allOrders = await request("/api/receiver/orders", {
      headers: headers("receiver")
    });
    const visibleFromAll = (allOrders.body.orders as JsonValue[]).find((order) => order.id === id);

    const updated = await request(`/api/receiver/orders/${id}/tracking`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ fabricStatus: "complete", patternStatus: "has" })
    });

    expect(visibleFromAll).toMatchObject({ id, stage: "cutting_waiting" });
    expect(updated.body.order).toMatchObject({
      id,
      fabricStatus: "complete",
      patternStatus: "has",
      stage: "cutting_waiting"
    });
  });

  it("blocks client users from receiver status maintenance APIs", async () => {
    const created = await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active",
        patternStatus: "has",
        styleNo: "CLIENT-BLOCK-RECEIVER",
        styleName: "Client Block Receiver",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        deliveryDate: "2026-06-30",
        sampleRequestItems: physicalSampleTasks,
        ...requiredSampleSheet
      })
    });
    const id = (created.body.order as JsonValue).id as string;

    const blocked = await request(`/api/receiver/orders/${id}/tracking`, {
      method: "PATCH",
      headers: headers("client_business_user"),
      body: JSON.stringify({ fabricStatus: "complete" })
    });

    expect(blocked.response.status).toBe(403);
    expect(blocked.body.error).toBe("forbidden");
  });

  it("keeps pattern-only orders visible while the comprehensive pattern task is pending", async () => {
    const created = await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active",
        patternStatus: "none",
        styleNo: "TRACK-PATTERN-PENDING",
        styleName: "Physical Complete Pattern Pending",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        deliveryDate: "2026-06-30",
        sampleRequestItems: ["pattern_making"],
        ...requiredSampleSheet
      })
    });
    const id = (created.body.order as JsonValue).id as string;
    await repository.updateOrder(id, { stage: "done" });

    const tracking = await request("/api/receiver/tracking", { headers: headers("receiver") });
    const order = (tracking.body.orders as JsonValue[]).find((item) => item.id === id);
    expect(order).toMatchObject({
      stage: "done",
      completionStatus: "pattern_only_pending",
      patternTask: { status: "pending" }
    });
  });
});
