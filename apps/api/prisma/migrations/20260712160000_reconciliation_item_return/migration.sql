ALTER TABLE "ReconciliationStatementItem"
ADD COLUMN "returnedAt" TIMESTAMP(3),
ADD COLUMN "returnedBy" TEXT;

CREATE INDEX "ReconciliationStatementItem_returnedAt_idx"
ON "ReconciliationStatementItem"("returnedAt");
