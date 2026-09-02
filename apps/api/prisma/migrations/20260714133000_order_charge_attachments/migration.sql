ALTER TABLE "OrderAttachment" ADD COLUMN "orderChargeId" TEXT;

CREATE INDEX "OrderAttachment_orderChargeId_idx" ON "OrderAttachment"("orderChargeId");

ALTER TABLE "AttachmentAuditLog" ADD COLUMN "orderChargeId" TEXT;

CREATE INDEX "AttachmentAuditLog_orderChargeId_idx" ON "AttachmentAuditLog"("orderChargeId");
