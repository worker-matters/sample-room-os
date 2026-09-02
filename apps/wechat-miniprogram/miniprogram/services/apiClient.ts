import type {
  MiniappHealthResponse,
  MiniappLoginResponse,
  MiniappTestModeLoginResponse,
  DevelopmentPersona,
  DevelopmentPersonaLoginResponse,
  WorkerScanState,
  WorkerScanResolveResponse,
  ClientAttachment,
  ClientBusinessUserRegistration,
  ClientBusinessUserRequest,
  ClientOrderSummary,
  ClientOrdersResponse,
  PlannerOrderSummary,
  PlannerScanChargeContext,
  ReceiverAttachment,
  ReceiverCharge,
  ReceiverOrderSummary,
  ReceiverScanChargeContext,
  ReceiverSelfEntryCustomer,
  BossCustomerChargeItem,
  BossInternalCostItem,
  BossOrderCharge,
  BossPricingDetail,
  BossPricingRow,
  ReconciliationStatement,
  WorkerPerformance,
  AccountSecurityProfile
} from "../types/contracts";
import type { HealthProbe } from "./endpointSelector";
import type { MiniappGlobalData } from "../app";

const joinUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;

const assertFormalWriteAllowed = () => {
  const app = getApp<{ globalData: MiniappGlobalData }>();
  if (app.globalData.identityPreviewActive) throw new Error("开发身份预览模式禁止调用正式写接口");
};

export const probeMiniappHealth: HealthProbe = (baseUrl, timeoutMs) =>
  new Promise((resolve, reject) => {
    wx.request<MiniappHealthResponse>({
      url: joinUrl(baseUrl, "/api/miniapp/health"),
      method: "GET",
      timeout: timeoutMs,
      success: ({ data, statusCode }) => {
        if (statusCode !== 200) {
          reject(new Error(`health check returned ${statusCode}`));
          return;
        }
        resolve(data);
      },
      fail: ({ errMsg }) => reject(new Error(errMsg))
    });
  });

// Read requests may later retry once against the alternate selected endpoint.
// Write requests must use a single selected endpoint and must never be retried
// automatically; backend idempotency and scan validation remain authoritative.
export const miniappApiPaths = {
  health: "/api/miniapp/health",
  login: "/api/miniapp/auth/login",
  logout: "/api/miniapp/auth/logout",
  session: "/api/miniapp/session",
  resolveOrderScan: "/api/miniapp/scan/resolve",
  receiverOrders: "/api/miniapp/receiver/orders",
  receiverSelfEntryOptions: "/api/miniapp/receiver/self-entry-options",
  receiverIntake: "/api/miniapp/receiver/intake",
  receiverQuickPhoto: "/api/miniapp/receiver/quick-photo",
  receiverScanChargeResolve: "/api/miniapp/receiver/scan-charge/resolve",
  receiverScanChargeCreate: "/api/miniapp/receiver/scan-charge/charges",
  plannerOrders: "/api/miniapp/planner/orders",
  plannerScanChargeResolve: "/api/miniapp/planner/scan-charge/resolve",
  plannerScanChargeCreate: "/api/miniapp/planner/scan-charge/charges",
  clientOrders: "/api/miniapp/client/orders",
  clientQuickPhoto: "/api/miniapp/client/orders/quick-photo",
  clientRegistration: "/api/miniapp/client/business-user-registration"
} as const;

const errorMessage = (data: unknown, statusCode: number) => {
  if (typeof data === "object" && data !== null && "error" in data && typeof data.error === "string") {
    return data.error;
  }
  return `API ${statusCode}`;
};

const apiRequest = <T>(baseUrl: string, path: string, options: { method?: "GET" | "POST" | "PUT" | "DELETE"; data?: WechatMiniprogram.IAnyObject; sessionToken?: string } = {}) =>
  new Promise<T>((resolve, reject) => {
    wx.request({
      url: joinUrl(baseUrl, path),
      method: options.method ?? "GET",
      ...(options.data ? { data: options.data } : {}),
      header: options.sessionToken ? { authorization: `Bearer ${options.sessionToken}` } : {},
      success: ({ data, statusCode }) => statusCode >= 200 && statusCode < 300 ? resolve(data as T) : reject(new Error(errorMessage(data, statusCode))),
      fail: ({ errMsg }) => reject(new Error(errMsg))
    });
  });

