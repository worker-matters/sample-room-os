import type {
  ClientUserCreateInput,
  ClientUserRecord,
  ClientUserUpdateInput
} from "../../../modules/orders/orderTypes.js";

export interface ClientUserRepository {
  findClientUserById(id: string): Promise<ClientUserRecord | undefined>;
  findClientUserByAccountId(accountId: string): Promise<ClientUserRecord | undefined>;
  listClientUsersByCustomerId(customerId: string): Promise<ClientUserRecord[]>;
  createClientUser(input: ClientUserCreateInput): Promise<ClientUserRecord>;
  updateClientUser(id: string, patch: ClientUserUpdateInput): Promise<ClientUserRecord>;

  // Future account/profile methods:
  // findActiveOwnScopeByContact(customerId, contact)
  // updateClientUserProfile(id, patch)
}
