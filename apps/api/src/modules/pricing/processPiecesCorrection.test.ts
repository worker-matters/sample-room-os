import { describe, expect, it } from "vitest";
import { ORDER_STAGES } from "@sample-room/shared";
import {
  createReceiverSelfEntry,
  headers,
  repository,
  request,
  type JsonValue
} from "../receiver/testHelpers.js";

async function createOrder(styleNo: string) {
  const created = await createReceiverSelfEntry(styleNo, {
    quantity: 3,
    sampleRequestItems: ["sample_garment"]
  });
  expect(created.response.status).toBe(201);
  return (created.body.order as JsonValue).id as string;
}

async function createCompletion(input: {
  orderId: string;
  stage: "cutting" | "sewing";
  pieces: number;
  workerProfileId: string;
  actorAccountId: string;
}) {
  return repository.createScanRecord({
    orderId: input.orderId,
    stage: input.stage,
    orderStage: input.stage === "cutting" ? ORDER_STAGES.cuttingDoing : ORDER_STAGES.sewingDoing,
    action: "complete",
    scanAction: input.stage === "cutting" ? "cutting_finish" : "sewing_finish",
    workerId: input.workerProfileId,
    workerProfileId: input.workerProfileId,
    actorAccountId: input.actorAccountId,
    workerName: input.stage === "cutting" ? "裁剪员工测试" : "缝制员工测试",
    workHours: 2,
    pieces: input.pieces,
    eventTime: "2026-08-27T10:00:00+08:00"
  });
}

function workerHeaders(input: {
  userId: string;
  workerProfileId: string;
  workerType: "cutting" | "sewing";
}) {
  return {
    ...headers("worker", { userId: input.userId }),
    "x-dev-active-worker-profile-id": input.workerProfileId,
    "x-dev-active-worker-type": input.workerType
  };
}

