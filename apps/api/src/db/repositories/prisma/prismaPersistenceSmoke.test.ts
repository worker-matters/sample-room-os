import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INTAKE_STATUSES, ORDER_STAGES, PATTERN_STATUSES, ROLES } from "@sample-room/shared";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../../../app.js";
import { createRuntimeSampleRoomRepository, getPersistenceMode } from "../runtimeRepository.js";
import { createPrismaRepositoryContext } from "./prismaRepositoryContext.js";
import { createPrismaSampleRoomRepository } from "./prismaSampleRoomRepository.js";

const databaseUrl = process.env.PRISMA_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const runPersistenceSmoke =
  process.env.RUN_PRISMA_PERSISTENCE_SMOKE === "true" && Boolean(databaseUrl);
const describeIfPrismaDb = runPersistenceSmoke ? describe : describe.skip;
const testDatabaseUrl =
  databaseUrl ?? "postgresql://user:pass@localhost:5432/sample_room_prisma_test?schema=public";

type TestApp = {
  baseUrl: string;
  close: () => Promise<void>;
};

function clientHeaders(clientUserId: string, customerId: string, scope: "own" | "customer_all") {
  return {
    "content-type": "application/json",
    "x-dev-role": ROLES.clientBusinessUser,
    "x-dev-user-id": clientUserId,
    "x-dev-client-user-id": clientUserId,
    "x-dev-customer-id": customerId,
    "x-dev-client-access-scope": scope
  };
}

const receiverHeaders = {
  "content-type": "application/json",
  "x-dev-role": ROLES.receiver,
  "x-dev-user-id": "mock-receiver"
};

async function jsonRequest<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
  }

  return body as T;
}

async function startPrismaBackedApp(prisma: PrismaClient): Promise<TestApp> {
  const repository = createPrismaSampleRoomRepository(createPrismaRepositoryContext(prisma));
  const server: Server = createApp({ repository }).listen(0);

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test API did not bind to a TCP port.");
  }

  return {
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}

function expectClientSafeOrder(order: Record<string, unknown>) {
  expect(order).not.toHaveProperty("scanToken");
  expect(order).not.toHaveProperty("scanRecords");
  expect(order).not.toHaveProperty("price");
  expect(order).not.toHaveProperty("cost");
  expect(JSON.stringify(order)).not.toContain("scanToken");
  expect(JSON.stringify(order)).not.toContain("scanRecords");
}

