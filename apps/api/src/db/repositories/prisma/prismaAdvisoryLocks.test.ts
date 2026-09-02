import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { RepositoryContext } from "../contracts/index.js";
import { PrismaPatternWorkflowRepository } from "./prismaPatternWorkflowRepository.js";
import type { SampleRoomPrismaClient } from "./prismaClient.js";
import { createPrismaRepositoryContext } from "./prismaRepositoryContext.js";
import { PrismaSampleRoomRepository } from "./prismaSampleRoomRepository.js";
import { PrismaScanWorkflowRepository } from "./prismaScanWorkflowRepository.js";

function queryText(query: unknown) {
  return (query as { strings: readonly string[] }).strings.join("?");
}

describe("Prisma advisory transaction locks", () => {
  it("casts PostgreSQL's void lock result before Prisma deserializes it", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ lockResult: "" }]);
    const prisma = { $queryRaw: queryRaw } as unknown as SampleRoomPrismaClient;
    const repository = new PrismaSampleRoomRepository(
      {} as RepositoryContext,
      {} as PrismaScanWorkflowRepository,
      {} as PrismaPatternWorkflowRepository,
      prisma
    );

    await repository.lockWorkerForWorkflow("worker-profile-1");
    await repository.lockReconciliationCreation("2026-08-14");

    expect(queryRaw).toHaveBeenCalledTimes(2);
    for (const [query] of queryRaw.mock.calls) {
      expect(queryText(query)).toContain("pg_advisory_xact_lock");
      expect(queryText(query)).toContain('::text AS "lockResult"');
    }
  });
});

const integrationDatabaseUrl = process.env.PRISMA_ADVISORY_LOCK_TEST_DATABASE_URL;
const describeIfDatabase = integrationDatabaseUrl ? describe : describe.skip;

describeIfDatabase("Prisma advisory transaction locks on PostgreSQL", () => {
  const prisma = new PrismaClient({ datasourceUrl: integrationDatabaseUrl! });
  const repository = new PrismaSampleRoomRepository(
    createPrismaRepositoryContext(prisma),
    new PrismaScanWorkflowRepository(prisma),
    new PrismaPatternWorkflowRepository(prisma),
    prisma
  );

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("executes both production lock paths without a Prisma P2010 error", async () => {
    await expect(
      repository.withTransaction(async (transaction) => {
        await transaction.lockWorkerForWorkflow("worker-profile-integration");
        await transaction.lockReconciliationCreation("2026-08-14");
      })
    ).resolves.toBeUndefined();
  });
});
