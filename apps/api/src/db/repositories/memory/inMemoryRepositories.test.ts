import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_VISIBILITY,
  INTAKE_STATUSES,
  MATERIAL_STATUSES,
  PATTERN_STATUSES,
  ROLES
} from "@sample-room/shared";
import {
  createInMemorySampleRoomRepository,
  InMemorySampleRoomRepository
} from "../sampleRoomRepository.js";
import type { OrderCreateInput } from "../../../modules/orders/orderTypes.js";
import { createInMemoryRepositoryContext } from "./inMemoryRepositoryContext.js";
import { createInMemoryStore } from "./inMemoryStore.js";

function orderInput(overrides: Partial<OrderCreateInput> = {}): OrderCreateInput {
  return {
    customerId: "mock-customer-active",
    clientUserId: "mock-client-user-active",
    sourceType: "client_submission",
    createdBy: "mock-client-user-active",
    styleNo: "STYLE-001",
    styleName: "Repository Contract Sample",
    quantity: 3,
    sampleType: "proto",
    sampleRound: "round_1",
    deliveryDate: "2026-06-18",
    intakeStatus: INTAKE_STATUSES.pendingReceive,
    stage: null,
    patternStatus: PATTERN_STATUSES.has,
    fabricStatus: MATERIAL_STATUSES.missing,
    trimStatus: MATERIAL_STATUSES.missing,
    ...overrides
  };
}

describe("in-memory repository adapters", () => {
  it("shares one store between the broad facade and split order adapter", async () => {
    const store = createInMemoryStore();
    const broadRepository = createInMemorySampleRoomRepository(store);
    const context = createInMemoryRepositoryContext(store);

    const broadOrder = broadRepository.createOrder(orderInput({ styleNo: "BROAD-001" }));
    await expect(context.orders.findOrderById(broadOrder.id)).resolves.toMatchObject({
      id: broadOrder.id,
      styleNo: "BROAD-001"
    });

    const adapterOrder = await context.orders.createOrder(orderInput({ styleNo: "ADAPTER-001" }));
    expect(broadRepository.findOrderById(adapterOrder.id)).toMatchObject({
      id: adapterOrder.id,
      styleNo: "ADAPTER-001"
    });
  });

  it("keeps order adapter create, list, find, and update behavior equivalent", async () => {
    const context = createInMemoryRepositoryContext();
    const order = await context.orders.createOrder(orderInput());

    expect(order).toMatchObject({
      id: "mock-order-1",
      orderNo: "V2-MOCK-0001",
      folderCode: expect.stringMatching(/^SR\d{11}$/),
      customerName: "Mock Active Customer",
      salespersonId: "mock-client-user-active",
      salespersonName: "客户 A 普通业务员",
      supplementCount: 0
    });

    await expect(context.orders.listOrders()).resolves.toHaveLength(1);
    await expect(context.orders.findOrderById(order.id)).resolves.toMatchObject({
      styleNo: "STYLE-001"
    });

    const updated = await context.orders.updateOrder(order.id, { remark: "updated remark" });
    expect(updated.remark).toBe("updated remark");
  });

  it("keeps customer adapter list and find behavior", async () => {
    const context = createInMemoryRepositoryContext();

    await expect(context.customers.listCustomers()).resolves.toEqual([
      { id: "mock-customer-active", name: "Mock Active Customer", status: "active" },
      { id: "mock-customer-other", name: "Mock Other Customer", status: "active" },
      { id: "mock-customer-archived", name: "Mock Archived Customer", status: "archived" }
    ]);
    await expect(context.customers.findCustomerById("mock-customer-active")).resolves.toMatchObject({
      name: "Mock Active Customer"
    });
  });

  it("keeps client user adapter list, create, and find behavior", async () => {
    const context = createInMemoryRepositoryContext();

    await expect(
      context.clientUsers.listClientUsersByCustomerId("mock-customer-active")
    ).resolves.toHaveLength(4);

    const created = await context.clientUsers.createClientUser({
      customerId: "mock-customer-active",
      displayName: "新增业务员",
      contact: "new@example.com"
    });

    expect(created).toMatchObject({
      id: "mock-client-user-generated-1",
      customerId: "mock-customer-active",
      displayName: "新增业务员",
      contact: "new@example.com",
      status: "active",
      clientAccessScope: "own"
    });
    await expect(context.clientUsers.findClientUserById(created.id)).resolves.toEqual(created);
  });

  it("keeps attachment adapter create and list behavior", async () => {
    const context = createInMemoryRepositoryContext();
    const order = await context.orders.createOrder(orderInput());

    const attachment = await context.attachments.createOrderAttachment({
      orderId: order.id,
      fileName: "sample.pdf",
      mimeType: "application/pdf",
      size: 1234,
      category: "client_reference",
      uploadedBy: "mock-client-user-active",
      uploadedByRole: ROLES.clientBusinessUser,
      visibility: ATTACHMENT_VISIBILITY.clientVisible
    });

    expect(attachment).toMatchObject({
      id: "mock-attachment-1",
      orderId: order.id,
      fileName: "sample.pdf"
    });
    await expect(context.attachments.listOrderAttachments(order.id)).resolves.toEqual([attachment]);
  });

  it("keeps business-user request adapter create, list, and review behavior", async () => {
    const context = createInMemoryRepositoryContext();

    const request = await context.businessUserRequests.createBusinessUserRequest({
      customerId: "mock-customer-active",
      customerName: "Mock Active Customer",
      requestedByClientUserId: "mock-client-user-admin",
      requestedByName: "客户 A 主管账号",
      businessUserName: "新增业务员",
      contact: "new@example.com",
      roleNote: "业务",
      note: "请新增"
    });

    expect(request).toMatchObject({
      id: "mock-business-user-request-1",
      status: "pending"
    });
    await expect(context.businessUserRequests.listBusinessUserRequests()).resolves.toEqual([
      request
    ]);

    const reviewed = await context.businessUserRequests.updateBusinessUserRequest(request.id, {
      status: "approved",
      reviewedBy: "mock-system-owner",
      reviewedByRole: ROLES.systemOwner,
      createdClientUserId: "mock-client-user-generated-1"
    });

    expect(reviewed).toMatchObject({
      status: "approved",
      reviewedBy: "mock-system-owner",
      reviewedByRole: ROLES.systemOwner,
      createdClientUserId: "mock-client-user-generated-1"
    });
  });

  it("keeps correction logs embedded while exposing the future adapter contract", async () => {
    const context = createInMemoryRepositoryContext();
    const order = await context.orders.createOrder(orderInput());
    const logs = [
      {
        id: `${order.id}-correction-1`,
        changedAt: "2026-06-11T00:00:00.000Z",
        changedByRole: ROLES.receiver,
        changedByAccountId: "mock-receiver",
        fieldName: "styleNo",
        oldValue: "STYLE-001",
        newValue: "STYLE-002"
      }
    ];

    await expect(
      context.orderCorrectionLogs?.appendOrderCorrectionLogs(order.id, logs)
    ).resolves.toEqual(logs);
    await expect(
      context.orderCorrectionLogs?.listOrderCorrectionLogsByOrderId(order.id)
    ).resolves.toEqual(logs);
    await expect(context.orders.findOrderById(order.id)).resolves.toMatchObject({
      correctionLogs: logs
    });
  });

  it("keeps the broad in-memory repository facade available for current services", () => {
    const repository = new InMemorySampleRoomRepository();
    const order = repository.createOrder(orderInput());

    expect(repository.findOrderById(order.id)).toEqual(order);
    expect(repository.listOrders()).toEqual([order]);
  });
});