describe("cutting and sewing piece corrections", () => {
  it("lets a manager correct cutting pieces while preserving the raw scan and exposing an audit log", async () => {
    const orderId = await createOrder("PROCESS-CUTTING-MANAGER");
    const completion = await createCompletion({
      orderId,
      stage: "cutting",
      pieces: 10,
      workerProfileId: "cutting-profile-manager",
      actorAccountId: "cutting-account-manager"
    });

    const corrected = await request(
      `/api/admin/performance/orders/${orderId}/scan-records/${completion.id}/pieces`,
      {
        method: "PATCH",
        headers: headers("boss", { userId: "boss-process-correction" }),
        body: JSON.stringify({ pieces: 5, reason: "录入时多记了件数" })
      }
    );
    expect(corrected.response.status).toBe(200);
    expect(corrected.body.correction).toMatchObject({
      orderId,
      scanRecordId: completion.id,
      stage: "cutting",
      previousPieces: 10,
      pieces: 5,
      changedByRole: "boss"
    });

    const rawRecord = (await repository.listScanRecordsByOrderId(orderId)).find(
      (record) => record.id === completion.id
    );
    expect(rawRecord?.pieces).toBe(10);

    const report = await request(
      "/api/admin/performance?stage=cutting&workerProfileId=cutting-profile-manager&includeOrderDetails=true&dateFrom=2026-08-27&dateTo=2026-08-28",
      { headers: headers("boss") }
    );
    expect(report.response.status).toBe(200);
    expect((report.body.roleSummary as JsonValue).cutting).toEqual({
      completedOrders: 1,
      completedPieces: 5
    });
    expect(report.body.orders).toEqual([
      expect.objectContaining({
        orderId,
        pieces: 5,
        pieceCorrections: [
          expect.objectContaining({
            changedByRole: "boss",
            changedByAccountId: "boss-process-correction",
            oldValue: 10,
            newValue: 5
          })
        ],
        latestCompletion: expect.objectContaining({ recordId: completion.id })
      })
    ]);
  });

  it("rejects a sewing worker correcting their own completion", async () => {
    const orderId = await createOrder("PROCESS-SEWING-SELF");
    const completion = await createCompletion({
      orderId,
      stage: "sewing",
      pieces: 8,
      workerProfileId: "sewing-profile-self",
      actorAccountId: "sewing-account-self"
    });
    const ownHeaders = workerHeaders({
      userId: "sewing-account-self",
      workerProfileId: "sewing-profile-self",
      workerType: "sewing"
    });

    const corrected = await request(
      `/api/miniapp/me/performance/orders/${orderId}/scan-records/${completion.id}/pieces`,
      {
        method: "PATCH",
        headers: ownHeaders,
        body: JSON.stringify({ pieces: 6 })
      }
    );
    expect(corrected.response.status).toBe(403);

    const ownReport = await request(
      "/api/miniapp/me/performance?dateFrom=2026-08-27&dateTo=2026-08-28",
      { headers: ownHeaders }
    );
    expect(ownReport.response.status).toBe(200);
    const records = ownReport.body.records as JsonValue[];
    expect(records).toEqual([
      expect.objectContaining({
        orderId,
        scanRecordId: completion.id,
        pieces: 8
      })
    ]);
    expect(records[0]).not.toHaveProperty("pieceCorrections");
    expect((await repository.listScanRecordsByOrderId(orderId))[0]?.pieces).toBe(8);
  });

  it("rejects a worker correcting another worker's process record", async () => {
    const orderId = await createOrder("PROCESS-SEWING-FORBIDDEN");
    const completion = await createCompletion({
      orderId,
      stage: "sewing",
      pieces: 8,
      workerProfileId: "sewing-profile-owner",
      actorAccountId: "sewing-account-owner"
    });

    const denied = await request(
      `/api/miniapp/me/performance/orders/${orderId}/scan-records/${completion.id}/pieces`,
      {
        method: "PATCH",
        headers: workerHeaders({
          userId: "sewing-account-other",
          workerProfileId: "sewing-profile-other",
          workerType: "sewing"
        }),
        body: JSON.stringify({ pieces: 7 })
      }
    );
    expect(denied.response.status).toBe(403);
    expect((await repository.listScanRecordsByOrderId(orderId))[0]?.pieces).toBe(8);
  });

  it("keeps planner read-only while system owner can correct performance without changing the order stage or raw participation record", async () => {
    const orderId = await createOrder("PROCESS-SEWING-SYSTEM-OWNER");
    const completion = await createCompletion({
      orderId,
      stage: "sewing",
      pieces: 6,
      workerProfileId: "sewing-profile-system-owner",
      actorAccountId: "sewing-account-system-owner"
    });
    const stageBefore = (await repository.findOrderById(orderId))?.stage;

    const plannerDenied = await request(
      `/api/admin/performance/orders/${orderId}/scan-records/${completion.id}/pieces`,
      {
        method: "PATCH",
        headers: headers("planner"),
        body: JSON.stringify({ pieces: 4, reason: "计划员无权更正" })
      }
    );
    expect(plannerDenied.response.status).toBe(403);

    const corrected = await request(
      `/api/admin/performance/orders/${orderId}/scan-records/${completion.id}/pieces`,
      {
        method: "PATCH",
        headers: headers("system_owner", { userId: "system-owner-correction" }),
        body: JSON.stringify({ pieces: 4, reason: "现场核对后更正" })
      }
    );
    expect(corrected.response.status).toBe(200);
    expect(corrected.body.correction).toMatchObject({
      previousPieces: 6,
      pieces: 4,
      changedByRole: "system_owner"
    });
    expect((await repository.findOrderById(orderId))?.stage).toBe(stageBefore);
    expect((await repository.listScanRecordsByOrderId(orderId)).find((record) => record.id === completion.id)).toMatchObject({
      action: "complete",
      pieces: 6
    });
  });

  it("rejects same-value and non-integer corrections", async () => {
    const orderId = await createOrder("PROCESS-CUTTING-VALIDATION");
    const completion = await createCompletion({
      orderId,
      stage: "cutting",
      pieces: 10,
      workerProfileId: "cutting-profile-validation",
      actorAccountId: "cutting-account-validation"
    });

    const unchanged = await request(
      `/api/admin/performance/orders/${orderId}/scan-records/${completion.id}/pieces`,
      {
        method: "PATCH",
        headers: headers("boss"),
        body: JSON.stringify({ pieces: 10, reason: "核对修正" })
      }
    );
    expect(unchanged.response.status).toBe(409);

    const fractional = await request(
      `/api/admin/performance/orders/${orderId}/scan-records/${completion.id}/pieces`,
      {
        method: "PATCH",
        headers: headers("boss"),
        body: JSON.stringify({ pieces: 1.5, reason: "核对修正" })
      }
    );
    expect(fractional.response.status).toBe(400);
  });
});
