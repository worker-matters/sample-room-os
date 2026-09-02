import type { IntakeStatus, MaterialStatus, OrderStage, PatternStatus } from "./statuses.js";
import type {
  AccountStatus,
  AccountType,
  WorkerProfileStatus,
  WorkerType
} from "./identity.js";
import type { Role } from "./roles.js";

export type AccountDto = {
  id: string;
  username: string | null;
  phoneNumber: string | null;
  displayName: string;
  accountType: AccountType;
  role: Role;
  status: AccountStatus;
};

export type WorkerProfileDto = {
  id: string;
  accountId: string;
  workerType: WorkerType;
  status: WorkerProfileStatus;
  effectiveAt: string;
  endedAt: string | null;
};

export type OrderStateSnapshot = {
  sourceType?: "client_submission" | "receiver_self_entry" | "internal_manual";
  intakeStatus: IntakeStatus;
  stage: OrderStage | null;
  patternStatus: PatternStatus;
  fabricStatus: MaterialStatus;
  trimStatus: MaterialStatus;
  isInFormalFlow: boolean;
};

export type OrderSummaryDto = {
  id: string;
  orderNo: string;
  customerId: string;
  clientUserId: string | null;
  styleNo: string;
  styleName: string;
  quantity: number;
  state: OrderStateSnapshot;
};
