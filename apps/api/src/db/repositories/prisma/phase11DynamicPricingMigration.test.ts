import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.resolve(process.cwd(), "prisma/migrations");
const migrationPath = path.join(
  migrationsDirectory,
  "20260727143000_phase1_1_dynamic_pricing",
  "migration.sql"
);
const obsoleteMigrationPath = path.join(
  migrationsDirectory,
  "20260727120000_pricing_cost_exceptions"
);
const sql = readFileSync(migrationPath, "utf8");

describe("Phase 1.1 dynamic pricing migration contract", () => {
  it("replaces the unexecuted exception-cost migration with the final model", () => {
    expect(existsSync(obsoleteMigrationPath)).toBe(false);
    expect(sql).toContain('CREATE TABLE "InternalCostItem"');
    expect(sql).toContain('CREATE TABLE "CustomerChargeItem"');
    expect(sql).toContain('ADD COLUMN "confirmedCustomerChargeSnapshot" JSONB');
    expect(sql).toContain('ADD COLUMN "customerChargeSnapshot" JSONB');
    expect(sql).not.toContain("internalCostExceptionNote");
  });

  it("extends OrderCharge confirmation metadata without deleting legacy records", () => {
    for (const status of ["pending", "confirmed", "rejected", "cancelled"]) {
      expect(sql).toContain(`ADD VALUE IF NOT EXISTS '${status}'`);
    }
    expect(sql).toContain('ADD COLUMN "rejectedAt" TIMESTAMP(3)');
    expect(sql).toContain('ADD COLUMN "cancelledAt" TIMESTAMP(3)');
    expect(sql).toContain('ADD COLUMN "archivedAt" TIMESTAMP(3)');
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE)\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("backfills historical pricing facts without using order tasks as a gate", () => {
    expect(sql).toContain("p.\"quotedPrice\" * o.\"quantity\"");
    expect(sql).not.toContain("sampleRequestItems");
    expect(sql).toContain("'legacy'::\"PricingItemSourceType\"");
    expect(sql).toContain('SET "recommendationsInitializedAt" = "updatedAt"');
  });
});
