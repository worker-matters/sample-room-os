import {
  nextOrderStageAfterPhysicalCompletion,
  ORDER_STAGES,
  physicalProductionRoute,
  ROLES,
  type OrderStage
} from "@sample-room/shared";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import type {
  AccountRepository,
  WorkerProfileRepository
} from "../../db/repositories/contracts/index.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import type { FileStorageAdapter } from "../files/fileStorageAdapter.js";
import { createLocalFileStorageAdapter } from "../files/localFileStorageAdapter.js";
import type { OrderRecord } from "../orders/orderTypes.js";
import {
  activeParticipationForWorker,
  completedParticipationForWorker,
  collaborativeSewingRevision,
  collaborativeSewingState,
  hasQcCompletion,
  sewingParticipationTargetFieldName
} from "./collaborativeSewing.js";
import { ScanActorResolver } from "./scanActor.js";
import { ScanWorkflowService, type CompleteScanPayload } from "./scanService.js";
import type {
  ScanPageState,
  ScanRecord,
  SewingTaskListItem
} from "./scanTypes.js";

function requireWorkHours(value: unknown) {
  const parsed = typeof value === "string" && value.trim().length > 0 ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, "workHours is required.");
  }
  return parsed;
}

function requireCollaborationPieces(value: unknown) {
  const parsed = typeof value === "string" && value.trim().length > 0 ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, "缝制实际件数必须大于 0。");
  }
  return parsed;
}

function currentWorkerIds(state: ReturnType<typeof collaborativeSewingState>) {
  return [...new Set(state.currentParticipations.map((item) => item.workerProfileId ?? item.workerId))]
    .sort();
}

