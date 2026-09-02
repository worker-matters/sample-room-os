import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(import.meta.dirname, "SystemManagementOverviewPanel.tsx"), "utf8");

describe("system management overview maintenance status", () => {
  it("does not report configured disks as failed merely because the lifecycle runner is offline", () => {
    expect(source).toContain('if (runnerOnline === false) return { label: "等待维护服务", color: "default" };');
    expect(source).toContain("storageStatusTag(loadFailed, data?.runnerOnline, data?.storage.data.status)");
    expect(source).toContain("storageStatusTag(loadFailed, data?.runnerOnline, data?.storage.backup.status)");
  });
});
