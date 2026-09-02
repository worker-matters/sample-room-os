-- Pre-launch destructive identity reset.
-- The application has no production data. Development fixtures must be rebuilt after this migration.

CREATE TYPE "AccountType" AS ENUM ('business', 'worker');
CREATE TYPE "AccountStatus" AS ENUM ('active', 'suspended', 'pending');
CREATE TYPE "AccountClientType" AS ENUM ('web', 'miniapp', 'android');
CREATE TYPE "WorkerType" AS ENUM ('cutting', 'sewing', 'qc_delivery');
CREATE TYPE "WorkerProfileStatus" AS ENUM ('active', 'inactive', 'ended');
CREATE TYPE "IdentityQrPurpose" AS ENUM ('REGISTER_WORKER', 'REGISTER_BUSINESS', 'ROLE_BIND');

-- Replace the aggregate client_user role with the two authoritative customer roles.
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM (
  'system_owner',
  'boss',
  'receiver',
  'pattern_maker',
  'planner',
  'client_admin',
  'client_business_user',
  'worker'
);

ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role"
  USING (CASE WHEN "role"::text = 'client_user' THEN 'client_business_user' ELSE "role"::text END)::"Role";
ALTER TABLE "OrderCorrectionLog" ALTER COLUMN "changedByRole" TYPE "Role"
  USING (CASE WHEN "changedByRole"::text = 'client_user' THEN 'client_business_user' ELSE "changedByRole"::text END)::"Role";
ALTER TABLE "OrderAttachment" ALTER COLUMN "uploadedByRole" TYPE "Role"
  USING (CASE WHEN "uploadedByRole"::text = 'client_user' THEN 'client_business_user' ELSE "uploadedByRole"::text END)::"Role";
ALTER TABLE "AttachmentAuditLog" ALTER COLUMN "actorRole" TYPE "Role"
  USING (CASE WHEN "actorRole"::text = 'client_user' THEN 'client_business_user' ELSE "actorRole"::text END)::"Role";
ALTER TABLE "AttachmentAuditLog" ALTER COLUMN "originalUploaderRole" TYPE "Role"
  USING (CASE WHEN "originalUploaderRole"::text = 'client_user' THEN 'client_business_user' ELSE "originalUploaderRole"::text END)::"Role";
ALTER TABLE "BusinessUserRequest" ALTER COLUMN "reviewedByRole" TYPE "Role"
  USING (CASE WHEN "reviewedByRole"::text = 'client_user' THEN 'client_business_user' ELSE "reviewedByRole"::text END)::"Role";
ALTER TABLE "ScanRecord" ALTER COLUMN "actorRole" TYPE "Role"
  USING (CASE WHEN "actorRole"::text = 'client_user' THEN 'client_business_user' ELSE "actorRole"::text END)::"Role";
ALTER TABLE "OrderCharge" ALTER COLUMN "creatorRole" TYPE "Role"
  USING (CASE WHEN "creatorRole"::text = 'client_user' THEN 'client_business_user' ELSE "creatorRole"::text END)::"Role";
ALTER TABLE "OrderCharge" ALTER COLUMN "reviewedByRole" TYPE "Role"
  USING (CASE WHEN "reviewedByRole"::text = 'client_user' THEN 'client_business_user' ELSE "reviewedByRole"::text END)::"Role";
ALTER TABLE "OrderCharge" ALTER COLUMN "voidedByRole" TYPE "Role"
  USING (CASE WHEN "voidedByRole"::text = 'client_user' THEN 'client_business_user' ELSE "voidedByRole"::text END)::"Role";
ALTER TABLE "OperationLog" ALTER COLUMN "actorRole" TYPE "Role"
  USING (CASE WHEN "actorRole"::text = 'client_user' THEN 'client_business_user' ELSE "actorRole"::text END)::"Role";

DROP TYPE "Role_old";

-- Remove every legacy device or independent Worker identity source.
DROP TABLE IF EXISTS "MiniappSession" CASCADE;
DROP TABLE IF EXISTS "WechatIdentityBinding" CASCADE;
DROP TABLE IF EXISTS "WechatBindingToken" CASCADE;
DROP TABLE IF EXISTS "WechatIdentity" CASCADE;
DROP TYPE IF EXISTS "WechatIdentityType";

