import { createHash } from "node:crypto";
import { ORDER_STAGES } from "@sample-room/shared";
import type { OrderCorrectionLogEntry } from "../orders/orderTypes.js";
import type { ScanRecord } from "./scanTypes.js";
import {
  effectiveProcessPieces,
  originalProcessPieces
} from "./processPiecesCorrections.js";

export type SewingMode = "single" | "collaboration";
export type SewingParticipationStatus =
  | "active"
  | "completed"
  | "exited_zero"
  | "cancelled"
  | "replaced";

export const SEWING_PARTICIPATION_TARGET_PREFIX = "sewing_participation_target:";
export const SEWING_PARTICIPATION_CANCEL_PREFIX = "sewing_participation_cancel:";

export type SewingParticipation = {
  id: string;
  startScanRecordId: string;
  workerProfileId?: string | undefined;
  actorAccountId: string;
  workerId: string;
  workerName: string;
  joinedAt: string;
  collaborationJoin: boolean;
  targetPieces?: number | undefined;
  status: SewingParticipationStatus;
  completionScanRecordId?: string | undefined;
  completedAt?: string | undefined;
  completedPieces?: number | undefined;
  cancelledAt?: string | undefined;
  cancelledByAccountId?: string | undefined;
  cancelledByName?: string | undefined;
  replacedAt?: string | undefined;
  replacedByWorkerId?: string | undefined;
  replacedByWorkerName?: string | undefined;
};

export type CollaborativeSewingState = {
  mode: SewingMode;
  participations: SewingParticipation[];
  activeParticipations: SewingParticipation[];
  effectiveParticipations: SewingParticipation[];
  currentParticipations: SewingParticipation[];
  usesParticipationWorkflow: boolean;
  hiddenAuditScanRecordIds: string[];
  duplicateCompletionCount: number;
  plannedPieces: number;
  unallocatedPieces: number;
  completedPieces: number;
  hasUnresolvedParticipation: boolean;
  sewingGateSatisfied: boolean;
};

type CollaborativeOrder = {
  quantity: number;
  correctionLogs: OrderCorrectionLogEntry[];
  stage?: string | null | undefined;
};

type SewingWorkflowRecord = Pick<
  ScanRecord,
  | "id"
  | "actorAccountId"
  | "workerProfileId"
  | "stage"
  | "action"
  | "workerId"
  | "workerName"
  | "eventTime"
  | "pieces"
  | "collaborationJoin"
  | "takeoverFromWorkerId"
  | "takeoverFromWorkerName"
  | "qualityResult"
>;

function logTime(log: OrderCorrectionLogEntry) {
  return Date.parse(log.changedAt);
}

function recordTime(record: SewingWorkflowRecord) {
  return Date.parse(record.eventTime);
}

function latestLog(
  logs: readonly OrderCorrectionLogEntry[],
  fieldName: string
): OrderCorrectionLogEntry | undefined {
  return logs
    .filter((log) => log.fieldName === fieldName)
    .sort((left, right) => logTime(left) - logTime(right))
    .at(-1);
}

export function sewingParticipationTargetFieldName(participationId: string) {
  return `${SEWING_PARTICIPATION_TARGET_PREFIX}${participationId}`;
}

export function sewingParticipationCancelFieldName(participationId: string) {
  return `${SEWING_PARTICIPATION_CANCEL_PREFIX}${participationId}`;
}

export function currentParticipationTarget(
  order: Pick<CollaborativeOrder, "correctionLogs">,
  participationId: string
): number | undefined {
  const latest = latestLog(
    order.correctionLogs,
    sewingParticipationTargetFieldName(participationId)
  );
  return typeof latest?.newValue === "number" ? latest.newValue : undefined;
}

export function participationCancellation(
  order: Pick<CollaborativeOrder, "correctionLogs">,
  participationId: string
): OrderCorrectionLogEntry | undefined {
  const latest = latestLog(
    order.correctionLogs,
    sewingParticipationCancelFieldName(participationId)
  );
  return latest?.newValue === "cancelled" ? latest : undefined;
}

function takeoverReplacingStart(
  start: SewingWorkflowRecord,
  records: readonly SewingWorkflowRecord[]
) {
  const startAt = recordTime(start);
  return records
    .filter(
      (record) =>
        record.stage === "sewing" &&
        record.action === "start" &&
        record.takeoverFromWorkerId === start.workerId &&
        recordTime(record) >= startAt
    )
    .sort((left, right) => recordTime(left) - recordTime(right))[0];
}

function completionForStart(
  start: SewingWorkflowRecord,
  records: readonly SewingWorkflowRecord[],
  endBoundaryAt: number | undefined
) {
  const startAt = recordTime(start);
  return records
    .filter(
      (record) =>
        record.stage === "sewing" &&
        record.action === "complete" &&
        record.workerProfileId === start.workerProfileId &&
        recordTime(record) >= startAt &&
        (endBoundaryAt === undefined || recordTime(record) < endBoundaryAt)
    )
    .sort((left, right) => recordTime(left) - recordTime(right))[0];
}

