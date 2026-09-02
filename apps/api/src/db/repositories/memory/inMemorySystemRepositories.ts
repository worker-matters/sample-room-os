import type {
  FutureRecordPayload,
  OperationLogInput,
  OperationLogRecord,
  OperationLogRepository,
  SystemSettingRepository
} from "../contracts/index.js";

const copy = <T>(value: T): T => structuredClone(value);

export class InMemorySystemSettingRepository implements SystemSettingRepository {
  private readonly records: FutureRecordPayload[] = [];

  async findSystemSetting(key: string) {
    const record = this.records.find((item) => item.key === key);
    return record ? copy(record) : undefined;
  }

  async upsertSystemSetting(input: FutureRecordPayload) {
    const key = String(input.key ?? "");
    const index = this.records.findIndex((item) => item.key === key);
    const record = { ...input, id: index >= 0 ? this.records[index]!.id : `setting-${this.records.length + 1}`, updatedAt: new Date().toISOString() };
    if (index >= 0) this.records[index] = record;
    else this.records.push(record);
    return copy(record);
  }

  async listSystemSettings() { return copy(this.records); }
}

export class InMemoryOperationLogRepository implements OperationLogRepository {
  private readonly records: OperationLogRecord[] = [];

  async appendOperationLog(input: OperationLogInput) {
    const record = { ...input, id: `operation-log-${this.records.length + 1}`, createdAt: input.createdAt ?? new Date().toISOString() };
    this.records.push(record);
    return copy(record);
  }

  async listOperationLogs() { return copy(this.records); }
}
