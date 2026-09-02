CREATE TABLE "OrderComplaint" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "qcScanRecordId" TEXT,
  "qcWorkerId" TEXT,
  "qcWorkerName" TEXT,
  "registeredBy" TEXT NOT NULL,
  "registeredByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderComplaint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderComplaint_orderId_createdAt_idx"
  ON "OrderComplaint"("orderId", "createdAt");

CREATE INDEX "OrderComplaint_qcWorkerId_createdAt_idx"
  ON "OrderComplaint"("qcWorkerId", "createdAt");

CREATE INDEX "OrderComplaint_qcScanRecordId_idx"
  ON "OrderComplaint"("qcScanRecordId");

ALTER TABLE "OrderComplaint"
  ADD CONSTRAINT "OrderComplaint_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
