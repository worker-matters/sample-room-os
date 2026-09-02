import { accessSync, constants, mkdirSync } from "node:fs";
import path from "node:path";

function requireValue(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Production startup requires ${name}.`);
  return value;
}

export function assertProductionRuntimeSafety(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== "production") return;
  if (requireValue(env, "AUTH_MODE") !== "formal") {
    throw new Error("Production startup requires AUTH_MODE=formal.");
  }
  if (requireValue(env, "PERSISTENCE_MODE") !== "prisma") {
    throw new Error("Production startup requires PERSISTENCE_MODE=prisma.");
  }
  requireValue(env, "DATABASE_URL");
  const storageRoot = path.resolve(requireValue(env, "SAMPLE_ROOM_STORAGE_ROOT"));
  mkdirSync(storageRoot, { recursive: true });
  accessSync(storageRoot, constants.R_OK | constants.W_OK);
}

export function configuredUpdateUploadBytes(env: NodeJS.ProcessEnv) {
  const raw = env.SAMPLE_ROOM_UPDATE_MAX_BYTES?.trim();
  if (!raw) return 8 * 1024 * 1024 * 1024;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("SAMPLE_ROOM_UPDATE_MAX_BYTES must be a positive integer.");
  }
  return value;
}
