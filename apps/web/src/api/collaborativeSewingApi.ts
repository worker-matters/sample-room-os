import type { DevSession } from "../app/DevSessionContext";
import { request } from "./request";

export type SewingMode = "single" | "collaboration";
export type SewingParticipationStatus =
  | "active"
  | "completed"
  | "cancelled"
  | "replaced";

export type PlannerSewingParticipation = {
  id: string;
  workerProfileId?: string;
  workerName: string;
  joinedAt: string;
  targetPieces?: number;
  status: SewingParticipationStatus;
  completedPieces?: number;
  completedAt?: string;
  cancelledAt?: string;
};

export type PlannerSewingCollaboration = {
  orderId: string;
  quantity: number;
  sewingMode: "collaboration";
  revision: string;
  completedPieces: number;
  plannedPieces: number;
  unallocatedPieces: number;
  activeParticipantCount: number;
  effectiveParticipantCount: number;
  sewingGateSatisfied: boolean;
  participants: PlannerSewingParticipation[];
};

export function getPlannerSewingCollaboration(session: DevSession, orderId: string) {
  return request<{ collaboration: PlannerSewingCollaboration }>(
    session,
    `/api/planner/orders/${encodeURIComponent(orderId)}/sewing-collaboration`
  );
}
export function updatePlannerParticipationTargets(
  session: DevSession,
  orderId: string,
  expectedRevision: string,
  updates: Array<{ participationId: string; targetPieces: number }>
) {
  return request<{ collaboration: PlannerSewingCollaboration }>(
    session,
    `/api/planner/orders/${encodeURIComponent(orderId)}/sewing-collaboration/targets`,
    {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision, updates })
    }
  );
}
export function cancelPlannerParticipation(
  session: DevSession,
  orderId: string,
  participationId: string,
  expectedRevision: string
) {
  return request<{
    participation: {
      orderId: string;
      participationId: string;
      status: "cancelled";
      sewingMode: SewingMode;
      quantity: number;
      revision: string;
      plannedPieces: number;
      completedPieces: number;
      unallocatedPieces: number;
      activeParticipantCount: number;
      effectiveParticipantCount: number;
      sewingGateSatisfied: boolean;
      participants: PlannerSewingParticipation[];
    };
  }>(
    session,
    `/api/planner/orders/${encodeURIComponent(orderId)}/sewing-collaboration/${encodeURIComponent(participationId)}/cancel`,
    { method: "POST", body: JSON.stringify({ expectedRevision }) }
  );
}
// These planner APIs expose the same server-owned collaboration state used by worker clients.
