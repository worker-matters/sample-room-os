import { describe, expect, it } from "vitest";
import { ROLES } from "@sample-room/shared";
import { createInMemoryLifecycleRepositorySet } from "../../db/repositories/memory/inMemoryLifecycleRepositories.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { StorageMigrationService } from "./storageMigrationService.js";

const owner: CurrentUser = { id: "owner", accountId: "owner", role: ROLES.systemOwner, displayName: "System Owner" };
const boss: CurrentUser = { id: "boss", accountId: "boss", role: ROLES.boss, displayName: "Boss" };

describe("StorageMigrationService", () => {
  it("keeps overview data but refuses both migration preflight and execution", async () => {
    const repositories = createInMemoryLifecycleRepositorySet();
    const service = new StorageMigrationService(repositories, { dataRoot: "D:\\FactoryData", backupRoot: "E:\\FactoryBackups" });
    await expect(service.overview(owner)).resolves.toMatchObject({
      data: { detailedPath: "D:\\FactoryData" },
      backup: { detailedPath: "E:\\FactoryBackups" }
    });
    await expect(service.preflight(owner, "F:\\NewFactoryData"))
      .rejects.toMatchObject({ statusCode: 501, message: "storage_location_change_not_available" });
    await expect(service.execute(owner, { planId: "retained-future-plan", requestReason: "增加新硬盘", idempotencyKey: "storage-change-1" }))
      .rejects.toMatchObject({ statusCode: 501, message: "storage_location_change_not_available" });
  });

  it("rejects non-system-owner access before reporting the feature as unavailable", async () => {
    const service = new StorageMigrationService(createInMemoryLifecycleRepositorySet(), { dataRoot: "D:\\FactoryData", backupRoot: "E:\\FactoryBackups" });
    await expect(service.overview(boss)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.preflight(boss, "F:\\NewFactoryData")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.execute(boss, { planId: "retained-future-plan", requestReason: "test", idempotencyKey: "test" }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});
