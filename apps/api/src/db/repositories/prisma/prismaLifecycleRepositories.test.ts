import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runLifecycleRepositoryContractSuite } from "../contracts/lifecycleRepositoryContractSuite.js";
import { createPrismaLifecycleRepositorySet } from "./prismaLifecycleRepositories.js";

const databaseUrl = process.env.PRISMA_TEST_DATABASE_URL;
const runLifecyclePrismaTests = process.env.RUN_LIFECYCLE_PRISMA_TESTS === "true" && Boolean(databaseUrl);
const testDatabaseUrl = databaseUrl ?? "postgresql://user:pass@localhost:5432/sample_room_lifecycle_test?schema=public";
const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });

if (runLifecyclePrismaTests) {
  runLifecycleRepositoryContractSuite("Prisma lifecycle repository contract", async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "LifecycleJobEvent",
        "MaintenanceLock",
        "LifecycleJob",
        "RecoveryPointArtifact",
        "RecoveryPoint",
        "UpdateArtifact",
        "StorageMigrationPlan"
      CASCADE
    `);
    return createPrismaLifecycleRepositorySet(prisma);
  });

  describe("Prisma lifecycle database constraints", () => {
    it("rejects any MaintenanceLock scope other than the global singleton", async () => {
      await expect(prisma.$executeRaw`
        INSERT INTO "MaintenanceLock" ("scope", "updatedAt")
        VALUES ('not_global', NOW())
      `).rejects.toMatchObject({ code: "P2010" });
    });
  });
} else {
  describe.skip("Prisma lifecycle repository contract (set RUN_LIFECYCLE_PRISMA_TESTS=true)", () => {});
}

afterAll(async () => {
  await prisma.$disconnect();
});
