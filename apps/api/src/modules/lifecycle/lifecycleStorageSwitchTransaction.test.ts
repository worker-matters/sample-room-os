import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../../..");
const action = readFileSync(path.join(root, "deployment/windows-factory/lifecycle/actions/Invoke-MigrateStorage.ps1"), "utf8");
const runner = readFileSync(path.join(root, "deployment/windows-factory/lifecycle/Start-LifecycleRunner.ps1"), "utf8");

describe("LCM-05 storage switch transaction", () => {
  it("creates a verified safety recovery point and verifies copied files before switching", () => {
    expect(action.indexOf("pre-storage-migration")).toBeLessThan(action.indexOf("Copy-StorageTreeVerified"));
    expect(action.indexOf("Copy-StorageTreeVerified")).toBeLessThan(action.indexOf('Save-Stage $transaction "data_verified"'));
    expect(action.indexOf('Save-Stage $transaction "data_verified"')).toBeLessThan(action.indexOf("Invoke-Compose stop api"));
    expect(action.indexOf("Invoke-Compose stop api")).toBeLessThan(action.indexOf("Set-FactoryDataRoot $target"));
    expect(action.indexOf("Set-FactoryDataRoot $target")).toBeLessThan(action.indexOf('Progress "final_check"'));
    expect(action.indexOf('Progress "final_check"')).toBeLessThan(action.lastIndexOf("Assert-SystemHealth"));
  });

  it("retains the original data and has a fixed return-to-original path after interruption", () => {
    expect(action).not.toMatch(/Remove-Item\s+-LiteralPath\s+\$source/i);
    expect(action).toContain("Restore-OriginalState");
    expect(action).toContain('Copy-Item -LiteralPath $Transaction.factoryEnvBackup');
    expect(action).toContain('Copy-Item -LiteralPath $Transaction.runnerConfigBackup');
    expect(runner).toContain('switchPhase -in @("api_stopped", "configuration_switched", "api_restarted")');
    expect(runner).toContain("STORAGE_CHANGE_INTERRUPTED_ORIGINAL_RESTORED");
  });

  it("never resumes an interrupted forward switch and retains the lock when return is uncertain", () => {
    const interruptedBlock = runner.slice(runner.indexOf('if ($journal.action -eq "migrate_storage"'), runner.indexOf('Write-LifecycleLog -Config $config -JobId $journal.jobId -Event "interrupted_detected"'));
    expect(interruptedBlock).toContain("-RecoverInterrupted");
    expect(interruptedBlock).not.toContain("-MigrationPlanId");
    expect(action).toContain("MANUAL_REVIEW_REQUIRED");
    expect(runner).toContain('requiresManualReview = $manual');
  });
});
