import type { OrderCorrectionLogRepository } from "../contracts/index.js";
import type { OrderCorrectionLogEntry } from "../../../modules/orders/orderTypes.js";
import type { InMemorySampleRoomStore } from "./inMemoryStore.js";

export class InMemoryOrderCorrectionLogRepository implements OrderCorrectionLogRepository {
  constructor(private readonly store: InMemorySampleRoomStore) {}

  async appendOrderCorrectionLogs(
    orderId: string,
    logs: OrderCorrectionLogEntry[]
  ): Promise<OrderCorrectionLogEntry[]> {
    return this.store.appendOrderCorrectionLogs(orderId, logs);
  }

  async listOrderCorrectionLogsByOrderId(orderId: string): Promise<OrderCorrectionLogEntry[]> {
    return this.store.listOrderCorrectionLogsByOrderId(orderId);
  }
}
