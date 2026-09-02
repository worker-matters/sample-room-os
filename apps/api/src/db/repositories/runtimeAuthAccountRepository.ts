import type { AuthAccountRepository } from "./authAccountRepository.js";
import { getPersistenceMode } from "./runtimeRepository.js";
import { createInMemoryAuthAccountRepository } from "./memory/inMemoryAuthAccountRepository.js";
import { createPrismaClient } from "./prisma/prismaClient.js";
import { PrismaAuthAccountRepository } from "./prisma/prismaAuthAccountRepository.js";

export function createRuntimeAuthAccountRepository(
  env: NodeJS.ProcessEnv = process.env
): AuthAccountRepository {
  const mode = getPersistenceMode(env);

  if (mode === "memory") {
    return createInMemoryAuthAccountRepository();
  }

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when PERSISTENCE_MODE=prisma.");
  }

  return new PrismaAuthAccountRepository(createPrismaClient());
}
