import { ROLES, type WorkerType } from "@sample-room/shared";
import type { CurrentUser } from "../auth/currentUser.js";
import type { FormalAuthService } from "../auth/authService.js";
import { HttpError } from "../../shared/errors/httpError.js";

type MiniappLoginInput = {
  username?: unknown;
  phoneNumber?: unknown;
  password?: unknown;
};

const miniappHomeRoute = (user: CurrentUser, workerType?: WorkerType) => {
  switch (user.role) {
    case ROLES.receiver: return "/pages/receiver/home";
    case ROLES.planner: return "/pages/planner/home";
    case ROLES.clientAdmin:
    case ROLES.clientBusinessUser: return "/pages/client/orders";
    case ROLES.worker: return workerType ? "/pages/worker/home" : "/pages/identity/disabled";
    case ROLES.boss:
    case ROLES.systemOwner: return "/pages/account/boss";
    case ROLES.patternMaker: return "/pages/identity/identity";
  }
};

const canScanOrder = (user: CurrentUser, workerType?: WorkerType) =>
  user.role === ROLES.receiver ||
  user.role === ROLES.planner ||
  (user.role === ROLES.worker && Boolean(workerType));

export class MiniappIdentityService {
  constructor(private readonly authService: FormalAuthService) {}

  async login(payload: MiniappLoginInput) {
    const result = await this.authService.login(
      {
        username: payload.username,
        phoneNumber: payload.phoneNumber,
        password: payload.password,
        clientType: "miniapp"
      },
      { appVersion: "wechat-miniprogram" }
    );
    const currentUser = await this.authService.authenticate(result.token);
    if (!currentUser) throw new HttpError(401, "miniapp_session_invalid");
    return {
      sessionToken: result.token,
      expiresAt: result.expiresAt,
      identity: this.identityFromCurrentUser(currentUser)
    };
  }

  async resolveBySessionToken(rawToken: string) {
    const currentUser = await this.authService.authenticate(rawToken);
    if (!currentUser) throw new HttpError(401, "miniapp_session_invalid");
    return {
      currentUser,
      identity: this.identityFromCurrentUser(currentUser)
    };
  }

  async refresh(rawToken: string) {
    const result = await this.authService.refresh(rawToken);
    const currentUser = await this.authService.authenticate(result.token);
    if (!currentUser) throw new HttpError(401, "miniapp_session_invalid");
    return {
      sessionToken: result.token,
      expiresAt: result.expiresAt,
      identity: this.identityFromCurrentUser(currentUser)
    };
  }

  async logout(rawToken: string) {
    await this.authService.logout(rawToken);
    return { ok: true as const };
  }

  async resolveReceiverCurrentUser(rawToken: string): Promise<CurrentUser> {
    return this.requireRole(rawToken, ROLES.receiver, "receiver_miniapp_identity_required");
  }

  async resolvePlannerCurrentUser(rawToken: string): Promise<CurrentUser> {
    return this.requireRole(rawToken, ROLES.planner, "planner_miniapp_identity_required");
  }

  async resolveBossCurrentUser(rawToken: string): Promise<CurrentUser> {
    const { currentUser } = await this.resolveBySessionToken(rawToken);
    if (currentUser.role !== ROLES.boss && currentUser.role !== ROLES.systemOwner) {
      throw new HttpError(403, "boss_miniapp_identity_required");
    }
    return currentUser;
  }

  async resolveWorkerCurrentUser(rawToken: string): Promise<CurrentUser> {
    const currentUser = await this.requireRole(
      rawToken,
      ROLES.worker,
      "worker_miniapp_identity_required"
    );
    if (!currentUser.activeWorkerProfileId || !currentUser.activeWorkerType) {
      throw new HttpError(403, "worker_miniapp_identity_required");
    }
    return currentUser;
  }

  async resolveClientCurrentUser(rawToken: string): Promise<CurrentUser> {
    const { currentUser } = await this.resolveBySessionToken(rawToken);
    if (currentUser.role !== ROLES.clientAdmin && currentUser.role !== ROLES.clientBusinessUser) {
      throw new HttpError(403, "client_miniapp_identity_required");
    }
    return currentUser;
  }

  private async requireRole(rawToken: string, role: CurrentUser["role"], errorCode: string) {
    const { currentUser } = await this.resolveBySessionToken(rawToken);
    if (currentUser.role !== role) throw new HttpError(403, errorCode);
    return currentUser;
  }

  private identityFromCurrentUser(user: CurrentUser) {
    const workerType = user.role === ROLES.worker ? user.activeWorkerType : undefined;
    const passwordChangeRequired = user.mustChangePassword === true;
    return {
      status: passwordChangeRequired
        ? "password_change_required"
        : "active",
      identityType: "account" as const,
      accountId: user.accountId ?? user.id,
      accountType: user.accountType ?? (user.role === ROLES.worker ? "worker" : "business"),
      role: user.role,
      ...(workerType ? { workerType, activeWorkerProfileId: user.activeWorkerProfileId } : {}),
      ...(user.displayName ? { displayName: user.displayName } : {}),
      homeRoute: passwordChangeRequired
        ? "/pages/identity/password-required"
        : miniappHomeRoute(user, workerType),
      canScanOrder: !passwordChangeRequired && canScanOrder(user, workerType)
    } as const;
  }

}
