import { CLIENT_ACCESS_SCOPES, type ClientAccessScope } from "@sample-room/shared";
import type { DevRole, DevSession } from "./DevSessionContext";
import { roleHomePaths } from "./DevSessionContext";

type FormalRouteUser = Pick<DevSession, "role" | "clientAccessScope" | "activeWorkerType">;

export const formalMobileHomePaths: Partial<Record<DevRole, string>> = {
  client_admin: "/client/mobile",
  client_business_user: "/client/mobile",
  receiver: "/receiver/mobile",
  planner: "/planner/mobile"
};

const mobileRouteRoles: Record<string, DevRole[]> = {
  "/qc/tablet": ["worker"],
  "/worker/mobile": ["worker"],
  "/receiver/tablet": ["receiver"],
  "/planner/tablet": ["planner"],
  "/client/mobile": ["client_admin", "client_business_user"],
  "/receiver/mobile": ["receiver"],
  "/planner/mobile": ["planner"]
};

const clientReturnPathScopes: Record<string, ClientAccessScope[]> = {
  "/client": [CLIENT_ACCESS_SCOPES.own],
  "/client/orders": [CLIENT_ACCESS_SCOPES.own, CLIENT_ACCESS_SCOPES.customerAll],
  "/client/users": [CLIENT_ACCESS_SCOPES.customerAll]
};

const internalReturnPathRoles: Record<string, DevRole[]> = {
  "/account/security": ["client_admin", "client_business_user", "receiver", "pattern_maker", "planner", "boss", "system_owner", "worker"],
  "/pattern-maker": ["pattern_maker"],
  "/admin/pricing": ["boss"],
  "/admin/workers": ["boss"],
  "/admin/accounts": ["boss"],
  "/admin/internal-accounts": ["boss"],
  "/system-owner/pricing": ["system_owner"],
  "/system-owner/performance": ["system_owner"],
  "/system-owner/customers": ["system_owner"],
  "/system-owner/internal-accounts": ["system_owner"],
  "/system-owner/workers": ["system_owner"],
  "/system-owner/maintenance": ["system_owner"]
};

function getClientDesktopHomePath(user: FormalRouteUser) {
  if (user.role === "client_admin") {
    return "/client/users";
  }

  return roleHomePaths[user.role];
}

export function getFormalRoleHomePath(
  user: FormalRouteUser,
  options: { preferMobileHome?: boolean | undefined } = {}
) {
  if (user.role === "worker") {
    if (user.activeWorkerType === "qc_delivery") {
      return "/qc/tablet";
    }
    if (
      options.preferMobileHome &&
      (user.activeWorkerType === "cutting" || user.activeWorkerType === "sewing")
    ) {
      return "/worker/mobile";
    }
    return "/help";
  }
  if (options.preferMobileHome) {
    return formalMobileHomePaths[user.role] ?? getClientDesktopHomePath(user);
  }

  return getClientDesktopHomePath(user);
}

export function isSafeInternalReturnPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

export function getPathnameFromInternalPath(value: string) {
  return new URL(value, "https://sample-room.local").pathname;
}

export function canUserOpenMobileRoute(user: FormalRouteUser, returnTo: string) {
  if (!isSafeInternalReturnPath(returnTo)) {
    return false;
  }

  const roles = mobileRouteRoles[getPathnameFromInternalPath(returnTo)];
  return roles ? roles.includes(user.role) : false;
}

export function canUserOpenReturnPath(user: FormalRouteUser, returnTo: string) {
  if (!isSafeInternalReturnPath(returnTo)) {
    return false;
  }

  const pathname = getPathnameFromInternalPath(returnTo);
  if (pathname === "/login") {
    return false;
  }

  if ((user.role as string) === "worker" && pathname.startsWith("/scan/")) {
    return true;
  }
  if (user.role === "worker" && pathname === "/qc/tablet") {
    return user.activeWorkerType === "qc_delivery";
  }
  if (user.role === "worker" && pathname === "/worker/mobile") {
    return user.activeWorkerType === "cutting" || user.activeWorkerType === "sewing";
  }
  if (user.role === "worker" && pathname === "/account/security") {
    return user.activeWorkerType === "qc_delivery";
  }

  const clientScopes = clientReturnPathScopes[pathname];
  if (clientScopes) {
    return (
      (user.role === "client_admin" || user.role === "client_business_user") &&
      user.clientAccessScope !== undefined &&
      clientScopes.includes(user.clientAccessScope)
    );
  }

  if (pathname === getClientDesktopHomePath(user)) {
    return true;
  }

  const internalRoles = internalReturnPathRoles[pathname];
  if (internalRoles?.includes(user.role)) {
    return true;
  }

  return canUserOpenMobileRoute(user, returnTo);
}

export function getFormalPostLoginPath(
  user: FormalRouteUser,
  options: { returnTo?: unknown; preferMobileHome?: boolean | undefined } = {}
) {
  if (
    typeof options.returnTo === "string" &&
    canUserOpenReturnPath(user, options.returnTo)
  ) {
    return options.returnTo;
  }

  return getFormalRoleHomePath(user, { preferMobileHome: options.preferMobileHome });
}
