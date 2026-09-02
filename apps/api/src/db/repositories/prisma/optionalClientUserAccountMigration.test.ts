import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260724100000_optional_client_user_account/migration.sql"
);
const migrationSql = readFileSync(migrationPath, "utf8");
const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");

describe("optional ClientUser Account migration", () => {
  it("drops only the accountId nullability requirement and retains one-account-per-profile uniqueness", () => {
    expect(migrationSql).toContain('ALTER COLUMN "accountId" DROP NOT NULL');
    expect(migrationSql).toContain("ClientUser_accountId_key");
    expect(migrationSql).not.toContain('DROP COLUMN "accountId"');
    expect(migrationSql).not.toContain('DROP CONSTRAINT "ClientUser_accountId_fkey"');
    expect(migrationSql).not.toContain('DROP INDEX "ClientUser_accountId_key"');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "requestedUsername" TEXT');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "requestedPasswordHash" TEXT');
  });

  it("keeps the Prisma relation optional and unique", () => {
    expect(schema).toMatch(/accountId\s+String\?\s+@unique/);
    expect(schema).toMatch(/account\s+Account\?\s+@relation\("ClientUserAccount"/);
    expect(schema).toMatch(/requestedPasswordHash\s+String\?/);
  });
});

const databaseDescribe = process.env.RUN_OPTIONAL_CLIENT_ACCOUNT_MIGRATION_INTEGRATION === "1"
  ? describe
  : describe.skip;

databaseDescribe("optional ClientUser Account migration on PostgreSQL", () => {
  const containerName = `optional-client-account-${randomUUID().slice(0, 12)}`;
  let containerStarted = false;

  function docker(args: string[], input?: string, allowFailure = false) {
    const result = spawnSync("docker", args, {
      encoding: "utf8",
      input,
      maxBuffer: 2 * 1024 * 1024
    });
    if (result.error) throw result.error;
    if (!allowFailure && result.status !== 0) {
      throw new Error(`docker ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
    }
    return result;
  }

  function psql(statement: string, allowFailure = false) {
    return docker([
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
      "-At"
    ], statement, allowFailure);
  }

  beforeAll(async () => {
    docker([
      "run",
      "--rm",
      "--detach",
      "--name",
      containerName,
      "--env",
      "POSTGRES_PASSWORD=codex",
      "--env",
      "POSTGRES_USER=codex",
      "--env",
      "POSTGRES_DB=codex",
      "postgres:17-alpine"
    ]);
    containerStarted = true;
    let ready = false;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      if (psql("SELECT 1", true).status === 0) {
        ready = true;
        break;
      }
      await new Promise((resolveReady) => setTimeout(resolveReady, 250));
    }
    if (!ready) throw new Error("temporary PostgreSQL did not become ready");

    psql(`
      CREATE TABLE "Account" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "ClientUser" (
        "id" TEXT PRIMARY KEY,
        "accountId" TEXT NOT NULL REFERENCES "Account"("id")
      );
      CREATE UNIQUE INDEX "ClientUser_accountId_key" ON "ClientUser"("accountId");
      CREATE TABLE "BusinessUserRequest" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "Order" (
        "id" TEXT PRIMARY KEY,
        "clientUserId" TEXT NOT NULL REFERENCES "ClientUser"("id") ON DELETE RESTRICT
      );
      INSERT INTO "Account" ("id") VALUES ('existing-account');
      INSERT INTO "ClientUser" ("id", "accountId") VALUES ('existing-profile', 'existing-account');
      INSERT INTO "Order" ("id", "clientUserId") VALUES ('historical-order', 'existing-profile');
    `);
    docker(["cp", migrationPath, `${containerName}:/tmp/optional-client-account.sql`]);
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
      "/tmp/optional-client-account.sql"
    ]);
    // Reapplying is safe for interrupted or repeatable deployment validation.
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
      "/tmp/optional-client-account.sql"
    ]);
  }, 60_000);

  afterAll(() => {
    if (containerStarted) docker(["stop", containerName], undefined, true);
  });

  it("allows accountless profiles without changing historical order attribution", () => {
    psql(`INSERT INTO "ClientUser" ("id", "accountId") VALUES ('accountless-profile', NULL);`);
    expect(psql(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ClientUser'
        AND column_name = 'accountId';
    `).stdout.trim()).toBe("YES");
    expect(psql(`SELECT "clientUserId" FROM "Order" WHERE "id" = 'historical-order';`).stdout.trim())
      .toBe("existing-profile");
  });

  it("retains the unique linked-account guard", () => {
    const duplicate = psql(`
      INSERT INTO "ClientUser" ("id", "accountId")
      VALUES ('duplicate-account-profile', 'existing-account');
    `, true);
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain("ClientUser_accountId_key");
  });
});
