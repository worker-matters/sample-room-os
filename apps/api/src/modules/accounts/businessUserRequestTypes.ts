export type BusinessUserRequestStatus = "pending" | "approved" | "rejected";
export type BusinessUserRequestSource = "supervisor_request" | "supervisor_registration_code";

export type BusinessUserRequestRecord = {
  id: string;
  customerId: string;
  customerName: string;
  requestedByClientUserId: string;
  requestedByName: string;
  businessUserName: string;
  contact: string;
  roleNote?: string | undefined;
  note?: string | undefined;
  source?: BusinessUserRequestSource | undefined;
  requestedUsername?: string | undefined;
  requestedPasswordHash?: string | undefined;
  status: BusinessUserRequestStatus;
  createdAt: string;
  reviewedAt?: string | undefined;
  reviewedBy?: string | undefined;
  reviewedByRole?: string | undefined;
  reviewNote?: string | undefined;
  createdClientUserId?: string | undefined;
};

export type BusinessUserRequestCreateInput = Pick<
  BusinessUserRequestRecord,
  | "customerId"
  | "customerName"
  | "requestedByClientUserId"
  | "requestedByName"
  | "businessUserName"
  | "contact"
  | "roleNote"
  | "note"
  | "source"
  | "requestedUsername"
  | "requestedPasswordHash"
>;

export type BusinessUserRequestReviewInput = {
  status: Exclude<BusinessUserRequestStatus, "pending">;
  reviewedBy: string;
  reviewedByRole: string;
  reviewNote?: string | undefined;
  createdClientUserId?: string | undefined;
};
