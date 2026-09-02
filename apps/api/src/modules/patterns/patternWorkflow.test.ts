import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INTAKE_STATUSES,
  MATERIAL_STATUSES,
  ORDER_STAGES,
  PATTERN_STATUSES,
  ROLES,
  SAMPLE_REQUEST_ITEMS
} from "@sample-room/shared";
import { createApp } from "../../app.js";
import {
  createInMemorySampleRoomRepository,
  type SampleRoomRepository
} from "../../db/repositories/sampleRoomRepository.js";
import { createInMemoryRepositoryContext } from "../../db/repositories/memory/inMemoryRepositoryContext.js";
import type { RepositoryContext } from "../../db/repositories/contracts/index.js";
import { syncPatternTaskForOrder } from "./patternTaskSync.js";

let server: Server;
let baseUrl: string;
let repository: SampleRoomRepository;
let identityRepositories: RepositoryContext;
let tempRoot: string;

function headers(role: string, userId = `mock-${role}`) {
  return {
    "content-type": "application/json",
    "x-dev-role": role,
    "x-dev-user-id": userId
  };
}

function multipartHeaders(role: string, userId = `mock-${role}`) {
  const { "content-type": _contentType, ...rest } = headers(role, userId);
  return rest;
}

async function jsonRequest(pathname: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = (await response.json()) as Record<string, unknown>;
  return { response, body };
}

async function rawRequest(pathname: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const content = Buffer.from(await response.arrayBuffer());
  return { response, content };
}

function expectNoInternalFilePaths(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const field of [
    "storageKey",
    "localPath",
    "rootPath",
    "relativePath",
    "patternWorkPath",
    "submittedCuttingPath",
    "cuttingInboxPath",
    "orderFolderPath",
    "readmePath",
    "inboundMaterialPath",
    "outboundPhotoPath",
    "oldVersionPath"
  ]) {
    expect(serialized).not.toContain(`\"${field}\"`);
  }
}

beforeEach(async () => {
  repository = createInMemorySampleRoomRepository();
  identityRepositories = createInMemoryRepositoryContext();
  tempRoot = await mkdtemp(path.join(tmpdir(), "sample-room-pattern-test-"));
  const app = createApp({
    repository,
    identityRepositoryContext: identityRepositories,
    env: {
      ...process.env,
      AUTH_MODE: "dev",
      SAMPLE_ROOM_LOCAL_FILE_ROOT: tempRoot,
      SAMPLE_ROOM_ORDER_FOLDER_ROOT: path.join(tempRoot, "orders"),
      SAMPLE_ROOM_CUTTING_INBOX_ROOT: path.join(tempRoot, "cutting")
    }
  });
  server = app.listen(0);

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test API did not bind to a TCP port.");
  }

  baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  await rm(tempRoot, { recursive: true, force: true });
});

async function createAcceptedPatternOrder() {
  const created = await jsonRequest("/api/client/orders", {
    method: "POST",
    headers: {
      ...headers(ROLES.clientBusinessUser, "mock-client-user-active"),
      "x-dev-customer-id": "mock-customer-active",
      "x-dev-client-user-id": "mock-client-user-active"
    },
    body: JSON.stringify({
      styleNo: "S004-PATTERN",
      styleName: "S004 Pattern Order",
      quantity: 5,
      sampleType: "first_sample",
      sampleRound: "round_1",
      patternStatus: "none",
      deliveryDate: "2026-06-30"
    })
  });
  const orderId = ((created.body.order as Record<string, unknown>).id) as string;
  const accepted = await jsonRequest(`/api/receiver/orders/${orderId}/accept`, {
    method: "POST",
    headers: headers(ROLES.receiver, "mock-receiver"),
    body: JSON.stringify({
      patternStatus: "none",
      fabricStatus: MATERIAL_STATUSES.missing,
      trimStatus: MATERIAL_STATUSES.missing
    })
  });

  expect(created.response.status).toBe(201);
  expect(accepted.response.status).toBe(200);
  return orderId;
}

async function receivePatternOrder(orderId: string, userId = "mock-pattern-maker") {
  const workbench = await jsonRequest("/api/pattern-maker/workbench", {
    headers: headers(ROLES.patternMaker, userId)
  });
  const pending = workbench.body.pending as Record<string, unknown>[];
  const task = pending.find((candidate) => candidate.orderId === orderId);
  expect(task).toBeDefined();
  const received = await jsonRequest(`/api/pattern-maker/tasks/${task!.id as string}/start`, {
    method: "POST",
    headers: headers(ROLES.patternMaker, userId)
  });
  expect(received.response.status).toBe(200);
  return (received.body.task as Record<string, unknown>);
}

async function uploadRequirementFiles(
  task: Record<string, unknown>,
  userId = "mock-pattern-maker"
) {
  for (const requirement of task.requirements as string[]) {
    const form = new FormData();
    form.append("deliverableType", "pattern_file");
    form.append("taskCategory", requirement);
    form.append("files", new Blob([`${requirement} result`], { type: "application/octet-stream" }), `${requirement}.dat`);
    const uploaded = await jsonRequest(`/api/pattern-maker/tasks/${task.id as string}/deliverable-versions`, {
      method: "POST",
      headers: multipartHeaders(ROLES.patternMaker, userId),
      body: form
    });
    expect(uploaded.response.status).toBe(201);
  }
}

