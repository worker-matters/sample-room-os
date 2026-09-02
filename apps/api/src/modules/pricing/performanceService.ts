import { randomUUID } from "node:crypto";
import {
  ORDER_STAGES,
  ROLES,
  type Role,
  type WorkerType
} from "@sample-room/shared";
import type {
  AccountRecord,
  AccountRepository,
  WorkerProfileRecord,
  WorkerProfileRepository
} from "../../db/repositories/contracts/index.js";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import type { OrderRecord } from "../orders/orderTypes.js";
import {
  collaborativeSewingRoundStates,
  collaborativeSewingState
} from "../scan/collaborativeSewing.js";
import {
  effectiveProcessPieces,
  isCorrectableProcessRecord,
  processPiecesCorrectionFieldName,
  processPiecesCorrections
} from "../scan/processPiecesCorrections.js";
import type { ScanRecord } from "../scan/scanTypes.js";
import type {
  PerformanceAnomaly,
  PerformanceEmployeeRow,
  PerformanceOrderRow,
  PerformanceQuery,
  PerformanceRoleSummary,
  PerformanceStage
} from "./performanceTypes.js";
import { summarizePricing } from "./pricingCalculationService.js";

function isFormalCompletion(record: ScanRecord) {
  return record.action === "complete" ||
    (record.action === "termination_complete" &&
      (record.terminationSettlementStatus === "accepted" ||
        record.terminationSettlementStatus === undefined));
}

function requireProcessPieces(value: unknown) {
  const parsed = typeof value === "string" && value.trim().length > 0 ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, "pieces must be a non-negative integer.");
  }
  return parsed;
}

function timeBoundary(value: string | undefined, end: boolean) {
  if (!value) return undefined;
  const timestamp = Date.parse(
    value.includes("T") ? value : `${value}T${end ? "23:59:59.999" : "00:00:00.000"}+08:00`
  );
  if (!Number.isFinite(timestamp)) {
    throw new HttpError(400, `${end ? "dateTo" : "dateFrom"} must be a valid date.`);
  }
  return timestamp;
}

function inRange(value: string | undefined, from: number | undefined, to: number | undefined) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) &&
    (from === undefined || timestamp >= from) &&
    (to === undefined || timestamp <= to);
}

function completions(records: readonly ScanRecord[], stage: ScanRecord["stage"]) {
  return records
    .filter((record) => record.stage === stage && isFormalCompletion(record))
    .sort((left, right) => left.eventTime.localeCompare(right.eventTime));
}

function normalQcCompletions(records: readonly ScanRecord[]) {
  return records
    .filter((record) => record.stage === "qc_delivery" && record.action === "complete")
    .sort((left, right) => left.eventTime.localeCompare(right.eventTime));
}

function average(total: number, count: number) {
  return count > 0 ? total / count : 0;
}

function nullableAverage(total: number, count: number) {
  return count > 0 ? total / count : null;
}

function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) throw new HttpError(400, "month must use YYYY-MM.");
  const year = Number(match[1]);
  return {
    from: Date.parse(`${year}-${String(month).padStart(2, "0")}-01T00:00:00.000+08:00`),
    to: Date.parse(
      `${new Date(year, month, 0).toLocaleDateString("sv-SE")}T23:59:59.999+08:00`
    )
  };
}

