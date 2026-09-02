import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, "../miniprogram", relativePath), "utf8");

describe("Android-aligned mini-program shell", () => {
  it("keeps the Android login structure without Android network settings", () => {
    const login = source("pages/identity/identity.wxml");
    expect(login).toContain("Sample Room OS");
    expect(login).toContain("微信小程序移动入口");
    expect(login).toContain("账号登录");
    expect(login).toContain("业务账号");
    expect(login).toContain("工序员工");
    expect(login).not.toContain("网络设置");
    expect(login).not.toContain("NETWORK_CONFIG");
  });

  it("uses the Android visual tokens across the shared shell and role tabs", () => {
    const shell = source("app.wxss");
    expect(shell).toContain("#f3f6f8");
    expect(shell).toContain("#176b87");
    expect(shell).toContain("entry-card");
    expect(source("components/receiver-tabs/index.wxss")).toContain("#176b87");
    expect(source("components/planner-tabs/index.wxss")).toContain("#176b87");
    expect(source("components/client-tabs/index.wxss")).toContain("#176b87");
  });

  it("uses navy navigation bars for receiver and planner operational pages", () => {
    [
      "pages/receiver/home.json",
      "pages/receiver/orders.json",
      "pages/receiver/intake.json",
      "pages/receiver/scan-charge.json",
      "pages/planner/home.json",
      "pages/planner/orders.json",
      "pages/planner/production-plan.json",
      "pages/planner/scan-charge.json"
    ].forEach((file) => {
      expect(source(file)).toContain("#173c5a");
      expect(source(file)).toContain('"navigationBarTextStyle": "white"');
    });
  });
});
