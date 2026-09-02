import { randomUUID } from "node:crypto";
import {
  nextOrderStageAfterPhysicalCompletion,
  ORDER_STAGES,
  ROLES
} from "@sample-room/shared";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import type {
  AccountRepository,
  OperationLogRepository
} from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import type { FileStorageAdapter } from "../files/fileStorageAdapter.js";
import { createLocalFileStorageAdapter } from "../files/localFileStorageAdapter.js";
import type { OrderCorrectionLogEntry, OrderRecord } from "../orders/orderTypes.js";
import {
  collaborativeSewingState,
  collaborativeSewingRevision,
  currentParticipationTarget,
  hasQcCompletion,
  sewingParticipationCancelFieldName,
  sewingParticipationTargetFieldName
} from "../scan/collaborativeSewing.js";
import { PlannerService } from "./plannerService.js";

function ensurePlannerCoordinator(currentUser: CurrentUser) {
  if (
    currentUser.role !== ROLES.planner &&
    currentUser.role !== ROLES.boss &&
    currentUser.role !== ROLES.systemOwner
  ) {
    throw new HttpError(403, "forbidden");
  }
}

function requireTargetPieces(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, "targetPieces must be a positive integer.");
  }
  return value;
}

function collaborationDto(
  state: ReturnType<typeof collaborativeSewingState> & { revision: string }
) {
  return {
    revision: state.revision,
    completedPieces: state.completedPieces,
    plannedPieces: state.plannedPieces,
    unallocatedPieces: state.unallocatedPieces,
    activeParticipantCount: new Set(
      state.activeParticipations.map((item) => item.workerProfileId ?? item.workerId)
    ).size,
    effectiveParticipantCount: new Set(
      state.effectiveParticipations.map((item) => item.workerProfileId ?? item.workerId)
    ).size,
    sewingGateSatisfied: state.sewingGateSatisfied,
    participants: state.participations.map((item) => ({
      id: item.id,
      ...(item.workerProfileId ? { workerProfileId: item.workerProfileId } : {}),
      workerName: item.workerName,
      joinedAt: item.joinedAt,
      ...(item.targetPieces !== undefined ? { targetPieces: item.targetPieces } : {}),
      status: item.status,
      ...(item.completedPieces !== undefined ? { completedPieces: item.completedPieces } : {}),
      ...(item.completedAt ? { completedAt: item.completedAt } : {}),
      ...(item.cancelledAt ? { cancelledAt: item.cancelledAt } : {})
    }))
  };
}

export class CollaborativePlannerService extends PlannerService {
  constructor(
    private readonly collaborationRepository: SampleRoomRepository,
    accounts: AccountRepository,
    fileStorage: FileStorageAdapter = createLocalFileStorageAdapter(),
    operationLogs?: OperationLogRepository
  ) {
    super(collaborationRepository, accounts, fileStorage, operationLogs);
  }

  private async requireOrder(orderId: string) {
    const order = await this.collaborationRepository.findOrderById(orderId);
    if (!order) throw new HttpError(404, "order not found.");
    if (order.terminated) throw new HttpError(409, "订单已终止");
    return order;
  }

  private async state(order: OrderRecord, repository = this.collaborationRepository) {
    const records = await repository.listScanRecordsByOrderId(order.id);
    return {
      ...collaborativeSewingState(order, records),
      revision: collaborativeSewingRevision(order, records)
    };
  }

  private appendLog(
    order: OrderRecord,
    currentUser: CurrentUser,
    fieldName: string,
    oldValue: string | number | null,
    newValue: string | number | null
  ): OrderCorrectionLogEntry[] {
    return [
      ...order.correctionLogs,
      {
        id: randomUUID(),
        changedAt: new Date().toISOString(),
        changedByRole: currentUser.role,
        changedByAccountId: currentUser.accountId ?? currentUser.id,
        ...(currentUser.displayName ? { changedByName: currentUser.displayName } : {}),
        fieldName,
        oldValue,
        newValue
      }
    ];
  }

