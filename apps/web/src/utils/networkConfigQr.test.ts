import { describe, expect, it } from "vitest";
import { createNetworkConfigQrPayload } from "./networkConfigQr";

function decodePayload(value: string) {
  const encoded = value.split("|")[3]!;
  const padded = encoded.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (item) => item.charCodeAt(0))));
}

describe("network config QR payload", () => {
  it("encodes a versioned LAN API configuration without credentials", () => {
    const value = createNetworkConfigQrPayload({
      addressType: "LAN",
      baseUrl: "http://192.168.10.20:3001/",
      displayName: "工厂局域网"
    });
    expect(value.startsWith("SRS2|NETWORK_CONFIG|1|")).toBe(true);
    expect(decodePayload(value)).toEqual({
      addressType: "LAN",
      baseUrl: "http://192.168.10.20:3001",
      displayName: "工厂局域网",
      apiVersion: "v1"
    });
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "http://public.example.com",
    "https://user:secret@example.com",
    "https://example.com/api?token=secret",
    "https://example.com/api"
  ])("rejects unsafe or non-base URLs: %s", (value) => {
    expect(() => createNetworkConfigQrPayload({ addressType: "PUBLIC", baseUrl: value }))
      .toThrow();
  });
});
