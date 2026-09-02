import { describe, expect, it } from "vitest";
import { ROLES } from "@sample-room/shared";
import { FIXED_IDENTITY_ACCOUNTS, FIXED_WORKER_PROFILES } from "../../fixtures/identityFixtures.js";
import {
  InMemoryIdentityStore,
  InMemoryWorkerProfileRepository
} from "./inMemoryIdentityRepositories.js";

describe("identity foundation fixtures", () => {
  it("contains every fixed business and production test identity", () => {
    expect(FIXED_IDENTITY_ACCOUNTS.map((account) => account.role)).toEqual(
      expect.arrayContaining([
        ROLES.systemOwner,
        ROLES.boss,
        ROLES.receiver,
        ROLES.planner,
        ROLES.patternMaker,
        ROLES.clientAdmin,
        ROLES.clientBusinessUser,
        ROLES.worker
      ])
    );
    expect(new Set(FIXED_WORKER_PROFILES.map((profile) => profile.workerType))).toEqual(
      new Set(["cutting", "sewing", "qc_delivery"])
    );
  });

  it("rejects a second active WorkerProfile for one Account", async () => {
    const repository = new InMemoryWorkerProfileRepository(new InMemoryIdentityStore());
    await expect(repository.createWorkerProfile({ accountId: "formal-account-worker-cutting", workerType: "sewing" })).rejects.toThrow("already has an active WorkerProfile");
  });
});
