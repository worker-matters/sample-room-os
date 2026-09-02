import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QcEvidenceUploadBatchStore } from "./qcEvidenceUploadBatchStore.js";

describe("QC evidence upload batches", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    ));
  });

  it("keeps the ten-photo limit when uploads arrive concurrently", async () => {
    const root = await mkdtemp(join(tmpdir(), "qc-evidence-batch-test-"));
    temporaryRoots.push(root);
    const store = new QcEvidenceUploadBatchStore(root);
    const context = {
      scanToken: "scan-token",
      userId: "qc-worker",
      action: "complete" as const
    };
    const batch = await store.create(context);
    const results = await Promise.allSettled(Array.from({ length: 11 }, (_unused, index) =>
      store.appendPhoto(batch.id, context, {
        fileName: `photo-${index + 1}.jpg`,
        mimeType: "image/jpeg",
        size: 4,
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9])
      })
    ));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(10);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({ statusCode: 400 })
    });
    expect(await store.attachmentsForCompletion(batch.id, context)).toHaveLength(10);
  });

  it("preserves the approved QC evidence category for mobile upload batches", async () => {
    const root = await mkdtemp(join(tmpdir(), "qc-evidence-batch-test-"));
    temporaryRoots.push(root);
    const store = new QcEvidenceUploadBatchStore(root);
    const context = {
      scanToken: "scan-token",
      userId: "qc-worker",
      action: "complete" as const
    };
    const batch = await store.create(context);

    await store.appendPhoto(batch.id, context, {
      fileName: "measurements.jpg",
      mimeType: "image/jpeg",
      size: 4,
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    }, undefined, "qc_measurement_photo");

    expect(await store.attachmentsForCompletion(batch.id, context)).toEqual([
      expect.objectContaining({
        fileName: "measurements.jpg",
        category: "qc_measurement_photo"
      })
    ]);
  });
});
