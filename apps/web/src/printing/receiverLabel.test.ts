import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
  RECEIVER_LABEL_TEMPLATES
} from "@sample-room/shared";
import { buildReceiverLabelPrintJob, renderReceiverLabelSummaryText, type ReceiverLabelOrder } from "./receiverLabel";
import {
  scaleFreeformBox
} from "../components/printing/receiverFreeformGeometry";

const order: ReceiverLabelOrder = {
  orderId: "order-1",
  scanValue: "SR2:ORDER:token",
  customerName: "测试客户",
  businessUserName: "业务员一号",
  styleNo: "ST-001",
  styleName: "测试款",
  sampleType: "第一版样衣",
  quantity: 2
};

describe("receiver B1 label model", () => {
  it("builds a pure 33mm QR label", () => {
    const job = buildReceiverLabelPrintJob(DEFAULT_RECEIVER_QR_PRINT_SETTINGS, [order]);
    expect(job.pages[0]).toMatchObject({ widthMm: 33, heightMm: 33 });
    expect(job.pages[0]?.elements).toEqual([
      { type: "qr", x: 2, y: 2, width: 29, height: 29, value: order.scanValue }
    ]);
  });

  it("builds a 50mm summary label from the same QR payload", () => {
    const job = buildReceiverLabelPrintJob({
      ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
      template: RECEIVER_LABEL_TEMPLATES.summary50,
      copies: 2
    }, [order]);
    expect(job.copies).toBe(2);
    expect(job.pages[0]).toMatchObject({ widthMm: 50, heightMm: 50 });
    expect(job.pages[0]?.elements[0]).toMatchObject({ type: "qr", value: order.scanValue });
    expect(job.pages[0]?.elements.filter((element) => element.type === "text")).toHaveLength(6);
  });

  it("builds a custom freeform label for Web and Pad printing", () => {
    const job = buildReceiverLabelPrintJob({
      ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
      selectedLayoutId: "freeform-400x650-test",
      freeform: {
        ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS.freeform,
        widthMm: 40,
        heightMm: 65,
        copies: 3,
        fontSizePt: 11,
        bold: true,
        summaryText: "款号：{{styleNo}}  {{sampleType}}\n{{styleName}}\n数量：{{quantity}}件"
      },
      savedLayouts: [{
        id: "freeform-400x650-test",
        name: "40mm × 65mm（自由设计）",
        settings: {
          ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS.freeform,
          widthMm: 40,
          heightMm: 65,
          copies: 3,
          fontSizePt: 11,
          bold: true,
          summaryText: "款号：{{styleNo}}  {{sampleType}}\n{{styleName}}\n数量：{{quantity}}件"
        }
      }]
    }, [order]);
    expect(job.copies).toBe(3);
    expect(job.pages[0]).toMatchObject({ widthMm: 40, heightMm: 65 });
    expect(job.pages[0]?.elements[0]).toMatchObject({ type: "qr", value: order.scanValue });
    expect(job.pages[0]?.elements.filter((element) => element.type === "text")).toHaveLength(1);
    expect(job.pages[0]?.elements.find((element) => element.type === "text")).toMatchObject({
      bold: true,
      value: "款号：ST-001  第一版样衣\n测试款\n数量：2件",
      fontSize: 11 * 25.4 / 72
    });
  });

  it("keeps box scaling inside the label", () => {
    const original = { x: 0.52, y: 0.16, width: 0.3, height: 0.4 };
    const enlarged = scaleFreeformBox(original, 1.5, 0.16);
    expect(enlarged.x).toBeGreaterThanOrEqual(0);
    expect(enlarged.y).toBeGreaterThanOrEqual(0);
    expect(enlarged.x + enlarged.width).toBeLessThanOrEqual(1);
    expect(enlarged.y + enlarged.height).toBeLessThanOrEqual(1);
  });

  it("replaces supported placeholders and preserves free text, line breaks and unknown placeholders", () => {
    expect(renderReceiverLabelSummaryText(
      "{{customerName}} / {{businessUserName}}\n{{styleNo}} {{unknown}}",
      order
    )).toBe("测试客户 / 业务员一号\nST-001 {{unknown}}");
  });
});
