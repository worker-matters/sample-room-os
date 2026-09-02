import type {
  AccountClientType,
  AccountType,
  ClientAccessScope,
  Role
} from "@sample-room/shared";
import type { CurrentUser } from "./currentUser.js";

export type AuthenticatedUserDto = {
  /** Compatibility alias for accountId while existing Web clients migrate. */
  id: string;
  accountId: string;
  accountType: AccountType;
  role: Role;
  homeRoute: string;
  activeWorkerProfileId?: string | undefined;
  activeWorkerType?: import("@sample-room/shared").WorkerType | undefined;
  displayName?: string | undefined;
  phoneNumber?: string | undefined;
  customerId?: string | undefined;
  clientUserId?: string | undefined;
  clientAccessScope?: ClientAccessScope | undefined;
  mustChangePassword?: boolean | undefined;
};

export type LoginResult = {
  token: string;
  expiresAt: string;
  clientType: AccountClientType;
  user: AuthenticatedUserDto;
};

/** @deprecated Phase 1B compatibility shape for non-Auth services pending Phase 3-5. */
export type AuthAccountStatus = "active" | "archived" | "disabled";
/** @deprecated Use AccountRecord. */
export type AuthAccountRecord = {
  id: string;
  username: string;
  displayName: string;
  contact?: string | undefined;
  role: Role;
  status: AuthAccountStatus;
  passwordHash: string;
  customerId?: string | undefined;
  clientUserId?: string | undefined;
  clientAccessScope?: ClientAccessScope | undefined;
  mustChangePasswordAtNextLogin?: boolean | undefined;
  lastPasswordResetAt?: string | undefined;
};
export function toAuthenticatedUserDto(currentUser: CurrentUser): AuthenticatedUserDto {
  return {
    id: currentUser.accountId ?? currentUser.id,
    accountId: currentUser.accountId ?? currentUser.id,
    accountType: currentUser.accountType ?? (currentUser.role === "worker" ? "worker" : "business"),
    role: currentUser.role,
    homeRoute: currentUser.homeRoute ?? `/${currentUser.role}/home`,
    ...(currentUser.activeWorkerProfileId
      ? { activeWorkerProfileId: currentUser.activeWorkerProfileId }
      : {}),
    ...(currentUser.activeWorkerType
      ? { activeWorkerType: currentUser.activeWorkerType }
      : {}),
    ...(currentUser.displayName !== undefined ? { displayName: currentUser.displayName } : {}),
    ...(currentUser.phoneNumber !== undefined ? { phoneNumber: currentUser.phoneNumber } : {}),
    ...(currentUser.customerId !== undefined ? { customerId: currentUser.customerId } : {}),
    ...(currentUser.clientUserId !== undefined ? { clientUserId: currentUser.clientUserId } : {}),
    ...(currentUser.clientAccessScope !== undefined
      ? { clientAccessScope: currentUser.clientAccessScope }
      : {}),
    mustChangePassword: currentUser.mustChangePassword === true
  };
}
