import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PATTERN_STATUSES, ROLES } from "@sample-room/shared";
import { createApp } from "../../../app.js";
import { LocalFileStorageAdapter } from "../../../modules/files/localFileStorageAdapter.js";
import { createPrismaRepositoryContext } from "./prismaRepositoryContext.js";
import { createPrismaSampleRoomRepository } from "./prismaSampleRoomRepository.js";

const databaseUrl = process.env.PRISMA_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const runAttachmentStorageSmoke =
  process.env.RUN_PRISMA_ATTACHMENT_STORAGE_TESTS === "true" && Boolean(databaseUrl);
const describeIfPrismaDb = runAttachmentStorageSmoke ? describe : describe.skip;
const testDatabaseUrl =
  databaseUrl ?? "postgresql://user:pass@localhost:5432/sample_room_prisma_test?schema=public";

type JsonValue = Record<string, unknown>;

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

function multipartClientHeaders(
  clientUserId: string,
  customerId: string,
  scope: "own" | "customer_all"
) {
  const { "content-type": _contentType, ...headers } = clientHeaders(clientUserId, customerId, scope);
  return headers;
}

async function startApp(prisma: PrismaClient, storageRoot: string): Promise<TestApp> {
  const repository = createPrismaSampleRoomRepository(createPrismaRepositoryContext(prisma));
  const server: Server = createApp({
    repository,
    fileStorage: new LocalFileStorageAdapter(storageRoot)
  }).listen(0);

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

async function jsonRequest(pathname: string, baseUrl: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const body = (await response.json()) as JsonValue;
  return { response, body };
}

async function downloadRequest(pathname: string, baseUrl: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const content = Buffer.from(await response.arrayBuffer());
  return { response, content };
}

function uploadForm(fileName: string, content: string, contentType = "text/plain") {
  const form = new FormData();
  form.append("files", new Blob([content], { type: contentType }), fileName);
  form.append("category", "client_reference");
  return form;
}

describeIfPrismaDb("Prisma attachment storage smoke", () => {
  let prisma: PrismaClient;
  let storageRoot: string;
  let styleNo: string;

  beforeEach(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: testDatabaseUrl
        }
      }
    });
    storageRoot = await mkdtemp(path.join(os.tmpdir(), "sample-room-prisma-storage-"));
    styleNo = `ATTACH-PERSIST-${Date.now()}`;

    await prisma.customer.upsert({
      where: { id: "mock-customer-active" },
      update: { name: "Mock Active Customer", status: "active" },
      create: { id: "mock-customer-active", name: "Mock Active Customer", status: "active" }
    });
    await prisma.customer.upsert({
      where: { id: "mock-customer-other" },
      update: { name: "Mock Other Customer", status: "active" },
      create: { id: "mock-customer-other", name: "Mock Other Customer", status: "active" }
    });
    for (const account of [
      { id: "attachment-client-account-active", username: "attachment-client-active", displayName: "Mock Customer A User" },
      { id: "attachment-client-account-other", username: "attachment-client-other", displayName: "Mock Customer B User" }
    ]) {
      await prisma.account.upsert({
        where: { id: account.id },
        update: account,
        create: { ...account, accountType: "business", role: "client_business_user", status: "active", passwordHash: "test-only" }
      });
    }
    await prisma.clientUser.upsert({
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
        accountId: "attachment-client-account-active",
        displayName: "Mock Customer A User",
        status: "active",
        clientAccessScope: "own"
      }
    });
    await prisma.clientUser.upsert({
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
        accountId: "attachment-client-account-other",
        displayName: "Mock Customer B User",
        status: "active",
        clientAccessScope: "own"
      }
    });
  });

  afterEach(async () => {
    const orders = await prisma.order.findMany({ where: { styleNo }, select: { id: true } });
    const orderIds = orders.map((order) => order.id);
    if (orderIds.length > 0) {
      await prisma.orderAttachment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderCorrectionLog.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("keeps attachment metadata and local file bytes across fresh app initialization", async () => {
    const fileText = "prisma-backed file attachment bytes";
    const chineseFileName = "客户打样单_中文文件名.xlsx";
    const mojibakeFileName = Buffer.from(chineseFileName, "utf8").toString("latin1");
    const firstApp = await startApp(prisma, storageRoot);

    let orderId: string;
    let attachmentId: string;
    try {
      const created = await jsonRequest("/api/client/orders", firstApp.baseUrl, {
        method: "POST",
        headers: clientHeaders("mock-client-user-active", "mock-customer-active", "own"),
        body: JSON.stringify({
          styleNo,
          styleName: "Attachment Persistence Smoke",
          quantity: 1,
          sampleType: "first_sample",
          sampleRound: "round_1",
          patternStatus: PATTERN_STATUSES.none,
          deliveryDate: "2026-06-18"
        })
      });
      orderId = (created.body.order as JsonValue).id as string;

      const uploaded = await jsonRequest(
        `/api/client/orders/${orderId}/attachments`,
        firstApp.baseUrl,
        {
          method: "POST",
          headers: multipartClientHeaders("mock-client-user-active", "mock-customer-active", "own"),
          body: uploadForm(
            mojibakeFileName,
            fileText,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          )
        }
      );
      const attachment = (uploaded.body.attachments as JsonValue[])[0]!;
      attachmentId = attachment.id as string;
      expect(attachment).toMatchObject({
        fileName: chineseFileName,
        hasFile: true
      });
      expect(attachment).not.toHaveProperty("storageKey");

      const stored = await prisma.orderAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
      expect(stored.fileName).toBe(chineseFileName);
      expect(stored.storageKey).toMatch(/^orders\//);
      expect(stored.contentType).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      expect(stored.sizeBytes).toBe(Buffer.byteLength(fileText));
      expect(stored.checksum).toHaveLength(64);
    } finally {
      await firstApp.close();
    }

    const secondPrisma = new PrismaClient({
      datasources: {
        db: {
          url: testDatabaseUrl
        }
      }
    });
    const secondApp = await startApp(secondPrisma, storageRoot);
    try {
      const download = await downloadRequest(
        `/api/client/orders/${orderId}/attachments/${attachmentId}/download`,
        secondApp.baseUrl,
        {
          headers: multipartClientHeaders("mock-client-user-active", "mock-customer-active", "own")
        }
      );
      expect(download.response.status).toBe(200);
      expect(download.response.headers.get("content-disposition") ?? "").toContain(
        `filename*=UTF-8''${encodeURIComponent(chineseFileName)}`
      );
      expect(download.content.toString("utf8")).toBe(fileText);

      const otherCustomerDownload = await downloadRequest(
        `/api/client/orders/${orderId}/attachments/${attachmentId}/download`,
        secondApp.baseUrl,
        {
          headers: multipartClientHeaders("mock-client-user-other", "mock-customer-other", "own")
        }
      );
      expect(otherCustomerDownload.response.status).toBe(404);
    } finally {
      await secondApp.close();
      await secondPrisma.$disconnect();
    }
  });
});
