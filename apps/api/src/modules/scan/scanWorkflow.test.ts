import { describe, expect, it } from "vitest";
import { ORDER_STAGES, SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import { createClientOrder, headers, repository, request, rawRequest, type JsonValue } from "../receiver/testHelpers.js";

async function createAcceptedOrder(styleNo: string, sampleRequestItems: string[]) {
  const created = await createClientOrder(styleNo);
  const orderId = (created.body.order as JsonValue).id as string;
  const accepted = await request(`/api/receiver/orders/${orderId}/accept`, {
    method: "POST",
    headers: headers("receiver"),
    body: JSON.stringify({
      patternStatus: "none",
      fabricStatus: "complete",
      trimStatus: "complete",
      sampleRequestItems
    })
  });
  expect(accepted.response.status).toBe(200);
  return orderId;
}

const workerProfileIds = {
  cutting: "formal-worker-profile-cutting",
  cutting_2: "formal-worker-profile-cutting-2",
  sewing: "formal-worker-profile-sewing",
  sewing_2: "formal-worker-profile-sewing-2",
  sewing_3: "formal-worker-profile-sewing-3",
  qc_delivery: "formal-worker-profile-qc",
  qc_delivery_2: "formal-worker-profile-qc-2"
} as const;

type WorkerTestIdentity = keyof typeof workerProfileIds;

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

describe("parallel physical scan workflow", () => {
  it("lets System Owner use the same order scan-link and scan-record views as boss", async () => {
    const orderId = await createAcceptedOrder("SCAN-SYSTEM-OWNER", [
      SAMPLE_REQUEST_ITEMS.sampleGarment,
      SAMPLE_REQUEST_ITEMS.cutting
    ]);
    const link = await request(`/api/receiver/orders/${orderId}/scan-link`, {
      headers: headers("system_owner")
    });
    const records = await request(`/api/receiver/orders/${orderId}/scan-records`, {
      headers: headers("system_owner")
    });
    expect(link.response.status).toBe(200);
    expect(records.response.status).toBe(200);
  });

  it("keeps one order locator token through termination, completion, and restoration", async () => {
    const orderId = await createAcceptedOrder("SCAN-LONG-LIVED", [
      SAMPLE_REQUEST_ITEMS.sampleGarment,
      SAMPLE_REQUEST_ITEMS.cutting
    ]);
    const firstToken = await scanToken(orderId);

    await repository.updateOrder(orderId, { terminated: true, stage: ORDER_STAGES.done });
    const whileTerminated = await request(`/api/receiver/orders/${orderId}/scan-link`, {
      headers: headers("boss")
    });
    expect((whileTerminated.body.scanLink as JsonValue).token).toBe(firstToken);
    expect((await request(`/api/scan/${firstToken}`, {
      headers: workerHeaders("cutting")
    })).response.status).toBe(200);

    await repository.updateOrder(orderId, { terminated: false, stage: ORDER_STAGES.cuttingWaiting });
    const afterRestore = await request(`/api/receiver/orders/${orderId}/scan-link`, {
      headers: headers("system_owner")
    });
    expect((afterRestore.body.scanLink as JsonValue).token).toBe(firstToken);
  });

  it.each([
    ["cutting", ORDER_STAGES.cuttingWaiting],
    ["sewing", ORDER_STAGES.sewingDoing],
    ["qc_delivery", ORDER_STAGES.qcDeliveryWaiting]
  ] as const)("blocks %s scans before any stage-specific rule when the order is terminated", async (identity, stage) => {
    const orderId = await createAcceptedOrder(`SCAN-TERMINATED-${identity}`, [SAMPLE_REQUEST_ITEMS.sampleGarment]);
    const token = await scanToken(orderId);
    await repository.updateOrder(orderId, { stage, terminated: true });

    const result = await request(`/api/scan/${token}`, { headers: workerHeaders(identity) });
    expect(result.response.status).toBe(200);
    expect(result.body.state).toMatchObject({
      allowedAction: "blocked",
      blockedReason: "terminated",
      message: "订单已终止"
    });
  });

  it.each([
    ["cutting", ORDER_STAGES.sewingWaiting, "当前订单待缝制"],
    ["cutting", ORDER_STAGES.qcDeliveryWaiting, "当前订单待组检"],
    ["sewing", ORDER_STAGES.cuttingWaiting, "当前订单待裁剪"],
    ["sewing", ORDER_STAGES.qcDeliveryWaiting, "当前订单待组检"],
    ["qc_delivery", ORDER_STAGES.cuttingWaiting, "当前订单待裁剪"],
    ["qc_delivery", ORDER_STAGES.sewingWaiting, "当前订单待缝制"]
  ] as const)("tells %s the live order's current stage", async (identity, stage, message) => {
    const orderId = await createAcceptedOrder(`SCAN-WRONG-STAGE-${identity}-${stage}`, [SAMPLE_REQUEST_ITEMS.sampleGarment]);
    const token = await scanToken(orderId);
    await repository.updateOrder(orderId, { stage, terminated: false });

    const result = await request(`/api/scan/${token}`, { headers: workerHeaders(identity) });
    expect(result.body.state).toMatchObject({
      allowedAction: "blocked",
      blockedReason: "wrong_stage",
      message
    });
  });

  it.each([
    ["cutting", ORDER_STAGES.cuttingWaiting],
    ["sewing", ORDER_STAGES.sewingWaiting],
    ["qc_delivery", ORDER_STAGES.qcDeliveryWaiting]
  ] as const)("rejects %s completion if the order is terminated after entry without writing results", async (identity, stage) => {
    const orderId = await createAcceptedOrder(
      `SCAN-STALE-SUBMIT-${identity}`,
      identity === "cutting"
        ? [SAMPLE_REQUEST_ITEMS.sampleGarment, SAMPLE_REQUEST_ITEMS.cutting]
        : [SAMPLE_REQUEST_ITEMS.sampleGarment]
    );
    const token = await scanToken(orderId);
    await repository.updateOrder(orderId, { stage, terminated: false });
    if (identity === "qc_delivery") {
      await repository.createScanRecord({
        orderId,
        actorAccountId: "formal-account-worker-sewing",
        workerProfileId: workerProfileIds.sewing,
        actorType: "production_worker",
        actorRole: "worker",
        workerId: workerProfileIds.sewing,
        workerName: "缝制员工一号",
        stage: "sewing",
        orderStage: ORDER_STAGES.sewingDoing,
        action: "complete",
        scanAction: "sewing_finish",
        workHours: 1,
        pieces: 3
      });
    }
    if (identity === "sewing") {
      expect((await request(`/api/scan/${token}/start`, {
        method: "POST",
        headers: workerHeaders(identity)
      })).response.status).toBe(200);
    } else {
      expect((await request(`/api/scan/${token}`, { headers: workerHeaders(identity) })).body.state)
        .toMatchObject({ allowedAction: "complete" });
    }
    const before = await repository.listScanRecordsByOrderId(orderId);
    await repository.updateOrder(orderId, { terminated: true });

    const rejected = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders(identity),
      body: JSON.stringify({ workHours: 1, pieces: 3, note: "页面打开后提交" })
    });
    expect(rejected.response.status).toBe(409);
    expect(rejected.body).toEqual({ error: "订单已终止" });
    expect(await repository.listScanRecordsByOrderId(orderId)).toEqual(before);
    expect(await repository.findOrderById(orderId)).toMatchObject({
      stage: identity === "sewing" ? ORDER_STAGES.sewingDoing : stage,
      terminated: true
    });
  });

  it("does not expose terminated sewing tasks or retain the canceled termination-complete endpoint", async () => {
    const orderId = await createAcceptedOrder("SCAN-NO-TERMINATION-COMPLETE", [SAMPLE_REQUEST_ITEMS.sampleGarment]);
    const token = await scanToken(orderId);
    await request(`/api/scan/${token}/start`, { method: "POST", headers: workerHeaders("sewing") });
    await repository.updateOrder(orderId, { terminated: true });
    const before = await repository.listScanRecordsByOrderId(orderId);

    const rejected = await request(`/api/scan/${token}/termination-complete`, {
      method: "POST",
      headers: workerHeaders("sewing"),
      body: JSON.stringify({ workHours: 2, pieces: 3, note: "旧入口" })
    });
    expect(rejected.response.status).toBe(404);
    expect(await repository.listScanRecordsByOrderId(orderId)).toEqual(before);
  });

  it("rechecks restoration at submit time and completes sewing normally", async () => {
    const orderId = await createAcceptedOrder("SCAN-RESTORED-BEFORE-SUBMIT", [
      SAMPLE_REQUEST_ITEMS.sampleGarment
    ]);
    const token = await scanToken(orderId);
    await request(`/api/scan/${token}/start`, {
      method: "POST",
      headers: workerHeaders("sewing")
    });
    await request(`/api/admin/orders/${orderId}/terminate`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ reason: "temporary stop" })
    });
    expect((await request(`/api/scan/${token}`, {
      headers: workerHeaders("sewing")
    })).body.state).toMatchObject({ allowedAction: "blocked", message: "订单已终止" });
    const rejected = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("sewing"),
      body: JSON.stringify({ workHours: 2, pieces: 3, note: "待老板恢复" })
    });
    expect(rejected.response.status).toBe(409);
    await request(`/api/admin/orders/${orderId}/restore`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({})
    });
    expect(await repository.findOrderById(orderId)).toMatchObject({
      terminated: false,
      stage: ORDER_STAGES.sewingDoing
    });
    const resumedOwner = await request(`/api/scan/${token}`, { headers: workerHeaders("sewing") });
    expect(resumedOwner.body.state).toMatchObject({ allowedAction: "complete" });
    expect((await repository.listScanRecordsByOrderId(orderId)).find(
      (record) => record.stage === "sewing" && record.action === "start"
    )).toMatchObject({ workerProfileId: workerProfileIds.sewing });

    const completedFromAlreadyOpenForm = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("sewing"),
      body: JSON.stringify({ workHours: 2, pieces: 3, note: "恢复后完成" })
    });
    expect(completedFromAlreadyOpenForm.response.status).toBe(200);
    expect(await repository.findOrderById(orderId)).toMatchObject({
      terminated: false,
      stage: ORDER_STAGES.qcDeliveryWaiting
    });
    expect(await repository.listScanRecordsByOrderId(orderId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "sewing", action: "complete", note: "恢复后完成" })
    ]));
  });

  it("rejects legacy device identity as a scan authentication source", async () => {
    const orderId = await createAcceptedOrder("SCAN-NO-DEVICE-AUTH", [
      SAMPLE_REQUEST_ITEMS.cutting
    ]);
    const token = await scanToken(orderId);
    const result = await request(`/api/scan/${token}`, {
      headers: { "x-worker-device-token": "legacy-device-token" }
    });
    expect(result.response.status).toBe(403);
    expect(result.body).toEqual({ error: "ACCOUNT_INACTIVE" });
  });

  it("runs cutting completion-only, sewing start/complete, and QC completion-only", async () => {
    const orderId = await createAcceptedOrder("SCAN-PHYSICAL", [
      SAMPLE_REQUEST_ITEMS.sampleGarment,
      SAMPLE_REQUEST_ITEMS.cutting
    ]);
    const token = await scanToken(orderId);
    const unboundDevelopmentIdentity = await request(`/api/scan/${token}`);
    expect(unboundDevelopmentIdentity.response.status).toBe(403);
    const cuttingState = await request(`/api/scan/${token}`, {
      headers: workerHeaders("cutting")
    });
    expect(cuttingState.body.state).toMatchObject({
      allowedAction: "complete",
      stage: "cutting",
      order: {
        styleNo: "SCAN-PHYSICAL",
        styleName: "Mock Style SCAN-PHYSICAL",
        customerName: "Mock Active Customer",
        salespersonName: "客户 A 普通业务员",
        quantity: 3
      }
    });
    expect((cuttingState.body.state as JsonValue).order).not.toHaveProperty("quotedPrice");
    expect((cuttingState.body.state as JsonValue).order).not.toHaveProperty("internalCost");
    expect((cuttingState.body.state as JsonValue).order).not.toHaveProperty("profit");
    expect((cuttingState.body.state as JsonValue).order).not.toHaveProperty("stage");
    expect((cuttingState.body.state as JsonValue).order).not.toHaveProperty("sampleType");
    expect((cuttingState.body.state as JsonValue).order).not.toHaveProperty("intakeStatus");
    expect(cuttingState.body.state).not.toHaveProperty("patternTaskWarning");

    const cuttingMissingPieces = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("cutting"),
      body: JSON.stringify({ workHours: 1 })
    });
    expect(cuttingMissingPieces.response.status).toBe(400);

    const cuttingMissingHours = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("cutting"),
      body: JSON.stringify({ pieces: 3 })
    });
    expect(cuttingMissingHours.response.status).toBe(400);

    const cuttingComplete = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("cutting"),
      body: JSON.stringify({ workHours: 1, pieces: 3 })
    });
    expect(cuttingComplete.body.state).toMatchObject({ stage: "sewing" });

    const sewingStarted = await request(`/api/scan/${token}/start`, {
      method: "POST",
      headers: workerHeaders("sewing")
    });
    expect(sewingStarted.body.state).toMatchObject({
      stage: "sewing",
      order: { sampleType: "first_sample", sampleRound: "round_1" }
    });

    const sewingMissingPieces = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("sewing"),
      body: JSON.stringify({ workHours: 2 })
    });
    expect(sewingMissingPieces.response.status).toBe(400);

    const sewingComplete = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("sewing"),
      body: JSON.stringify({ workHours: 2, pieces: 3 })
    });
    expect(sewingComplete.body.state).toMatchObject({ stage: "qc_delivery" });

    const missingEvidence = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("qc_delivery"),
      body: JSON.stringify({ qualityResult: "qualified" })
    });
    expect(missingEvidence.response.status).toBe(400);

    const missingScoreForm = new FormData();
    missingScoreForm.append("qualityResult", "qualified");
    missingScoreForm.append("pieces", "3");
    missingScoreForm.append("files", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "sample.jpg");
    const missingScore = await rawRequest(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: { "x-test-scan-identity": "qc_delivery" },
      body: missingScoreForm
    });
    expect(missingScore.status).toBe(400);

    const missingReceivedPiecesForm = new FormData();
    missingReceivedPiecesForm.append("qualityResult", "qualified");
    missingReceivedPiecesForm.append("qualityScore", "92");
    missingReceivedPiecesForm.append("files", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "sample.jpg");
    const missingReceivedPieces = await rawRequest(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: { "x-test-scan-identity": "qc_delivery" },
      body: missingReceivedPiecesForm
    });
    expect(missingReceivedPieces.status).toBe(400);

    const form = new FormData();
    form.append("qualityResult", "qualified");
    form.append("qualityScore", "92");
    form.append("pieces", "3");
    form.append("category", "qc_evidence");
    form.append("category", "qc_measurement_photo");
    form.append("category", "qc_measurement_photo");
    form.append("files", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "sample.jpg");
    form.append("files", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "measurement-front.jpg");
    form.append("files", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "measurement-back.jpg");
    const qcComplete = await rawRequest(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: { "x-test-scan-identity": "qc_delivery" },
      body: form
    });
    expect(qcComplete.status).toBe(200);
    const qcBody = (await qcComplete.json()) as JsonValue;
    expect(qcBody.state).toMatchObject({ stage: null, blockedReason: "done" });

    const records = await request(`/api/receiver/orders/${orderId}/scan-records`, {
      headers: headers("receiver")
    });
    const qcRecord = (records.body.records as JsonValue[]).find(
      (record) => record.stage === "qc_delivery"
    )!;
    expect(qcRecord).toMatchObject({ qualityResult: "qualified", qualityScore: 92, pieces: 3 });
    expect(qcRecord).not.toHaveProperty("workHours");
    expect(qcRecord.samplePhotoAttachmentIds).toHaveLength(1);
    expect(qcRecord.measurementPhotoAttachmentIds).toHaveLength(2);
    expect(qcRecord).not.toHaveProperty("measurementPhotoAttachmentId");
    expect(await repository.listOrderAttachments(orderId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "qc_sample_photo", visibility: "internal_only" }),
        expect.objectContaining({ fileName: "measurement-front.jpg", category: "qc_measurement_photo", visibility: "internal_only" }),
        expect.objectContaining({ fileName: "measurement-back.jpg", category: "qc_measurement_photo", visibility: "internal_only" })
      ])
    );
    const sampleAttachmentId = (qcRecord.samplePhotoAttachmentIds as string[])[0]!;
    const deniedDelete = await request(`/api/scan/${token}/attachments/${sampleAttachmentId}`, {
      method: "DELETE",
      headers: workerHeaders("qc_delivery_2")
    });
    expect(deniedDelete.response.status).toBe(403);
    const ownDelete = await request(`/api/scan/${token}/attachments/${sampleAttachmentId}`, {
      method: "DELETE",
      headers: workerHeaders("qc_delivery")
    });
    expect(ownDelete.response.status).toBe(200);
    expect((await repository.listOrderAttachments(orderId)).some((item) => item.id === sampleAttachmentId)).toBe(false);
    expect(await repository.listAttachmentAuditLogs(orderId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "upload", originalUploaderRole: "worker" }),
        expect.objectContaining({ action: "delete", actorId: workerProfileIds.qc_delivery, originalFileName: "sample.jpg" })
      ])
    );
  });

  it("keeps QC rework history and reserves reinspection for the original QC worker", async () => {
    const orderId = await createAcceptedOrder("SCAN-QC-REWORK-CLOSED-LOOP", [SAMPLE_REQUEST_ITEMS.sampleGarment]);
    await repository.updateOrder(orderId, { stage: "qc_delivery_waiting" });
    await repository.createScanRecord({
      orderId,
      stage: "sewing",
      orderStage: "qc_delivery_waiting",
      action: "complete",
      scanAction: "sewing_finish",
      workerId: "seed-sewer",
      workerName: "Seed Sewer",
      workHours: 1,
      pieces: 3
    });
    const token = await scanToken(orderId);

    const [firstQcOpen, secondQcOpen] = await Promise.all([
      request(`/api/scan/${token}`, { headers: workerHeaders("qc_delivery") }),
      request(`/api/scan/${token}`, { headers: workerHeaders("qc_delivery_2") })
    ]);
    expect((firstQcOpen.body.state as JsonValue).allowedAction).toBe("complete");
    expect((secondQcOpen.body.state as JsonValue).allowedAction).toBe("complete");
    expect((await repository.listScanRecordsByOrderId(orderId)).filter((record) => record.stage === "qc_delivery")).toHaveLength(0);

    const ordinaryWaiting = await request("/api/receiver/orders", {
      headers: headers("receiver")
    });
    expect((ordinaryWaiting.body.orders as Array<Record<string, unknown>>).find(
      (order) => order.id === orderId
    )).toMatchObject({
      stage: ORDER_STAGES.qcDeliveryWaiting,
      stageLabel: "待组检/出库"
    });

    const reworkForm = new FormData();
    reworkForm.append("qualityResult", "rework");
    reworkForm.append("pieces", "3");
    reworkForm.append("note", "袖口车线需要返工");
    const rework = await rawRequest(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: { "x-test-scan-identity": "qc_delivery" },
      body: reworkForm
    });
    expect(rework.status).toBe(200);
    expect(await repository.findOrderById(orderId)).toMatchObject({
      stage: ORDER_STAGES.qcDeliveryWaiting
    });
    const reworkRecord = (await repository.listScanRecordsByOrderId(orderId)).filter(
      (record) => record.stage === "qc_delivery" && record.action === "complete"
    ).at(-1)!;
    expect(reworkRecord).toMatchObject({
      workerProfileId: workerProfileIds.qc_delivery,
      qualityResult: "rework"
    });
    expect(reworkRecord).not.toHaveProperty("qualityScore");
    expect(reworkRecord.samplePhotoAttachmentIds).toEqual([]);

    const reworkWaiting = await request("/api/receiver/orders", {
      headers: headers("receiver")
    });
    expect((reworkWaiting.body.orders as Array<Record<string, unknown>>).find(
      (order) => order.id === orderId
    )).toMatchObject({
      stage: ORDER_STAGES.qcDeliveryWaiting,
      stageLabel: "待返工"
    });

    const otherQcState = await request(`/api/scan/${token}`, {
      headers: workerHeaders("qc_delivery_2")
    });
    expect(otherQcState.body.state).toMatchObject({
      allowedAction: "blocked",
      message: "该订单正在由原组检员工跟进返工复检。"
    });
    const otherQcSubmit = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("qc_delivery_2"),
      body: JSON.stringify({ qualityResult: "qualified", qualityScore: 96, pieces: 3 })
    });
    expect(otherQcSubmit.response.status).toBe(409);

    const qualifiedForm = new FormData();
    qualifiedForm.append("qualityResult", "qualified");
    qualifiedForm.append("qualityScore", "96");
    qualifiedForm.append("pieces", "3");
    qualifiedForm.append("files", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "qualified.jpg");
    const qualified = await rawRequest(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: { "x-test-scan-identity": "qc_delivery" },
      body: qualifiedForm
    });
    expect(qualified.status).toBe(200);
    expect(await repository.findOrderById(orderId)).toMatchObject({ stage: ORDER_STAGES.done });

    const qcRecords = (await repository.listScanRecordsByOrderId(orderId)).filter(
      (record) => record.stage === "qc_delivery" && record.action === "complete"
    );
    expect(qcRecords).toHaveLength(2);
    expect(qcRecords.map((record) => record.qualityResult)).toEqual(["rework", "qualified"]);
    expect(await repository.listOrderAttachments(orderId)).toEqual([
      expect.objectContaining({ category: "qc_sample_photo", visibility: "internal_only" })
    ]);

    const completed = await request("/api/receiver/orders", {
      headers: headers("receiver")
    });
    expect((completed.body.orders as Array<Record<string, unknown>>).find(
      (order) => order.id === orderId
    )).toMatchObject({ stage: ORDER_STAGES.done, stageLabel: "已完成" });
  });

  it("validates qualified and rework QC submissions without enabling rejected", async () => {
    const orderId = await createAcceptedOrder("SCAN-QC-VALIDATION", [SAMPLE_REQUEST_ITEMS.sampleGarment]);
    await repository.updateOrder(orderId, { stage: ORDER_STAGES.qcDeliveryWaiting });
    await repository.createScanRecord({
      orderId,
      stage: "sewing",
      orderStage: ORDER_STAGES.sewingDoing,
      action: "complete",
      scanAction: "sewing_finish",
      workerId: "seed-sewer",
      workerName: "Seed Sewer",
      workHours: 1,
      pieces: 3
    });
    const token = await scanToken(orderId);
    const image = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });

    const submit = async (
      fields: Record<string, string>,
      includePhoto = true
    ) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      if (includePhoto) form.append("files", image(), "qc.jpg");
      return rawRequest(`/api/scan/${token}/complete`, {
        method: "POST",
        headers: { "x-test-scan-identity": "qc_delivery" },
        body: form
      });
    };

    expect((await submit({ qualityResult: "qualified", pieces: "3" })).status).toBe(400);
    expect((await submit({ qualityResult: "qualified", qualityScore: "90", pieces: "3" }, false)).status).toBe(400);
    expect((await submit({ qualityResult: "rework", qualityScore: "70", pieces: "3", note: "返工" })).status).toBe(400);
    expect((await submit({ qualityResult: "rework", pieces: "3" })).status).toBe(400);
    expect((await submit({ qualityResult: "rejected", qualityScore: "70", pieces: "3", note: "拒收" })).status).toBe(400);
    expect((await repository.listScanRecordsByOrderId(orderId)).filter(
      (record) => record.stage === "qc_delivery"
    )).toHaveLength(0);
  });

  it("stages categorized mobile QC photos and completes the order only after final confirmation", async () => {
    const orderId = await createAcceptedOrder("SCAN-QC-MULTI-PHOTO", [
      SAMPLE_REQUEST_ITEMS.sampleGarment
    ]);
    await repository.updateOrder(orderId, { stage: "qc_delivery_waiting" });
    await repository.createScanRecord({
      orderId,
      stage: "sewing",
      orderStage: "qc_delivery_waiting",
      action: "complete",
      scanAction: "sewing_finish",
      workerId: "seed-sewer",
      workerName: "Seed Sewer",
      workHours: 1,
      pieces: 3
    });
    const token = await scanToken(orderId);
    const created = await request(`/api/scan/${token}/qc-evidence-batches`, {
      method: "POST",
      headers: workerHeaders("qc_delivery"),
      body: JSON.stringify({ action: "complete" })
    });
    expect(created.response.status).toBe(201);
    const batchId = created.body.batchId as string;
    expect(created.body).toMatchObject({ maxFiles: 10 });

    const deniedPhoto = new FormData();
    deniedPhoto.append(
      "files",
      new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }),
      "denied.jpg"
    );
    const denied = await rawRequest(
      `/api/scan/${token}/qc-evidence-batches/${batchId}/files`,
      {
        method: "POST",
        headers: { "x-test-scan-identity": "qc_delivery_2" },
        body: deniedPhoto
      }
    );
    expect(denied.status).toBe(403);

    for (const [fileName, displayName, category] of [
      ["front.jpg", "样衣正面", "qc_sample_photo"],
      ["measurements.jpg", "尺寸表", "qc_measurement_photo"]
    ] as const) {
      const photo = new FormData();
      photo.append("displayName", displayName);
      photo.append("category", category);
      photo.append(
        "files",
        new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }),
        fileName
      );
      const uploaded = await rawRequest(
        `/api/scan/${token}/qc-evidence-batches/${batchId}/files`,
        {
          method: "POST",
          headers: { "x-test-scan-identity": "qc_delivery" },
          body: photo
        }
      );
      expect(uploaded.status).toBe(201);
    }

    expect(await repository.findOrderById(orderId)).toMatchObject({
      stage: "qc_delivery_waiting"
    });
    expect(await repository.listOrderAttachments(orderId)).toEqual([]);

    const completed = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("qc_delivery"),
      body: JSON.stringify({
        pieces: 3,
        qualityScore: 95,
        qualityResult: "qualified",
        note: "",
        qcEvidenceBatchId: batchId
      })
    });
    expect(completed.response.status).toBe(200);
    expect(completed.body.state).toMatchObject({ stage: null, blockedReason: "done" });
    expect(await repository.listOrderAttachments(orderId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: "样衣正面.jpg", category: "qc_sample_photo" }),
      expect.objectContaining({ fileName: "尺寸表.jpg", category: "qc_measurement_photo" })
    ]));

    const records = await request(`/api/receiver/orders/${orderId}/scan-records`, {
      headers: headers("receiver")
    });
    const qcRecord = (records.body.records as JsonValue[]).find(
      (record) => record.stage === "qc_delivery"
    )!;
    expect(qcRecord.samplePhotoAttachmentIds).toHaveLength(1);
    expect(qcRecord.measurementPhotoAttachmentIds).toHaveLength(1);
  });

  it("skips cutting for sample-only routes and finishes cutting-only routes", async () => {
    const sampleOnlyId = await createAcceptedOrder("SCAN-SAMPLE-ONLY", [SAMPLE_REQUEST_ITEMS.sampleGarment]);
    expect(await repository.findOrderById(sampleOnlyId)).toMatchObject({ stage: "sewing_waiting" });

    const cuttingOnlyId = await createAcceptedOrder("SCAN-CUTTING-ONLY", [SAMPLE_REQUEST_ITEMS.cutting]);
    const token = await scanToken(cuttingOnlyId);
    const completed = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("cutting"),
      body: JSON.stringify({ workHours: 1, pieces: 3, note: "裁剪完成" })
    });
    expect(completed.body.state).toMatchObject({ stage: null, blockedReason: "done" });
  });

  it("rejects a scan when the stored stage is not part of the order production route", async () => {
    const orderId = await createAcceptedOrder("SCAN-ROUTE-PERMISSION", [
      SAMPLE_REQUEST_ITEMS.cutting
    ]);
    await repository.updateOrder(orderId, { stage: "sewing_waiting" });
    const token = await scanToken(orderId);
    const state = await request(`/api/scan/${token}`, {
      headers: workerHeaders("sewing")
    });

    expect(state.body.state).toMatchObject({
      allowedAction: "blocked",
      blockedReason: "workflow_invalid",
      stage: "sewing"
    });
  });

  it("blocks the first physical action until a required making result is uploaded", async () => {
    const orderId = await createAcceptedOrder("SCAN-PATTERN-WARNING", [
      SAMPLE_REQUEST_ITEMS.cutting,
      SAMPLE_REQUEST_ITEMS.patternMaking
    ]);
    const token = await scanToken(orderId);
    const state = await request(`/api/scan/${token}`, {
      headers: workerHeaders("cutting")
    });
    expect(state.body.state).toMatchObject({
      allowedAction: "blocked",
      patternTaskWarning: {
        unclaimed: true,
        unfinishedRequirements: [SAMPLE_REQUEST_ITEMS.patternMaking]
      }
    });
  });

  it("rechecks the pattern gate when a corrupted stored stage points at cutting", async () => {
    const orderId = await createAcceptedOrder("SCAN-PATTERN-CORRUPT-CUTTING", [
      SAMPLE_REQUEST_ITEMS.patternMaking,
      SAMPLE_REQUEST_ITEMS.cutting
    ]);
    await repository.updateOrder(orderId, { stage: ORDER_STAGES.cuttingWaiting });
    const token = await scanToken(orderId);
    const state = await request(`/api/scan/${token}`, {
      headers: workerHeaders("cutting")
    });
    expect(state.body.state).toMatchObject({
      allowedAction: "blocked",
      blockedReason: "workflow_invalid",
      stage: "cutting"
    });

    const completed = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("cutting"),
      body: JSON.stringify({ workHours: 1, pieces: 3, note: "must stay blocked" })
    });
    expect(completed.response.status).toBe(409);
    expect(await repository.findOrderById(orderId)).toMatchObject({
      stage: ORDER_STAGES.cuttingWaiting
    });
  });

  it("rechecks the pattern gate before a sewing start transaction", async () => {
    const orderId = await createAcceptedOrder("SCAN-PATTERN-CORRUPT-SEWING", [
      SAMPLE_REQUEST_ITEMS.patternMaking,
      SAMPLE_REQUEST_ITEMS.sampleGarment
    ]);
    await repository.updateOrder(orderId, { stage: ORDER_STAGES.sewingWaiting });
    const token = await scanToken(orderId);
    const started = await request(`/api/scan/${token}/start`, {
      method: "POST",
      headers: workerHeaders("sewing")
    });
    expect(started.response.status).toBe(409);
    expect(await repository.listScanRecordsByOrderId(orderId)).toHaveLength(0);
  });

  it("allows exactly one concurrent first sewing start", async () => {
    const orderId = await createAcceptedOrder("SCAN-CONCURRENT-START", [SAMPLE_REQUEST_ITEMS.sampleGarment]);
    const token = await scanToken(orderId);
    const responses = await Promise.all([
      rawRequest(`/api/scan/${token}/start`, { method: "POST", headers: workerHeaders("sewing") }),
      rawRequest(`/api/scan/${token}/start`, { method: "POST", headers: workerHeaders("sewing_2") })
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const records = await repository.listScanRecordsByOrderId(orderId);
    expect(records.filter((record) => record.stage === "sewing" && record.action === "start")).toHaveLength(1);
  });

  it("offers replace or collaboration without worker target claims and completes when all participants resolve", async () => {
    const orderId = await createAcceptedOrder("SCAN-SEWING-COLLABORATION", [SAMPLE_REQUEST_ITEMS.sampleGarment]);
    const token = await scanToken(orderId);
    await request(`/api/scan/${token}/start`, {
      method: "POST",
      headers: workerHeaders("sewing")
    });

    const secondScan = await request(`/api/scan/${token}`, {
      headers: workerHeaders("sewing_2")
    });
    expect(secondScan.body.state).toMatchObject({
      allowedAction: "choose_sewing_assignment",
      collaboration: {
        currentParticipantCount: 1,
        expectedActiveWorkerIds: [workerProfileIds.sewing]
      }
    });
    const secondScanCollaboration = (secondScan.body.state as JsonValue).collaboration as JsonValue;

    const joined = await request(`/api/scan/${token}/sewing-collaboration`, {
      method: "POST",
      headers: workerHeaders("sewing_2"),
      body: JSON.stringify({
        expectedCollaborationRevision: secondScanCollaboration.revision
      })
    });
    expect(joined.response.status).toBe(200);
    expect(joined.body.state).toMatchObject({
      allowedAction: "complete",
      collaboration: {
        currentParticipantCount: 2,
        plannedPieces: 0,
        unallocatedPieces: 3
      }
    });

    const firstParticipation = (await repository.listScanRecordsByOrderId(orderId))
      .find((record) => record.stage === "sewing" && record.action === "start" && record.workerProfileId === workerProfileIds.sewing)!;
    const beforePlanChange = await request(`/api/planner/orders/${orderId}/sewing-collaboration`, {
      headers: headers("planner")
    });
    const advisoryPlanChange = await request(
      `/api/planner/orders/${orderId}/sewing-collaboration/targets`,
      {
        method: "PATCH",
        headers: headers("planner"),
        body: JSON.stringify({
          expectedRevision: (beforePlanChange.body.collaboration as JsonValue).revision,
          updates: [{ participationId: firstParticipation.id, targetPieces: 1 }]
        })
      }
    );
    expect(advisoryPlanChange.response.status).toBe(200);
    const allocation = await request(`/api/planner/orders/${orderId}/sewing-collaboration`, {
      headers: headers("planner")
    });
    expect(allocation.body.collaboration).toMatchObject({
      plannedPieces: 1,
      unallocatedPieces: 2,
      sewingGateSatisfied: false
    });

    const staleJoin = await request(`/api/scan/${token}/sewing-collaboration`, {
      method: "POST",
      headers: workerHeaders("sewing_3"),
      body: JSON.stringify({
        targetPieces: 1,
        expectedCollaborationRevision: secondScanCollaboration.revision
      })
    });
    expect(staleJoin.response.status).toBe(409);
    expect(staleJoin.body.error).toBe("协作人员或分配已经变化，请刷新后重新确认。");

    const firstState = await request(`/api/scan/${token}`, { headers: workerHeaders("sewing") });
    const firstCollaboration = (firstState.body.state as JsonValue).collaboration as JsonValue;
    const firstCompletion = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("sewing"),
      body: JSON.stringify({
        workHours: 1,
        pieces: 2,
        note: "首位协作者完成",
        expectedParticipationId: firstCollaboration.participationId,
        expectedCollaborationRevision: firstCollaboration.revision
      })
    });
    expect(firstCompletion.response.status, JSON.stringify(firstCompletion.body)).toBe(200);
    expect(await repository.findOrderById(orderId)).toMatchObject({ stage: ORDER_STAGES.sewingDoing });

    const completedWorkerScan = await request(`/api/scan/${token}`, {
      headers: workerHeaders("sewing")
    });
    expect(completedWorkerScan.body.state).toMatchObject({
      allowedAction: "blocked",
      blockedReason: "SEWING_ROUND_ALREADY_COMPLETED",
      message: expect.stringContaining("你已完成本轮缝制")
    });
    const completedWorkerCollaboration = (completedWorkerScan.body.state as JsonValue).collaboration as JsonValue;
    const duplicateJoin = await request(`/api/scan/${token}/sewing-collaboration`, {
      method: "POST",
      headers: workerHeaders("sewing"),
      body: JSON.stringify({ expectedCollaborationRevision: completedWorkerCollaboration.revision })
    });
    expect(duplicateJoin.response.status).toBe(409);
    expect(duplicateJoin.body.error).toBe("你已完成本轮缝制，不能重复加入。");

    const duplicateCompletion = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("sewing"),
      body: JSON.stringify({
        workHours: 1,
        pieces: 2,
        expectedParticipationId: firstCollaboration.participationId,
        expectedCollaborationRevision: firstCollaboration.revision
      })
    });
    expect(duplicateCompletion.response.status).toBe(409);
    expect(duplicateCompletion.body.error).toBe("本轮缝制已经提交完成，请勿重复提交。");
    expect((await repository.listScanRecordsByOrderId(orderId)).filter(
      (record) => record.stage === "sewing" && record.action === "complete" &&
        record.workerProfileId === workerProfileIds.sewing
    )).toHaveLength(1);

    const afterFirstCompletion = await request(`/api/planner/orders/${orderId}/sewing-collaboration`, {
      headers: headers("planner")
    });
    const cancelCompleted = await request(
      `/api/planner/orders/${orderId}/sewing-collaboration/${firstParticipation.id}/cancel`,
      {
        method: "POST",
        headers: headers("planner"),
        body: JSON.stringify({ expectedRevision: (afterFirstCompletion.body.collaboration as JsonValue).revision })
      }
    );
    expect(cancelCompleted.response.status).toBe(409);
    expect(cancelCompleted.body.error).toContain("已经提交完成");

    const secondState = await request(`/api/scan/${token}`, { headers: workerHeaders("sewing_2") });
    expect(secondState.body.state, JSON.stringify(secondState.body)).toHaveProperty("collaboration");
    const secondCollaboration = (secondState.body.state as JsonValue).collaboration as JsonValue;
    const secondCompletion = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("sewing_2"),
      body: JSON.stringify({
        workHours: 1,
        pieces: 2,
        note: "第二位协作者完成",
        expectedParticipationId: secondCollaboration.participationId,
        expectedCollaborationRevision: secondCollaboration.revision
      })
    });
    expect(secondCompletion.response.status).toBe(200);
    expect(await repository.findOrderById(orderId)).toMatchObject({ stage: ORDER_STAGES.qcDeliveryWaiting });

    const waitingQcScan = await request(`/api/scan/${token}`, { headers: workerHeaders("sewing_3") });
    expect(waitingQcScan.body.state).toMatchObject({ allowedAction: "join_collaboration" });
    const waitingQcCollaboration = (waitingQcScan.body.state as JsonValue).collaboration as JsonValue;
    const resumed = await request(`/api/scan/${token}/sewing-collaboration`, {
      method: "POST",
      headers: workerHeaders("sewing_3"),
      body: JSON.stringify({ expectedCollaborationRevision: waitingQcCollaboration.revision })
    });
    expect(resumed.response.status).toBe(200);
    expect(await repository.findOrderById(orderId)).toMatchObject({ stage: ORDER_STAGES.sewingDoing });
  });

  it("allows only one of two concurrent collaborative sewing completion submissions", async () => {
    const orderId = await createAcceptedOrder("SCAN-SEWING-COLLABORATION-CONCURRENT-COMPLETE", [SAMPLE_REQUEST_ITEMS.sampleGarment]);
    const token = await scanToken(orderId);
    await request(`/api/scan/${token}/start`, {
      method: "POST",
      headers: workerHeaders("sewing")
    });
    const secondScan = await request(`/api/scan/${token}`, {
      headers: workerHeaders("sewing_2")
    });
    const secondScanCollaboration = (secondScan.body.state as JsonValue).collaboration as JsonValue;
    await request(`/api/scan/${token}/sewing-collaboration`, {
      method: "POST",
      headers: workerHeaders("sewing_2"),
      body: JSON.stringify({ expectedCollaborationRevision: secondScanCollaboration.revision })
    });
    const firstState = await request(`/api/scan/${token}`, {
      headers: workerHeaders("sewing")
    });
    const firstCollaboration = (firstState.body.state as JsonValue).collaboration as JsonValue;
    const body = JSON.stringify({
      workHours: 1,
      pieces: 3,
      expectedParticipationId: firstCollaboration.participationId,
      expectedCollaborationRevision: firstCollaboration.revision
    });

    const responses = await Promise.all([
      rawRequest(`/api/scan/${token}/complete`, { method: "POST", headers: workerHeaders("sewing"), body }),
      rawRequest(`/api/scan/${token}/complete`, { method: "POST", headers: workerHeaders("sewing"), body })
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await repository.listScanRecordsByOrderId(orderId)).filter(
      (record) => record.stage === "sewing" && record.action === "complete" &&
        record.workerProfileId === workerProfileIds.sewing
    )).toHaveLength(1);
  });

  it("naturally returns to single mode when the planner cancels the only collaborator", async () => {
    const orderId = await createAcceptedOrder("SCAN-SEWING-COLLABORATOR-CANCEL", [SAMPLE_REQUEST_ITEMS.sampleGarment]);
    const token = await scanToken(orderId);
    await request(`/api/scan/${token}/start`, {
      method: "POST",
      headers: workerHeaders("sewing")
    });
    const collaborationChoice = await request(`/api/scan/${token}`, {
      headers: workerHeaders("sewing_2")
    });
    const choiceCollaboration = (collaborationChoice.body.state as JsonValue).collaboration as JsonValue;
    await request(`/api/scan/${token}/sewing-collaboration`, {
      method: "POST",
      headers: workerHeaders("sewing_2"),
      body: JSON.stringify({
        targetPieces: 1,
        expectedCollaborationRevision: choiceCollaboration.revision
      })
    });
    const collaborator = (await repository.listScanRecordsByOrderId(orderId))
      .find((record) => record.collaborationJoin)!;
    const cancellationState = await request(`/api/planner/orders/${orderId}/sewing-collaboration`, {
      headers: headers("planner")
    });
    const cancellationRevision = (cancellationState.body.collaboration as JsonValue).revision;
    const collaboratorStateBeforeCancellation = await request(`/api/scan/${token}`, {
      headers: workerHeaders("sewing_2")
    });
    const collaboratorCollaboration = (collaboratorStateBeforeCancellation.body.state as JsonValue).collaboration as JsonValue;

    const cancelled = await request(
      `/api/planner/orders/${orderId}/sewing-collaboration/${collaborator.id}/cancel`,
      {
        method: "POST",
        headers: headers("planner"),
        body: JSON.stringify({ expectedRevision: cancellationRevision })
      }
    );
    expect(cancelled.response.status).toBe(200);
    expect(cancelled.body.participation).toMatchObject({
      status: "cancelled",
      sewingMode: "single",
      quantity: 3,
      activeParticipantCount: 1,
      participants: expect.arrayContaining([
        expect.objectContaining({ id: collaborator.id, status: "cancelled" })
      ])
    });

    const cancelledWorkerCompletion = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("sewing_2"),
      body: JSON.stringify({
        workHours: 1,
        pieces: 1,
        note: "旧页面提交",
        expectedParticipationId: collaboratorCollaboration.participationId,
        expectedCollaborationRevision: collaboratorCollaboration.revision
      })
    });
    expect(cancelledWorkerCompletion.response.status).toBe(409);
    expect(cancelledWorkerCompletion.body.error).toBe("该参与已被计划员取消，请返回任务列表。");

    const plannerOrders = await request("/api/planner/orders", {
      headers: headers("planner")
    });
    const plannerOrder = (plannerOrders.body.orders as JsonValue[])
      .find((item) => item.id === orderId);
    expect(plannerOrder).toMatchObject({
      sewingMode: "single",
      activeWorker: {
        stage: "sewing",
        workerName: "缝制员工一号"
      }
    });

    const nextScan = await request(`/api/scan/${token}`, {
      headers: workerHeaders("sewing_3")
    });
    expect(nextScan.body.state).toMatchObject({
      allowedAction: "choose_sewing_assignment",
      collaboration: { currentParticipantCount: 1 }
    });
  });

  it("limits one sewing worker to three open tasks for both start and takeover", async () => {
    const orderIds = await Promise.all([1, 2, 3, 4].map((index) =>
      createAcceptedOrder(`SCAN-SEWING-CAPACITY-${index}`, [SAMPLE_REQUEST_ITEMS.sampleGarment])
    ));
    const tokens = await Promise.all(orderIds.map(scanToken));

    for (const token of tokens.slice(0, 3)) {
      const started = await request(`/api/scan/${token}/start`, {
        method: "POST",
        headers: workerHeaders("sewing")
      });
      expect(started.response.status).toBe(200);
    }

    const fourthStart = await request(`/api/scan/${tokens[3]}/start`, {
      method: "POST",
      headers: workerHeaders("sewing")
    });
    expect(fourthStart.response.status).toBe(409);
    expect(fourthStart.body.error).toBe("当前已超过最大接单数量");

    const ownedByOther = await request(`/api/scan/${tokens[3]}/start`, {
      method: "POST",
      headers: workerHeaders("sewing_2")
    });
    expect(ownedByOther.response.status).toBe(200);
    const takeover = await request(`/api/scan/${tokens[3]}/sewing-takeover`, {
      method: "POST",
      headers: workerHeaders("sewing"),
      body: JSON.stringify({
        expectedActiveWorkerId: workerProfileIds.sewing_2,
        reason: "capacity test"
      })
    });
    expect(takeover.response.status).toBe(409);
    expect(takeover.body.error).toBe("当前已超过最大接单数量");
  });

  it("allows exactly one concurrent cutting completion", async () => {
    const orderId = await createAcceptedOrder("SCAN-CONCURRENT-COMPLETE", [SAMPLE_REQUEST_ITEMS.cutting]);
    const token = await scanToken(orderId);
    const body = JSON.stringify({ workHours: 1, pieces: 3, note: "裁剪完成" });
    const responses = await Promise.all([
      rawRequest(`/api/scan/${token}/complete`, { method: "POST", headers: workerHeaders("cutting"), body }),
      rawRequest(`/api/scan/${token}/complete`, { method: "POST", headers: workerHeaders("cutting_2"), body })
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const records = await repository.listScanRecordsByOrderId(orderId);
    expect(records.filter((record) => record.stage === "cutting" && record.action === "complete")).toHaveLength(1);
  });

  it("returns the dedicated cancellation message when cutting is removed before submission", async () => {
    const orderId = await createAcceptedOrder("SCAN-CUTTING-CANCELLED", [SAMPLE_REQUEST_ITEMS.cutting]);
    const token = await scanToken(orderId);
    const opened = await request(`/api/scan/${token}`, {
      headers: workerHeaders("cutting")
    });
    expect(opened.body.state).toMatchObject({ allowedAction: "complete", stage: "cutting" });

    const corrected = await request(`/api/receiver/orders/${orderId}/correction`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ sampleRequestItems: [] })
    });
    expect(corrected.response.status).toBe(200);

    const cancelled = await request(`/api/scan/${token}/complete`, {
      method: "POST",
      headers: workerHeaders("cutting"),
      body: JSON.stringify({ workHours: 1, pieces: 3 })
    });
    expect(cancelled.response.status).toBe(409);
    expect(cancelled.body.error).toBe("裁剪任务已取消");
    expect(await repository.listScanRecordsByOrderId(orderId)).toHaveLength(0);
  });

  it("uses expectedActiveWorkerId CAS so only one concurrent sewing takeover wins", async () => {
    const orderId = await createAcceptedOrder("SCAN-TAKEOVER-CAS", [SAMPLE_REQUEST_ITEMS.sampleGarment]);
    const token = await scanToken(orderId);
    await request(`/api/scan/${token}/start`, {
      method: "POST",
      headers: workerHeaders("sewing")
    });

    const missingExpectedOwner = await request(`/api/scan/${token}/sewing-takeover`, {
      method: "POST",
      headers: workerHeaders("sewing_2"),
      body: JSON.stringify({ reason: "missing CAS owner" })
    });
    expect(missingExpectedOwner.response.status).toBe(400);

    const takeoverBody = JSON.stringify({
      reason: "shift handoff",
      expectedActiveWorkerId: workerProfileIds.sewing
    });
    const responses = await Promise.all([
      rawRequest(`/api/scan/${token}/sewing-takeover`, {
        method: "POST",
        headers: workerHeaders("sewing_2"),
        body: takeoverBody
      }),
      rawRequest(`/api/scan/${token}/sewing-takeover`, {
        method: "POST",
        headers: workerHeaders("sewing_3"),
        body: takeoverBody
      })
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const records = await repository.listScanRecordsByOrderId(orderId);
    const takeovers = records.filter((record) => Boolean(record.takeoverReason));
    expect(takeovers).toHaveLength(1);
    expect(takeovers[0]).toMatchObject({
      takeoverFromWorkerId: workerProfileIds.sewing,
      takeoverReason: "shift handoff"
    });
  });
});