  override async listOrders(currentUser: CurrentUser) {
    const rows = await super.listOrders(currentUser);
    return Promise.all(rows.map(async (row) => {
      const order = await this.collaborationRepository.findOrderById(row.id);
      if (!order) return row;
      const state = await this.state(order);
      const hiddenScanRecordIds = new Set(state.hiddenAuditScanRecordIds);
      const businessRow = {
        ...row,
        ...(row.scanRecords
          ? { scanRecords: row.scanRecords.filter((record) => !hiddenScanRecordIds.has(record.id)) }
          : {})
      };
      const sewingMode = state.mode;
      if (sewingMode !== "collaboration") {
        if (!state.usesParticipationWorkflow) {
          return { ...businessRow, sewingMode };
        }
        const soleActive = state.activeParticipations.length === 1
          ? state.activeParticipations[0]
          : undefined;
        return {
          ...businessRow,
          sewingMode,
          activeWorker: soleActive
            ? {
                stage: "sewing" as const,
                stageLabel: "缝制",
                workerName: soleActive.workerName,
                startedAt: soleActive.joinedAt
              }
            : undefined
        };
      }
      const firstActive = state.activeParticipations
        .slice()
        .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt))[0];
      return {
        ...businessRow,
        sewingMode,
        sewingCollaboration: collaborationDto(state),
        ...(firstActive
          ? {
              activeWorker: {
                stage: "sewing" as const,
                stageLabel: "缝制",
                workerName: "多人",
                startedAt: firstActive.joinedAt
              }
            }
          : {})
      };
    }));
  }

  async getSewingCollaboration(orderId: string, currentUser: CurrentUser) {
    ensurePlannerCoordinator(currentUser);
    const order = await this.requireOrder(orderId);
    const state = await this.state(order);
    if (state.mode !== "collaboration") throw new HttpError(409, "该订单当前不是多人协作。");
    return {
      orderId: order.id,
      quantity: order.quantity,
      sewingMode: "collaboration" as const,
      ...collaborationDto(state)
    };
  }

  async updateParticipationTarget(
    orderId: string,
    participationId: string,
    rawTargetPieces: unknown,
    expectedRevision: unknown,
    currentUser: CurrentUser
  ) {
    ensurePlannerCoordinator(currentUser);
    const targetPieces = requireTargetPieces(rawTargetPieces);
    if (typeof expectedRevision !== "string" || !expectedRevision) {
      throw new HttpError(400, "expectedRevision is required.");
    }
    return this.collaborationRepository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(orderId);
      const order = await repository.findOrderById(orderId);
      if (!order) throw new HttpError(404, "order not found.");
      if (order.terminated || order.stage === ORDER_STAGES.done) {
        throw new HttpError(409, "订单已结束，不能再调整协作任务。");
      }
      if (hasQcCompletion(await repository.listScanRecordsByOrderId(order.id))) {
        throw new HttpError(409, "该订单已提交正式组检结果，原缝制轮次已锁定。");
      }
      const state = await this.state(order, repository);
      if (state.revision !== expectedRevision) {
        throw new HttpError(409, "协作人员或分配已经变化，请刷新后重新确认。");
      }
      if (state.mode !== "collaboration") {
        throw new HttpError(409, "该订单当前不是多人协作。");
      }
      const participation = state.activeParticipations.find((item) => item.id === participationId);
      if (!participation) {
        throw new HttpError(409, "该员工当前已不在协作缝制中，不能再调整任务件数。");
      }
      const oldValue = currentParticipationTarget(order, participationId) ?? null;
      if (oldValue === targetPieces) return { orderId, participationId, targetPieces };
      await repository.updateOrder(order.id, {
        correctionLogs: this.appendLog(
          order,
          currentUser,
          sewingParticipationTargetFieldName(participationId),
          oldValue,
          targetPieces
        )
      });
      return { orderId, participationId, targetPieces };
    });
  }

  async updateParticipationTargets(
    orderId: string,
    rawUpdates: unknown,
    expectedRevision: unknown,
    currentUser: CurrentUser
  ) {
    ensurePlannerCoordinator(currentUser);
    if (!Array.isArray(rawUpdates) || rawUpdates.length === 0) {
      throw new HttpError(400, "updates must not be empty.");
    }
    const updates = rawUpdates.map((item) => {
      if (!item || typeof item !== "object") throw new HttpError(400, "invalid target update.");
      const value = item as { participationId?: unknown; targetPieces?: unknown };
      if (typeof value.participationId !== "string" || !value.participationId) {
        throw new HttpError(400, "participationId is required.");
      }
      return {
        participationId: value.participationId,
        targetPieces: requireTargetPieces(value.targetPieces)
      };
    });
    if (new Set(updates.map((item) => item.participationId)).size !== updates.length) {
      throw new HttpError(400, "participationId must be unique.");
    }
    if (typeof expectedRevision !== "string" || !expectedRevision) {
      throw new HttpError(400, "expectedRevision is required.");
    }

    return this.collaborationRepository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(orderId);
      const order = await repository.findOrderById(orderId);
      if (!order) throw new HttpError(404, "order not found.");
      if (order.terminated || order.stage === ORDER_STAGES.done) {
        throw new HttpError(409, "订单已结束，不能再调整协作任务。");
      }
      if (hasQcCompletion(await repository.listScanRecordsByOrderId(order.id))) {
        throw new HttpError(409, "该订单已提交正式组检结果，原缝制轮次已锁定。");
      }
      const state = await this.state(order, repository);
      if (state.mode !== "collaboration") throw new HttpError(409, "该订单当前不是多人协作。");
      if (state.revision !== expectedRevision) {
        throw new HttpError(409, "协作人员或分配已经变化，请刷新后重新确认。");
      }
      const activeIds = new Set(state.activeParticipations.map((item) => item.id));
      if (updates.some((item) => !activeIds.has(item.participationId))) {
        throw new HttpError(409, "协作人员已经变化，请刷新后重新确认。");
      }
      const changedAt = new Date().toISOString();
      const logs = [...order.correctionLogs];
      for (const update of updates) {
        const oldValue = currentParticipationTarget(order, update.participationId) ?? null;
        if (oldValue === update.targetPieces) continue;
        logs.push({
          id: randomUUID(),
          changedAt,
          changedByRole: currentUser.role,
          changedByAccountId: currentUser.accountId ?? currentUser.id,
          ...(currentUser.displayName ? { changedByName: currentUser.displayName } : {}),
          fieldName: sewingParticipationTargetFieldName(update.participationId),
          oldValue,
          newValue: update.targetPieces
        });
      }
      const updatedOrder = logs.length === order.correctionLogs.length
        ? order
        : await repository.updateOrder(order.id, { correctionLogs: logs });
      const nextState = await this.state(updatedOrder, repository);
      return {
        orderId: updatedOrder.id,
        quantity: updatedOrder.quantity,
        sewingMode: nextState.mode,
        ...collaborationDto(nextState)
      };
    });
  }

  async cancelParticipation(
    orderId: string,
    participationId: string,
    expectedRevision: unknown,
    currentUser: CurrentUser
  ) {
    ensurePlannerCoordinator(currentUser);
    if (typeof expectedRevision !== "string" || !expectedRevision) {
      throw new HttpError(400, "expectedRevision is required.");
    }
    return this.collaborationRepository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(orderId);
      const order = await repository.findOrderById(orderId);
      if (!order) throw new HttpError(404, "order not found.");
      if (order.terminated || order.stage === ORDER_STAGES.done) {
        throw new HttpError(409, "订单已结束，不能取消协作参与。");
      }
      if (hasQcCompletion(await repository.listScanRecordsByOrderId(order.id))) {
        throw new HttpError(409, "该订单已提交正式组检结果，原缝制轮次已锁定。");
      }
      const state = await this.state(order, repository);
      if (state.revision !== expectedRevision) {
        throw new HttpError(409, "协作人员或分配已经变化，请刷新后重新确认。");
      }
      if (state.mode !== "collaboration") {
        throw new HttpError(409, "该订单当前不是多人协作。");
      }
      const participation = state.activeParticipations.find((item) => item.id === participationId);
      if (!participation) {
        throw new HttpError(409, "该员工已经提交完成或参与状态已经变化，不能再取消参与。请刷新后查看最新状态。");
      }
      const updated = await repository.updateOrder(order.id, {
        correctionLogs: this.appendLog(
          order,
          currentUser,
          sewingParticipationCancelFieldName(participationId),
          "active",
          "cancelled"
        )
      });
      const nextState = await this.state(updated, repository);
      const nextStage = nextState.sewingGateSatisfied
        ? nextOrderStageAfterPhysicalCompletion(updated.sampleRequestItems, "sewing")
        : nextState.activeParticipations.length > 0
          ? ORDER_STAGES.sewingDoing
          : ORDER_STAGES.sewingWaiting;
      if (updated.stage !== nextStage) {
        await repository.updateOrder(updated.id, { stage: nextStage });
      }
      return {
        orderId,
        quantity: updated.quantity,
        participationId,
        status: "cancelled" as const,
        sewingMode: nextState.mode,
        ...collaborationDto(nextState)
      };
    });
  }

}
