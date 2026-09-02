import type {
  CustomerCreateInput,
  CustomerRecord
} from "../../../modules/orders/orderTypes.js";

export interface CustomerRepository {
  createCustomer(input: CustomerCreateInput): Promise<CustomerRecord>;
  listCustomers(): Promise<CustomerRecord[]>;
  findCustomerById(id: string): Promise<CustomerRecord | undefined>;
  updateCustomer(
    id: string,
    patch: Partial<Pick<CustomerRecord, "name" | "status" | "archivedAt" | "archivedBy">>
  ): Promise<CustomerRecord>;

  // Future lifecycle methods:
  // archiveCustomer(id, actor)
  // restoreCustomer(id, actor)
  // findCustomerByCode(code)
}
