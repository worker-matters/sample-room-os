import type {
  OrderCreateInput,
  OrderRecord,
  OrderTrackingPatch
} from "../../../modules/orders/orderTypes.js";

export type OrderUpdatePatch = OrderTrackingPatch & Partial<OrderRecord>;

export interface OrderRepository {
  createOrder(input: OrderCreateInput): Promise<OrderRecord>;
  updateOrder(id: string, patch: OrderUpdatePatch): Promise<OrderRecord>;
  findOrderById(id: string): Promise<OrderRecord | undefined>;
  listOrders(): Promise<OrderRecord[]>;

  // Future query methods should be added when services stop loading all orders
  // and filtering in memory:
  // listOrdersByCustomerId(customerId, filters?)
  // listOrdersByCustomerAndClientUser(customerId, clientUserId, filters?)
  // listPendingReceiveOrders(filters?)
  // listActiveTrackingOrders(filters?)
  // listReceiverOrderQuery(filters?)
}
