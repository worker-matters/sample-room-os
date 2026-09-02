import type {
  BusinessUserRequestCreateInput,
  BusinessUserRequestRecord,
  BusinessUserRequestReviewInput
} from "../../../modules/accounts/businessUserRequestTypes.js";

export interface BusinessUserRequestRepository {
  createBusinessUserRequest(
    input: BusinessUserRequestCreateInput
  ): Promise<BusinessUserRequestRecord>;
  listBusinessUserRequests(): Promise<BusinessUserRequestRecord[]>;
  updateBusinessUserRequest(
    id: string,
    input: BusinessUserRequestReviewInput
  ): Promise<BusinessUserRequestRecord>;

  // Future query methods:
  // findBusinessUserRequestById(id)
  // listRequestsByCustomerId(customerId, filters?)
  // listPendingRequests(filters?)
}
