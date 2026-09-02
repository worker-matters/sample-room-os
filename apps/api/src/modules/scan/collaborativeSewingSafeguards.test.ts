import { describe, expect, it } from "vitest";
import { ORDER_STAGES, SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import {
  createClientOrder,
  headers,
  repository,
  request,
  type JsonValue
} from "../receiver/testHelpers.js";

const workerProfileIds = {
  sewing: "formal-worker-profile-sewing",
  sewing_2: "formal-worker-profile-sewing-2",
  sewing_3: "formal-worker-profile-sewing-3",
  qc_delivery: "formal-worker-profile-qc"
} as const;

type WorkerTestIdentity = keyof typeof workerProfileIds;

async function createAcceptedOrder(styleNo: string) {
  const created = await createClientOrder(styleNo);
  const orderId = (created.body.order as JsonValue).id as string;
  const accepted = await request(`/api/receiver/orders/${orderId}/accept`, {
    method: "POST",
    headers: headers("receiver"),
    body: JSON.stringify({
      patternStatus: "none",
      fabricStatus: "complete",
      trimStatus: "complete",
      sampleRequestItems: [SAMPLE_REQUEST_ITEMS.sampleGarment]
    })
  });
  expect(accepted.response.status).toBe(200);
  return orderId;
}

async function scanToken(orderId: string) {
  const result = await request(`/api/receiver/orders/${orderId}/scan-link`, {
    headers: headers("receiver")
  });
  expect(result.response.status).toBe(200);
  return (result.body.scanLink as JsonValue).token as string;
}

function workerHeaders(identity: WorkerTestIdentity) {
  return { "content-type": "application/json", "x-test-scan-identity": identity };
}

async function startSingleSewing(token: string) {
  const started = await request(`/api/scan/${token}/start`, {
    method: "POST",
    headers: workerHeaders("sewing")
  });
  expect(started.response.status).toBe(200);
}

async function completeLegacySingleSewing(token: string, pieces = 3) {
  const completed = await request(`/api/scan/${token}/complete`, {
    method: "POST",
    headers: workerHeaders("sewing"),
    body: JSON.stringify({ workHours: 1, pieces, note: "单人缝制完成" })
  });
  expect(completed.response.status, JSON.stringify(completed.body)).toBe(200);
}

async function joinSecondWorker(token: string) {
  const choice = await request(`/api/scan/${token}`, {
    headers: workerHeaders("sewing_2")
  });
  expect(choice.body.state).toMatchObject({
    allowedAction: "choose_sewing_assignment"
  });
  const collaboration = (choice.body.state as JsonValue).collaboration as JsonValue;
  const joined = await request(`/api/scan/${token}/sewing-collaboration`, {
    method: "POST",
    headers: workerHeaders("sewing_2"),
    body: JSON.stringify({
      expectedCollaborationRevision: collaboration.revision
    })
  });
  expect(joined.response.status, JSON.stringify(joined.body)).toBe(200);
}

async function completeCollaborativeWorker(
  token: string,
  identity: "sewing" | "sewing_2",
  pieces: number
) {
  const state = await request(`/api/scan/${token}`, {
    headers: workerHeaders(identity)
  });
  const collaboration = (state.body.state as JsonValue).collaboration as JsonValue;
  const completed = await request(`/api/scan/${token}/complete`, {
    method: "POST",
    headers: workerHeaders(identity),
    body: JSON.stringify({
      workHours: 1,
      pieces,
      note: `${identity} 完成`,
      expectedParticipationId: collaboration.participationId,
      expectedCollaborationRevision: collaboration.revision
    })
  });
  expect(completed.response.status, JSON.stringify(completed.body)).toBe(200);
}

describe("collaborative sewing final safeguards", () => {
  it("lets a new sewing worker join a pure-single order waiting for its first QC result", async () => {
    const orderId = await createAcceptedOrder("SCAN-SINGLE-WAITING-QC-JOIN");
    const token = await scanToken(orderId);
    await startSingleSewing(token);
    await completeLegacySingleSewing(token);
    expect(await repository.findOrderById(orderId)).toMatchObject({
      stage: ORDER_STAGES.qcDeliveryWaiting
    });

    const waitingQcScan = await request(`/api/scan/${token}`, {
      headers: workerHeaders("sewing_2")
    });
    expect(waitingQcScan.body.state).toMatchObject({
      allowedAction: "join_collaboration",
      collaboration: {
        currentParticipantCount: 1,
        activeParticipantCount: 0
      }
    });
    const collaboration = (waitingQcScan.body.state as JsonValue).collaboration as JsonValue;

    const joined = await request(`/api/scan/${token}/sewing-collaboration`, {
      method: "POST",
      headers: workerHeaders("sewing_2"),
      body: JSON.stringify({
        expectedCollaborationRevision: collaboration.revision
      })
    });
    expect(joined.response.status, JSON.stringify(joined.body)).toBe(200);
    expect(joined.body.state).toMatchObject({
      allowedAction: "complete",
      stage: "sewing",
      collaboration: {
        currentParticipantCount: 2,
        activeParticipantCount: 1
      }
    });
    expect(await repository.findOrderById(orderId)).toMatchObject({
      stage: ORDER_STAGES.sewingDoing
    });
    expect(await repository.listScanRecordsByOrderId(orderId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "sewing",
        action: "start",
        workerProfileId: workerProfileIds.sewing_2,
        collaborationJoin: true
      })
    ]));
  });

  it("locks joining, planning and cancellation after a formal QC rework result", async () => {
    const orderId = await createAcceptedOrder("SCAN-QC-REWORK-LOCKS-SEWING");
    const token = await scanToken(orderId);
    await startSingleSewing(token);
    await joinSecondWorker(token);
    await completeCollaborativeWorker(token, "sewing", 2);
    await completeCollaborativeWorker(token, "sewing_2", 1);
    expect(await repository.findOrderById(orderId)).toMatchObject({
      stage: ORDER_STAGES.qcDeliveryWaiting
    });

    const rework = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("qc_delivery"),
      body: JSON.stringify({
        pieces: 3,
        qualityResult: "rework",
        note: "袖口需要返工"
      })
    });
    expect(rework.response.status, JSON.stringify(rework.body)).toBe(200);
    expect(await repository.findOrderById(orderId)).toMatchObject({
      stage: ORDER_STAGES.qcDeliveryWaiting
    });

    const blockedScan = await request(`/api/scan/${token}`, {
      headers: workerHeaders("sewing_3")
    });
    expect(blockedScan.body.state).toMatchObject({
      allowedAction: "blocked",
      blockedReason: "wrong_stage",
      message: "当前订单待组检"
    });

    const collaboration = await request(
      `/api/planner/orders/${orderId}/sewing-collaboration`,
      { headers: headers("planner") }
    );
    expect(collaboration.response.status).toBe(200);
    const snapshot = collaboration.body.collaboration as JsonValue;
    const participationId = (snapshot.participants as JsonValue[])[0]!.id as string;

    const deniedJoin = await request(`/api/scan/${token}/sewing-collaboration`, {
      method: "POST",
      headers: workerHeaders("sewing_3"),
      body: JSON.stringify({
        expectedCollaborationRevision: snapshot.revision
      })
    });
    expect(deniedJoin.response.status).toBe(409);
    expect(deniedJoin.body.error).toBe("该订单已提交正式组检结果，原缝制轮次已锁定。");

    const deniedTarget = await request(
      `/api/planner/orders/${orderId}/sewing-collaboration/targets`,
      {
        method: "PATCH",
        headers: headers("planner"),
        body: JSON.stringify({
          expectedRevision: snapshot.revision,
          updates: [{ participationId, targetPieces: 1 }]
        })
      }
    );
    expect(deniedTarget.response.status).toBe(409);
    expect(deniedTarget.body.error).toBe("该订单已提交正式组检结果，原缝制轮次已锁定。");

    const deniedCancel = await request(
      `/api/planner/orders/${orderId}/sewing-collaboration/${participationId}/cancel`,
      {
        method: "POST",
        headers: headers("planner"),
        body: JSON.stringify({ expectedRevision: snapshot.revision })
      }
    );
    expect(deniedCancel.response.status).toBe(409);
    expect(deniedCancel.body.error).toBe("该订单已提交正式组检结果，原缝制轮次已锁定。");
  });

  it("keeps participation and stage facts when a manager corrects a positive completion to zero", async () => {
    const orderId = await createAcceptedOrder("SCAN-MANAGER-ZERO-CORRECTION");
    const token = await scanToken(orderId);
    await startSingleSewing(token);
    await joinSecondWorker(token);
    await completeCollaborativeWorker(token, "sewing", 2);

    const firstCompletion = (await repository.listScanRecordsByOrderId(orderId)).find(
      (record) =>
        record.stage === "sewing" &&
        record.action === "complete" &&
        record.workerProfileId === workerProfileIds.sewing
    );
    expect(firstCompletion).toBeDefined();
    const stageBeforeCorrection = (await repository.findOrderById(orderId))?.stage;

    const corrected = await request(
      `/api/admin/performance/orders/${orderId}/scan-records/${firstCompletion!.id}/pieces`,
      {
        method: "PATCH",
        headers: headers("boss", { userId: "boss-zero-correction" }),
        body: JSON.stringify({
          pieces: 0,
          reason: "现场核对后该员工绩效应为 0"
        })
      }
    );
    expect(corrected.response.status, JSON.stringify(corrected.body)).toBe(200);
    expect(await repository.findOrderById(orderId)).toMatchObject({
      stage: stageBeforeCorrection
    });
    expect((await repository.listScanRecordsByOrderId(orderId)).find(
      (record) => record.id === firstCompletion!.id
    )).toMatchObject({ pieces: 2 });

    const collaboration = await request(
      `/api/planner/orders/${orderId}/sewing-collaboration`,
      { headers: headers("planner") }
    );
    expect(collaboration.response.status).toBe(200);
    expect(collaboration.body.collaboration).toMatchObject({
      completedPieces: 0,
      activeParticipantCount: 1,
      participants: expect.arrayContaining([
        expect.objectContaining({
          workerProfileId: workerProfileIds.sewing,
          status: "completed",
          completedPieces: 0
        })
      ])
    });

    const completedWorkerScan = await request(`/api/scan/${token}`, {
      headers: workerHeaders("sewing")
    });
    expect(completedWorkerScan.body.state).toMatchObject({
      allowedAction: "blocked",
      blockedReason: "SEWING_ROUND_ALREADY_COMPLETED"
    });

    await completeCollaborativeWorker(token, "sewing_2", 1);
    expect(await repository.findOrderById(orderId)).toMatchObject({
      stage: ORDER_STAGES.qcDeliveryWaiting
    });
  });
});
