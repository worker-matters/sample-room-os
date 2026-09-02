import type { Role } from "./roles.js";

export const ACCOUNT_TYPES = {
  business: "business",
  worker: "worker"
} as const;

export type AccountType = (typeof ACCOUNT_TYPES)[keyof typeof ACCOUNT_TYPES];

export const ACCOUNT_STATUSES = {
  active: "active",
  suspended: "suspended",
  pending: "pending",
  archived: "archived"
} as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[keyof typeof ACCOUNT_STATUSES];

export const ACCOUNT_CLIENT_TYPES = {
  web: "web",
  miniapp: "miniapp",
  android: "android"
} as const;

export type AccountClientType = (typeof ACCOUNT_CLIENT_TYPES)[keyof typeof ACCOUNT_CLIENT_TYPES];

export const WORKER_TYPES = {
  cutting: "cutting",
  sewing: "sewing",
  qcDelivery: "qc_delivery"
} as const;

export type WorkerType = (typeof WORKER_TYPES)[keyof typeof WORKER_TYPES];

export const WORKER_PROFILE_STATUSES = {
  active: "active",
  inactive: "inactive",
  ended: "ended"
} as const;

export type WorkerProfileStatus =
  (typeof WORKER_PROFILE_STATUSES)[keyof typeof WORKER_PROFILE_STATUSES];

export const IDENTITY_QR_PURPOSES = {
  registerWorker: "REGISTER_WORKER",
  registerBusiness: "REGISTER_BUSINESS"
} as const;

export type IdentityQrPurpose =
  (typeof IDENTITY_QR_PURPOSES)[keyof typeof IDENTITY_QR_PURPOSES];

export interface AccountIdentity {
  id: string;
  username: string | null;
  phoneNumber: string | null;
  displayName: string;
  accountType: AccountType;
  role: Role;
  status: AccountStatus;
}

export interface WorkerProfileIdentity {
  id: string;
  accountId: string;
  workerType: WorkerType;
  status: WorkerProfileStatus;
  effectiveAt: string;
  endedAt: string | null;
}

export interface AccountSessionIdentity {
  id: string;
  accountId: string;
  sessionTokenHash: string;
  clientType: AccountClientType;
  expiresAt: string;
  revokedAt: string | null;
}

export interface IdentityQrTokenIdentity {
  id: string;
  tokenHash: string;
  purpose: IdentityQrPurpose;
  initialRole: Role | null;
  workerType: WorkerType | null;
  issuedByAccountId: string;
  usedByAccountId: string | null;
  revokedByAccountId: string | null;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}
