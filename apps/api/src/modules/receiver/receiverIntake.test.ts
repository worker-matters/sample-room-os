import { describe, expect, it } from "vitest";
import {
  createClientOrder,
  createReceiverSelfEntry,
  headers,
  repository,
  request,
  type JsonValue
} from "./testHelpers.js";

function formHeaders(role = "receiver") {
  const result = headers(role);
  delete result["content-type"];
  return result;
}

async function createWebQuickPhoto(input: {
  quantity?: unknown;
  sampleRequestItems?: string[];
  styleNo?: string;
}) {
  const body = new FormData();
  body.append("multipartPayload", JSON.stringify({
    customerId: "mock-customer-active",
    clientUserId: "mock-client-user-active",
    ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
    sampleRequestItems: input.sampleRequestItems ?? ["pattern_making", "cutting"],
    ...(input.styleNo ? { styleNo: input.styleNo, styleName: input.styleNo } : {})
  }));
  body.append(
    "files",
    new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
      type: "image/png"
    }),
    "sample.png"
  );
  body.append("attachmentMetadata", JSON.stringify([
    { category: "receiver_quick_photo", visibility: "internal_only" }
  ]));
  return request("/api/receiver/orders/quick-photo", {
    method: "POST",
    headers: formHeaders(),
    body
  });
}

