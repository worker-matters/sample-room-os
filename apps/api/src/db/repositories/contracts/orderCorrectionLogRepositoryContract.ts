import type { OrderCorrectionLogEntry } from "../../../modules/orders/orderTypes.js";

export interface OrderCorrectionLogRepository {
  appendOrderCorrectionLogs(
    orderId: string,
    logs: OrderCorrectionLogEntry[]
  ): Promise<OrderCorrectionLogEntry[]>;
  listOrderCorrectionLogsByOrderId(orderId: string): Promise<OrderCorrectionLogEntry[]>;

  // Future audit query methods:
  // listCorrectionLogsByActor(actorId, filters?)
  // listCorrectionLogsByDateRange(filters)
}
