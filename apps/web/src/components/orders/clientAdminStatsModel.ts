import { deriveOrderCompletionStatus } from "@sample-room/shared";
import type { ClientOrder } from "../../api/sampleRoomApi";

type ClientStatisticsOrder = Pick<
  ClientOrder,
  | "quantity"
  | "salespersonId"
  | "salespersonName"
  | "clientUserId"
  | "clientUserSnapshot"
  | "stage"
  | "sampleRequestItems"
> &
  {
    completionStatus?: ClientOrder["completionStatus"];
    patternTask?: { status: NonNullable<ClientOrder["patternTask"]>["status"] };
  };

export type ClientAdminBusinessUserStat = {
  businessUserId: string;
  businessUserName: string;
  orderCount: number;
  completedOrderCount: number;
  arrangedQuantity: number;
  completedQuantity: number;
  completionRate: number;
};

export type ClientAdminStatisticsResult = {
  rows: ClientAdminBusinessUserStat[];
  summary: {
    orderCount: number;
    completedOrderCount: number;
    arrangedQuantity: number;
    completedQuantity: number;
  };
};

export function isClientAdminCompletedOrder(order: ClientStatisticsOrder) {
  return (
    order.completionStatus ??
    deriveOrderCompletionStatus({
      sampleRequestItems: order.sampleRequestItems,
      orderStage: order.stage,
      patternTaskStatus: order.patternTask?.status
    })
  ) === "completed";
}

export function buildClientAdminBusinessStats(
  orders: ClientStatisticsOrder[]
): ClientAdminStatisticsResult {
  const map = new Map<string, ClientAdminBusinessUserStat>();
  const summary = {
    orderCount: 0,
    completedOrderCount: 0,
    arrangedQuantity: 0,
    completedQuantity: 0
  };

  for (const order of orders) {
    const businessUserId = order.salespersonId ?? order.clientUserId ?? "unknown-client-user";
    const businessUserName =
      order.salespersonName ??
      order.clientUserSnapshot?.displayName ??
      order.clientUserId ??
      "-";
    const quantity = Number.isFinite(order.quantity) ? order.quantity : 0;
    const completed = isClientAdminCompletedOrder(order);
    const current =
      map.get(businessUserId) ??
      {
        businessUserId,
        businessUserName,
        orderCount: 0,
        completedOrderCount: 0,
        arrangedQuantity: 0,
        completedQuantity: 0,
        completionRate: 0
      };

    current.orderCount += 1;
    current.arrangedQuantity += quantity;
    if (completed) {
      current.completedOrderCount += 1;
      current.completedQuantity += quantity;
    }

    current.completionRate =
      current.arrangedQuantity > 0
        ? Math.round((current.completedQuantity / current.arrangedQuantity) * 1000) / 10
        : 0;
    map.set(businessUserId, current);

    summary.orderCount += 1;
    summary.arrangedQuantity += quantity;
    if (completed) {
      summary.completedOrderCount += 1;
      summary.completedQuantity += quantity;
    }
  }

  return {
    rows: [...map.values()].sort(
      (left, right) =>
        right.orderCount - left.orderCount ||
        left.businessUserName.localeCompare(right.businessUserName)
    ),
    summary
  };
}
