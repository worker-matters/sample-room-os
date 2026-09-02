import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { environmentExample } from "../miniprogram/config/environment.example";
import { developmentPersonaLoginEnabled } from "../miniprogram/utils/identityPreview";

const source = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, "../miniprogram", relativePath), "utf8");

describe("mini-program Account login", () => {
  it("completely disables development personas in production defaults and release builds", () => {
    expect(environmentExample.enableDevFakeIdentityLogin).toBe(false);
    expect(developmentPersonaLoginEnabled("release")).toBe(false);
  });

  it("logs development personas in through the fixed server endpoint", () => {
    const page = source("pages/dev/test-mode.ts");
    const view = source("pages/dev/test-mode.wxml");
    expect(page).toContain("loginDevelopmentPersona");
    expect(page).toContain("response.sessionToken");
    expect(page).not.toContain("identityPreviewAt");
    expect(view).toContain("开发测试模式");
    expect(view).toContain("关闭测试模式");
  });

  it("does not submit a role, Account ID or WorkerProfile ID", () => {
    const api = source("services/apiClient.ts");
    expect(api).toContain("/api/miniapp/dev/personas/");
    expect(api).toContain("/api/miniapp/dev/test-mode/logout");
    expect(api).not.toMatch(/loginDevelopmentPersona[\s\S]{0,300}(role|accountId|workerProfileId)/);
  });

  it("uses Account credentials instead of wx.login or an identity-binding QR", () => {
    const api = source("services/apiClient.ts");
    const identity = source("pages/identity/identity.ts");
    const index = source("pages/index/index.ts");
    expect(api).toContain("credentials");
    expect(identity).toContain("username");
    expect(identity).toContain("phoneNumber");
    expect(index).not.toContain("wx.login");
    expect(identity).not.toContain("consumeWechatBinding");
    expect(identity).toContain("response.testModeToken");
  });

  it("never exposes the order scanner before an authenticated role allows it", () => {
    const index = source("pages/index/index.ts");
    const view = source("pages/index/index.wxml");
    expect(index).toContain('globalData.identity.status === "active" &&');
    expect(index).toContain("!globalData.identityPreviewActive");
    expect(index).not.toContain("enableDevReadonlyScan");
    expect(view).toContain('wx:if="{{canScanOrder}}"');
  });

  it("keeps release preview presentation-only and blocks scanning", () => {
    const testPage = source("pages/dev/test-mode.ts");
    const scanner = source("pages/scan/scan.ts");
    expect(testPage).toContain("if (response.preview)");
    expect(testPage).toContain("identityPreviewActive = true");
    expect(testPage).not.toMatch(/if \(response\.preview\)[\s\S]{0,400}sessionToken = response\.sessionToken/);
    expect(scanner).toContain("安全预览模式不能扫描订单");
  });

  it("returns from every persona page to the test identity selector without closing test mode", () => {
    const component = source("components/test-mode-return/index.ts");
    const componentView = source("components/test-mode-return/index.wxml");
    const appConfig = JSON.parse(source("app.json")) as { pages: string[]; usingComponents: Record<string, string> };

    expect(componentView).toContain("返回测试身份");
    expect(component).toContain("logoutMiniapp");
    expect(component).toContain("wx.removeStorageSync(SESSION_STORAGE_KEY)");
    expect(component).toContain("wx.setStorageSync(TEST_MODE_STORAGE_KEY, testModeToken)");
    expect(component).toContain('wx.reLaunch({ url: "/pages/dev/test-mode" })');
    expect(appConfig.usingComponents["test-mode-return"]).toBe("/components/test-mode-return/index");

    for (const page of appConfig.pages.filter((item) => item !== "pages/dev/test-mode")) {
      expect(source(`${page}.wxml`), page).toContain("<test-mode-return />");
    }
  });
});
