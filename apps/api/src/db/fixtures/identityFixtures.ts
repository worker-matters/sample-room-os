import { ROLES, WORKER_TYPES, type AccountType, type Role, type WorkerType } from "@sample-room/shared";
import type { AccountRecord, WorkerProfileRecord } from "../repositories/contracts/index.js";

const TEST_PASSWORD_HASH =
  "scrypt$formal-login-receiver$T8NZ-wxT3mM9qSe96GgUZXMxFjo1bYLi4AXMbPIEmyDC746gp7PvFNtLL717IYa2_oPhcUsEXWAMJSVnjZLIMQ";
const FIXTURE_TIME = "2026-07-20T00:00:00.000Z";

type FixedAccountInput = {
  id: string;
  displayName: string;
  accountType: AccountType;
  role: Role;
  username?: string;
  phoneNumber?: string;
};

function fixedAccount(input: FixedAccountInput): AccountRecord {
  return {
    id: input.id,
    username: input.username ?? null,
    phoneNumber: input.phoneNumber ?? null,
    displayName: input.displayName,
    accountType: input.accountType,
    role: input.role,
    status: "active",
    passwordHash: TEST_PASSWORD_HASH,
    mustChangePasswordAtNextLogin: false,
    lastPasswordResetAt: null,
    lastLoginAt: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME
  };
}

export const FIXED_IDENTITY_ACCOUNTS: AccountRecord[] = [
  fixedAccount({ id: "formal-account-system-owner", username: "system-owner@sample-room.test", displayName: "System Owner", accountType: "business", role: ROLES.systemOwner }),
  fixedAccount({ id: "formal-account-boss", username: "boss@sample-room.test", displayName: "Boss", accountType: "business", role: ROLES.boss }),
  fixedAccount({ id: "formal-account-receiver", username: "receiver@sample-room.test", phoneNumber: "13800000001", displayName: "Receiver", accountType: "business", role: ROLES.receiver }),
  fixedAccount({ id: "formal-account-planner", username: "planner@sample-room.test", displayName: "Planner", accountType: "business", role: ROLES.planner }),
  fixedAccount({ id: "formal-account-pattern-maker", username: "pattern-maker@sample-room.test", displayName: "Pattern Maker", accountType: "business", role: ROLES.patternMaker }),
  fixedAccount({ id: "formal-account-client-admin", username: "client-admin@sample-room.test", displayName: "Client Admin", accountType: "business", role: ROLES.clientAdmin }),
  fixedAccount({ id: "formal-account-client-business", username: "client-own@sample-room.test", displayName: "Client Business User", accountType: "business", role: ROLES.clientBusinessUser }),
  fixedAccount({ id: "formal-account-client-business-second", username: "client-second@sample-room.test", displayName: "Client Business User 2", accountType: "business", role: ROLES.clientBusinessUser }),
  fixedAccount({ id: "formal-account-client-business-other", username: "client-other@sample-room.test", displayName: "Other Client Business User", accountType: "business", role: ROLES.clientBusinessUser }),
  fixedAccount({ id: "formal-account-client-business-archived", username: "client-archived@sample-room.test", displayName: "Archived Client Business User", accountType: "business", role: ROLES.clientBusinessUser }),
  fixedAccount({ id: "formal-account-worker-cutting", phoneNumber: "13800000001", displayName: "裁剪员工一号", accountType: "worker", role: ROLES.worker }),
  fixedAccount({ id: "formal-account-worker-cutting-2", phoneNumber: "13800000011", displayName: "裁剪员工二号", accountType: "worker", role: ROLES.worker }),
  fixedAccount({ id: "formal-account-worker-sewing", phoneNumber: "13800000002", displayName: "缝制员工一号", accountType: "worker", role: ROLES.worker }),
  fixedAccount({ id: "formal-account-worker-sewing-2", phoneNumber: "13800000012", displayName: "缝制员工二号", accountType: "worker", role: ROLES.worker }),
  fixedAccount({ id: "formal-account-worker-sewing-3", phoneNumber: "13800000013", displayName: "缝制员工三号", accountType: "worker", role: ROLES.worker }),
  fixedAccount({ id: "formal-account-worker-qc", phoneNumber: "13800000003", displayName: "组检出库员工一号", accountType: "worker", role: ROLES.worker }),
  fixedAccount({ id: "formal-account-worker-qc-2", phoneNumber: "13800000014", displayName: "组检出库员工二号", accountType: "worker", role: ROLES.worker })
];

FIXED_IDENTITY_ACCOUNTS.push(
  { ...fixedAccount({ id: "formal-account-suspended", username: "suspended@sample-room.test", displayName: "Suspended Account", accountType: "business", role: ROLES.receiver }), status: "suspended" },
  { ...fixedAccount({ id: "formal-account-pending", username: "pending@sample-room.test", displayName: "Pending Account", accountType: "business", role: ROLES.receiver }), status: "pending" }
);

function fixedWorkerProfile(id: string, accountId: string, workerType: WorkerType): WorkerProfileRecord {
  return {
    id,
    accountId,
    workerType,
    status: "active",
    effectiveAt: FIXTURE_TIME,
    endedAt: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME
  };
}

export const FIXED_WORKER_PROFILES: WorkerProfileRecord[] = [
  fixedWorkerProfile("formal-worker-profile-cutting", "formal-account-worker-cutting", WORKER_TYPES.cutting),
  fixedWorkerProfile("formal-worker-profile-cutting-2", "formal-account-worker-cutting-2", WORKER_TYPES.cutting),
  fixedWorkerProfile("formal-worker-profile-sewing", "formal-account-worker-sewing", WORKER_TYPES.sewing),
  fixedWorkerProfile("formal-worker-profile-sewing-2", "formal-account-worker-sewing-2", WORKER_TYPES.sewing),
  fixedWorkerProfile("formal-worker-profile-sewing-3", "formal-account-worker-sewing-3", WORKER_TYPES.sewing),
  fixedWorkerProfile("formal-worker-profile-qc", "formal-account-worker-qc", WORKER_TYPES.qcDelivery),
  fixedWorkerProfile("formal-worker-profile-qc-2", "formal-account-worker-qc-2", WORKER_TYPES.qcDelivery)
];