export const loginMiniapp = (
  baseUrl: string,
  credentials: { username?: string; phoneNumber?: string; password: string }
) => {
  assertFormalWriteAllowed();
  return apiRequest<MiniappLoginResponse | MiniappTestModeLoginResponse>(baseUrl, miniappApiPaths.login, {
    method: "POST",
    data: credentials
  });
};

export const restoreMiniappSession = (baseUrl: string, sessionToken: string) =>
  apiRequest<{ identity: MiniappLoginResponse["identity"] }>(baseUrl, miniappApiPaths.session, {
    sessionToken
  });

export const logoutMiniapp = (baseUrl: string, sessionToken: string) => {
  assertFormalWriteAllowed();
  return apiRequest<{ ok: true }>(baseUrl, miniappApiPaths.logout, {
    method: "POST",
    sessionToken
  });
};

export const listDevelopmentPersonas = (baseUrl: string, testModeToken: string) =>
  apiRequest<{ personas: DevelopmentPersona[] }>(baseUrl, "/api/miniapp/dev/personas", {
    sessionToken: testModeToken
  });

export const loginDevelopmentPersona = (baseUrl: string, key: string, testModeToken: string) =>
  apiRequest<DevelopmentPersonaLoginResponse>(
    baseUrl,
    `/api/miniapp/dev/personas/${encodeURIComponent(key)}/login`,
    { method: "POST", data: {}, sessionToken: testModeToken }
  );

export const logoutDevelopmentTestMode = (baseUrl: string, testModeToken: string) =>
  apiRequest<{ ok: true }>(baseUrl, "/api/miniapp/dev/test-mode/logout", {
    method: "POST",
    sessionToken: testModeToken
  });

export const resolveOrderScan = (baseUrl: string, payload: string, sessionToken?: string) =>
  apiRequest<WorkerScanResolveResponse>(baseUrl, "/api/scan/resolve", {
    method: "POST",
    data: { payload },
    ...(sessionToken ? { sessionToken } : {})
  });

export const startWorkerScan = (
  baseUrl: string,
  sessionToken: string,
  token: string
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ state: WorkerScanState }>(
    baseUrl,
    `/api/scan/${encodeURIComponent(token)}/start`,
    { method: "POST", data: {}, sessionToken }
  );
};

export const completeWorkerScan = (
  baseUrl: string,
  sessionToken: string,
  token: string,
  payload: { pieces: number; workHours: number; note: string }
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ state: WorkerScanState }>(
    baseUrl,
    `/api/scan/${encodeURIComponent(token)}/complete`,
    { method: "POST", data: payload, sessionToken }
  );
};

export const completeWorkerQcScan = (
  baseUrl: string,
  sessionToken: string,
  token: string,
  photos: Array<{ filePath: string; displayName: string }>,
  fields: {
    pieces: string;
    qualityScore: string;
    qualityResult: "qualified" | "rework" | "rejected";
    note: string;
  },
  onProgress?: (uploaded: number, total: number) => void
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ batchId: string }>(
    baseUrl,
    `/api/scan/${encodeURIComponent(token)}/qc-evidence-batches`,
    { method: "POST", data: { action: "complete" }, sessionToken }
  ).then(async ({ batchId }) => {
    for (const [index, photo] of photos.entries()) {
      await uploadFile(
        baseUrl,
        `/api/scan/${encodeURIComponent(token)}/qc-evidence-batches/${encodeURIComponent(batchId)}/files`,
        sessionToken,
        photo.filePath,
        { displayName: photo.displayName }
      );
      onProgress?.(index + 1, photos.length);
    }
    return apiRequest<{ state: WorkerScanState }>(
      baseUrl,
      `/api/scan/${encodeURIComponent(token)}/complete`,
      {
        method: "POST",
        data: { ...fields, qcEvidenceBatchId: batchId },
        sessionToken
      }
    );
  });
};

