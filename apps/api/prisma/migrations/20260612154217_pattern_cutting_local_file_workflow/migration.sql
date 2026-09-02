-- CreateEnum
CREATE TYPE "PatternTaskStatus" AS ENUM ('pending', 'in_progress', 'completed', 'submitted_to_cutting');

-- CreateEnum
CREATE TYPE "CuttingInboxStatus" AS ENUM ('pending_print', 'printed', 'cut');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'pattern_maker';

-- CreateTable
CREATE TABLE "OrderFolder" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "customerSegment" TEXT NOT NULL,
    "folderName" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "displayPath" TEXT NOT NULL,
    "patternWorkPath" TEXT NOT NULL,
    "markerWorkPath" TEXT NOT NULL,
    "submittedCuttingPath" TEXT NOT NULL,
    "measurementPath" TEXT NOT NULL,
    "samplePhotoPath" TEXT NOT NULL,
    "outboundPhotoPath" TEXT NOT NULL,
    "oldVersionPath" TEXT NOT NULL,
    "readmePath" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatternTask" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "PatternTaskStatus" NOT NULL DEFAULT 'pending',
    "patternMakerId" TEXT,
    "patternMakerName" TEXT,
    "linkedPatternLibraryEntryId" TEXT,
    "orderFolderId" TEXT,
    "note" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatternTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatternLibraryEntry" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "styleNo" TEXT NOT NULL,
    "styleName" TEXT,
    "patternVersion" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "localPath" TEXT,
    "storageKey" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatternLibraryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmittedCuttingVersion" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "patternTaskId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "submittedByName" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "orderFolderPath" TEXT NOT NULL,
    "submittedCuttingPath" TEXT NOT NULL,
    "cuttingInboxPath" TEXT NOT NULL,
    "status" "CuttingInboxStatus" NOT NULL DEFAULT 'pending_print',
    "statusUpdatedAt" TIMESTAMP(3),
    "printedAt" TIMESTAMP(3),
    "cutAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "SubmittedCuttingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmittedCuttingFile" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmittedCuttingFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderFolder_orderId_key" ON "OrderFolder"("orderId");

-- CreateIndex
CREATE INDEX "OrderFolder_year_idx" ON "OrderFolder"("year");

-- CreateIndex
CREATE INDEX "OrderFolder_customerSegment_idx" ON "OrderFolder"("customerSegment");

-- CreateIndex
CREATE UNIQUE INDEX "PatternTask_orderId_key" ON "PatternTask"("orderId");

-- CreateIndex
CREATE INDEX "PatternTask_status_idx" ON "PatternTask"("status");

-- CreateIndex
CREATE INDEX "PatternTask_patternMakerId_idx" ON "PatternTask"("patternMakerId");

-- CreateIndex
CREATE INDEX "PatternTask_orderFolderId_idx" ON "PatternTask"("orderFolderId");

-- CreateIndex
CREATE INDEX "PatternTask_linkedPatternLibraryEntryId_idx" ON "PatternTask"("linkedPatternLibraryEntryId");

-- CreateIndex
CREATE INDEX "PatternLibraryEntry_customerId_idx" ON "PatternLibraryEntry"("customerId");

-- CreateIndex
CREATE INDEX "PatternLibraryEntry_styleNo_idx" ON "PatternLibraryEntry"("styleNo");

-- CreateIndex
CREATE INDEX "PatternLibraryEntry_createdAt_idx" ON "PatternLibraryEntry"("createdAt");

-- CreateIndex
CREATE INDEX "SubmittedCuttingVersion_patternTaskId_idx" ON "SubmittedCuttingVersion"("patternTaskId");

-- CreateIndex
CREATE INDEX "SubmittedCuttingVersion_status_idx" ON "SubmittedCuttingVersion"("status");

-- CreateIndex
CREATE INDEX "SubmittedCuttingVersion_submittedAt_idx" ON "SubmittedCuttingVersion"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubmittedCuttingVersion_orderId_version_key" ON "SubmittedCuttingVersion"("orderId", "version");

-- CreateIndex
CREATE INDEX "SubmittedCuttingFile_submissionId_idx" ON "SubmittedCuttingFile"("submissionId");

-- AddForeignKey
ALTER TABLE "OrderFolder" ADD CONSTRAINT "OrderFolder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternTask" ADD CONSTRAINT "PatternTask_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternTask" ADD CONSTRAINT "PatternTask_orderFolderId_fkey" FOREIGN KEY ("orderFolderId") REFERENCES "OrderFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternTask" ADD CONSTRAINT "PatternTask_linkedPatternLibraryEntryId_fkey" FOREIGN KEY ("linkedPatternLibraryEntryId") REFERENCES "PatternLibraryEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittedCuttingVersion" ADD CONSTRAINT "SubmittedCuttingVersion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittedCuttingVersion" ADD CONSTRAINT "SubmittedCuttingVersion_patternTaskId_fkey" FOREIGN KEY ("patternTaskId") REFERENCES "PatternTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmittedCuttingFile" ADD CONSTRAINT "SubmittedCuttingFile_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "SubmittedCuttingVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
