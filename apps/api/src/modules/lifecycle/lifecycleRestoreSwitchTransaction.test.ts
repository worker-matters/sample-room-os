import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../../..");
const restoreScript = readFileSync(path.join(root, "deployment/windows-factory/lifecycle/actions/Invoke-RestoreRecoveryPoint.ps1"), "utf8");
const runnerScript = readFileSync(path.join(root, "deployment/windows-factory/lifecycle/Start-LifecycleRunner.ps1"), "utf8");

describe("LCM-04 restore switch transaction", () => {
  it("persists the database switch before the separate application and attachment switches", () => {
    const database = restoreScript.indexOf('Save-Stage $transaction "database_switched"');
    const application = restoreScript.indexOf('-OriginalStagedPhase "application_original_staged"');
    const attachments = restoreScript.indexOf('-OriginalStagedPhase "attachments_original_staged"');
    expect(database).toBeGreaterThan(-1);
    expect(database).toBeLessThan(application);
    expect(application).toBeLessThan(attachments);
  });

  it("records a verified safety backup and returns through it after a partial switch", () => {
    expect(restoreScript).toContain('preRestoreRecoveryPointId');
    expect(restoreScript).toContain('Save-Stage $transaction "pre_restore_verified"');
    expect(restoreScript).toContain('function Restore-PreRestoreState');
    expect(restoreScript).toContain('Assert-FactoryBackupPackage');
    expect(restoreScript).toContain('Save-Stage $Transaction "restored_to_pre_restore"');
  });

  it("returns an interrupted target switch to the safety backup, but never resumes an interrupted return", () => {
    expect(runnerScript).toContain('Invoke-RestoreRecoveryPoint.ps1") -ConfigPath $ConfigPath -RecoverInterrupted');
    expect(runnerScript).toContain('RESTORE_INTERRUPTED_RETURNED_TO_PRE_RESTORE');
    expect(runnerScript).toContain('report-interrupted');
    expect(restoreScript).toContain('MANUAL_REVIEW_REQUIRED: The database, application data and attachments could not all be returned to the pre-restore state.');
    expect(restoreScript).not.toContain('"restoring_pre_restore", "pre_restore_database_ready"');
  });

  it("never switches the whole system data root or the PostgreSQL host directory", () => {
    expect(restoreScript).not.toMatch(/(?:Move-Item|Remove-Item|Rename-Item).*(?:factoryDataRoot|systemDataRoot|postgresDataRoot)/i);
    expect(restoreScript).toContain('$transaction.applicationStageRoot');
    expect(restoreScript).toContain('$transaction.attachmentStageRoot');
    expect(restoreScript).toContain('Rename-Database');
  });

  it("keeps the successful restore completion stage after health verification", () => {
    expect(restoreScript).toContain('Save-Stage $transaction "health_checked"');
    expect(restoreScript.indexOf('Save-Stage $transaction "health_checked"')).toBeLessThan(restoreScript.indexOf('System restore completed.'));
  });
});