export const takeoverWorkerScan = (
  baseUrl: string,
  sessionToken: string,
  token: string,
  reason: string,
  expectedActiveWorkerId: string
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ state: WorkerScanState }>(
    baseUrl,
    `/api/scan/${encodeURIComponent(token)}/sewing-takeover`,
    { method: "POST", data: { reason, expectedActiveWorkerId }, sessionToken }
  );
};

export const listMobileOrderCharges = (
  baseUrl: string,
  sessionToken: string,
  role: "receiver" | "planner",
  orderId: string
) =>
  apiRequest<{ charges: ReceiverCharge[] }>(
    baseUrl,
    `/api/miniapp/${role}/orders/${encodeURIComponent(orderId)}/charges`,
    { sessionToken }
  );

export const renameMobileOrderCharge = (
  baseUrl: string,
  sessionToken: string,
  role: "receiver" | "planner",
  orderId: string,
  chargeId: string,
  name: string
) =>
  apiRequest<{ charge: ReceiverCharge }>(
    baseUrl,
    `/api/miniapp/${role}/orders/${encodeURIComponent(orderId)}/charges/${encodeURIComponent(chargeId)}/display-name`,
    { method: "POST", data: { name }, sessionToken }
  );

export const deleteMobileOrderCharge = (
  baseUrl: string,
  sessionToken: string,
  role: "receiver" | "planner",
  orderId: string,
  chargeId: string
) =>
  apiRequest<{ charge: ReceiverCharge }>(
    baseUrl,
    `/api/miniapp/${role}/orders/${encodeURIComponent(orderId)}/charges/${encodeURIComponent(chargeId)}/void`,
    { method: "POST", data: {}, sessionToken }
  );

export const listReceiverOrders = (baseUrl: string, sessionToken: string) =>
  apiRequest<{ orders: ReceiverOrderSummary[] }>(baseUrl, miniappApiPaths.receiverOrders, { sessionToken });

export const listReceiverSelfEntryOptions = (baseUrl: string, sessionToken: string) =>
  apiRequest<{ customers: ReceiverSelfEntryCustomer[] }>(baseUrl, miniappApiPaths.receiverSelfEntryOptions, { sessionToken });

export type ReceiverIntakeUploadFields = {
  customerId: string;
  clientUserId: string;
  styleNo: string;
  styleName: string;
  quantity: string;
  sampleType: string;
  sampleRound: string;
  deliveryDate: string;
  remark: string;
  patternStatus: "none";
  fabricStatus: string;
  trimStatus: string;
  sampleRequestItems: string;
  category: string;
  visibility: string;
};

export type ReceiverQuickPhotoUploadFields = {
  customerId: string;
  clientUserId: string;
  styleNo?: string;
  styleName?: string;
  quantity?: string;
  sampleType?: string;
  sampleRound?: string;
  deliveryDate?: string;
  remark?: string;
  category: "receiver_quick_photo";
  visibility: "client_visible";
};

const uploadFile = <T>(
  baseUrl: string,
  path: string,
  sessionToken: string,
  filePath: string,
  formData: Record<string, string>
) => {
  assertFormalWriteAllowed();
  return new Promise<T>((resolve, reject) => {
    wx.uploadFile({
      url: joinUrl(baseUrl, path),
      filePath,
      name: "files",
      formData,
      header: { authorization: `Bearer ${sessionToken}` },
      success: ({ data, statusCode }) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data) as unknown;
        } catch {
          reject(new Error(`API ${statusCode}`));
          return;
        }
        if (statusCode >= 200 && statusCode < 300) resolve(parsed as T);
        else reject(new Error(errorMessage(parsed, statusCode)));
      },
      fail: ({ errMsg }) => reject(new Error(errMsg))
    });
  });
};

const bundledOrderUploadFields = (
  fields: Record<string, string>
): Record<string, string> => {
  const { category, visibility, ...payload } = fields;
  return {
    multipartPayload: JSON.stringify(payload),
    ...(category ? { category } : {}),
    ...(visibility ? { visibility } : {})
  };
};

