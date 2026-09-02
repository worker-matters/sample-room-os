import { describe, expect, it } from "vitest";
import { createReceiverSelfEntry, headers, repository, request, type JsonValue } from "./testHelpers.js";

describe("receiver order termination permission", () => {
  it("resolves management order account IDs to display names without leaking missing IDs as names", async () => {
    const created = await createReceiverSelfEntry("ORDER-ACCOUNT-NAMES");
    const id = (created.body.order as JsonValue).id as string;
    await repository.updateOrder(id, {
      createdBy: "formal-account-receiver",
      receivedBy: "formal-account-suspended",
      receivedAt: new Date().toISOString()
    });

    const active = await request("/api/admin/orders", { headers: headers("boss") });
    const activeOrder = (active.body.orders as JsonValue[]).find((order) => order.id === id);
    expect(activeOrder).toMatchObject({
      createdBy: "formal-account-receiver",
      createdByName: "Receiver",
      receivedBy: "formal-account-suspended",
      receivedByName: "Suspended Account"
    });

    const detail = await request(`/api/admin/orders/${id}/detail`, {
      headers: headers("boss")
    });
    expect(detail.body.order).toMatchObject({
      createdByName: "Receiver",
      receivedByName: "Suspended Account"
    });

    await repository.updateOrder(id, {
      createdBy: "missing-created-account",
      receivedBy: "missing-received-account"
    });
    const missingAccountList = await request("/api/admin/orders", { headers: headers("boss") });
    const missingAccountOrder = (missingAccountList.body.orders as JsonValue[]).find(
      (order) => order.id === id
    );
    expect(missingAccountOrder).not.toHaveProperty("createdByName");
    expect(missingAccountOrder).not.toHaveProperty("receivedByName");
  });

  it("rejects receiver terminate and restore requests at the admin routes", async () => {
    const created = await createReceiverSelfEntry("RECEIVER-NO-TERMINATE");
    const id = (created.body.order as JsonValue).id as string;

    const terminate = await request(`/api/admin/orders/${id}/terminate`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({ reason: "receiver must not terminate" })
    });
    const restore = await request(`/api/admin/orders/${id}/restore`, {
      method: "POST",
      headers: headers("receiver")
    });

    expect(terminate.response.status).toBe(403);
    expect(restore.response.status).toBe(403);
  });

  it("keeps boss termination and restoration available", async () => {
    const created = await createReceiverSelfEntry("BOSS-CAN-TERMINATE");
    const id = (created.body.order as JsonValue).id as string;

    const terminate = await request(`/api/admin/orders/${id}/terminate`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ reason: "boss approval" })
    });
    expect(terminate.response.status).toBe(200);

    const restore = await request(`/api/admin/orders/${id}/restore`, {
      method: "POST",
      headers: headers("boss")
    });
    expect(restore.response.status).toBe(200);
  });

  it("rejects termination for a completed order", async () => {
    const created = await createReceiverSelfEntry("BOSS-NO-TERMINATE-COMPLETED");
    const id = (created.body.order as JsonValue).id as string;
    await repository.updateOrder(id, { stage: "done" });
    const result = await request(`/api/admin/orders/${id}/terminate`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ reason: "must be rejected" })
    });
    expect(result.response.status).toBe(409);
    expect(result.body.error).toBe("已完成订单不允许终止");
    expect(await repository.findOrderById(id)).toMatchObject({ terminated: false, stage: "done" });
  });

  it("keeps terminated orders visible to receiver and planner with an explicit status", async () => {
    const created = await createReceiverSelfEntry("TERMINATED-STAYS-IN-LISTS");
    const id = (created.body.order as JsonValue).id as string;
    await repository.updateOrder(id, { intakeStatus: "received", stage: "sewing_waiting" });
    await request(`/api/admin/orders/${id}/terminate`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ reason: "list visibility" })
    });

    const receiver = await request("/api/receiver/orders", { headers: headers("receiver") });
    expect((receiver.body.orders as JsonValue[]).find((order) => order.id === id)).toMatchObject({
      terminated: true,
      attachments: []
    });
    const planner = await request("/api/planner/orders", { headers: headers("planner") });
    expect((planner.body.orders as JsonValue[]).find((order) => order.id === id)).toMatchObject({
      terminated: true,
      stageLabel: "已终止",
      attachments: [],
      scanRecords: []
    });
  });

  it("makes a terminated order read-only for pricing, charges, complaints, and attachment metadata", async () => {
    const created = await createReceiverSelfEntry("TERMINATED-WRITE-BOUNDARY");
    const id = (created.body.order as JsonValue).id as string;
    const existingAttachment = (await repository.listOrderAttachments(id))[0]!;
    const beforeAttachments = await repository.listOrderAttachments(id);

    expect((await request(`/api/admin/orders/${id}/terminate`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ reason: "stop all normal writes" })
    })).response.status).toBe(200);

    const calls: Array<[string, RequestInit]> = [
      [`/api/admin/orders/${id}/pricing`, {
        method: "PUT",
        headers: headers("boss"),
        body: JSON.stringify({ quotedPrice: 99, costAmount: 10 })
      }],
      [`/api/admin/orders/${id}/charges`, {
        method: "POST",
        headers: headers("boss"),
        body: JSON.stringify({ name: "终止后费用", amount: 10 })
      }],
      [`/api/admin/orders/${id}/complaints`, {
        method: "POST",
        headers: headers("boss"),
        body: JSON.stringify({ description: "终止后不应新增" })
      }],
      [`/api/admin/orders/${id}/attachments/${existingAttachment.id}/display-name`, {
        method: "PATCH",
        headers: headers("boss"),
        body: JSON.stringify({ displayName: "终止后重命名" })
      }]
    ];
    for (const [path, options] of calls) {
      const result = await request(path, options);
      expect(result.response.status, `${options.method} ${path}`).toBe(409);
      expect(result.body.error).toBe("订单已终止，无法继续修改。");
    }

    expect(await repository.findPricingRecordByOrderId(id)).toBeUndefined();
    expect(await repository.listOrderChargesByOrderId(id)).toEqual([]);
    expect(await repository.listOrderComplaintsByOrderId(id)).toEqual([]);
    expect(await repository.listOrderAttachments(id)).toEqual(beforeAttachments);
  });

  it("keeps a correction committed before termination and rejects a correction committed after it", async () => {
    const created = await createReceiverSelfEntry("TERMINATION-COMMIT-ORDER");
    const id = (created.body.order as JsonValue).id as string;
    const beforeTermination = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ styleName: "终止前已成功保存" })
    });
    expect(beforeTermination.response.status).toBe(200);

    expect((await request(`/api/admin/orders/${id}/terminate`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ reason: "serialize after correction" })
    })).response.status).toBe(200);
    const afterTermination = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ styleName: "终止后不得覆盖" })
    });
    expect(afterTermination.response.status).toBe(409);
    expect(afterTermination.body.error).toBe("订单已终止");
    expect(await repository.findOrderById(id)).toMatchObject({
      terminated: true,
      styleName: "终止前已成功保存"
    });
  });

  it("lets the boss register complaints linked to the latest QC completion", async () => {
    const created = await createReceiverSelfEntry("BOSS-COMPLAINT");
    const id = (created.body.order as JsonValue).id as string;
    await repository.createScanRecord({
      orderId: id,
      stage: "qc_delivery",
      orderStage: "done",
      action: "complete",
      scanAction: "qc_delivery_finish",
      workerId: "qc-worker-complaint",
      workerName: "QC Complaint Worker",
      pieces: 3,
      qualityResult: "qualified",
      qualityScore: 88
    });

    const receiverAttempt = await request(`/api/admin/orders/${id}/complaints`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({ description: "receiver must not register complaints" })
    });
    expect(receiverAttempt.response.status).toBe(403);

    const registered = await request(`/api/admin/orders/${id}/complaints`, {
      method: "POST",
      headers: headers("boss", { userId: "boss-complaint-user" }),
      body: JSON.stringify({ description: "客户反馈样衣袖口车缝不平整" })
    });
    expect(registered.response.status).toBe(201);
    expect(registered.body.complaint).toMatchObject({
      orderId: id,
      description: "客户反馈样衣袖口车缝不平整",
      qcWorkerProfileId: "qc-worker-complaint",
      qcWorkerNameSnapshot: "QC Complaint Worker",
      registeredByAccountId: "boss-complaint-user",
      registeredByName: "boss-complaint-user"
    });
    expect(registered.body.complaint).not.toHaveProperty("qcWorkerId");
    expect(registered.body.complaint).not.toHaveProperty("qcWorkerName");
    expect(registered.body.complaint).not.toHaveProperty("registeredBy");
    const complaintId = (registered.body.complaint as JsonValue).id as string;

    const activeWithComplaint = await request("/api/admin/orders", { headers: headers("boss") });
    expect((activeWithComplaint.body.orders as JsonValue[]).find((order) => order.id === id))
      .toMatchObject({ complaintCount: 1 });

    const detail = await request(`/api/admin/orders/${id}/detail`, {
      headers: headers("boss")
    });
    expect(detail.body.complaints).toEqual([
      expect.objectContaining({
        description: "客户反馈样衣袖口车缝不平整",
        qcWorkerProfileId: "qc-worker-complaint"
      })
    ]);

    const receiverDelete = await request(`/api/admin/orders/${id}/complaints/${complaintId}`, {
      method: "DELETE",
      headers: headers("receiver")
    });
    expect(receiverDelete.response.status).toBe(403);

    const deleted = await request(`/api/admin/orders/${id}/complaints/${complaintId}`, {
      method: "DELETE",
      headers: headers("boss")
    });
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.complaint).toMatchObject({ id: complaintId, orderId: id });

    const detailAfterDelete = await request(`/api/admin/orders/${id}/detail`, {
      headers: headers("boss")
    });
    expect(detailAfterDelete.body.complaints).toEqual([]);

    const activeAfterDelete = await request("/api/admin/orders", { headers: headers("boss") });
    expect((activeAfterDelete.body.orders as JsonValue[]).find((order) => order.id === id))
      .toMatchObject({ complaintCount: 0 });
  });

  it("reapplies the pattern deliverable gate to historical stages in boss order and pricing views", async () => {
    const created = await createReceiverSelfEntry("BOSS-PATTERN-GATE", {
      sampleRequestItems: ["pattern_making", "cutting"]
    });
    const id = (created.body.order as JsonValue).id as string;
    await repository.updateOrder(id, { stage: "cutting_waiting" });

    const active = await request("/api/admin/orders", { headers: headers("boss") });
    const activeOrder = (active.body.orders as JsonValue[]).find((order) => order.id === id);
    expect(activeOrder).toMatchObject({ stage: "pattern_waiting" });

    const pricing = await request("/api/admin/pricing/orders", { headers: headers("boss") });
    const pricingRow = (pricing.body.rows as JsonValue[]).find(
      (row) => (row.order as JsonValue).id === id
    );
    expect(pricingRow?.order).toMatchObject({ stage: "pattern_waiting" });
  });
});
