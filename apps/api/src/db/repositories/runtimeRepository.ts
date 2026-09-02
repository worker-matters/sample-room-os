import {
  createInMemorySampleRoomRepository,
  type SampleRoomRepository
} from "./sampleRoomRepository.js";
import { createPrismaSampleRoomRepository } from "./prisma/prismaSampleRoomRepository.js";
import type { LifecycleRepositorySet, RepositoryContext } from "./contracts/index.js";
import { createInMemoryLifecycleRepositorySet } from "./memory/inMemoryLifecycleRepositories.js";
import { createInMemoryRepositoryContext } from "./memory/inMemoryRepositoryContext.js";
import { createPrismaClient } from "./prisma/prismaClient.js";
import { createPrismaLifecycleRepositorySet } from "./prisma/prismaLifecycleRepositories.js";
import { createPrismaRepositoryContext } from "./prisma/prismaRepositoryContext.js";

export type PersistenceMode = "memory" | "prisma";

function normalizePersistenceMode(value: string | undefined): PersistenceMode {
  if (!value || value === "memory") {
    return "memory";
  }

  if (value === "prisma") {
    return "prisma";
  }

  throw new Error(`Unsupported PERSISTENCE_MODE "${value}". Use "memory" or "prisma".`);
}

export function getPersistenceMode(env: NodeJS.ProcessEnv = process.env): PersistenceMode {
  return normalizePersistenceMode(env.PERSISTENCE_MODE);
}

export function createRuntimeSampleRoomRepository(
  env: NodeJS.ProcessEnv = process.env
): SampleRoomRepository {
  const mode = getPersistenceMode(env);

  if (mode === "memory") {
    return createInMemorySampleRoomRepository();
  }

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when PERSISTENCE_MODE=prisma.");
  }

  return createPrismaSampleRoomRepository();
}

export function createRuntimeRepositoryContext(
  env: NodeJS.ProcessEnv = process.env
): RepositoryContext {
  const mode = getPersistenceMode(env);
  if (mode === "memory") return createInMemoryRepositoryContext();
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when PERSISTENCE_MODE=prisma.");
  }
  return createPrismaRepositoryContext();
}

export function createRuntimeLifecycleRepositorySet(
  env: NodeJS.ProcessEnv = process.env
): LifecycleRepositorySet {
  const mode = getPersistenceMode(env);
  if (mode === "memory") return createInMemoryLifecycleRepositorySet();
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when PERSISTENCE_MODE=prisma.");
  }
  return createPrismaLifecycleRepositorySet(createPrismaClient());
}
