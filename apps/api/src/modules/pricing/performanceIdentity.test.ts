import { describe, expect, it } from "vitest";
import { ORDER_STAGES, ROLES } from "@sample-room/shared";
import {
  createReceiverSelfEntry,
  headers,
  identityRepositories,
  repository,
  request,
  type JsonValue
} from "../receiver/testHelpers.js";

const accountId = "formal-account-worker-cutting";
const historicalCuttingProfileId = "formal-worker-profile-cutting";

async function createFormalOrder(styleNo: string) {
  const created = await createReceiverSelfEntry(styleNo);
  expect(created.response.status).toBe(201);
  return (created.body.order as JsonValue).id as string;
}

async function changePositionToSewing() {
  await identityRepositories.workerProfiles.updateWorkerProfile(historicalCuttingProfileId, {
    status: "inactive",
    endedAt: "2026-07-19T00:00:00.000Z"
  });
  return identityRepositories.workerProfiles.createWorkerProfile({
    accountId,
    workerType: "sewing",
    status: "active",
    effectiveAt: "2026-07-19T00:00:01.000Z"
  });
}

async function createProductionCompletion(input: {
  orderId: string;
  workerProfileId: string;
  stage: "cutting" | "sewing";
  eventTime: string;
}) {
  await repository.createScanRecord({
    orderId: input.orderId,
    actorAccountId: accountId,
    workerProfileId: input.workerProfileId,
    actorType: "production_worker",
    actorRole: ROLES.worker,
    workerId: input.workerProfileId,
    workerName: "同一员工",
    stage: input.stage,
    orderStage: input.stage === "cutting" ? ORDER_STAGES.cuttingDoing : ORDER_STAGES.sewingDoing,
    action: "complete",
    scanAction: input.stage === "cutting" ? "cutting_finish" : "sewing_finish",
    eventTime: input.eventTime,
    workHours: 1,
    pieces: 3
  });
}

async function performance(stage: string) {
  return request(
    `/api/admin/performance?dateFrom=2026-07-20&dateTo=2026-07-20&stage=${stage}`,
    { headers: headers("boss") }
  );
}

