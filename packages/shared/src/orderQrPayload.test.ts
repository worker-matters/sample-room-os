import { describe, expect, it } from "vitest";
import { parseOrderQrPayload } from "./orderQrPayload.js";

describe("parseOrderQrPayload", () => {
  const token = "order_scan_example_12345678";

  it("parses the SRS2 plain-text order payload", () => {
    expect(parseOrderQrPayload(`SRS2|ORDER|${token}`)).toEqual({
      version: "SRS2",
      type: "ORDER",
      token,
      sourceFormat: "plain_text"
    });
  });

  it("parses compatible HTTPS URLs and relative paths", () => {
    expect(parseOrderQrPayload(`https://sample.example/scan/${token}`)).toMatchObject({
      token,
      sourceFormat: "legacy_url"
    });
    expect(parseOrderQrPayload(`/scan/${token}`)).toMatchObject({
      token,
      sourceFormat: "relative_path"
    });
  });

  it("parses compatible bare order tokens", () => {
    expect(parseOrderQrPayload(token)).toMatchObject({ token, sourceFormat: "bare_token" });
  });

  it.each([
    "",
    "SRS2|WORKER|order_scan_example_12345678",
    "SRS2|ORDER|bad token",
    "http://sample.example/scan/order_scan_example_12345678",
    "https://sample.example/orders/order_scan_example_12345678",
    "worker_reg_example_12345678"
  ])("rejects invalid payload %j", (value) => {
    expect(() => parseOrderQrPayload(value)).toThrow("invalid_order_qr_payload");
  });
});
