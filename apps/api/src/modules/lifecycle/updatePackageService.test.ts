import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ROLES } from "@sample-room/shared";
import { createInMemoryLifecycleRepositorySet } from "../../db/repositories/memory/inMemoryLifecycleRepositories.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { UpdatePackageService } from "./updatePackageService.js";

const owner: CurrentUser = { id: "owner", accountId: "owner", role: ROLES.systemOwner, displayName: "System Owner" };
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function uploadFile(originalname = "Deploy-V1.2.0.zip") {
  const root = await mkdtemp(join(tmpdir(), "lcm-06-upload-"));
  roots.push(root);
  const path = join(root, "incoming.upload");
  await writeFile(path, "isolated update package fixture");
  return { root, file: { path, originalname, size: 31 } as Express.Multer.File };
}

describe("UpdatePackageService", () => {
  it("fails closed before registering an uploaded package in the first production version", async () => {
    const repositories = createInMemoryLifecycleRepositorySet();
    const { root, file } = await uploadFile();
    const service = new UpdatePackageService(repositories, { updateRoot: root, currentVersion: "1.0.0", runnerOnline: () => true });
    await expect(service.registerUpload(owner, file)).rejects.toMatchObject({ statusCode: 501, message: "automatic_update_not_available" });
    expect(await repositories.updateArtifacts.list()).toHaveLength(0);
  });

  it("fails closed before queuing apply_update even for a verified artifact", async () => {
    const repositories = createInMemoryLifecycleRepositorySet();
    const service = new UpdatePackageService(repositories, { updateRoot: "D:\\isolated", currentVersion: "1.0.0", runnerOnline: () => true });
    const artifact = await repositories.updateArtifacts.register({
      version: "1.2.0",
      digest: "a".repeat(64),
      manifestSummary: { packageRelativeName: `verified/${"a".repeat(64)}.zip`, title: "Safe update" },
      compatibilityInformation: { compatible: true, currentVersion: "1.0.0" },
      status: "discovered"
    });
    await repositories.updateArtifacts.markVerification({ id: artifact.id, status: "verified", manifestSummary: artifact.manifestSummary, compatibilityInformation: { compatible: true, currentVersion: "1.0.0" } });
    await expect(service.execute(owner, { updateArtifactId: artifact.id, requestReason: "update", idempotencyKey: "update-once" })).rejects.toMatchObject({ statusCode: 501, message: "automatic_update_not_available" });
    expect(await repositories.jobs.list()).toHaveLength(0);
  });
});
