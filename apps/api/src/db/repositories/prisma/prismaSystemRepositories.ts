import type { Prisma } from "@prisma/client";
import type {
  FutureRecordPayload,
  OperationLogInput,
  OperationLogRepository,
  SystemSettingRepository
} from "../contracts/index.js";

type SystemPrismaClient = Pick<Prisma.TransactionClient, "systemSetting" | "operationLog">;

export class PrismaSystemSettingRepository implements SystemSettingRepository {
  constructor(private readonly prisma: SystemPrismaClient) {}

  async findSystemSetting(key: string) {
    const record = await this.prisma.systemSetting.findUnique({ where: { key } });
    return record ? { ...record, updatedAt: record.updatedAt.toISOString() } : undefined;
  }

  async upsertSystemSetting(input: FutureRecordPayload) {
    const key = String(input.key ?? "");
    const value = input.value as Prisma.InputJsonValue;
    const updatedBy = typeof input.updatedBy === "string" ? input.updatedBy : null;
    const record = await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value, updatedBy },
      update: { value, updatedBy }
    });
    return { ...record, updatedAt: record.updatedAt.toISOString() };
  }

  async listSystemSettings() {
    return (await this.prisma.systemSetting.findMany({ orderBy: { key: "asc" } }))
      .map((record) => ({ ...record, updatedAt: record.updatedAt.toISOString() }));
  }
}

export class PrismaOperationLogRepository implements OperationLogRepository {
  constructor(private readonly prisma: SystemPrismaClient) {}

  async appendOperationLog(input: OperationLogInput) {
    const record = await this.prisma.operationLog.create({
      data: {
        actorAccountId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        ...(input.before ? { before: input.before as Prisma.InputJsonValue } : {}),
        ...(input.after ? { after: input.after as Prisma.InputJsonValue } : {}),
        ...(input.payload ? { payload: input.payload as Prisma.InputJsonValue } : {}),
        ...(input.ip ? { ip: input.ip } : {}),
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
        ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {})
      }
    });
    return {
      id: record.id,
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      before: input.before,
      after: input.after,
      payload: input.payload,
      ip: input.ip,
      userAgent: input.userAgent,
      createdAt: record.createdAt.toISOString()
    };
  }

  async listOperationLogs() { return []; }
}
