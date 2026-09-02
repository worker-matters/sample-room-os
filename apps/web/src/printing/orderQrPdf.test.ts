import { describe, expect, it } from "vitest";
import { createOrderQrPdf } from "./orderQrPdf";
import { DEFAULT_RECEIVER_QR_PRINT_SETTINGS, RECEIVER_LABEL_TEMPLATES } from "@sample-room/shared";

describe("temporary order QR PDF", () => {
  it("creates an A4 PDF for selected orders", async () => {
    const blob = await createOrderQrPdf([
      {
        orderId: "order-1",
        styleNo: "A-100",
        styleName: "测试款",
        customerName: "测试客户",
        businessUserName: "业务员",
        sampleType: "初样",
        quantity: 1,
        scanValue: "SRS2|ORDER|order_scan_12345678"
      }
    ], {
      ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
      template: RECEIVER_LABEL_TEMPLATES.summary50,
      copies: 2
    });
    const header = new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 4));

    expect(blob.type).toBe("application/pdf");
    expect(header).toBe("%PDF");
    expect(blob.size).toBeGreaterThan(1_000);
  });
});
