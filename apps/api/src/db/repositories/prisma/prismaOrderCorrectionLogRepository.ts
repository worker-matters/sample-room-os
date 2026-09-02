import { Prisma } from "@prisma/client";
import type { OrderCorrectionLogRepository } from "../contracts/index.js";
import type { OrderCorrectionLogEntry } from "../../../modules/orders/orderTypes.js";
import type { SampleRoomPrismaClient } from "./prismaClient.js";
import { mapOrderCorrectionLog } from "./prismaMappers.js";

function correctionLogData(
  orderId: string,
  log: OrderCorrectionLogEntry
): Prisma.OrderCorrectionLogUncheckedCreateInput {
  return {
    id: log.id,
    orderId,
    changedAt: new Date(log.changedAt),
    changedByRole: log.changedByRole,
    changedByAccountId: log.changedByAccountId,
    ...(log.changedByName !== undefined ? { changedByName: log.changedByName } : {}),
    fieldName: log.fieldName,
    oldValue: log.oldValue === null ? Prisma.JsonNull : log.oldValue,
    newValue: log.newValue === null ? Prisma.JsonNull : log.newValue
  };
}

export class PrismaOrderCorrectionLogRepository implements OrderCorrectionLogRepository {
  constructor(private readonly prisma: SampleRoomPrismaClient) {}

  async appendOrderCorrectionLogs(
    orderId: string,
    logs: OrderCorrectionLogEntry[]
  ): Promise<OrderCorrectionLogEntry[]> {
    for (const log of logs) {
      await this.prisma.orderCorrectionLog.create({
        data: correctionLogData(orderId, log)
      });
    }

    return logs;
  }

  async listOrderCorrectionLogsByOrderId(orderId: string): Promise<OrderCorrectionLogEntry[]> {
    const logs = await this.prisma.orderCorrectionLog.findMany({
      where: { orderId },
      orderBy: {
        changedAt: "asc"
      }
    });

    return logs.map(mapOrderCorrectionLog);
  }
}
