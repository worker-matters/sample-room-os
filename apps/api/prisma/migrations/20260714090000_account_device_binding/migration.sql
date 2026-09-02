ALTER TABLE "User" ADD COLUMN "contact" TEXT;

CREATE TABLE "AccountDeviceBinding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "deviceKeyHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountDeviceBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountDeviceBindToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountDeviceBindToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountDeviceBinding_deviceKeyHash_key" ON "AccountDeviceBinding"("deviceKeyHash");
CREATE INDEX "AccountDeviceBinding_userId_revokedAt_idx" ON "AccountDeviceBinding"("userId", "revokedAt");
CREATE UNIQUE INDEX "AccountDeviceBindToken_tokenHash_key" ON "AccountDeviceBindToken"("tokenHash");
CREATE INDEX "AccountDeviceBindToken_userId_expiresAt_idx" ON "AccountDeviceBindToken"("userId", "expiresAt");
ALTER TABLE "AccountDeviceBinding" ADD CONSTRAINT "AccountDeviceBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountDeviceBindToken" ADD CONSTRAINT "AccountDeviceBindToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
