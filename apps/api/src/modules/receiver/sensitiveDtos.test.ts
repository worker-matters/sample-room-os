import { describe, expect, it } from "vitest";
import { createClientOrder, headers, repository, request, type JsonValue } from "./testHelpers.js";

const forbiddenClientKeys = new Set([
  "storageKey",
  "localPath",
  "checksum",
  "uploadedBy",
  "uploadedByRole",
  "uploadedByName",
  "patternMakerId",
  "patternMakerName",
  "workHours",
  "totalWorkHours",
  "internalCost",
  "profit"
]);

function expectNoForbiddenClientKeys(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(expectNoForbiddenClientKeys);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    expect(forbiddenClientKeys.has(key), `client DTO exposed ${key}`).toBe(false);
    expectNoForbiddenClientKeys(nested);
  }
}

describe("sensitive client DTO regressions", () => {
  it("returns desensitized client order data", async () => {
    await createClientOrder("SAFE-001");
    const list = await request("/api/client/orders", {
      headers: headers("client_business_user")
    });
    const order = (list.body.orders as JsonValue[])[0]!;

    expect(order).toMatchObject({
      createdAt: expect.any(String),
      deliveryDate: "2026-06-30",
      salespersonName: "客户 A 普通业务员",
      clientUserSnapshot: {
        id: "mock-client-user-active",
        displayName: "客户 A 普通业务员"
      }
    });
    expect(order).not.toHaveProperty("price");
    expect(order).not.toHaveProperty("cost");
    expect(order).not.toHaveProperty("scanToken");
    expect(order).not.toHaveProperty("scanRecords");
    expect(order).not.toHaveProperty("receivedBy");
    expect(order).not.toHaveProperty("returnedBy");
    expect(order).not.toHaveProperty("terminated");
    expect(order).not.toHaveProperty("terminatedAt");
    expect(order).not.toHaveProperty("terminatedBy");
    expect(order).not.toHaveProperty("terminatedByName");
    expect(order).not.toHaveProperty("terminationReason");
    expect(order).not.toHaveProperty("statusBeforeTermination");
    expect(order).not.toHaveProperty("stageAtTermination");
    expect(order).not.toHaveProperty("staff");
    expect(order).not.toHaveProperty("internalWorklogs");
    expectNoForbiddenClientKeys(order);
  });

  it("returns a minimal completion summary and strips uploader identity recursively", async () => {
    const created = await createClientOrder("SAFE-PROGRESS");
    const orderId = (created.body.order as JsonValue).id as string;
    const accepted = await request(`/api/receiver/orders/${orderId}/accept`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        patternStatus: "none",
        sampleRequestItems: ["pattern_making"],
        fabricStatus: "complete",
        trimStatus: "complete"
      })
    });
    expect(accepted.response.status).toBe(200);
    const task = await repository.findPatternTaskByOrderId(orderId);
    expect(task).toBeDefined();
    await repository.createOrderAttachment({
      orderId,
      fileName: "internal-team-photo.jpg",
      mimeType: "image/jpeg",
      size: 10,
      category: "sample_room_reference",
      uploadedBy: "worker-secret-id",
      uploadedByRole: "worker",
      uploadedByName: "Internal Worker Name",
      visibility: "client_visible",
      storageKey: "secret/storage/key.jpg",
      checksum: "secret-checksum"
    });
    await repository.createPatternDeliverable({
      orderId,
      patternTaskId: task!.id,
      version: "V1",
      type: "pattern_file",
      fileName: "client-visible.dxf",
      mimeType: "application/octet-stream",
      size: 20,
      storageKey: "secret/pattern.dxf",
      visibility: "client_visible",
      uploadedBy: "pattern-maker-secret-id",
      uploadedByName: "Pattern Maker Secret"
    });
    await repository.createPatternDeliverable({
      orderId,
      patternTaskId: task!.id,
      version: "V1",
      type: "process_note",
      textValue: "internal note",
      visibility: "internal_only",
      uploadedBy: "pattern-maker-secret-id"
    });

    const list = await request("/api/client/orders", { headers: headers("client_business_user") });
    const order = (list.body.orders as JsonValue[]).find((item) => item.id === orderId)!;
    expect(order).toMatchObject({
      stage: "done",
      completionStatus: "pattern_only_pending",
      sampleRequestItems: ["pattern_making"],
      patternTask: {
        status: "pending",
        deliverables: [expect.objectContaining({ fileName: "client-visible.dxf", hasFile: true })]
      },
      attachments: [
        expect.objectContaining({
          fileName: "internal-team-photo.jpg",
          sourceCategory: "sample_room_upload",
          hasFile: true
        })
      ]
    });
    expect(JSON.stringify(order)).not.toContain("internal note");
    expectNoForbiddenClientKeys(order);
  });
});
