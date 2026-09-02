-- Phase 1.1 keeps every legacy pricing column and immutable reconciliation snapshot.
-- New writes use dynamic item tables; no production migration is executed by this change.

CREATE TYPE "PricingItemSourceType" AS ENUM (
  'system_recommended',
  'manual',
  'evidence',
  'legacy'
);

CREATE TYPE "InternalCostCategory" AS ENUM (
  'pattern',
  'cutting',
  'sewing',
  'finishing',
  'material',
  'other'
);

CREATE TYPE "CustomerChargePricingMethod" AS ENUM (
  'fixed',
  'unit_quantity'
);

ALTER TYPE "OrderChargeStatus" ADD VALUE IF NOT EXISTS 'pending' BEFORE 'effective';
ALTER TYPE "OrderChargeStatus" ADD VALUE IF NOT EXISTS 'confirmed' AFTER 'pending';
ALTER TYPE "OrderChargeStatus" ADD VALUE IF NOT EXISTS 'rejected' AFTER 'confirmed';
ALTER TYPE "OrderChargeStatus" ADD VALUE IF NOT EXISTS 'cancelled' AFTER 'rejected';

ALTER TABLE "AttachmentAuditLog"
ADD COLUMN "newFileName" TEXT;

ALTER TABLE "PricingRecord"
ADD COLUMN "confirmedCustomerChargeSnapshot" JSONB,
ADD COLUMN "confirmedInternalCostSnapshot" JSONB,
ADD COLUMN "confirmedOtherChargeSnapshot" JSONB,
ADD COLUMN "confirmedCustomerQuoteSubtotal" DECIMAL(65,30),
ADD COLUMN "confirmedBaseInternalCost" DECIMAL(65,30),
ADD COLUMN "confirmedInternalCostTotal" DECIMAL(65,30),
ADD COLUMN "confirmedGrossProfit" DECIMAL(65,30),
ADD COLUMN "confirmedGrossMargin" DECIMAL(65,30),
ADD COLUMN "recommendationsInitializedAt" TIMESTAMP(3);

ALTER TABLE "ReconciliationStatementItem"
ADD COLUMN "customerChargeSnapshot" JSONB,
ADD COLUMN "internalCostSnapshot" JSONB,
ADD COLUMN "internalBaseCost" DECIMAL(65,30),
ADD COLUMN "internalPatternCost" DECIMAL(65,30),
ADD COLUMN "internalCuttingCost" DECIMAL(65,30),
ADD COLUMN "internalSewingCost" DECIMAL(65,30),
ADD COLUMN "internalFinishingCost" DECIMAL(65,30),
ADD COLUMN "internalTotalCost" DECIMAL(65,30);

