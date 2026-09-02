import { describe, expect, it } from "vitest";
import { ORDER_STAGES, SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import { createClientOrder, headers, rawRequest, repository, request, type JsonValue } from "../receiver/testHelpers.js";

const qcHeaders = {
  "content-type": "application/json",
  "x-dev-role": "worker",
  "x-dev-user-id": "formal-account-worker-qc",
  "x-dev-account-type": "worker",
  "x-dev-active-worker-profile-id": "formal-worker-profile-qc",
  "x-dev-active-worker-type": "qc_delivery"
};

const otherQcHeaders = {
  ...qcHeaders,
  "x-dev-user-id": "formal-account-worker-qc-2",
  "x-dev-active-worker-profile-id": "formal-worker-profile-qc-2"
};

const nonQcWorkerHeaders = {
  cutting: {
    ...qcHeaders,
    "x-dev-user-id": "formal-account-worker-cutting",
    "x-dev-active-worker-profile-id": "formal-worker-profile-cutting",
    "x-dev-active-worker-type": "cutting"
  },
  sewing: {
    ...qcHeaders,
    "x-dev-user-id": "formal-account-worker-sewing",
    "x-dev-active-worker-profile-id": "formal-worker-profile-sewing",
    "x-dev-active-worker-type": "sewing"
  }
};

async function qcWaitingOrder(styleNo: string) {
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
  await repository.createScanRecord({
    orderId,
    actorAccountId: "formal-account-worker-sewing",
    workerProfileId: "formal-worker-profile-sewing",
    actorType: "production_worker",
    actorRole: "worker",
    stage: "sewing",
    orderStage: ORDER_STAGES.sewingDoing,
    action: "complete",
    scanAction: "sewing_finish",
    workerId: "formal-worker-profile-sewing",
    workerName: "缝制员工一号",
    pieces: 3,
    workHours: 1
  });
  await repository.updateOrder(orderId, { stage: ORDER_STAGES.qcDeliveryWaiting });
  const link = await request(`/api/receiver/orders/${orderId}/scan-link`, { headers: headers("receiver") });
  return { orderId, token: (link.body.scanLink as JsonValue).token as string };
}

describe("QC tablet worker scope", () => {
  it.each(Object.entries(nonQcWorkerHeaders))(
    "rejects a %s worker at every QC tablet API boundary",
    async (_workerType, workerHeaders) => {
      const calls: Array<[string, RequestInit?]> = [
        ["/api/qc/me/rework-orders"],
        ["/api/qc/me/completed-orders"],
        ["/api/qc/me/orders/not-owned"],
        ["/api/qc/me/orders/not-owned/thumbnail"],
        ["/api/qc/me/performance"],
        ["/api/qc/me/orders/not-owned/reinspect", { method: "POST", body: "{}" }],
        ["/api/qc/me/orders/not-owned/photos", { method: "POST", body: "{}" }],
        ["/api/qc/me/orders/not-owned/photos/not-owned", { method: "PATCH", body: "{}" }],
        ["/api/qc/me/orders/not-owned/photos/not-owned", { method: "DELETE" }],
        ["/api/qc/me/orders/not-owned/photos/not-owned/download"]
      ];

      for (const [path, options] of calls) {
        const response = await request(path, { ...options, headers: workerHeaders });
        expect(response.response.status, `${options?.method ?? "GET"} ${path}`).toBe(403);
      }
    }
  );

  it("returns the final quality score and 0, 1, or 2 reworks in own performance", async () => {
    const createCompletedQcOrder = async (styleNo: string, reworkCount: number, qualityScore: number) => {
      const { orderId } = await qcWaitingOrder(styleNo);
      for (let index = 0; index < reworkCount; index += 1) {
        await repository.createScanRecord({
          orderId,
          actorAccountId: "formal-account-worker-qc",
          workerProfileId: "formal-worker-profile-qc",
          actorType: "production_worker",
          actorRole: "worker",
          stage: "qc_delivery",
          orderStage: ORDER_STAGES.qcDeliveryWaiting,
          action: "complete",
          scanAction: "qc_delivery_finish",
          workerId: "formal-worker-profile-qc",
          workerName: "组检出库员工一号",
          eventTime: `2026-08-05T0${index + 1}:${reworkCount}0:00.000Z`,
          qualityResult: "rework",
          pieces: 3,
          note: `第 ${index + 1} 次返工`
        });
      }
      await repository.createScanRecord({
        orderId,
        actorAccountId: "formal-account-worker-qc",
        workerProfileId: "formal-worker-profile-qc",
        actorType: "production_worker",
        actorRole: "worker",
        stage: "qc_delivery",
        orderStage: ORDER_STAGES.qcDeliveryWaiting,
        action: "complete",
        scanAction: "qc_delivery_finish",
        workerId: "formal-worker-profile-qc",
        workerName: "组检出库员工一号",
        eventTime: `2026-08-05T0${reworkCount + 4}:${reworkCount}0:00.000Z`,
        qualityResult: "qualified",
        qualityScore,
        pieces: 3
      });
      await repository.updateOrder(orderId, { stage: ORDER_STAGES.done });
    };

    await createCompletedQcOrder("QC-PERFORMANCE-0", 0, 95);
    await createCompletedQcOrder("QC-PERFORMANCE-1", 1, 92);
    await createCompletedQcOrder("QC-PERFORMANCE-2", 2, 89);

    const response = await request(
      "/api/qc/me/performance?dateFrom=2026-08-05&dateTo=2026-08-05",
      { headers: qcHeaders }
    );
    const records = response.body.records as JsonValue[];

    expect(response.response.status).toBe(200);
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        customerName: "Mock Active Customer",
        salespersonName: "客户 A 普通业务员",
        styleNo: "QC-PERFORMANCE-0",
        qualityScore: 95,
        reworkCount: 0
      }),
      expect.objectContaining({ styleNo: "QC-PERFORMANCE-1", qualityScore: 92, reworkCount: 1 }),
      expect.objectContaining({ styleNo: "QC-PERFORMANCE-2", qualityScore: 89, reworkCount: 2 })
    ]));
  });

  it("lists only the current worker's rework/completed orders and reuses QC completion", async () => {
    const { orderId } = await qcWaitingOrder("QC-TABLET-001");
    const rework = await repository.createScanRecord({
      orderId,
      actorAccountId: "formal-account-worker-qc",
      workerProfileId: "formal-worker-profile-qc",
      actorType: "production_worker",
      actorRole: "worker",
      stage: "qc_delivery",
      orderStage: ORDER_STAGES.qcDeliveryWaiting,
      action: "complete",
      scanAction: "qc_delivery_finish",
      workerId: "formal-worker-profile-qc",
      workerName: "组检出库员工一号",
      qualityResult: "rework",
      pieces: 3,
      note: "袖口需要返工"
    });

    const mine = await request("/api/qc/me/rework-orders?q=QC-TABLET", { headers: qcHeaders });
    expect(mine.response.status).toBe(200);
    expect(mine.body.orders).toEqual([
      expect.objectContaining({ orderId, qualityResult: "rework", note: "袖口需要返工" })
    ]);
    const other = await request("/api/qc/me/rework-orders", { headers: otherQcHeaders });
    expect(other.response.status).toBe(200);
    expect(other.body.orders).toEqual([]);

    const cutting = await request("/api/qc/me/rework-orders", {
      headers: {
        ...qcHeaders,
        "x-dev-user-id": "formal-account-worker-cutting",
        "x-dev-active-worker-profile-id": "formal-worker-profile-cutting",
        "x-dev-active-worker-type": "cutting"
      }
    });
    expect(cutting.response.status).toBe(403);

    const form = new FormData();
    form.append("qualityResult", "qualified");
    form.append("qualityScore", "93");
    form.append("pieces", "3");
    form.append("category", "qc_sample_photo");
    form.append("files", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "final.jpg");
    const { "content-type": _contentType, ...multipartHeaders } = qcHeaders;
    const completed = await rawRequest(`/api/qc/me/orders/${orderId}/reinspect`, {
      method: "POST",
      headers: multipartHeaders,
      body: form
    });
    expect(completed.status).toBe(200);
    expect((await repository.findOrderById(orderId))?.stage).toBe(ORDER_STAGES.done);
    const records = (await repository.listScanRecordsByOrderId(orderId)).filter(
      (record) => record.stage === "qc_delivery" && record.action === "complete"
    );
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.qualityResult)).toEqual(["rework", "qualified"]);
    expect(records[0]?.id).toBe(rework.id);

    const completedList = await request("/api/qc/me/completed-orders", { headers: qcHeaders });
    expect(completedList.response.status).toBe(200);
    expect(completedList.body.orders).toEqual([
      expect.objectContaining({ orderId, qualityResult: "qualified", qualityScore: 93 })
    ]);
    const adminResult = await request(`/api/admin/orders/${orderId}/qc-result`, { headers: headers("boss") });
    expect(adminResult.body.result).toEqual(expect.objectContaining({
      qualityResult: "qualified",
      qualityScore: 93,
      workerName: "组检出库员工一号",
      photos: [expect.objectContaining({ category: "qc_sample_photo" })]
    }));
  });

  it("removes terminated orders from every normal QC list and blocks an already-open detail", async () => {
    const { orderId } = await qcWaitingOrder("QC-TERMINATED-HIDDEN");
    await repository.createScanRecord({
      orderId,
      actorAccountId: "formal-account-worker-qc",
      workerProfileId: "formal-worker-profile-qc",
      actorType: "production_worker",
      actorRole: "worker",
      stage: "qc_delivery",
      orderStage: ORDER_STAGES.qcDeliveryWaiting,
      action: "complete",
      scanAction: "qc_delivery_finish",
      workerId: "formal-worker-profile-qc",
      workerName: "组检出库员工一号",
      qualityResult: "rework",
      pieces: 3,
      note: "终止前返工记录"
    });

    expect((await request(`/api/qc/me/orders/${orderId}`, { headers: qcHeaders })).response.status)
      .toBe(200);
    const terminated = await request(`/api/admin/orders/${orderId}/terminate`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ reason: "停止继续生产" })
    });
    expect(terminated.response.status).toBe(200);

    for (const path of ["/api/qc/me/rework-orders", "/api/qc/me/completed-orders"]) {
      const response = await request(path, { headers: qcHeaders });
      expect((response.body.orders as JsonValue[]).some((order) => order.orderId === orderId))
        .toBe(false);
    }
    expect((await request(`/api/qc/me/orders/${orderId}`, { headers: qcHeaders })).response.status)
      .toBe(409);
    expect((await request(`/api/qc/me/orders/${orderId}/reinspect`, {
      method: "POST",
      headers: qcHeaders,
      body: JSON.stringify({ qualityResult: "qualified", qualityScore: 90, pieces: 3 })
    })).response.status).toBe(409);
  });

  it("allows only the current worker to maintain own QC photos and preserves audits", async () => {
    const { orderId } = await qcWaitingOrder("QC-TABLET-PHOTO");
    await repository.createScanRecord({
      orderId,
      actorAccountId: "formal-account-worker-qc",
      workerProfileId: "formal-worker-profile-qc",
      actorType: "production_worker",
      actorRole: "worker",
      stage: "qc_delivery",
      orderStage: ORDER_STAGES.qcDeliveryWaiting,
      action: "complete",
      scanAction: "qc_delivery_finish",
      workerId: "formal-worker-profile-qc",
      workerName: "组检出库员工一号",
      qualityResult: "rework",
      pieces: 3,
      note: "返工"
    });
    const attachment = await repository.createOrderAttachment({
      orderId,
      fileName: "problem.jpg",
      mimeType: "image/jpeg",
      size: 4,
      category: "qc_sample_photo",
      uploadedBy: "formal-worker-profile-qc",
      uploadedByRole: "worker",
      uploadedByName: "组检出库员工一号",
      visibility: "internal_only"
    });
    const measurementAttachments = await Promise.all(["measurement-front.jpg", "measurement-back.jpg"].map((fileName) =>
      repository.createOrderAttachment({
        orderId,
        fileName,
        mimeType: "image/jpeg",
        size: 4,
        category: "qc_measurement_photo",
        uploadedBy: "formal-worker-profile-qc",
        uploadedByRole: "worker",
        uploadedByName: "组检出库员工一号",
        visibility: "internal_only"
      })
    ));
    await repository.createScanRecord({
      orderId,
      actorAccountId: "formal-account-worker-qc",
      workerProfileId: "formal-worker-profile-qc",
      actorType: "production_worker",
      actorRole: "worker",
      stage: "qc_delivery",
      orderStage: ORDER_STAGES.qcDeliveryWaiting,
      action: "complete",
      scanAction: "qc_delivery_finish",
      workerId: "formal-worker-profile-qc",
      workerName: "组检出库员工一号",
      qualityResult: "rework",
      pieces: 3,
      note: "返工",
      samplePhotoAttachmentIds: [attachment.id],
      measurementPhotoAttachmentIds: measurementAttachments.map((item) => item.id)
    });

    const historical = await request(`/api/qc/me/orders/${orderId}`, { headers: qcHeaders });
    expect(((historical.body.order as JsonValue).latestRework as JsonValue).photos).toEqual(
      [expect.objectContaining({ id: attachment.id, category: "qc_issue_photo" })]
    );
    expect((historical.body.order as JsonValue).attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: attachment.id, category: "qc_issue_photo" })
    ]));

    const bossDetail = await request(`/api/admin/orders/${orderId}/detail`, { headers: headers("boss") });
    expect(bossDetail.body.qcReworkRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scanRecordId: expect.any(String),
        photos: [expect.objectContaining({ id: attachment.id, category: "qc_issue_photo" })]
      })
    ]));

    const renamed = await request(`/api/qc/me/orders/${orderId}/photos/${attachment.id}`, {
      method: "PATCH",
      headers: qcHeaders,
      body: JSON.stringify({ displayName: "袖口问题", visibility: "client_visible", category: "qc_issue_photo" })
    });
    expect(renamed.response.status).toBe(200);
    expect(renamed.body.attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: "袖口问题.jpg", visibility: "client_visible", category: "qc_issue_photo" })
    ]));

    const resultForBoss = await request(`/api/admin/orders/${orderId}/qc-result`, { headers: headers("boss") });
    expect(resultForBoss.response.status).toBe(200);
    expect(resultForBoss.body.result).toEqual(expect.objectContaining({
      qualityResult: "rework",
      photos: expect.arrayContaining([
        expect.objectContaining({ category: "qc_issue_photo" }),
        ...measurementAttachments.map((item) => expect.objectContaining({ id: item.id, category: "qc_measurement_photo" }))
      ])
    }));
    expect((await request(`/api/admin/orders/${orderId}/qc-result`, { headers: headers("system_owner") })).response.status).toBe(200);
    for (const role of ["receiver", "planner", "pattern_maker", "worker", "client_admin", "client_business_user"]) {
      expect((await request(`/api/admin/orders/${orderId}/qc-result`, { headers: headers(role) })).response.status).toBe(403);
      expect((await request(`/api/admin/orders/${orderId}/qc-result/photos/${attachment.id}/download`, { headers: headers(role) })).response.status).toBe(403);
    }

    const bossOrders = await request("/api/admin/orders", { headers: headers("boss") });
    const bossOrder = (bossOrders.body.orders as JsonValue[]).find((item) => item.id === orderId)!;
    expect(bossOrder.qcRecordStatus).toBe("rework");
    expect(bossOrder.attachmentCount).toBe(0);
    expect(bossOrder.attachments).toEqual([]);
    const ownerOrders = await request("/api/admin/orders", { headers: headers("system_owner") });
    const ownerOrder = (ownerOrders.body.orders as JsonValue[]).find((item) => item.id === orderId)!;
    expect(ownerOrder.attachmentCount).toBe(0);
    expect(ownerOrder.attachments).toEqual([]);
    const receiverOrders = await request("/api/receiver/orders", { headers: headers("receiver") });
    const receiverOrder = (receiverOrders.body.orders as JsonValue[]).find((item) => item.id === orderId)!;
    expect(receiverOrder.attachmentCount).toBe(0);
    expect(receiverOrder.attachments).toEqual([]);
    const plannerOrders = await request("/api/planner/orders", { headers: headers("planner") });
    const plannerOrder = (plannerOrders.body.orders as JsonValue[]).find((item) => item.id === orderId)!;
    expect(plannerOrder.attachmentCount).toBe(0);
    expect(plannerOrder.attachments).toEqual([]);
    const clientAttachments = await request(`/api/client/orders/${orderId}/attachments`, { headers: headers("client_business_user") });
    expect(clientAttachments.response.status).toBe(200);
    expect(clientAttachments.body.attachments).toEqual([]);
    expect((await request(`/api/client/orders/${orderId}/attachments/${attachment.id}/download`, { headers: headers("client_business_user") })).response.status).toBe(404);

    const forbidden = await request(`/api/qc/me/orders/${orderId}/photos/${attachment.id}`, {
      method: "DELETE",
      headers: otherQcHeaders
    });
    expect(forbidden.response.status).toBe(403);

    const deleted = await request(`/api/qc/me/orders/${orderId}/photos/${attachment.id}`, {
      method: "DELETE",
      headers: qcHeaders
    });
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.attachments).toEqual(expect.arrayContaining(
      measurementAttachments.map((item) => expect.objectContaining({ id: item.id }))
    ));
    expect(deleted.body.attachments).toHaveLength(2);
    const logs = await repository.listAttachmentAuditLogs(orderId);
    expect(logs.map((log) => log.action)).toEqual(expect.arrayContaining(["upload", "rename", "visibility_change", "delete"]));
    expect((await repository.listScanRecordsByOrderId(orderId))).toHaveLength(3);
  });

  it("adds and edits all three QC photo categories", async () => {
    const { orderId } = await qcWaitingOrder("QC-TABLET-CATEGORIES");
    await repository.createScanRecord({
      orderId,
      actorAccountId: "formal-account-worker-qc",
      workerProfileId: "formal-worker-profile-qc",
      actorType: "production_worker",
      actorRole: "worker",
      stage: "qc_delivery",
      orderStage: ORDER_STAGES.qcDeliveryWaiting,
      action: "complete",
      scanAction: "qc_delivery_finish",
      workerId: "formal-worker-profile-qc",
      workerName: "组检出库员工一号",
      qualityResult: "rework",
      pieces: 3,
      note: "返工"
    });
    const { "content-type": _contentType, ...multipartHeaders } = qcHeaders;
    for (const category of ["qc_issue_photo", "qc_sample_photo", "qc_measurement_photo"] as const) {
      const form = new FormData();
      form.append("category", category);
      form.append("files", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), `${category}.jpg`);
      expect((await rawRequest(`/api/qc/me/orders/${orderId}/photos`, { method: "POST", headers: multipartHeaders, body: form })).status).toBe(201);
    }
    const detail = await request(`/api/qc/me/orders/${orderId}`, { headers: qcHeaders });
    expect(((detail.body.order as JsonValue).attachments as JsonValue[]).map((item) => item.category).sort()).toEqual([
      "qc_issue_photo", "qc_measurement_photo", "qc_sample_photo"
    ]);
    const issue = ((detail.body.order as JsonValue).attachments as JsonValue[]).find((item) => item.category === "qc_issue_photo")!;
    const changed = await request(`/api/qc/me/orders/${orderId}/photos/${issue.id}`, {
      method: "PATCH",
      headers: qcHeaders,
      body: JSON.stringify({ category: "qc_measurement_photo" })
    });
    expect((changed.body.attachments as JsonValue[]).find((item) => item.id === issue.id)?.category).toBe("qc_measurement_photo");
  });
});