describe("pattern maker local file workflow", () => {
  it("lets only pattern maker operate the pattern workflow and keeps client users away from local paths", async () => {
    const orderId = await createAcceptedPatternOrder();

    const clientAttempt = await jsonRequest("/api/pattern-maker/tasks", {
      headers: {
        ...headers(ROLES.clientBusinessUser, "mock-client-user-active"),
        "x-dev-customer-id": "mock-customer-active",
        "x-dev-client-user-id": "mock-client-user-active"
      }
    });
    expect(clientAttempt.response.status).toBe(403);
    const clientArchiveAttempt = await jsonRequest("/api/pattern-maker/archive", {
      headers: {
        ...headers(ROLES.clientBusinessUser, "mock-client-user-active"),
        "x-dev-customer-id": "mock-customer-active",
        "x-dev-client-user-id": "mock-client-user-active"
      }
    });
    expect(clientArchiveAttempt.response.status).toBe(403);

    const tasks = await jsonRequest("/api/pattern-maker/tasks", {
      headers: headers(ROLES.patternMaker, "mock-pattern-maker")
    });
    expect(tasks.response.status).toBe(200);
    expect(tasks.body.tasks as unknown[]).toHaveLength(0);

    const task = await receivePatternOrder(orderId);
    expect((task.order as Record<string, unknown>).styleNo).toBe("S004-PATTERN");
    expect((task.order as Record<string, unknown>).folderCode).toMatch(/^SR\d{11}$/);
    expect(task.status).toBe("active");
    expect(typeof task.startedAt).toBe("string");
    expect(task.orderFolder).not.toHaveProperty("patternWorkPath");
    expect(task.orderFolder).not.toHaveProperty("rootPath");
    expectNoInternalFilePaths(task);

    const folder = await jsonRequest(`/api/pattern-maker/orders/${task.orderId}/folder/generate`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker")
    });
    expect(folder.response.status).toBe(201);
    expect(folder.body.folder).toMatchObject({ orderId, folderName: expect.any(String) });
    expectNoInternalFilePaths(folder.body);
    const folderBeforeCorrection = await repository.findOrderFolderByOrderId(orderId);
    expect(folderBeforeCorrection).toBeTruthy();
    const corrected = await jsonRequest(`/api/receiver/orders/${orderId}/correction`, {
      method: "PATCH",
      headers: headers(ROLES.receiver, "mock-receiver"),
      body: JSON.stringify({ styleNo: "S004-CORRECTED" })
    });
    expect(corrected.response.status).toBe(200);
    const folderAfterCorrection = await jsonRequest(
      `/api/pattern-maker/orders/${task.orderId}/folder`,
      {
        headers: headers(ROLES.patternMaker, "mock-pattern-maker")
      }
    );
    expectNoInternalFilePaths(folderAfterCorrection.body);
    const readmeContent = await readFile(folderBeforeCorrection!.readmePath, "utf8");
    expect(readmeContent).toContain("S004-CORRECTED");
    expect(readmeContent).toContain(folderBeforeCorrection!.folderName);

    const libraryEntry = await jsonRequest("/api/pattern-library", {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify({
        styleNo: "S004-PATTERN",
        patternVersion: "library-v1",
        fileName: "S004-PATTERN.dxf",
        localPath: "Z:\\pattern-library\\S004-PATTERN.dxf"
      })
    });
    expect(libraryEntry.response.status).toBe(201);
    expectNoInternalFilePaths(libraryEntry.body);

    const linked = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/link-pattern`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify({
        libraryEntryId: (libraryEntry.body.entry as Record<string, unknown>).id
      })
    });
    expect(linked.response.status).toBe(200);
    expect((linked.body.task as Record<string, unknown>).linkedPatternLibraryEntryId).toBe(
      (libraryEntry.body.entry as Record<string, unknown>).id
    );
    expectNoInternalFilePaths(linked.body);

    const emptySubmission = await jsonRequest(
      `/api/pattern-maker/tasks/${task.id}/submit-cutting-version`,
      {
        method: "POST",
        headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
        body: JSON.stringify({
          workHours: 1,
          completedRequirements: task.requirements,
          textValue: "cutting handoff"
        })
      }
    );
    expect(emptySubmission.response.status).toBe(400);
    expect(emptySubmission.body.error).toBe("note is required.");

    const placeholderOnlySubmission = await jsonRequest(
      `/api/pattern-maker/tasks/${task.id}/submit-cutting-version`,
      {
        method: "POST",
        headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
        body: JSON.stringify({
          workHours: 1,
          note: "placeholder files do not count as a deliverable",
          completedRequirements: task.requirements,
          files: [{ fileName: "V1_cutting_package.placeholder" }]
        })
      }
    );
    expect(placeholderOnlySubmission.response.status).toBe(400);
    expect(placeholderOnlySubmission.body.error).toBe("请至少提交一种内容：版子文件或交付物。");

    const submissionForm = new FormData();
    submissionForm.append("workHours", "2.5");
    submissionForm.append("note", "cutting package ready");
    submissionForm.append("completedRequirements", JSON.stringify(task.requirements));
    submissionForm.append("deliverableType", "pattern_file");
    submissionForm.append("taskCategory", (task.requirements as string[])[0]!);
    submissionForm.append(
      "files",
      new Blob(["cutting package"], { type: "application/octet-stream" }),
      "S004-PATTERN-cutting.plt"
    );
    const submission = await jsonRequest(
      `/api/pattern-maker/tasks/${task.id}/submit-cutting-version`,
      {
        method: "POST",
        headers: multipartHeaders(ROLES.patternMaker, "mock-pattern-maker"),
        body: submissionForm
      }
    );
    expect(submission.response.status).toBe(201);
    expect((submission.body.submission as Record<string, unknown>).version).toBe("V1");
    expect((submission.body.submission as Record<string, unknown>).status).toBe("pending_print");
    expectNoInternalFilePaths(submission.body);

    const orderAfterSubmit = await repository.findOrderById(task.orderId as string);
    expect(orderAfterSubmit?.stage).toBe("cutting_waiting");
    expect(orderAfterSubmit?.patternStatus).toBe("has");
    expect(await repository.listScanRecordsByOrderId(task.orderId as string)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "pattern",
          action: "complete",
          actorType: "internal_account",
          actorRole: ROLES.patternMaker,
          workerId: "mock-pattern-maker",
          workerName: expect.any(String),
          workHours: 2.5
        })
      ])
    );

    await repository.updateOrder(task.orderId as string, { stage: ORDER_STAGES.cuttingWaiting });
    const activeTasksAfterCutting = await jsonRequest("/api/pattern-maker/tasks", {
      headers: headers(ROLES.patternMaker, "mock-pattern-maker")
    });
    expect(activeTasksAfterCutting.response.status).toBe(200);
    expect(activeTasksAfterCutting.body.tasks as unknown[]).toHaveLength(0);

    const archive = await jsonRequest("/api/pattern-maker/archive", {
      headers: headers(ROLES.patternMaker, "mock-pattern-maker")
    });
    expect(archive.response.status).toBe(200);
    expect(JSON.stringify(archive.body)).toContain("S004-PATTERN");
    expect(JSON.stringify(archive.body)).toContain("S004-PATTERN-cutting.plt");
    expect(JSON.stringify(archive.body)).toContain("V1");
    expectNoInternalFilePaths(archive.body);

    const clientOrders = await jsonRequest("/api/client/orders", {
      headers: {
        ...headers(ROLES.clientBusinessUser, "mock-client-user-active"),
        "x-dev-customer-id": "mock-customer-active",
        "x-dev-client-user-id": "mock-client-user-active"
      }
    });
    expect(clientOrders.response.status).toBe(200);
    expectNoInternalFilePaths(clientOrders.body);
    expect(JSON.stringify(clientOrders.body)).not.toContain("pattern-library");
  });

  it("requires the complete Phase1 checklist payload and keeps generic pattern attachments closed", async () => {
    const orderId = await createAcceptedPatternOrder();
    await repository.updateOrder(orderId, {
      sampleRequestItems: ["pattern_making"],
      sampleGarmentRequired: false,
      stage: ORDER_STAGES.done
    });
    const task = await receivePatternOrder(orderId);
    const requirements = task.requirements as string[];

    const missingHours = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/complete`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify({
        note: "pattern-only completion",
        completedRequirements: requirements,
        textValue: "explicit pattern result"
      })
    });
    expect(missingHours.response.status).toBe(400);

    const missingRequirements = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/complete`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify({
        workHours: 1.5,
        note: "pattern-only completion",
        textValue: "explicit pattern result"
      })
    });
    expect(missingRequirements.response.status).toBe(400);
    expect(missingRequirements.body.error).toBe("completedRequirements is required.");

    const incompleteRequirements = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/complete`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify({
        workHours: 1.5,
        note: "pattern-only completion",
        completedRequirements: [],
        textValue: "explicit pattern result"
      })
    });
    expect(incompleteRequirements.response.status).toBe(409);

    const missingDeliverable = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/complete`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify({
        workHours: 1.5,
        note: "pattern-only completion",
        completedRequirements: requirements
      })
    });
    expect(missingDeliverable.response.status).toBe(400);
    expect(missingDeliverable.body.error).toBe("请至少提交一种内容：版子文件或交付物。");

    await uploadRequirementFiles(task);
    const completed = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/complete`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify({
        note: "pattern-only completion",
        workHours: 1.5,
        completedRequirements: requirements,
        deliverableType: "process_note",
        textValue: "explicit pattern result"
      })
    });
    expect(completed.response.status).toBe(200);
    expect(JSON.stringify(completed.body)).toContain("pattern-only completion");
    expect(completed.body.task).toMatchObject({
      completedRequirements: requirements,
      totalWorkHours: 1.5,
      completionNote: "pattern-only completion"
    });
    expectNoInternalFilePaths(completed.body);
    const orderAfterComplete = await repository.findOrderById(orderId);
    expect(orderAfterComplete?.stage).toBe(ORDER_STAGES.done);
    await expect(
      syncPatternTaskForOrder(repository, {
        ...orderAfterComplete!,
        sampleRequestItems: ["pattern_making", "pattern_full_size"]
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(JSON.stringify(orderAfterComplete)).toContain("patternTask:complete");
    expect(JSON.stringify(orderAfterComplete)).not.toContain("complete_no_sample");
    expect(await repository.listScanRecordsByOrderId(orderId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "pattern",
          action: "complete",
          actorType: "internal_account",
          actorRole: ROLES.patternMaker,
          workerId: "mock-pattern-maker",
          workerName: expect.any(String),
          workHours: 1.5
        })
      ])
    );

    const genericAttachmentAttempt = await jsonRequest(`/api/pattern-maker/orders/${orderId}/attachments`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify({
        note: "generic pattern attachments are no longer writable",
        attachments: [
          {
            fileName: "legacy-generic-attachment.jpg",
            mimeType: "image/jpeg",
            size: 128,
            category: "pattern_maker_attachment",
            visibility: "client_visible"
          }
        ]
      })
    });
    expect(genericAttachmentAttempt.response.status).toBe(410);
    expect(await repository.listOrderAttachments(orderId)).toHaveLength(0);
  });

  it("does not expose receiver intake-only orders to pattern maker tasks or archive", async () => {
    await jsonRequest("/api/client/orders", {
      method: "POST",
      headers: {
        ...headers(ROLES.clientBusinessUser, "mock-client-user-active"),
        "x-dev-customer-id": "mock-customer-active",
        "x-dev-client-user-id": "mock-client-user-active"
      },
      body: JSON.stringify({
        styleNo: "PATTERN-PENDING-RECEIVE",
        styleName: "Pattern Pending Receive",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        patternStatus: "none",
        deliveryDate: "2026-06-30"
      })
    });
    const supplementOrder = await repository.createOrder({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      sourceType: "client_submission",
      createdBy: "mock-client-user-active",
      styleNo: "PATTERN-NEEDS-SUPPLEMENT",
      styleName: "Pattern Needs Supplement",
      quantity: 1,
      sampleType: "first_sample",
      sampleRound: "round_1",
      deliveryDate: "2026-06-30",
      intakeStatus: INTAKE_STATUSES.needsClientSupplement,
      stage: ORDER_STAGES.patternWaiting,
      patternStatus: PATTERN_STATUSES.none,
      fabricStatus: MATERIAL_STATUSES.missing,
      trimStatus: MATERIAL_STATUSES.missing
    });
    await repository.createPatternTask({
      orderId: supplementOrder.id,
      status: "pending"
    });
    const acceptedOrderId = await createAcceptedPatternOrder();

    const tasks = await jsonRequest("/api/pattern-maker/tasks", {
      headers: headers(ROLES.patternMaker, "mock-pattern-maker")
    });
    const archive = await jsonRequest("/api/pattern-maker/archive", {
      headers: headers(ROLES.patternMaker, "mock-pattern-maker")
    });
    const taskPayload = JSON.stringify(tasks.body);
    const archivePayload = JSON.stringify(archive.body);

    expect(tasks.response.status).toBe(200);
    expect(archive.response.status).toBe(200);
    expect(taskPayload).not.toContain("S004-PATTERN");
    expect(archivePayload).not.toContain("S004-PATTERN");
    expect(taskPayload).not.toContain("PATTERN-PENDING-RECEIVE");
    expect(taskPayload).not.toContain("PATTERN-NEEDS-SUPPLEMENT");
    expect(archivePayload).not.toContain("PATTERN-PENDING-RECEIVE");
    expect(archivePayload).not.toContain("PATTERN-NEEDS-SUPPLEMENT");

    await receivePatternOrder(acceptedOrderId);
    const receivedTasks = await jsonRequest("/api/pattern-maker/tasks", {
      headers: headers(ROLES.patternMaker, "mock-pattern-maker")
    });
    const receivedArchive = await jsonRequest("/api/pattern-maker/archive", {
      headers: headers(ROLES.patternMaker, "mock-pattern-maker")
    });
    expect(JSON.stringify(receivedTasks.body)).toContain("S004-PATTERN");
    expect(JSON.stringify(receivedArchive.body)).not.toContain("S004-PATTERN");
  });

  it("does not expose historical pattern-maker QR binding or scan-claim routes", async () => {
    const attempts = [
      ["/api/pattern-maker/mobile-bind-tokens", "POST"],
      ["/api/pattern-maker/mobile-bind/legacy-token", "GET"],
      ["/api/pattern-maker/mobile-bind/legacy-token/confirm", "POST"],
      ["/api/pattern-maker/mobile-scan/legacy-token/receive", "POST"],
      ["/api/pattern-maker/scan/legacy-token/receive", "POST"],
      ["/api/pattern-maker/devices", "GET"]
    ] as const;

    for (const [path, method] of attempts) {
      const result = await jsonRequest(path, {
        method,
        headers: headers(ROLES.patternMaker, "mock-pattern-maker")
      });
      expect(result.response.status).toBe(404);
    }
  });

  it("returns pattern-order attachments with existing audit logs after enforcing order read access", async () => {
    const orderId = await createAcceptedPatternOrder();
    await identityRepositories.accounts.updateAccount("formal-account-receiver", {
      displayName: "里与"
    });
    await identityRepositories.accounts.updateAccount("formal-account-pattern-maker", {
      displayName: "新版师姓名"
    });
    const task = await receivePatternOrder(orderId, "formal-account-pattern-maker");
    const attachment = await repository.createOrderAttachment({
      orderId,
      fileName: "source-reference.pdf",
      mimeType: "application/pdf",
      size: 128,
      category: "client_reference",
      uploadedBy: "formal-account-receiver",
      uploadedByRole: ROLES.receiver,
      uploadedByName: "Receiver",
      visibility: "client_visible",
      storageKey: "pattern/source-reference.pdf"
    });
    const chargeAttachment = await repository.createOrderAttachment({
      orderId,
      fileName: "charge-proof.jpg",
      mimeType: "image/jpeg",
      size: 64,
      category: "order_charge",
      uploadedBy: "formal-account-receiver",
      uploadedByRole: ROLES.receiver,
      visibility: "client_visible",
      storageKey: "pattern/charge-proof.jpg"
    });
    const deliverable = await repository.createPatternDeliverable({
      orderId,
      patternTaskId: task.id as string,
      version: "V1",
      type: "pattern_file",
      fileName: "pattern-current-name.dxf",
      visibility: "internal_only",
      uploadedBy: "formal-account-pattern-maker",
      uploadedByName: "Pattern Maker",
      storageKey: "pattern/pattern-current-name.dxf"
    });
    const log = (await repository.listAttachmentAuditLogs(orderId)).find(
      (candidate) => candidate.attachmentId === attachment.id
    )!;

    const result = await jsonRequest(`/api/pattern-maker/orders/${orderId}/attachments`, {
      headers: headers(ROLES.patternMaker, "formal-account-pattern-maker")
    });
    expect(result.response.status).toBe(200);
    expect(result.body.attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: attachment.id,
        fileName: attachment.fileName,
        uploadedByName: "里与"
      })
    ]));
    expect(result.body.attachments).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: chargeAttachment.id })
    ]));
    expect(result.body.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: log.id,
        attachmentId: attachment.id,
        action: "upload",
        actorName: "里与",
        originalUploaderName: "里与"
      })
    ]));
    expectNoInternalFilePaths(result.body);

    const workbench = await jsonRequest("/api/pattern-maker/workbench", {
      headers: headers(ROLES.patternMaker, "formal-account-pattern-maker")
    });
    expect(workbench.response.status).toBe(200);
    expect(((workbench.body.current as Record<string, unknown>).deliverables as Record<string, unknown>[]))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: deliverable.id, uploadedByName: "新版师姓名" })
      ]));

    const foreignPatternMaker = await jsonRequest(`/api/pattern-maker/orders/${orderId}/attachments`, {
      headers: headers(ROLES.patternMaker, "another-pattern-maker")
    });
    expect(foreignPatternMaker.response.status).toBe(403);
  });

  it("allows file and text deliverables while exposing internal deliverable downloads only through Web API", async () => {
    const fileOnlyOrderId = await createAcceptedPatternOrder();
    await repository.updateOrder(fileOnlyOrderId, {
      sampleRequestItems: ["pattern_making"],
      sampleGarmentRequired: false,
      stage: ORDER_STAGES.done
    });
    const fileOnlyTask = await receivePatternOrder(fileOnlyOrderId, "mock-pattern-maker");
    const fileOnlyRequirements = fileOnlyTask.requirements as string[];
    const missingCategoryForm = new FormData();
    missingCategoryForm.append("workHours", "1.25");
    missingCategoryForm.append("note", "missing task category");
    missingCategoryForm.append("completedRequirements", JSON.stringify(fileOnlyTask.requirements));
    missingCategoryForm.append("deliverableType", "pattern_file");
    missingCategoryForm.append("files", new Blob(["invalid file"], { type: "application/octet-stream" }), "unlabelled.any");
    const missingCategory = await jsonRequest(`/api/pattern-maker/tasks/${fileOnlyTask.id}/complete`, {
      method: "POST",
      headers: multipartHeaders(ROLES.patternMaker, "mock-pattern-maker"),
      body: missingCategoryForm
    });
    expect(missingCategory.response.status).toBe(400);

    const formData = new FormData();
    formData.append("workHours", "1.25");
    formData.append("note", "multipart completion with an explicit file deliverable");
    formData.append("completedRequirements", JSON.stringify(fileOnlyTask.requirements));
    formData.append("deliverableType", "pattern_file");
    formData.append("taskCategory", fileOnlyRequirements[0]!);
    formData.append("files", new Blob(["pattern file bytes"], { type: "text/plain" }), "pattern-only.dxf");

    const fileOnlyCompletion = await jsonRequest(`/api/pattern-maker/tasks/${fileOnlyTask.id}/complete`, {
      method: "POST",
      headers: multipartHeaders(ROLES.patternMaker, "mock-pattern-maker"),
      body: formData
    });
    expect(fileOnlyCompletion.response.status).toBe(200);
    expectNoInternalFilePaths(fileOnlyCompletion.body);
    expect((fileOnlyCompletion.body.task as Record<string, unknown>).completedRequirements).toEqual(
      fileOnlyTask.requirements
    );
    expect((await repository.findOrderById(fileOnlyOrderId))?.stage).toBe(ORDER_STAGES.done);

    const deliverable = (await repository.listPatternDeliverablesByOrderId(fileOnlyOrderId)).find(
      (item) => item.fileName === "pattern-only.dxf"
    );
    expect(deliverable?.storageKey).toBeTruthy();
    expect(deliverable?.taskCategory).toBe(fileOnlyRequirements[0]);
    expect(deliverable?.visibility).toBe("client_visible");
    expect(await repository.listAttachmentAuditLogs(fileOnlyOrderId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "upload",
          attachmentId: deliverable?.id,
          originalFileName: "pattern-only.dxf",
          patternTaskCategory: fileOnlyRequirements[0]
        })
      ])
    );

    const downloadPaths = [
      {
        pathname: `/api/admin/orders/${fileOnlyOrderId}/pattern-deliverables/${deliverable!.id}/download`,
        role: ROLES.boss
      },
      {
        pathname: `/api/receiver/orders/${fileOnlyOrderId}/pattern-deliverables/${deliverable!.id}/download`,
        role: ROLES.receiver
      },
      {
        pathname: `/api/pattern-maker/orders/${fileOnlyOrderId}/pattern-deliverables/${deliverable!.id}/download`,
        role: ROLES.patternMaker,
        userId: "mock-pattern-maker"
      }
    ];

    for (const item of downloadPaths) {
      const downloaded = await rawRequest(item.pathname, {
        headers: headers(item.role, item.userId ?? `mock-${item.role}`)
      });
      expect(downloaded.response.status).toBe(200);
      expect(downloaded.content.toString("utf8")).toBe("pattern file bytes");
      expect(downloaded.response.headers.get("content-disposition") ?? "").toContain("pattern-only.dxf");
      expect(downloaded.response.headers.get("storageKey")).toBeNull();
      expect(item.pathname).not.toMatch(/^[a-zA-Z]:|\\\\/);
    }

    const clientAttempt = await rawRequest(
      `/api/pattern-maker/orders/${fileOnlyOrderId}/pattern-deliverables/${deliverable!.id}/download`,
      {
        headers: headers(ROLES.clientBusinessUser, "mock-client-user-active")
      }
    );
    expect(clientAttempt.response.status).toBe(403);

    const foreignDelete = await jsonRequest(
      `/api/pattern-maker/orders/${fileOnlyOrderId}/pattern-deliverables/${deliverable!.id}`,
      { method: "DELETE", headers: headers(ROLES.patternMaker, "another-pattern-maker") }
    );
    expect(foreignDelete.response.status).toBe(403);
    const ownDelete = await jsonRequest(
      `/api/pattern-maker/orders/${fileOnlyOrderId}/pattern-deliverables/${deliverable!.id}`,
      { method: "DELETE", headers: headers(ROLES.patternMaker, "mock-pattern-maker") }
    );
    expect(ownDelete.response.status).toBe(409);
    expect(ownDelete.body.error).toBe("pattern_deliverable_minimum_required");
    expect((await repository.listPatternDeliverablesByOrderId(fileOnlyOrderId)).some((item) => item.id === deliverable!.id)).toBe(true);

    const textOnlyOrderId = await createAcceptedPatternOrder();
    const textOnlyTask = await receivePatternOrder(textOnlyOrderId, "mock-pattern-maker");
    const textOnlySubmission = await jsonRequest(
      `/api/pattern-maker/tasks/${textOnlyTask.id}/submit-cutting-version`,
      {
        method: "POST",
        headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
        body: JSON.stringify({
          workHours: 0.75,
          note: "zipper length and cutting handoff are recorded as text deliverables",
          completedRequirements: textOnlyTask.requirements,
          deliverableType: "zipper_length",
          textValue: "zipper length: 36 cm"
        })
      }
    );
    expect(textOnlySubmission.response.status).toBe(409);
    expect(textOnlySubmission.body.error).toBe(
      "pattern making and revision requirements need matching uploaded files before completion."
    );
    expect((await repository.findOrderById(textOnlyOrderId))?.stage).toBe(ORDER_STAGES.patternWaiting);
  });

  it("releases physical production after labelled making results and allows an empty completion note", async () => {
    const orderId = await createAcceptedPatternOrder();
    expect((await repository.findOrderById(orderId))?.stage).toBe(ORDER_STAGES.patternWaiting);
    const task = await receivePatternOrder(orderId, "mock-pattern-maker");
    const upload = new FormData();
    upload.append("deliverableType", "pattern_file");
    upload.append("taskCategory", "pattern_making");
    upload.append("files", new Blob(["pattern result"], { type: "application/octet-stream" }), "making-result.dxf");
    const uploaded = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/deliverable-versions`, {
      method: "POST",
      headers: multipartHeaders(ROLES.patternMaker, "mock-pattern-maker"),
      body: upload
    });
    expect(uploaded.response.status).toBe(201);
    expect((await repository.findOrderById(orderId))?.stage).toBe(ORDER_STAGES.cuttingWaiting);

    const completed = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/complete`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify({
        workHours: 1,
        completedRequirements: task.requirements
      })
    });
    expect(completed.response.status).toBe(200);
    expect((completed.body.task as Record<string, unknown>).completionNote).toBe("");
  });

  it("allows comprehensive completion after blocking files while non-blocking requirements remain pending", async () => {
    const orderId = await createAcceptedPatternOrder();
    const task = await receivePatternOrder(orderId, "mock-pattern-maker");
    await repository.updatePatternTask(task.id as string, {
      requirements: ["pattern_making", "pattern_zipper_length"]
    });

    const upload = new FormData();
    upload.append("deliverableType", "pattern_file");
    upload.append("taskCategory", "pattern_making");
    upload.append("files", new Blob(["pattern result"], { type: "application/octet-stream" }), "making-only.dxf");
    expect((await jsonRequest(`/api/pattern-maker/tasks/${task.id}/deliverable-versions`, {
      method: "POST",
      headers: multipartHeaders(ROLES.patternMaker, "mock-pattern-maker"),
      body: upload
    })).response.status).toBe(201);

    const completed = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/complete`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify({
        workHours: 1,
        completedRequirements: ["pattern_making"]
      })
    });
    expect(completed.response.status).toBe(200);
    expect((completed.body.task as Record<string, unknown>).completedRequirements).toEqual(["pattern_making"]);
  });

  it("allows non-blocking-only comprehensive tasks to complete without a fabricated deliverable", async () => {
    const orderId = await createAcceptedPatternOrder();
    const task = await receivePatternOrder(orderId, "mock-pattern-maker");
    await repository.updatePatternTask(task.id as string, {
      requirements: ["pattern_zipper_length"]
    });

    const completed = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/complete`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify({
        workHours: 0.5,
        completedRequirements: []
      })
    });
    expect(completed.response.status).toBe(200);
    expect((completed.body.task as Record<string, unknown>).completedRequirements).toEqual([]);
  });

  it("enforces task ownership and appends V2/V3 only to independent pattern deliverables", async () => {
    const orderId = await createAcceptedPatternOrder();
    await repository.updateOrder(orderId, {
      sampleRequestItems: ["pattern_making"],
      sampleGarmentRequired: false,
      stage: ORDER_STAGES.done
    });
    const task = await receivePatternOrder(orderId, "mock-pattern-maker");
    const taskRequirements = task.requirements as string[];
    const completionPayload = {
      workHours: 1.25,
      note: "V1 pattern work completed",
      completedRequirements: task.requirements,
      deliverableType: "process_note",
      textValue: "V1 pattern result"
    };

    const foreignComplete = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/complete`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker-2"),
      body: JSON.stringify(completionPayload)
    });
    expect(foreignComplete.response.status).toBe(403);

    const foreignSubmit = await jsonRequest(
      `/api/pattern-maker/tasks/${task.id}/submit-cutting-version`,
      {
        method: "POST",
        headers: headers(ROLES.patternMaker, "mock-pattern-maker-2"),
        body: JSON.stringify({
          workHours: 1.25,
          note: "foreign cutting handoff",
          completedRequirements: task.requirements,
          textValue: "foreign pattern result"
        })
      }
    );
    expect(foreignSubmit.response.status).toBe(403);

    await uploadRequirementFiles(task);
    const completed = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/complete`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify(completionPayload)
    });
    expect(completed.response.status).toBe(200);
    expectNoInternalFilePaths(completed.body);

    const foreignAppend = await jsonRequest(
      `/api/pattern-maker/tasks/${task.id}/deliverable-versions`,
      {
        method: "POST",
        headers: headers(ROLES.patternMaker, "mock-pattern-maker-2"),
        body: JSON.stringify({
          deliverableType: "revision_note",
          textValue: "unauthorized V2"
        })
      }
    );
    expect(foreignAppend.response.status).toBe(403);

    const v2FormData = new FormData();
    v2FormData.append("deliverableType", "pattern_file");
    v2FormData.append("taskCategory", taskRequirements[0]!);
    v2FormData.append("files", new Blob(["V2 file bytes"], { type: "text/plain" }), "pattern-v2.dxf");
    const v2 = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/deliverable-versions`, {
      method: "POST",
      headers: multipartHeaders(ROLES.patternMaker, "mock-pattern-maker"),
      body: v2FormData
    });
    expect(v2.response.status).toBe(201);
    expectNoInternalFilePaths(v2.body);

    const v3FormData = new FormData();
    v3FormData.append("deliverableType", "revision_note");
    v3FormData.append("taskCategory", taskRequirements[0]!);
    v3FormData.append("files", new Blob(["V3 revision"], { type: "text/plain" }), "revision-v3.txt");
    const v3 = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/deliverable-versions`, {
      method: "POST",
      headers: multipartHeaders(ROLES.patternMaker, "mock-pattern-maker"),
      body: v3FormData
    });
    expect(v3.response.status).toBe(201);
    expectNoInternalFilePaths(v3.body);

    const concurrentVersions = await Promise.all(
      ["concurrent revision A", "concurrent revision B"].map((textValue) => {
        const form = new FormData();
        form.append("deliverableType", "revision_note");
        form.append("taskCategory", taskRequirements[0]!);
        form.append("files", new Blob([textValue], { type: "text/plain" }), `${textValue}.txt`);
        return jsonRequest(`/api/pattern-maker/tasks/${task.id}/deliverable-versions`, {
          method: "POST",
          headers: multipartHeaders(ROLES.patternMaker, "mock-pattern-maker"),
          body: form
        });
      })
    );
    expect(concurrentVersions.map((result) => result.response.status)).toEqual([201, 201]);

    expect((await repository.listPatternDeliverablesByOrderId(orderId))
      .filter((item) => item.taskCategory === taskRequirements[0])
      .map((item) => item.version)).toEqual([
      "V1",
      "V2",
      "V3",
      "V4",
      "V5"
    ]);

    const firstOtherCategoryFile = new FormData();
    firstOtherCategoryFile.append("deliverableType", "pattern_file");
    firstOtherCategoryFile.append("taskCategory", "other");
    firstOtherCategoryFile.append("files", new Blob(["other category bytes"], { type: "text/plain" }), "other-first.txt");
    const otherV1 = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/deliverable-versions`, {
      method: "POST",
      headers: multipartHeaders(ROLES.patternMaker, "mock-pattern-maker"),
      body: firstOtherCategoryFile
    });
    expect(otherV1.response.status).toBe(201);
    expect((await repository.listPatternDeliverablesByOrderId(orderId))
      .filter((item) => item.taskCategory === "other")
      .map((item) => item.version)).toEqual(["V1"]);
    expect(await repository.listOrderAttachments(orderId)).toHaveLength(0);
    expect(await repository.listSubmittedCuttingVersionsByOrderId(orderId)).toHaveLength(0);
    expect((await repository.findOrderById(orderId))?.latestPatternVersion).toBe("V5");
  });

  it("repairs stale completed tasks without matching files into the owner's paused list", async () => {
    const orderId = await createAcceptedPatternOrder();
    const task = await receivePatternOrder(orderId, "mock-pattern-maker");
    await repository.updatePatternTask(task.id as string, {
      status: "completed",
      completedRequirements: ["pattern_making"],
      completedAt: new Date().toISOString()
    });

    const workbench = await jsonRequest("/api/pattern-maker/workbench", {
      headers: headers(ROLES.patternMaker, "mock-pattern-maker")
    });
    expect(workbench.response.status).toBe(200);
    expect(workbench.body.history).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: task.id
        })
      ])
    );
    expect(workbench.body.paused).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: task.id,
          status: "paused",
          completedRequirements: []
        })
      ])
    );
  });

  it("lets receiver remove a paused pattern task and rejects a stale resume", async () => {
    const firstOrderId = await createAcceptedPatternOrder();
    const firstTask = await receivePatternOrder(firstOrderId, "mock-pattern-maker");
    const secondOrderId = await createAcceptedPatternOrder();
    await receivePatternOrder(secondOrderId, "mock-pattern-maker");
    expect(await repository.findPatternTaskById(firstTask.id as string)).toMatchObject({
      status: "paused"
    });

    const corrected = await jsonRequest(`/api/receiver/orders/${firstOrderId}/correction`, {
      method: "PATCH",
      headers: headers(ROLES.receiver, "mock-receiver"),
      body: JSON.stringify({
        sampleRequestItems: [
          SAMPLE_REQUEST_ITEMS.sampleGarment,
          SAMPLE_REQUEST_ITEMS.cutting
        ]
      })
    });
    expect(corrected.response.status).toBe(200);

    const workbench = await jsonRequest("/api/pattern-maker/workbench", {
      headers: headers(ROLES.patternMaker, "mock-pattern-maker")
    });
    expect(workbench.response.status).toBe(200);
    expect(workbench.body.paused).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: firstTask.id })])
    );

    const staleResume = await jsonRequest(`/api/pattern-maker/tasks/${firstTask.id as string}/resume`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker")
    });
    expect(staleResume.response.status).toBe(409);
    expect(staleResume.body.error).toBe("该制版任务已被接单员取消，请返回任务列表。");
  });

  it("rolls back initial completion failures and accumulates supplemental-version hours once", async () => {
    const originalCreateScanRecord = repository.createScanRecord.bind(repository);
    const failWorkHourRecord = () => {
      repository.createScanRecord = (() => {
        throw new Error("forced scan record failure");
      }) as typeof repository.createScanRecord;
    };
    const restoreWorkHourRecord = () => {
      repository.createScanRecord = originalCreateScanRecord as typeof repository.createScanRecord;
    };

    const cuttingOrderId = await createAcceptedPatternOrder();
    const cuttingTask = await receivePatternOrder(cuttingOrderId, "mock-pattern-maker");
    failWorkHourRecord();
    const failedCuttingForm = new FormData();
    failedCuttingForm.append("workHours", "1");
    failedCuttingForm.append("note", "should rollback");
    failedCuttingForm.append("completedRequirements", JSON.stringify(cuttingTask.requirements));
    failedCuttingForm.append("deliverableType", "pattern_file");
    failedCuttingForm.append("taskCategory", (cuttingTask.requirements as string[])[0]!);
    failedCuttingForm.append(
      "files",
      new Blob(["cutting handoff"], { type: "application/octet-stream" }),
      "cutting-handoff.plt"
    );
    const failedCuttingSubmission = await jsonRequest(
      `/api/pattern-maker/tasks/${cuttingTask.id}/submit-cutting-version`,
      {
        method: "POST",
        headers: multipartHeaders(ROLES.patternMaker, "mock-pattern-maker"),
        body: failedCuttingForm
      }
    );
    restoreWorkHourRecord();
    expect(failedCuttingSubmission.response.status).toBe(500);
    expect(await repository.listPatternDeliverablesByOrderId(cuttingOrderId)).toHaveLength(0);
    expect(await repository.listSubmittedCuttingVersionsByOrderId(cuttingOrderId)).toHaveLength(0);
    expect((await repository.findOrderById(cuttingOrderId))?.stage).toBe(ORDER_STAGES.patternWaiting);

    const noSampleOrderId = await createAcceptedPatternOrder();
    await repository.updateOrder(noSampleOrderId, {
      sampleRequestItems: ["pattern_making"],
      sampleGarmentRequired: false,
      stage: ORDER_STAGES.done
    });
    const noSampleTask = await receivePatternOrder(noSampleOrderId, "mock-pattern-maker");
    await uploadRequirementFiles(noSampleTask);
    const noSampleDeliverableCount = (await repository.listPatternDeliverablesByOrderId(noSampleOrderId)).length;
    failWorkHourRecord();
    const failedCompletion = await jsonRequest(`/api/pattern-maker/tasks/${noSampleTask.id}/complete`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify({
        workHours: 1,
        note: "should rollback",
        completedRequirements: noSampleTask.requirements,
        deliverableType: "process_note",
        textValue: "pattern completion details"
      })
    });
    restoreWorkHourRecord();
    expect(failedCompletion.response.status).toBe(500);
    expect(await repository.listPatternDeliverablesByOrderId(noSampleOrderId)).toHaveLength(noSampleDeliverableCount);
    expect(await repository.listSubmittedCuttingVersionsByOrderId(noSampleOrderId)).toHaveLength(0);
    expect((await repository.findOrderById(noSampleOrderId))?.stage).toBe(ORDER_STAGES.done);

    const supplementOrderId = await createAcceptedPatternOrder();
    const supplementTask = await receivePatternOrder(supplementOrderId, "mock-pattern-maker");
    const firstSubmissionForm = new FormData();
    firstSubmissionForm.append("workHours", "1");
    firstSubmissionForm.append("note", "V1 ready");
    firstSubmissionForm.append("completedRequirements", JSON.stringify(supplementTask.requirements));
    firstSubmissionForm.append("deliverableType", "pattern_file");
    firstSubmissionForm.append("taskCategory", (supplementTask.requirements as string[])[0]!);
    firstSubmissionForm.append(
      "files",
      new Blob(["supplement base"], { type: "application/octet-stream" }),
      "supplement-base.plt"
    );
    const firstSubmission = await jsonRequest(
      `/api/pattern-maker/tasks/${supplementTask.id}/submit-cutting-version`,
      {
        method: "POST",
        headers: multipartHeaders(ROLES.patternMaker, "mock-pattern-maker"),
        body: firstSubmissionForm
      }
    );
    expect(firstSubmission.response.status).toBe(201);
    failWorkHourRecord();
    const failedSupplement = await jsonRequest(
      `/api/pattern-maker/tasks/${supplementTask.id}/supplement-version`,
      {
        method: "POST",
        headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
        body: JSON.stringify({
          workHours: 0.5,
          note: "V2 should rollback",
          deliverableType: "revision_note",
          textValue: "V2 revision details"
        })
      }
    );
    restoreWorkHourRecord();
    expect(failedSupplement.response.status).toBe(201);
    const supplementDeliverables = await repository.listPatternDeliverablesByOrderId(supplementOrderId);
    const supplementSubmissions = await repository.listSubmittedCuttingVersionsByOrderId(supplementOrderId);
    expect(supplementDeliverables.map((deliverable) => deliverable.version)).toEqual(["V1", "V1", "V2"]);
    expect(supplementSubmissions.map((submission) => submission.version)).toEqual(["V1", "V2"]);
    expect((await repository.findPatternTaskById(supplementTask.id as string))?.totalWorkHours).toBe(1.5);
    expect(
      (await repository.listScanRecordsByOrderId(supplementOrderId)).filter(
        (record) => record.stage === "pattern" && record.action === "complete"
      )
    ).toHaveLength(1);
    const performance = await jsonRequest("/api/admin/performance?stage=pattern", {
      headers: headers(ROLES.boss, "mock-boss")
    });
    expect(performance.response.status).toBe(200);
    expect((performance.body.overview as Record<string, unknown>).pattern).toMatchObject({
      completedStyles: 1,
      totalHours: 1.5
    });
    expect(performance.body.anomalies).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orderId: supplementOrderId,
          code: "multiple_completion_records"
        })
      ])
    );
  });

  it("keeps completed pattern notes and rejects later pattern writes after termination", async () => {
    const orderId = await createAcceptedPatternOrder();
    const task = await receivePatternOrder(orderId);
    const beforeTermination = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/operation`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify({ operation: "grade", note: "终止前已提交" })
    });
    expect(beforeTermination.response.status).toBe(200);

    const terminated = await jsonRequest(`/api/admin/orders/${orderId}/terminate`, {
      method: "POST",
      headers: headers(ROLES.boss, "mock-boss"),
      body: JSON.stringify({ reason: "stop pattern writes" })
    });
    expect(terminated.response.status).toBe(200);

    const afterTermination = await jsonRequest(`/api/pattern-maker/tasks/${task.id}/operation`, {
      method: "POST",
      headers: headers(ROLES.patternMaker, "mock-pattern-maker"),
      body: JSON.stringify({ operation: "adjust_pattern", note: "终止后不得写入" })
    });
    expect(afterTermination.response.status).toBe(409);
    expect((await repository.findPatternTaskById(task.id as string))?.note).toContain("终止前已提交");
    expect((await repository.findPatternTaskById(task.id as string))?.note).not.toContain("终止后不得写入");
  });

  it("lists cutting handoffs immediately for completion-only cutting and updates file status", async () => {
    const orderId = await createAcceptedPatternOrder();
    const task = await receivePatternOrder(orderId);
    const handoffForm = new FormData();
    handoffForm.append("workHours", "2");
    handoffForm.append("note", "cutting package ready");
    handoffForm.append("completedRequirements", JSON.stringify(task.requirements));
    handoffForm.append("deliverableType", "pattern_file");
    handoffForm.append("taskCategory", (task.requirements as string[])[0]!);
    handoffForm.append(
      "files",
      new Blob(["completion only"], { type: "application/octet-stream" }),
      "completion-only.plt"
    );
    const submission = await jsonRequest(
      `/api/pattern-maker/tasks/${task.id}/submit-cutting-version`,
      {
        method: "POST",
        headers: multipartHeaders(ROLES.patternMaker, "mock-pattern-maker"),
        body: handoffForm
      }
    );
    expect(submission.response.status).toBe(201);
    expectNoInternalFilePaths(submission.body);
    const submissionId = (submission.body.submission as Record<string, unknown>).id as string;

    const completionOnlyInbox = await jsonRequest("/api/cutting-room/submissions", {
      headers: headers(ROLES.boss, "mock-boss")
    });
    expect(completionOnlyInbox.response.status).toBe(200);
    expect((completionOnlyInbox.body.submissions as unknown[])).toHaveLength(1);
    expectNoInternalFilePaths(completionOnlyInbox.body);
    expect(await repository.listScanRecordsByOrderId(task.orderId as string)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ scanAction: "cutting_start" })])
    );

    const receiverAttempt = await jsonRequest("/api/cutting-room/submissions", {
      headers: headers(ROLES.receiver, "mock-receiver")
    });
    expect(receiverAttempt.response.status).toBe(403);

    const cuttingInbox = await jsonRequest("/api/cutting-room/submissions", {
      headers: headers(ROLES.boss, "mock-boss")
    });
    expect(cuttingInbox.response.status).toBe(200);
    expect((cuttingInbox.body.submissions as unknown[])).toHaveLength(1);
    expect(JSON.stringify(cuttingInbox.body)).not.toContain("attachments");
    expect(JSON.stringify(cuttingInbox.body)).not.toContain("scanRecords");
    expectNoInternalFilePaths(cuttingInbox.body);

    const printed = await jsonRequest(`/api/cutting-room/submissions/${submissionId}/mark-printed`, {
      method: "POST",
      headers: headers(ROLES.boss, "mock-boss")
    });
    const cut = await jsonRequest(`/api/cutting-room/submissions/${submissionId}/mark-cut`, {
      method: "POST",
      headers: headers(ROLES.boss, "mock-boss")
    });

    expect((printed.body.submission as Record<string, unknown>).status).toBe("printed");
    expect((cut.body.submission as Record<string, unknown>).status).toBe("cut");
    expectNoInternalFilePaths(printed.body);
    expectNoInternalFilePaths(cut.body);

    const terminated = await jsonRequest(`/api/admin/orders/${orderId}/terminate`, {
      method: "POST",
      headers: headers(ROLES.boss, "mock-boss"),
      body: JSON.stringify({ reason: "stop cutting updates" })
    });
    expect(terminated.response.status).toBe(200);
    const staleCuttingUpdate = await jsonRequest(
      `/api/cutting-room/submissions/${submissionId}/mark-printed`,
      {
        method: "POST",
        headers: headers(ROLES.boss, "mock-boss")
      }
    );
    expect(staleCuttingUpdate.response.status).toBe(409);
    expect((await repository.findSubmittedCuttingVersionById(submissionId))?.status).toBe("cut");

    const clientAttempt = await jsonRequest("/api/cutting-room/submissions", {
      headers: {
        ...headers(ROLES.clientBusinessUser, "mock-client-user-active"),
        "x-dev-customer-id": "mock-customer-active",
        "x-dev-client-user-id": "mock-client-user-active"
      }
    });
    expect(clientAttempt.response.status).toBe(403);
  });

  it("lazily backfills missing received tasks and keeps one active task after concurrent resumes", async () => {
    const legacyOrder = await repository.createOrder({
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      sourceType: "receiver_self_entry",
      createdBy: "mock-receiver",
      styleNo: "LEGACY-MISSING-TASK",
      styleName: "Legacy Missing Task",
      quantity: 1,
      sampleType: "first_sample",
      sampleRound: "round_1",
      deliveryDate: "2026-06-30",
      intakeStatus: INTAKE_STATUSES.received,
      stage: ORDER_STAGES.done,
      patternStatus: PATTERN_STATUSES.none,
      fabricStatus: MATERIAL_STATUSES.complete,
      trimStatus: MATERIAL_STATUSES.complete,
      sampleRequestItems: ["pattern_revision"],
      sampleGarmentRequired: false
    });
    expect(await repository.findPatternTaskByOrderId(legacyOrder.id)).toBeUndefined();
    const workbench = await jsonRequest("/api/pattern-maker/workbench", {
      headers: headers(ROLES.patternMaker, "mock-pattern-maker")
    });
    expect(workbench.response.status).toBe(200);
    expect(await repository.findPatternTaskByOrderId(legacyOrder.id)).toMatchObject({
      status: "pending",
      requirements: ["pattern_revision"]
    });

    const firstOrderId = await createAcceptedPatternOrder();
    const first = await receivePatternOrder(firstOrderId, "mock-pattern-maker");
    const secondOrderId = await createAcceptedPatternOrder();
    const second = await receivePatternOrder(secondOrderId, "mock-pattern-maker");
    await repository.updatePatternTask(second.id as string, {
      status: "paused",
      pausedAt: new Date().toISOString(),
      pausedReason: "test setup"
    });

    const [resumeFirst, resumeSecond] = await Promise.all([
      jsonRequest(`/api/pattern-maker/tasks/${first.id as string}/resume`, {
        method: "POST",
        headers: headers(ROLES.patternMaker, "mock-pattern-maker")
      }),
      jsonRequest(`/api/pattern-maker/tasks/${second.id as string}/resume`, {
        method: "POST",
        headers: headers(ROLES.patternMaker, "mock-pattern-maker")
      })
    ]);
    expect([resumeFirst.response.status, resumeSecond.response.status]).toEqual([200, 200]);
    const assigned = (await repository.listPatternTasks()).filter(
      (task) => task.patternMakerId === "mock-pattern-maker"
    );
    expect(assigned.filter((task) => task.status === "active")).toHaveLength(1);
    expect(assigned.filter((task) => task.status === "paused").length).toBeGreaterThanOrEqual(1);
  });

  it("allows deleting any versions while preserving one valid deliverable per required task category", async () => {
    const orderId = await createAcceptedPatternOrder();
    const taskDto = await receivePatternOrder(orderId, "mock-pattern-maker");
    const task = await repository.findPatternTaskById(taskDto.id as string);
    expect(task).toBeDefined();
    const taskCategory = task!.requirements[0]!;
    const deliverables = await Promise.all(
      ["V1", "V2", "V3"].map((version) => repository.createPatternDeliverable({
        orderId,
        patternTaskId: task!.id,
        version,
        type: "pattern_file",
        fileName: `${version}.dxf`,
        mimeType: "application/octet-stream",
        size: 1,
        storageKey: `test/${version}.dxf`,
        visibility: "client_visible",
        uploadedBy: "mock-pattern-maker",
        taskCategory
      }))
    );
    const deleteAs = (deliverableId: string, role = ROLES.patternMaker, userId = "mock-pattern-maker") =>
      jsonRequest(`/api/pattern-maker/orders/${orderId}/pattern-deliverables/${deliverableId}`, {
        method: "DELETE",
        headers: headers(role, userId)
      });

    expect((await deleteAs(deliverables[1]!.id)).response.status).toBe(200);
    expect((await deleteAs(deliverables[0]!.id)).response.status).toBe(200);
    await repository.createPatternDeliverable({
      orderId,
      patternTaskId: task!.id,
      version: "V4",
      type: "process_note",
      fileName: "not-a-stored-file.txt",
      visibility: "internal_only",
      uploadedBy: "mock-pattern-maker",
      taskCategory
    });
    const other = await repository.createPatternDeliverable({
      orderId,
      patternTaskId: task!.id,
      version: "V1",
      type: "other",
      fileName: "other.txt",
      storageKey: "test/other.txt",
      visibility: "internal_only",
      uploadedBy: "mock-pattern-maker",
      taskCategory: "other"
    });
    const last = await deleteAs(deliverables[2]!.id);
    expect(last.response.status).toBe(409);
    expect(last.body.error).toBe("pattern_deliverable_minimum_required");
    for (const role of [ROLES.boss, ROLES.systemOwner]) {
      const managerAttempt = await jsonRequest(
        `/api/admin/orders/${orderId}/pattern-deliverables/${deliverables[2]!.id}`,
        { method: "DELETE", headers: headers(role, `mock-${role}`) }
      );
      expect(managerAttempt.response.status).toBe(409);
    }
    expect((await deleteAs(other.id)).response.status).toBe(200);
  });
});
