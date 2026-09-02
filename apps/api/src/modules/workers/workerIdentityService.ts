import { createHash, randomBytes } from "node:crypto";
import {
  IDENTITY_QR_PURPOSES,
  ROLES,
  WORKER_TYPES,
  type IdentityQrPurpose,
  type WorkerType
} from "@sample-room/shared";
import type {
  AccountRecord,
  IdentityQrTokenRecord,
  RepositoryContext,
  WorkerProfileRecord
} from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { hashPassword } from "../auth/password.js";
import type { RuntimeEndpointConfigService } from "../system-owner/runtimeEndpointConfigService.js";

// IdentityQrToken.expiresAt is still non-null in the current compatibility schema.
// REGISTER_WORKER is business-valid until explicit revocation, so new worker-registration
// tokens use a far-future sentinel instead of a user-facing TTL. Legacy expired tokens stay expired.
const REGISTER_WORKER_COMPAT_EXPIRES_AT = "9999-12-31T23:59:59.999Z";

const workerTypeLabels: Record<WorkerType, string> = {
  cutting: "裁剪",
  sewing: "缝制",
  qc_delivery: "组检/出库"
};

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${field} is required.`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredWorkerType(value: unknown): WorkerType {
  if (Object.values(WORKER_TYPES).includes(value as WorkerType)) return value as WorkerType;
  throw new HttpError(400, "workerType must be cutting, sewing, or qc_delivery.");
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function parseIdentityPayload(payload: unknown, expectedPrefix: "REGISTER") {
  const value = requiredText(payload, "payload");
  const parts = value.split("|");
  if (parts.length !== 2 || parts[0] !== expectedPrefix || !/^[A-Za-z0-9_-]{32,256}$/.test(parts[1]!)) {
    throw new HttpError(400, "invalid_identity_qr_payload");
  }
  return parts[1]!;
}

function tokenIsUsable(token: IdentityQrTokenRecord, purpose: IdentityQrPurpose) {
  return token.purpose === purpose && !token.usedAt && !token.revokedAt &&
    Date.parse(token.expiresAt) > Date.now();
}

function safeAccount(account: AccountRecord) {
  return {
    id: account.id,
    displayName: account.displayName,
    phoneNumber: account.phoneNumber,
    accountType: account.accountType,
    role: account.role,
    status: account.status,
    createdAt: account.createdAt
  };
}

function safeProfile(profile: WorkerProfileRecord) {
  return {
    ...profile,
    workerTypeLabel: workerTypeLabels[profile.workerType]
  };
}

function safeToken(token: IdentityQrTokenRecord) {
  return {
    id: token.id,
    purpose: token.purpose,
    workerType: token.workerType,
    workerTypeLabel: token.workerType ? workerTypeLabels[token.workerType] : undefined,
    expiresAt: token.expiresAt,
    usedAt: token.usedAt,
    revokedAt: token.revokedAt,
    createdAt: token.createdAt
  };
}

export class WorkerIdentityService {
  constructor(
    private readonly repositories: RepositoryContext,
    private readonly endpointConfig: RuntimeEndpointConfigService,
    _env: NodeJS.ProcessEnv = process.env
  ) {}

  private ensureBoss(currentUser: CurrentUser) {
    if (currentUser.role !== ROLES.boss && currentUser.role !== ROLES.systemOwner) {
      throw new HttpError(403, "forbidden");
    }
  }

  private accountId(currentUser: CurrentUser) {
    return currentUser.accountId ?? currentUser.id;
  }

  private async issueToken(
    currentUser: CurrentUser,
    workerType: WorkerType
  ) {
    this.ensureBoss(currentUser);
    const actorAccountId = this.accountId(currentUser);
    const now = new Date().toISOString();
    const existingTokens = await this.repositories.identityQrTokens.listIdentityQrTokens();
    await Promise.all(existingTokens
      .filter((token) => token.purpose === IDENTITY_QR_PURPOSES.registerWorker && token.workerType === workerType && !token.usedAt && !token.revokedAt)
      .map((token) => this.repositories.identityQrTokens.revokeIdentityQrToken(token.id, actorAccountId, now)));
    const rawToken = randomBytes(32).toString("base64url");
    const record = await this.repositories.identityQrTokens.createIdentityQrToken({
      tokenHash: tokenHash(rawToken),
      purpose: IDENTITY_QR_PURPOSES.registerWorker,
      initialRole: ROLES.worker,
      workerType,
      issuedByAccountId: actorAccountId,
      expiresAt: REGISTER_WORKER_COMPAT_EXPIRES_AT
    });
    const endpointConfig = await this.endpointConfig.get();
    const registrationPath = `/workers/register/${rawToken}`;
    return {
      token: safeToken(record),
      registrationUrls: {
        public: endpointConfig.publicWebBaseUrl ? `${endpointConfig.publicWebBaseUrl}${registrationPath}` : null,
        lan: endpointConfig.lanWebBaseUrl ? `${endpointConfig.lanWebBaseUrl}${registrationPath}` : null
      }
    };
  }

  issueWorkerRegistration(currentUser: CurrentUser, payload: { workerType?: unknown }) {
    return this.issueToken(
      currentUser,
      requiredWorkerType(payload.workerType)
    );
  }

  async listIdentityTokens(currentUser: CurrentUser) {
    this.ensureBoss(currentUser);
    return (await this.repositories.identityQrTokens.listIdentityQrTokens())
      .filter((token) => token.purpose === IDENTITY_QR_PURPOSES.registerWorker)
      .map(safeToken);
  }

  async revokeIdentityToken(currentUser: CurrentUser, tokenId: string) {
    this.ensureBoss(currentUser);
    const token = await this.repositories.identityQrTokens.findIdentityQrTokenById(tokenId);
    if (!token || token.purpose !== IDENTITY_QR_PURPOSES.registerWorker) {
      throw new HttpError(404, "identity token not found.");
    }
    const revoked = await this.repositories.identityQrTokens.revokeIdentityQrToken(
      token.id,
      this.accountId(currentUser),
      new Date().toISOString()
    );
    if (!revoked) throw new HttpError(409, "identity token is no longer revocable.");
    return { ...safeToken(token), revokedAt: new Date().toISOString() };
  }

  async registrationInfo(payload: unknown) {
    const rawToken = parseIdentityPayload(payload, "REGISTER");
    const token = await this.repositories.identityQrTokens.findIdentityQrTokenByHash(tokenHash(rawToken));
    if (!token || token.purpose !== IDENTITY_QR_PURPOSES.registerWorker || !token.workerType) {
      throw new HttpError(404, "registration token not found.");
    }
    return {
      enabled: tokenIsUsable(token, IDENTITY_QR_PURPOSES.registerWorker),
      workerType: token.workerType,
      workerTypeLabel: workerTypeLabels[token.workerType],
      expiresAt: token.expiresAt
    };
  }

  async registerWorker(payload: {
    payload?: unknown;
    phoneNumber?: unknown;
    password?: unknown;
    name?: unknown;
    workerType?: unknown;
    role?: unknown;
  }) {
    const rawToken = parseIdentityPayload(payload.payload, "REGISTER");
    const phoneNumber = requiredText(payload.phoneNumber, "phoneNumber");
    const password = requiredText(payload.password, "password");
    const displayName = requiredText(payload.name, "name");
    if (password.length < 8) throw new HttpError(400, "密码至少 8 位");
    if (payload.workerType !== undefined || payload.role !== undefined) {
      throw new HttpError(400, "工序由注册码确定，员工不能自行修改");
    }

    return this.repositories.withIdentityTransaction(async ({ accounts, workerProfiles, identityQrTokens }) => {
      const token = await identityQrTokens.findIdentityQrTokenByHash(tokenHash(rawToken));
      if (!token || !tokenIsUsable(token, IDENTITY_QR_PURPOSES.registerWorker) ||
          token.initialRole !== ROLES.worker || !token.workerType) {
        throw new HttpError(409, "该注册码已失效，请联系老板重新获取");
      }
      const existingAccount = await accounts.findAccountByPhoneNumber(phoneNumber, "worker");
      if (existingAccount && existingAccount.status !== "archived") {
        const currentProfile = await workerProfiles.findActiveWorkerProfileByAccountId(existingAccount.id);
        const roleLabel = currentProfile
          ? `${workerTypeLabels[currentProfile.workerType]}员工`
          : "工序员工";
        throw new HttpError(409, `该手机号已注册，角色为：${roleLabel}`);
      }
      const duplicateName = (await accounts.listAccounts()).some(
        (account) => account.accountType === "worker" &&
          account.status !== "archived" &&
          account.id !== existingAccount?.id &&
          account.displayName.trim().toLocaleLowerCase() === displayName.toLocaleLowerCase()
      );
      if (duplicateName) {
        throw new HttpError(409, "该姓名已注册");
      }

      const now = new Date().toISOString();
      const account = existingAccount
        ? await accounts.updateAccount(existingAccount.id, {
            displayName,
            passwordHash: hashPassword(password),
            status: "active",
            mustChangePasswordAtNextLogin: false,
            lastPasswordResetAt: now
          })
        : await accounts.createAccount({
            username: null,
            phoneNumber,
            displayName,
            accountType: "worker",
            role: ROLES.worker,
            status: "active",
            passwordHash: hashPassword(password)
          });
      const histories = await workerProfiles.listWorkerProfilesByAccountId(account.id);
      for (const current of histories.filter((profile) => profile.status === "active")) {
        await workerProfiles.updateWorkerProfile(current.id, { status: "inactive", endedAt: now });
      }
      const historicalTarget = histories.find((profile) => profile.workerType === token.workerType);
      const profile = historicalTarget
        ? await workerProfiles.updateWorkerProfile(historicalTarget.id, { status: "active", effectiveAt: now, endedAt: null })
        : await workerProfiles.createWorkerProfile({ accountId: account.id, workerType: token.workerType, status: "active" });

      // Reuse the existing conditional consume operation as an atomic authorization gate. The
      // reservation is cleared inside the same transaction, so successful registration never
      // consumes REGISTER_WORKER and a later registration may use the same QR again.
      const reserved = await identityQrTokens.consumeIdentityQrToken(
        token.id,
        account.id,
        new Date().toISOString()
      );
      if (!reserved) throw new HttpError(409, "该注册码已失效，请联系老板重新获取");
      await identityQrTokens.updateIdentityQrToken(token.id, {
        usedAt: null,
        usedByAccountId: null
      });

      return { account: safeAccount(account), workerProfile: safeProfile(profile), restored: Boolean(existingAccount) };
    });
  }

  async restoreWorkerProfile(currentUser: CurrentUser, accountId: string, profileId: string) {
    this.ensureBoss(currentUser);
    return this.repositories.withIdentityTransaction(async ({ accounts, workerProfiles }) => {
      const account = await accounts.findAccountById(accountId);
      const target = await workerProfiles.findWorkerProfileById(profileId);
      if (!account || account.status !== "active" || account.accountType !== "worker" || account.role !== ROLES.worker ||
          !target || target.accountId !== account.id) {
        throw new HttpError(404, "Worker Account or WorkerProfile not found.");
      }
      const current = await workerProfiles.findActiveWorkerProfileByAccountId(account.id);
      if (current?.id === target.id) throw new HttpError(409, "WorkerProfile is already active.");
      if (current) {
        await workerProfiles.updateWorkerProfile(current.id, {
          status: "inactive",
          endedAt: new Date().toISOString()
        });
      }
      const restored = await workerProfiles.updateWorkerProfile(target.id, {
        status: "active",
        endedAt: null
      });
      return { account: safeAccount(account), workerProfile: safeProfile(restored) };
    });
  }

  async changeWorkerStage(currentUser: CurrentUser, accountId: string, workerTypeValue: unknown) {
    this.ensureBoss(currentUser);
    const workerType = requiredWorkerType(workerTypeValue);
    return this.repositories.withIdentityTransaction(async ({ accounts, workerProfiles }) => {
      const account = await accounts.findAccountById(accountId);
      if (!account || account.accountType !== "worker" || account.role !== ROLES.worker || account.status !== "active") {
        throw new HttpError(404, "Worker Account not found.");
      }
      const profiles = await workerProfiles.listWorkerProfilesByAccountId(account.id);
      const current = profiles.find((profile) => profile.status === "active");
      if (!current) throw new HttpError(409, "worker account has no active WorkerProfile.");
      if (current.workerType === workerType) throw new HttpError(409, "the requested production position is already active.");
      const now = new Date().toISOString();
      await workerProfiles.updateWorkerProfile(current.id, { status: "inactive", endedAt: now });
      const historicalTarget = profiles.find((profile) => profile.workerType === workerType);
      const profile = historicalTarget
        ? await workerProfiles.updateWorkerProfile(historicalTarget.id, { status: "active", effectiveAt: now, endedAt: null })
        : await workerProfiles.createWorkerProfile({ accountId: account.id, workerType, status: "active", effectiveAt: now });
      return { account: safeAccount(account), previousWorkerProfile: safeProfile({ ...current, status: "inactive", endedAt: now }), workerProfile: safeProfile(profile) };
    });
  }

  async archiveWorkerAccounts(currentUser: CurrentUser, accountIdsValue: unknown) {
    this.ensureBoss(currentUser);
    if (!Array.isArray(accountIdsValue) || accountIdsValue.length === 0 || accountIdsValue.some((id) => typeof id !== "string" || !id)) {
      throw new HttpError(400, "accountIds must be a non-empty string array.");
    }
    const accountIds = [...new Set(accountIdsValue as string[])];
    const archived: string[] = [];
    for (const accountId of accountIds) {
      await this.repositories.withIdentityTransaction(async ({ accounts, workerProfiles }) => {
        const account = await accounts.findAccountById(accountId);
        if (!account || account.accountType !== "worker" || account.role !== ROLES.worker) throw new HttpError(404, "Worker Account not found.");
        const now = new Date().toISOString();
        const current = await workerProfiles.findActiveWorkerProfileByAccountId(account.id);
        if (current) await workerProfiles.updateWorkerProfile(current.id, { status: "inactive", endedAt: now });
        await accounts.updateAccount(account.id, { status: "archived" });
      });
      archived.push(accountId);
    }
    return { archivedAccountIds: archived };
  }

  async updateWorkerAccount(
    currentUser: CurrentUser,
    accountId: string,
    payload: {
      displayName?: unknown;
      phoneNumber?: unknown;
      password?: unknown;
      status?: unknown;
    }
  ) {
    this.ensureBoss(currentUser);
    const account = await this.repositories.accounts.findAccountById(accountId);
    if (!account || account.accountType !== "worker" || account.role !== ROLES.worker) {
      throw new HttpError(404, "Worker Account not found.");
    }

    const displayName = optionalText(payload.displayName, "displayName");
    const phoneNumber = optionalText(payload.phoneNumber, "phoneNumber");
    const password = optionalText(payload.password, "password");
    const status = payload.status;
    if (status !== undefined && status !== "active" && status !== "suspended") {
      throw new HttpError(400, "status must be active or suspended.");
    }
    if (password !== undefined && password.length < 8) {
      throw new HttpError(400, "password must be at least 8 characters.");
    }
    if (phoneNumber !== undefined && phoneNumber !== account.phoneNumber) {
      const existing = await this.repositories.accounts.findAccountByPhoneNumber(phoneNumber, "worker");
      if (existing && existing.id !== account.id) throw new HttpError(409, "phone_number_already_exists");
    }
    if (
      displayName === undefined &&
      phoneNumber === undefined &&
      password === undefined &&
      status === undefined
    ) {
      throw new HttpError(400, "at least one worker account field is required.");
    }

    const updated = await this.repositories.accounts.updateAccount(account.id, {
      ...(displayName !== undefined ? { displayName } : {}),
      ...(phoneNumber !== undefined ? { phoneNumber } : {}),
      ...(password !== undefined
        ? {
            passwordHash: hashPassword(password),
            mustChangePasswordAtNextLogin: true,
            lastPasswordResetAt: new Date().toISOString()
          }
        : {}),
      ...(status !== undefined ? { status } : {})
    });
    const currentWorkerProfile = await this.repositories.workerProfiles
      .findActiveWorkerProfileByAccountId(updated.id);
    return {
      account: safeAccount(updated),
      currentWorkerProfile: currentWorkerProfile ? safeProfile(currentWorkerProfile) : null
    };
  }

  async listWorkers(currentUser: CurrentUser) {
    this.ensureBoss(currentUser);
    const [accounts, profiles] = await Promise.all([
      this.repositories.accounts.listAccounts(),
      this.repositories.workerProfiles.listWorkerProfiles()
    ]);
    return accounts
      .filter((account) => account.accountType === "worker" && account.role === ROLES.worker && account.status !== "archived")
      .map((account) => {
        const history = profiles
          .filter((profile) => profile.accountId === account.id)
          .sort((left, right) => Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt));
        return {
          account: safeAccount(account),
          currentWorkerProfile: history.find((profile) => profile.status === "active")
            ? safeProfile(history.find((profile) => profile.status === "active")!)
            : null,
          workerProfiles: history.map(safeProfile)
        };
      });
  }
}