export const createReceiverIntake = (
  baseUrl: string,
  sessionToken: string,
  filePath: string,
  fields: ReceiverIntakeUploadFields
) => uploadFile<{ order: ReceiverOrderSummary }>(
  baseUrl,
  miniappApiPaths.receiverIntake,
  sessionToken,
  filePath,
  bundledOrderUploadFields(fields)
);

export const createReceiverQuickPhoto = (
  baseUrl: string,
  sessionToken: string,
  filePath: string,
  fields: ReceiverQuickPhotoUploadFields
) => {
  const formData: Record<string, string> = {
    customerId: fields.customerId,
    clientUserId: fields.clientUserId,
    category: fields.category,
    visibility: fields.visibility
  };
  for (const key of [
    "styleNo",
    "styleName",
    "quantity",
    "sampleType",
    "sampleRound",
    "deliveryDate",
    "remark"
  ] as const) {
    const value = fields[key];
    if (value) formData[key] = value;
  }
  return uploadFile<{ order: ReceiverOrderSummary }>(
    baseUrl,
    miniappApiPaths.receiverQuickPhoto,
    sessionToken,
    filePath,
    bundledOrderUploadFields(formData)
  );
};

export const uploadReceiverOrderAttachment = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  filePath: string,
  fields: { category: string; visibility: string }
) => uploadFile<{ attachments: ReceiverAttachment[] }>(baseUrl, `/api/miniapp/receiver/orders/${encodeURIComponent(orderId)}/attachments`, sessionToken, filePath, fields);

export const resolveReceiverScanCharge = (baseUrl: string, sessionToken: string, token: string) =>
  apiRequest<ReceiverScanChargeContext>(baseUrl, miniappApiPaths.receiverScanChargeResolve, {
    method: "POST",
    sessionToken,
    data: { token }
  });

export const createReceiverScanCharge = (
  baseUrl: string,
  sessionToken: string,
  token: string,
  charge: { name: string; amount: number; explanation: string; sourceScene: "receiver_mobile_scan" }
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ orderId: string; charge: ReceiverCharge }>(baseUrl, miniappApiPaths.receiverScanChargeCreate, {
    method: "POST",
    sessionToken,
    data: { token, charge }
  });
};

export const uploadReceiverChargeAttachment = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  chargeId: string,
  filePath: string
) => uploadFile<{ charge: ReceiverCharge }>(
  baseUrl,
  `/api/miniapp/receiver/orders/${encodeURIComponent(orderId)}/charges/${encodeURIComponent(chargeId)}/attachments`,
  sessionToken,
  filePath,
  { category: "order_charge", visibility: "internal_only" }
);

export const voidReceiverCharge = (baseUrl: string, sessionToken: string, orderId: string, chargeId: string) => {
  assertFormalWriteAllowed();
  return apiRequest<{ charge: ReceiverCharge }>(
    baseUrl,
    `/api/miniapp/receiver/orders/${encodeURIComponent(orderId)}/charges/${encodeURIComponent(chargeId)}/void`,
    { method: "POST", sessionToken, data: {} }
  );
};

export const listPlannerOrders = (baseUrl: string, sessionToken: string) =>
  apiRequest<{ orders: PlannerOrderSummary[] }>(baseUrl, miniappApiPaths.plannerOrders, { sessionToken });

const downloadMiniappFile = (baseUrl: string, path: string, sessionToken: string) =>
  new Promise<string>((resolve, reject) => {
    wx.downloadFile({
      url: joinUrl(baseUrl, path),
      header: { authorization: `Bearer ${sessionToken}` },
      success: ({ statusCode, tempFilePath }) => {
        if (statusCode >= 200 && statusCode < 300) resolve(tempFilePath);
        else reject(new Error(`API ${statusCode}`));
      },
      fail: ({ errMsg }) => reject(new Error(errMsg))
    });
  });

