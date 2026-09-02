import { describe, expect, it, vi } from "vitest";
import { selectApiEndpoint, type EndpointConfig } from "../miniprogram/services/endpointSelector";

const config: EndpointConfig = {
  lanApiBase: "https://lan-api.invalid",
  publicApiBase: "https://public-api.invalid",
  expectedServiceId: "sample-room-api",
  timeoutMs: 100,
  buildMode: "development"
};

const healthy = { ok: true as const, service: config.expectedServiceId, apiVersion: "v1" as const };

describe("selectApiEndpoint", () => {
  it("selects LAN when the expected service is reachable", async () => {
    const probe = vi.fn().mockResolvedValue(healthy);
    await expect(selectApiEndpoint(config, probe)).resolves.toEqual({
      baseUrl: config.lanApiBase,
      mode: "lan"
    });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("falls back to public when LAN times out", async () => {
    const probe = vi.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(healthy);
    await expect(selectApiEndpoint(config, probe)).resolves.toEqual({
      baseUrl: config.publicApiBase,
      mode: "public"
    });
  });

  it("rejects a wrong LAN service identity and falls back to public", async () => {
    const probe = vi.fn()
      .mockResolvedValueOnce({ ok: true, service: "another-api", apiVersion: "v1" })
      .mockResolvedValueOnce(healthy);
    await expect(selectApiEndpoint(config, probe)).resolves.toEqual({
      baseUrl: config.publicApiBase,
      mode: "public"
    });
  });

  it("reports unavailable when neither endpoint is the expected service", async () => {
    const probe = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(selectApiEndpoint(config, probe)).rejects.toThrow("样品间 API 当前不可用");
  });

  it("does not probe a placeholder public endpoint when PUBLIC_API_BASE is empty", async () => {
    const probe = vi.fn().mockRejectedValue(new Error("LAN timeout"));
    await expect(selectApiEndpoint({ ...config, publicApiBase: "" }, probe))
      .rejects.toThrow("请连接工厂 Wi-Fi 或检查开发服务器");
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(config.lanApiBase, config.timeoutMs);
  });

  it("uses only the configured public HTTPS endpoint in production", async () => {
    const probe = vi.fn().mockResolvedValue(healthy);
    await expect(selectApiEndpoint({
      ...config,
      buildMode: "production",
      publicApiBase: "https://public-api.invalid/"
    }, probe)).resolves.toEqual({
      baseUrl: "https://public-api.invalid",
      mode: "public"
    });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith("https://public-api.invalid/", config.timeoutMs);
  });

  it("rejects a missing or unsafe production public endpoint before probing", async () => {
    const probe = vi.fn();
    await expect(selectApiEndpoint({
      ...config,
      buildMode: "production",
      publicApiBase: ""
    }, probe)).rejects.toThrow("正式版未配置公网 API 地址");
    await expect(selectApiEndpoint({
      ...config,
      buildMode: "production",
      publicApiBase: "http://public-api.invalid"
    }, probe)).rejects.toThrow("必须是有效的 HTTPS 服务地址");
    await expect(selectApiEndpoint({
      ...config,
      buildMode: "production",
      publicApiBase: "https://user:secret@public-api.invalid"
    }, probe)).rejects.toThrow("必须是有效的 HTTPS 服务地址");
    await expect(selectApiEndpoint({
      ...config,
      buildMode: "production",
      publicApiBase: "https://public-api.invalid/api"
    }, probe)).rejects.toThrow("必须是有效的 HTTPS 服务地址");
    await expect(selectApiEndpoint({
      ...config,
      buildMode: "production",
      publicApiBase: "https://public-api.invalid?token=secret"
    }, probe)).rejects.toThrow("必须是有效的 HTTPS 服务地址");
    expect(probe).not.toHaveBeenCalled();
  });
});
