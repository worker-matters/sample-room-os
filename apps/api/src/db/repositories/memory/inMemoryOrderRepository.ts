import type { OrderRepository, OrderUpdatePatch } from "../contracts/index.js";
import type {
  OrderCreateInput,
  OrderRecord
} from "../../../modules/orders/orderTypes.js";
import type { InMemorySampleRoomStore } from "./inMemoryStore.js";

export class InMemoryOrderRepository implements OrderRepository {
  constructor(private readonly store: InMemorySampleRoomStore) {}

  async createOrder(input: OrderCreateInput): Promise<OrderRecord> {
    return this.store.createOrder(input);
  }

  async updateOrder(id: string, patch: OrderUpdatePatch): Promise<OrderRecord> {
    return this.store.updateOrder(id, patch);
  }

  async findOrderById(id: string): Promise<OrderRecord | undefined> {
    return this.store.findOrderById(id);
  }

  async listOrders(): Promise<OrderRecord[]> {
    return this.store.listOrders();
  }
}
