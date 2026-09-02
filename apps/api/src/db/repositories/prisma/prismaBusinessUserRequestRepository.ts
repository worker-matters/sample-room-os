import type { Prisma, Role as PrismaRole } from "@prisma/client";
import type { BusinessUserRequestRepository } from "../contracts/index.js";
import type {
  BusinessUserRequestCreateInput,
  BusinessUserRequestRecord,
  BusinessUserRequestReviewInput
} from "../../../modules/accounts/businessUserRequestTypes.js";
import type { SampleRoomPrismaClient } from "./prismaClient.js";
import { mapBusinessUserRequest } from "./prismaMappers.js";

export class PrismaBusinessUserRequestRepository implements BusinessUserRequestRepository {
  constructor(private readonly prisma: SampleRoomPrismaClient) {}

  async createBusinessUserRequest(
    input: BusinessUserRequestCreateInput
  ): Promise<BusinessUserRequestRecord> {
    const data: Prisma.BusinessUserRequestUncheckedCreateInput = {
      customerId: input.customerId,
      customerName: input.customerName,
      requestedByClientUserId: input.requestedByClientUserId,
      requestedByName: input.requestedByName,
      businessUserName: input.businessUserName,
      contact: input.contact,
      status: "pending",
      ...(input.roleNote !== undefined ? { roleNote: input.roleNote } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.requestedUsername !== undefined
        ? { requestedUsername: input.requestedUsername }
        : {}),
      ...(input.requestedPasswordHash !== undefined
        ? { requestedPasswordHash: input.requestedPasswordHash }
        : {})
    };

    const request = await this.prisma.businessUserRequest.create({ data });
    return mapBusinessUserRequest(request);
  }

  async listBusinessUserRequests(): Promise<BusinessUserRequestRecord[]> {
    const requests = await this.prisma.businessUserRequest.findMany({
      orderBy: {
        createdAt: "asc"
      }
    });

    return requests.map(mapBusinessUserRequest);
  }

  async updateBusinessUserRequest(
    id: string,
    input: BusinessUserRequestReviewInput
  ): Promise<BusinessUserRequestRecord> {
    const request = await this.prisma.businessUserRequest.update({
      where: { id },
      data: {
        status: input.status,
        reviewedAt: new Date(),
        reviewedBy: input.reviewedBy,
        reviewedByRole: input.reviewedByRole as PrismaRole,
        ...(input.reviewNote !== undefined ? { reviewNote: input.reviewNote } : {}),
        ...(input.createdClientUserId !== undefined
          ? { createdClientUserId: input.createdClientUserId }
          : {})
      }
    });

    return mapBusinessUserRequest(request);
  }
}
