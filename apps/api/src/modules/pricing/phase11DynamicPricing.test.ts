import { describe, expect, it } from "vitest";
import {
  createReceiverSelfEntry,
  headers,
  identityRepositories,
  repository,
  request,
  type JsonValue
} from "../receiver/testHelpers.js";

async function createPhase11Order(styleNo: string) {
  const created = await createReceiverSelfEntry(styleNo, {
    quantity: 1,
    sampleRequestItems: ["pattern_making", "quote_material_check"]
  });
  expect(created.response.status).toBe(201);
  return (created.body.order as JsonValue).id as string;
}

async function addInternalCost(
  orderId: string,
  payload: Record<string, unknown>
) {
  return request(`/api/admin/orders/${orderId}/pricing/internal-costs`, {
    method: "POST",
    headers: headers("boss"),
    body: JSON.stringify(payload)
  });
}

async function addCustomerCharge(
  orderId: string,
  payload: Record<string, unknown>
) {
  return request(`/api/admin/orders/${orderId}/pricing/customer-charges`, {
    method: "POST",
    headers: headers("boss"),
    body: JSON.stringify(payload)
  });
}

describe("Phase 1.1 dynamic pricing", () => {
  it("allows normal manual sewing costs and sample charges without changing original tasks", async () => {
    const orderId = await createPhase11Order("PHASE11-MANUAL-SAMPLE");
    const initialized = await request(`/api/admin/orders/${orderId}/pricing/initialize`, {
      method: "POST",
      headers: headers("boss")
    });
    expect(initialized.response.status).toBe(200);

    const sewing = await addInternalCost(orderId, {
      name: "缝制工费",
      category: "sewing",
      amount: 420,
      note: "客户临时要求补做样衣，原任务未更新"
    });
    expect(sewing.response.status).toBe(201);
    expect((sewing.body.pricing as JsonValue).internalCostItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "缝制工费",
          sourceType: "manual",
          category: "sewing",
          amount: 420
        })
      ])
    );

    await addCustomerCharge(orderId, {
      name: "客户版费",
      pricingMethod: "fixed",
      amount: 1200,
      sourceTask: "制版"
    });
    const sampleCharge = await addCustomerCharge(orderId, {
      name: "样衣费",
      pricingMethod: "unit_quantity",
      unitPrice: 680,
      quantity: 1,
      note: "客户临时要求补做样衣"
    });
    expect(sampleCharge.response.status).toBe(201);
    expect((sampleCharge.body.order as JsonValue).sampleRequestItems).toEqual([
      "pattern_making",
      "quote_material_check"
    ]);
    expect(sampleCharge.body.summary).toMatchObject({
      customerQuoteSubtotal: 1880,
      confirmedOtherChargeTotal: 0,
      receivableTotal: 1880,
      baseInternalCost: 420,
      internalTotalCost: 420,
      grossProfit: 1460
    });
  });

  it("keeps other charges live after quote confirmation while preserving charge ownership boundaries", async () => {
    const orderId = await createPhase11Order("PHASE11-OTHER-CHARGE");
    await addInternalCost(orderId, {
      name: "版师成本",
      category: "pattern",
      amount: 320,
      sourceTask: "制版、报价核料"
    });
    await addInternalCost(orderId, {
      name: "缝制工费",
      category: "sewing",
      amount: 420,
      note: "客户临时要求补做样衣"
    });
    await addCustomerCharge(orderId, {
      name: "客户版费",
      pricingMethod: "fixed",
      amount: 1200
    });
    await addCustomerCharge(orderId, {
      name: "样衣费",
      pricingMethod: "unit_quantity",
      unitPrice: 680,
      quantity: 1
    });

    const initialCharge = await request(`/api/planner/orders/${orderId}/charges`, {
      method: "POST",
      headers: headers("planner", { userId: "planner-phase11" }),
      body: JSON.stringify({
        name: "快递费",
        amount: 300,
        explanation: "客户补做样衣寄送",
        sourceScene: "planner_order_detail"
      })
    });
    const initialChargeId = (initialCharge.body.charge as JsonValue).id as string;
    expect(initialCharge.body.charge).toMatchObject({ status: "effective" });

    const confirmedCharge = await request(
      `/api/admin/orders/${orderId}/charges/${initialChargeId}/confirm`,
      { method: "POST", headers: headers("system_owner") }
    );
    expect(confirmedCharge.body.charge).toMatchObject({ status: "confirmed" });

    const confirmedPricing = await request(`/api/admin/orders/${orderId}/pricing/confirm`, {
      method: "POST",
      headers: headers("boss")
    });
    expect(confirmedPricing.response.status).toBe(200);
    expect(confirmedPricing.body.pricing).toMatchObject({
      quotationStatus: "confirmed",
      confirmedReceivableTotal: 2180,
      confirmedInternalCostTotal: 740,
      confirmedGrossProfit: 1140
    });

    const creatorStillCannotEditHistoricalConfirmed = await request(
      `/api/planner/orders/${orderId}/charges/${initialChargeId}`,
      {
        method: "PATCH",
        headers: headers("planner", { userId: "planner-phase11" }),
        body: JSON.stringify({ amount: 350 })
      }
    );
    expect(creatorStillCannotEditHistoricalConfirmed.response.status).toBe(403);

    const creatorStillCannotDeleteHistoricalConfirmed = await request(
      `/api/planner/orders/${orderId}/charges/${initialChargeId}`,
      {
        method: "DELETE",
        headers: headers("planner", { userId: "planner-phase11" })
      }
    );
    expect(creatorStillCannotDeleteHistoricalConfirmed.response.status).toBe(403);

    const postConfirmCharge = await request(`/api/planner/orders/${orderId}/charges`, {
      method: "POST",
      headers: headers("planner", { userId: "planner-phase11" }),
      body: JSON.stringify({
        name: "补充快递费",
        amount: 80,
        explanation: "确认报价后实际追加",
        sourceScene: "planner_order_detail"
      })
    });
    expect(postConfirmCharge.response.status).toBe(201);
    expect(postConfirmCharge.body.charge).toMatchObject({
      status: "effective",
      amount: 80
    });
    const postConfirmChargeId = (postConfirmCharge.body.charge as JsonValue).id as string;

    const postConfirmAttachment = new FormData();
    postConfirmAttachment.append(
      "files",
      new Blob(["receipt"], { type: "application/pdf" }),
      "确认报价后费用凭证.pdf"
    );
    const { "content-type": _contentType, ...plannerUploadHeaders } = headers("planner", {
      userId: "planner-phase11"
    });
    const attachmentAdded = await request(
      `/api/planner/orders/${orderId}/charges/${postConfirmChargeId}/attachments`,
      {
        method: "POST",
        headers: plannerUploadHeaders,
        body: postConfirmAttachment
      }
    );
    expect(attachmentAdded.response.status).toBe(201);
    expect(attachmentAdded.body.charge).toMatchObject({ status: "effective", amount: 80 });

    const liveAfterAdd = await request(`/api/admin/orders/${orderId}/pricing`, {
      headers: headers("boss")
    });
    expect(liveAfterAdd.body).toMatchObject({
      pricing: { quotationStatus: "confirmed" },
      quotationHasUnconfirmedChanges: false,
      reconciliationEligibility: { eligible: true },
      confirmedQuotation: {
        customerQuoteSubtotal: 1880,
        effectiveCustomerOtherCharges: 380,
        receivableTotal: 2260
      },
      summary: {
        customerQuoteSubtotal: 1880,
        confirmedOtherChargeTotal: 380,
        receivableTotal: 2260,
        baseInternalCost: 740,
        internalTotalCost: 740,
        grossProfit: 1140
      }
    });

    const updatedPostConfirmCharge = await request(
      `/api/planner/orders/${orderId}/charges/${postConfirmChargeId}`,
      {
        method: "PATCH",
        headers: headers("planner", { userId: "planner-phase11" }),
        body: JSON.stringify({ amount: 100 })
      }
    );
    expect(updatedPostConfirmCharge.response.status).toBe(200);
    expect(updatedPostConfirmCharge.body.charge).toMatchObject({
      status: "effective",
      amount: 100
    });

    const client = await request(`/api/client/orders/${orderId}/quotation`, {
      headers: headers("client_business_user", {
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active"
      })
    });
    expect(client.body.quotation).toMatchObject({
      customerQuoteSubtotal: 1880,
      effectiveCustomerOtherCharges: 400,
      receivableTotal: 2280,
      status: "confirmed"
    });
    expect((client.body.quotation as JsonValue).otherCharges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "快递费", amount: 300 }),
        expect.objectContaining({ name: "补充快递费", amount: 100 })
      ])
    );
    expect(JSON.stringify(client.body)).not.toContain("internalCost");

    const stillConfirmed = await request(`/api/admin/orders/${orderId}/pricing`, {
      headers: headers("boss")
    });
    expect(stillConfirmed.body).toMatchObject({
      pricing: { quotationStatus: "confirmed" },
      quotationHasUnconfirmedChanges: false,
      reconciliationEligibility: { eligible: true },
      confirmedQuotation: {
        effectiveCustomerOtherCharges: 400,
        receivableTotal: 2280
      },
      summary: { receivableTotal: 2280 }
    });
  });

  it("auto-confirms manager-created other charges without requiring an explanation", async () => {
    const orderId = await createPhase11Order("PHASE11-MANAGER-CHARGE");
    const created = await request(`/api/admin/orders/${orderId}/charges`, {
      method: "POST",
      headers: headers("boss", { userId: "boss-charge-owner" }),
      body: JSON.stringify({
        name: "快递费",
        amount: 80,
        sourceScene: "boss_pricing"
      })
    });

    expect(created.response.status).toBe(201);
    expect(created.body.charge).toMatchObject({
      name: "快递费",
      amount: 80,
      explanation: "",
      creatorId: "boss-charge-owner",
      creatorRole: "boss",
      status: "confirmed",
      reviewedBy: "boss-charge-owner",
      reviewedByRole: "boss"
    });
  });

  it("renames only display names, locks extensions, and enforces uploader and manager permissions", async () => {
    const created = await createReceiverSelfEntry("PHASE11-ATTACHMENT-RENAME");
    const orderId = (created.body.order as JsonValue).id as string;
    const form = new FormData();
    form.append("files", new Blob(["DXF"], { type: "application/dxf" }), "pattern-v2.dxf");
    form.append("category", "client_result");
    form.append("visibility", "internal_only");
    const { "content-type": _contentType, ...receiverHeaders } = headers("receiver", {
      userId: "receiver-owner"
    });
    const added = await request(`/api/receiver/orders/${orderId}/attachments`, {
      method: "POST",
      headers: receiverHeaders,
      body: form
    });
    expect(added.response.status).toBe(201);
    const attachment = (added.body.attachments as JsonValue[])[0]!;
    const before = (await repository.listOrderAttachments(orderId)).find(
      (item) => item.id === attachment.id
    )!;

    const denied = await request(
      `/api/receiver/orders/${orderId}/attachments/${attachment.id}/display-name`,
      {
        method: "PATCH",
        headers: headers("receiver", { userId: "receiver-other" }),
        body: JSON.stringify({ displayName: "not-allowed" })
      }
    );
    expect(denied.response.status).toBe(403);

    const unsafe = await request(
      `/api/receiver/orders/${orderId}/attachments/${attachment.id}/display-name`,
      {
        method: "PATCH",
        headers: headers("receiver", { userId: "receiver-owner" }),
        body: JSON.stringify({ displayName: "../escape" })
      }
    );
    expect(unsafe.response.status).toBe(400);

    const renamed = await request(
      `/api/receiver/orders/${orderId}/attachments/${attachment.id}/display-name`,
      {
        method: "PATCH",
        headers: headers("receiver", { userId: "receiver-owner" }),
        body: JSON.stringify({ displayName: "final-pattern-v2" })
      }
    );
    expect(renamed.response.status).toBe(200);
    const after = (await repository.listOrderAttachments(orderId)).find(
      (item) => item.id === attachment.id
    )!;
    expect(after.fileName).toBe("final-pattern-v2.dxf");
    expect(after.storageKey).toBe(before.storageKey);
    expect(after.mimeType).toBe(before.mimeType);
    expect(await repository.listAttachmentAuditLogs(orderId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attachmentId: attachment.id,
          action: "rename",
          originalFileName: "pattern-v2.dxf",
          newFileName: "final-pattern-v2.dxf",
          actorId: "receiver-owner"
        })
      ])
    );

    const managerDeleted = await request(
      `/api/admin/orders/${orderId}/attachments/${attachment.id}`,
      { method: "DELETE", headers: headers("system_owner") }
    );
    expect(managerDeleted.response.status).toBe(200);
  });

  it("keeps a confirmed other charge confirmed when only its attachments change", async () => {
    const created = await createReceiverSelfEntry("PHASE11-OTHER-ATTACHMENT");
    const orderId = (created.body.order as JsonValue).id as string;
    const chargeCreated = await request(`/api/planner/orders/${orderId}/charges`, {
      method: "POST",
      headers: headers("planner", { userId: "planner-attachment-owner" }),
      body: JSON.stringify({
        name: "外部检测费",
        amount: 220,
        explanation: "第三方检测报告",
        sourceScene: "planner_order_detail"
      })
    });
    const chargeId = (chargeCreated.body.charge as JsonValue).id as string;

    const upload = async (fileName: string) => {
      const form = new FormData();
      form.append("files", new Blob(["receipt"], { type: "application/pdf" }), fileName);
      const { "content-type": _contentType, ...plannerHeaders } = headers("planner", {
        userId: "planner-attachment-owner"
      });
      return request(
        `/api/planner/orders/${orderId}/charges/${chargeId}/attachments`,
        { method: "POST", headers: plannerHeaders, body: form }
      );
    };

    const firstUpload = await upload("检测报告.pdf");
    expect(firstUpload.response.status).toBe(201);
    const attachmentId = ((firstUpload.body.charge as JsonValue).attachments as JsonValue[])[0]!
      .id as string;

    const confirmed = await request(`/api/admin/orders/${orderId}/charges/${chargeId}/confirm`, {
      method: "POST",
      headers: headers("boss")
    });
    expect(confirmed.body.charge).toMatchObject({ status: "confirmed" });

    const secondUpload = await upload("付款截图.pdf");
    expect(secondUpload.body.charge).toMatchObject({ status: "confirmed" });
    expect(((secondUpload.body.charge as JsonValue).attachments as JsonValue[])).toHaveLength(2);

    const beforeRename = (await repository.listOrderAttachments(orderId)).find(
      (item) => item.id === attachmentId
    )!;
    const forbiddenRename = await request(
      `/api/receiver/orders/${orderId}/charges/${chargeId}/attachments/${attachmentId}/display-name`,
      {
        method: "PATCH",
        headers: headers("receiver", { userId: "another-user" }),
        body: JSON.stringify({ displayName: "越权名称" })
      }
    );
    expect(forbiddenRename.response.status).toBe(403);

    const renamed = await request(
      `/api/planner/orders/${orderId}/charges/${chargeId}/attachments/${attachmentId}/display-name`,
      {
        method: "PATCH",
        headers: headers("planner", { userId: "planner-attachment-owner" }),
        body: JSON.stringify({ displayName: "最终检测报告" })
      }
    );
    expect(renamed.response.status).toBe(200);
    expect(renamed.body.charge).toMatchObject({ status: "confirmed" });
    const afterRename = (await repository.listOrderAttachments(orderId)).find(
      (item) => item.id === attachmentId
    )!;
    expect(afterRename.fileName).toBe("最终检测报告.pdf");
    expect(afterRename.storageKey).toBe(beforeRename.storageKey);

    const deleted = await request(
      `/api/planner/orders/${orderId}/charges/${chargeId}/attachments/${attachmentId}`,
      {
        method: "DELETE",
        headers: headers("planner", { userId: "planner-attachment-owner" })
      }
    );
    expect(deleted.body.charge).toMatchObject({ status: "confirmed" });
    expect(((deleted.body.charge as JsonValue).attachments as JsonValue[])).toHaveLength(1);

    const logs = await identityRepositories.operationLogs!.listOperationLogs();
    expect(logs.map((log) => log.action)).toEqual(
      expect.arrayContaining([
        "order_charge.attachments.add",
        "order_charge.attachments.rename",
        "order_charge.attachments.delete"
      ])
    );
    expect(await repository.listAttachmentAuditLogs(orderId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attachmentId,
          action: "rename",
          originalFileName: "检测报告.pdf",
          newFileName: "最终检测报告.pdf",
          actorId: "planner-attachment-owner"
        })
      ])
    );
  });
});