DROP TABLE "AccountDeviceBindToken";
DROP TABLE "AccountDeviceBinding";
DROP TABLE "PatternMakerDeviceBindToken";
DROP TABLE "PatternMakerDeviceBinding";
DROP TABLE "DeviceBinding";
DROP TABLE "WorkerApplication";
DROP TABLE "WorkerRegistrationLink";
DROP TABLE "Worker";

DROP TYPE "WorkerApplicationStatus";
DROP TYPE "PatternMakerDeviceType";
DROP TYPE "PatternMakerDeviceStatus";

-- User is replaced in-place by the final Account model. No compatibility model remains.
ALTER TABLE "User" RENAME TO "Account";
ALTER TABLE "Account" RENAME CONSTRAINT "User_pkey" TO "Account_pkey";
ALTER INDEX IF EXISTS "User_username_key" RENAME TO "Account_username_key";
ALTER INDEX IF EXISTS "User_role_idx" RENAME TO "Account_role_idx";
ALTER INDEX IF EXISTS "User_status_idx" RENAME TO "Account_status_idx";

ALTER TABLE "Account" RENAME COLUMN "contact" TO "phoneNumber";
ALTER TABLE "Account" ADD COLUMN "accountType" "AccountType" NOT NULL DEFAULT 'business';
UPDATE "Account" SET "accountType" = 'worker' WHERE "role" = 'worker';
ALTER TABLE "Account" ALTER COLUMN "accountType" DROP DEFAULT;
ALTER TABLE "Account" ALTER COLUMN "username" DROP NOT NULL;

ALTER TABLE "Account" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Account" ALTER COLUMN "status" TYPE "AccountStatus"
  USING (
    CASE
      WHEN "status"::text = 'active' THEN 'active'
      ELSE 'suspended'
    END
  )::"AccountStatus";
ALTER TABLE "Account" ALTER COLUMN "status" SET DEFAULT 'pending';

ALTER TABLE "Account"
  DROP COLUMN "customerId",
  DROP COLUMN "workerId",
  DROP COLUMN "archivedAt",
  DROP COLUMN "archivedBy",
  DROP COLUMN "deletedAt",
  DROP COLUMN "deletedBy";

CREATE INDEX "Account_accountType_idx" ON "Account"("accountType");
CREATE INDEX "Account_phoneNumber_idx" ON "Account"("phoneNumber");
CREATE UNIQUE INDEX "Account_worker_phoneNumber_key"
  ON "Account"("phoneNumber")
  WHERE "accountType" = 'worker';
ALTER TABLE "Account" ADD CONSTRAINT "Account_login_identifier_check" CHECK (
  ("accountType" = 'business' AND "role" <> 'worker' AND "username" IS NOT NULL) OR
  ("accountType" = 'worker' AND "role" = 'worker' AND "phoneNumber" IS NOT NULL)
);