export const downloadPlannerOrderAttachment = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  attachmentId: string
) => downloadMiniappFile(
  baseUrl,
  `/api/miniapp/planner/orders/${encodeURIComponent(orderId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
  sessionToken
);

export const downloadPlannerPatternDeliverable = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  deliverableId: string
) => downloadMiniappFile(
  baseUrl,
  `/api/miniapp/planner/orders/${encodeURIComponent(orderId)}/pattern-deliverables/${encodeURIComponent(deliverableId)}/download`,
  sessionToken
);

export const resolvePlannerScanCharge = (baseUrl: string, sessionToken: string, token: string) =>
  apiRequest<PlannerScanChargeContext>(baseUrl, miniappApiPaths.plannerScanChargeResolve, {
    method: "POST",
    sessionToken,
    data: { token }
  });

export const createPlannerScanCharge = (
  baseUrl: string,
  sessionToken: string,
  token: string,
  charge: { name: string; amount: number; explanation: string; sourceScene: "planner_mobile_scan" }
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ orderId: string; charge: ReceiverCharge }>(
    baseUrl,
    miniappApiPaths.plannerScanChargeCreate,
    { method: "POST", sessionToken, data: { token, charge } }
  );
};

export const uploadPlannerChargeAttachment = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  chargeId: string,
  filePath: string
) => uploadFile<{ charge: ReceiverCharge }>(
  baseUrl,
  `/api/miniapp/planner/orders/${encodeURIComponent(orderId)}/charges/${encodeURIComponent(chargeId)}/attachments`,
  sessionToken,
  filePath,
  { category: "order_charge", visibility: "internal_only" }
);

export const deletePlannerChargeAttachment = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  chargeId: string,
  attachmentId: string
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ charge: ReceiverCharge }>(
    baseUrl,
    `/api/miniapp/planner/orders/${encodeURIComponent(orderId)}/charges/${encodeURIComponent(chargeId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: "DELETE", sessionToken }
  );
};

export const voidPlannerCharge = (baseUrl: string, sessionToken: string, orderId: string, chargeId: string) => {
  assertFormalWriteAllowed();
  return apiRequest<{ charge: ReceiverCharge }>(
    baseUrl,
    `/api/miniapp/planner/orders/${encodeURIComponent(orderId)}/charges/${encodeURIComponent(chargeId)}/void`,
    { method: "POST", sessionToken, data: {} }
  );
};

export const uploadPlannerOrderAttachment = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  filePath: string
) => uploadFile<{ attachments: ReceiverAttachment[] }>(
  baseUrl,
  `/api/miniapp/planner/orders/${encodeURIComponent(orderId)}/attachments`,
  sessionToken,
  filePath,
  { category: "sample_room_upload", visibility: "internal_only" }
);

export const listOrderAttachments = (
  baseUrl: string,
  sessionToken: string,
  role: "receiver" | "planner",
  orderId: string
) => apiRequest<{ attachments: ReceiverAttachment[] }>(
  baseUrl,
  `/api/miniapp/${role}/orders/${encodeURIComponent(orderId)}/attachments`,
  { sessionToken }
);

export const renameOrderAttachment = (
  baseUrl: string,
  sessionToken: string,
  role: "receiver" | "planner",
  orderId: string,
  attachmentId: string,
  displayName: string
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ attachments: ReceiverAttachment[] }>(
    baseUrl,
    `/api/miniapp/${role}/orders/${encodeURIComponent(orderId)}/attachments/${encodeURIComponent(attachmentId)}/display-name`,
    { method: "POST", sessionToken, data: { displayName } }
  );
};

