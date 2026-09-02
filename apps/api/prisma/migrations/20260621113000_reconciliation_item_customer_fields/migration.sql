ALTER TABLE "ReconciliationStatementItem"
ADD COLUMN "patternFeeTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "otherChargeNote" TEXT;
