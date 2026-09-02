import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "prisma/migrations/20260720140000_account_worker_profile_identity_model/migration.sql"),
  "utf8"
);
const archiveSql = readFileSync(
  resolve(process.cwd(), "prisma/migrations/20260720190000_worker_account_archive_and_profile_uniqueness/migration.sql"),
  "utf8"
);
const identityQrFinalizationSql = readFileSync(
  resolve(process.cwd(), "prisma/migrations/20260721100000_remove_role_bind_identity_qr/migration.sql"),
  "utf8"
);

describe("Account and WorkerProfile identity migration", () => {
  it("replaces legacy identity tables with the final foundation tables", () => {
    for (const table of ["Account", "WorkerProfile", "AccountSession", "WechatIdentity", "IdentityQrToken"]) {
      expect(sql).toContain(`\"${table}\"`);
    }
    for (const table of ["AccountDeviceBinding", "DeviceBinding", "WorkerRegistrationLink", "Worker"]) {
      expect(sql).toContain(`DROP TABLE`);
      expect(sql).toContain(`\"${table}\"`);
    }
  });

  it("enforces one active WorkerProfile and worker phone login identifiers", () => {
    expect(sql).toContain("WorkerProfile_one_active_per_account");
    expect(sql).toContain(`WHERE \"status\" = 'active'`);
    expect(sql).toContain("Account_worker_phoneNumber_key");
    expect(sql).toContain("Account_login_identifier_check");
  });

  it("keeps order ScanToken and moves scan actors to Account and WorkerProfile", () => {
    expect(sql).not.toMatch(/DROP TABLE\s+"ScanToken"/);
    expect(sql).toContain(`ADD COLUMN \"actorAccountId\" TEXT NOT NULL`);
    expect(sql).toContain(`ADD COLUMN \"workerProfileId\" TEXT`);
    expect(sql).toContain("ScanRecord_actor_subject_check");
  });

  it("supports logical Account deletion and stable one-per-stage WorkerProfile restoration", () => {
    expect(archiveSql).toContain("ALTER TYPE \"AccountStatus\" ADD VALUE IF NOT EXISTS 'archived'");
    expect(archiveSql).toContain("WorkerProfile_accountId_workerType_key");
    expect(archiveSql).not.toContain("DROP TABLE");
  });

  it("removes ROLE_BIND from the identity QR enum while preserving registration purposes", () => {
    expect(identityQrFinalizationSql).toContain("DELETE FROM \"IdentityQrToken\" WHERE \"purpose\" = 'ROLE_BIND'");
    expect(identityQrFinalizationSql).toContain("'REGISTER_WORKER', 'REGISTER_BUSINESS'");
    expect(identityQrFinalizationSql).not.toContain("'REGISTER_WORKER', 'ROLE_BIND'");
  });
});
