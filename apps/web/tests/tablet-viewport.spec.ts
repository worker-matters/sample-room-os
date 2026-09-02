import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const screenshotRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/acceptance/screenshots/tablet-android-phase1"
);

const viewports = [
  { width: 1280, height: 800, expectedColumns: 2 },
  { width: 1180, height: 820, expectedColumns: 2 },
  { width: 1024, height: 768, expectedColumns: 2 },
  { width: 900, height: 600, expectedColumns: 1 }
] as const;

for (const viewport of viewports) {
  test(`QC Pad viewport ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.skip(
      !["chromium", "system-chrome"].includes(testInfo.project.name),
      "Pad viewport matrix runs only in a desktop Chromium engine."
    );
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem("sample-room-v2-dev-role", "worker"));
    await page.goto("/qc/tablet");
    await expect(page.locator(".qc-tablet-shell")).toBeVisible();

    const metrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      scrollWidth: document.documentElement.scrollWidth,
      bodyFontSize: Number.parseFloat(getComputedStyle(document.body).fontSize)
    }));
    expect(metrics.innerWidth).toBe(viewport.width);
    expect(metrics.innerHeight).toBe(viewport.height);
    expect(metrics.devicePixelRatio).toBeGreaterThan(0);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(viewport.width);
    expect(metrics.bodyFontSize).toBeGreaterThanOrEqual(14);

    const columns = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "qc-tablet-inspection-layout";
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      document.body.append(probe);
      const count = getComputedStyle(probe).gridTemplateColumns.split(" ").filter(Boolean).length;
      probe.remove();
      return count;
    });
    expect(columns).toBe(viewport.expectedColumns);

    await page.locator(".qc-tablet-bottom-nav button").nth(3).click();
    await expect(page.locator(".qc-tablet-profile-page")).toBeVisible();
    await page.locator(".qc-tablet-bottom-nav button").first().click();
    await expect(page.locator(".qc-tablet-scan-page")).toBeVisible();

    mkdirSync(screenshotRoot, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotRoot, `qc-tablet-${viewport.width}x${viewport.height}.png`),
      fullPage: false
    });
  });
}
