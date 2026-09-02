import { describe, expect, it } from "vitest";
import { createClientOrder, headers, request, type JsonValue } from "./testHelpers.js";

function receiverSelfEntryBody(payload: Record<string, unknown>) {
  const form = new FormData();
  form.append("multipartPayload", JSON.stringify(payload));
  form.append("files", new Blob(["sample sheet"], { type: "application/pdf" }), "sample-sheet.pdf");
  form.append("category", "receiver_quick_photo");
  return form;
}

function receiverMultipartHeaders() {
  const { "content-type": _contentType, ...requestHeaders } = headers("receiver");
  return requestHeaders;
}

describe("receiver self-entry API regressions", () => {
  it("creates receiver self-entry with pattern has on the default physical route", async () => {
    const created = await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: receiverMultipartHeaders(),
      body: receiverSelfEntryBody({
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active",
        patternStatus: "has",
        fabricStatus: "complete",
        trimStatus: "partial",
        styleNo: "SELF-HAS",
        styleName: "Self Entry Has",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        deliveryDate: "2026-06-30"
      })
    });
    const pending = await request("/api/receiver/pending-receive", {
      headers: headers("receiver")
    });

    expect(created.response.status).toBe(201);
    expect(created.body.order).toMatchObject({
      sourceType: "receiver_self_entry",
      intakeStatus: "received",
      stage: "pattern_waiting",
      patternStatus: "has",
      fabricStatus: "complete",
      trimStatus: "partial"
    });
    expect((pending.body.orders as unknown[])).toHaveLength(0);
  });

  it("allows a customer salesperson profile to own orders regardless of its optional login role", async () => {
    const created = await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: receiverMultipartHeaders(),
      body: receiverSelfEntryBody({
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-admin",
        patternStatus: "has",
        styleNo: "SELF-ADMIN-PROFILE",
        styleName: "Self Entry Admin Profile",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        deliveryDate: "2026-06-30"
      })
    });

    expect(created.response.status).toBe(201);
    expect(created.body.order).toMatchObject({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin",
      clientUserSnapshot: {
        displayName: "客户 A 主管账号"
      }
    });
  });

  it("keeps receiver customer selection separate from client user ownership", async () => {
    await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: receiverMultipartHeaders(),
      body: receiverSelfEntryBody({
        customerId: "mock-customer-other",
        clientUserId: "mock-client-user-other",
        patternStatus: "has",
        styleNo: "RECEIVER-OTHER",
        styleName: "Receiver Other",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        deliveryDate: "2026-06-30"
      })
    });
    await createClientOrder("CLIENT-ACTIVE");

    const clientList = await request("/api/client/orders", {
      headers: headers("client_business_user")
    });

    expect((clientList.body.orders as JsonValue[]).map((order) => order.styleNo)).toEqual([
      "CLIENT-ACTIVE"
    ]);
  });

  it("keeps receiver-created same-customer orders scoped to the selected client user", async () => {
    const activeClient = headers("client_business_user", {
      userId: "mock-client-user-active",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active"
    });
    const customerAdmin = headers("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });

    await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: receiverMultipartHeaders(),
      body: receiverSelfEntryBody({
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-second",
        patternStatus: "has",
        styleNo: "RECEIVER-SECOND",
        styleName: "Receiver Second User",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        deliveryDate: "2026-06-30"
      })
    });
    await createClientOrder("CLIENT-ACTIVE-SCOPE", activeClient);

    const activeList = await request("/api/client/orders", { headers: activeClient });
    const adminList = await request("/api/client/orders", { headers: customerAdmin });

    expect((activeList.body.orders as JsonValue[]).map((order) => order.styleNo)).toEqual([
      "CLIENT-ACTIVE-SCOPE"
    ]);
    expect((adminList.body.orders as JsonValue[]).map((order) => order.styleNo)).toEqual([
      "RECEIVER-SECOND",
      "CLIENT-ACTIVE-SCOPE"
    ]);
  });

  it("creates receiver self-entry on the default physical route outside pending receive", async () => {
    const created = await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: receiverMultipartHeaders(),
      body: receiverSelfEntryBody({
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active",
        patternStatus: "none",
        styleNo: "SELF-NONE",
        styleName: "Self Entry None",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        deliveryDate: "2026-06-30"
      })
    });

    expect(created.response.status).toBe(201);
    expect(created.body.order).toMatchObject({
      sourceType: "receiver_self_entry",
      intakeStatus: "received",
      stage: "pattern_waiting",
      patternStatus: "none"
    });
  });

  it("rejects legacy request items that are outside the PR ten-item contract", async () => {
    const created = await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: receiverMultipartHeaders(),
      body: receiverSelfEntryBody({
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active",
        patternStatus: "none",
        styleNo: "SELF-LEGACY-ITEM",
        styleName: "Legacy Item",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        deliveryDate: "2026-06-30",
        sampleRequestItems: ["material_check"]
      })
    });
    expect(created.response.status).toBe(400);
    expect(created.body.error).toContain("unsupported item");
  });

  it("requires a sample-sheet attachment for traditional full intake", async () => {
    const created = await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active",
        patternStatus: "none",
        styleNo: "SELF-NO-SAMPLE-SHEET",
        styleName: "Missing Sample Sheet",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        deliveryDate: "2026-06-30"
      })
    });
    expect(created.response.status).toBe(400);
    expect(created.body.error).toBe("at least one sample-sheet attachment is required.");
  });

  it("preserves full-intake ordinary attachment categories, visibility, and image thumbnail", async () => {
    const body = new FormData();
    body.append("multipartPayload", JSON.stringify({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      patternStatus: "none",
      styleNo: "SELF-MIXED-ATTACHMENTS",
      styleName: "Mixed Attachments",
      quantity: 1,
      sampleType: "first_sample",
      sampleRound: "round_1",
      deliveryDate: "2026-06-30",
      sampleRequestItems: ["cutting"],
      thumbnailAttachmentIndex: 1
    }));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    body.append("files", new Blob(["%PDF-sample"], { type: "application/pdf" }), "sample.pdf");
    body.append("files", new Blob([png], { type: "image/png" }), "thumbnail.png");
    body.append("files", new Blob(["%PDF-ordinary"], { type: "application/pdf" }), "ordinary.pdf");
    body.append("attachmentMetadata", JSON.stringify([
      { category: "receiver_quick_photo", visibility: "internal_only" },
      { category: "receiver_quick_photo", visibility: "client_visible" },
      { category: "receiver_attachment", visibility: "client_visible" }
    ]));

    const created = await request("/api/receiver/orders/self-entry", {
      method: "POST",
      headers: receiverMultipartHeaders(),
      body
    });
    const listed = await request("/api/receiver/orders", { headers: headers("receiver") });
    const order = (listed.body.orders as JsonValue[]).find((item) => item.styleNo === "SELF-MIXED-ATTACHMENTS")!;

    expect(created.response.status).toBe(201);
    expect(order.attachments).toEqual([
      expect.objectContaining({ fileName: "sample.pdf", category: "receiver_sample_sheet", visibility: "internal_only" }),
      expect.objectContaining({ fileName: "thumbnail.png", category: "style_thumbnail", visibility: "client_visible" }),
      expect.objectContaining({ fileName: "ordinary.pdf", category: "receiver_attachment", visibility: "client_visible" })
    ]);
  });
});
