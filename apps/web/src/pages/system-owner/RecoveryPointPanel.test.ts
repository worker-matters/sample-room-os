import { describe, expect, it } from "vitest";
import { createRecoveryPointIdempotencyKey } from "./RecoveryPointPanel";

describe("RecoveryPointPanel idempotency key compatibility", () => {
  it("uses randomUUID when the browser supports it", () => {
    expect(createRecoveryPointIdempotencyKey({
      randomUUID: () => "browser-random-uuid"
    })).toBe("browser-random-uuid");
  });

  it("falls back to getRandomValues when randomUUID is unavailable", () => {
    const key = createRecoveryPointIdempotencyKey({
      getRandomValues: (values) => {
        values.set([1, 2, 3, 4]);
        return values;
      }
    });

    expect(key).toMatch(/^recovery-point-[a-z0-9]+-00000001000000020000000300000004$/);
  });

  it("still creates a key when the browser exposes no crypto API", () => {
    expect(createRecoveryPointIdempotencyKey({})).toMatch(
      /^recovery-point-[a-z0-9]+-[0-9a-f]{32}$/
    );
  });
});
