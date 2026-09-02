import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../miniprogram");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("unified Account login page", () => {
  it("supports Business username and Worker phone login without identity binding", () => {
    const template = source("pages/identity/identity.wxml");
    const logic = source("pages/identity/identity.ts");
    expect(template).toContain("业务账号");
    expect(template).toContain("工序员工");
    expect(template).toContain("登录用户名");
    expect(template).toContain("登录手机号");
    expect(logic).toContain("loginMiniapp");
    expect(logic).not.toContain("consumeWechatBinding");
    expect(logic).not.toContain("completeWorkerAccountRegistration");
  });

  it("keeps Worker registration in the Web flow instead of Miniapp API paths", () => {
    const api = source("services/apiClient.ts");
    expect(api).not.toContain("/api/workers/registration/resolve");
    expect(api).not.toContain("/api/workers/registration/complete");
    expect(api).not.toContain("/api/miniapp/bindings/consume");
  });
});