describe("receiver intake API regressions", () => {
  it("creates client submissions as pending receive from the mock client session", async () => {
    const { response, body } = await createClientOrder();

    expect(response.status).toBe(201);
    expect(body.order).toMatchObject({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      deliveryDate: "2026-06-30",
      salespersonId: "mock-client-user-active",
      salespersonName: "客户 A 普通业务员",
      clientUserSnapshot: {
        id: "mock-client-user-active",
        displayName: "客户 A 普通业务员"
      },
      intakeStatus: "pending_receive",
      stage: null,
      patternStatus: "none"
    });
    expect(typeof (body.order as JsonValue).createdAt).toBe("string");
  });

  it("shows pending client submissions to receiver pending receive but not tracking", async () => {
    await createClientOrder();

    const pending = await request("/api/receiver/pending-receive", {
      headers: headers("receiver")
    });
    const tracking = await request("/api/receiver/tracking", {
      headers: headers("receiver")
    });

    expect(pending.response.status).toBe(200);
    expect((pending.body.orders as unknown[])).toHaveLength(1);
    expect((tracking.body.orders as unknown[])).toHaveLength(0);
  });

  it("saves Web quick-photo quantity, tasks, and attachments and starts the shared workflow", async () => {
    const formData = new FormData();
    formData.append("multipartPayload", JSON.stringify({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      quantity: 3,
      sampleRequestItems: ["sample_garment", "pattern_making", "cutting"],
      remark: "拍照简录备注",
      thumbnailAttachmentIndex: 1
    }));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    formData.append("files", new Blob([png], { type: "image/png" }), "receiver-quick.png");
    formData.append("files", new Blob([png], { type: "image/png" }), "chosen-thumbnail.png");
    formData.append("files", new Blob(["%PDF-ordinary"], { type: "application/pdf" }), "ordinary.pdf");
    formData.append("attachmentMetadata", JSON.stringify([
      { category: "receiver_quick_photo", visibility: "client_visible" },
      { category: "receiver_quick_photo", visibility: "internal_only" },
      { category: "receiver_attachment", visibility: "client_visible" }
    ]));

    const created = await request("/api/receiver/orders/quick-photo", {
      method: "POST",
      headers: formHeaders(),
      body: formData
    });
    const order = created.body.order as JsonValue;
    const pending = await request("/api/receiver/pending-receive", {
      headers: headers("receiver")
    });
    const listed = await request("/api/receiver/orders", {
      headers: headers("receiver")
    });
    const patternTask = await repository.findPatternTaskByOrderId(order.id as string);

    expect(created.response.status).toBe(201);
    expect(order).toMatchObject({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      sourceType: "receiver_self_entry",
      intakeStatus: "pending_receive",
      stage: "pattern_waiting",
      quantity: 3,
      patternStatus: "none",
      patternSourceType: "none",
      sampleRequestItems: ["sample_garment", "pattern_making", "cutting"],
      sampleGarmentRequired: true,
      remark: "拍照简录备注",
      attachmentCount: 3
    });
    expect(order.attachments).toEqual([
      expect.objectContaining({
        fileName: "receiver-quick.png",
        visibility: "client_visible",
        category: "receiver_sample_sheet",
        hasFile: true
      }),
      expect.objectContaining({
        fileName: "chosen-thumbnail.png",
        visibility: "internal_only",
        category: "style_thumbnail",
        hasFile: true
      }),
      expect.objectContaining({
        fileName: "ordinary.pdf",
        visibility: "client_visible",
        category: "receiver_attachment",
        hasFile: true
      })
    ]);
    expect((pending.body.orders as JsonValue[]).map((item) => item.id)).toContain(order.id);
    expect((listed.body.orders as JsonValue[]).map((item) => item.id)).toContain(order.id);
    expect(patternTask).toMatchObject({ requirements: ["pattern_making"] });
  });

  it("rejects empty quick-photo tasks and invalid thumbnail targets", async () => {
    const requestQuickPhoto = (input: {
      sampleRequestItems: string[];
      files: Array<{ blob: Blob; name: string; category: string }>;
      thumbnailAttachmentIndex?: number;
    }) => {
      const body = new FormData();
      body.append("multipartPayload", JSON.stringify({
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active",
        quantity: 1,
        sampleRequestItems: input.sampleRequestItems,
        ...(input.thumbnailAttachmentIndex !== undefined
          ? { thumbnailAttachmentIndex: input.thumbnailAttachmentIndex }
          : {})
      }));
      for (const file of input.files) body.append("files", file.blob, file.name);
      body.append("attachmentMetadata", JSON.stringify(input.files.map((file) => ({
        category: file.category,
        visibility: "internal_only"
      }))));
      return request("/api/receiver/orders/quick-photo", {
        method: "POST",
        headers: formHeaders(),
        body
      });
    };
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" });
    const pdf = new Blob(["%PDF-1.7"], { type: "application/pdf" });

    const emptyTasks = await requestQuickPhoto({
      sampleRequestItems: [],
      files: [{ blob: png, name: "sample.png", category: "receiver_quick_photo" }]
    });
    const nonImageThumbnail = await requestQuickPhoto({
      sampleRequestItems: ["cutting"],
      files: [{ blob: pdf, name: "sample.pdf", category: "receiver_quick_photo" }],
      thumbnailAttachmentIndex: 0
    });
    const ordinaryThumbnail = await requestQuickPhoto({
      sampleRequestItems: ["cutting"],
      files: [
        { blob: pdf, name: "sample.pdf", category: "receiver_quick_photo" },
        { blob: png, name: "ordinary.png", category: "receiver_attachment" }
      ],
      thumbnailAttachmentIndex: 1
    });

    expect(emptyTasks.response.status).toBe(400);
    expect(nonImageThumbnail.response.status).toBe(400);
    expect(ordinaryThumbnail.response.status).toBe(400);
    expect(await repository.listOrders()).toHaveLength(0);
  });

  it.each([
    ["missing", undefined],
    ["zero", 0],
    ["negative", -1],
    ["decimal", 1.5],
    ["non-number", "not-a-number"]
  ])("rejects %s Web quick-photo quantity", async (_label, quantity) => {
    const body = new FormData();
    body.append("multipartPayload", JSON.stringify({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      ...(quantity === undefined ? {} : { quantity }),
      sampleRequestItems: ["cutting"]
    }));
    body.append(
      "files",
      new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
        type: "image/png"
      }),
      "sample.png"
    );
    body.append("attachmentMetadata", JSON.stringify([
      { category: "receiver_quick_photo", visibility: "internal_only" }
    ]));

    const result = await request("/api/receiver/orders/quick-photo", {
      method: "POST",
      headers: formHeaders(),
      body
    });

    expect(result.response.status).toBe(400);
    expect(result.body.error).toBe("quantity must be a positive integer.");
    expect(await repository.listOrders()).toHaveLength(0);
  });

  it("keeps a started quick-photo stage, PatternTask, and scan token when correction is completed", async () => {
    const created = await createWebQuickPhoto({ quantity: 2, styleNo: "QUICK-BEFORE" });
    const order = created.body.order as JsonValue;
    const id = order.id as string;
    const taskBefore = await repository.findPatternTaskByOrderId(id);
    expect(created.response.status).toBe(201);
    expect(taskBefore).toBeDefined();

    await repository.updatePatternTask(taskBefore!.id, {
      status: "completed",
      completedRequirements: taskBefore!.requirements,
      completedAt: new Date().toISOString()
    });
    await repository.updateOrder(id, { stage: "cutting_doing" });

    const firstLink = await request(`/api/receiver/orders/${id}/scan-link`, {
      headers: headers("receiver")
    });
    const corrected = await request(`/api/receiver/orders/${id}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ styleNo: "QUICK-AFTER", styleName: "Quick After" })
    });
    const secondLink = await request(`/api/receiver/orders/${id}/scan-link`, {
      headers: headers("receiver")
    });
    const accepted = await request(`/api/receiver/orders/${id}/accept`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({ patternStatus: "none" })
    });
    const taskAfter = await repository.findPatternTaskByOrderId(id);

    expect(firstLink.response.status).toBe(200);
    expect(corrected.body.order).toMatchObject({
      styleNo: "QUICK-AFTER",
      styleName: "Quick After",
      intakeStatus: "pending_receive",
      stage: "cutting_doing"
    });
    expect((secondLink.body.scanLink as JsonValue).token).toBe(
      (firstLink.body.scanLink as JsonValue).token
    );
    expect(accepted.body.order).toMatchObject({
      intakeStatus: "received",
      stage: "cutting_doing"
    });
    expect(taskAfter?.id).toBe(taskBefore?.id);
  });

  it("accepts pending receive with pattern has into the default physical route", async () => {
    const created = await createClientOrder("ST-HAS");
    const id = (created.body.order as JsonValue).id as string;

    const accepted = await request(`/api/receiver/orders/${id}/accept`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        patternStatus: "has",
        fabricStatus: "partial",
        trimStatus: "complete"
      })
    });

    expect(accepted.response.status).toBe(200);
    expect(accepted.body.order).toMatchObject({
      intakeStatus: "received",
      stage: "pattern_waiting",
      patternStatus: "has",
      fabricStatus: "partial",
      trimStatus: "complete",
      receivedBy: "mock-receiver"
    });
  });

  it("accepts pending receive with pattern none into the default physical route", async () => {
    const created = await createClientOrder("ST-NONE");
    const id = (created.body.order as JsonValue).id as string;

    const accepted = await request(`/api/receiver/orders/${id}/accept`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({ patternStatus: "none" })
    });

    expect(accepted.response.status).toBe(200);
    expect(accepted.body.order).toMatchObject({
      intakeStatus: "received",
      stage: "pattern_waiting",
      patternStatus: "none"
    });
  });

  it("returns a pending client submission for supplement outside tracking", async () => {
    const created = await createClientOrder("ST-RETURN");
    const id = (created.body.order as JsonValue).id as string;

    const returned = await request(`/api/receiver/orders/${id}/return`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({ returnReason: "Missing size chart and fabric photo." })
    });
    const tracking = await request("/api/receiver/tracking", {
      headers: headers("receiver")
    });

    expect(returned.body.order).toMatchObject({
      intakeStatus: "needs_client_supplement",
      stage: null,
      returnReason: "Missing size chart and fabric photo.",
      returnedBy: "mock-receiver"
    });
    expect((tracking.body.orders as unknown[])).toHaveLength(0);
  });

  it("lets the client supplement a returned order back into pending receive with attachments", async () => {
    const created = await createClientOrder("ST-SUPP-HAS");
    const id = (created.body.order as JsonValue).id as string;

    await request(`/api/receiver/orders/${id}/return`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({ returnReason: "Please add size chart." })
    });

    const supplemented = await request(`/api/client/orders/${id}/supplement`, {
      method: "PATCH",
      headers: headers("client_business_user"),
      body: JSON.stringify({
        styleNo: "ST-SUPP-HAS-REV",
        styleName: "Supplemented Has",
        quantity: 4,
        sampleType: "fit_sample",
        sampleRound: "round_2",
        patternStatus: "has",
        deliveryDate: "2026-07-02",
        remark: "Customer added size chart.",
        sourceType: "receiver_self_entry",
        intakeStatus: "received",
        fabricStatus: "complete",
        trimStatus: "complete",
        receivedBy: "payload-must-not-win",
        attachments: [
          {
            fileName: "supplement-size-chart.pdf",
            mimeType: "application/pdf",
            size: 2048,
            category: "client_reference"
          }
        ]
      })
    });
    const pending = await request("/api/receiver/pending-receive", {
      headers: headers("receiver")
    });
    const tracking = await request("/api/receiver/tracking", {
      headers: headers("receiver")
    });
    const accepted = await request(`/api/receiver/orders/${id}/accept`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({ patternStatus: "has" })
    });

    expect(supplemented.response.status).toBe(200);
    expect(supplemented.body.order).toMatchObject({
      styleNo: "ST-SUPP-HAS-REV",
      sourceType: "client_submission",
      intakeStatus: "pending_receive",
      stage: null,
      patternStatus: "has",
      fabricStatus: "missing",
      trimStatus: "missing",
      supplementCount: 1,
      attachmentCount: 1
    });
    expect(supplemented.body.order).not.toHaveProperty("receivedBy", "payload-must-not-win");
    expect((pending.body.orders as JsonValue[]).some((order) => order.id === id)).toBe(true);
    expect((tracking.body.orders as JsonValue[]).some((order) => order.id === id)).toBe(false);
    expect(accepted.body.order).toMatchObject({
      intakeStatus: "received",
      stage: "pattern_waiting",
      patternStatus: "has"
    });
  });

  it("keeps supplemented none-pattern orders on the physical route after reacceptance", async () => {
    const created = await createClientOrder("ST-SUPP-NONE");
    const id = (created.body.order as JsonValue).id as string;

    await request(`/api/receiver/orders/${id}/return`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({ returnReason: "Need clearer pattern note." })
    });

    const supplemented = await request(`/api/client/orders/${id}/supplement`, {
      method: "PATCH",
      headers: headers("client_business_user"),
      body: JSON.stringify({
        patternStatus: "none",
        deliveryDate: "2026-07-03"
      })
    });
    const accepted = await request(`/api/receiver/orders/${id}/accept`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({ patternStatus: "none" })
    });

    expect(supplemented.body.order).toMatchObject({
      intakeStatus: "pending_receive",
      stage: null,
      supplementCount: 1
    });
    expect(accepted.body.order).toMatchObject({
      intakeStatus: "received",
      stage: "pattern_waiting",
      patternStatus: "none"
    });
  });

  it("blocks client users from receiver APIs", async () => {
    const result = await request("/api/receiver/pending-receive", {
      headers: headers("client_business_user")
    });

    expect(result.response.status).toBe(403);
  });

  it("recomputes the receiver stage from the pattern deliverable gate instead of trusting stale storage", async () => {
    const created = await createReceiverSelfEntry("STALE-CUTTING-STAGE", {
      sampleRequestItems: ["pattern_making", "cutting"]
    });
    const id = (created.body.order as JsonValue).id as string;
    await repository.updateOrder(id, { stage: "cutting_waiting" });

    const listed = await request("/api/receiver/orders", { headers: headers("receiver") });
    const order = (listed.body.orders as JsonValue[]).find((item) => item.id === id);

    expect(order).toMatchObject({
      stage: "pattern_waiting",
      patternTask: {
        requirements: ["pattern_making"],
        completedRequirements: []
      }
    });
  });

  it("blocks receiver from creating client submissions", async () => {
    const result = await request("/api/client/orders", {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        styleNo: "BAD",
        styleName: "Bad",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        patternStatus: "none",
        deliveryDate: "2026-06-30"
      })
    });

    expect(result.response.status).toBe(403);
  });
});
