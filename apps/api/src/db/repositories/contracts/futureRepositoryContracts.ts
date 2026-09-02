import type { Role } from "@sample-room/shared";

export type FutureRecordPayload = Record<string, unknown>;

export type OperationLogInput = {
  actorId?: string | undefined;
  actorRole?: Role | undefined;
  action: string;
  targetType?: string | undefined;
  targetId?: string | undefined;
  before?: FutureRecordPayload | undefined;
  after?: FutureRecordPayload | undefined;
  payload?: FutureRecordPayload | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  createdAt?: string | undefined;
};

export type OperationLogRecord = OperationLogInput & {
  id: string;
  createdAt: string;
};

export interface ScanRecordRepository {
  // Future-only boundary for QR/scan migration.
  findScanToken(token: string): Promise<FutureRecordPayload | undefined>;
  createScanToken(input: FutureRecordPayload): Promise<FutureRecordPayload>;
  appendScanRecord(input: FutureRecordPayload): Promise<FutureRecordPayload>;
  listScanRecordsByOrderId(orderId: string): Promise<FutureRecordPayload[]>;
  hasSewingHandoff(orderId: string): Promise<boolean>;
}

export interface OperationLogRepository {
  // Future-only append-only audit boundary for System Owner / boss actions.
  appendOperationLog(input: OperationLogInput): Promise<OperationLogRecord>;
  listOperationLogs(filters?: FutureRecordPayload): Promise<OperationLogRecord[]>;
}

export interface SystemSettingRepository {
  // Future-only boundary for System Owner settings and dictionaries.
  findSystemSetting(key: string): Promise<FutureRecordPayload | undefined>;
  upsertSystemSetting(input: FutureRecordPayload): Promise<FutureRecordPayload>;
  listSystemSettings(filters?: FutureRecordPayload): Promise<FutureRecordPayload[]>;
}

export interface BackupRepository {
  // Future-only boundary for backup/restore status metadata.
  createBackupRecord(input: FutureRecordPayload): Promise<FutureRecordPayload>;
  updateBackupRecord(id: string, patch: FutureRecordPayload): Promise<FutureRecordPayload>;
  findBackupRecordById(id: string): Promise<FutureRecordPayload | undefined>;
  listBackupRecords(filters?: FutureRecordPayload): Promise<FutureRecordPayload[]>;
}