function collaborativeSewingRoundState(
  order: CollaborativeOrder,
  records: readonly SewingWorkflowRecord[]
): CollaborativeSewingState {
  const sewingRecords = records
    .filter((record) => record.stage === "sewing")
    .sort((left, right) => {
      const timeDifference = recordTime(left) - recordTime(right);
      return timeDifference !== 0 ? timeDifference : left.id.localeCompare(right.id);
    });
  const starts = sewingRecords.filter((record) => record.action === "start");

  const auditedParticipations = starts.map((start, index): SewingParticipation => {
    const nextSameWorkerStart = starts
      .slice(index + 1)
      .find((candidate) => candidate.workerProfileId === start.workerProfileId);
    const replacingTakeover = takeoverReplacingStart(start, sewingRecords);
    const endBoundaryCandidates = [
      nextSameWorkerStart ? recordTime(nextSameWorkerStart) : undefined,
      replacingTakeover ? recordTime(replacingTakeover) : undefined
    ].filter((value): value is number => value !== undefined);
    const endBoundaryAt = endBoundaryCandidates.length > 0
      ? Math.min(...endBoundaryCandidates)
      : undefined;
    const completion = completionForStart(start, sewingRecords, endBoundaryAt);
    const cancellation = participationCancellation(order, start.id);
    const rawCompletedPieces = completion
      ? originalProcessPieces(order, completion as Pick<ScanRecord, "id" | "stage" | "pieces">)
      : undefined;
    const completedPieces = completion
      ? effectiveProcessPieces(order, completion as Pick<ScanRecord, "id" | "stage" | "pieces">)
      : undefined;

    const base = {
      id: start.id,
      startScanRecordId: start.id,
      workerProfileId: start.workerProfileId,
      actorAccountId: start.actorAccountId,
      workerId: start.workerId,
      workerName: start.workerName,
      joinedAt: start.eventTime,
      collaborationJoin: start.collaborationJoin === true,
      targetPieces: currentParticipationTarget(order, start.id)
    };

    if (cancellation) {
      return {
        ...base,
        status: "cancelled",
        cancelledAt: cancellation.changedAt,
        cancelledByAccountId: cancellation.changedByAccountId,
        cancelledByName: cancellation.changedByName
      };
    }

    if (!completion && replacingTakeover) {
      return {
        ...base,
        status: "replaced",
        replacedAt: replacingTakeover.eventTime,
        replacedByWorkerId: replacingTakeover.workerId,
        replacedByWorkerName: replacingTakeover.workerName
      };
    }

    if (!completion) {
      return { ...base, status: "active" };
    }

    // Only an immutable historical raw 0-piece submission is an exited_zero audit fact.
    // A later manager correction to 0 affects performance and money only; it must not erase
    // the completed participation or reopen the original sewing workflow.
    if ((rawCompletedPieces ?? 0) === 0) {
      return {
        ...base,
        status: "exited_zero",
        completionScanRecordId: completion.id,
        completedAt: completion.eventTime,
        completedPieces: 0
      };
    }

    return {
      ...base,
      status: "completed",
      completionScanRecordId: completion.id,
      completedAt: completion.eventTime,
      completedPieces
    };
  });

  // A legacy raw zero-piece completion is retained in immutable ScanRecord history for audit,
  // but is intentionally absent from every business projection. New zero-piece submissions
  // are rejected by the write path. Rejoining creates a fresh start record.
  const nonZeroParticipations = auditedParticipations.filter((item) => item.status !== "exited_zero");
  const duplicateAuditParticipations = new Set<string>();
  const participationsByWorker = new Map<string, SewingParticipation[]>();
  for (const item of nonZeroParticipations) {
    if (item.status !== "active" && item.status !== "completed") continue;
    const workerKey = item.workerProfileId ?? item.workerId;
    const workerParticipations = participationsByWorker.get(workerKey) ?? [];
    workerParticipations.push(item);
    participationsByWorker.set(workerKey, workerParticipations);
  }
  for (const workerParticipations of participationsByWorker.values()) {
    const completed = workerParticipations.filter((item) => item.status === "completed");
    if (completed.length > 0) {
      for (const item of workerParticipations) {
        if (item.id !== completed[0]?.id) duplicateAuditParticipations.add(item.id);
      }
      continue;
    }
    const active = workerParticipations.filter((item) => item.status === "active");
    for (const item of active.slice(0, -1)) duplicateAuditParticipations.add(item.id);
  }
  const participations = nonZeroParticipations.filter((item) => !duplicateAuditParticipations.has(item.id));
  const hiddenAuditScanRecordIds = auditedParticipations
    .filter((item) => item.status === "exited_zero")
    .concat(auditedParticipations.filter((item) => duplicateAuditParticipations.has(item.id)))
    .flatMap((item) => [item.startScanRecordId, item.completionScanRecordId])
    .filter((id): id is string => Boolean(id));
  const duplicateCompletionCount = auditedParticipations.filter(
    (item) => duplicateAuditParticipations.has(item.id) && Boolean(item.completionScanRecordId)
  ).length;
  const activeParticipations = participations.filter((item) => item.status === "active");
  const completedParticipations = participations.filter((item) => item.status === "completed");
  const effectiveParticipations = completedParticipations.filter(
    (item) => (item.completedPieces ?? 0) > 0
  );
  const currentParticipations = participations.filter(
    (item) => item.status === "active" || item.status === "completed"
  );
  const currentWorkerCount = new Set(
    currentParticipations.map((item) => item.workerProfileId ?? item.workerId)
  ).size;
  const mode: SewingMode = currentWorkerCount > 1 ? "collaboration" : "single";
  const plannedPieces = currentParticipations.reduce(
    (sum, item) => sum + (item.targetPieces ?? 0),
    0
  );
  const completedPieces = effectiveParticipations.reduce(
    (sum, item) => sum + (item.completedPieces ?? 0),
    0
  );
  const hasUnresolvedParticipation = activeParticipations.length > 0;
  const hasExplicitCollaborationHistory = auditedParticipations.some(
    (item) => item.collaborationJoin
  );
  const canResumeBeforeFirstQc =
    order.stage === ORDER_STAGES.qcDeliveryWaiting &&
    completedParticipations.length > 0;

  return {
    mode,
    participations,
    activeParticipations,
    effectiveParticipations,
    currentParticipations,
    // A completed pure-single order still uses the shared participation projection while it
    // waits for its first QC result. This exposes the approved "join collaboration" action
    // without routing the original single start/completion through collaborative writes.
    usesParticipationWorkflow: hasExplicitCollaborationHistory || canResumeBeforeFirstQc,
    hiddenAuditScanRecordIds,
    duplicateCompletionCount,
    plannedPieces,
    unallocatedPieces: Math.max(order.quantity - plannedPieces, 0),
    completedPieces,
    hasUnresolvedParticipation,
    sewingGateSatisfied:
      !hasUnresolvedParticipation &&
      completedParticipations.length > 0
  };
}

