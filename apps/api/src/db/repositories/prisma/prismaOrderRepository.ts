import { Prisma } from "@prisma/client";
import { DEFAULT_SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import type { OrderRepository, OrderUpdatePatch } from "../contracts/index.js";
import type {
  OrderCreateInput,
  OrderCorrectionLogEntry,
  OrderRecord
} from "../../../modules/orders/orderTypes.js";
import type { SampleRoomPrismaClient } from "./prismaClient.js";
import { folderCodePrefixForDate, formatFolderCode } from "../../../modules/orders/orderFolderCode.js";
import {
  fromDateOnlyString,
  mapOrder,
  orderInclude,
  type PrismaOrderWithRelations
} from "./prismaMappers.js";

function isoDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

function jsonSnapshot(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

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

function applyPatch(data: Prisma.OrderUncheckedUpdateInput, patch: OrderUpdatePatch) {
  if (patch.sourceType !== undefined) {
    data.sourceType = patch.sourceType;
  }
  if (patch.sourceOrderId !== undefined) {
    data.sourceOrderId = patch.sourceOrderId;
  }
  if (patch.sourcePatternVersionId !== undefined) {
    data.sourcePatternVersionId = patch.sourcePatternVersionId;
  }
  if (patch.customerId !== undefined) {
    data.customerId = patch.customerId;
  }
  if (patch.clientUserId !== undefined) {
    data.clientUserId = patch.clientUserId;
  }
  if (patch.customerName !== undefined) {
    data.customerName = patch.customerName;
  }
  if (patch.salespersonId !== undefined) {
    data.salespersonId = patch.salespersonId;
  }
  if (patch.salespersonName !== undefined) {
    data.salespersonName = patch.salespersonName;
  }
  if (patch.customerSnapshot !== undefined) {
    data.customerSnapshot = jsonSnapshot(patch.customerSnapshot);
  }
  if (patch.clientUserSnapshot !== undefined) {
    data.clientUserSnapshot = jsonSnapshot(patch.clientUserSnapshot);
  }
  if (patch.styleNo !== undefined) {
    data.styleNo = patch.styleNo;
  }
  if (patch.styleName !== undefined) {
    data.styleName = patch.styleName;
  }
  if (patch.quantity !== undefined) {
    data.quantity = patch.quantity;
  }
  if (patch.sampleType !== undefined) {
    data.sampleType = patch.sampleType;
  }
  if (patch.sampleRound !== undefined) {
    data.sampleRound = patch.sampleRound;
  }
  if (patch.deliveryDate !== undefined) {
    data.deliveryDate = fromDateOnlyString(patch.deliveryDate);
  }
  if (patch.remark !== undefined) {
    data.remark = patch.remark;
  }
  if (patch.taskInstructionNote !== undefined) {
    data.taskInstructionNote = patch.taskInstructionNote;
  }
  if (patch.intakeStatus !== undefined) {
    data.intakeStatus = patch.intakeStatus;
  }
  if (patch.stage !== undefined) {
    data.stage = patch.stage;
  }
  if (patch.patternStatus !== undefined) {
    data.patternStatus = patch.patternStatus;
  }
  if (patch.patternSourceType !== undefined) {
    data.patternSourceType = patch.patternSourceType;
  }
  if (patch.sampleRequestItems !== undefined) {
    data.sampleRequestItems = patch.sampleRequestItems;
  }
  if (patch.sampleGarmentRequired !== undefined) {
    data.sampleGarmentRequired = patch.sampleGarmentRequired;
  }
  if (patch.fabricStatus !== undefined) {
    data.fabricStatus = patch.fabricStatus;
  }
  if (patch.trimStatus !== undefined) {
    data.trimStatus = patch.trimStatus;
  }
  if (patch.latestPatternVersion !== undefined) {
    data.latestPatternVersion = patch.latestPatternVersion;
  }
  if (patch.cuttingUsedPatternVersion !== undefined) {
    data.cuttingUsedPatternVersion = patch.cuttingUsedPatternVersion;
  }
  if (patch.receivedAt !== undefined) {
    data.receivedAt = isoDate(patch.receivedAt);
  }
  if (patch.receivedBy !== undefined) {
    data.receivedBy = patch.receivedBy;
  }
  if (patch.returnReason !== undefined) {
    data.returnReason = patch.returnReason;
  }
  if (patch.returnedAt !== undefined) {
    data.returnedAt = isoDate(patch.returnedAt);
  }
  if (patch.returnedBy !== undefined) {
    data.returnedBy = patch.returnedBy;
  }
  if (patch.supplementCount !== undefined) {
    data.supplementCount = patch.supplementCount;
  }
  if (patch.supplementedAt !== undefined) {
    data.supplementedAt = isoDate(patch.supplementedAt);
  }
  if (patch.terminated !== undefined) {
    data.terminated = patch.terminated;
  }
  if (patch.terminatedAt !== undefined) {
    data.terminatedAt = isoDate(patch.terminatedAt);
  }
  if (patch.terminatedBy !== undefined) {
    data.terminatedBy = patch.terminatedBy;
  }
  if (patch.terminatedByName !== undefined) {
    data.terminatedByName = patch.terminatedByName;
  }
  if (patch.terminationReason !== undefined) {
    data.terminationReason = patch.terminationReason;
  }
  if (patch.statusBeforeTermination !== undefined) {
    data.statusBeforeTermination = patch.statusBeforeTermination;
  }
  if (patch.stageAtTermination !== undefined) {
    data.stageAtTermination = patch.stageAtTermination;
  }
  if (patch.createdBy !== undefined) {
    data.createdBy = patch.createdBy;
  }
}

function isUniqueOrderIdentityConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target) &&
    (error.meta.target.includes("orderNo") || error.meta.target.includes("folderCode"))
  );
}

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: SampleRoomPrismaClient) {}

  private async nextOrderNo(): Promise<string> {
    const count = await this.prisma.order.count();
    let nextNumber = count + 1;

    while (true) {
      const orderNo = `V2-MOCK-${String(nextNumber).padStart(4, "0")}`;
      const existing = await this.prisma.order.findUnique({
        where: { orderNo }
      });

      if (!existing) {
        return orderNo;
      }

      nextNumber += 1;
    }
  }

  private async nextFolderCode(date = new Date()): Promise<string> {
    const prefix = folderCodePrefixForDate(date);
    const existing = await this.prisma.order.findMany({
      where: {
        folderCode: {
          startsWith: prefix
        }
      },
      select: {
        folderCode: true
      }
    });
    let nextNumber = 1;
    for (const record of existing) {
      const sequence = Number(record.folderCode.slice(prefix.length));
      if (Number.isInteger(sequence) && sequence >= nextNumber) {
        nextNumber = sequence + 1;
      }
    }

    while (true) {
      const folderCode = formatFolderCode(prefix, nextNumber);
      const matched = await this.prisma.order.findUnique({
        where: { folderCode }
      });
      if (!matched) {
        return folderCode;
      }
      nextNumber += 1;
    }
  }

  async createOrder(input: OrderCreateInput): Promise<OrderRecord> {
    const [customer, clientUser] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: input.customerId } }),
      this.prisma.clientUser.findUnique({ where: { id: input.clientUserId } })
    ]);

    if (!customer || !clientUser) {
      throw new Error("Cannot create order without customer and client user snapshots.");
    }

    const customerSnapshot = { id: customer.id, name: customer.name };
    const clientUserSnapshot = { id: clientUser.id, displayName: clientUser.displayName };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const orderNo = await this.nextOrderNo();
      const folderCode = await this.nextFolderCode();
      const data: Prisma.OrderUncheckedCreateInput = {
        orderNo,
        folderCode,
        sourceType: input.sourceType,
        sourceOrderId: input.sourceOrderId ?? null,
        sourcePatternVersionId: input.sourcePatternVersionId ?? null,
        customerId: input.customerId,
        clientUserId: input.clientUserId,
        customerName: customer.name,
        salespersonId: clientUser.id,
        salespersonName: clientUser.displayName,
        customerSnapshot,
        clientUserSnapshot,
        styleNo: input.styleNo,
        styleName: input.styleName,
        quantity: input.quantity,
        sampleType: input.sampleType,
        sampleRound: input.sampleRound,
        deliveryDate: fromDateOnlyString(input.deliveryDate),
        taskInstructionNote: input.taskInstructionNote ?? null,
        intakeStatus: input.intakeStatus,
        stage: input.stage,
        patternStatus: input.patternStatus,
        patternSourceType: input.patternSourceType ?? "none",
        sampleRequestItems: input.sampleRequestItems ?? DEFAULT_SAMPLE_REQUEST_ITEMS,
        sampleGarmentRequired: input.sampleGarmentRequired ?? true,
        fabricStatus: input.fabricStatus,
        trimStatus: input.trimStatus,
        latestPatternVersion: input.latestPatternVersion ?? null,
        cuttingUsedPatternVersion: input.cuttingUsedPatternVersion ?? null,
        supplementCount: input.supplementCount ?? 0,
        terminated: false,
        createdBy: input.createdBy,
        ...(input.remark !== undefined ? { remark: input.remark } : {}),
        ...(input.receivedAt !== undefined ? { receivedAt: isoDate(input.receivedAt) } : {}),
        ...(input.receivedBy !== undefined ? { receivedBy: input.receivedBy } : {}),
        ...(input.returnReason !== undefined ? { returnReason: input.returnReason } : {}),
        ...(input.returnedAt !== undefined ? { returnedAt: isoDate(input.returnedAt) } : {}),
        ...(input.returnedBy !== undefined ? { returnedBy: input.returnedBy } : {}),
        ...(input.supplementedAt !== undefined ? { supplementedAt: isoDate(input.supplementedAt) } : {})
      };

      try {
        const order = await this.prisma.order.create({
          data,
          include: orderInclude
        });

        return mapOrder(order);
      } catch (error) {
        if (isUniqueOrderIdentityConflict(error)) {
          continue;
        }

        throw error;
      }
    }

    throw new Error("Could not allocate a unique order number and folder code.");
  }

  async updateOrder(id: string, patch: OrderUpdatePatch): Promise<OrderRecord> {
    const correctionLogs = patch.correctionLogs;
    const data: Prisma.OrderUncheckedUpdateInput = {};
    applyPatch(data, patch);

    const update = async (
      transaction: Pick<SampleRoomPrismaClient, "order" | "orderCorrectionLog">
    ) => {
      if (Object.keys(data).length > 0) {
        await transaction.order.update({
          where: { id },
          data
        });
      }

      if (correctionLogs) {
        await transaction.orderCorrectionLog.deleteMany({
          where: { orderId: id }
        });

        for (const log of correctionLogs) {
          await transaction.orderCorrectionLog.create({
            data: correctionLogData(id, log)
          });
        }
      }

      return transaction.order.findUnique({
        where: { id },
        include: orderInclude
      });
    };

    const order =
      "$transaction" in this.prisma
        ? await this.prisma.$transaction(update)
        : await update(this.prisma);

    if (!order) {
      throw new Error("Order not found.");
    }

    return mapOrder(order as PrismaOrderWithRelations);
  }

  async findOrderById(id: string): Promise<OrderRecord | undefined> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: orderInclude
    });

    return order ? mapOrder(order) : undefined;
  }

  async listOrders(): Promise<OrderRecord[]> {
    const orders = await this.prisma.order.findMany({
      include: orderInclude,
      orderBy: {
        createdAt: "asc"
      }
    });

    return orders.map(mapOrder);
  }
}