describeIfPrismaDb("Prisma persistence smoke", () => {
  let cleanupPrisma: PrismaClient;
  let styleNo: string;

  beforeEach(async () => {
    cleanupPrisma = new PrismaClient({
      datasources: {
        db: {
          url: testDatabaseUrl
        }
      }
    });
    styleNo = `PERSIST-AUTO-TEST-${Date.now()}`;

    await cleanupPrisma.customer.upsert({
      where: { id: "mock-customer-active" },
      update: { name: "Mock Active Customer", status: "active" },
      create: { id: "mock-customer-active", name: "Mock Active Customer", status: "active" }
    });
    await cleanupPrisma.customer.upsert({
      where: { id: "mock-customer-other" },
      update: { name: "Mock Other Customer", status: "active" },
      create: { id: "mock-customer-other", name: "Mock Other Customer", status: "active" }
    });
    for (const account of [
      { id: "persistence-client-account-active", username: "persistence-client-active", displayName: "Mock Customer A User", role: "client_business_user" as const },
      { id: "persistence-client-account-admin", username: "persistence-client-admin", displayName: "Mock Customer A Admin", role: "client_admin" as const },
      { id: "persistence-client-account-other", username: "persistence-client-other", displayName: "Mock Customer B User", role: "client_business_user" as const }
    ]) {
      await cleanupPrisma.account.upsert({
        where: { id: account.id },
        update: account,
        create: { ...account, accountType: "business", status: "active", passwordHash: "test-only" }
      });
    }

    await cleanupPrisma.clientUser.upsert({
      where: { id: "mock-client-user-active" },
      update: {
        customerId: "mock-customer-active",
        displayName: "Mock Customer A User",
        status: "active",
        clientAccessScope: "own"
      },
      create: {
        id: "mock-client-user-active",
        customerId: "mock-customer-active",
        accountId: "persistence-client-account-active",
        displayName: "Mock Customer A User",
        status: "active",
        clientAccessScope: "own"
      }
    });
    await cleanupPrisma.clientUser.upsert({
      where: { id: "mock-client-user-admin" },
      update: {
        customerId: "mock-customer-active",
        displayName: "Mock Customer A Admin",
        status: "active",
        clientAccessScope: "customer_all"
      },
      create: {
        id: "mock-client-user-admin",
        customerId: "mock-customer-active",
        accountId: "persistence-client-account-admin",
        displayName: "Mock Customer A Admin",
        status: "active",
        clientAccessScope: "customer_all"
      }
    });
    await cleanupPrisma.clientUser.upsert({
      where: { id: "mock-client-user-other" },
      update: {
        customerId: "mock-customer-other",
        displayName: "Mock Customer B User",
        status: "active",
        clientAccessScope: "own"
      },
      create: {
        id: "mock-client-user-other",
        customerId: "mock-customer-other",
        accountId: "persistence-client-account-other",
        displayName: "Mock Customer B User",
        status: "active",
        clientAccessScope: "own"
      }
    });
  });

  afterEach(async () => {
    const orders = await cleanupPrisma.order.findMany({
      where: { styleNo },
      select: { id: true }
    });
    const orderIds = orders.map((order) => order.id);

    if (orderIds.length > 0) {
      await cleanupPrisma.orderAttachment.deleteMany({ where: { orderId: { in: orderIds } } });
      await cleanupPrisma.orderCorrectionLog.deleteMany({ where: { orderId: { in: orderIds } } });
      await cleanupPrisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }

    await cleanupPrisma.$disconnect();
  });

  it("keeps client-created orders and receiver updates across fresh app initialization", async () => {
    expect(getPersistenceMode({ PERSISTENCE_MODE: "prisma" } as NodeJS.ProcessEnv)).toBe("prisma");
    expect(() =>
      createRuntimeSampleRoomRepository({
        PERSISTENCE_MODE: "prisma",
        DATABASE_URL: testDatabaseUrl
      } as NodeJS.ProcessEnv)
    ).not.toThrow();

    const firstPrisma = new PrismaClient({
      datasources: {
        db: {
          url: testDatabaseUrl
        }
      }
    });
    const firstApp = await startPrismaBackedApp(firstPrisma);

    let orderId: string;
    try {
      const created = await jsonRequest<{ order: Record<string, unknown> }>(
        firstApp.baseUrl,
        "/api/client/orders",
        {
          method: "POST",
          headers: clientHeaders("mock-client-user-active", "mock-customer-active", "own"),
          body: JSON.stringify({
            styleNo,
            styleName: "Persistence Acceptance Smoke",
            quantity: 5,
            sampleType: "first_sample",
            sampleRound: "round_1",
            patternStatus: PATTERN_STATUSES.has,
            deliveryDate: "2026-06-18",
            remark: "Automated Prisma persistence smoke"
          })
        }
      );
      orderId = created.order.id as string;
      expect(created.order).toMatchObject({
        styleNo,
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active",
        intakeStatus: INTAKE_STATUSES.pendingReceive
      });
      expectClientSafeOrder(created.order);

      const customerAList = await jsonRequest<{ orders: Array<Record<string, unknown>> }>(
        firstApp.baseUrl,
        "/api/client/orders",
        {
          headers: clientHeaders("mock-client-user-active", "mock-customer-active", "own")
        }
      );
      expect(customerAList.orders.some((order) => order.id === orderId)).toBe(true);

      const customerBList = await jsonRequest<{ orders: Array<Record<string, unknown>> }>(
        firstApp.baseUrl,
        "/api/client/orders",
        {
          headers: clientHeaders("mock-client-user-other", "mock-customer-other", "own")
        }
      );
      expect(customerBList.orders.some((order) => order.id === orderId)).toBe(false);

      const customerAdminList = await jsonRequest<{ orders: Array<Record<string, unknown>> }>(
        firstApp.baseUrl,
        "/api/client/orders",
        {
          headers: clientHeaders("mock-client-user-admin", "mock-customer-active", "customer_all")
        }
      );
      expect(customerAdminList.orders.some((order) => order.id === orderId)).toBe(true);

      const accepted = await jsonRequest<{ order: Record<string, unknown> }>(
        firstApp.baseUrl,
        `/api/receiver/orders/${orderId}/accept`,
        {
          method: "POST",
          headers: receiverHeaders,
          body: JSON.stringify({ patternStatus: PATTERN_STATUSES.has })
        }
      );
      expect(accepted.order).toMatchObject({
        id: orderId,
        intakeStatus: INTAKE_STATUSES.received,
        stage: ORDER_STAGES.cuttingWaiting,
        receivedBy: "mock-receiver"
      });
    } finally {
      await firstApp.close();
      await firstPrisma.$disconnect();
    }

    const secondPrisma = new PrismaClient({
      datasources: {
        db: {
          url: testDatabaseUrl
        }
      }
    });
    const secondApp = await startPrismaBackedApp(secondPrisma);

    try {
      const receiverOrders = await jsonRequest<{ orders: Array<Record<string, unknown>> }>(
        secondApp.baseUrl,
        "/api/receiver/orders",
        {
          headers: receiverHeaders
        }
      );
      const persistedOrder = receiverOrders.orders.find((order) => order.id === orderId);
      expect(persistedOrder).toMatchObject({
        id: orderId,
        styleNo,
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-active",
        intakeStatus: INTAKE_STATUSES.received,
        stage: ORDER_STAGES.cuttingWaiting,
        receivedBy: "mock-receiver"
      });

      const customerBListAfterRestart = await jsonRequest<{ orders: Array<Record<string, unknown>> }>(
        secondApp.baseUrl,
        "/api/client/orders",
        {
          headers: clientHeaders("mock-client-user-other", "mock-customer-other", "own")
        }
      );
      expect(customerBListAfterRestart.orders.some((order) => order.id === orderId)).toBe(false);

      const customerAListAfterRestart = await jsonRequest<{ orders: Array<Record<string, unknown>> }>(
        secondApp.baseUrl,
        "/api/client/orders",
        {
          headers: clientHeaders("mock-client-user-active", "mock-customer-active", "own")
        }
      );
      const clientOrder = customerAListAfterRestart.orders.find((order) => order.id === orderId);
      expect(clientOrder).toMatchObject({
        id: orderId,
        styleNo,
        intakeStatus: INTAKE_STATUSES.received
      });
      expectClientSafeOrder(clientOrder as Record<string, unknown>);
    } finally {
      await secondApp.close();
      await secondPrisma.$disconnect();
    }
  });
});
