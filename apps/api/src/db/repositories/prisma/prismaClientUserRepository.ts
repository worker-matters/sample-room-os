import type { Prisma } from "@prisma/client";
import type { ClientUserRepository } from "../contracts/index.js";
import type {
  ClientUserCreateInput,
  ClientUserRecord,
  ClientUserUpdateInput
} from "../../../modules/orders/orderTypes.js";
import type { SampleRoomPrismaClient } from "./prismaClient.js";
import { mapClientUser } from "./prismaMappers.js";

export class PrismaClientUserRepository implements ClientUserRepository {
  constructor(private readonly prisma: SampleRoomPrismaClient) {}

  async findClientUserById(id: string): Promise<ClientUserRecord | undefined> {
    const clientUser = await this.prisma.clientUser.findUnique({
      where: { id }
    });

    return clientUser ? mapClientUser(clientUser) : undefined;
  }

  async findClientUserByAccountId(accountId: string): Promise<ClientUserRecord | undefined> {
    const clientUser = await this.prisma.clientUser.findUnique({ where: { accountId } });
    return clientUser ? mapClientUser(clientUser) : undefined;
  }

  async listClientUsersByCustomerId(customerId: string): Promise<ClientUserRecord[]> {
    const clientUsers = await this.prisma.clientUser.findMany({
      where: { customerId },
      orderBy: {
        createdAt: "asc"
      }
    });

    return clientUsers.map(mapClientUser);
  }

  async createClientUser(input: ClientUserCreateInput): Promise<ClientUserRecord> {
    const data: Prisma.ClientUserUncheckedCreateInput = {
      customerId: input.customerId,
      displayName: input.displayName,
      status: input.status ?? "active",
      clientAccessScope: input.clientAccessScope ?? "own",
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.contact !== undefined ? { contact: input.contact } : {})
    };

    const clientUser = await this.prisma.clientUser.create({ data });
    return mapClientUser(clientUser);
  }

  async updateClientUser(id: string, patch: ClientUserUpdateInput): Promise<ClientUserRecord> {
    const clientUser = await this.prisma.clientUser.update({
      where: { id },
      data: {
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.contact !== undefined ? { contact: patch.contact } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.clientAccessScope !== undefined ? { clientAccessScope: patch.clientAccessScope } : {}),
        ...(patch.accountId !== undefined ? { accountId: patch.accountId } : {}),
        ...(patch.archivedAt !== undefined ? { archivedAt: new Date(patch.archivedAt) } : {}),
        ...(patch.archivedBy !== undefined ? { archivedBy: patch.archivedBy } : {})
      }
    });

    return mapClientUser(clientUser);
  }
}
