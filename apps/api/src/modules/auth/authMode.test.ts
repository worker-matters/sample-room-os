import { describe, expect, it } from "vitest";
import { getAuthMode } from "./authMode";

describe("auth mode defaults", () => {
  it("uses formal authentication when AUTH_MODE is not configured", () => {
    expect(getAuthMode({})).toBe("formal");
  });

  it("retains explicit dev mode only for compatibility", () => {
    expect(getAuthMode({ AUTH_MODE: "dev" })).toBe("dev");
  });
});
