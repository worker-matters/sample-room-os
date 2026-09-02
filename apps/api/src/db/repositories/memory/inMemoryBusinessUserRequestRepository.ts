import type { BusinessUserRequestRepository } from "../contracts/index.js";
import type {
  BusinessUserRequestCreateInput,
  BusinessUserRequestRecord,
  BusinessUserRequestReviewInput
} from "../../../modules/accounts/businessUserRequestTypes.js";
import type { InMemorySampleRoomStore } from "./inMemoryStore.js";

export class InMemoryBusinessUserRequestRepository implements BusinessUserRequestRepository {
  constructor(private readonly store: InMemorySampleRoomStore) {}

  async createBusinessUserRequest(
    input: BusinessUserRequestCreateInput
  ): Promise<BusinessUserRequestRecord> {
    return this.store.createBusinessUserRequest(input);
  }

  async listBusinessUserRequests(): Promise<BusinessUserRequestRecord[]> {
    return this.store.listBusinessUserRequests();
  }

  async updateBusinessUserRequest(
    id: string,
    input: BusinessUserRequestReviewInput
  ): Promise<BusinessUserRequestRecord> {
    return this.store.updateBusinessUserRequest(id, input);
  }
}