export const deleteOrderAttachment = (
  baseUrl: string,
  sessionToken: string,
  role: "receiver" | "planner",
  orderId: string,
  attachmentId: string
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ attachments: ReceiverAttachment[] }>(
    baseUrl,
    `/api/miniapp/${role}/orders/${encodeURIComponent(orderId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: "DELETE", sessionToken }
  );
};

export const downloadOrderAttachment = (
  baseUrl: string,
  sessionToken: string,
  role: "receiver" | "planner",
  orderId: string,
  attachmentId: string
) => downloadMiniappFile(
  baseUrl,
  `/api/miniapp/${role}/orders/${encodeURIComponent(orderId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
  sessionToken
);

export const listBossPricingRows = (baseUrl: string, sessionToken: string) =>
  apiRequest<{ rows: BossPricingRow[] }>(baseUrl, "/api/miniapp/boss/pricing/orders", { sessionToken });

export const downloadBossOrderAttachment = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  attachmentId: string
) => downloadMiniappFile(
  baseUrl,
  `/api/admin/orders/${encodeURIComponent(orderId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
  sessionToken
);

export const getBossPricing = (baseUrl: string, sessionToken: string, orderId: string) =>
  apiRequest<BossPricingDetail>(
    baseUrl,
    `/api/miniapp/boss/orders/${encodeURIComponent(orderId)}/pricing`,
    { sessionToken }
  );

export const initializeBossPricing = (baseUrl: string, sessionToken: string, orderId: string) => {
  assertFormalWriteAllowed();
  return apiRequest<BossPricingDetail>(
    baseUrl,
    `/api/miniapp/boss/orders/${encodeURIComponent(orderId)}/pricing/initialize`,
    { method: "POST", sessionToken, data: {} }
  );
};

export const createBossCustomerCharge = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  payload: Partial<BossCustomerChargeItem>
) => {
  assertFormalWriteAllowed();
  return apiRequest<BossPricingDetail>(
    baseUrl,
    `/api/miniapp/boss/orders/${encodeURIComponent(orderId)}/pricing/customer-charges`,
    { method: "POST", sessionToken, data: payload }
  );
};

export const updateBossCustomerCharge = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  itemId: string,
  payload: Partial<BossCustomerChargeItem>
) => {
  assertFormalWriteAllowed();
  return apiRequest<BossPricingDetail>(
    baseUrl,
    `/api/miniapp/boss/orders/${encodeURIComponent(orderId)}/pricing/customer-charges/${encodeURIComponent(itemId)}/update`,
    { method: "POST", sessionToken, data: payload }
  );
};

export const deleteBossCustomerCharge = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  itemId: string
) => {
  assertFormalWriteAllowed();
  return apiRequest<BossPricingDetail>(
    baseUrl,
    `/api/miniapp/boss/orders/${encodeURIComponent(orderId)}/pricing/customer-charges/${encodeURIComponent(itemId)}`,
    { method: "DELETE", sessionToken }
  );
};

export const createBossInternalCost = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  payload: Partial<BossInternalCostItem>
) => {
  assertFormalWriteAllowed();
  return apiRequest<BossPricingDetail>(
    baseUrl,
    `/api/miniapp/boss/orders/${encodeURIComponent(orderId)}/pricing/internal-costs`,
    { method: "POST", sessionToken, data: payload }
  );
};

export const updateBossInternalCost = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  itemId: string,
  payload: Partial<BossInternalCostItem>
) => {
  assertFormalWriteAllowed();
  return apiRequest<BossPricingDetail>(
    baseUrl,
    `/api/miniapp/boss/orders/${encodeURIComponent(orderId)}/pricing/internal-costs/${encodeURIComponent(itemId)}/update`,
    { method: "POST", sessionToken, data: payload }
  );
};

export const deleteBossInternalCost = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  itemId: string
) => {
  assertFormalWriteAllowed();
  return apiRequest<BossPricingDetail>(
    baseUrl,
    `/api/miniapp/boss/orders/${encodeURIComponent(orderId)}/pricing/internal-costs/${encodeURIComponent(itemId)}`,
    { method: "DELETE", sessionToken }
  );
};

export const confirmBossQuotation = (baseUrl: string, sessionToken: string, orderId: string) => {
  assertFormalWriteAllowed();
  return apiRequest<BossPricingDetail>(
    baseUrl,
    `/api/miniapp/boss/orders/${encodeURIComponent(orderId)}/pricing/confirm`,
    { method: "POST", sessionToken, data: {} }
  );
};

export const beginBossQuotationUpdate = (baseUrl: string, sessionToken: string, orderId: string) => {
  assertFormalWriteAllowed();
  return apiRequest<BossPricingDetail>(
    baseUrl,
    `/api/miniapp/boss/orders/${encodeURIComponent(orderId)}/pricing/begin-update`,
    { method: "POST", sessionToken, data: {} }
  );
};

export const listBossOrderCharges = (baseUrl: string, sessionToken: string, orderId: string) =>
  apiRequest<{ charges: BossOrderCharge[] }>(
    baseUrl,
    `/api/miniapp/boss/orders/${encodeURIComponent(orderId)}/charges`,
    { sessionToken }
  );

export const createBossOrderCharge = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  payload: { name: string; amount: number }
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ charge: BossOrderCharge }>(
    baseUrl,
    `/api/miniapp/boss/orders/${encodeURIComponent(orderId)}/charges`,
    { method: "POST", sessionToken, data: { ...payload, sourceScene: "boss_mobile" } }
  );
};

export const confirmBossOrderCharge = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  chargeId: string
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ charge: BossOrderCharge }>(
    baseUrl,
    `/api/miniapp/boss/orders/${encodeURIComponent(orderId)}/charges/${encodeURIComponent(chargeId)}/confirm`,
    { method: "POST", sessionToken, data: {} }
  );
};

export const deleteBossOrderCharge = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  chargeId: string
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ charge: BossOrderCharge }>(
    baseUrl,
    `/api/miniapp/boss/orders/${encodeURIComponent(orderId)}/charges/${encodeURIComponent(chargeId)}`,
    { method: "DELETE", sessionToken }
  );
};

export const listBossStatements = (baseUrl: string, sessionToken: string) =>
  apiRequest<{ statements: ReconciliationStatement[] }>(
    baseUrl,
    "/api/miniapp/boss/reconciliation-statements?includeReturned=true",
    { sessionToken }
  );

export const createBossStatement = (baseUrl: string, sessionToken: string, orderIds: string[]) => {
  assertFormalWriteAllowed();
  return apiRequest<{ statement: ReconciliationStatement }>(
    baseUrl,
    "/api/miniapp/boss/reconciliation-statements",
    { method: "POST", sessionToken, data: { orderIds } }
  );
};

export const returnBossStatement = (baseUrl: string, sessionToken: string, statementId: string) =>
  apiRequest<{ statement: ReconciliationStatement }>(
    baseUrl,
    `/api/miniapp/boss/reconciliation-statements/${encodeURIComponent(statementId)}/return`,
    { method: "POST", sessionToken, data: {} }
  );

export const returnBossStatementItem = (
  baseUrl: string,
  sessionToken: string,
  statementId: string,
  itemId: string
) => apiRequest<{ statement: ReconciliationStatement }>(
  baseUrl,
  `/api/miniapp/boss/reconciliation-statements/${encodeURIComponent(statementId)}/items/${encodeURIComponent(itemId)}/return`,
  { method: "POST", sessionToken, data: {} }
);

export const markBossStatementPaid = (
  baseUrl: string,
  sessionToken: string,
  statementId: string
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ statement: ReconciliationStatement }>(
    baseUrl,
    `/api/miniapp/boss/reconciliation-statements/${encodeURIComponent(statementId)}/mark-paid`,
    { method: "POST", sessionToken, data: {} }
  );
};

export const undoBossStatementPaid = (
  baseUrl: string,
  sessionToken: string,
  statementId: string
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ statement: ReconciliationStatement }>(
    baseUrl,
    `/api/miniapp/boss/reconciliation-statements/${encodeURIComponent(statementId)}/undo-paid`,
    { method: "POST", sessionToken, data: {} }
  );
};

export const downloadBossStatement = (
  baseUrl: string,
  sessionToken: string,
  statementId: string
) => downloadMiniappFile(
  baseUrl,
  `/api/miniapp/boss/reconciliation-statements/${encodeURIComponent(statementId)}/download`,
  sessionToken
);

export const getOwnPerformance = (
  baseUrl: string,
  sessionToken: string,
  query = ""
) => apiRequest<WorkerPerformance>(
  baseUrl,
  `/api/miniapp/me/performance${query ? `?${query}` : ""}`,
  { sessionToken }
);

export const getAccountSecurity = (baseUrl: string, sessionToken: string) =>
  apiRequest<{ profile: AccountSecurityProfile }>(baseUrl, "/api/auth/account-security", { sessionToken });

export const updateAccountSecurity = (
  baseUrl: string,
  sessionToken: string,
  payload: WechatMiniprogram.IAnyObject
) => apiRequest<{ profile: AccountSecurityProfile; signedOut: boolean }>(
  baseUrl,
  "/api/auth/account-security/profile",
  { method: "POST", sessionToken, data: payload }
);

export const changeOwnPassword = (
  baseUrl: string,
  sessionToken: string,
  payload: { currentPassword: string; newPassword: string; confirmPassword: string }
) => apiRequest<{ ok: true }>(
  baseUrl,
  "/api/auth/change-password",
  { method: "POST", sessionToken, data: payload }
);

export const listClientOrders = (baseUrl: string, sessionToken: string) =>
  apiRequest<ClientOrdersResponse>(baseUrl, miniappApiPaths.clientOrders, { sessionToken });

export const downloadClientOrderAttachment = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  attachmentId: string
) => downloadMiniappFile(
  baseUrl,
  `/api/miniapp/client/orders/${encodeURIComponent(orderId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
  sessionToken
);

export const downloadClientPatternDeliverable = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  deliverableId: string
) => downloadMiniappFile(
  baseUrl,
  `/api/miniapp/client/orders/${encodeURIComponent(orderId)}/pattern-deliverables/${encodeURIComponent(deliverableId)}/download`,
  sessionToken
);

export const createClientQuickPhoto = (
  baseUrl: string,
  sessionToken: string,
  filePath: string
) => uploadFile<{ order: ClientOrderSummary }>(
  baseUrl,
  miniappApiPaths.clientQuickPhoto,
  sessionToken,
  filePath,
  { category: "client_quick_photo", visibility: "client_visible" }
);

export const uploadClientOrderAttachment = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  filePath: string
) => uploadFile<{ attachments: ClientAttachment[] }>(
  baseUrl,
  `/api/miniapp/client/orders/${encodeURIComponent(orderId)}/attachments`,
  sessionToken,
  filePath,
  { category: "client_upload", visibility: "client_visible" }
);

export type ClientSupplementUploadFields = {
  styleNo: string;
  styleName: string;
  quantity: string;
  sampleType: string;
  sampleRound: string;
  deliveryDate: string;
  remark: string;
  category: "client_upload";
  visibility: "client_visible";
};

export const supplementClientOrder = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  filePath: string,
  fields: ClientSupplementUploadFields
) => uploadFile<{ order: ClientOrderSummary }>(
  baseUrl,
  `/api/miniapp/client/orders/${encodeURIComponent(orderId)}/supplement`,
  sessionToken,
  filePath,
  fields
);

