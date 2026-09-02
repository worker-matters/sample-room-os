import type { CustomerRepository } from "../contracts/index.js";
import type {
  CustomerCreateInput,
  CustomerRecord
} from "../../../modules/orders/orderTypes.js";
import type { InMemorySampleRoomStore } from "./inMemoryStore.js";

export class InMemoryCustomerRepository implements CustomerRepository {
  constructor(private readonly store: InMemorySampleRoomStore) {}

  async listCustomers(): Promise<CustomerRecord[]> {
    return this.store.listCustomers();
  }

  async createCustomer(input: CustomerCreateInput): Promise<CustomerRecord> {
    return this.store.createCustomer(input);
  }

  async findCustomerById(id: string): Promise<CustomerRecord | undefined> {
    return this.store.findCustomerById(id);
  }

  async updateCustomer(
    id: string,
    patch: Partial<Pick<CustomerRecord, "name" | "status" | "archivedAt" | "archivedBy">>
  ): Promise<CustomerRecord> {
    return this.store.updateCustomer(id, patch);
  }
}
