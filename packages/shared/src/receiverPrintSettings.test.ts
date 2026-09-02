import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
  RECEIVER_LABEL_TEMPLATES,
  parseReceiverQrPrintSettings,
  receiverLabelCopies
} from "./receiverPrintSettings";

describe("receiver print settings", () => {
  it("accepts the two supported B1 templates", () => {
    expect(parseReceiverQrPrintSettings(DEFAULT_RECEIVER_QR_PRINT_SETTINGS)).toEqual(
      DEFAULT_RECEIVER_QR_PRINT_SETTINGS
    );
    expect(parseReceiverQrPrintSettings({
      ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
      template: RECEIVER_LABEL_TEMPLATES.summary50,
      copies: 20
    })?.template).toBe(RECEIVER_LABEL_TEMPLATES.summary50);
  });

  it("rejects invalid copies and unknown summary fields", () => {
    expect(parseReceiverQrPrintSettings({ ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS, copies: 0 })).toBeUndefined();
    expect(parseReceiverQrPrintSettings({
      ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
      summaryFields: ["customerName", "internalCost"]
    })).toBeUndefined();
  });

  it("upgrades legacy standard settings and accepts a safe freeform layout", () => {
    const legacy = {
      ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
      schemaVersion: 1,
      mode: undefined,
      freeform: undefined
    };
    const upgraded = parseReceiverQrPrintSettings(legacy);
    expect(upgraded?.schemaVersion).toBe(3);
    expect(upgraded?.selectedLayoutId).toBe(RECEIVER_LABEL_TEMPLATES.qrOnly33);

    const freeform = parseReceiverQrPrintSettings({
      ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
      freeform: {
        ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS.freeform,
        widthMm: 40,
        heightMm: 65,
        copies: 3
      },
      selectedLayoutId: "freeform-400x650-test",
      savedLayouts: [{
        id: "freeform-400x650-test",
        name: "40mm × 65mm（自由设计）",
        settings: {
          ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS.freeform,
          widthMm: 40,
          heightMm: 65,
          copies: 3
        }
      }]
    });
    expect(freeform?.freeform).toMatchObject({ widthMm: 40, heightMm: 65 });
    expect(receiverLabelCopies(freeform!)).toBe(3);
  });

  it("upgrades schema 2 freeform summaries to editable multiline text", () => {
    const legacy = {
      ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
      schemaVersion: 2,
      freeform: {
        ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS.freeform,
        summaryText: undefined,
        summaryFields: ["styleNo", "sampleType", "quantity"]
      },
      selectedLayoutId: "freeform-legacy",
      savedLayouts: [{
        id: "freeform-legacy",
        name: "旧自由模板",
        settings: {
          ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS.freeform,
          summaryText: undefined,
          summaryFields: ["styleName", "customerName"]
        }
      }]
    };
    const upgraded = parseReceiverQrPrintSettings(legacy);
    expect(upgraded?.schemaVersion).toBe(3);
    expect(upgraded?.freeform.summaryText).toBe("款号：{{styleNo}}\n样品类型：{{sampleType}}\n数量：{{quantity}}");
    expect(upgraded?.savedLayouts[0]?.settings.summaryText).toBe("款名：{{styleName}}\n客户：{{customerName}}");
  });

  it("rejects freeform sizes outside the B1 paper range", () => {
    expect(parseReceiverQrPrintSettings({
      ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
      freeform: { ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS.freeform, widthMm: 51 }
    })).toBeUndefined();
  });
});
