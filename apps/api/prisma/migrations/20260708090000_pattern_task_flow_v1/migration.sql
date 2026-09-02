CREATE TYPE "PatternSourceType" AS ENUM ('none', 'customer_provided', 'previous_order', 'same_order_revision');

ALTER TYPE "PatternTaskStatus" ADD VALUE IF NOT EXISTS 'active';
ALTER TYPE "PatternTaskStatus" ADD VALUE IF NOT EXISTS 'paused';
ALTER TYPE "PatternTaskStatus" ADD VALUE IF NOT EXISTS 'submitted';

CREATE TYPE "PatternDeliverableType" AS ENUM (
  'pattern_file',
  'cutting_pattern_file',
  'padding_consumption',
  'material_consumption',
  'zipper_length',
  'full_size_pattern',
  'layout_diagram',
  'print_position',
  'embroidery_position',
  'process_note',
  'revision_note',
  'render_3d',
  'rotation_video_3d',
  'other'
);

ALTER TABLE "Order"
  ADD COLUMN "sourceOrderId" TEXT,
  ADD COLUMN "sourcePatternVersionId" TEXT,
  ADD COLUMN "taskInstructionNote" TEXT,
  ADD COLUMN "patternSourceType" "PatternSourceType" NOT NULL DEFAULT 'none',
  ADD COLUMN "sampleRequestItems" TEXT[] NOT NULL DEFAULT ARRAY['sample_garment', 'pattern_making']::TEXT[],
  ADD COLUMN "sampleGarmentRequired" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "latestPatternVersion" TEXT,
  ADD COLUMN "cuttingUsedPatternVersion" TEXT;

ALTER TABLE "PatternTask"
  ADD COLUMN "internalName" TEXT,
  ADD COLUMN "pausedAt" TIMESTAMP(3),
  ADD COLUMN "pausedReason" TEXT;

ALTER TABLE "SubmittedCuttingVersion"
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'cutting_handoff',
  ADD COLUMN "workHours" DOUBLE PRECISION;

CREATE TABLE "PatternDeliverable" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "patternTaskId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "type" "PatternDeliverableType" NOT NULL,
  "fileName" TEXT,
  "mimeType" TEXT,
  "size" INTEGER,
  "storageKey" TEXT,
  "textValue" TEXT,
  "structuredData" JSONB,
  "visibility" "AttachmentVisibility" NOT NULL DEFAULT 'internal_only',
  "uploadedBy" TEXT NOT NULL,
  "uploadedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PatternDeliverable_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PatternDeliverable"
  ADD CONSTRAINT "PatternDeliverable_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatternDeliverable"
  ADD CONSTRAINT "PatternDeliverable_patternTaskId_fkey"
  FOREIGN KEY ("patternTaskId") REFERENCES "PatternTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Order_sourceOrderId_idx" ON "Order"("sourceOrderId");
CREATE INDEX "PatternTask_patternMakerId_status_idx" ON "PatternTask"("patternMakerId", "status");
CREATE INDEX "PatternDeliverable_orderId_idx" ON "PatternDeliverable"("orderId");
CREATE INDEX "PatternDeliverable_patternTaskId_idx" ON "PatternDeliverable"("patternTaskId");
CREATE INDEX "PatternDeliverable_version_idx" ON "PatternDeliverable"("version");
CREATE INDEX "PatternDeliverable_type_idx" ON "PatternDeliverable"("type");
