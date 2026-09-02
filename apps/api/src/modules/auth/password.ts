import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PREFIX = "scrypt";
const KEY_LENGTH = 64;
const DUMMY_PASSWORD_HASH =
  "scrypt$sample-room-login-dummy-v1$ilsXX-CEAfHb4rOeMg0oIJ1uCaqGwpeTMPMozAnyzUXdvvyTbWHusewE2DgYmbEYbjskMcg_jAfKDMSK5SazmA";

export function hashPassword(password: string, salt = randomBytes(16).toString("base64url")) {
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("base64url");
  return `${PREFIX}$${salt}$${hash}`;
}

export function createTemporaryPassword() {
  return randomBytes(18).toString("base64url");
}

export function verifyPassword(password: string, storedHash: string) {
  const [prefix, salt, hash] = storedHash.split("$");
  if (prefix !== PREFIX || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

export function verifyPasswordAgainstDummyHash(password: string) {
  return verifyPassword(password, DUMMY_PASSWORD_HASH);
}