describe("WorkerProfile performance attribution", () => {
  it("keeps one Account's historical positions in separate performance subjects", async () => {
    const sewingProfile = await changePositionToSewing();
    const cuttingOrderId = await createFormalOrder("PROFILE-HISTORY-CUTTING");
    const sewingOrderId = await createFormalOrder("PROFILE-HISTORY-SEWING");
    await createProductionCompletion({
      orderId: cuttingOrderId,
      workerProfileId: historicalCuttingProfileId,
      stage: "cutting",
      eventTime: "2026-07-20T01:00:00.000Z"
    });
    await createProductionCompletion({
      orderId: sewingOrderId,
      workerProfileId: sewingProfile.id,
      stage: "sewing",
      eventTime: "2026-07-20T02:00:00.000Z"
    });

    const cutting = await performance("cutting");
    const sewing = await performance("sewing");
    expect(cutting.response.status).toBe(200);
    expect(sewing.response.status).toBe(200);
    expect(cutting.body.employees).toEqual([
      expect.objectContaining({
        workerProfileId: historicalCuttingProfileId,
        workerType: "cutting",
        workerProfileStatus: "inactive",
        accountId,
        role: ROLES.worker,
        accountStatus: "active",
        stage: "cutting",
        completedOrders: 1
      })
    ]);
    expect(sewing.body.employees).toEqual([
      expect.objectContaining({
        workerProfileId: sewingProfile.id,
        workerType: "sewing",
        workerProfileStatus: "active",
        accountId,
        stage: "sewing",
        completedOrders: 1
      })
    ]);
    for (const row of [
      ...(cutting.body.employees as JsonValue[]),
      ...(sewing.body.employees as JsonValue[])
    ]) {
      expect(row).not.toHaveProperty("employeeId");
      expect(row).not.toHaveProperty("workerId");
    }
  });

  it("does not rewrite historical performance when a historical WorkerProfile is restored", async () => {
    const sewingProfile = await changePositionToSewing();
    const orderId = await createFormalOrder("PROFILE-RESTORE-HISTORY");
    await createProductionCompletion({
      orderId,
      workerProfileId: historicalCuttingProfileId,
      stage: "cutting",
      eventTime: "2026-07-20T03:00:00.000Z"
    });

    const before = await performance("cutting");
    const restored = await request(
      `/api/workers/${accountId}/worker-profiles/${historicalCuttingProfileId}/restore`,
      {
        method: "POST",
        headers: headers("boss", { userId: "formal-account-boss" })
      }
    );
    const after = await performance("cutting");

    expect(restored.response.status).toBe(200);
    expect(restored.body.workerProfile).toMatchObject({
      id: historicalCuttingProfileId,
      status: "active"
    });
    expect(await identityRepositories.workerProfiles.findWorkerProfileById(sewingProfile.id))
      .toMatchObject({ status: "inactive" });
    expect(after.body.roleSummary).toEqual(before.body.roleSummary);
    expect(after.body.overview).toEqual(before.body.overview);
    expect(after.body.employees).toEqual([
      expect.objectContaining({
        workerProfileId: historicalCuttingProfileId,
        workerType: "cutting",
        workerProfileStatus: "active",
        completedOrders: 1,
        completedPieces: 3
      })
    ]);
  });

  it("attributes pattern performance directly to the pattern-maker Account without a WorkerProfile", async () => {
    const patternMakerAccountId = "formal-account-pattern-maker";
    expect(await identityRepositories.workerProfiles.listWorkerProfilesByAccountId(patternMakerAccountId))
      .toEqual([]);
    const orderId = await createFormalOrder("PATTERN-ACCOUNT-SUBJECT");
    const task = await repository.findPatternTaskByOrderId(orderId) ??
      await repository.createPatternTask({ orderId });
    await repository.updatePatternTask(task.id, {
      status: "completed",
      patternMakerId: patternMakerAccountId,
      patternMakerName: "stale snapshot",
      completedAt: "2026-07-20T04:00:00.000Z"
    });

    const report = await performance("pattern");
    expect(report.response.status).toBe(200);
    expect(report.body.employees).toEqual([
      expect.objectContaining({
        employeeName: "Pattern Maker",
        accountId: patternMakerAccountId,
        role: ROLES.patternMaker,
        accountStatus: "active",
        stage: "pattern",
        completedPatternTasks: 1
      })
    ]);
    expect((report.body.employees as JsonValue[])[0]).not.toHaveProperty("workerProfileId");
    expect((report.body.employees as JsonValue[])[0]).not.toHaveProperty("workerType");
    expect((report.body.employees as JsonValue[])[0]).not.toHaveProperty("employeeId");
  });

  it("attributes receiver performance directly to the receiver Account without a WorkerProfile", async () => {
    const receiverAccountId = "formal-account-receiver";
    expect(await identityRepositories.workerProfiles.listWorkerProfilesByAccountId(receiverAccountId))
      .toEqual([]);
    const orderId = await createFormalOrder("RECEIVER-ACCOUNT-SUBJECT");
    await repository.updateOrder(orderId, {
      receivedBy: receiverAccountId,
      receivedAt: "2026-07-20T05:00:00.000Z"
    });

    const report = await performance("receiver");
    expect(report.response.status).toBe(200);
    expect(report.body.employees).toEqual([
      expect.objectContaining({
        employeeName: "Receiver",
        accountId: receiverAccountId,
        role: ROLES.receiver,
        accountStatus: "active",
        stage: "receiver",
        formalOrders: 1
      })
    ]);
    expect((report.body.employees as JsonValue[])[0]).not.toHaveProperty("workerProfileId");
    expect((report.body.employees as JsonValue[])[0]).not.toHaveProperty("workerType");
    expect((report.body.employees as JsonValue[])[0]).not.toHaveProperty("employeeId");
  });
});
