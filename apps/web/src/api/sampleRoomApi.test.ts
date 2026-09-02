import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loginPayloadForAccount, sampleRoomApi } from "./sampleRoomApi";
import type { DevSession } from "../app/DevSessionContext";

const apiDir = dirname(fileURLToPath(import.meta.url));

function exportedTypeBlock(source: string, typeName: string) {
  const marker = `export type ${typeName} =`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);

  const nextExport = source.indexOf("\nexport type ", start + marker.length);
  return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

const session: DevSession = {
  role: "client_business_user",
  userId: "mock-client-user-active",
  displayName: "Mock Client User",
  customerId: "mock-customer-active",
  clientUserId: "mock-client-user-active"
};

describe("sampleRoomApi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the formal login endpoint with only the supported credentials payload", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "formal-token",
          user: { id: "formal-user-client-own", role: "client_business_user", displayName: "Client" }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await sampleRoomApi.login(
      loginPayloadForAccount("  client-own@sample-room.test  ", "SampleRoom@123")
    );

    expect(result.user.id).toBe("formal-user-client-own");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        credentials: "same-origin",
        method: "POST",
        body: JSON.stringify({
          username: "client-own@sample-room.test",
          password: "SampleRoom@123"
        })
      })
    );
  });

  it("submits an 11-digit mainland mobile number as phoneNumber", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "worker-token",
          user: { id: "formal-account-worker-qc", role: "worker", displayName: "QC A" }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await sampleRoomApi.login(loginPayloadForAccount(" 13800000003 ", "SampleRoom@123"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        credentials: "same-origin",
        method: "POST",
        body: JSON.stringify({
          phoneNumber: "13800000003",
          password: "SampleRoom@123"
        })
      })
    );
  });

  it("returns null for unauthenticated current-user checks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      })
    );

    await expect(sampleRoomApi.getCurrentUser()).resolves.toBeNull();
  });

  it("uses the shared sample type read and management API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const bossSession = { ...session, role: "boss" as const, userId: "mock-boss" };

    await sampleRoomApi.listSampleTypeOptions(bossSession);
    await sampleRoomApi.createSampleType(bossSession, "展示样");
    await sampleRoomApi.renameSampleType(bossSession, "custom_abc", "确认样");
    await sampleRoomApi.moveSampleType(bossSession, "custom_abc", "up");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/form-options/sample-types",
      "/api/admin/sample-types",
      "/api/admin/sample-types/custom_abc",
      "/api/admin/sample-types/custom_abc/move"
    ]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/admin/sample-types/custom_abc/move",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ direction: "up" }) })
    );
  });

  it("reports HTTP status when an error response has no JSON body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 502, statusText: "Bad Gateway" })
    );

    await expect(
      sampleRoomApi.createClientOrder(session, {
        styleNo: "TEST-001",
        styleName: "Test style",
        quantity: 1,
        sampleType: "first_sample",
        sampleRound: "round_1",
        patternStatus: "none",
        deliveryDate: "2026-06-20"
      })
    ).rejects.toThrow("HTTP 502");
  });

  it("does not send dev role headers for formal authenticated sessions", async () => {
    const formalSession: DevSession = {
      authMode: "formal",
      role: "client_business_user",
      userId: "formal-user-client-own",
      displayName: "Client",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active"
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ orders: [], clientAccessScope: "own", clientUsers: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    await sampleRoomApi.listClientOrders(formalSession);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/client/orders",
      expect.objectContaining({
        credentials: "same-origin",
        headers: expect.not.objectContaining({
          "x-dev-role": expect.any(String),
          "x-dev-user-id": expect.any(String)
        })
      })
    );
  });

  it("wires customer quick photo and fixed Excel intake endpoints", () => {
    const source = readFileSync(resolve(apiDir, "sampleRoomApi.ts"), "utf8");

    expect(source).toContain("createClientQuickPhotoOrder");
    expect(source).toContain("/api/client/orders/quick-photo");
    expect(source).toContain("previewClientExcelImport");
    expect(source).toContain("/api/client/orders/excel-import/preview");
    expect(source).toContain("confirmClientExcelImport");
    expect(source).toContain("/api/client/orders/excel-import/confirm");
    expect(source).toContain("ClientExcelImportPreviewResult");
    expect(source).toContain("ClientExcelImportRowInput");
  });

  it("wires customer account management endpoints without delete or invite APIs", () => {
    const source = readFileSync(resolve(apiDir, "sampleRoomApi.ts"), "utf8");

    expect(source).toContain("getAccountSecurityProfile");
    expect(source).toContain("/api/auth/account-security");
    expect(source).toContain("updateOwnAccountProfile");
    expect(source).toContain("/api/auth/account-security/profile");
    expect(source).toContain("changeOwnPassword");
    expect(source).toContain("/api/auth/change-password");
    expect(source).toContain("listClientManagedBusinessUsers");
    expect(source).toContain("/api/client/business-users");
    expect(source).toContain("updateClientManagedBusinessUserAccount");
    expect(source).toContain("/api/client/business-users/${clientUserId}");
    expect(source).toContain("resetClientManagedBusinessUserPassword");
    expect(source).toContain("/api/client/business-users/${clientUserId}/reset-password");
    expect(source).toContain("updateClientManagedBusinessUserStatus");
    expect(source).toContain("/api/client/business-users/${clientUserId}/status");
    expect(source).toContain("updateCustomerAccount");
    expect(source).toContain("/api/system-owner/customer-accounts/${customerId}");
    expect(source).toContain("updateClientUserAccount");
    expect(source).toContain("/api/system-owner/client-users/${clientUserId}");
    expect(source).toContain("resetClientUserAccountPassword");
    expect(source).toContain("/api/system-owner/client-users/${clientUserId}/reset-password");
    expect(source).toContain("createInternalAccount");
    expect(source).toContain("CreateInternalAccountPayload");
    expect(source).toContain("/api/system-owner/internal-accounts");
    expect(source).not.toContain("deleteClientUser");
    expect(source).not.toContain("inviteBusinessUser");
  });

  it("keeps dev headers for explicit dev sessions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ orders: [], clientAccessScope: "own", clientUsers: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    await sampleRoomApi.listClientOrders(session);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/client/orders",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-dev-role": "client_business_user",
          "x-dev-user-id": "mock-client-user-active"
        })
      })
    );
  });

  it("keeps returned reconciliation statements behind an explicit query option", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ statements: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );

    await sampleRoomApi.listAdminReconciliationStatements(session);
    await sampleRoomApi.listAdminReconciliationStatements(session, { includeReturned: true });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/admin/reconciliation-statements",
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/reconciliation-statements?includeReturned=true",
      expect.any(Object)
    );
  });

  it("passes reconciliation statement filters through query parameters", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ statements: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    await sampleRoomApi.listAdminReconciliationStatements(session, {
      q: "SR001",
      customerId: "customer-1",
      customerBusinessUserId: "client-user-1",
      paymentStatus: "paid",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-21"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/reconciliation-statements?q=SR001&customerId=customer-1&customerBusinessUserId=client-user-1&paymentStatus=paid&dateFrom=2026-06-01&dateTo=2026-06-21",
      expect.any(Object)
    );
  });

  it("downloads selected reconciliation statements with one backend request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["zip-content"]), {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-disposition": "attachment; filename*=UTF-8''%E5%AF%B9%E8%B4%A6%E5%8D%95.zip"
        }
      })
    );

    const result = await sampleRoomApi.downloadAdminReconciliationStatements(session, [
      "statement-1",
      "statement-2"
    ], ["orderNo", "receivableTotal"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/reconciliation-statements/bulk-download",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          statementIds: ["statement-1", "statement-2"],
          columns: ["orderNo", "receivableTotal"]
        })
      })
    );
    expect(result.filename).toBe("对账单.zip");
  });

  it("wires receiver attachment metadata endpoints", () => {
    const source = readFileSync(resolve(apiDir, "sampleRoomApi.ts"), "utf8");

    expect(source).toContain("listReceiverOrderAttachments");
    expect(source).toContain("addReceiverOrderAttachments");
    expect(source).toContain("deleteReceiverOrderAttachment");
    expect(source).toContain("/api/receiver/orders/${id}/attachments");
    expect(source).toContain("/api/receiver/orders/${orderId}/attachments/${attachmentId}");
    expect(source).toContain('method: "DELETE"');
  });

  it("wires boss order detail without exposing raw scan tokens", () => {
    const source = readFileSync(resolve(apiDir, "sampleRoomApi.ts"), "utf8");

    expect(source).toContain("export type AdminOrderDetail");
    expect(source).toContain("getAdminOrderDetail");
    expect(source).toContain("/api/admin/orders/${orderId}/detail");
    expect(exportedTypeBlock(source, "AdminOrderDetail")).toContain("scanRecords: ScanRecord[]");
    expect(exportedTypeBlock(source, "AdminOrderDetail")).toContain("complaints: OrderComplaint[]");
    expect(source).toContain("registerAdminOrderComplaint");
    expect(source).toContain("deleteAdminOrderComplaint");
    expect(source).toContain("/api/admin/orders/${orderId}/complaints");
    expect(source).toContain("/api/admin/orders/${orderId}/complaints/${complaintId}");
    expect(exportedTypeBlock(source, "OrderRecord")).toContain("complaintCount?: number");
    expect(exportedTypeBlock(source, "AdminOrderDetail")).not.toContain("scanToken");
  });

  it("uses AccountSession for scan state without a worker device credential", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ state: { allowedAction: "start" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    await sampleRoomApi.getScanState("order-scan-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/scan/order-scan-token",
      expect.objectContaining({
        credentials: "same-origin"
      })
    );

    const source = readFileSync(resolve(apiDir, "sampleRoomApi.ts"), "utf8");
    expect(source).toContain("createWorkerRegistrationToken");
    expect(source).toContain("/api/workers/registration-tokens");
    expect(source).toContain("completeWorkerAccountRegistration");
    expect(source).toContain("/api/workers/registration/${encodeURIComponent(token)}/complete");
    expect(source).not.toContain("x-worker-device-token");
    expect(source).toContain("ensureReceiverOrderScanLink");
    expect(source).toContain("/api/receiver/orders/${orderId}/scan-link");
    expect(source).toContain("listReceiverOrderScanRecords");
    expect(source).not.toContain("scanToken");
  });

  it("keeps credential-like token fields out of normal scan DTO types", () => {
    const source = readFileSync(resolve(apiDir, "sampleRoomApi.ts"), "utf8");

    const scanPageState = exportedTypeBlock(source, "ScanPageState");
    expect(scanPageState).not.toContain("scanToken");
    expect(scanPageState).not.toContain("deviceToken");
    expect(scanPageState).not.toContain("id: string;\n    styleNo");

    expect(source).not.toContain("WorkerCurrentDeviceBinding");
    expect(source).not.toContain("WorkerRegistrationCompleteResult");
  });

  it("wires pattern maker and cutting room endpoints without adding client DTO fields", () => {
    const source = readFileSync(resolve(apiDir, "sampleRoomApi.ts"), "utf8");

    expect(source).toContain("listPatternTasks");
    expect(source).toContain("/api/pattern-maker/tasks");
    expect(source).toContain("listPatternArchive");
    expect(source).toContain("/api/pattern-maker/archive");
    expect(source).toContain("generatePatternOrderFolder");
    expect(source).toContain("/api/pattern-maker/orders/${orderId}/folder/generate");
    expect(source).toContain("listPatternOrderAttachments");
    expect(source).toContain("appendPatternDeliverableVersion");
    expect(source).not.toContain("async addPatternOrderAttachments");
    expect(source).toContain("updatePatternOrderAttachment");
    expect(source).toContain("deletePatternOrderAttachment");
    expect(source).toContain("/api/pattern-maker/orders/${orderId}/attachments");
    expect(source).toContain("completePatternTask");
    expect(source).toContain("/api/pattern-maker/tasks/${taskId}/deliverable-versions");
    expect(source).toContain("body: JSON.stringify(payload)");
    expect(source).toContain("submitPatternCuttingVersion");
    expect(source).toContain("/api/pattern-maker/tasks/${taskId}/submit-cutting-version");
    expect(source).toContain("listPatternLibraryEntries");
    expect(source).toContain("/api/pattern-library");
    expect(source).toContain("listCuttingRoomSubmissions");
    expect(source).toContain("/api/cutting-room/submissions");
    expect(source).toContain("markCuttingSubmissionPrinted");
    expect(source).toContain("markCuttingSubmissionCut");
  });

  it("wires the phase-one parallel task, scan, commercial, planner, and client-safe contracts", () => {
    const source = readFileSync(resolve(apiDir, "sampleRoomApi.ts"), "utf8");

    expect(source).toContain("getPatternWorkbench");
    expect(source).toContain('"/api/pattern-maker/workbench"');
    expect(source).toContain("startPatternTask");
    expect(source).toContain("/api/pattern-maker/tasks/${taskId}/start");
    expect(source).toContain("takeoverSewingScan");
    expect(source).toContain("expectedActiveWorkerId");
    expect(source).toContain("/api/scan/${token}/sewing-takeover");
    expect(source).toContain("qualityResult?: \"qualified\" | \"rework\" | \"rejected\"");
    expect(source).toContain("qualityScore?: number");
    expect(source).toContain("body: bodyForOrderPayload(payload)");

    expect(source).toContain("addOrderCharge");
    expect(source).toContain("listOrderCharges");
    expect(source).toContain("addPlannerOrderChargeByScanToken");
    expect(source).toContain("/api/planner/orders/by-scan-token/${encodeURIComponent(token)}/charges");
    expect(source).toContain("confirmAdminOrderPricing");
    expect(source).toContain("/api/admin/orders/${orderId}/pricing/confirm");
    expect(source).toContain("getAdminPerformance");
    expect(source).toContain("/api/admin/performance");

    expect(source).toContain("getClientOrderQuotation");
    expect(source).toContain("/api/client/orders/${id}/quotation");
    expect(source).toContain("downloadClientPatternDeliverable");
    expect(source).toContain("/api/client/orders/${orderId}/pattern-deliverables/${deliverableId}/download");
    expect(source).toContain("downloadPlannerOrderAttachment");
    expect(source).toContain("downloadPlannerPatternDeliverable");
    const clientOrderType = exportedTypeBlock(source, "ClientOrder");
    expect(clientOrderType).toContain("attachments: ClientOrderAttachment[]");
    expect(clientOrderType).toContain("patternTask?: ClientOrderPatternTask");
    expect(clientOrderType).not.toContain("receivedBy");
    expect(clientOrderType).not.toContain("returnedBy");
    expect(clientOrderType).not.toContain("createdBy");
    expect(clientOrderType).not.toContain("correctionLogs");
    expect(source).toContain("orders: ClientOrder[]");
    const addClientAttachmentsStart = source.indexOf("async addClientOrderAttachments");
    const addClientAttachmentsEnd = source.indexOf("\n  async ", addClientAttachmentsStart + 1);
    const addClientAttachmentsBlock = source.slice(
      addClientAttachmentsStart,
      addClientAttachmentsEnd
    );
    expect(addClientAttachmentsStart).toBeGreaterThanOrEqual(0);
    expect(addClientAttachmentsBlock).toContain("attachments: ClientOrderAttachment[]");
    expect(addClientAttachmentsBlock).not.toContain("attachments: OrderAttachment[]");
    expect(exportedTypeBlock(source, "PricingFinishingSummary")).toContain("amount: number | null");
    expect(exportedTypeBlock(source, "OrderAttachment")).toContain("uploadedBy?: string");
    expect(exportedTypeBlock(source, "OrderAttachment")).toContain("sourceCategory?");
  });
});
