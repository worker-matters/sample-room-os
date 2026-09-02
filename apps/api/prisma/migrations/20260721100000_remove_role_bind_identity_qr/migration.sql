-- ROLE_BIND was removed before production launch. Position changes are direct,
-- boss-authorized WorkerProfile swaps and no longer consume QR tokens.
DELETE FROM "IdentityQrToken" WHERE "purpose" = 'ROLE_BIND';

ALTER TABLE "IdentityQrToken" DROP CONSTRAINT "IdentityQrToken_purpose_check";
ALTER TYPE "IdentityQrPurpose" RENAME TO "IdentityQrPurpose_old";
CREATE TYPE "IdentityQrPurpose" AS ENUM ('REGISTER_WORKER', 'REGISTER_BUSINESS');

ALTER TABLE "IdentityQrToken"
  ALTER COLUMN "purpose" TYPE "IdentityQrPurpose"
  USING ("purpose"::text::"IdentityQrPurpose");

DROP TYPE "IdentityQrPurpose_old";

ALTER TABLE "IdentityQrToken"
  ADD CONSTRAINT "IdentityQrToken_purpose_check" CHECK (
    ("purpose" = 'REGISTER_WORKER' AND "initialRole" = 'worker' AND "workerType" IS NOT NULL) OR
    ("purpose" = 'REGISTER_BUSINESS' AND "initialRole" IS NOT NULL AND "initialRole" <> 'worker' AND "workerType" IS NULL)
  );