export const supplementClientOrderWithoutFile = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
  fields: Omit<ClientSupplementUploadFields, "category" | "visibility">
) => {
  assertFormalWriteAllowed();
  return apiRequest<{ order: ClientOrderSummary }>(
    baseUrl,
    `/api/miniapp/client/orders/${encodeURIComponent(orderId)}/supplement`,
    { method: "POST", sessionToken, data: fields }
  );
};

export const getClientBusinessUserRegistration = (baseUrl: string, sessionToken: string) =>
  apiRequest<{ registration: ClientBusinessUserRegistration; requests: ClientBusinessUserRequest[] }>(
    baseUrl,
    miniappApiPaths.clientRegistration,
    { sessionToken }
  );

export const openClientBusinessUserRegistration = (baseUrl: string, sessionToken: string) => {
  assertFormalWriteAllowed();
  return apiRequest<{ registration: ClientBusinessUserRegistration }>(
    baseUrl,
    `${miniappApiPaths.clientRegistration}/open`,
    { method: "POST", sessionToken, data: {} }
  );
};

export const closeClientBusinessUserRegistration = (baseUrl: string, sessionToken: string) => {
  assertFormalWriteAllowed();
  return apiRequest<{ registration: ClientBusinessUserRegistration }>(
    baseUrl,
    `${miniappApiPaths.clientRegistration}/close`,
    { method: "POST", sessionToken, data: {} }
  );
};
