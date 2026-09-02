import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "prisma/migrations/20260722170000_lifecycle_data_and_permissions/migration.sql"),
  "utf8"
);

describe("LCM-01 additive migration contract", () => {
  it("creates only the lifecycle enums and tables", () => {
    for (const enumName of [
      "RecoveryPointKind",
      "RecoveryPointStatus",
      "LifecycleJobAction",
      "LifecycleJobStatus",
      "LifecycleArtifactKind"
    ]) {
      expect(sql).toContain(`CREATE TYPE "${enumName}"`);
    }
    for (const tableName of [
      "RecoveryPoint",
      "RecoveryPointArtifact",
      "LifecycleJob",
      "LifecycleJobEvent",
      "MaintenanceLock",
      "UpdateArtifact"
    ]) {
      expect(sql).toContain(`CREATE TABLE "${tableName}"`);
    }
  });

  it("contains no destructive data or schema statements", () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bRENAME\b/i);
    expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/i);
  });

  it("does not reference legacy business or BackupRecord tables", () => {
    for (const tableName of [
      "Account",
      "Order",
      "OrderAttachment",
      "AttachmentAuditLog",
      "BackupRecord",
      "OperationLog"
    ]) {
      expect(sql).not.toContain(`"${tableName}"`);
    }
  });

  it("enforces database uniqueness, controlled identifiers, and singleton scope", () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "LifecycleJob_idempotencyKey_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "UpdateArtifact_digest_key"');
    expect(sql).toContain('CONSTRAINT "RecoveryPointArtifact_relativeName_check"');
    expect(sql).toContain('CONSTRAINT "MaintenanceLock_global_singleton_check" CHECK ("scope" = \'global_lifecycle\')');
  });
});
