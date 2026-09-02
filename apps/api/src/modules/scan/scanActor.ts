import type {
  AccountRecord,
  AccountRepository,
  WorkerProfileRecord,
  WorkerProfileRepository
} from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";

type WorkerProfileProjection = {
  id: string;
  name: string;
  stage: WorkerProfileRecord["workerType"];
  active: true;
  createdAt: string;
};

export type WorkerScanActor = {
  account: AccountRecord;
  workerProfile: WorkerProfileRecord;
  /** WorkerProfile projection consumed by the unchanged workflow calculators. */
  worker: WorkerProfileProjection;
};

export class ScanActorResolver {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly workerProfiles: WorkerProfileRepository
  ) {}

  async requireActiveAccount(currentUser: CurrentUser) {
    const accountId = currentUser.accountId ?? currentUser.id;
    const account = await this.accounts.findAccountById(accountId);
    if (!account || account.status !== "active") {
      throw new HttpError(403, "ACCOUNT_INACTIVE");
    }
    return account;
  }

  async requireWorkerActor(currentUser: CurrentUser): Promise<WorkerScanActor> {
    const account = await this.requireActiveAccount(currentUser);
    if (account.accountType !== "worker" || account.role !== "worker") {
      throw new HttpError(403, "WORKER_ACCOUNT_REQUIRED");
    }
    const workerProfile = await this.workerProfiles.findActiveWorkerProfileByAccountId(account.id);
    if (!workerProfile) {
      throw new HttpError(403, "NO_ACTIVE_WORKER_PROFILE");
    }
    return {
      account,
      workerProfile,
      worker: {
        id: workerProfile.id,
        name: account.displayName,
        stage: workerProfile.workerType,
        active: true,
        createdAt: workerProfile.createdAt
      }
    };
  }
}