-- Customer scope remains in ClientUser, but its login relation now targets Account.
ALTER TABLE "ClientUser" RENAME COLUMN "userId" TO "accountId";
ALTER TABLE "ClientUser" RENAME CONSTRAINT "ClientUser_userId_fkey" TO "ClientUser_accountId_fkey";
ALTER INDEX IF EXISTS "ClientUser_userId_key" RENAME TO "ClientUser_accountId_key";
ALTER TABLE "ClientUser" ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "ClientUser" DROP CONSTRAINT "ClientUser_accountId_fkey";
ALTER TABLE "ClientUser" ADD CONSTRAINT "ClientUser_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderCorrectionLog" RENAME COLUMN "changedByUserId" TO "changedByAccountId";
ALTER TABLE "OrderCorrectionLog" ADD CONSTRAINT "OrderCorrectionLog_changedByAccountId_fkey"
  FOREIGN KEY ("changedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatternTask" RENAME COLUMN "patternMakerId" TO "patternMakerAccountId";
ALTER INDEX IF EXISTS "PatternTask_patternMakerId_idx" RENAME TO "PatternTask_patternMakerAccountId_idx";
ALTER INDEX IF EXISTS "PatternTask_patternMakerId_status_idx" RENAME TO "PatternTask_patternMakerAccountId_status_idx";
ALTER TABLE "PatternTask" ADD CONSTRAINT "PatternTask_patternMakerAccountId_fkey"
  FOREIGN KEY ("patternMakerAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OperationLog" RENAME COLUMN "actorUserId" TO "actorAccountId";
ALTER INDEX IF EXISTS "OperationLog_actorUserId_idx" RENAME TO "OperationLog_actorAccountId_idx";
ALTER TABLE "OperationLog" ADD CONSTRAINT "OperationLog_actorAccountId_fkey"
  FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WorkerProfile" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "workerType" "WorkerType" NOT NULL,
  "status" "WorkerProfileStatus" NOT NULL DEFAULT 'active',
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkerProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkerProfile_status_time_check" CHECK (
    ("status" = 'active' AND "endedAt" IS NULL) OR
    ("status" IN ('inactive', 'ended') AND "endedAt" IS NOT NULL)
  )
);

CREATE INDEX "WorkerProfile_accountId_status_idx" ON "WorkerProfile"("accountId", "status");
CREATE INDEX "WorkerProfile_workerType_status_idx" ON "WorkerProfile"("workerType", "status");
CREATE UNIQUE INDEX "WorkerProfile_one_active_per_account"
  ON "WorkerProfile"("accountId")
  WHERE "status" = 'active';

ALTER TABLE "WorkerProfile" ADD CONSTRAINT "WorkerProfile_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AccountSession" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "sessionTokenHash" TEXT NOT NULL,
  "clientType" "AccountClientType" NOT NULL,
  "deviceIdHash" TEXT,
  "deviceLabel" TEXT,
  "userAgent" TEXT,
  "appVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "AccountSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountSession_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "AccountSession_sessionTokenHash_key" ON "AccountSession"("sessionTokenHash");
CREATE INDEX "AccountSession_accountId_revokedAt_expiresAt_idx" ON "AccountSession"("accountId", "revokedAt", "expiresAt");
CREATE INDEX "AccountSession_deviceIdHash_idx" ON "AccountSession"("deviceIdHash");
CREATE INDEX "AccountSession_expiresAt_idx" ON "AccountSession"("expiresAt");
ALTER TABLE "AccountSession" ADD CONSTRAINT "AccountSession_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WechatIdentity" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "openIdHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt" TIMESTAMP(3),
  CONSTRAINT "WechatIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WechatIdentity_accountId_key" ON "WechatIdentity"("accountId");
