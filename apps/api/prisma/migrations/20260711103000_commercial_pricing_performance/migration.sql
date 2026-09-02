CREATE TYPE "PricingQuotationStatus" AS ENUM ('draft', 'confirmed');
CREATE TYPE "OrderChargeStatus" AS ENUM ('effective', 'void');

ALTER TABLE "PricingRecord"
  ADD COLUMN "customerPatternFee" DECIMAL(65,30),
  ADD COLUMN "internalPatternCost" DECIMAL(65,30),
  ADD COLUMN "internalCuttingCost" DECIMAL(65,30),
  ADD COLUMN "internalSewingCost" DECIMAL(65,30),
  ADD COLUMN "internalFinishingCost" DECIMAL(65,30),
  ADD COLUMN "finishingPiecesSnapshot" INTEGER,
  ADD COLUMN "finishingNote" TEXT,
  ADD COLUMN "quotationStatus" "PricingQuotationStatus" NOT NULL DEFAULT 'draft',
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "confirmedBy" TEXT,
  ADD COLUMN "confirmedByName" TEXT,
  ADD COLUMN "confirmedSampleUnitPrice" DECIMAL(65,30),
  ADD COLUMN "confirmedSampleAmount" DECIMAL(65,30),
  ADD COLUMN "confirmedCustomerPatternFee" DECIMAL(65,30),
  ADD COLUMN "confirmedOtherChargeTotal" DECIMAL(65,30),
  ADD COLUMN "confirmedOtherChargeNote" TEXT,
  ADD COLUMN "confirmedReceivableTotal" DECIMAL(65,30);

ALTER TABLE "ReconciliationStatementItem"
  ADD COLUMN "customerPatternFee" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- Existing statement rows are immutable customer-facing snapshots. Preserve their billed
-- pattern-fee value while new pricing records use the explicit customerPatternFee field.
UPDATE "ReconciliationStatementItem"
SET "customerPatternFee" = "patternFeeTotal";

CREATE TABLE "OrderCharge" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "explanation" TEXT NOT NULL,
  "sourceScene" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "creatorName" TEXT,
  "creatorRole" "Role" NOT NULL,
  "status" "OrderChargeStatus" NOT NULL DEFAULT 'effective',
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "reviewedByName" TEXT,
  "reviewedByRole" "Role",
  "voidedAt" TIMESTAMP(3),
  "voidedBy" TEXT,
  "voidedByName" TEXT,
  "voidedByRole" "Role",
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderCharge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderCharge_orderId_status_idx" ON "OrderCharge"("orderId", "status");
CREATE INDEX "OrderCharge_createdAt_idx" ON "OrderCharge"("createdAt");
CREATE INDEX "OrderCharge_creatorId_idx" ON "OrderCharge"("creatorId");

ALTER TABLE "OrderCharge"
  ADD CONSTRAINT "OrderCharge_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
