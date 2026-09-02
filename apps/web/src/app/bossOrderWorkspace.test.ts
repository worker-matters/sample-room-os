import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDirectory = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(appDirectory, "App.tsx"), "utf8");
const css = readFileSync(resolve(appDirectory, "styles.css"), "utf8");

describe("boss order workspace shell", () => {
  it("gives boss and system owner order pages the fixed data-workbench shell", () => {
    const start = appSource.indexOf("const dataWorkbench = new Set([");
    const end = appSource.indexOf("]).has(location.pathname);", start);
    const dataWorkbenchSource = appSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(dataWorkbenchSource).toContain('"/admin"');
    expect(dataWorkbenchSource).toContain('"/system-owner"');
  });

  it("keeps expanded active and terminated order sections sharing the remaining height", () => {
    expect(css).toMatch(
      /\.app-data-workbench-shell \.boss-active-orders-card,[\s\S]*?\.app-data-workbench-shell \.terminated-orders-section\.is-expanded,[\s\S]*?flex: 1 1 0;/
    );
    expect(css).toContain(".boss-order-data-workspace");
    expect(css).toMatch(/\.data-workspace-table \.ant-table-body \{[\s\S]*?overflow: auto !important;/);
  });
});