function requiredRevision(value: unknown) {
  if (typeof value !== "string" || !value) {
    throw new HttpError(400, "expectedCollaborationRevision is required.");
  }
  return value;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function recordTime(record: ScanRecord) {
  return Date.parse(record.eventTime);
}

function hasOpenSingleSewingTask(records: ScanRecord[], workerProfileId: string) {
  const sewing = records
    .filter((record) => record.stage === "sewing")
    .sort((left, right) => recordTime(left) - recordTime(right));
  const lastStart = sewing.filter((record) => record.action === "start").at(-1);
  if (!lastStart || lastStart.workerProfileId !== workerProfileId) return false;
  return !sewing.some(
    (record) =>
      (record.action === "complete" || record.action === "termination_complete") &&
      recordTime(record) >= recordTime(lastStart)
  );
}

export class CollaborativeScanWorkflowService extends ScanWorkflowService {
  private readonly collaborationActors: ScanActorResolver;

  constructor(
    private readonly collaborationRepository: SampleRoomRepository,
    private readonly collaborationAccounts: AccountRepository,
    private readonly collaborationWorkerProfiles: WorkerProfileRepository,
    fileStorage: FileStorageAdapter = createLocalFileStorageAdapter(),
    env: NodeJS.ProcessEnv = process.env
  ) {
    super(
      collaborationRepository,
      collaborationAccounts,
      collaborationWorkerProfiles,
      fileStorage,
      env
    );
    this.collaborationActors = new ScanActorResolver(
      collaborationAccounts,
      collaborationWorkerProfiles
    );
  }

  private async requireTokenOrder(token: string, repository = this.collaborationRepository) {
    const scanToken = await repository.findOrderScanToken(token);
    const expiryTime = scanToken?.expiresAt ? Date.parse(scanToken.expiresAt) : undefined;
    if (
      !scanToken ||
      scanToken.revokedAt ||
      (expiryTime !== undefined && (!Number.isFinite(expiryTime) || expiryTime <= Date.now()))
    ) {
      throw new HttpError(404, "scan token not found.");
    }
    const order = await repository.findOrderById(scanToken.orderId);
    if (!order) throw new HttpError(404, "order not found.");
    return { scanToken, order };
  }

  private async collaborationState(order: OrderRecord, repository = this.collaborationRepository) {
    const records = await repository.listScanRecordsByOrderId(order.id);
    return {
      ...collaborativeSewingState(order, records),
      revision: collaborativeSewingRevision(order, records)
    };
  }

  private async activeTaskOrderIds(
    workerProfileId: string,
    repository = this.collaborationRepository
  ) {
    const ids = new Set<string>();
    for (const order of await repository.listOrders()) {
      if (order.terminated) continue;
      const records = await repository.listScanRecordsByOrderId(order.id);
      const state = collaborativeSewingState(order, records);
      if (state.usesParticipationWorkflow) {
        if (activeParticipationForWorker(state, workerProfileId)) ids.add(order.id);
      } else if (hasOpenSingleSewingTask(records, workerProfileId)) {
        ids.add(order.id);
      }
    }
    return ids;
  }

  private collaborationPresentation(
    base: ScanPageState,
    order: OrderRecord,
    workerProfileId: string,
    state: ReturnType<typeof collaborativeSewingState> & { revision: string }
  ): ScanPageState {
    const participation = activeParticipationForWorker(state, workerProfileId);
    const completedParticipation = completedParticipationForWorker(state, workerProfileId);
    const soleCurrent = state.currentParticipations.length === 1
      ? state.currentParticipations[0]
      : undefined;
    const collaboration = {
      ...(participation ? { participationId: participation.id } : {}),
      completedPieces: state.completedPieces,
      orderQuantity: order.quantity,
      activeParticipantCount: new Set(
        state.activeParticipations.map((item) => item.workerProfileId ?? item.workerId)
      ).size,
      currentParticipantCount: currentWorkerIds(state).length,
      plannedPieces: state.plannedPieces,
      unallocatedPieces: state.unallocatedPieces,
      revision: state.revision,
      expectedActiveWorkerIds: currentWorkerIds(state)
    };

    if (participation) {
      return {
        ...base,
        allowedAction: "complete",
        message: state.mode === "collaboration"
          ? "多人协作：请按你的实际完成数量提交。"
          : "当前由你单人负责缝制，请按实际交货数量提交。",
        blockedReason: undefined,
        stage: "sewing",
        stageLabel: "缝制",
        startedByCurrentWorker: true,
        defaultPieces: base.defaultPieces,
        activeTask: undefined,
        collaboration
      };
    }

    if (completedParticipation) {
      return {
        ...base,
        allowedAction: "blocked",
        message: "你已完成本轮缝制。本轮成果已经提交，订单正在等待组检，不能重复加入或再次提交。",
        blockedReason: "SEWING_ROUND_ALREADY_COMPLETED",
        stage: "sewing",
        stageLabel: "缝制",
        startedByCurrentWorker: true,
        activeTask: undefined,
        collaboration
      };
    }

    const canReplaceSoleParticipant = soleCurrent?.status === "active";
    return {
      ...base,
      allowedAction: canReplaceSoleParticipant
        ? "choose_sewing_assignment"
        : "join_collaboration",
      message: canReplaceSoleParticipant
        ? "该订单已有一名缝制员工，请选择替代原负责人或加入协作。"
        : state.currentParticipations.length > 1
          ? "该订单正在多人协作，确认后即可加入。"
          : "该订单等待组检且尚未提交组检结果，确认后即可加入协作。",
      blockedReason: undefined,
      stage: "sewing",
      stageLabel: "缝制",
      startedByCurrentWorker: false,
      ...(canReplaceSoleParticipant && soleCurrent
        ? {
            activeTask: {
              stage: "sewing" as const,
              stageLabel: "缝制",
              workerId: soleCurrent.workerId,
              workerName: soleCurrent.workerName,
              startedAt: soleCurrent.joinedAt
            }
          }
        : base.activeTask ? { activeTask: base.activeTask } : {}),
      collaboration
    };
  }

  override async getScanState(token: string, currentUser: CurrentUser): Promise<ScanPageState> {
    const base = await super.getScanState(token, currentUser);
    const { order } = await this.requireTokenOrder(token);
    if (
      order.stage !== ORDER_STAGES.sewingWaiting &&
      order.stage !== ORDER_STAGES.sewingDoing &&
      order.stage !== ORDER_STAGES.qcDeliveryWaiting
    ) {
      return base;
    }

    const actor = await this.collaborationActors.requireWorkerActor(currentUser);
    if (actor.workerProfile.workerType !== "sewing") return base;
    const state = await this.collaborationState(order);
    if (order.stage === ORDER_STAGES.qcDeliveryWaiting && state.usesParticipationWorkflow) {
      const records = await this.collaborationRepository.listScanRecordsByOrderId(order.id);
      return hasQcCompletion(records)
        ? base
        : this.collaborationPresentation(base, order, actor.workerProfile.id, state);
    }
    if (
      base.allowedAction === "blocked" &&
      (!state.usesParticipationWorkflow ||
        (base.blockedReason !== "other_worker_started" && base.blockedReason !== "not_scannable"))
    ) {
      return base;
    }
    if (state.usesParticipationWorkflow) {
      return this.collaborationPresentation(base, order, actor.workerProfile.id, state);
    }
    if (base.allowedAction === "takeover" && state.currentParticipations.length === 1) {
      return this.collaborationPresentation(base, order, actor.workerProfile.id, state);
    }
    return base;
  }

  override async startScan(token: string, currentUser: CurrentUser): Promise<ScanPageState> {
    return super.startScan(token, currentUser);
  }

  override async authorizeCompletionUpload(token: string, currentUser: CurrentUser): Promise<void> {
    const { order } = await this.requireTokenOrder(token);
    if (order.terminated) throw new HttpError(409, "订单已终止");
    const actor = await this.collaborationActors.requireWorkerActor(currentUser);
    if (actor.workerProfile.workerType === "sewing") {
      const state = await this.collaborationState(order);
      if (state.usesParticipationWorkflow) {
        if (!activeParticipationForWorker(state, actor.workerProfile.id)) {
          if (completedParticipationForWorker(state, actor.workerProfile.id)) {
            throw new HttpError(409, "本轮缝制已经提交完成，请勿重复提交。");
          }
          const cancelledParticipation = state.participations.some(
            (item) => item.workerProfileId === actor.workerProfile.id && item.status === "cancelled"
          );
          if (cancelledParticipation) {
            throw new HttpError(409, "该参与已被计划员取消，请返回任务列表。");
          }
          throw new HttpError(409, "当前没有可提交的协作缝制任务，请重新扫码接单。");
        }
        return;
      }
    }
    return super.authorizeCompletionUpload(token, currentUser);
  }

  async joinCollaborativeSewing(
    token: string,
    currentUser: CurrentUser,
    payload: {
      targetPieces?: unknown;
      expectedActiveWorkerIds?: unknown;
      expectedCollaborationRevision?: unknown;
    }
  ): Promise<ScanPageState> {
    const expectedRevision = requiredRevision(payload.expectedCollaborationRevision);
    const { order } = await this.requireTokenOrder(token);
    const actor = await this.collaborationActors.requireWorkerActor(currentUser);
    if (actor.workerProfile.workerType !== "sewing") {
      throw new HttpError(403, "只有缝制员工可以加入协作。");
    }

    await this.collaborationRepository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(order.id);
      await repository.lockWorkerForWorkflow(actor.workerProfile.id);
      const { order: latestOrder } = await this.requireTokenOrder(token, repository);
      if (latestOrder.terminated) throw new HttpError(409, "订单已终止");
      if (
        latestOrder.stage !== ORDER_STAGES.sewingWaiting &&
        latestOrder.stage !== ORDER_STAGES.sewingDoing &&
        latestOrder.stage !== ORDER_STAGES.qcDeliveryWaiting
      ) {
        throw new HttpError(409, "该订单当前不能加入协作缝制。");
      }

      const latestRecords = await repository.listScanRecordsByOrderId(latestOrder.id);
      if (hasQcCompletion(latestRecords)) {
        throw new HttpError(409, "该订单已提交正式组检结果，原缝制轮次已锁定。");
      }

      const current = await this.collaborationState(latestOrder, repository);
      if (current.revision !== expectedRevision) {
        throw new HttpError(409, "协作人员或分配已经变化，请刷新后重新确认。");
      }
      if (current.currentParticipations.length === 0) {
        throw new HttpError(409, "当前没有可协作的缝制负责人，请重新扫码接单。");
      }
      if (activeParticipationForWorker(current, actor.workerProfile.id)) {
        throw new HttpError(409, "你已经参与该订单，无需重复扫码接单。");
      }
      if (completedParticipationForWorker(current, actor.workerProfile.id)) {
        throw new HttpError(409, "你已完成本轮缝制，不能重复加入。");
      }
      if ((await this.activeTaskOrderIds(actor.workerProfile.id, repository)).size >= 3) {
        throw new HttpError(409, "当前已超过最大接单数量");
      }

      await repository.createScanRecord({
        orderId: latestOrder.id,
        actorAccountId: actor.account.id,
        workerProfileId: actor.workerProfile.id,
        actorType: "production_worker",
        actorRole: ROLES.worker,
        stage: "sewing",
        orderStage: ORDER_STAGES.sewingDoing,
        action: "start",
        scanAction: "sewing_start",
        workerId: actor.worker.id,
        workerName: actor.worker.name,
        collaborationJoin: true,
        note: "加入多人协作缝制"
      });
      await repository.updateOrder(latestOrder.id, {
        stage: ORDER_STAGES.sewingDoing
      });
    });

    return this.getScanState(token, currentUser);
  }

  override async takeoverSewing(
    token: string,
    currentUser: CurrentUser,
    payload: { reason?: unknown; expectedActiveWorkerId?: unknown }
  ): Promise<ScanPageState> {
    const { order } = await this.requireTokenOrder(token);
    const initial = await this.collaborationState(order);
    if (!initial.usesParticipationWorkflow) {
      return super.takeoverSewing(token, currentUser, payload);
    }
    const reason = optionalText(payload.reason);
    const expectedActiveWorkerId = optionalText(payload.expectedActiveWorkerId);
    if (!reason || !expectedActiveWorkerId) {
      throw new HttpError(400, "接替原因和当前负责人不能为空。");
    }
    const actor = await this.collaborationActors.requireWorkerActor(currentUser);
    if (actor.workerProfile.workerType !== "sewing") throw new HttpError(403, "forbidden");

    await this.collaborationRepository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(order.id);
      await repository.lockWorkerForWorkflow(actor.workerProfile.id);
      const { order: latestOrder } = await this.requireTokenOrder(token, repository);
      if (latestOrder.terminated) throw new HttpError(409, "订单已终止");
      if (
        !physicalProductionRoute(latestOrder.sampleRequestItems).includes("sewing") ||
        (latestOrder.stage !== ORDER_STAGES.sewingDoing &&
          latestOrder.stage !== ORDER_STAGES.sewingWaiting)
      ) {
        throw new HttpError(409, "该订单当前不能接替缝制任务。");
      }
      const current = await this.collaborationState(latestOrder, repository);
      if (completedParticipationForWorker(current, actor.workerProfile.id)) {
        throw new HttpError(409, "你已完成本轮缝制，不能重复加入。");
      }
      const sole = current.currentParticipations.length === 1
        ? current.currentParticipations[0]
        : undefined;
      if (!sole || sole.workerId !== expectedActiveWorkerId || sole.status !== "active") {
        throw new HttpError(409, "缝制参与人员已经变化，请刷新后重新确认。");
      }
      if ((await this.activeTaskOrderIds(actor.workerProfile.id, repository)).size >= 3) {
        throw new HttpError(409, "当前已超过最大接单数量");
      }
      const replacement = await repository.createScanRecord({
        orderId: latestOrder.id,
        actorAccountId: actor.account.id,
        workerProfileId: actor.workerProfile.id,
        actorType: "production_worker",
        actorRole: ROLES.worker,
        stage: "sewing",
        orderStage: ORDER_STAGES.sewingDoing,
        action: "start",
        scanAction: "sewing_start",
        workerId: actor.worker.id,
        workerName: actor.worker.name,
        note: `替换缝制负责人：${reason}`,
        takeoverFromWorkerId: sole.workerId,
        takeoverFromWorkerName: sole.workerName,
        takeoverReason: reason
      });
      const logs = [...latestOrder.correctionLogs];
      if (sole.targetPieces !== undefined) {
        logs.push({
          id: randomUUID(),
          changedAt: new Date().toISOString(),
          changedByRole: ROLES.worker,
          changedByAccountId: actor.account.id,
          changedByName: actor.worker.name,
          fieldName: sewingParticipationTargetFieldName(replacement.id),
          oldValue: null,
          newValue: sole.targetPieces
        });
      }
      await repository.updateOrder(latestOrder.id, {
        stage: ORDER_STAGES.sewingDoing,
        correctionLogs: logs
      });
    });
    return this.getScanState(token, currentUser);
  }

  override async completeScan(
    token: string,
    currentUser: CurrentUser,
    payload: CompleteScanPayload
  ): Promise<ScanPageState> {
    const { order } = await this.requireTokenOrder(token);
    const actor = await this.collaborationActors.requireWorkerActor(currentUser);

    if (actor.workerProfile.workerType === "sewing" && payload.pieces !== undefined) {
      const parsed = typeof payload.pieces === "string" && payload.pieces.trim().length > 0
        ? Number(payload.pieces)
        : payload.pieces;
      const state = await this.collaborationState(order);
      if (state.mode === "single" && typeof parsed === "number" && parsed === 0) {
        throw new HttpError(400, "单人订单交货数量必须大于 0。");
      }
    }

    const initialState = await this.collaborationState(order);
    if (!initialState.usesParticipationWorkflow || actor.workerProfile.workerType !== "sewing") {
      return super.completeScan(token, currentUser, payload);
    }

    const workHours = requireWorkHours(payload.workHours);
    const pieces = requireCollaborationPieces(payload.pieces);
    const note = optionalText(payload.note);
    const expectedParticipationId = optionalText(payload.expectedParticipationId);
    const expectedRevision = requiredRevision(payload.expectedCollaborationRevision);
    if (!expectedParticipationId) {
      throw new HttpError(400, "expectedParticipationId is required.");
    }

    await this.collaborationRepository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(order.id);
      await repository.lockWorkerForWorkflow(actor.workerProfile.id);
      const { order: latestOrder } = await this.requireTokenOrder(token, repository);
      if (latestOrder.terminated) throw new HttpError(409, "订单已终止");
      const current = await this.collaborationState(latestOrder, repository);
      const completedParticipation = completedParticipationForWorker(current, actor.workerProfile.id);
      if (completedParticipation) {
        throw new HttpError(409, "本轮缝制已经提交完成，请勿重复提交。");
      }
      if (
        !physicalProductionRoute(latestOrder.sampleRequestItems).includes("sewing") ||
        (latestOrder.stage !== ORDER_STAGES.sewingDoing &&
          latestOrder.stage !== ORDER_STAGES.sewingWaiting)
      ) {
        throw new HttpError(409, "该订单当前不能提交协作缝制结果。");
      }
      const participation = activeParticipationForWorker(current, actor.workerProfile.id);
      const expectedParticipation = current.participations.find((item) => item.id === expectedParticipationId);
      if (!participation && expectedParticipation?.status === "cancelled") {
        throw new HttpError(409, "该参与已被计划员取消，请返回任务列表。");
      }
      if (
        !participation ||
        participation.id !== expectedParticipationId ||
        current.revision !== expectedRevision
      ) {
        throw new HttpError(409, "当前协作任务已经变化，请刷新后重新确认。");
      }

      const eventStage: OrderStage = latestOrder.stage ?? ORDER_STAGES.sewingDoing;
      await repository.createScanRecord({
        orderId: latestOrder.id,
        actorAccountId: actor.account.id,
        workerProfileId: actor.workerProfile.id,
        actorType: "production_worker",
        actorRole: ROLES.worker,
        stage: "sewing",
        orderStage: eventStage,
        action: "complete",
        scanAction: "sewing_finish",
        workerId: actor.worker.id,
        workerName: actor.worker.name,
        workHours,
        pieces,
        note
      });

      const nextState = await this.collaborationState(latestOrder, repository);
      const nextStage = nextState.sewingGateSatisfied
        ? nextOrderStageAfterPhysicalCompletion(latestOrder.sampleRequestItems, "sewing")
        : nextState.activeParticipations.length > 0
          ? ORDER_STAGES.sewingDoing
          : ORDER_STAGES.sewingWaiting;
      await repository.updateOrder(latestOrder.id, { stage: nextStage });
    });

    return this.getScanState(token, currentUser);
  }

  override async listOwnSewingTasks(currentUser: CurrentUser): Promise<SewingTaskListItem[]> {
    const actor = await this.collaborationActors.requireWorkerActor(currentUser);
    if (actor.workerProfile.workerType !== "sewing") {
      return super.listOwnSewingTasks(currentUser);
    }

    const base = await super.listOwnSewingTasks(currentUser);
    const byOrderId = new Map(base.map((item) => [item.orderId, item]));

    for (const order of await this.collaborationRepository.listOrders()) {
      if (order.terminated) continue;
      const records = await this.collaborationRepository.listScanRecordsByOrderId(order.id);
      const state = await this.collaborationState(order);
      if (!state.usesParticipationWorkflow) continue;
      const participation = activeParticipationForWorker(state, actor.workerProfile.id);
      if (!participation) {
        byOrderId.delete(order.id);
        continue;
      }
      const previousReworkReason = records
        .filter(
          (record) =>
            record.stage === "qc_delivery" &&
            record.action === "complete" &&
            record.qualityResult === "rework" &&
            Boolean(record.note)
        )
        .sort((left, right) => left.eventTime.localeCompare(right.eventTime))
        .at(-1)?.note;
      byOrderId.set(order.id, {
        orderId: order.id,
        styleNo: order.styleNo,
        styleName: order.styleName,
        sampleType: order.sampleType,
        sampleRound: order.sampleRound,
        quantity: order.quantity,
        startedAt: participation.joinedAt,
        thumbnailUrl: `/api/miniapp/me/sewing-tasks/${encodeURIComponent(order.id)}/thumbnail`,
        collaboration: state.mode === "collaboration",
        participationId: participation.id,
        collaborationRevision: state.revision,
        ...(previousReworkReason ? { previousReworkReason } : {})
      });
    }

    return [...byOrderId.values()].sort((left, right) =>
      right.startedAt.localeCompare(left.startedAt)
    );
  }

  override async getOwnSewingTaskState(
    orderId: string,
    currentUser: CurrentUser
  ): Promise<ScanPageState> {
    const order = await this.collaborationRepository.findOrderById(orderId);
    if (!order) {
      return super.getOwnSewingTaskState(orderId, currentUser);
    }
    const actor = await this.collaborationActors.requireWorkerActor(currentUser);
    const state = await this.collaborationState(order);
    if (!state.usesParticipationWorkflow) {
      return super.getOwnSewingTaskState(orderId, currentUser);
    }
    if (!activeParticipationForWorker(state, actor.workerProfile.id)) {
      throw new HttpError(403, "SEWING_TASK_NOT_OWNED");
    }
    const token = (await this.collaborationRepository.listOrderScanTokensByOrderId(order.id))
      .filter((item) => !item.revokedAt && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (!token) throw new HttpError(404, "scan token not found.");
    return this.getScanState(token.token, currentUser);
  }

  override async getOwnSewingTaskThumbnail(orderId: string, currentUser: CurrentUser) {
    const order = await this.collaborationRepository.findOrderById(orderId);
    if (!order) {
      return super.getOwnSewingTaskThumbnail(orderId, currentUser);
    }
    const actor = await this.collaborationActors.requireWorkerActor(currentUser);
    const state = await this.collaborationState(order);
    if (!state.usesParticipationWorkflow) {
      return super.getOwnSewingTaskThumbnail(orderId, currentUser);
    }
    if (!activeParticipationForWorker(state, actor.workerProfile.id)) {
      throw new HttpError(403, "SEWING_TASK_NOT_OWNED");
    }
    const token = (await this.collaborationRepository.listOrderScanTokensByOrderId(order.id))
      .filter((item) => !item.revokedAt && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (!token) throw new HttpError(404, "scan token not found.");
    return super.getPublicThumbnail(token.token);
  }

  override async completeOwnSewingTask(
    orderId: string,
    currentUser: CurrentUser,
    payload: CompleteScanPayload
  ): Promise<ScanPageState> {
    const order = await this.collaborationRepository.findOrderById(orderId);
    if (!order) {
      return super.completeOwnSewingTask(orderId, currentUser, payload);
    }
    const actor = await this.collaborationActors.requireWorkerActor(currentUser);
    const state = await this.collaborationState(order);
    if (!state.usesParticipationWorkflow) {
      return super.completeOwnSewingTask(orderId, currentUser, payload);
    }
    if (!activeParticipationForWorker(state, actor.workerProfile.id)) {
      throw new HttpError(403, "SEWING_TASK_NOT_OWNED");
    }
    const token = (await this.collaborationRepository.listOrderScanTokensByOrderId(order.id))
      .filter((item) => !item.revokedAt && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (!token) throw new HttpError(404, "scan token not found.");
    return this.completeScan(token.token, currentUser, payload);
  }
}
import { randomUUID } from "node:crypto";