export function collaborativeSewingRoundStates(
  order: CollaborativeOrder,
  records: readonly SewingWorkflowRecord[]
): CollaborativeSewingState[] {
  // A QC rework result is a QC follow-up fact, not a new sewing round. The original sewing
  // participation history remains one permanently locked round after any formal QC result.
  return [collaborativeSewingRoundState(order, records)];
}

export function recordsInCurrentSewingRound<T extends Pick<
  ScanRecord,
  "id" | "stage" | "action" | "eventTime" | "qualityResult"
>>(records: readonly T[]): T[] {
  return records.slice().sort((left, right) => {
    const timeDifference = Date.parse(left.eventTime) - Date.parse(right.eventTime);
    return timeDifference !== 0 ? timeDifference : left.id.localeCompare(right.id);
  });
}

export function collaborativeSewingState(
  order: CollaborativeOrder,
  records: readonly SewingWorkflowRecord[]
): CollaborativeSewingState {
  return collaborativeSewingRoundStates(order, records).at(-1)
    ?? collaborativeSewingRoundState(order, []);
}

export function activeParticipationForWorker(
  state: Pick<CollaborativeSewingState, "activeParticipations">,
  workerProfileId: string
) {
  return state.activeParticipations
    .filter((item) => item.workerProfileId === workerProfileId)
    .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt))
    .at(-1);
}

export function primaryCurrentParticipation(state: CollaborativeSewingState) {
  return state.currentParticipations
    .slice()
    .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt))[0];
}

export function completedParticipationForWorker(
  state: Pick<CollaborativeSewingState, "currentParticipations">,
  workerProfileId: string
) {
  return state.currentParticipations.find(
    (item) => item.status === "completed" && item.workerProfileId === workerProfileId
  );
}

export function collaborativeSewingRevision(
  order: CollaborativeOrder & { terminated?: boolean },
  records: readonly SewingWorkflowRecord[]
) {
  const relevantLogs = order.correctionLogs
    .filter(
      (log) =>
        log.fieldName.startsWith(SEWING_PARTICIPATION_TARGET_PREFIX) ||
        log.fieldName.startsWith(SEWING_PARTICIPATION_CANCEL_PREFIX) ||
        log.fieldName.startsWith("process_pieces:")
    )
    .map((log) => [log.id, log.fieldName, log.newValue, log.changedAt]);
  const sewingRecords = records
    .filter((record) => record.stage === "sewing")
    .map((record) => [
      record.id,
      record.action,
      record.workerProfileId,
      record.workerId,
      record.eventTime,
      record.pieces,
      record.collaborationJoin,
      record.takeoverFromWorkerId
    ]);
  return createHash("sha256")
    .update(JSON.stringify([order.quantity, order.stage, order.terminated, sewingRecords, relevantLogs]))
    .digest("hex");
}

export function hasQcCompletion(
  records: readonly Pick<
    ScanRecord,
    "id" | "stage" | "action" | "eventTime" | "qualityResult"
  >[]
) {
  return recordsInCurrentSewingRound(records).some(
    (record) => record.stage === "qc_delivery" &&
      (record.action === "complete" || record.action === "termination_complete")
  );
}
