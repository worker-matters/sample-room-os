import { randomBytes } from "node:crypto";
import type { RepositoryContext } from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import { LoginRejectedError } from "../auth/authService.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { FORMAL_LOGIN_DEV_PASSWORD } from "../auth/devAuthAccounts.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import type { MiniappIdentityService } from "./miniappIdentityService.js";

type DevelopmentPersona = {
  key: string;
  label: string;
  username?: string;
  phoneNumber?: string;
};

type TestModeSession = {
  mode: "development" | "release_preview";
  expiresAt: number;
};

type StoredReleasePreviewConfig = {
  enabled: boolean;
  username: string;
  passwordHash: string;
  expiresAt: string | null;
};

export type ReleasePreviewConfig = {
  enabled: boolean;
  configured: boolean;
  username: string;
  expiresAt: string | null;
  updatedAt?: string;
  updatedBy?: string;
};

const PERSONAS: readonly DevelopmentPersona[] = [
  { key: "system-owner", label: "System Owner", username: "system-owner@sample-room.test" },
  { key: "boss", label: "老板", username: "boss@sample-room.test" },
  { key: "receiver", label: "接单员", username: "receiver@sample-room.test" },
  { key: "planner", label: "计划员", username: "planner@sample-room.test" },
  { key: "pattern-maker", label: "版师", username: "pattern-maker@sample-room.test" },
  { key: "client-admin", label: "客户主管", username: "client-admin@sample-room.test" },
  { key: "client-business", label: "客户业务员", username: "client-own@sample-room.test" },
  { key: "cutting", label: "裁剪", phoneNumber: "13800000001" },
  { key: "sewing", label: "缝制", phoneNumber: "13800000002" },
  { key: "qc-delivery", label: "组检/出库", phoneNumber: "13800000003" }
];

const DEV_TEST_MODE_USERNAME = "miniapp-test";
const TEST_MODE_SETTING_KEY = "miniapp_release_preview_v1";
const TEST_MODE_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_RELEASE_PREVIEW_HOURS = 24;

export function developmentPersonasEnabled(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV === "production") return false;
  if (env.NODE_ENV === "test") return true;
  return env.PERSISTENCE_MODE === "memory" && env.ENABLE_MINIAPP_FAKE_PERSONAS === "true";
}

const cleanUsername = (value: unknown) => typeof value === "string" ? value.trim() : "";
const safeConfig = (stored: StoredReleasePreviewConfig | undefined, record?: Record<string, unknown>): ReleasePreviewConfig => ({
  enabled: Boolean(stored?.enabled && stored.expiresAt && Date.parse(stored.expiresAt) > Date.now()),
  configured: Boolean(stored?.username && stored.passwordHash),
  username: stored?.username ?? "",
  expiresAt: stored?.expiresAt ?? null,
  ...(typeof record?.updatedAt === "string" ? { updatedAt: record.updatedAt } : {}),
  ...(typeof record?.updatedBy === "string" ? { updatedBy: record.updatedBy } : {})
});

export class MiniappDevelopmentPersonaService {
  private readonly testModeSessions = new Map<string, TestModeSession>();

  constructor(
    private readonly identityService: MiniappIdentityService,
    private readonly repositories: RepositoryContext,
    private readonly env: NodeJS.ProcessEnv
  ) {}

  async tryLoginTestMode(payload: { username?: unknown; password?: unknown }) {
    const username = cleanUsername(payload.username);
    const password = typeof payload.password === "string" ? payload.password : "";
    if (developmentPersonasEnabled(this.env) && username === DEV_TEST_MODE_USERNAME) {
      if (password !== FORMAL_LOGIN_DEV_PASSWORD) throw new HttpError(401, "invalid_credentials");
      return this.createTestModeSession("development", TEST_MODE_TTL_MS);
    }

    const stored = await this.readStoredConfig();
    if (!stored || username !== stored.username) return undefined;
    if (!stored.enabled || !stored.expiresAt || Date.parse(stored.expiresAt) <= Date.now()) {
      throw new LoginRejectedError("account_inactive");
    }
    if (!verifyPassword(password, stored.passwordHash)) throw new LoginRejectedError("password_mismatch");
    return this.createTestModeSession("release_preview", Date.parse(stored.expiresAt) - Date.now());
  }

  listForSession(rawToken: string) {
    this.requireTestModeSession(rawToken);
    return PERSONAS.map(({ key, label }) => ({ key, label }));
  }

