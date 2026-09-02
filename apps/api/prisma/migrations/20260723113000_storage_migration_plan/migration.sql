-- Additive LCM-05 storage-migration plan. Existing business and lifecycle tables remain unchanged.
CREATE TABLE "StorageMigrationPlan" (
  "id" TEXT NOT NULL,
  "requestedByActorId" TEXT NOT NULL,
  "requestedByName" TEXT NOT NULL,
  "requestedByRole" TEXT NOT NULL,
  "targetPathProtected" TEXT NOT NULL,
  "targetDisplayName" TEXT NOT NULL,
  "preflightSummary" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'prepared',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  CONSTRAINT "StorageMigrationPlan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StorageMigrationPlan_status_createdAt_idx" ON "StorageMigrationPlan"("status", "createdAt");
