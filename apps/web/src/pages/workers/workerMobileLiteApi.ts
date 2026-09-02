import type { DevSession } from "../../app/DevSessionContext";

export type WorkerMobileAuthenticatedUser = {
  id: string;
  accountId: string;
  accountType: "business" | "worker";
  role: DevSession["role"];
  homeRoute: string;
  activeWorkerProfileId?: string;
  activeWorkerType?: "cutting" | "sewing" | "qc_delivery";
  displayName?: string;
  phoneNumber?: string;
  mustChangePassword?: boolean;
};

export type WorkerMobileSewingTask = {
  orderId: string;
  styleNo: string;
  styleName: string;
  sampleType: string;
  sampleRound: string;
  quantity: number;
  startedAt: string;
  thumbnailUrl?: string;
  previousReworkReason?: string;
  collaboration?: boolean;
  participationId?: string;
  targetPieces?: number;
  collaborationRevision?: string;
};

export type WorkerMobileSampleTypeOption = {
  value: string;
  label: string;
};

type ApiErrorBody = {
  error?: string;
  message?: string;
};

function responseError(body: unknown, status: number) {
  if (body && typeof body === "object") {
    const candidate = body as ApiErrorBody;
    if (typeof candidate.error === "string" && candidate.error.trim()) return candidate.error.trim();
    if (typeof candidate.message === "string" && candidate.message.trim()) return candidate.message.trim();
  }
  return `HTTP ${status}`;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

async function jsonRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {})
    }
  });
  const body = await readJson(response);
  if (!response.ok) throw new Error(responseError(body, response.status));
  return body as T;
}

export function toWorkerMobileSession(user: WorkerMobileAuthenticatedUser): DevSession {
  return {
    authMode: "formal",
    role: user.role,
    userId: user.id,
    accountId: user.accountId,
    accountType: user.accountType,
    displayName: user.displayName ?? user.id,
    ...(user.phoneNumber ? { phoneNumber: user.phoneNumber } : {}),
    ...(user.mustChangePassword !== undefined ? { mustChangePassword: user.mustChangePassword } : {}),
    ...(user.activeWorkerProfileId ? { activeWorkerProfileId: user.activeWorkerProfileId } : {}),
    ...(user.activeWorkerType ? { activeWorkerType: user.activeWorkerType } : {})
  };
}

export const workerMobileLiteApi = {
  async currentUser() {
    const response = await fetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store"
    });
    const body = await readJson(response);
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(responseError(body, response.status));
    return (body as { user: WorkerMobileAuthenticatedUser }).user;
  },

  async logout() {
    return jsonRequest<{ ok: true }>("/api/auth/logout", { method: "POST" });
  },

  async sampleTypes() {
    return jsonRequest<{ items: WorkerMobileSampleTypeOption[] }>("/api/form-options/sample-types");
  },

  async sewingTasks() {
    return jsonRequest<{ tasks: WorkerMobileSewingTask[] }>("/api/miniapp/me/sewing-tasks");
  },

  async completeSewingTask(
    orderId: string,
    payload: { pieces: number; workHours: number; note?: string }
  ) {
    return jsonRequest(
      `/api/miniapp/me/sewing-tasks/${encodeURIComponent(orderId)}/complete`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  }
};
