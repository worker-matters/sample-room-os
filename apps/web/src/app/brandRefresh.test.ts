import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), "utf8");

describe("Sample Room OS brand", () => {
  const brandSource = read("../components/BrandLockup.tsx");
  const brandCss = read("brandRefresh.css");
  const fullRootSource = read("../FullApplicationRoot.tsx");
  const formalLoginSource = read("../pages/login/FormalLoginPage.tsx");
  const tabletHeaderSource = read("../components/tablet/TabletWorkbenchHeader.tsx");
  const indexSource = read("../../index.html");
  const workerRegistrationSource = read("../pages/workers/WorkerRegistrationStandaloneApp.tsx");

  it("uses one shared neutral brand lockup inside the Web login card and tablet WebView headers", () => {
    expect(brandSource).toContain('SAMPLE_ROOM_PRODUCT_NAME = "Sample Room OS"');
    expect(brandSource).toContain('sample-room-os-mark.svg');
    expect(formalLoginSource).toContain('<BrandLockup className="formal-login-card-lockup" />');
    expect(formalLoginSource).not.toContain('<BrandLockup className="formal-login-brand-lockup" />');
    expect(formalLoginSource).toContain("样品管理 · 高效有序");
    expect(formalLoginSource).toContain("规范管理&nbsp;&nbsp;|&nbsp;&nbsp;快速查找&nbsp;&nbsp;|&nbsp;&nbsp;安全可控");
    expect(tabletHeaderSource).toContain('<BrandLockup className="tablet-brand-lockup" />');
  });

  it("loads visual overrides for desktop, worker mobile, and QC tablet WebView surfaces", () => {
    expect(fullRootSource).toContain('import "./app/brandRefresh.css"');
    expect(brandCss).toContain('.formal-login-card-lockup');
    expect(brandCss).toContain('display: inline-flex;');
    expect(brandCss).toContain('.worker-mobile-page .worker-mobile-kicker::after');
    expect(brandCss).toContain('content: "Sample Room OS"');
    expect(brandCss).toContain('.qc-tablet-header::before');
    expect(brandCss).toContain('.qc-tablet-header::after');
  });

  it("uses Sample Room OS as the browser and mobile Web page title", () => {
    expect(indexSource).toContain('<title>Sample Room OS</title>');
    expect(indexSource).toContain('name="application-name" content="Sample Room OS"');
    expect(indexSource).toContain('name="apple-mobile-web-app-title" content="Sample Room OS"');
    expect(workerRegistrationSource).toContain('document.title = "Sample Room OS"');
    expect(workerRegistrationSource).not.toContain('document.title = "注册成功"');
  });
});