function matchesQuery(order: OrderRecord, query: string) {
  if (!query) return true;
  return [order.orderNo, order.folderCode, order.styleNo, order.styleName, order.customerName, order.salespersonName]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function collaborationStyleName(order: OrderRecord, collaborative: boolean) {
  return collaborative ? `${order.styleName}（协作订单）` : order.styleName;
}

type MutableEmployeeRow = PerformanceEmployeeRow & {
  qualityScoreTotal?: number;
  qualityScoreCount?: number;
  qcReviewedOrders?: number;
  reworkOrders?: number;
};

type PerformanceIdentity = {
  subjectId: string;
  accountId: string;
  role: Role;
  employeeName: string;
  account?: AccountRecord | undefined;
  workerProfile?: WorkerProfileRecord | undefined;
  workerProfileId?: string | undefined;
  workerType?: WorkerType | undefined;
};

export class PerformanceService {
  constructor(
    private readonly repository: SampleRoomRepository,
    private readonly accounts: AccountRepository,
    private readonly workerProfiles: WorkerProfileRepository
  ) {}

  async getReport(options: PerformanceQuery, currentUser: CurrentUser) {
    if (currentUser.role !== ROLES.boss && currentUser.role !== ROLES.systemOwner) {
      throw new HttpError(403, "forbidden");
    }
    return this.buildReport(options);
  }

  async correctProcessPieces(
    orderId: string,
    scanRecordId: string,
    rawPieces: unknown,
    currentUser: CurrentUser,
    rawReason?: unknown
  ) {
    const pieces = requireProcessPieces(rawPieces);
    const manager = currentUser.role === ROLES.boss || currentUser.role === ROLES.systemOwner;
    if (!manager) throw new HttpError(403, "只有老板或 System Owner 可以纠正绩效件数。");
    const reason = typeof rawReason === "string" ? rawReason.trim() : "";
    if (!reason) throw new HttpError(400, "修改原因不能为空。");

    return this.repository.withTransaction(async (repository) => {
      await repository.lockOrderForWorkflow(orderId);
      let order = await repository.findOrderById(orderId);
      if (!order) throw new HttpError(404, "order not found.");
      const records = await repository.listScanRecordsByOrderId(orderId);
      const record = records.find((candidate) => candidate.id === scanRecordId);
      if (!record || !isCorrectableProcessRecord(record)) {
        throw new HttpError(404, "process completion record not found.");
      }

      const previousPieces = effectiveProcessPieces(order, record);
      if (previousPieces === undefined) {
        throw new HttpError(409, "当前完工记录没有可修正的件数。");
      }
      if (previousPieces === pieces) {
        throw new HttpError(409, "件数没有发生变化。");
      }

      const changedAt = new Date().toISOString();
      const log = {
        id: randomUUID(),
        changedAt,
        changedByRole: currentUser.role,
        changedByAccountId: currentUser.accountId ?? currentUser.id,
        ...(currentUser.displayName ? { changedByName: currentUser.displayName } : {}),
        fieldName: processPiecesCorrectionFieldName(record.stage, record.id),
        oldValue: previousPieces,
        newValue: pieces,
        reason
      };
      order = await repository.updateOrder(order.id, {
        correctionLogs: [...order.correctionLogs, log]
      });

      return {
        orderId: order.id,
        scanRecordId: record.id,
        stage: record.stage,
        previousPieces,
        pieces,
        reason,
        changedAt,
        changedByRole: currentUser.role,
        changedByAccountId: currentUser.accountId ?? currentUser.id,
        ...(currentUser.displayName ? { changedByName: currentUser.displayName } : {})
      };
    });
  }

  async getOwnWorkerReport(options: PerformanceQuery, currentUser: CurrentUser) {
    if (
      currentUser.role !== ROLES.worker ||
      !currentUser.activeWorkerProfileId ||
      !currentUser.activeWorkerType
    ) {
      throw new HttpError(403, "worker_miniapp_identity_required");
    }
    const workerProfileId = currentUser.activeWorkerProfileId;
    const workerType = currentUser.activeWorkerType;
    const report = await this.buildReport({
      ...(options.month ? { month: options.month } : {}),
      ...(options.dateFrom ? { dateFrom: options.dateFrom } : {}),
      ...(options.dateTo ? { dateTo: options.dateTo } : {}),
      stage: workerType,
      accountId: currentUser.accountId ?? currentUser.id,
      workerProfileId,
      includeOrderDetails: true
    });
    const employee = report.employees.find(
      (row) => row.workerProfileId === workerProfileId && row.stage === workerType
    );
    const records = report.orders ?? [];
    return {
      worker: {
        displayName: currentUser.displayName ?? employee?.employeeName ?? "员工",
        workerType
      },
      summary: {
        completedOrders: employee?.completedOrders ?? 0,
        completedPieces: employee?.completedPieces ?? 0,
        totalHours: employee?.totalHours ?? 0,
        averageHoursPerPiece: average(
          employee?.totalHours ?? 0,
          employee?.completedPieces ?? 0
        ),
        ...(employee?.hourlyOutput !== undefined
          ? { hourlyOutput: employee.hourlyOutput }
          : {}),
        ...(employee?.averageQualityScore !== undefined
          ? { averageQualityScore: employee.averageQualityScore }
          : {}),
        ...(employee?.unratedOrders !== undefined
          ? { unratedOrders: employee.unratedOrders }
          : {}),
        ...(employee?.checkedPieces !== undefined
          ? { checkedPieces: employee.checkedPieces }
          : {}),
        ...(employee?.complaintOrders !== undefined
          ? { complaintOrders: employee.complaintOrders }
          : {}),
        ...(employee?.complaintRate !== undefined
          ? { complaintRate: employee.complaintRate }
          : {})
      },
      records: records.map((row) => ({
        orderId: row.orderId,
        scanRecordId: row.latestCompletion.source === "scan_record"
          ? row.latestCompletion.recordId
          : undefined,
        customerName: row.customerName,
        salespersonName: row.salespersonName,
        styleNo: row.styleNo,
        styleName: row.styleName,
        completedAt: row.completedAt,
        pieces: row.pieces,
        workHours: row.workHours,
        ...(row.qualityScore !== undefined ? { qualityScore: row.qualityScore } : {}),
        ...(row.reworkCount !== undefined ? { reworkCount: row.reworkCount } : {}),
        ...(row.complaintCount !== undefined ? { complaintCount: row.complaintCount } : {})
      }))
    };
  }

  private async buildReport(options: PerformanceQuery) {
    const explicitDateRange = Boolean(options.dateFrom || options.dateTo);
    const effectiveMonth = explicitDateRange ? undefined : (options.month ?? currentMonth());
    const monthBoundaries = effectiveMonth ? monthRange(effectiveMonth) : undefined;
    const from = monthBoundaries?.from ?? timeBoundary(options.dateFrom, false);
    const to = monthBoundaries?.to ?? timeBoundary(options.dateTo, true);
    if (from !== undefined && to !== undefined && from > to) {
      throw new HttpError(400, "dateFrom must not be after dateTo.");
    }

    const query = (options.q ?? "").trim().toLowerCase();
    const [allOrders, patternTasks, pricingRecords, accountRecords, workerProfileRecords] = await Promise.all([
      this.repository.listOrders(),
      this.repository.listPatternTasks(),
      this.repository.listPricingRecords(),
      this.accounts.listAccounts(),
      this.workerProfiles.listWorkerProfiles()
    ]);
    const orders = allOrders.filter((order) => matchesQuery(order, query));
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const pricingByOrderId = new Map(pricingRecords.map((pricing) => [pricing.orderId, pricing]));
    const accountById = new Map(accountRecords.map((account) => [account.id, account]));
    const workerProfileById = new Map(workerProfileRecords.map((profile) => [profile.id, profile]));
    const scanRows = await Promise.all(
      orders.map(async (order) => [order.id, await this.repository.listScanRecordsByOrderId(order.id)] as const)
    );
    const scansByOrderId = new Map(scanRows);
    const needsComplaintData = !options.stage || options.stage === "qc_delivery";
    const complaintsByOrderId = needsComplaintData
      ? new Map(
          await Promise.all(
            orders.map(async (order) => [
              order.id,
              await this.repository.listOrderComplaintsByOrderId(order.id)
            ] as const)
          )
        )
      : new Map<string, Awaited<ReturnType<SampleRoomRepository["listOrderComplaintsByOrderId"]>>>();

    const employees = new Map<string, MutableEmployeeRow>();
    const anomalies: PerformanceAnomaly[] = [];
    const orderRows: PerformanceOrderRow[] = [];
    const stageEnabled = (stage: PerformanceStage) => !options.stage || options.stage === stage;
    const identityAllowed = (identity: PerformanceIdentity | undefined) =>
      Boolean(identity) &&
      (!options.accountId || identity!.accountId === options.accountId) &&
      (!options.workerProfileId || identity!.workerProfileId === options.workerProfileId);
    const employeeRow = (
      stage: Exclude<PerformanceStage, "finishing">,
      identity: PerformanceIdentity
    ) => {
      const {
        subjectId,
        accountId,
        role,
        employeeName,
        account,
        workerProfile,
        workerProfileId,
        workerType
      } = identity;
      const key = `${stage}:${subjectId}`;
      const row = employees.get(key) ?? {
        employeeName,
        accountId,
        role,
        ...(account ? { accountStatus: account.status } : {}),
        ...(workerProfileId
          ? {
              workerProfileId,
              workerType: workerType!,
              ...(workerProfile ? { workerProfileStatus: workerProfile.status } : {})
            }
          : {}),
        stage,
        completedStyles: 0,
        completedOrders: 0,
        completedPieces: 0,
        totalHours: 0,
        internalStageAmount: 0,
        unallocatedInternalStageAmount: 0
      };
      employees.set(key, row);
      return row;
    };
    const accountIdentity = (
      accountId: string,
      fallbackRole: Role,
      nameSnapshot?: string
    ): PerformanceIdentity => {
      const account = accountById.get(accountId);
      return {
        subjectId: accountId,
        accountId,
        role: account?.role ?? fallbackRole,
        employeeName: account?.displayName ?? nameSnapshot ?? accountId,
        account
      };
    };
    const workerProfileIdentity = (
      workerProfileId: string,
      actorAccountId: string,
      expectedWorkerType: WorkerType,
      nameSnapshot?: string
    ): PerformanceIdentity => {
      const workerProfile = workerProfileById.get(workerProfileId);
      const accountId = workerProfile?.accountId ?? actorAccountId;
      const account = accountById.get(accountId);
      return {
        subjectId: workerProfileId,
        accountId,
        role: account?.role ?? ROLES.worker,
        employeeName: account?.displayName ?? nameSnapshot ?? workerProfileId,
        account,
        workerProfile,
        workerProfileId,
        workerType: workerProfile?.workerType ?? expectedWorkerType
      };
    };

    const oldPattern = { completedStyles: 0, totalHours: 0, internalCost: 0 };
    const oldCutting = { completedOrders: 0, completedPieces: 0, totalHours: 0, internalCost: 0 };
    const oldSewing = { completedOrders: 0, completedPieces: 0, totalHours: 0, internalCost: 0 };
    const roleSummary: PerformanceRoleSummary = {
      pattern: { completedPatternTasks: 0, involvedOrders: 0 },
      cutting: { completedOrders: 0, completedPieces: 0 },
      sewing: {
        completedOrders: 0,
        completedPieces: 0,
        totalHours: 0,
        hourlyOutput: null,
        averageQualityScore: null,
        unratedOrders: 0,
        reworkRate: 0
      },
      receiver: { formalOrders: 0 },
      finishing: {
        completedOrders: 0,
        completedPieces: null,
        amount: null,
        averageAmountPerPricedOrder: null,
        averageAmountPerPricedPiece: null,
        missingAmountOrders: 0
      },
      qcDelivery: { completedOrders: 0, checkedPieces: 0, complaintOrders: 0, complaintRate: 0 }
    };

    if (stageEnabled("pattern")) {
      for (const task of patternTasks) {
        const order = orderById.get(task.orderId);
        const completedAt = task.completedAt ?? task.submittedAt;
        const patternCompletion = completions(scansByOrderId.get(task.orderId) ?? [], "pattern").at(-1);
        const accountId = task.patternMakerId ?? patternCompletion?.actorAccountId;
        const identity = accountId
          ? accountIdentity(accountId, ROLES.patternMaker, task.patternMakerName ?? patternCompletion?.workerName)
          : undefined;
        if (
          !order ||
          !inRange(completedAt, from, to) ||
          ((options.accountId || options.workerProfileId) && !identityAllowed(identity))
        ) continue;
        const employeeName = identity?.employeeName;
        const pricing = summarizePricing(order, pricingByOrderId.get(order.id));
        const hours = task.totalWorkHours ?? patternCompletion?.workHours ?? 0;
        roleSummary.pattern.completedPatternTasks += 1;
        roleSummary.pattern.involvedOrders += 1;
        oldPattern.completedStyles += 1;
        oldPattern.totalHours += hours;
        oldPattern.internalCost += pricing.internalPatternCost;
        if (identity) {
          const row = employeeRow("pattern", identity);
          row.completedStyles += 1;
          row.totalHours += hours;
          row.completedPatternTasks = (row.completedPatternTasks ?? 0) + 1;
          row.involvedOrders = (row.involvedOrders ?? 0) + 1;
          row.internalStageAmount += pricing.internalPatternCost;
        }
        if (options.includeOrderDetails !== false) {
          orderRows.push({
            orderId: order.id,
            orderNo: order.orderNo,
            folderCode: order.folderCode,
            styleNo: order.styleNo,
            styleName: order.styleName,
            customerName: order.customerName,
            salespersonName: order.salespersonName,
            stage: "pattern",
            ...(employeeName ? { employeeName } : {}),
            pieces: null,
            workHours: hours,
            internalStageAmount: pricing.internalPatternCost,
            internalCost: pricing.internalPatternCost,
            costAttribution: accountId ? "employee" : "unallocated_missing_employee",
            completedAt: completedAt!,
            latestCompletion: {
              source: "pattern_task",
              recordId: task.id,
              eventTime: completedAt!,
              ...(identity ? { accountId: identity.accountId, role: identity.role } : {}),
              ...(employeeName ? { employeeName } : {})
            }
          });
        }
      }
    }

    let sewingQcReviewedOrders = 0;
    let sewingReworkOrders = 0;
    const aggregateProduction = (stage: "cutting" | "sewing") => {
      if (!stageEnabled(stage)) return;
      for (const order of orders) {
        const allRecords = scansByOrderId.get(order.id) ?? [];

        const collaborationRounds = collaborativeSewingRoundStates(order, allRecords);
        const collaboration = collaborationRounds.at(-1) ?? collaborativeSewingState(order, allRecords);
        if (stage === "sewing" && collaborationRounds.some((round) => round.usesParticipationWorkflow)) {
          const duplicateRecordCount = collaborationRounds.reduce(
            (count, round) => count + round.duplicateCompletionCount,
            0
          );
          if (duplicateRecordCount > 0) {
            const effectiveCompletionCount = collaborationRounds.reduce(
              (count, round) => count + round.effectiveParticipations.length,
              0
            );
            anomalies.push({
              orderId: order.id,
              orderNo: order.orderNo,
              stage,
              code: "multiple_completion_records",
              recordCount: effectiveCompletionCount + duplicateRecordCount
            });
          }
          const contributions = collaborationRounds.flatMap((round) =>
            round.effectiveParticipations
          ).flatMap((participation) => {
            const completion = participation.completionScanRecordId
              ? allRecords.find((record) => record.id === participation.completionScanRecordId)
              : undefined;
            const workerProfileId = completion?.workerProfileId ?? participation.workerProfileId;
            if (!completion || !workerProfileId || !inRange(completion.eventTime, from, to)) return [];
            const storedWorkerProfile = workerProfileById.get(workerProfileId);
            if (storedWorkerProfile && storedWorkerProfile.workerType !== "sewing") return [];
            const identity = workerProfileIdentity(
              workerProfileId,
              completion.actorAccountId,
              "sewing",
              completion.workerName
            );
            if (!identityAllowed(identity)) return [];
            return [{
              participation,
              completion,
              workerProfileId,
              identity,
              pieces: participation.completedPieces ?? effectiveProcessPieces(order, completion) ?? 0,
              hours: completion.workHours ?? 0
            }];
          });
          if (contributions.length === 0) continue;

          const pricing = summarizePricing(order, pricingByOrderId.get(order.id));
          const totalPieces = contributions.reduce((sum, item) => sum + item.pieces, 0);
          const totalHours = contributions.reduce((sum, item) => sum + item.hours, 0);
          oldSewing.completedOrders += 1;
          oldSewing.completedPieces += totalPieces;
          oldSewing.totalHours += totalHours;
          oldSewing.internalCost += pricing.internalSewingCost;
          roleSummary.sewing.completedOrders += 1;
          roleSummary.sewing.completedPieces += totalPieces;
          roleSummary.sewing.totalHours += totalHours;

          const qcRecords = normalQcCompletions(allRecords);
          const latestQc = qcRecords.at(-1);
          const hasQc = qcRecords.length > 0;
          const reworked = qcRecords.some((record) => record.qualityResult === "rework");
          const qualityScore = latestQc?.qualityResult === "qualified" && typeof latestQc.qualityScore === "number"
            ? latestQc.qualityScore
            : null;
          if (hasQc) {
            sewingQcReviewedOrders += 1;
            if (reworked) sewingReworkOrders += 1;
          }
          if (qualityScore === null) roleSummary.sewing.unratedOrders += 1;

          const groupedByEmployee = new Map<string, {
            identity: PerformanceIdentity;
            items: typeof contributions;
          }>();
          for (const contribution of contributions) {
            const key = contribution.identity.subjectId;
            const group = groupedByEmployee.get(key) ?? {
              identity: contribution.identity,
              items: [] as typeof contributions
            };
            group.items.push(contribution);
            groupedByEmployee.set(key, group);
          }

          for (const group of groupedByEmployee.values()) {
            const row = employeeRow("sewing", group.identity);
            row.completedOrders += 1;
            row.completedPieces += group.items.reduce((sum, item) => sum + item.pieces, 0);
            row.totalHours += group.items.reduce((sum, item) => sum + item.hours, 0);
            if (hasQc) {
              row.qcReviewedOrders = (row.qcReviewedOrders ?? 0) + 1;
              if (reworked) row.reworkOrders = (row.reworkOrders ?? 0) + 1;
            }
            if (qualityScore !== null) {
              row.qualityScoreTotal = (row.qualityScoreTotal ?? 0) + qualityScore;
              row.qualityScoreCount = (row.qualityScoreCount ?? 0) + 1;
            } else {
              row.unratedOrders = (row.unratedOrders ?? 0) + 1;
            }
          }

          if (options.includeOrderDetails !== false) {
            for (const contribution of contributions) {
              const pieceCorrections = processPiecesCorrections(order, contribution.completion).map((log) => ({
                changedAt: log.changedAt,
                changedByRole: log.changedByRole,
                changedByAccountId: log.changedByAccountId,
                ...(log.changedByName ? { changedByName: log.changedByName } : {}),
                ...(log.reason ? { reason: log.reason } : {}),
                oldValue: typeof log.oldValue === "number" ? log.oldValue : null,
                newValue: typeof log.newValue === "number" ? log.newValue : null
              }));
              orderRows.push({
                orderId: order.id,
                orderNo: order.orderNo,
                folderCode: order.folderCode,
                styleNo: order.styleNo,
                styleName: collaborationStyleName(
                  order,
                  collaborationRounds.some((round) => round.mode === "collaboration")
                ),
                customerName: order.customerName,
                salespersonName: order.salespersonName,
                stage: "sewing",
                employeeName: contribution.identity.employeeName,
                pieces: contribution.pieces,
                workHours: contribution.hours,
                ...(pieceCorrections.length ? { pieceCorrections } : {}),
                qualityScore,
                internalStageAmount: null,
                internalCost: null,
                costAttribution: "not_applicable",
                completedAt: contribution.completion.eventTime,
                latestCompletion: {
                  source: "scan_record",
                  recordId: contribution.completion.id,
                  eventTime: contribution.completion.eventTime,
                  accountId: contribution.identity.accountId,
                  workerProfileId: contribution.workerProfileId,
                  workerType: contribution.identity.workerType!,
                  employeeName: contribution.identity.employeeName
                }
              });
            }
          }
          continue;
        }

        const records = completions(allRecords, stage);
        const completion = records.at(-1);
        const workerProfileId = completion?.workerProfileId;
        if (!completion || !workerProfileId || !inRange(completion.eventTime, from, to)) continue;
        const storedWorkerProfile = workerProfileById.get(workerProfileId);
        if (storedWorkerProfile && storedWorkerProfile.workerType !== stage) continue;
        const identity = workerProfileIdentity(
          workerProfileId,
          completion.actorAccountId,
          stage,
          completion.workerName
        );
        if (!identityAllowed(identity)) continue;
        if (records.length > 1) {
          anomalies.push({ orderId: order.id, orderNo: order.orderNo, stage, code: "multiple_completion_records", recordCount: records.length });
        }
        const pieces = effectiveProcessPieces(order, completion) ?? 0;
        const hours = completion.workHours ?? 0;
        const pricing = summarizePricing(order, pricingByOrderId.get(order.id));
        const internalCost = stage === "cutting" ? pricing.internalCuttingCost : pricing.internalSewingCost;
        const old = stage === "cutting" ? oldCutting : oldSewing;
        old.completedOrders += 1;
        old.completedPieces += pieces;
        old.totalHours += hours;
        old.internalCost += internalCost;
        const row = employeeRow(stage, identity);
        row.completedOrders += 1;
        row.completedPieces += pieces;
        row.totalHours += hours;
        row.internalStageAmount += internalCost;
        if (stage === "cutting") {
          roleSummary.cutting.completedOrders += 1;
          roleSummary.cutting.completedPieces += pieces;
        } else {
          roleSummary.sewing.completedOrders += 1;
          roleSummary.sewing.completedPieces += pieces;
          roleSummary.sewing.totalHours += hours;
          const qcRecords = normalQcCompletions(allRecords);
          const latestQc = qcRecords.at(-1);
          if (qcRecords.length > 0) {
            sewingQcReviewedOrders += 1;
            row.qcReviewedOrders = (row.qcReviewedOrders ?? 0) + 1;
            if (qcRecords.some((record) => record.qualityResult === "rework")) {
              sewingReworkOrders += 1;
              row.reworkOrders = (row.reworkOrders ?? 0) + 1;
            }
          }
          if (latestQc?.qualityResult === "qualified" && typeof latestQc.qualityScore === "number") {
            row.qualityScoreTotal = (row.qualityScoreTotal ?? 0) + latestQc.qualityScore;
            row.qualityScoreCount = (row.qualityScoreCount ?? 0) + 1;
          } else {
            roleSummary.sewing.unratedOrders += 1;
            row.unratedOrders = (row.unratedOrders ?? 0) + 1;
          }
        }
        if (options.includeOrderDetails !== false) {
          const latestQc = stage === "sewing"
            ? normalQcCompletions(allRecords).at(-1)
            : undefined;
          const qualityScore = stage === "sewing"
            ? latestQc?.qualityResult === "qualified" ? latestQc.qualityScore ?? null : null
            : undefined;
          const pieceCorrections = processPiecesCorrections(order, completion).map((log) => ({
            changedAt: log.changedAt,
            changedByRole: log.changedByRole,
            changedByAccountId: log.changedByAccountId,
            ...(log.changedByName ? { changedByName: log.changedByName } : {}),
            ...(log.reason ? { reason: log.reason } : {}),
            oldValue: typeof log.oldValue === "number" ? log.oldValue : null,
            newValue: typeof log.newValue === "number" ? log.newValue : null
          }));
          orderRows.push({
            orderId: order.id,
            orderNo: order.orderNo,
            folderCode: order.folderCode,
            styleNo: order.styleNo,
            styleName: order.styleName,
            customerName: order.customerName,
            salespersonName: order.salespersonName,
            stage,
            employeeName: identity.employeeName,
            pieces,
            workHours: hours,
            ...(pieceCorrections.length ? { pieceCorrections } : {}),
            ...(qualityScore !== undefined ? { qualityScore } : {}),
            internalStageAmount: internalCost,
            internalCost,
            costAttribution: records.length > 1 ? "unallocated_multiple_completion_records" : "employee",
            completedAt: completion.eventTime,
            latestCompletion: {
              source: "scan_record",
              recordId: completion.id,
              eventTime: completion.eventTime,
              accountId: identity.accountId,
              workerProfileId,
              workerType: identity.workerType!,
              employeeName: identity.employeeName
            }
          });
        }
      }
    };
    aggregateProduction("cutting");
    aggregateProduction("sewing");

    if (stageEnabled("receiver")) {
      for (const order of orders) {
        if (
          order.intakeStatus !== "received" || order.stage === null || order.terminated ||
          !inRange(order.receivedAt, from, to)
        ) continue;
        const accountId = order.receivedBy;
        if (!accountId) continue;
        const identity = accountIdentity(accountId, ROLES.receiver);
        if (!identityAllowed(identity)) continue;
        roleSummary.receiver.formalOrders += 1;
        const row = employeeRow("receiver", identity);
        row.formalOrders = (row.formalOrders ?? 0) + 1;
        row.completedOrders += 1;
      }
    }

    let finishingPieces = 0;
    let hasFinishingPieces = false;
    let finishingAmount = 0;
    let pricedFinishingOrders = 0;
    let pricedFinishingPieces = 0;
    if (stageEnabled("finishing") && !options.accountId && !options.workerProfileId) {
      for (const order of orders) {
        const allRecords = scansByOrderId.get(order.id) ?? [];
        const qc = normalQcCompletions(allRecords).at(-1);
        if (
          order.stage !== ORDER_STAGES.done ||
          qc?.qualityResult !== "qualified" ||
          !inRange(qc.eventTime, from, to)
        ) continue;
        roleSummary.finishing.completedOrders += 1;
        const sewingCompletion = completions(allRecords, "sewing").at(-1);
        const sewingState = collaborativeSewingState(order, allRecords);
        const sewingPieces = sewingState.usesParticipationWorkflow
          ? sewingState.completedPieces
          : sewingCompletion ? effectiveProcessPieces(order, sewingCompletion) : undefined;
        if (typeof sewingPieces === "number") {
          finishingPieces += sewingPieces;
          hasFinishingPieces = true;
        }
        else anomalies.push({ orderId: order.id, orderNo: order.orderNo, stage: "finishing", code: "sewing_pieces_missing" });
        const amount = pricingByOrderId.get(order.id)?.internalFinishingCost;
        if (typeof amount === "number") {
          finishingAmount += amount;
          pricedFinishingOrders += 1;
          if (typeof sewingPieces === "number") pricedFinishingPieces += sewingPieces;
        } else {
          roleSummary.finishing.missingAmountOrders += 1;
        }
        if (options.includeOrderDetails !== false) {
          orderRows.push({
            orderId: order.id,
            orderNo: order.orderNo,
            folderCode: order.folderCode,
            styleNo: order.styleNo,
            styleName: order.styleName,
            customerName: order.customerName,
            salespersonName: order.salespersonName,
            stage: "finishing",
            pieces: sewingPieces ?? null,
            workHours: null,
            internalStageAmount: amount ?? null,
            internalCost: amount ?? null,
            costAttribution: "not_applicable",
            completedAt: qc.eventTime,
            latestCompletion: { source: "scan_record", recordId: qc.id, eventTime: qc.eventTime }
          });
        }
      }
      roleSummary.finishing.completedPieces = hasFinishingPieces ? finishingPieces : null;
      roleSummary.finishing.amount = pricedFinishingOrders > 0 ? finishingAmount : null;
      roleSummary.finishing.averageAmountPerPricedOrder = nullableAverage(finishingAmount, pricedFinishingOrders);
      roleSummary.finishing.averageAmountPerPricedPiece = nullableAverage(finishingAmount, pricedFinishingPieces);
    }

    if (stageEnabled("qc_delivery")) {
      for (const order of orders) {
        const qcRecords = normalQcCompletions(scansByOrderId.get(order.id) ?? []);
        const qc = qcRecords.at(-1);
        const workerProfileId = qc?.workerProfileId;
        if (
          order.stage !== ORDER_STAGES.done ||
          qc?.qualityResult !== "qualified" ||
          !workerProfileId ||
          !inRange(qc.eventTime, from, to)
        ) continue;
        const storedWorkerProfile = workerProfileById.get(workerProfileId);
        if (storedWorkerProfile && storedWorkerProfile.workerType !== "qc_delivery") continue;
        const identity = workerProfileIdentity(
          workerProfileId,
          qc.actorAccountId,
          "qc_delivery",
          qc.workerName
        );
        if (!identityAllowed(identity)) continue;
        const complaintCount = (complaintsByOrderId.get(order.id) ?? []).length;
        const complained = complaintCount > 0;
        const pieces = qc.pieces ?? 0;
        roleSummary.qcDelivery.completedOrders += 1;
        roleSummary.qcDelivery.checkedPieces += pieces;
        if (complained) roleSummary.qcDelivery.complaintOrders += 1;
        const row = employeeRow(
          "qc_delivery",
          identity
        );
        row.completedOrders += 1;
        row.checkedPieces = (row.checkedPieces ?? 0) + pieces;
        if (complained) row.complaintOrders = (row.complaintOrders ?? 0) + 1;
        if (options.includeOrderDetails !== false) {
          orderRows.push({
            orderId: order.id,
            orderNo: order.orderNo,
            folderCode: order.folderCode,
            styleNo: order.styleNo,
            styleName: order.styleName,
            customerName: order.customerName,
            salespersonName: order.salespersonName,
            stage: "qc_delivery",
            employeeName: identity.employeeName,
            pieces,
            workHours: null,
            qualityScore: qc.qualityScore ?? null,
            reworkCount: qcRecords.filter((record) => record.qualityResult === "rework").length,
            complaintCount,
            internalStageAmount: null,
            internalCost: null,
            costAttribution: "not_applicable",
            completedAt: qc.eventTime,
            latestCompletion: {
              source: "scan_record",
              recordId: qc.id,
              eventTime: qc.eventTime,
              accountId: identity.accountId,
              workerProfileId,
              workerType: identity.workerType!,
              employeeName: identity.employeeName
            }
          });
        }
      }
      roleSummary.qcDelivery.complaintRate = average(
        roleSummary.qcDelivery.complaintOrders * 100,
        roleSummary.qcDelivery.completedOrders
      );
    }

    let sewingScoreTotal = 0;
    let sewingScoreCount = 0;
    for (const row of employees.values()) {
      if (row.stage === "sewing") {
        row.hourlyOutput = row.totalHours > 0 ? row.completedPieces / row.totalHours : null;
        row.averageQualityScore = nullableAverage(row.qualityScoreTotal ?? 0, row.qualityScoreCount ?? 0);
        row.reworkRate = average((row.reworkOrders ?? 0) * 100, row.qcReviewedOrders ?? 0);
        sewingScoreTotal += row.qualityScoreTotal ?? 0;
        sewingScoreCount += row.qualityScoreCount ?? 0;
      }
      if (row.stage === "qc_delivery") {
        row.complaintRate = average((row.complaintOrders ?? 0) * 100, row.completedOrders);
      }
      delete row.qualityScoreTotal;
      delete row.qualityScoreCount;
      delete row.qcReviewedOrders;
      delete row.reworkOrders;
    }
    roleSummary.sewing.hourlyOutput = roleSummary.sewing.totalHours > 0
      ? roleSummary.sewing.completedPieces / roleSummary.sewing.totalHours
      : null;
    roleSummary.sewing.averageQualityScore = nullableAverage(sewingScoreTotal, sewingScoreCount);
    roleSummary.sewing.reworkRate = average(
      sewingReworkOrders * 100,
      sewingQcReviewedOrders
    );

    return {
      filters: options,
      roleSummary,
      overview: {
        pattern: { ...oldPattern, averageHoursPerStyle: average(oldPattern.totalHours, oldPattern.completedStyles) },
        cutting: { ...oldCutting, averageHoursPerPiece: average(oldCutting.totalHours, oldCutting.completedPieces) },
        sewing: { ...oldSewing, averageHoursPerPiece: average(oldSewing.totalHours, oldSewing.completedPieces) },
        finishing: { pieces: roleSummary.finishing.completedPieces, amount: roleSummary.finishing.amount }
      },
      employees: [...employees.values()].sort((left, right) => {
        const leftValue = left.completedPatternTasks ?? left.formalOrders ?? left.completedOrders;
        const rightValue = right.completedPatternTasks ?? right.formalOrders ?? right.completedOrders;
        return rightValue - leftValue || left.employeeName.localeCompare(right.employeeName);
      }),
      ...(options.includeOrderDetails !== false
        ? { orders: orderRows.sort((left, right) => right.completedAt.localeCompare(left.completedAt)) }
        : {}),
      anomalies
    };
  }
}
