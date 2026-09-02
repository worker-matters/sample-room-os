import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { ROLES } from "@sample-room/shared";
import { HttpError } from "../../shared/errors/httpError.js";
import { LoginRejectedError } from "./authService.js";
import { LoginProtectionService } from "./loginProtectionService.js";

function request() {
  return {
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    header: () => undefined
  } as unknown as Request;
}

describe("login protection state", () => {
  it("automatically expires an account lock after fifteen minutes", async () => {
    let now = 1_000;
    const protection = new LoginProtectionService(undefined, () => now);
    const payload = { username: "locked@example.test", password: "wrong" };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(protection.execute(request(), "web", payload, async () => {
        throw new LoginRejectedError("password_mismatch", "account-1", ROLES.receiver);
      })).rejects.toMatchObject({ statusCode: 401 });
    }
    await expect(protection.execute(request(), "web", payload, async () => {
      throw new LoginRejectedError("password_mismatch", "account-1", ROLES.receiver);
    })).rejects.toMatchObject({ statusCode: 429 });

    now += 15 * 60 * 1000 + 1;
    await expect(protection.execute(request(), "web", payload, async () => ({
      user: { accountId: "account-1", role: ROLES.receiver }
    }))).resolves.toBeDefined();
  });

  it("preserves service errors instead of converting them to invalid credentials", async () => {
    const protection = new LoginProtectionService();
    const unavailable = new HttpError(503, "database_unavailable");
    await expect(protection.execute(
      request(),
      "miniapp",
      { username: "receiver@example.test", password: "secret" },
      async () => {
        throw unavailable;
      }
    )).rejects.toBe(unavailable);
  });
});
