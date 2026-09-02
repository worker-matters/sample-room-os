import { describe, expect, it } from "vitest";
import { DEFAULT_RECEIVER_QR_PRINT_SETTINGS, RECEIVER_LABEL_TEMPLATES } from "@sample-room/shared";
import { headers, request } from "./testHelpers.js";

describe("receiver print settings", () => {
  it("returns defaults and persists a receiver account setting", async () => {
    const receiverHeaders = {
      ...headers("receiver"),
      "x-dev-user-id": "formal-account-receiver"
    };
    const initial = await request("/api/receiver/print-settings", { headers: receiverHeaders });
    expect(initial.response.status).toBe(200);
    expect(initial.body.settings).toEqual(DEFAULT_RECEIVER_QR_PRINT_SETTINGS);

    const settings = {
      ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
      selectedLayoutId: "freeform-400x650-api-test",
      template: RECEIVER_LABEL_TEMPLATES.summary50,
      copies: 2,
      sampleTypeDisplay: "truncate_8",
      summaryFields: ["customerName", "styleNo", "quantity"],
      freeform: {
        ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS.freeform,
        widthMm: 40,
        heightMm: 65,
        copies: 3
      },
      savedLayouts: [
        {
          id: "freeform-400x650-api-test",
          name: "40mm × 65mm（自由设计 1）",
          settings: {
            ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS.freeform,
            widthMm: 40,
            heightMm: 65,
            copies: 3
          }
        },
        {
          id: "freeform-350x700-api-test",
          name: "35mm × 70mm（自由设计 2）",
          settings: {
            ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS.freeform,
            widthMm: 35,
            heightMm: 70,
            summaryText: "款号：{{styleNo}}"
          }
        }
      ]
    };
    const saved = await request("/api/receiver/print-settings", {
      method: "PUT",
      headers: receiverHeaders,
      body: JSON.stringify(settings)
    });
    expect(saved.response.status).toBe(200);
    expect(saved.body.settings).toEqual(settings);

    const reloaded = await request("/api/receiver/print-settings", { headers: receiverHeaders });
    expect(reloaded.body.settings).toEqual(settings);

    const withoutCustomLayout = {
      ...settings,
      selectedLayoutId: RECEIVER_LABEL_TEMPLATES.qrOnly33,
      template: RECEIVER_LABEL_TEMPLATES.qrOnly33,
      savedLayouts: []
    };
    const deleted = await request("/api/receiver/print-settings", {
      method: "PUT",
      headers: receiverHeaders,
      body: JSON.stringify(withoutCustomLayout)
    });
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.settings).toMatchObject({ savedLayouts: [] });
  });

  it("rejects invalid settings and non-receiver roles", async () => {
    const receiverHeaders = {
      ...headers("receiver"),
      "x-dev-user-id": "formal-account-receiver"
    };
    const invalid = await request("/api/receiver/print-settings", {
      method: "PUT",
      headers: receiverHeaders,
      body: JSON.stringify({ ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS, copies: 0 })
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body.error).toBe("receiver_print_settings_invalid");

    const planner = await request("/api/receiver/print-settings", { headers: headers("planner") });
    expect(planner.response.status).toBe(403);
  });

});
