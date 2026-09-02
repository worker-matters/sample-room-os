-- CreateEnum
CREATE TYPE "Role" AS ENUM ('system_owner', 'boss', 'receiver', 'planner', 'client_user', 'worker');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('active', 'archived', 'disabled');

-- CreateEnum
CREATE TYPE "ClientAccessScope" AS ENUM ('own', 'customer_all');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('client_submission', 'receiver_self_entry', 'internal_manual');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('pending_receive', 'received', 'needs_client_supplement');

-- CreateEnum
CREATE TYPE "OrderStage" AS ENUM ('pending_receive', 'pattern_waiting', 'pattern_doing', 'cutting_waiting', 'cutting_doing', 'sewing_waiting', 'sewing_doing', 'qc_delivery_waiting', 'done');

-- CreateEnum
CREATE TYPE "PatternStatus" AS ENUM ('none', 'has');

-- CreateEnum
CREATE TYPE "MaterialStatus" AS ENUM ('missing', 'partial', 'complete');

-- CreateEnum
CREATE TYPE "AttachmentVisibility" AS ENUM ('client_upload_allowed', 'client_visible', 'internal_only');

-- CreateEnum
CREATE TYPE "BusinessUserRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "WorkerApplicationStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ScanAction" AS ENUM ('pattern_start', 'pattern_finish', 'cutting_start', 'cutting_finish', 'sewing_start', 'sewing_finish', 'qc_delivery_finish');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "customerId" TEXT,
    "workerId" TEXT,
    "mustChangePasswordAtNextLogin" BOOLEAN NOT NULL DEFAULT false,
    "lastPasswordResetAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientUser" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "contact" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "clientAccessScope" "ClientAccessScope" NOT NULL DEFAULT 'own',
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "customerId" TEXT NOT NULL,
    "clientUserId" TEXT NOT NULL,
    "customerName" TEXT,
    "salespersonId" TEXT,
    "salespersonName" TEXT,
    "customerSnapshot" JSONB NOT NULL,
    "clientUserSnapshot" JSONB,
    "styleNo" TEXT NOT NULL,
    "styleName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sampleType" TEXT NOT NULL,
    "sampleRound" TEXT NOT NULL,
    "deliveryDate" DATE,
    "remark" TEXT,
    "intakeStatus" "IntakeStatus" NOT NULL DEFAULT 'pending_receive',
    "stage" "OrderStage",
    "patternStatus" "PatternStatus" NOT NULL DEFAULT 'none',
    "fabricStatus" "MaterialStatus" NOT NULL DEFAULT 'missing',
    "trimStatus" "MaterialStatus" NOT NULL DEFAULT 'missing',
    "receivedAt" TIMESTAMP(3),
    "receivedBy" TEXT,
    "returnReason" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnedBy" TEXT,
    "supplementCount" INTEGER NOT NULL DEFAULT 0,
    "supplementedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "fromIntake" TEXT,
    "toIntake" TEXT,
    "changedBy" TEXT,
    "reason" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCorrectionLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByRole" "Role" NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "changedByName" TEXT,
    "fieldName" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,

    CONSTRAINT "OrderCorrectionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAttachment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "visibility" "AttachmentVisibility" NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "checksum" TEXT,
    "uploadedBy" TEXT,
    "uploadedByRole" "Role",
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "OrderAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessUserRequest" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "requestedByClientUserId" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "businessUserName" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "roleNote" TEXT,
    "note" TEXT,
    "status" "BusinessUserRequestStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedByRole" "Role",
    "reviewNote" TEXT,
    "createdClientUserId" TEXT,

    CONSTRAINT "BusinessUserRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerApplication" (
    "id" TEXT NOT NULL,
    "workerId" TEXT,
    "applicantName" TEXT NOT NULL,
    "phone" TEXT,
    "status" "WorkerApplicationStatus" NOT NULL DEFAULT 'pending',
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "note" TEXT,

    CONSTRAINT "WorkerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceBinding" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unboundAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanToken" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "stage" "OrderStage",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ScanToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanRecord" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "tokenId" TEXT,
    "action" "ScanAction" NOT NULL,
    "stage" "OrderStage" NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT,
    "payload" JSONB,

    CONSTRAINT "ScanRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRecord" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "quotedPrice" DECIMAL(65,30),
    "costAmount" DECIMAL(65,30),
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtraCharge" (
    "id" TEXT NOT NULL,
    "pricingRecordId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtraCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "payload" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRecord" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'pending',
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "BackupRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_customerId_idx" ON "User"("customerId");

-- CreateIndex
CREATE INDEX "User_workerId_idx" ON "User"("workerId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE INDEX "Customer_status_idx" ON "Customer"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientUser_userId_key" ON "ClientUser"("userId");

-- CreateIndex
CREATE INDEX "ClientUser_customerId_idx" ON "ClientUser"("customerId");

-- CreateIndex
CREATE INDEX "ClientUser_customerId_clientAccessScope_idx" ON "ClientUser"("customerId", "clientAccessScope");

-- CreateIndex
CREATE INDEX "ClientUser_customerId_status_idx" ON "ClientUser"("customerId", "status");

-- CreateIndex
CREATE INDEX "ClientUser_customerId_contact_idx" ON "ClientUser"("customerId", "contact");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "Order_clientUserId_idx" ON "Order"("clientUserId");

-- CreateIndex
CREATE INDEX "Order_intakeStatus_idx" ON "Order"("intakeStatus");

-- CreateIndex
CREATE INDEX "Order_stage_idx" ON "Order"("stage");

-- CreateIndex
CREATE INDEX "Order_customerId_clientUserId_idx" ON "Order"("customerId", "clientUserId");

-- CreateIndex
CREATE INDEX "Order_customerId_intakeStatus_idx" ON "Order"("customerId", "intakeStatus");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_deliveryDate_idx" ON "Order"("deliveryDate");

-- CreateIndex
CREATE INDEX "OrderStatusLog_orderId_idx" ON "OrderStatusLog"("orderId");

-- CreateIndex
CREATE INDEX "OrderStatusLog_createdAt_idx" ON "OrderStatusLog"("createdAt");

-- CreateIndex
CREATE INDEX "OrderCorrectionLog_orderId_idx" ON "OrderCorrectionLog"("orderId");

-- CreateIndex
CREATE INDEX "OrderCorrectionLog_changedAt_idx" ON "OrderCorrectionLog"("changedAt");

-- CreateIndex
CREATE INDEX "OrderCorrectionLog_orderId_changedAt_idx" ON "OrderCorrectionLog"("orderId", "changedAt");

-- CreateIndex
CREATE INDEX "OrderAttachment_orderId_idx" ON "OrderAttachment"("orderId");

-- CreateIndex
CREATE INDEX "OrderAttachment_visibility_idx" ON "OrderAttachment"("visibility");

-- CreateIndex
CREATE INDEX "OrderAttachment_uploadedBy_idx" ON "OrderAttachment"("uploadedBy");

-- CreateIndex
CREATE INDEX "OrderAttachment_createdAt_idx" ON "OrderAttachment"("createdAt");

-- CreateIndex
CREATE INDEX "BusinessUserRequest_customerId_idx" ON "BusinessUserRequest"("customerId");

-- CreateIndex
CREATE INDEX "BusinessUserRequest_status_idx" ON "BusinessUserRequest"("status");

-- CreateIndex
CREATE INDEX "BusinessUserRequest_createdClientUserId_idx" ON "BusinessUserRequest"("createdClientUserId");

-- CreateIndex
CREATE INDEX "BusinessUserRequest_customerId_contact_idx" ON "BusinessUserRequest"("customerId", "contact");

-- CreateIndex
CREATE INDEX "Worker_status_idx" ON "Worker"("status");

-- CreateIndex
CREATE INDEX "WorkerApplication_workerId_idx" ON "WorkerApplication"("workerId");

-- CreateIndex
CREATE INDEX "WorkerApplication_status_idx" ON "WorkerApplication"("status");

-- CreateIndex
CREATE INDEX "DeviceBinding_workerId_idx" ON "DeviceBinding"("workerId");

-- CreateIndex
CREATE INDEX "DeviceBinding_deviceId_idx" ON "DeviceBinding"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "ScanToken_token_key" ON "ScanToken"("token");

-- CreateIndex
CREATE INDEX "ScanToken_orderId_idx" ON "ScanToken"("orderId");

-- CreateIndex
CREATE INDEX "ScanToken_stage_idx" ON "ScanToken"("stage");

-- CreateIndex
CREATE INDEX "ScanRecord_orderId_idx" ON "ScanRecord"("orderId");

-- CreateIndex
CREATE INDEX "ScanRecord_workerId_idx" ON "ScanRecord"("workerId");

-- CreateIndex
CREATE INDEX "ScanRecord_tokenId_idx" ON "ScanRecord"("tokenId");

-- CreateIndex
CREATE INDEX "ScanRecord_action_idx" ON "ScanRecord"("action");

-- CreateIndex
CREATE INDEX "ScanRecord_stage_idx" ON "ScanRecord"("stage");

-- CreateIndex
CREATE INDEX "ScanRecord_scannedAt_idx" ON "ScanRecord"("scannedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRecord_orderId_key" ON "PricingRecord"("orderId");

-- CreateIndex
CREATE INDEX "ExtraCharge_pricingRecordId_idx" ON "ExtraCharge"("pricingRecordId");

-- CreateIndex
CREATE INDEX "OperationLog_actorUserId_idx" ON "OperationLog"("actorUserId");

-- CreateIndex
CREATE INDEX "OperationLog_actorRole_idx" ON "OperationLog"("actorRole");

-- CreateIndex
CREATE INDEX "OperationLog_action_idx" ON "OperationLog"("action");

-- CreateIndex
CREATE INDEX "OperationLog_targetType_targetId_idx" ON "OperationLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "OperationLog_createdAt_idx" ON "OperationLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- CreateIndex
CREATE INDEX "BackupRecord_status_idx" ON "BackupRecord"("status");

-- CreateIndex
CREATE INDEX "BackupRecord_createdAt_idx" ON "BackupRecord"("createdAt");

-- AddForeignKey
ALTER TABLE "ClientUser" ADD CONSTRAINT "ClientUser_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientUser" ADD CONSTRAINT "ClientUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "ClientUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusLog" ADD CONSTRAINT "OrderStatusLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCorrectionLog" ADD CONSTRAINT "OrderCorrectionLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttachment" ADD CONSTRAINT "OrderAttachment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessUserRequest" ADD CONSTRAINT "BusinessUserRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessUserRequest" ADD CONSTRAINT "BusinessUserRequest_requestedByClientUserId_fkey" FOREIGN KEY ("requestedByClientUserId") REFERENCES "ClientUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessUserRequest" ADD CONSTRAINT "BusinessUserRequest_createdClientUserId_fkey" FOREIGN KEY ("createdClientUserId") REFERENCES "ClientUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerApplication" ADD CONSTRAINT "WorkerApplication_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceBinding" ADD CONSTRAINT "DeviceBinding_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanToken" ADD CONSTRAINT "ScanToken_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanRecord" ADD CONSTRAINT "ScanRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanRecord" ADD CONSTRAINT "ScanRecord_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRecord" ADD CONSTRAINT "PricingRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraCharge" ADD CONSTRAINT "ExtraCharge_pricingRecordId_fkey" FOREIGN KEY ("pricingRecordId") REFERENCES "PricingRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
