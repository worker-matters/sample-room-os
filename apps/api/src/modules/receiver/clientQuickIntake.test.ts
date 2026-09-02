import { describe, expect, it } from "vitest";
import { headers, request, type JsonValue } from "./testHelpers.js";
import { createSimpleXlsxBuffer } from "../pricing/simpleXlsx.js";

const excelHeaders = [
  "款号",
  "款名",
  "样品类别",
  "样品轮次",
  "数量",
  "期望交期",
  "面里料状态",
  "辅料状态",
  "备注"
];

function formHeaders(role = "client_business_user", options: Parameters<typeof headers>[1] = {}) {
  const result = headers(role, options);
  delete result["content-type"];
  return result;
}

function excelFile(rows: unknown[][]) {
  const buffer = createSimpleXlsxBuffer(rows as (string | number | boolean | null | undefined)[][], {
    sheetName: "Orders"
  });
  return new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

describe("client quick photo and Excel intake", () => {
  it("creates a receiver-visible quick-photo order from the logged-in client identity", async () => {
    const formData = new FormData();
    formData.append("files", new Blob(["fake-image"], { type: "image/png" }), "quick.png");
    formData.append("customerId", "payload-must-not-win");
    formData.append("clientUserId", "payload-must-not-win");

    const created = await request("/api/client/orders/quick-photo", {
      method: "POST",
      headers: formHeaders(),
      body: formData
    });
    const pending = await request("/api/receiver/pending-receive", {
      headers: headers("receiver")
    });

    expect(created.response.status).toBe(201);
    expect(created.body.order).toMatchObject({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      sourceType: "client_submission",
      quantity: 1,
      sampleType: "first_sample",
      sampleRound: "round_1",
      patternStatus: "none",
      intakeStatus: "pending_receive",
      stage: null,
      sampleRequestItems: [],
      attachmentCount: 1
    });
    expect((created.body.order as JsonValue).styleNo as string).toMatch(/^\S+_\S+_\d{8}_001$/);
    expect((created.body.order as JsonValue).styleName).toBe((created.body.order as JsonValue).styleNo);
    expect(((created.body.order as JsonValue).attachments as JsonValue[])[0]).toMatchObject({
      fileName: "quick.png",
      visibility: "client_visible",
      category: "client_quick_photo",
      hasFile: true
    });
    expect((pending.body.orders as JsonValue[]).map((order) => order.id)).toContain(
      (created.body.order as JsonValue).id
    );

    const accepted = await request(
      `/api/receiver/orders/${(created.body.order as JsonValue).id as string}/accept`,
      {
        method: "POST",
        headers: headers("receiver"),
        body: JSON.stringify({
          patternStatus: "none",
          fabricStatus: "complete",
          trimStatus: "complete"
        })
      }
    );
    expect(accepted.response.status).toBe(400);
    expect(accepted.body.error).toBe("at least one sample request item is required before acceptance.");
  });

  it("blocks customer_all users from quick photo and Excel intake", async () => {
    const adminHeaders = formHeaders("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });
    const formData = new FormData();
    formData.append("files", new Blob(["fake-image"], { type: "image/png" }), "quick.png");

    const quick = await request("/api/client/orders/quick-photo", {
      method: "POST",
      headers: adminHeaders,
      body: formData
    });
    const preview = await request("/api/client/orders/excel-import/preview", {
      method: "POST",
      headers: adminHeaders,
      body: formData
    });

    expect(quick.response.status).toBe(403);
    expect(preview.response.status).toBe(403);
  });

  it("previews fixed Excel imports and confirms only valid rows", async () => {
    const formData = new FormData();
    formData.append(
      "files",
      excelFile([
        excelHeaders,
        ["EXCEL-001", "Excel Style", "初样", "第 1 轮", 2, "2026-07-05", "未齐", "部分齐", "first row"],
        ["EXCEL-BAD", "", "初样", "第 1 轮", -1, "2026-07-05", "未齐", "未齐", ""]
      ]),
      "orders.xlsx"
    );

    const preview = await request("/api/client/orders/excel-import/preview", {
      method: "POST",
      headers: formHeaders(),
      body: formData
    });
    const validRows = preview.body.validRows as JsonValue[];
    const confirmed = await request("/api/client/orders/excel-import/confirm", {
      method: "POST",
      headers: headers("client_business_user"),
      body: JSON.stringify({
        rows: [
          ...validRows,
          {
            styleNo: "SHOULD-NOT-CREATE",
            styleName: "",
            sampleType: "first_sample",
            sampleRound: "round_1",
            quantity: 0,
            deliveryDate: "2026-07-05",
            patternStatus: "none",
            fabricStatus: "missing",
            trimStatus: "missing"
          }
        ],
        customerId: "payload-must-not-win",
        clientUserId: "payload-must-not-win"
      })
    });
    const list = await request("/api/client/orders", {
      headers: headers("client_business_user")
    });

    expect(preview.response.status).toBe(200);
    expect(preview.body.totalRows).toBe(2);
    expect(validRows).toHaveLength(1);
    expect(preview.body.invalidRows as JsonValue[]).toHaveLength(1);
    expect(confirmed.response.status).toBe(201);
    expect(confirmed.body.createdCount).toBe(1);
    expect((confirmed.body.invalidRows as JsonValue[])).toHaveLength(1);
    expect((confirmed.body.orders as JsonValue[])[0]).toMatchObject({
      styleNo: "EXCEL-001",
      styleName: "Excel Style",
      quantity: 2,
      sampleType: "first_sample",
      sampleRound: "round_1",
      patternStatus: "none",
      fabricStatus: "missing",
      trimStatus: "partial",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      intakeStatus: "pending_receive"
    });
    expect((list.body.orders as JsonValue[]).map((order) => order.styleNo)).toEqual(["EXCEL-001"]);
  });

  it("rejects non-template Excel files", async () => {
    const formData = new FormData();
    formData.append("files", excelFile([["Bad header"], ["BAD"]]), "bad.xlsx");

    const preview = await request("/api/client/orders/excel-import/preview", {
      method: "POST",
      headers: formHeaders(),
      body: formData
    });

    expect(preview.response.status).toBe(400);
    expect(preview.body.error).toBe("uploaded Excel does not match the fixed customer order template.");
  });

  it("rejects Excel imports above one file, 5 MiB, or 1000 data rows", async () => {
    const twoFiles = new FormData();
    twoFiles.append("files", excelFile([excelHeaders]), "one.xlsx");
    twoFiles.append("files", excelFile([excelHeaders]), "two.xlsx");
    const twoFileResult = await request("/api/client/orders/excel-import/preview", {
      method: "POST",
      headers: formHeaders(),
      body: twoFiles
    });
    expect(twoFileResult.response.status).toBe(413);

    const oversized = new FormData();
    oversized.append(
      "files",
      new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]),
      "oversized.xlsx"
    );
    const oversizedResult = await request("/api/client/orders/excel-import/preview", {
      method: "POST",
      headers: formHeaders(),
      body: oversized
    });
    expect(oversizedResult.response.status).toBe(413);

    const row = ["ROW", "Style", "初样", "第 1 轮", 1, "2026-07-05", "未齐", "未齐", ""];
    const tooManyRows = new FormData();
    tooManyRows.append(
      "files",
      excelFile([excelHeaders, ...Array.from({ length: 1001 }, () => row)]),
      "too-many-rows.xlsx"
    );
    const rowResult = await request("/api/client/orders/excel-import/preview", {
      method: "POST",
      headers: formHeaders(),
      body: tooManyRows
    });
    expect(rowResult.response.status).toBe(413);
  });

  it("rejects malformed XLSX bytes without crashing the process", async () => {
    const formData = new FormData();
    formData.append(
      "files",
      new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])]),
      "broken.xlsx"
    );
    const startedAt = Date.now();
    const preview = await request("/api/client/orders/excel-import/preview", {
      method: "POST",
      headers: formHeaders(),
      body: formData
    });
    expect(preview.response.status).toBe(400);
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });
});
