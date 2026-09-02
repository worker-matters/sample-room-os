import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(__dirname, "MiniappReleasePreviewControl.tsx"), "utf8");

describe("System Owner mini-program release preview controls", () => {
  it("exposes expiry, password reset, enable/disable and the zero-business-data warning", () => {
    expect(source).toContain("release 安全预览");
    expect(source).toContain("expiresInHours");
    expect(source).toContain("设置/重置测试密码");
    expect(source).toContain("不读取真实订单");
    expect(source).toContain("不能执行任何正式写操作");
  });
});
