import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../../..");
const actions = path.join(root, "deployment/windows-factory/lifecycle/actions");

describe("LCM-06 fixed update transaction", () => {
  const apply = readFileSync(path.join(actions, "Invoke-ApplyUpdate.ps1"), "utf8").toLowerCase();
  const runner = readFileSync(path.join(root, "deployment/windows-factory/lifecycle/Start-LifecycleRunner.ps1"), "utf8").toLowerCase();

  it("creates and verifies a protected pre-update recovery point before changing the application", () => {
    expect(apply.indexOf("/runner/recovery-points/pre-update")).toBeGreaterThan(0);
    expect(apply.indexOf("$verifiedpoint.status -ne \"verified\"")).toBeGreaterThan(apply.indexOf("/runner/recovery-points/pre-update"));
    expect(apply.indexOf('save-stage $transaction "application_loaded"')).toBeGreaterThan(apply.indexOf("$verifiedpoint.status -ne \"verified\""));
    expect(apply).toContain("invoke-createrecoverypoint.ps1");
    expect(apply).toContain('progress "safety_backup_ready"');
  });

  it("persists irreversible update phases and retains the global lock after interruption", () => {
    for (const phase of ["application_loaded", "api_stopped", "database_updated", "api_restarted", "health_checked"]) {
      expect(apply).toContain(`save-stage $transaction "${phase}"`);
      expect(runner).toContain(`"${phase}"`);
    }
    expect(apply).toContain("manual_review_required");
    expect(runner).toContain("report-interrupted");
    expect(runner).toContain('journal.status = "manual_review_required"');
  });

  it("uses only fixed package contents, image names and health checks", () => {
    expect(apply).toContain("$result.payloadpath");
    expect(apply).toContain("sample-room-factory-api:latest");
    expect(apply).toContain("http://127.0.0.1:3001/health");
    expect(apply).not.toMatch(/\$job\.parameters\.(command|script|path|container|image|environment)/);
  });
});
