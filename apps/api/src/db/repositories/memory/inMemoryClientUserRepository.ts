import type { ClientUserRepository } from "../contracts/index.js";
import type {
  ClientUserCreateInput,
  ClientUserRecord,
  ClientUserUpdateInput
} from "../../../modules/orders/orderTypes.js";
import type { InMemorySampleRoomStore } from "./inMemoryStore.js";

export class InMemoryClientUserRepository implements ClientUserRepository {
  constructor(private readonly store: InMemorySampleRoomStore) {}

  async findClientUserById(id: string): Promise<ClientUserRecord | undefined> {
    return this.store.findClientUserById(id);
  }

  async findClientUserByAccountId(accountId: string): Promise<ClientUserRecord | undefined> {
    return this.store.findClientUserByAccountId(accountId);
  }

  async listClientUsersByCustomerId(customerId: string): Promise<ClientUserRecord[]> {
    return this.store.listClientUsersByCustomerId(customerId);
  }

  async createClientUser(input: ClientUserCreateInput): Promise<ClientUserRecord> {
    return this.store.createClientUser(input);
  }

  async updateClientUser(id: string, patch: ClientUserUpdateInput): Promise<ClientUserRecord> {
    return this.store.updateClientUser(id, patch);
  }
}
