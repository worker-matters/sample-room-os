import { CLIENT_ACCESS_SCOPES } from "@sample-room/shared";
import type {
  AccountRepository,
  WorkerProfileRepository
} from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";

export const scanTestIdentityIds = [
  "cutting", "cutting_2", "sewing", "sewing_2", "sewing_3",
  "qc_delivery", "qc_delivery_2", "receiver", "planner", "boss",
  "client_supervisor", "client_salesperson"
] as const;
export type ScanTestIdentityId = (typeof scanTestIdentityIds)[number];
export type ScanTestIdentity = { id: ScanTestIdentityId; currentUser: CurrentUser };

const accountIds = {
  receiver: "formal-account-receiver",
  planner: "formal-account-planner",
  boss: "formal-account-boss",
  client_supervisor: "formal-account-client-admin",
  client_salesperson: "formal-account-client-business",
  cutting: "formal-account-worker-cutting",
  cutting_2: "formal-account-worker-cutting-2",
  sewing: "formal-account-worker-sewing",
  sewing_2: "formal-account-worker-sewing-2",
  sewing_3: "formal-account-worker-sewing-3",
  qc_delivery: "formal-account-worker-qc",
  qc_delivery_2: "formal-account-worker-qc-2"
} as const;

function isEnabled(env: NodeJS.ProcessEnv) {
  return env.NODE_ENV === "test" ||
    (env.NODE_ENV !== "production" && env.ENABLE_SCAN_TEST_IDENTITIES === "true");
}
function isIdentityId(value: string): value is ScanTestIdentityId {
  return (scanTestIdentityIds as readonly string[]).includes(value);
}

export class ScanTestIdentityProvider {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly workerProfiles: WorkerProfileRepository,
    private readonly env: NodeJS.ProcessEnv
  ) {}

  async resolve(value: string | undefined): Promise<ScanTestIdentity | undefined> {
    const requested = value?.trim();
    if (!requested) return undefined;
    if (!isEnabled(this.env)) throw new HttpError(403, "scan_test_identity_disabled");
    if (!isIdentityId(requested)) throw new HttpError(400, "invalid_scan_test_identity");

    const account = await this.accounts.findAccountById(accountIds[requested]);
    if (!account) throw new HttpError(500, "scan_test_identity_fixture_missing");
    const profile = account.accountType === "worker"
      ? await this.workerProfiles.findActiveWorkerProfileByAccountId(account.id)
      : undefined;
    if (account.accountType === "worker" && !profile) {
      throw new HttpError(500, "scan_test_worker_profile_fixture_missing");
    }

    const clientSupervisor = requested === "client_supervisor";
    const clientSalesperson = requested === "client_salesperson";
    return {
      id: requested,
      currentUser: {
        id: account.id,
        accountId: account.id,
        accountType: account.accountType,
        role: account.role,
        homeRoute: account.accountType === "worker" ? "/worker/scan" : `/${account.role}/home`,
        displayName: account.displayName,
        ...(profile ? { activeWorkerProfileId: profile.id } : {}),
        ...((clientSupervisor || clientSalesperson)
          ? {
              customerId: "mock-customer-active",
              clientUserId: clientSupervisor ? "mock-client-user-admin" : "mock-client-user-active",
              clientAccessScope: clientSupervisor
                ? CLIENT_ACCESS_SCOPES.customerAll
                : CLIENT_ACCESS_SCOPES.own
            }
          : {})
      }
    };
  }
}
