-- Add the QC/delivery start action used by the registered worker scan MVP.
ALTER TYPE "ScanAction" ADD VALUE IF NOT EXISTS 'qc_delivery_start';

-- Production workers remain separate from formal login users.
ALTER TABLE "Worker" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'pattern';
ALTER TABLE "Worker" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Worker" ALTER COLUMN "stage" DROP DEFAULT;
CREATE INDEX "Worker_stage_idx" ON "Worker"("stage");

-- Boss/System Owner generated links for worker self-binding.
CREATE TABLE "WorkerRegistrationLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "WorkerRegistrationLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkerRegistrationLink_token_key" ON "WorkerRegistrationLink"("token");
CREATE INDEX "WorkerRegistrationLink_stage_idx" ON "WorkerRegistrationLink"("stage");
CREATE INDEX "WorkerRegistrationLink_active_idx" ON "WorkerRegistrationLink"("active");
CREATE INDEX "WorkerRegistrationLink_createdAt_idx" ON "WorkerRegistrationLink"("createdAt");

-- Device binding is token-based for MVP H5 scan flows.
ALTER TABLE "DeviceBinding" ADD COLUMN "deviceLabel" TEXT;
ALTER TABLE "DeviceBinding" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "DeviceBinding" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "DeviceBinding_active_idx" ON "DeviceBinding"("active");

-- Scan records store worker snapshots and completion result fields.
ALTER TABLE "ScanRecord" ADD COLUMN "workerName" TEXT;
ALTER TABLE "ScanRecord" ADD COLUMN "deviceToken" TEXT;
ALTER TABLE "ScanRecord" ADD COLUMN "workHours" DOUBLE PRECISION;
ALTER TABLE "ScanRecord" ADD COLUMN "pieces" INTEGER;
ALTER TABLE "ScanRecord" ADD COLUMN "note" TEXT;
ALTER TABLE "ScanRecord" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'scan';
