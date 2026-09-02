import type { RepositoryContext } from "../contracts/index.js";
import { PrismaAttachmentRepository } from "./prismaAttachmentRepository.js";
import { PrismaBusinessUserRequestRepository } from "./prismaBusinessUserRequestRepository.js";
import { PrismaClientUserRepository } from "./prismaClientUserRepository.js";
import { PrismaCustomerRepository } from "./prismaCustomerRepository.js";
import { PrismaOrderCorrectionLogRepository } from "./prismaOrderCorrectionLogRepository.js";
import { PrismaOrderRepository } from "./prismaOrderRepository.js";
import { createPrismaClient, type SampleRoomPrismaClient } from "./prismaClient.js";
import {
  PrismaAccountRepository,
  PrismaAccountSessionRepository,
  PrismaIdentityQrTokenRepository,
  PrismaWorkerProfileRepository
} from "./prismaIdentityRepositories.js";
import { PrismaOperationLogRepository, PrismaSystemSettingRepository } from "./prismaSystemRepositories.js";

export function createPrismaRepositoryContext(
  prisma: SampleRoomPrismaClient = createPrismaClient()
): RepositoryContext {
  const identityRepositories = (
    client: ConstructorParameters<typeof PrismaAccountRepository>[0]
  ) => ({
    accounts: new PrismaAccountRepository(client),
    workerProfiles: new PrismaWorkerProfileRepository(client),
    accountSessions: new PrismaAccountSessionRepository(client),
    identityQrTokens: new PrismaIdentityQrTokenRepository(client)
  });
  return {
    ...identityRepositories(prisma),
    withIdentityTransaction(operation) {
      return prisma.$transaction((transaction) => operation(identityRepositories(transaction)));
    },
    orders: new PrismaOrderRepository(prisma),
    customers: new PrismaCustomerRepository(prisma),
    clientUsers: new PrismaClientUserRepository(prisma),
    attachments: new PrismaAttachmentRepository(prisma),
    businessUserRequests: new PrismaBusinessUserRequestRepository(prisma),
    orderCorrectionLogs: new PrismaOrderCorrectionLogRepository(prisma),
    operationLogs: new PrismaOperationLogRepository(prisma),
    systemSettings: new PrismaSystemSettingRepository(prisma)
  };
}
