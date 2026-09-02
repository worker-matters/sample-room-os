import type { RepositoryContext } from "../contracts/index.js";
import { InMemoryAttachmentRepository } from "./inMemoryAttachmentRepository.js";
import { InMemoryBusinessUserRequestRepository } from "./inMemoryBusinessUserRequestRepository.js";
import { InMemoryClientUserRepository } from "./inMemoryClientUserRepository.js";
import { InMemoryCustomerRepository } from "./inMemoryCustomerRepository.js";
import { InMemoryOrderCorrectionLogRepository } from "./inMemoryOrderCorrectionLogRepository.js";
import { InMemoryOrderRepository } from "./inMemoryOrderRepository.js";
import { createInMemoryStore, type InMemorySampleRoomStore } from "./inMemoryStore.js";
import {
  InMemoryAccountRepository,
  InMemoryAccountSessionRepository,
  InMemoryIdentityQrTokenRepository,
  InMemoryIdentityStore,
  InMemoryWorkerProfileRepository
} from "./inMemoryIdentityRepositories.js";
import { InMemoryOperationLogRepository, InMemorySystemSettingRepository } from "./inMemorySystemRepositories.js";

export function createInMemoryRepositoryContext(
  store: InMemorySampleRoomStore = createInMemoryStore(),
  identityStore: InMemoryIdentityStore = new InMemoryIdentityStore()
): RepositoryContext {
  const identities = {
    accounts: new InMemoryAccountRepository(identityStore),
    workerProfiles: new InMemoryWorkerProfileRepository(identityStore),
    accountSessions: new InMemoryAccountSessionRepository(identityStore),
    identityQrTokens: new InMemoryIdentityQrTokenRepository(identityStore)
  };
  return {
    ...identities,
    async withIdentityTransaction(operation) {
      const snapshot = identityStore.snapshot();
      try {
        return await operation(identities);
      } catch (error) {
        identityStore.restore(snapshot);
        throw error;
      }
    },
    orders: new InMemoryOrderRepository(store),
    customers: new InMemoryCustomerRepository(store),
    clientUsers: new InMemoryClientUserRepository(store),
    attachments: new InMemoryAttachmentRepository(store),
    businessUserRequests: new InMemoryBusinessUserRequestRepository(store),
    orderCorrectionLogs: new InMemoryOrderCorrectionLogRepository(store),
    operationLogs: new InMemoryOperationLogRepository(),
    systemSettings: new InMemorySystemSettingRepository()
  };
}
