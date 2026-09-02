import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../../..");
const lifecycleRoot = path.join(root, "deployment/windows-factory/lifecycle");
const readSource = (file: string) => readFileSync(file, "utf8").replaceAll("\r\n", "\n");

describe("factory lifecycle production resilience", () => {
  it("does not treat recovery-point duration as a 60-second operation timeout", () => {
    const controlApp = readSource(
      path.join(root, "apps/api/src/modules/lifecycle/lifecycleRunnerControlApp.ts")
    );

    expect(controlApp).toContain("FACTORY_RUNNER_LEASE_DURATION_MS = 30 * 24 * 60 * 60 * 1000");
    expect(controlApp).toContain("FACTORY_RUNNER_LEASE_DURATION_MS\n  );");
    expect(controlApp).toContain("Recovery points copy and verify the complete application/attachment set");
  });

  it("reviews active work before gracefully replacing the runner process", () => {
    const taskScript = readSource(path.join(lifecycleRoot, "LifecycleRunner.Task.ps1"));
    const repairStart = taskScript.indexOf('"Repair" {');
    const repairEnd = taskScript.indexOf('"Start" {', repairStart);
    const repair = taskScript.slice(repairStart, repairEnd);

    expect(repairStart).toBeGreaterThan(-1);
    expect(repairEnd).toBeGreaterThan(repairStart);
    expect(repair).toContain("Invoke-ActiveJobReview | Out-Null");
    expect(repair).toContain("Request-RunnerStopAndWait");
    expect(repair.indexOf("Invoke-ActiveJobReview | Out-Null")).toBeLessThan(
      repair.indexOf("Request-RunnerStopAndWait")
    );
    expect(repair).not.toContain("Stop-ScheduledTask");
    expect(taskScript).toContain('Global\\SampleRoomLifecycleRunner');
    expect(taskScript).toContain("Start-RunnerTaskAndWait");
    expect(taskScript).toContain("did not stop after a graceful stop request");
  });
});
