import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "prisma/migrations/20260813150000_order_reconciliation_concurrency_guards/migration.sql"
);
const sql = readFileSync(migrationPath, "utf8");

describe("reconciliation concurrency migration contract", () => {
  it("backfills whole returns before enforcing one active statement item per order", () => {
    const backfill = sql.indexOf('UPDATE "ReconciliationStatementItem" AS item');
    const duplicateGuard = sql.indexOf("duplicate active reconciliation items exist");
    const uniqueIndex = sql.indexOf(
      'CREATE UNIQUE INDEX "ReconciliationStatementItem_active_orderId_key"'
    );

    expect(backfill).toBeGreaterThan(-1);
    expect(duplicateGuard).toBeGreaterThan(backfill);
    expect(uniqueIndex).toBeGreaterThan(duplicateGuard);
    expect(sql).toMatch(/WHERE "returnedAt" IS NULL\s*;/);
    expect(sql).toMatch(/GROUP BY "orderId"[\s\S]*HAVING COUNT\(\*\) > 1/);
  });
});