  async login(keyValue: unknown, rawToken: string) {
    const session = this.requireTestModeSession(rawToken);
    if (typeof keyValue !== "string") throw new HttpError(404, "fake_persona_not_found");
    const persona = PERSONAS.find((item) => item.key === keyValue);
    if (!persona) throw new HttpError(404, "fake_persona_not_found");
    if (session.mode === "release_preview") {
      return { preview: true as const, personaKey: persona.key, mode: session.mode };
    }
    return {
      ...(await this.identityService.login({
        ...(persona.username ? { username: persona.username } : {}),
        ...(persona.phoneNumber ? { phoneNumber: persona.phoneNumber } : {}),
        password: FORMAL_LOGIN_DEV_PASSWORD
      })),
      preview: false as const,
      mode: session.mode
    };
  }

  logoutTestMode(rawToken: string) {
    this.requireTestModeSession(rawToken);
    this.testModeSessions.delete(rawToken);
    return { ok: true as const };
  }

  async getReleasePreviewConfig() {
    const record = await this.repositories.systemSettings?.findSystemSetting(TEST_MODE_SETTING_KEY);
    const stored = this.parseStoredConfig(record?.value);
    return safeConfig(stored, record);
  }

  async updateReleasePreviewConfig(
    currentUser: CurrentUser,
    input: { enabled?: unknown; username?: unknown; password?: unknown; expiresInHours?: unknown }
  ) {
    if (!this.repositories.systemSettings) throw new HttpError(503, "system settings repository unavailable");
    const before = await this.getReleasePreviewConfig();
    const previous = await this.readStoredConfig();
    const enabled = input.enabled === true;
    const username = cleanUsername(input.username) || previous?.username || "";
    if (username.length < 4 || username.length > 80) throw new HttpError(400, "invalid_test_mode_username");
    if (await this.repositories.accounts?.findAccountByUsername(username)) {
      throw new HttpError(409, "test_mode_username_conflicts_with_account");
    }
    const suppliedPassword = typeof input.password === "string" ? input.password : "";
    if (suppliedPassword && suppliedPassword.length < 10) throw new HttpError(400, "test_mode_password_too_short");
    const passwordHash = suppliedPassword ? hashPassword(suppliedPassword) : previous?.passwordHash ?? "";
    if (enabled && !passwordHash) throw new HttpError(400, "test_mode_password_required");
    const hours = Number(input.expiresInHours ?? 8);
    if (enabled && (!Number.isFinite(hours) || hours < 1 || hours > MAX_RELEASE_PREVIEW_HOURS)) {
      throw new HttpError(400, "test_mode_expiry_must_be_1_to_24_hours");
    }
    const value: StoredReleasePreviewConfig = {
      enabled,
      username,
      passwordHash,
      expiresAt: enabled ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() : null
    };
    await this.repositories.systemSettings.upsertSystemSetting({
      key: TEST_MODE_SETTING_KEY,
      value,
      updatedBy: currentUser.accountId ?? currentUser.id
    });
    this.testModeSessions.clear();
    const after = await this.getReleasePreviewConfig();
    await this.repositories.operationLogs?.appendOperationLog({
      actorId: currentUser.accountId ?? currentUser.id,
      actorRole: currentUser.role,
      action: enabled ? "miniapp_release_preview_enabled" : "miniapp_release_preview_disabled",
      targetType: "SystemSetting",
      targetId: TEST_MODE_SETTING_KEY,
      before,
      after
    });
    return after;
  }

  private createTestModeSession(mode: TestModeSession["mode"], ttlMs: number) {
    const testModeToken = randomBytes(32).toString("base64url");
    const expiresAtMs = Date.now() + Math.max(1, ttlMs);
    this.testModeSessions.set(testModeToken, { mode, expiresAt: expiresAtMs });
    return {
      testMode: true as const,
      mode,
      testModeToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
      homeRoute: "/pages/dev/test-mode" as const
    };
  }

  private requireTestModeSession(rawToken: string) {
    const session = this.testModeSessions.get(rawToken);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) this.testModeSessions.delete(rawToken);
      throw new HttpError(401, "miniapp_test_mode_required");
    }
    return session;
  }

  private async readStoredConfig() {
    const record = await this.repositories.systemSettings?.findSystemSetting(TEST_MODE_SETTING_KEY);
    return this.parseStoredConfig(record?.value);
  }

  private parseStoredConfig(value: unknown): StoredReleasePreviewConfig | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const candidate = value as Partial<StoredReleasePreviewConfig>;
    if (typeof candidate.enabled !== "boolean" || typeof candidate.username !== "string" ||
        typeof candidate.passwordHash !== "string" ||
        (candidate.expiresAt !== null && typeof candidate.expiresAt !== "string")) return undefined;
    return candidate as StoredReleasePreviewConfig;
  }
}
