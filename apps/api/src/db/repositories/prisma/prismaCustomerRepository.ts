import type { CustomerRepository } from "../contracts/index.js";
import type {
  CustomerCreateInput,
  CustomerRecord
} from "../../../modules/orders/orderTypes.js";
import type { SampleRoomPrismaClient } from "./prismaClient.js";
import { mapCustomer } from "./prismaMappers.js";

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(private readonly prisma: SampleRoomPrismaClient) {}

  async createCustomer(input: CustomerCreateInput): Promise<CustomerRecord> {
    const customer = await this.prisma.customer.create({
      data: {
        name: input.name,
        status: input.status ?? "active"
      }
    });

    return mapCustomer(customer);
  }

  async listCustomers(): Promise<CustomerRecord[]> {
    const customers = await this.prisma.customer.findMany({
      orderBy: {
        createdAt: "asc"
      }
    });

    return customers.map(mapCustomer);
  }

  async findCustomerById(id: string): Promise<CustomerRecord | undefined> {
    const customer = await this.prisma.customer.findUnique({
      where: { id }
    });

    return customer ? mapCustomer(customer) : undefined;
  }

  async updateCustomer(
    id: string,
    patch: Partial<Pick<CustomerRecord, "name" | "status" | "archivedAt" | "archivedBy">>
  ): Promise<CustomerRecord> {
    const customer = await this.prisma.customer.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.archivedAt !== undefined ? { archivedAt: new Date(patch.archivedAt) } : {}),
        ...(patch.archivedBy !== undefined ? { archivedBy: patch.archivedBy } : {})
      }
    });

    return mapCustomer(customer);
  }
}
