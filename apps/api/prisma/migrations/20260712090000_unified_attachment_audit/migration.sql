ALTER TABLE "OrderAttachment"
ADD COLUMN "patternTaskId" TEXT,
ADD COLUMN "patternTaskCategory" TEXT;

ALTER TABLE "PatternDeliverable"
ADD COLUMN "taskCategory" TEXT,
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE TABLE "AttachmentAuditLog" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "attachmentId" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT,
  "actorRole" "Role" NOT NULL,
  "originalUploaderId" TEXT NOT NULL,
  "originalUploaderName" TEXT,
  "originalUploaderRole" "Role" NOT NULL,
  "attachmentCategory" TEXT NOT NULL,
  "sourceCategory" TEXT,
  "patternTaskId" TEXT,
  "patternTaskCategory" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttachmentAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderAttachment_patternTaskId_idx" ON "OrderAttachment"("patternTaskId");
CREATE INDEX "AttachmentAuditLog_orderId_createdAt_idx" ON "AttachmentAuditLog"("orderId", "createdAt");
CREATE INDEX "AttachmentAuditLog_attachmentId_idx" ON "AttachmentAuditLog"("attachmentId");
CREATE INDEX "AttachmentAuditLog_actorId_idx" ON "AttachmentAuditLog"("actorId");

ALTER TABLE "AttachmentAuditLog"
ADD CONSTRAINT "AttachmentAuditLog_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
