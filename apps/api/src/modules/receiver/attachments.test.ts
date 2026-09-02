import { describe, expect, it } from "vitest";
import { ATTACHMENT_VISIBILITY, ORDER_STAGES } from "@sample-room/shared";
import {
  createClientOrder,
  createReceiverSelfEntry,
  headers,
  identityRepositories,
  repository,
  request,
  type JsonValue
} from "./testHelpers.js";

describe("attachment API regressions", () => {
  it("keeps charge attachments out of client order details even if marked client-visible", async () => {
    const created = await createClientOrder("CLIENT-HIDE-CHARGE");
    const id = (created.body.order as JsonValue).id as string;
    const chargeAttachment = await repository.createOrderAttachment({
      orderId: id,
      fileName: "charge-proof.jpg",
      mimeType: "image/jpeg",
      size: 12,
      category: "order_charge",
      uploadedBy: "mock-receiver",
      uploadedByRole: "receiver",
      visibility: ATTACHMENT_VISIBILITY.clientVisible
    });

    const listed = await request("/api/client/orders", { headers: headers("client_business_user") });
    const detail = await request(`/api/client/orders/${id}/attachments`, { headers: headers("client_business_user") });
    expect(JSON.stringify(listed.body)).not.toContain(chargeAttachment.id);
    expect(JSON.stringify(detail.body)).not.toContain(chargeAttachment.id);
  });

  it("uses current uploader names for attachments and deliverables in all three internal services", async () => {
    const created = await createReceiverSelfEntry("CURRENT-UPLOADER-NAME");
    const id = (created.body.order as JsonValue).id as string;
    await identityRepositories.accounts.updateAccount("formal-account-receiver", {
      displayName: "里与",
      status: "suspended"
    });
    await identityRepositories.accounts.updateAccount("formal-account-pattern-maker", {
      displayName: "里与"
    });
    const ordinaryAttachment = await repository.createOrderAttachment({
      orderId: id,
      fileName: "historical-receiver.pdf",
      mimeType: "application/pdf",
      size: 12,
      category: "receiver_upload",
      uploadedBy: "formal-account-receiver",
      uploadedByRole: "receiver",
      uploadedByName: "Receiver",
      visibility: "internal_only"
    });
    const task =
      (await repository.findPatternTaskByOrderId(id)) ??
      (await repository.createPatternTask({
        orderId: id,
        status: "active",
        requirements: ["pattern_making"]
      }));
    const deliverable = await repository.createPatternDeliverable({
      orderId: id,
      patternTaskId: task.id,
      version: "V1",
      type: "pattern_file",
      fileName: "historical-pattern.dxf",
      visibility: "internal_only",
      uploadedBy: "formal-account-pattern-maker",
      uploadedByName: "Receiver"
    });

    const responses = await Promise.all([
      request("/api/admin/orders", { headers: headers("system_owner") }),
      request("/api/receiver/orders", { headers: headers("receiver") }),
      request("/api/planner/orders", { headers: headers("planner") })
    ]);

    for (const response of responses) {
      expect(response.response.status).toBe(200);
      const order = (response.body.orders as JsonValue[]).find((item) => item.id === id)!;
      expect((order.attachments as JsonValue[]).find((item) => item.id === ordinaryAttachment.id))
        .toMatchObject({ uploadedByName: "里与", uploadedByRole: "receiver" });
      const patternTask = order.patternTask as JsonValue;
      expect((patternTask.deliverables as JsonValue[]).find((item) => item.id === deliverable.id))
        .toMatchObject({ uploadedByName: "里与" });
    }

    const managerOrder = (responses[0]!.body.orders as JsonValue[]).find((item) => item.id === id)!;
    expect((managerOrder.attachmentLogs as JsonValue[]).find(
      (item) => item.attachmentId === ordinaryAttachment.id
    )).toMatchObject({ actorName: "里与", originalUploaderName: "里与" });
  });

  it("lets boss and System Owner upload and manage every order attachment through admin routes", async () => {
    const created = await createReceiverSelfEntry("BOSS-OWN-ATTACHMENT");
    const id = (created.body.order as JsonValue).id as string;
    const added = await request(`/api/admin/orders/${id}/attachments`, {
      method: "POST",
      headers: headers("boss", { userId: "boss-owner" }),
      body: JSON.stringify({ attachments: [{ fileName: "老板资料.archive-x", mimeType: "application/octet-stream", size: 21 }] })
    });
    const attachment = (added.body.attachments as JsonValue[]).find(
      (item) => item.uploadedBy === "boss-owner"
    )!;
    expect(added.response.status).toBe(201);
    expect(attachment).toMatchObject({
      uploadedBy: "boss-owner",
      uploadedByRole: "boss",
      category: "other",
      visibility: "internal_only"
    });

    const visible = await request(`/api/admin/orders/${id}/attachments/${attachment.id}/visibility`, {
      method: "PATCH",
      headers: headers("system_owner", { userId: "owner-manager" }),
      body: JSON.stringify({ visibility: "client_visible" })
    });
    expect(visible.response.status).toBe(200);
    expect(visible.body.attachment).toMatchObject({
      id: attachment.id,
      category: "other",
      visibility: "client_visible"
    });
    expect(await identityRepositories.operationLogs!.listOperationLogs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "attachment.visibility_change",
          targetType: "order_attachment",
          targetId: attachment.id,
          before: expect.objectContaining({ visibility: "internal_only" }),
          after: expect.objectContaining({ visibility: "client_visible" })
        })
      ])
    );

    const deletedByAnotherBoss = await request(`/api/admin/orders/${id}/attachments/${attachment.id}`, {
      method: "DELETE",
      headers: headers("boss", { userId: "boss-other" })
    });
    expect(deletedByAnotherBoss.response.status).toBe(200);
    const alreadyDeleted = await request(`/api/admin/orders/${id}/attachments/${attachment.id}`, {
      method: "DELETE",
      headers: headers("boss", { userId: "boss-owner" })
    });
    expect(alreadyDeleted.response.status).toBe(404);
  });

  it("lets client salespeople delete only attachments uploaded by their stable user id", async () => {
    const created = await createClientOrder("CLIENT-OWN-DELETE", headers("client_business_user", { userId: "client-owner" }));
    const id = (created.body.order as JsonValue).id as string;
    const added = await request(`/api/client/orders/${id}/attachments`, {
      method: "POST",
      headers: headers("client_business_user", { userId: "client-owner" }),
      body: JSON.stringify({ attachments: [{ fileName: "客户任意格式.bundle", mimeType: "application/octet-stream", size: 8 }] })
    });
    const attachment = (added.body.attachments as JsonValue[])[0]!;
    expect(attachment.canDelete).toBe(true);

    const denied = await request(`/api/client/orders/${id}/attachments/${attachment.id}`, {
      method: "DELETE",
      headers: headers("client_business_user", { userId: "client-other" })
    });
    expect(denied.response.status).toBe(403);

    const deleted = await request(`/api/client/orders/${id}/attachments/${attachment.id}`, {
      method: "DELETE",
      headers: headers("client_business_user", { userId: "client-owner" })
    });
    expect(deleted.response.status).toBe(200);
    expect(await repository.listOrderAttachments(id)).toEqual([]);
    expect(await repository.listAttachmentAuditLogs(id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "delete", actorId: "client-owner", originalFileName: "客户任意格式.bundle" })
      ])
    );
  });

  it("creates client submissions with client-visible attachment metadata", async () => {
    const { response, body } = await request("/api/client/orders", {
      method: "POST",
      headers: headers("client_business_user"),
      body: JSON.stringify({
        styleNo: "ATTACH-WEB",
        styleName: "Attachment Web",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        patternStatus: "none",
        deliveryDate: "2026-06-30",
        attachments: [
          {
            fileName: "reference.jpg",
            mimeType: "image/jpeg",
            size: 1024,
            category: "client_reference",
            visibility: "internal_only"
          },
          {
            fileName: "size-chart.pdf",
            mimeType: "application/pdf",
            size: 2048,
            category: "client_reference"
          }
        ]
      })
    });

    const order = body.order as JsonValue;
    const attachments = order.attachments as JsonValue[];

    expect(response.status).toBe(201);
    expect(order.attachmentCount).toBe(2);
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      fileName: "reference.jpg",
      visibility: "client_visible"
    });
    expect(attachments[0]).not.toHaveProperty("uploadedBy");
    expect(attachments[0]).not.toHaveProperty("uploadedByRole");
    expect(attachments[0]).not.toHaveProperty("uploadedByName");
  });

  it("adds client mobile attachment metadata after order creation", async () => {
    const created = await createClientOrder("ATTACH-MOBILE");
    const id = (created.body.order as JsonValue).id as string;

    const added = await request(`/api/client/orders/${id}/attachments`, {
      method: "POST",
      headers: headers("client_business_user"),
      body: JSON.stringify({
        attachments: [
          {
            fileName: "mobile-photo.jpg",
            mimeType: "image/jpeg",
            size: 4096,
            category: "client_reference"
          }
        ]
      })
    });
    const list = await request(`/api/client/orders/${id}/attachments`, {
      headers: headers("client_business_user")
    });
    const orders = await request("/api/client/orders", {
      headers: headers("client_business_user")
    });

    expect(added.response.status).toBe(201);
    expect((added.body.attachments as JsonValue[])[0]).toMatchObject({
      fileName: "mobile-photo.jpg",
      visibility: "client_visible"
    });
    expect((list.body.attachments as JsonValue[])).toHaveLength(1);
    expect((orders.body.orders as JsonValue[])[0]!.attachmentCount).toBe(1);
  });

  it("blocks client users from reading or uploading attachments on another customer's order", async () => {
    const created = await createClientOrder("OTHER-BLOCK");
    const id = (created.body.order as JsonValue).id as string;
    const otherClientHeaders = headers("client_business_user", {
      userId: "other-client-user",
      customerId: "mock-customer-other",
      clientUserId: "mock-client-user-other"
    });

    const read = await request(`/api/client/orders/${id}/attachments`, {
      headers: otherClientHeaders
    });
    const write = await request(`/api/client/orders/${id}/attachments`, {
      method: "POST",
      headers: otherClientHeaders,
      body: JSON.stringify({
        attachments: [{ fileName: "bad.pdf", mimeType: "application/pdf", size: 1 }]
      })
    });

    expect(read.response.status).toBe(404);
    expect(write.response.status).toBe(404);
  });

  it("blocks own-scope client users from reading or uploading attachments on another same-customer business user's order", async () => {
    const activeClient = headers("client_business_user", {
      userId: "mock-client-user-active",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active"
    });
    const secondClient = headers("client_business_user", {
      userId: "mock-client-user-second",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-second"
    });
    const created = await createClientOrder("SAME-CUSTOMER-ATTACH-BLOCK", secondClient);
    const id = (created.body.order as JsonValue).id as string;

    const read = await request(`/api/client/orders/${id}/attachments`, {
      headers: activeClient
    });
    const write = await request(`/api/client/orders/${id}/attachments`, {
      method: "POST",
      headers: activeClient,
      body: JSON.stringify({
        attachments: [{ fileName: "bad.pdf", mimeType: "application/pdf", size: 1 }]
      })
    });

    expect(read.response.status).toBe(404);
    expect(write.response.status).toBe(404);
  });

  it("allows customer_all client users to read client-visible attachments under their customer but not upload", async () => {
    const activeClient = headers("client_business_user", {
      userId: "mock-client-user-active",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active"
    });
    const customerAdmin = headers("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });
    const created = await createClientOrder("ADMIN-ATTACH-READ", activeClient);
    const id = (created.body.order as JsonValue).id as string;

    await request(`/api/client/orders/${id}/attachments`, {
      method: "POST",
      headers: activeClient,
      body: JSON.stringify({
        attachments: [{ fileName: "visible.pdf", mimeType: "application/pdf", size: 10 }]
      })
    });
    const read = await request(`/api/client/orders/${id}/attachments`, {
      headers: customerAdmin
    });
    const write = await request(`/api/client/orders/${id}/attachments`, {
      method: "POST",
      headers: customerAdmin,
      body: JSON.stringify({
        attachments: [{ fileName: "admin-write.pdf", mimeType: "application/pdf", size: 1 }]
      })
    });

    expect(read.response.status).toBe(200);
    expect((read.body.attachments as JsonValue[]).map((attachment) => attachment.fileName)).toEqual([
      "visible.pdf"
    ]);
    expect(write.response.status).toBe(403);
    expect(write.body.error).toBe("customer admin accounts cannot change orders in this phase.");
  });

  it("defaults receiver ordinary attachments to internal-only and forces receiver_attachment", async () => {
    const created = await createReceiverSelfEntry("RECEIVER-ATTACH-VISIBLE");
    const id = (created.body.order as JsonValue).id as string;

    const added = await request(`/api/receiver/orders/${id}/attachments`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        attachments: [
          {
            fileName: "customer-visible-result.pdf",
            mimeType: "application/pdf",
            size: 1234,
            category: "client_result"
          }
        ]
      })
    });
    const clientList = await request(`/api/client/orders/${id}/attachments`, {
      headers: headers("client_business_user")
    });

    expect(added.response.status).toBe(201);
    expect((added.body.attachments as JsonValue[])[0]).toMatchObject({
      fileName: "customer-visible-result.pdf",
      uploadedByRole: "receiver",
      visibility: ATTACHMENT_VISIBILITY.internalOnly,
      category: "receiver_attachment"
    });
    expect(clientList.body.attachments).toEqual([]);
  });

  it("lets receiver add internal attachment metadata to a received order without changing order state", async () => {
    const created = await createReceiverSelfEntry("RECEIVER-ATTACH");
    const id = (created.body.order as JsonValue).id as string;

    const added = await request(`/api/receiver/orders/${id}/attachments`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        attachments: [
          {
            fileName: "pattern-note.pdf",
            mimeType: "application/pdf",
            size: 1234,
            category: "internal_pattern",
            visibility: ATTACHMENT_VISIBILITY.internalOnly
          }
        ]
      })
    });
    const receiverList = await request(`/api/receiver/orders/${id}/attachments`, {
      headers: headers("receiver")
    });
    const clientList = await request(`/api/client/orders/${id}/attachments`, {
      headers: headers("client_business_user")
    });
    const allOrders = await request("/api/receiver/orders", {
      headers: headers("receiver")
    });
    const order = (allOrders.body.orders as JsonValue[]).find((item) => item.id === id)!;

    expect(added.response.status).toBe(201);
    expect((added.body.attachments as JsonValue[])[0]).toMatchObject({
      fileName: "pattern-note.pdf",
      uploadedByRole: "receiver",
      visibility: ATTACHMENT_VISIBILITY.internalOnly
    });
    expect(receiverList.body.attachments).toHaveLength(2);
    expect(clientList.body.attachments).toHaveLength(0);
    expect(order).toMatchObject({
      id,
      deliveryDate: "2026-06-30",
      intakeStatus: "received",
      stage: "pattern_waiting",
      attachmentCount: 2
    });
  });

  it("lets receiver delete attachments from active tracking orders without leaving client-visible metadata", async () => {
    const created = await createReceiverSelfEntry("RECEIVER-DELETE-ATTACH");
    const id = (created.body.order as JsonValue).id as string;

    const added = await request(`/api/receiver/orders/${id}/attachments`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        attachments: [
          {
            fileName: "delete-me.pdf",
            mimeType: "application/pdf",
            size: 1234,
            category: "client_result",
            visibility: ATTACHMENT_VISIBILITY.clientVisible
          }
        ]
      })
    });
    const attachmentId = ((added.body.attachments as JsonValue[])[0] as JsonValue).id as string;
    expect((added.body.attachments as JsonValue[])[0]).toMatchObject({
      category: "receiver_attachment",
      visibility: ATTACHMENT_VISIBILITY.clientVisible
    });

    const deleted = await request(`/api/receiver/orders/${id}/attachments/${attachmentId}`, {
      method: "DELETE",
      headers: headers("receiver")
    });
    const receiverList = await request(`/api/receiver/orders/${id}/attachments`, {
      headers: headers("receiver")
    });
    const clientList = await request(`/api/client/orders/${id}/attachments`, {
      headers: headers("client_business_user")
    });
    const clientDownload = await request(`/api/client/orders/${id}/attachments/${attachmentId}/download`, {
      headers: headers("client_business_user")
    });
    const logs = await request(`/api/receiver/orders/${id}/attachment-logs`, {
      headers: headers("receiver")
    });

    expect(deleted.response.status).toBe(200);
    expect((deleted.body.attachments as JsonValue[]).map((attachment) => attachment.fileName)).toEqual([
      "RECEIVER-DELETE-ATTACH-sample-sheet.pdf"
    ]);
    expect((receiverList.body.attachments as JsonValue[]).map((attachment) => attachment.fileName)).toEqual([
      "RECEIVER-DELETE-ATTACH-sample-sheet.pdf"
    ]);
    expect(clientList.body.attachments).toEqual([]);
    expect(clientDownload.response.status).toBe(404);
    expect(logs.body.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attachmentId, originalFileName: "delete-me.pdf", action: "upload" }),
        expect.objectContaining({
          attachmentId,
          originalFileName: "delete-me.pdf",
          action: "delete",
          actorId: "mock-receiver",
          actorRole: "receiver"
        })
      ])
    );
  });

  it("rejects legacy visibility input and updates only visibility for the original uploader", async () => {
    const created = await createReceiverSelfEntry("RECEIVER-VISIBILITY");
    const id = (created.body.order as JsonValue).id as string;
    const invalid = await request(`/api/receiver/orders/${id}/attachments`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        attachments: [{
          fileName: "legacy.pdf",
          mimeType: "application/pdf",
          size: 10,
          visibility: "client_upload_allowed"
        }]
      })
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body.error).toBe("attachment_visibility_invalid");

    const added = await request(`/api/receiver/orders/${id}/attachments`, {
      method: "POST",
      headers: headers("receiver", { userId: "receiver-owner" }),
      body: JSON.stringify({
        attachments: [{
          fileName: "visible.pdf",
          mimeType: "application/pdf",
          size: 10,
          visibility: "client_visible"
        }]
      })
    });
    const attachment = (added.body.attachments as JsonValue[])[0]!;
    const before = (await repository.listOrderAttachments(id)).find((item) => item.id === attachment.id)!;
    const visibleToClient = await request(`/api/client/orders/${id}/attachments`, {
      headers: headers("client_business_user")
    });
    expect(visibleToClient.body.attachments).toEqual([
      expect.objectContaining({ id: attachment.id, visibility: "client_visible" })
    ]);
    const denied = await request(`/api/receiver/orders/${id}/attachments/${attachment.id as string}/visibility`, {
      method: "PATCH",
      headers: headers("receiver", { userId: "another-receiver" }),
      body: JSON.stringify({ visibility: "internal_only" })
    });
    expect(denied.response.status).toBe(403);
    const changed = await request(`/api/receiver/orders/${id}/attachments/${attachment.id as string}/visibility`, {
      method: "PATCH",
      headers: headers("receiver", { userId: "receiver-owner" }),
      body: JSON.stringify({ visibility: "internal_only" })
    });
    expect(changed.response.status).toBe(200);
    const after = (await repository.listOrderAttachments(id)).find((item) => item.id === attachment.id)!;
    expect(after).toMatchObject({
      visibility: "internal_only",
      category: before.category
    });
    expect(after.storageKey).toBe(before.storageKey);
    const hiddenFromClient = await request(`/api/client/orders/${id}/attachments`, {
      headers: headers("client_business_user")
    });
    expect(hiddenFromClient.body.attachments).toEqual([]);
    const deniedDownload = await request(
      `/api/client/orders/${id}/attachments/${attachment.id as string}/download`,
      { headers: headers("client_business_user") }
    );
    expect(deniedDownload.response.status).toBe(404);
  });

  it("keeps exactly one receiver-owned image, PDF, or Excel attachment marked as the sample sheet", async () => {
    const created = await createReceiverSelfEntry("RECEIVER-SAMPLE-SHEET");
    const id = (created.body.order as JsonValue).id as string;
    const upload = async (fileName: string, mimeType: string) => {
      const form = new FormData();
      const bytes = fileName.endsWith(".xlsx")
        ? new Uint8Array([0x50, 0x4b, 0x03, 0x04])
        : new TextEncoder().encode("%PDF-1.4\n%%EOF");
      form.append("files", new Blob([bytes], { type: mimeType }), fileName);
      form.append("category", "receiver_attachment");
      form.append("visibility", "client_visible");
      const { "content-type": _contentType, ...requestHeaders } = headers("receiver");
      return request(`/api/receiver/orders/${id}/attachments`, {
        method: "POST",
        headers: requestHeaders,
        body: form
      });
    };

    const second = await upload("sample-sheet-v2.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const secondId = ((second.body.attachments as JsonValue[])[0] as JsonValue).id as string;
    const selectedSecond = await request(`/api/receiver/orders/${id}/sample-sheet-attachment`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ attachmentId: secondId })
    });
    expect(selectedSecond.response.status).toBe(200);
    expect((selectedSecond.body.attachments as JsonValue[]).filter((item) => item.category === "receiver_sample_sheet"))
      .toEqual([expect.objectContaining({ id: secondId, fileName: "sample-sheet-v2.xlsx" })]);

    const third = await upload("sample-sheet-v3.pdf", "application/pdf");
    const thirdId = ((third.body.attachments as JsonValue[])[0] as JsonValue).id as string;
    const selectedThird = await request(`/api/receiver/orders/${id}/sample-sheet-attachment`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ attachmentId: thirdId })
    });
    const attachments = selectedThird.body.attachments as JsonValue[];
    expect(attachments.filter((item) => item.category === "receiver_sample_sheet"))
      .toEqual([expect.objectContaining({ id: thirdId, fileName: "sample-sheet-v3.pdf" })]);
    expect(attachments.find((item) => item.id === secondId)?.category).toBe("receiver_attachment");
  });

  it("rejects deleting another receiver's attachment by stable uploader id", async () => {
    const created = await createReceiverSelfEntry("RECEIVER-DELETE-OWNER-ID");
    const id = (created.body.order as JsonValue).id as string;
    const added = await request(`/api/receiver/orders/${id}/attachments`, {
      method: "POST",
      headers: headers("receiver", { userId: "receiver-owner" }),
      body: JSON.stringify({ attachments: [{ fileName: "owner-only.zip", mimeType: "application/zip", size: 5 }] })
    });
    const attachmentId = ((added.body.attachments as JsonValue[])[0] as JsonValue).id as string;

    const denied = await request(`/api/receiver/orders/${id}/attachments/${attachmentId}`, {
      method: "DELETE",
      headers: headers("receiver", { userId: "receiver-other" })
    });

    expect(denied.response.status).toBe(403);
    expect(await repository.listOrderAttachments(id)).toHaveLength(2);
    expect((await repository.listAttachmentAuditLogs(id)).filter((log) => log.action === "delete")).toEqual([]);
  });

  it("keeps receiver attachment deletion behind receiver workflow permissions", async () => {
    const created = await createReceiverSelfEntry("CLIENT-CANNOT-DELETE-ATTACH");
    const id = (created.body.order as JsonValue).id as string;
    const added = await request(`/api/receiver/orders/${id}/attachments`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        attachments: [{ fileName: "receiver-owned.pdf", mimeType: "application/pdf", size: 12 }]
      })
    });
    const attachmentId = ((added.body.attachments as JsonValue[])[0] as JsonValue).id as string;

    const clientDelete = await request(`/api/receiver/orders/${id}/attachments/${attachmentId}`, {
      method: "DELETE",
      headers: headers("client_business_user")
    });
    const receiverList = await request(`/api/receiver/orders/${id}/attachments`, {
      headers: headers("receiver")
    });

    expect(clientDelete.response.status).toBe(403);
    expect(receiverList.body.attachments as JsonValue[]).toHaveLength(2);
  });

  it("allows receiver attachment additions on pending receive orders but blocks completed orders", async () => {
    const created = await createClientOrder("PENDING-RECEIVER-ATTACH");
    const id = (created.body.order as JsonValue).id as string;

    const added = await request(`/api/receiver/orders/${id}/attachments`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        attachments: [{ fileName: "too-early.pdf", mimeType: "application/pdf", size: 1 }]
      })
    });

    expect(added.response.status).toBe(201);
    expect((added.body.attachments as JsonValue[])[0]).toMatchObject({
      fileName: "too-early.pdf",
      uploadedByRole: "receiver"
    });

    const active = await createReceiverSelfEntry("DONE-RECEIVER-ATTACH");
    const activeId = (active.body.order as JsonValue).id as string;
    repository.updateOrder(activeId, { stage: ORDER_STAGES.done });

    const done = await request(`/api/receiver/orders/${activeId}/attachments`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({
        attachments: [{ fileName: "done.pdf", mimeType: "application/pdf", size: 1 }]
      })
    });

    expect(done.response.status).toBe(409);
    expect(done.body.error).toBe("only active received tracking orders can receive receiver attachments.");

    const tracking = await request(`/api/receiver/orders/${activeId}/tracking`, {
      method: "PATCH",
      headers: headers("receiver"),
      body: JSON.stringify({ fabricStatus: "complete" })
    });

    expect(tracking.response.status).toBe(409);
    expect(tracking.body.error).toBe("订单状态已变化，本次更新未保存。请刷新列表。");
  });

  it("does not return internal attachments to client users", async () => {
    const created = await createClientOrder("INTERNAL-HIDDEN");
    const id = (created.body.order as JsonValue).id as string;

    repository.createOrderAttachment({
      orderId: id,
      fileName: "internal-cost.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 99,
      category: "internal_pricing",
      uploadedBy: "mock-boss",
      uploadedByRole: "boss",
      visibility: ATTACHMENT_VISIBILITY.internalOnly
    });

    const list = await request("/api/client/orders", {
      headers: headers("client_business_user")
    });
    const attachments = await request(`/api/client/orders/${id}/attachments`, {
      headers: headers("client_business_user")
    });
    const order = (list.body.orders as JsonValue[])[0]!;

    expect(order.attachmentCount).toBe(0);
    expect(order.attachments).toEqual([]);
    expect(attachments.body.attachments).toEqual([]);
  });
});