CREATE UNIQUE INDEX "WechatIdentity_openIdHash_key" ON "WechatIdentity"("openIdHash");
ALTER TABLE "WechatIdentity" ADD CONSTRAINT "WechatIdentity_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "IdentityQrToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "purpose" "IdentityQrPurpose" NOT NULL,
  "initialRole" "Role",
  "workerType" "WorkerType",
  "issuedByAccountId" TEXT NOT NULL,
  "usedByAccountId" TEXT,
  "revokedByAccountId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdentityQrToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IdentityQrToken_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "IdentityQrToken_purpose_check" CHECK (
    ("purpose" = 'REGISTER_WORKER' AND "initialRole" = 'worker' AND "workerType" IS NOT NULL) OR
    ("purpose" = 'REGISTER_BUSINESS' AND "initialRole" IS NOT NULL AND "initialRole" <> 'worker' AND "workerType" IS NULL) OR
    ("purpose" = 'ROLE_BIND' AND "initialRole" IS NULL AND "workerType" IS NOT NULL)
  ),
  CONSTRAINT "IdentityQrToken_use_check" CHECK (
    ("usedAt" IS NULL AND "usedByAccountId" IS NULL) OR
    ("usedAt" IS NOT NULL AND "usedByAccountId" IS NOT NULL)
  ),
  CONSTRAINT "IdentityQrToken_revoke_check" CHECK (
    ("revokedAt" IS NULL AND "revokedByAccountId" IS NULL) OR
    ("revokedAt" IS NOT NULL AND "revokedByAccountId" IS NOT NULL)
  ),
  CONSTRAINT "IdentityQrToken_terminal_state_check" CHECK (
    NOT ("usedAt" IS NOT NULL AND "revokedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "IdentityQrToken_tokenHash_key" ON "IdentityQrToken"("tokenHash");
CREATE INDEX "IdentityQrToken_purpose_expiresAt_idx" ON "IdentityQrToken"("purpose", "expiresAt");
CREATE INDEX "IdentityQrToken_issuedByAccountId_expiresAt_idx" ON "IdentityQrToken"("issuedByAccountId", "expiresAt");
CREATE INDEX "IdentityQrToken_usedByAccountId_idx" ON "IdentityQrToken"("usedByAccountId");
CREATE INDEX "IdentityQrToken_revokedByAccountId_idx" ON "IdentityQrToken"("revokedByAccountId");
ALTER TABLE "IdentityQrToken" ADD CONSTRAINT "IdentityQrToken_issuedByAccountId_fkey"
  FOREIGN KEY ("issuedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IdentityQrToken" ADD CONSTRAINT "IdentityQrToken_usedByAccountId_fkey"
  FOREIGN KEY ("usedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IdentityQrToken" ADD CONSTRAINT "IdentityQrToken_revokedByAccountId_fkey"
  FOREIGN KEY ("revokedByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Development scan and complaint fixtures are intentionally discarded; no legacy Worker mapping remains.
DELETE FROM "OrderComplaint";
DELETE FROM "ScanRecord";

DROP INDEX IF EXISTS "OrderComplaint_qcWorkerId_createdAt_idx";
ALTER TABLE "OrderComplaint"
  DROP COLUMN "qcWorkerId",
  DROP COLUMN "qcWorkerName",
  DROP COLUMN "registeredBy",
  ADD COLUMN "qcWorkerProfileId" TEXT,
  ADD COLUMN "qcWorkerNameSnapshot" TEXT,
  ADD COLUMN "registeredByAccountId" TEXT NOT NULL;
CREATE INDEX "OrderComplaint_qcWorkerProfileId_createdAt_idx" ON "OrderComplaint"("qcWorkerProfileId", "createdAt");
CREATE INDEX "OrderComplaint_registeredByAccountId_createdAt_idx" ON "OrderComplaint"("registeredByAccountId", "createdAt");
ALTER TABLE "OrderComplaint" ADD CONSTRAINT "OrderComplaint_qcWorkerProfileId_fkey"
  FOREIGN KEY ("qcWorkerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderComplaint" ADD CONSTRAINT "OrderComplaint_registeredByAccountId_fkey"
  FOREIGN KEY ("registeredByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "ScanRecord_workerId_idx";
ALTER TABLE "ScanRecord"
  DROP COLUMN "workerId",
  DROP COLUMN "workerName",
  DROP COLUMN "deviceId",
  DROP COLUMN "deviceToken",
  ADD COLUMN "actorAccountId" TEXT NOT NULL,
  ADD COLUMN "workerProfileId" TEXT,
  ADD COLUMN "actorNameSnapshot" TEXT;
ALTER TABLE "ScanRecord" ALTER COLUMN "actorRole" SET NOT NULL;
CREATE INDEX "ScanRecord_actorAccountId_idx" ON "ScanRecord"("actorAccountId");
CREATE INDEX "ScanRecord_workerProfileId_idx" ON "ScanRecord"("workerProfileId");
ALTER TABLE "ScanRecord" ADD CONSTRAINT "ScanRecord_actorAccountId_fkey"
  FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScanRecord" ADD CONSTRAINT "ScanRecord_workerProfileId_fkey"
  FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScanRecord" ADD CONSTRAINT "ScanRecord_actor_subject_check" CHECK (
  ("actorType" = 'production_worker' AND "actorRole" = 'worker' AND "workerProfileId" IS NOT NULL) OR
  ("actorType" = 'internal_account' AND "actorRole" <> 'worker' AND "workerProfileId" IS NULL)
);
