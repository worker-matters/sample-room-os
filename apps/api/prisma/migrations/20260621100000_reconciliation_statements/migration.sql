-- CreateEnum
CREATE TYPE "ReconciliationStatementStatus" AS ENUM ('pending_payment', 'paid', 'returned');

-- CreateTable
CREATE TABLE "ReconciliationStatement" (
    "id" TEXT NOT NULL,
    "statementNo" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "salespersonName" TEXT NOT NULL,
    "billingPeriod" TEXT NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "receivableAmount" DECIMAL(65,30) NOT NULL,
    "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" "ReconciliationStatementStatus" NOT NULL DEFAULT 'pending_payment',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnedBy" TEXT,

    CONSTRAINT "ReconciliationStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationStatementItem" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "styleNo" TEXT NOT NULL,
    "styleName" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "salespersonName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "quotedPrice" DECIMAL(65,30) NOT NULL,
    "sampleAmount" DECIMAL(65,30) NOT NULL,
    "otherChargeTotal" DECIMAL(65,30) NOT NULL,
    "receivableTotal" DECIMAL(65,30) NOT NULL,
    "remark" TEXT,
    "orderStatusLabel" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationStatementItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationStatement_statementNo_key" ON "ReconciliationStatement"("statementNo");

-- CreateIndex
CREATE INDEX "ReconciliationStatement_status_idx" ON "ReconciliationStatement"("status");

-- CreateIndex
CREATE INDEX "ReconciliationStatement_generatedAt_idx" ON "ReconciliationStatement"("generatedAt");

-- CreateIndex
CREATE INDEX "ReconciliationStatement_customerName_idx" ON "ReconciliationStatement"("customerName");

-- CreateIndex
CREATE INDEX "ReconciliationStatement_salespersonName_idx" ON "ReconciliationStatement"("salespersonName");

-- CreateIndex
CREATE INDEX "ReconciliationStatementItem_statementId_idx" ON "ReconciliationStatementItem"("statementId");

-- CreateIndex
CREATE INDEX "ReconciliationStatementItem_orderId_idx" ON "ReconciliationStatementItem"("orderId");

-- AddForeignKey
ALTER TABLE "ReconciliationStatementItem" ADD CONSTRAINT "ReconciliationStatementItem_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "ReconciliationStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
