import { createHash } from "node:crypto";
import type { Request } from "express";
import type { Role } from "@sample-room/shared";
import type { OperationLogRepository } from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import { LoginRejectedError } from "./authService.js";

const accountWindowMs = 15 * 60 * 1000;
const accountLockMs = 15 * 60 * 1000;
const accountFailureLimit = 5;
const ipWindowMs = 10 * 60 * 1000;
const ipAttemptLimit = 20;
const maximumTrackedKeys = 10_000;

type AccountAttemptState = {
  failures: number[];
  lockedUntil?: number;
};

type LoginActor = {
  id?: string;
  role?: Role;
};

function normalizedIdentifier(payload: unknown) {
  if (!payload || typeof payload !== "object") return "missing";
  const input = payload as Record<string, unknown>;
  const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
  const phoneNumber = typeof input.phoneNumber === "string" ? input.phoneNumber.trim() : "";
  return username ? `username:${username}` : phoneNumber ? `phone:${phoneNumber}` : "missing";
}

function identifierHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requestIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function actorFromResult(result: unknown): LoginActor {
  if (!result || typeof result !== "object") return {};
  const record = result as Record<string, unknown>;
  const candidate =
    record.user && typeof record.user === "object"
      ? record.user as Record<string, unknown>
      : record.identity && typeof record.identity === "object"
        ? record.identity as Record<string, unknown>
        : undefined;
  if (!candidate) return {};
  return {
    ...(typeof candidate.accountId === "string"
      ? { id: candidate.accountId }
      : typeof candidate.id === "string"
        ? { id: candidate.id }
        : {}),
    ...(typeof candidate.role === "string" ? { role: candidate.role as Role } : {})
  };
}

export class LoginProtectionService {
  private readonly accountAttempts = new Map<string, AccountAttemptState>();
  private readonly accountAliases = new Map<string, string>();
  private readonly ipAttempts = new Map<string, number[]>();
  private readonly identifierLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly operationLogs?: OperationLogRepository,
    private readonly now: () => number = Date.now
  ) {}

  private prune(values: number[], since: number) {
    return values.filter((value) => value > since);
  }

  private boundedSet<T>(map: Map<string, T>, key: string, value: T) {
    if (!map.has(key) && map.size >= maximumTrackedKeys) {
      const oldest = map.keys().next().value as string | undefined;
      if (oldest) map.delete(oldest);
    }
    map.set(key, value);
  }

  private accountKey(identifier: string) {
    const accountId = this.accountAliases.get(identifier);
    return accountId ? `account:${accountId}` : identifier;
  }

  private async audit(
    req: Request,
    action: string,
    surface: "web" | "miniapp",
    identifier: string,
    actor: LoginActor = {},
    result?: string
  ) {
    await this.operationLogs?.appendOperationLog({
      ...(actor.id ? { actorId: actor.id } : {}),
      ...(actor.role ? { actorRole: actor.role } : {}),
      action,
      targetType: "login",
      targetId: identifierHash(identifier),
      ip: requestIp(req),
      ...(req.header("user-agent") ? { userAgent: req.header("user-agent")! } : {}),
      payload: {
        surface,
        ...(result ? { result } : {})
      }
    });
  }

  private safeAudit(
    req: Request,
    action: string,
    surface: "web" | "miniapp",
    identifier: string,
    actor: LoginActor = {},
    result?: string
  ) {
    void this.audit(req, action, surface, identifier, actor, result).catch((error) => {
      console.error("login audit failed", {
        action,
        error: error instanceof Error ? error.message : "unknown_error"
      });
    });
  }

  private async withIdentifierLock<T>(identifier: string, action: () => Promise<T>) {
    const previous = this.identifierLocks.get(identifier) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.identifierLocks.set(identifier, current);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.identifierLocks.get(identifier) === current) {
        this.identifierLocks.delete(identifier);
      }
    }
  }

  private rejectForIp(
    req: Request,
    surface: "web" | "miniapp",
    identifier: string
  ) {
    const now = this.now();
    const ip = requestIp(req);
    const recent = this.prune(this.ipAttempts.get(ip) ?? [], now - ipWindowMs);
    if (recent.length >= ipAttemptLimit) {
      this.boundedSet(this.ipAttempts, ip, recent);
      this.safeAudit(req, "auth.login.rate_limited", surface, identifier, {}, "ip_limit");
      throw new HttpError(429, "invalid_credentials");
    }
    recent.push(now);
    this.boundedSet(this.ipAttempts, ip, recent);
  }

  private rejectForAccountLock(
    req: Request,
    surface: "web" | "miniapp",
    identifier: string
  ) {
    const now = this.now();
    const key = this.accountKey(identifier);
    const state = this.accountAttempts.get(key);
    if (state?.lockedUntil && state.lockedUntil > now) {
      this.safeAudit(req, "auth.login.rate_limited", surface, identifier, {}, "account_locked");
      throw new HttpError(429, "invalid_credentials");
    }
    if (state?.lockedUntil) {
      this.accountAttempts.delete(key);
    }
  }

  private recordFailure(identifier: string, accountId?: string) {
    const now = this.now();
    let key = this.accountKey(identifier);
    if (accountId) {
      const canonicalKey = `account:${accountId}`;
      this.boundedSet(this.accountAliases, identifier, accountId);
      if (key !== canonicalKey) {
        const aliasState = this.accountAttempts.get(key);
        const canonicalState = this.accountAttempts.get(canonicalKey);
        if (aliasState && !canonicalState) this.accountAttempts.set(canonicalKey, aliasState);
        this.accountAttempts.delete(key);
      }
      key = canonicalKey;
    }
    const state = this.accountAttempts.get(key) ?? { failures: [] };
    state.failures = this.prune(state.failures, now - accountWindowMs);
    state.failures.push(now);
    if (state.failures.length >= accountFailureLimit) {
      state.lockedUntil = now + accountLockMs;
    }
    this.boundedSet(this.accountAttempts, key, state);
    return Boolean(state.lockedUntil && state.lockedUntil > now);
  }

  async execute<T>(
    req: Request,
    surface: "web" | "miniapp",
    payload: unknown,
    attempt: () => Promise<T>
  ): Promise<T> {
    const identifier = normalizedIdentifier(payload);
    this.rejectForIp(req, surface, identifier);
    return this.withIdentifierLock(identifier, async () => {
      this.rejectForAccountLock(req, surface, identifier);
      try {
        const result = await attempt();
        this.accountAttempts.delete(identifier);
        const actor = actorFromResult(result);
        if (actor.id) this.accountAttempts.delete(`account:${actor.id}`);
        this.safeAudit(req, "auth.login.success", surface, identifier, actor, "success");
        return result;
      } catch (error) {
        if (!(error instanceof LoginRejectedError)) throw error;
        const actor: LoginActor = {
          ...(error.accountId ? { id: error.accountId } : {}),
          ...(error.accountRole ? { role: error.accountRole } : {})
        };
        const passwordMismatch = error.reason === "password_mismatch";
        const inactive = error.reason === "account_inactive";
        const locked = passwordMismatch
          ? this.recordFailure(identifier, error.accountId)
          : false;
        this.safeAudit(
          req,
          inactive ? "auth.login.account_inactive" : "auth.login.failure",
          surface,
          identifier,
          actor,
          inactive ? "account_inactive" : locked ? "account_locked" : "invalid_credentials"
        );
        throw new HttpError(locked ? 429 : 401, "invalid_credentials");
      }
    });
  }
}
