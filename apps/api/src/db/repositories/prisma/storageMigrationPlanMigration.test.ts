import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(import.meta.dirname, "../../../../prisma/migrations/20260723113000_storage_migration_plan/migration.sql"), "utf8");

describe("LCM-05 additive migration contract", () => {
  it("creates only the controlled storage change plan table and index", () => {
    expect(sql).toContain('CREATE TABLE "StorageMigrationPlan"');
    expect(sql).toContain('CREATE INDEX "StorageMigrationPlan_status_createdAt_idx"');
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM|RENAME)\b/i);
  });

  it("does not modify business, attachment, backup, or existing lifecycle tables", () => {
    for (const tableName of ["Order", "Attachment", "BackupRecord", "RecoveryPoint", "LifecycleJob", "MaintenanceLock"]) {
      expect(sql).not.toMatch(new RegExp(`ALTER TABLE "${tableName}"`));
    }
  });
});