ALTER TABLE "OrderCharge"
ADD COLUMN "rejectedAt" TIMESTAMP(3),
ADD COLUMN "rejectedBy" TEXT,
ADD COLUMN "rejectedByName" TEXT,
ADD COLUMN "rejectedByRole" "Role",
ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledBy" TEXT,
ADD COLUMN "cancelledByName" TEXT,
ADD COLUMN "cancelledByRole" "Role",
ADD COLUMN "cancelReason" TEXT,
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE TABLE "InternalCostItem" (
  "id" TEXT NOT NULL,
  "pricingRecordId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" "InternalCostCategory" NOT NULL,
  "sourceType" "PricingItemSourceType" NOT NULL,
  "sourceTask" TEXT,
  "amount" DECIMAL(65,30) NOT NULL,
  "note" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InternalCostItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerChargeItem" (
  "id" TEXT NOT NULL,
  "pricingRecordId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "pricingMethod" "CustomerChargePricingMethod" NOT NULL,
  "unitPrice" DECIMAL(65,30),
  "quantity" DECIMAL(65,30),
  "amount" DECIMAL(65,30) NOT NULL,
  "sourceType" "PricingItemSourceType" NOT NULL,
  "sourceTask" TEXT,
  "note" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerChargeItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InternalCostItem_pricingRecordId_archivedAt_idx"
ON "InternalCostItem"("pricingRecordId", "archivedAt");

CREATE INDEX "InternalCostItem_category_idx"
ON "InternalCostItem"("category");

CREATE INDEX "CustomerChargeItem_pricingRecordId_archivedAt_idx"
ON "CustomerChargeItem"("pricingRecordId", "archivedAt");

CREATE INDEX "CustomerChargeItem_pricingMethod_idx"
ON "CustomerChargeItem"("pricingMethod");

ALTER TABLE "InternalCostItem"
ADD CONSTRAINT "InternalCostItem_pricingRecordId_fkey"
FOREIGN KEY ("pricingRecordId") REFERENCES "PricingRecord"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerChargeItem"
ADD CONSTRAINT "CustomerChargeItem_pricingRecordId_fkey"
FOREIGN KEY ("pricingRecordId") REFERENCES "PricingRecord"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing effective records remain compatible and continue to count as confirmed.
-- Repository writes explicitly set pending for every new record, so changing the
-- database default is unnecessary and avoids using a new enum value in this migration.

-- Non-destructive compatibility backfill for structured legacy pricing values.
INSERT INTO "InternalCostItem" (
  "id", "pricingRecordId", "name", "category", "sourceType", "amount",
  "createdBy", "updatedBy", "createdAt", "updatedAt"
)
SELECT CONCAT('legacy-pattern-', p."id"), p."id", '版师成本',
       'pattern'::"InternalCostCategory", 'legacy'::"PricingItemSourceType",
       p."internalPatternCost", p."createdBy", p."createdBy", p."createdAt", p."updatedAt"
FROM "PricingRecord" p
WHERE p."internalPatternCost" IS NOT NULL;

INSERT INTO "InternalCostItem" (
  "id", "pricingRecordId", "name", "category", "sourceType", "amount",
  "createdBy", "updatedBy", "createdAt", "updatedAt"
)
SELECT CONCAT('legacy-cutting-', p."id"), p."id", '裁剪成本',
       'cutting'::"InternalCostCategory", 'legacy'::"PricingItemSourceType",
       p."internalCuttingCost", p."createdBy", p."createdBy", p."createdAt", p."updatedAt"
FROM "PricingRecord" p
WHERE p."internalCuttingCost" IS NOT NULL;

INSERT INTO "InternalCostItem" (
  "id", "pricingRecordId", "name", "category", "sourceType", "amount",
  "createdBy", "updatedBy", "createdAt", "updatedAt"
)
SELECT CONCAT('legacy-sewing-', p."id"), p."id", '缝制成本',
       'sewing'::"InternalCostCategory", 'legacy'::"PricingItemSourceType",
       p."internalSewingCost", p."createdBy", p."createdBy", p."createdAt", p."updatedAt"
FROM "PricingRecord" p
WHERE p."internalSewingCost" IS NOT NULL;

INSERT INTO "InternalCostItem" (
  "id", "pricingRecordId", "name", "category", "sourceType", "sourceTask",
  "amount", "note", "createdBy", "updatedBy", "createdAt", "updatedAt"
)
SELECT CONCAT('legacy-finishing-', p."id"), p."id", '后整成本',
       'finishing'::"InternalCostCategory", 'legacy'::"PricingItemSourceType",
       '历史后整记录', p."internalFinishingCost", p."finishingNote",
       p."createdBy", p."createdBy", p."createdAt", p."updatedAt"
FROM "PricingRecord" p
WHERE p."internalFinishingCost" IS NOT NULL;

INSERT INTO "InternalCostItem" (
  "id", "pricingRecordId", "name", "category", "sourceType", "amount",
  "createdBy", "updatedBy", "createdAt", "updatedAt"
)
SELECT CONCAT('legacy-total-', p."id"), p."id", '历史内部成本',
       'other'::"InternalCostCategory", 'legacy'::"PricingItemSourceType",
       p."costAmount", p."createdBy", p."createdBy", p."createdAt", p."updatedAt"
FROM "PricingRecord" p
WHERE p."costAmount" IS NOT NULL
  AND p."internalPatternCost" IS NULL
  AND p."internalCuttingCost" IS NULL
  AND p."internalSewingCost" IS NULL
  AND p."internalFinishingCost" IS NULL;

INSERT INTO "CustomerChargeItem" (
  "id", "pricingRecordId", "name", "pricingMethod", "unitPrice", "quantity",
  "amount", "sourceType", "sourceTask", "createdBy", "updatedBy", "createdAt", "updatedAt"
)
SELECT CONCAT('legacy-sample-', p."id"), p."id", '样衣费',
       'unit_quantity'::"CustomerChargePricingMethod", p."quotedPrice",
       o."quantity",
       p."quotedPrice" * o."quantity",
       'legacy'::"PricingItemSourceType", '历史样衣报价',
       p."createdBy", p."createdBy", p."createdAt", p."updatedAt"
FROM "PricingRecord" p
JOIN "Order" o ON o."id" = p."orderId"
WHERE p."quotedPrice" IS NOT NULL;

INSERT INTO "CustomerChargeItem" (
  "id", "pricingRecordId", "name", "pricingMethod", "amount",
  "sourceType", "sourceTask", "createdBy", "updatedBy", "createdAt", "updatedAt"
)
SELECT CONCAT('legacy-pattern-fee-', p."id"), p."id", '客户版费',
       'fixed'::"CustomerChargePricingMethod", p."customerPatternFee",
       'legacy'::"PricingItemSourceType", '历史版费报价',
       p."createdBy", p."createdBy", p."createdAt", p."updatedAt"
FROM "PricingRecord" p
WHERE p."customerPatternFee" IS NOT NULL;

UPDATE "PricingRecord"
SET "recommendationsInitializedAt" = "updatedAt"
WHERE "quotedPrice" IS NOT NULL
   OR "customerPatternFee" IS NOT NULL
   OR "internalPatternCost" IS NOT NULL
   OR "internalCuttingCost" IS NOT NULL
   OR "internalSewingCost" IS NOT NULL
   OR "internalFinishingCost" IS NOT NULL
   OR "costAmount" IS NOT NULL;
