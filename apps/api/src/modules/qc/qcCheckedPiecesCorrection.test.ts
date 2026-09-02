import { describe, expect, it } from "vitest";
import { ORDER_STAGES } from "@sample-room/shared";
import {
  createReceiverSelfEntry,
  headers,
  repository,
  request,
  type JsonValue
} from "../receiver/testHelpers.js";

async function createCompletedQcOrder(styleNo: string, pieces = 10) {
  const created = await createReceiverSelfEntry(styleNo);
  const orderId = (created.body.order as JsonValue).id as string;
  await repository.updateOrder(orderId, { stage: ORDER_STAGES.done });
  await repository.createScanRecord({
    orderId,
    stage: "qc_delivery",
    orderStage: ORDER_STAGES.done,
    action: "complete",
    scanAction: "qc_delivery_finish",
    workerId: "mock-qc-worker",
    workerName: "Mock QC Worker",
    pieces,
    qualityResult: "qualified",
    qualityScore: 92
  });
  return orderId;
}

describe("boss QC checked pieces correction", () => {
  it("corrects the effective checked pieces without overwriting the original QC scan record", async () => {
    const orderId = await createCompletedQcOrder("QC-PIECES-CORRECT", 10);
    const beforeOrder = await repository.findOrderById(orderId);

    const corrected = await request(`/api/admin/orders/${orderId}/qc-result/pieces`, {
      method: "PATCH",
      headers: headers("boss", { userId: "boss-qc-corrector" }),
      body: JSON.stringify({
        pieces: 5,
        reason: "组检员工录入错误，实际只检验 5 件"
      })
    });

    expect(corrected.response.status).toBe(200);
    expect(corrected.body.correction).toMatchObject({
      orderId,
      previousPieces: 10,
      pieces: 5,
      reason: "组检员工录入错误，实际只检验 5 件"
    });
    expect(corrected.body.result).toMatchObject({
      orderId,
      pieces: 5,
      originalPieces: 10,
      correctionCount: 1,
      workerName: "Mock QC Worker"
    });

    const rawQc = (await repository.listScanRecordsByOrderId(orderId)).find(
      (record) => record.stage === "qc_delivery" && record.action === "complete"
    );
    expect(rawQc?.pieces).toBe(10);

    const storedOrder = await repository.findOrderById(orderId);
    expect(storedOrder?.stage).toBe(beforeOrder?.stage);
    expect(storedOrder?.correctionLogs).toEqual([
      expect.objectContaining({
        changedByRole: "boss",
        changedByAccountId: "boss-qc-corrector",
        fieldName: `qc_checked_pieces:${rawQc?.id}`,
        oldValue: 10,
        newValue: 5
      })
    ]);

    const bossQcResult = await request(`/api/admin/orders/${orderId}/qc-result`, {
      headers: headers("boss")
    });
    expect(bossQcResult.response.status).toBe(200);
    expect((bossQcResult.body.result as JsonValue).pieces).toBe(5);
  });

  it("keeps the original value across repeated corrections and uses the latest effective value", async () => {
    const orderId = await createCompletedQcOrder("QC-PIECES-REPEAT", 10);

    const first = await request(`/api/admin/orders/${orderId}/qc-result/pieces`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ pieces: 5, reason: "第一次纠错" })
    });
    expect(first.response.status).toBe(200);

    const second = await request(`/api/admin/orders/${orderId}/qc-result/pieces`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ pieces: 6, reason: "复核后再次纠错" })
    });
    expect(second.response.status).toBe(200);
    expect(second.body.correction).toMatchObject({ previousPieces: 5, pieces: 6 });
    expect(second.body.result).toMatchObject({
      pieces: 6,
      originalPieces: 10,
      correctionCount: 2
    });
    expect((await repository.listScanRecordsByOrderId(orderId)).at(-1)?.pieces).toBe(10);
  });

  it("requires boss/system-owner permission and a correction reason", async () => {
    const orderId = await createCompletedQcOrder("QC-PIECES-GUARDS", 10);

    const forbidden = await request(`/api/admin/orders/${orderId}/qc-result/pieces`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ pieces: 5, reason: "无权限尝试" })
    });
    expect(forbidden.response.status).toBe(403);

    const missingReason = await request(`/api/admin/orders/${orderId}/qc-result/pieces`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ pieces: 5 })
    });
    expect(missingReason.response.status).toBe(400);
    expect(missingReason.body.error).toBe("请填写修改原因。");

    const unchanged = await request(`/api/admin/orders/${orderId}/qc-result/pieces`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ pieces: 10, reason: "没有变化" })
    });
    expect(unchanged.response.status).toBe(409);
    expect(unchanged.body.error).toBe("实际检验件数没有发生变化。");
  });
});
