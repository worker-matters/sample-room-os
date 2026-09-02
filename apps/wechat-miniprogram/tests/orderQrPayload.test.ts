import { describe, expect, it } from "vitest";
import {
  MAX_ORDER_QR_TOKEN_LENGTH,
  parseMiniappOrderQrPayload
} from "../miniprogram/utils/orderQrPayload";

describe("parseMiniappOrderQrPayload", () => {
  it("parses a valid versioned ORDER payload", () => {
    expect(parseMiniappOrderQrPayload("SRS2|ORDER|order_scan_abcd1234")).toEqual({
      version: "SRS2",
      type: "ORDER",
      token: "order_scan_abcd1234"
    });
  });

  it("rejects an unsupported version", () => {
    expect(() => parseMiniappOrderQrPayload("SRS1|ORDER|order_scan_abcd1234"))
      .toThrow("二维码版本不受支持");
  });

  it("rejects an unknown type", () => {
    expect(() => parseMiniappOrderQrPayload("SRS2|WORKER|order_scan_abcd1234"))
      .toThrow("二维码类型不是订单码");
  });

  it("rejects an empty token", () => {
    expect(() => parseMiniappOrderQrPayload("SRS2|ORDER|"))
      .toThrow("订单二维码 token 为空");
  });

  it("rejects illegal characters", () => {
    expect(() => parseMiniappOrderQrPayload("SRS2|ORDER|order scan/abcd"))
      .toThrow("订单二维码 token 含非法字符");
  });

  it("rejects an overlong payload", () => {
    const token = `a${"b".repeat(MAX_ORDER_QR_TOKEN_LENGTH)}`;
    expect(() => parseMiniappOrderQrPayload(`SRS2|ORDER|${token}`))
      .toThrow("订单二维码载荷过长");
  });
});
