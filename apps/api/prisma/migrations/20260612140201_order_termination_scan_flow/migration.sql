-- AlterEnum
ALTER TYPE "ScanAction" ADD VALUE 'termination_complete';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "stageAtTermination" "OrderStage",
ADD COLUMN     "statusBeforeTermination" TEXT,
ADD COLUMN     "terminated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "terminatedAt" TIMESTAMP(3),
ADD COLUMN     "terminatedBy" TEXT,
ADD COLUMN     "terminatedByName" TEXT,
ADD COLUMN     "terminationReason" TEXT;

-- CreateIndex
CREATE INDEX "Order_terminated_idx" ON "Order"("terminated");

-- CreateIndex
CREATE INDEX "Order_terminatedAt_idx" ON "Order"("terminatedAt");
