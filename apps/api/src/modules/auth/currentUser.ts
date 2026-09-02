import type { NextFunction, Request, Response } from "express";
import { CLIENT_ACCESS_SCOPES, ROLES, type AccountClientType, type AccountType, type ClientAccessScope, type Role, type WorkerType } from "@sample-room/shared";

export type CurrentUser = {
  accountId?: string | undefined;
  accountType?: AccountType | undefined;
  homeRoute?: string | undefined;
  activeWorkerProfileId?: string | undefined;
  activeWorkerType?: WorkerType | undefined;
  sessionClientType?: AccountClientType | undefined;
  /** Compatibility alias used by existing authorization and audit code. */
  id: string;
  role: Role;
  displayName?: string | undefined;
  phoneNumber?: string | undefined;
  customerId?: string | undefined;
  clientUserId?: string | undefined;
  clientAccessScope?: ClientAccessScope | undefined;
  mustChangePassword?: boolean | undefined;
};

declare global {
  namespace Express {
    interface Request {
      currentUser?: CurrentUser;
    }
  }
}

const roles = new Set<Role>(Object.values(ROLES));

function headerValue(req: Request, name: string) {
  const value = req.header(name);
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function devHeader(req: Request, name: string) {
  return headerValue(req, `x-dev-${name}`) ?? headerValue(req, `x-mock-${name}`);
}

function defaultUserId(role: Role) {
  if (role === ROLES.clientAdmin || role === ROLES.clientBusinessUser) {
    return "mock-client-user-active";
  }

  if (role === ROLES.receiver) {
    return "mock-receiver";
  }

  if (role === ROLES.patternMaker) {
    return "mock-pattern-maker";
  }

  if (role === ROLES.planner) {
    return "mock-planner";
  }

  if (role === ROLES.boss) {
    return "mock-boss";
  }

  if (role === ROLES.systemOwner) {
    return "mock-system-owner";
  }

  return `${role}-mock-user`;
}

function devClientAccessScope(req: Request) {
  const scope = devHeader(req, "client-access-scope");
  return scope === CLIENT_ACCESS_SCOPES.customerAll || scope === CLIENT_ACCESS_SCOPES.own
    ? scope
    : undefined;
}

export function mockCurrentUser(req: Request, _res: Response, next: NextFunction) {
  const headerRole = devHeader(req, "role");
  const role = roles.has(headerRole as Role) ? (headerRole as Role) : ROLES.clientBusinessUser;
  const isUnboundClient = devHeader(req, "unbound-client") === "true";

  req.currentUser = {
    id: devHeader(req, "user-id") ?? defaultUserId(role),
    accountId: devHeader(req, "user-id") ?? defaultUserId(role),
    accountType: role === ROLES.worker ? "worker" : "business",
    homeRoute: `/${role}/home`,
    role,
    displayName: devHeader(req, "display-name"),
    activeWorkerProfileId: devHeader(req, "active-worker-profile-id"),
    activeWorkerType: devHeader(req, "active-worker-type") as WorkerType | undefined,
    customerId:
      devHeader(req, "customer-id") ??
      ((role === ROLES.clientAdmin || role === ROLES.clientBusinessUser) && !isUnboundClient ? "mock-customer-active" : undefined),
    clientUserId:
      devHeader(req, "client-user-id") ??
      ((role === ROLES.clientAdmin || role === ROLES.clientBusinessUser) && !isUnboundClient ? "mock-client-user-active" : undefined),
    clientAccessScope:
      role === ROLES.clientAdmin
        ? CLIENT_ACCESS_SCOPES.customerAll
        : role === ROLES.clientBusinessUser
          ? devClientAccessScope(req) ?? CLIENT_ACCESS_SCOPES.own
          : undefined
  };

  next();
}

export function requireRoles(...allowedRoles: Role[]) {
  const allowed = new Set(allowedRoles);

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.currentUser || !allowed.has(req.currentUser.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    if (req.currentUser.mustChangePassword && req.baseUrl !== "/api/auth") {
      res.status(403).json({ error: "password_change_required" });
      return;
    }

    next();
  };
}
