import { afterAll, describe, expect, it } from "vitest";
import {
  ATTACHMENT_VISIBILITY,
  INTAKE_STATUSES,
  MATERIAL_STATUSES,
  PATTERN_STATUSES,
  ROLES
} from "@sample-room/shared";
import { PrismaClient } from "@prisma/client";
import type { OrderCreateInput } from "../../../modules/orders/orderTypes.js";
import { PrismaScanWorkflowRepository } from "./prismaScanWorkflowRepository.js";
import { createPrismaRepositoryContext } from "./prismaRepositoryContext.js";

const databaseUrl = process.env.PRISMA_TEST_DATABASE_URL;
const runPrismaRepositoryTests =
  process.env.RUN_PRISMA_REPOSITORY_TESTS === "true" && databaseUrl;
const describeIfPrismaDb = runPrismaRepositoryTests ? describe : describe.skip;
const testDatabaseUrl =
  databaseUrl ?? "postgresql://user:pass@localhost:5432/sample_room_prisma_test?schema=public";
const repositoryParityStyleNo = "STYLE-PRISMA-001";
const repositoryParityRequestContact = "new@example.com";

function orderInput(overrides: Partial<OrderCreateInput> = {}): OrderCreateInput {
  return {
    customerId: "mock-customer-active",
    clientUserId: "mock-client-user-active",
    sourceType: "client_submission",
    createdBy: "mock-client-user-active",
    styleNo: repositoryParityStyleNo,
    styleName: "Prisma Repository Sample",
    quantity: 3,
    sampleType: "first_sample",
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

describeIfPrismaDb("prisma repository adapters", () => {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: testDatabaseUrl
      }
    }
  });
  const context = createPrismaRepositoryContext(prisma);
  const scanWorkflow = new PrismaScanWorkflowRepository(prisma);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function resetDatabase() {
    const existingOrders = await prisma.order.findMany({
      where: { styleNo: { startsWith: repositoryParityStyleNo } },
      select: { id: true }
    });
    const orderIds = existingOrders.map((order) => order.id);

    if (orderIds.length > 0) {
      await prisma.scanRecord.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.scanToken.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderAttachment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderCorrectionLog.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }

    await prisma.businessUserRequest.deleteMany({
      where: { contact: repositoryParityRequestContact }
    });

    await prisma.customer.upsert({
      where: { id: "mock-customer-active" },
      update: { name: "Mock Active Customer", status: "active" },
      create: { id: "mock-customer-active", name: "Mock Active Customer", status: "active" }
    });
    for (const account of [
      { id: "prisma-client-account-active", username: "prisma-client-active", displayName: "Customer A User", role: "client_business_user" as const },
      { id: "prisma-client-account-admin", username: "prisma-client-admin", displayName: "Customer A Admin", role: "client_admin" as const }
    ]) {
      await prisma.account.upsert({
        where: { id: account.id },
        update: account,
        create: { ...account, accountType: "business", status: "active", passwordHash: "test-only" }
      });
    }
    await prisma.customer.upsert({
      where: { id: "mock-customer-other" },
      update: { name: "Mock Other Customer", status: "active" },
      create: { id: "mock-customer-other", name: "Mock Other Customer", status: "active" }
    });
    await prisma.clientUser.upsert({
      where: { id: "mock-client-user-active" },
      update: {
        customerId: "mock-customer-active",
        displayName: "Customer A User",
        status: "active",
        clientAccessScope: "own"
      },
      create: {
        id: "mock-client-user-active",
        customerId: "mock-customer-active",
        accountId: "prisma-client-account-active",
        displayName: "Customer A User",
        status: "active",
        clientAccessScope: "own"
      }
    });
    await prisma.clientUser.upsert({
      where: { id: "mock-client-user-admin" },
      update: {
        customerId: "mock-customer-active",
        displayName: "Customer A Admin",
        status: "active",
        clientAccessScope: "customer_all"
      },
      create: {
        id: "mock-client-user-admin",
        customerId: "mock-customer-active",
        accountId: "prisma-client-account-admin",
        displayName: "Customer A Admin",
        status: "active",
        clientAccessScope: "customer_all"
      }
    });
  }

  it("persists Alpha customer, client user, order, attachment, request, and correction-log records", async () => {
    await resetDatabase();

    await expect(context.customers.findCustomerById("mock-customer-active")).resolves.toMatchObject({
      status: "active"
    });
    await expect(context.clientUsers.findClientUserById("mock-client-user-admin")).resolves.toMatchObject({
      clientAccessScope: "customer_all"
    });

    const order = await context.orders.createOrder(orderInput());
    expect(order).toMatchObject({
      styleNo: repositoryParityStyleNo,
      deliveryDate: "2026-06-18",
      createdBy: "mock-client-user-active",
      customerName: "Mock Active Customer",
      terminated: false
    });

    await expect(
      context.orders.updateOrder(order.id, {
        terminated: true,
        terminatedAt: "2026-06-12T01:00:00.000Z",
        terminatedBy: "mock-boss",
        terminatedByName: "Mock Boss",
        terminationReason: "Prisma termination parity",
        statusBeforeTermination: "pending_receive",
        stageAtTermination: null
      })
    ).resolves.toMatchObject({
      terminated: true,
      terminatedBy: "mock-boss",
      terminatedByName: "Mock Boss",
      terminationReason: "Prisma termination parity",
      statusBeforeTermination: "pending_receive",
      stageAtTermination: null
    });

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
      mimeType: "application/pdf",
      size: 1234
    });

    const request = await context.businessUserRequests.createBusinessUserRequest({
      customerId: "mock-customer-active",
      customerName: "Mock Active Customer",
      requestedByClientUserId: "mock-client-user-admin",
      requestedByName: "Customer A Admin",
      businessUserName: "New Business User",
      contact: repositoryParityRequestContact,
      source: "supervisor_registration_code",
      requestedUsername: "prisma-request@example.com",
      requestedPasswordHash: "scrypt$test-only-hash"
    });
    expect(request).toMatchObject({
      source: "supervisor_registration_code",
      requestedUsername: "prisma-request@example.com",
      requestedPasswordHash: "scrypt$test-only-hash"
    });
    await expect(
      context.businessUserRequests.updateBusinessUserRequest(request.id, {
        status: "approved",
        reviewedBy: "mock-system-owner",
        reviewedByRole: ROLES.systemOwner
      })
    ).resolves.toMatchObject({
      status: "approved"
    });

    const logs = [
      {
        id: `${order.id}-correction-1`,
        changedAt: "2026-06-11T00:00:00.000Z",
        changedByRole: ROLES.receiver,
        changedByAccountId: "mock-receiver",
        fieldName: "styleNo",
        oldValue: repositoryParityStyleNo,
        newValue: "STYLE-PRISMA-002"
      }
    ];
    await expect(context.orderCorrectionLogs?.appendOrderCorrectionLogs(order.id, logs)).resolves.toEqual(logs);
    await expect(context.orderCorrectionLogs?.listOrderCorrectionLogsByOrderId(order.id)).resolves.toEqual(logs);
  });

  it("persists Account, WorkerProfile, and existing order ScanToken records", async () => {
    await resetDatabase();
    const order = await context.orders.createOrder(
      orderInput({
        styleNo: `${repositoryParityStyleNo}-SCAN`,
        stage: "pattern_waiting",
        intakeStatus: INTAKE_STATUSES.received,
        patternStatus: PATTERN_STATUSES.none
      })
    );

    const workerAccount = await context.accounts.createAccount({
      username: null,
      phoneNumber: "13900000001",
      displayName: "Prisma Cutting Worker",
      accountType: "worker",
      role: ROLES.worker,
      status: "active",
      passwordHash: "test-only"
    });
    const profile = await context.workerProfiles.createWorkerProfile({
      accountId: workerAccount.id,
      workerType: "cutting"
    });
    await expect(context.workerProfiles.findActiveWorkerProfileByAccountId(workerAccount.id)).resolves.toMatchObject({
      id: profile.id,
      workerType: "cutting",
      status: "active"
    });

    const scanToken = await scanWorkflow.createOrderScanToken({
      orderId: order.id,
      token: "order_scan_prisma_pattern",
      stage: "pattern_waiting"
    });
    expect(await scanWorkflow.findOrderScanToken(scanToken.token)).toMatchObject({
      orderId: order.id,
      token: "order_scan_prisma_pattern"
    });

    await expect(scanWorkflow.listScanRecordsByOrderId(order.id)).resolves.toEqual([]);
  });
});
