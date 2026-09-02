import { describe, expect, it } from "vitest";
import type { SampleRoomPrismaClient } from "./prismaClient.js";
import { PrismaScanWorkflowRepository } from "./prismaScanWorkflowRepository.js";

function persistedRecord(payload: Record<string, unknown>) {
  return {
    id: "scan-1",
    orderId: "order-1",
    actorAccountId: "account-1",
    workerProfileId: "worker-1",
    actorNameSnapshot: "QC Worker",
    actorType: "production_worker" as const,
    actorRole: "worker" as const,
    action: "qc_delivery_finish" as const,
    stage: "qc_delivery_waiting" as const,
    scannedAt: new Date("2026-08-10T08:00:00.000Z"),
    workHours: null,
    pieces: 3,
    note: null,
    source: "scan",
    payload
  };
}

describe("PrismaScanWorkflowRepository QC measurement photo payload", () => {
  it("writes and reads the new multiple-ID payload", async () => {
    let writtenPayload: Record<string, unknown> | undefined;
    const prisma = {
      scanRecord: {
        create: async ({ data }: { data: { payload: Record<string, unknown> } }) => {
          writtenPayload = data.payload;
          return persistedRecord(data.payload);
        }
      }
    } as unknown as SampleRoomPrismaClient;
    const repository = new PrismaScanWorkflowRepository(prisma);

    const record = await repository.createScanRecord({
      orderId: "order-1",
      actorAccountId: "account-1",
      workerProfileId: "worker-1",
      actorType: "production_worker",
      actorRole: "worker",
      stage: "qc_delivery",
      orderStage: "qc_delivery_waiting",
      action: "complete",
      scanAction: "qc_delivery_finish",
      workerId: "worker-1",
      workerName: "QC Worker",
      pieces: 3,
      qualityResult: "qualified",
      measurementPhotoAttachmentIds: ["measurement-1", "measurement-2"]
    });

    expect(writtenPayload).toMatchObject({
      measurementPhotoAttachmentIds: ["measurement-1", "measurement-2"]
    });
    expect(writtenPayload).not.toHaveProperty("measurementPhotoAttachmentId");
    expect(record.measurementPhotoAttachmentIds).toEqual(["measurement-1", "measurement-2"]);
  });

  it("reads a legacy single-ID payload as a one-element array", async () => {
    const prisma = {
      scanRecord: {
        findMany: async () => [persistedRecord({
          productionStage: "qc_delivery",
          qualityResult: "rework",
          measurementPhotoAttachmentId: "legacy-measurement"
        })]
      }
    } as unknown as SampleRoomPrismaClient;
    const repository = new PrismaScanWorkflowRepository(prisma);

    const [record] = await repository.listScanRecordsByOrderId("order-1");
    expect(record?.measurementPhotoAttachmentIds).toEqual(["legacy-measurement"]);
    expect(record?.measurementPhotoAttachmentId).toBe("legacy-measurement");
  });

});
