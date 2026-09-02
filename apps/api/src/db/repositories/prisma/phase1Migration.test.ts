import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const targetMigration = "20260711100000_parallel_pattern_physical_flow";
const migrationsDirectory = path.resolve(process.cwd(), "prisma/migrations");
const migrationPath = path.join(migrationsDirectory, targetMigration, "migration.sql");
const sql = readFileSync(migrationPath, "utf8");

describe("parallel pattern/physical flow migration contract", () => {
  it("prioritizes final tasks and merges persisted completion facts", () => {
    const finalPriority = sql.indexOf(
      `WHEN "status" IN ('completed', 'submitted', 'submitted_to_cutting') THEN 0`
    );
    const currentPriority = sql.indexOf(
      `WHEN "status" IN ('active', 'in_progress') THEN 1`
    );
    expect(finalPriority).toBeGreaterThan(-1);
    expect(currentPriority).toBeGreaterThan(finalPriority);
    expect(sql).toMatch(/SELECT MIN\(sibling\."startedAt"\)[\s\S]*SELECT MAX\(sibling\."completedAt"\)/);
    expect(sql).toMatch(/SELECT MAX\(sibling\."submittedAt"\)[\s\S]*"completedAt" = COALESCE/);
    expect(sql).toMatch(/UPDATE "PatternDeliverable"[\s\S]*UPDATE "SubmittedCuttingVersion"/);
  });

  it("normalizes both legacy current statuses before enforcing one current task", () => {
    expect(sql).toMatch(
      /WITH ranked_current AS \([\s\S]*"status" IN \('active', 'in_progress'\)[\s\S]*current_rank/
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "PatternTask_one_active_per_pattern_maker"[\s\S]*WHERE "status" IN \('active', 'in_progress'\)/
    );
    expect(sql).toMatch(/legacy in_progress status remains/);
    expect(sql).toMatch(/pattern maker has multiple current tasks/);
    expect(sql).toMatch(/a final duplicate was replaced by a non-final task/);
  });

  it("backfills tasks and derives physical stages from selected routes or scan facts", () => {
    expect(sql).toMatch(
      /INSERT INTO "PatternTask"[\s\S]*source_order\."intakeStatus" = 'received'[\s\S]*'pattern_zipper_length'/
    );
    const stageRepair = sql.slice(sql.indexOf('CREATE TEMP TABLE "_OrderStageRepair"'));
    expect(stageRepair).toMatch(/scan\."action" = 'cutting_finish'/);
    expect(stageRepair).toMatch(/scan\."action" = 'sewing_finish'/);
    expect(stageRepair).toMatch(/scan\."action" = 'qc_delivery_finish'/);
    expect(sql).toMatch(/'cutting_waiting'::"OrderStage"[\s\S]*'sewing_waiting'::"OrderStage"/);
  });
});

const runDatabaseIntegration = process.env.RUN_PRISMA_MIGRATION_INTEGRATION === "1";
const databaseDescribe = runDatabaseIntegration ? describe : describe.skip;

databaseDescribe("parallel pattern/physical flow migration on PostgreSQL", () => {
  const containerName = `phase1-migration-${randomUUID().slice(0, 12)}`;
  let containerStarted = false;

  function docker(args: string[], input?: string, allowFailure = false) {
    const result = spawnSync("docker", args, {
      encoding: "utf8",
      input,
      maxBuffer: 10 * 1024 * 1024
    });
    if (result.error) throw result.error;
    if (!allowFailure && result.status !== 0) {
      throw new Error(
        `docker ${args.join(" ")} failed (${result.status ?? "unknown"})\n${result.stdout}\n${result.stderr}`
      );
    }
    return result;
  }

  function psql(statement: string, allowFailure = false) {
    return docker(
      [
        "exec",
        "-i",
        containerName,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "codex",
        "-d",
        "codex",
        "-At",
        "-F",
        "\t"
      ],
      statement,
      allowFailure
    );
  }

  beforeAll(async () => {
    docker([
      "run",
      "--rm",
      "-d",
      "--name",
      containerName,
      "--label",
      `codex.phase1-migration-test=${containerName}`,
      "-e",
      "POSTGRES_USER=codex",
      "-e",
      "POSTGRES_PASSWORD=codex_test",
      "-e",
      "POSTGRES_DB=codex",
      "postgres:16-alpine"
    ]);
    containerStarted = true;

    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const result = docker(
        [
          "exec",
          containerName,
          "psql",
          "-U",
          "codex",
          "-d",
          "codex",
          "-Atc",
          "SELECT 1"
        ],
        undefined,
        true
      );
      if (result.status === 0) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error("temporary PostgreSQL did not become ready");

    const baselineMigrations = readdirSync(migrationsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name < targetMigration)
      .map((entry) => entry.name)
      .sort();
    for (const migration of baselineMigrations) {
      const source = path.join(migrationsDirectory, migration, "migration.sql");
      docker(["cp", source, `${containerName}:/tmp/migration.sql`]);
      docker([
        "exec",
        containerName,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "codex",
        "-d",
        "codex",
        "-f",
        "/tmp/migration.sql"
      ]);
    }

    psql(`
      INSERT INTO "Customer" ("id", "name", "updatedAt")
      VALUES ('customer', 'Migration Customer', NOW());
      INSERT INTO "ClientUser" ("id", "customerId", "displayName", "updatedAt")
      VALUES ('client', 'customer', 'Migration Client', NOW());

      INSERT INTO "Order" (
        "id", "orderNo", "folderCode", "sourceType", "customerId", "clientUserId",
        "customerSnapshot", "styleNo", "styleName", "quantity", "sampleType",
        "sampleRound", "intakeStatus", "stage", "sampleRequestItems",
        "sampleGarmentRequired", "updatedAt"
      ) VALUES
        ('merge', 'SR-MERGE', 'F-MERGE', 'internal_manual', 'customer', 'client', '{}', 'S-MERGE', 'Merge', 1, 'sample', '1', 'received', 'pattern_waiting', ARRAY['pattern_making'], false, NOW()),
        ('completed', 'SR-COMP', 'F-COMP', 'internal_manual', 'customer', 'client', '{}', 'S-COMP', 'Completed', 1, 'sample', '1', 'received', 'pattern_waiting', ARRAY['pattern_revision'], false, NOW()),
        ('current-1', 'SR-C1', 'F-C1', 'internal_manual', 'customer', 'client', '{}', 'S-C1', 'Current 1', 1, 'sample', '1', 'received', 'pattern_waiting', ARRAY['pattern_making'], false, NOW()),
        ('current-2', 'SR-C2', 'F-C2', 'internal_manual', 'customer', 'client', '{}', 'S-C2', 'Current 2', 1, 'sample', '1', 'received', 'pattern_waiting', ARRAY['pattern_making'], false, NOW()),
        ('current-3', 'SR-C3', 'F-C3', 'internal_manual', 'customer', 'client', '{}', 'S-C3', 'Current 3', 1, 'sample', '1', 'received', 'pattern_waiting', ARRAY['pattern_making'], false, NOW()),
        ('orphan', 'SR-ORPHAN', 'F-ORPHAN', 'internal_manual', 'customer', 'client', '{}', 'S-ORPHAN', 'Orphan', 1, 'sample', '1', 'received', 'pattern_waiting', ARRAY['pattern_making'], false, NOW()),
        ('stage-route', 'SR-STAGE', 'F-STAGE', 'internal_manual', 'customer', 'client', '{}', 'S-STAGE', 'Stage', 1, 'sample', '1', 'received', 'pattern_waiting', ARRAY['cutting','sample_garment'], true, NOW()),
        ('stage-scan', 'SR-SCAN', 'F-SCAN', 'internal_manual', 'customer', 'client', '{}', 'S-SCAN', 'Scan', 1, 'sample', '1', 'received', 'sewing_doing', ARRAY['sample_garment'], true, NOW()),
        ('backfill', 'SR-BACK', 'F-BACK', 'internal_manual', 'customer', 'client', '{}', 'S-BACK', 'Backfill', 1, 'sample', '1', 'received', 'pattern_waiting', ARRAY['pattern_revision'], false, NOW());

      DROP INDEX "PatternTask_orderId_key";
      INSERT INTO "PatternTask" (
        "id", "orderId", "status", "patternMakerId", "patternMakerName", "note",
        "startedAt", "completedAt", "submittedAt", "createdAt", "updatedAt"
      ) VALUES
        ('merge-pending', 'merge', 'pending', NULL, NULL, 'pending note', NULL, NULL, NULL, '2026-07-05', '2026-07-05'),
        ('merge-completed', 'merge', 'completed', 'maker-completed', 'Completed Maker', 'completed note', '2026-07-01', '2026-07-03', NULL, '2026-07-01', '2026-07-03'),
        ('merge-submitted', 'merge', 'submitted', 'maker-submitted', 'Submitted Maker', 'submitted note', '2026-06-30', NULL, '2026-07-04', '2026-06-30', '2026-07-04'),
        ('completed-pending', 'completed', 'pending', NULL, NULL, 'new pending', NULL, NULL, NULL, '2026-07-05', '2026-07-05'),
        ('completed-final', 'completed', 'completed', 'maker-final', 'Final Maker', 'final note', '2026-07-01', '2026-07-02', NULL, '2026-07-01', '2026-07-02'),
        ('current-active-old', 'current-1', 'active', 'maker-current', 'Current Maker', NULL, '2026-07-01', NULL, NULL, '2026-07-01', '2026-07-01'),
        ('current-progress-new', 'current-2', 'in_progress', 'maker-current', 'Current Maker', NULL, '2026-07-02', NULL, NULL, '2026-07-02', '2026-07-03'),
        ('current-progress-old', 'current-3', 'in_progress', 'maker-current', 'Current Maker', NULL, '2026-06-30', NULL, NULL, '2026-06-30', '2026-06-30'),
        ('orphan-progress', 'orphan', 'in_progress', NULL, NULL, NULL, '2026-07-01', NULL, NULL, '2026-07-01', '2026-07-01');

      INSERT INTO "PatternDeliverable" (
        "id", "orderId", "patternTaskId", "version", "type", "fileName", "uploadedBy"
      ) VALUES ('deliverable', 'merge', 'merge-completed', 'V1', 'pattern_file', 'pattern.dxf', 'maker-completed');
      INSERT INTO "SubmittedCuttingVersion" (
        "id", "orderId", "patternTaskId", "version", "submittedBy", "submittedAt",
        "orderFolderPath", "submittedCuttingPath", "cuttingInboxPath"
      ) VALUES ('submission', 'merge', 'merge-completed', 'V1', 'maker-completed', '2026-07-03', '/order', '/submitted', '/inbox');
      INSERT INTO "ScanRecord" ("id", "orderId", "workerId", "action", "stage", "scannedAt")
      VALUES ('sewing-finish', 'stage-scan', 'worker', 'sewing_finish', 'sewing_doing', '2026-07-05');
    `);

    docker(["cp", migrationPath, `${containerName}:/tmp/phase1.sql`]);
    docker([
      "exec",
      containerName,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "codex",
      "-d",
      "codex",
      "-f",
      "/tmp/phase1.sql"
    ]);
  }, 120_000);

  afterAll(() => {
    if (containerStarted) docker(["stop", containerName], undefined, true);
  });

  it("keeps a final canonical task and merges completion timestamps and references", () => {
    const task = psql(`
      SELECT "id", "status", "startedAt"::date, "completedAt"::date, "submittedAt"::date,
             "patternMakerId", "note", array_to_string("completedRequirements", ',')
      FROM "PatternTask" WHERE "orderId" = 'merge';
    `).stdout.trim().split("\t");
    expect(task).toEqual([
      "merge-submitted",
      "submitted",
      "2026-06-30",
      "2026-07-03",
      "2026-07-04",
      "maker-submitted",
      "submitted note",
      "pattern_making"
    ]);

    const references = psql(`
      SELECT (SELECT "patternTaskId" FROM "PatternDeliverable" WHERE "id" = 'deliverable'),
             (SELECT "patternTaskId" FROM "SubmittedCuttingVersion" WHERE "id" = 'submission');
    `).stdout.trim().split("\t");
    expect(references).toEqual(["merge-submitted", "merge-submitted"]);

    const completed = psql(`
      SELECT "id", "status", "completedAt"::date, "note"
      FROM "PatternTask" WHERE "orderId" = 'completed';
    `).stdout.trim().split("\t");
    expect(completed).toEqual(["completed-final", "completed", "2026-07-02", "final note"]);
  });

  it("normalizes all in_progress rows and enforces one current task per maker", () => {
    const rows = psql(`
      SELECT "id", "status" FROM "PatternTask"
      WHERE "id" IN ('current-active-old','current-progress-new','current-progress-old','orphan-progress')
      ORDER BY "id";
    `).stdout.trim().split(/\r?\n/).map((row) => row.split("\t"));
    expect(rows).toEqual([
      ["current-active-old", "paused"],
      ["current-progress-new", "active"],
      ["current-progress-old", "paused"],
      ["orphan-progress", "pending"]
    ]);

    const conflict = psql(
      `UPDATE "PatternTask" SET "status" = 'in_progress' WHERE "id" = 'current-active-old';`,
      true
    );
    expect(conflict.status).not.toBe(0);
    expect(conflict.stderr).toMatch(/duplicate key value violates unique constraint/);
  });

  it("backfills comprehensive tasks and repairs physical stages", () => {
    const backfill = psql(`
      SELECT "status", array_to_string("requirements", ',')
      FROM "PatternTask" WHERE "orderId" = 'backfill';
    `).stdout.trim().split("\t");
    expect(backfill).toEqual(["pending", "pattern_revision"]);

    const stages = psql(`
      SELECT "id", "stage" FROM "Order"
      WHERE "id" IN ('stage-route','stage-scan','backfill') ORDER BY "id";
    `).stdout.trim().split(/\r?\n/).map((row) => row.split("\t"));
    expect(stages).toEqual([
      ["backfill", "done"],
      ["stage-route", "cutting_waiting"],
      ["stage-scan", "qc_delivery_waiting"]
    ]);
  });
});
