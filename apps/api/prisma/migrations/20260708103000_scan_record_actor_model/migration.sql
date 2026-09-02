CREATE TYPE "ScanActorType" AS ENUM ('production_worker', 'internal_account');

ALTER TABLE "ScanRecord"
  ADD COLUMN "actorType" "ScanActorType" NOT NULL DEFAULT 'production_worker',
  ADD COLUMN "actorRole" "Role";

ALTER TABLE "ScanRecord"
  DROP CONSTRAINT IF EXISTS "ScanRecord_workerId_fkey";

CREATE INDEX "ScanRecord_actorType_idx" ON "ScanRecord"("actorType");
CREATE INDEX "ScanRecord_actorRole_idx" ON "ScanRecord"("actorRole");
