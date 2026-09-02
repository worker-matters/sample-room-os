-- CreateEnum
CREATE TYPE "PatternMakerDeviceType" AS ENUM ('PHONE_SCAN_DEVICE', 'SCANNER_STATION');

-- CreateEnum
CREATE TYPE "PatternMakerDeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "PatternMakerDeviceBinding" (
    "id" TEXT NOT NULL,
    "patternMakerUserId" TEXT NOT NULL,
    "patternMakerName" TEXT,
    "deviceType" "PatternMakerDeviceType" NOT NULL,
    "deviceName" TEXT,
    "deviceKeyHash" TEXT NOT NULL,
    "status" "PatternMakerDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "lastScanAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatternMakerDeviceBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatternMakerDeviceBindToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "patternMakerUserId" TEXT NOT NULL,
    "patternMakerName" TEXT,
    "deviceType" "PatternMakerDeviceType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "userAgent" TEXT,

    CONSTRAINT "PatternMakerDeviceBindToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatternMakerDeviceBinding_deviceKeyHash_key" ON "PatternMakerDeviceBinding"("deviceKeyHash");

-- CreateIndex
CREATE INDEX "PatternMakerDeviceBinding_patternMakerUserId_idx" ON "PatternMakerDeviceBinding"("patternMakerUserId");

-- CreateIndex
CREATE INDEX "PatternMakerDeviceBinding_deviceType_idx" ON "PatternMakerDeviceBinding"("deviceType");

-- CreateIndex
CREATE INDEX "PatternMakerDeviceBinding_status_idx" ON "PatternMakerDeviceBinding"("status");

-- CreateIndex
CREATE INDEX "PatternMakerDeviceBinding_patternMakerUserId_deviceType_status_idx" ON "PatternMakerDeviceBinding"("patternMakerUserId", "deviceType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PatternMakerDeviceBindToken_tokenHash_key" ON "PatternMakerDeviceBindToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PatternMakerDeviceBindToken_patternMakerUserId_idx" ON "PatternMakerDeviceBindToken"("patternMakerUserId");

-- CreateIndex
CREATE INDEX "PatternMakerDeviceBindToken_deviceType_idx" ON "PatternMakerDeviceBindToken"("deviceType");

-- CreateIndex
CREATE INDEX "PatternMakerDeviceBindToken_expiresAt_idx" ON "PatternMakerDeviceBindToken"("expiresAt");

-- CreateIndex
CREATE INDEX "PatternMakerDeviceBindToken_usedAt_idx" ON "PatternMakerDeviceBindToken"("usedAt");
