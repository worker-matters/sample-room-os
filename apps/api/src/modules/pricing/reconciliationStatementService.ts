import { sampleRoundOptions } from "@sample-room/shared";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { isBossOrSystemOwner } from "../auth/permissionPolicy.js";
import { attachmentForWebResponse } from "../files/attachmentDto.js";
import type { FileStorageAdapter } from "../files/fileStorageAdapter.js";
import type { OrderRecord } from "../orders/orderTypes.js";
import type { SampleTypeService } from "../sample-types/sampleTypeService.js";
import type { ScanRecord } from "../scan/scanTypes.js";
import {
  currentConfirmedCustomerQuotation,
  pricingReconciliationEligibility,
  summarizePricing
} from "./pricingCalculationService.js";
import {
  createStatementDownload,
  DEFAULT_RECONCILIATION_STATEMENT_EXPORT_COLUMNS,
  RECONCILIATION_STATEMENT_EXPORT_COLUMNS,
  type ReconciliationStatementExportContext,
  type ReconciliationStatementExportColumn,
  type ReconciliationStatementDownload
} from "./reconciliationStatementExportService.js";
import { simpleXlsxImageSize, type SimpleXlsxImage } from "./simpleXlsx.js";
import type {
  OrderChargeRecord,
  PricingRecord,
  ReconciliationStatementRecord,
  ReconciliationStatementItemCreateInput
} from "./pricingTypes.js";
import {
  PRICING_QUOTATION_STATUSES,
  RECONCILIATION_STATEMENT_STATUSES
} from "./pricingTypes.js";

export type StatementCreatePayload = {
  orderIds?: unknown;
};

export type ReconciliationStatementListOptions = {
  includeReturned?: boolean;
  q?: string;
  customerId?: string;
  customerBusinessUserId?: string;
  paymentStatus?: "pending" | "paid";
  dateFrom?: string;
  dateTo?: string;
};

export type ReconciliationStatementDownloadPayload = {
  statementIds?: unknown;
  columns?: unknown;
};

function parseOrderIds(payload: StatementCreatePayload) {
  if (!Array.isArray(payload.orderIds)) {
    throw new HttpError(400, "orderIds must be an array.");
  }

  const orderIds = payload.orderIds
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  if (orderIds.length === 0) {
    throw new HttpError(400, "Please select at least one order.");
  }

  return [...new Set(orderIds)];
}

function dateOnly(value?: string) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

function statementDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function normalizeSearch(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function inGeneratedDateRange(
  statement: Pick<ReconciliationStatementRecord, "generatedAt">,
  dateFrom?: string,
  dateTo?: string
) {
  const generatedAt = new Date(statement.generatedAt).getTime();
  if (!generatedAt) {
    return false;
  }

  const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : undefined;
  const toTime = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : undefined;
  return (fromTime === undefined || generatedAt >= fromTime) && (toTime === undefined || generatedAt <= toTime);
}

function parseStatementIds(payload: ReconciliationStatementDownloadPayload) {
  if (!Array.isArray(payload.statementIds)) {
    throw new HttpError(400, "statementIds must be an array.");
  }

  const statementIds = payload.statementIds
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  if (statementIds.length === 0) {
    throw new HttpError(400, "Please select at least one reconciliation statement.");
  }

  return [...new Set(statementIds)];
}

function parseStatementExportColumns(
  payload: ReconciliationStatementDownloadPayload
): ReconciliationStatementExportColumn[] {
  if (payload.columns === undefined) {
    return [...DEFAULT_RECONCILIATION_STATEMENT_EXPORT_COLUMNS];
  }
  if (!Array.isArray(payload.columns)) {
    throw new HttpError(400, "columns must be an array.");
  }

  const allowed = new Set<string>(RECONCILIATION_STATEMENT_EXPORT_COLUMNS);
  const columns = payload.columns.filter(
    (value): value is ReconciliationStatementExportColumn =>
      typeof value === "string" && allowed.has(value)
  );
  if (columns.length !== payload.columns.length) {
    throw new HttpError(400, "columns contains an unsupported field.");
  }
  if (columns.length === 0) {
    throw new HttpError(400, "Please select at least one statement column.");
  }
  return [...new Set(columns)];
}

export type ReconciliationStatementExportDependencies = {
  fileStorage?: Pick<FileStorageAdapter, "readFile">;
  sampleTypeService?: Pick<SampleTypeService, "listOptions">;
};

function preferredThumbnailAttachment(
  attachments: Awaited<ReturnType<SampleRoomRepository["listOrderAttachments"]>>
) {
  const images = attachments.filter((attachment) =>
    Boolean(attachment.storageKey) && attachment.mimeType.toLowerCase().startsWith("image/")
  );
  for (const category of ["style_thumbnail", "receiver_quick_photo", "client_quick_photo", "client_reference"]) {
    const match = images.find((attachment) => attachment.category === category);
    if (match) return match;
  }
  return images[0];
}

function thumbnailExtension(mimeType: string): SimpleXlsxImage["extension"] | undefined {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpeg";
  return undefined;
}

function latestQualifiedDeliveryAt(records: ScanRecord[]) {
  const latest = records
    .filter((record) =>
      record.stage === "qc_delivery" &&
      record.action === "complete"
    )
    .reduce<ScanRecord | undefined>(
      (current, record) => !current || record.eventTime > current.eventTime ? record : current,
      undefined
    );
  return latest?.qualityResult === "qualified" ? latest.eventTime : undefined;
}

export class ReconciliationStatementService {
  private creationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: SampleRoomRepository,
    private readonly exportDependencies: ReconciliationStatementExportDependencies = {}
  ) {}

  private async withCreationLock<T>(operation: () => PromiseLike<T> | T): Promise<T> {
    const previous = this.creationTail;
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.creationTail = previous.then(() => current);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }

  private ensureManager(currentUser: CurrentUser) {
    if (!isBossOrSystemOwner(currentUser)) {
      throw new HttpError(403, "forbidden");
    }
  }

  async activeStatementOrderIds() {
    const statements = await this.repository.listReconciliationStatements();
    return new Set(
      statements
        .filter((statement) => statement.status !== RECONCILIATION_STATEMENT_STATUSES.returned)
        .flatMap((statement) => statement.items.filter((item) => !item.returnedAt).map((item) => item.orderId))
    );
  }

  private async orderLookup() {
    const orders = await this.repository.listOrders();
    return new Map(orders.map((order) => [order.id, order]));
  }

  private async enrichStatement(
    statement: ReconciliationStatementRecord,
    orderById: Map<string, OrderRecord>,
    pricingByOrderId: Map<string, PricingRecord>
  ): Promise<ReconciliationStatementRecord> {
    const firstOrder = statement.items
      .map((item) => orderById.get(item.orderId))
      .find((order): order is OrderRecord => Boolean(order));

    return {
      ...statement,
      ...(firstOrder?.customerId ? { customerId: firstOrder.customerId } : {}),
      ...(firstOrder?.clientUserId ? { clientUserId: firstOrder.clientUserId } : {}),
      items: await Promise.all(statement.items.map(async (item) => {
        const order = orderById.get(item.orderId);
        const pricing = pricingByOrderId.get(item.orderId);
        const summary = order && pricing ? summarizePricing(order, pricing, []) : undefined;
        return {
          ...item,
          ...(order?.folderCode ? { folderCode: order.folderCode } : {}),
          ...(order?.createdAt ? { orderCreatedAt: order.createdAt } : {}),
          ...(order ? { sampleRequestItems: order.sampleRequestItems } : {}),
          ...(summary && item.internalTotalCost === undefined ? {
            internalPatternCost: summary.internalPatternCost,
            internalCuttingCost: summary.internalCuttingCost,
            internalSewingCost: summary.internalSewingCost,
            internalFinishingCost: summary.internalFinishingCost,
            internalTotalCost: summary.internalTotalCost
          } : {}),
          attachments: (await this.repository.listOrderAttachments(item.orderId)).map(attachmentForWebResponse)
        };
      }))
    };
  }

  private matchesFilters(statement: ReconciliationStatementRecord, options: ReconciliationStatementListOptions) {
    if (!options.includeReturned && statement.status === RECONCILIATION_STATEMENT_STATUSES.returned) {
      return false;
    }

    if (options.paymentStatus === "pending" && statement.status !== RECONCILIATION_STATEMENT_STATUSES.pendingPayment) {
      return false;
    }

    if (options.paymentStatus === "paid" && statement.status !== RECONCILIATION_STATEMENT_STATUSES.paid) {
      return false;
    }

    if (options.customerId && statement.customerId !== options.customerId && statement.customerName !== options.customerId) {
      return false;
    }

    if (
      options.customerBusinessUserId &&
      statement.clientUserId !== options.customerBusinessUserId &&
      statement.salespersonName !== options.customerBusinessUserId
    ) {
      return false;
    }

    if (!inGeneratedDateRange(statement, options.dateFrom, options.dateTo)) {
      return false;
    }

    const query = normalizeSearch(options.q);
    if (!query) {
      return true;
    }

    const searchParts = [
      statement.statementNo,
      statement.customerName,
      statement.salespersonName,
      ...statement.items.flatMap((item) => [
        item.orderNo,
        item.folderCode,
        item.styleNo,
        item.styleName,
        item.customerName,
        item.salespersonName,
        item.remark
      ])
    ];
    return searchParts.some((part) => normalizeSearch(part).includes(query));
  }

  private nextStatementNo(existingStatementNos: string[], now = new Date()) {
    const prefix = `DZ-${statementDateKey(now)}`;
    const sameDayCount = existingStatementNos.filter((statementNo) =>
      statementNo.startsWith(prefix)
    ).length;
    return `${prefix}-${String(sameDayCount + 1).padStart(3, "0")}`;
  }

  private billingPeriod(orders: Array<Pick<OrderRecord, "createdAt">>) {
    const dateKeys = orders.map((order) => dateOnly(order.createdAt)).filter(Boolean).sort();
    if (dateKeys.length === 0) {
      return dateOnly(new Date().toISOString());
    }

    const first = dateKeys[0]!;
    const last = dateKeys[dateKeys.length - 1]!;
    return first === last ? first : `${first} 至 ${last}`;
  }

  private statementItem(
    order: OrderRecord,
    pricing: PricingRecord,
    charges: readonly OrderChargeRecord[],
    generatedAt: string
  ): ReconciliationStatementItemCreateInput {
    const quotation = currentConfirmedCustomerQuotation(pricing, undefined, charges);
    if (!quotation) {
      throw new HttpError(409, "quotation must be manually confirmed before reconciliation.");
    }

    const internalItems = pricing.confirmedInternalCostSnapshot ?? [];
    const detailedOtherChargeNote = quotation.otherCharges
      .map((charge) => {
        const explanation = charge.explanation?.trim();
        return explanation ? `${charge.name}：${explanation}` : charge.name;
      })
      .filter(Boolean)
      .join("；") || quotation.otherChargeNote;
    const internalByCategory = (category: string) =>
      internalItems
        .filter((item) => item.category === category)
        .reduce((sum, item) => sum + item.amount, 0);
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      styleNo: order.styleNo,
      styleName: order.styleName,
      customerName: order.customerName,
      salespersonName: order.salespersonName,
      quantity: order.quantity,
      quotedPrice: quotation.sampleUnitPrice,
      sampleAmount: quotation.sampleAmount,
      patternFeeTotal: quotation.customerPatternFee,
      customerPatternFee: quotation.customerPatternFee,
      otherChargeTotal: quotation.effectiveCustomerOtherCharges,
      ...(detailedOtherChargeNote ? { otherChargeNote: detailedOtherChargeNote } : {}),
      customerChargeSnapshot: quotation.customerChargeItems,
      receivableTotal: quotation.receivableTotal,
      internalCostSnapshot: internalItems,
      internalBaseCost: pricing.confirmedBaseInternalCost ?? 0,
      internalPatternCost:
        internalItems.length > 0 ? internalByCategory("pattern") : pricing.internalPatternCost ?? 0,
      internalCuttingCost:
        internalItems.length > 0 ? internalByCategory("cutting") : pricing.internalCuttingCost ?? 0,
      internalSewingCost:
        internalItems.length > 0 ? internalByCategory("sewing") : pricing.internalSewingCost ?? 0,
      internalFinishingCost:
        internalItems.length > 0 ? internalByCategory("finishing") : pricing.internalFinishingCost ?? 0,
      internalTotalCost:
        pricing.confirmedInternalCostTotal ??
        (pricing.confirmedBaseInternalCost ?? 0),
      ...(pricing.note ? { remark: pricing.note } : {}),
      orderStatusLabel: order.stage ?? order.intakeStatus,
      generatedAt
    };
  }

  private async lockStatementOrdersThenStatement(
    repository: SampleRoomRepository,
    statementId: string
  ) {
    const beforeLock = await repository.findReconciliationStatementById(statementId);
    if (!beforeLock) throw new HttpError(404, "statement not found.");
    const orderIds = [...new Set(beforeLock.items.map((item) => item.orderId))].sort();
    for (const orderId of orderIds) {
      await repository.lockOrderForWorkflow(orderId);
    }
    await repository.lockReconciliationStatementForUpdate(statementId);
    const statement = await repository.findReconciliationStatementById(statementId);
    if (!statement) throw new HttpError(404, "statement not found.");
    return statement;
  }

  async refreshPendingStatementItemSnapshot(
    order: OrderRecord,
    pricing: PricingRecord
  ) {
    const candidate = (await this.repository.listReconciliationStatements()).find(
      (statement) =>
        statement.status !== RECONCILIATION_STATEMENT_STATUSES.returned &&
        statement.items.some((item) => item.orderId === order.id && !item.returnedAt)
    );
    if (!candidate) return undefined;

    await this.repository.lockReconciliationStatementForUpdate(candidate.id);
    const statement = await this.repository.findReconciliationStatementById(candidate.id);
    if (!statement) throw new HttpError(404, "statement not found.");
    const item = statement.items.find(
      (current) => current.orderId === order.id && !current.returnedAt
    );
    if (!item || statement.status === RECONCILIATION_STATEMENT_STATUSES.returned) {
      return undefined;
    }
    if (statement.status === RECONCILIATION_STATEMENT_STATUSES.paid) {
      throw new HttpError(
        409,
        "quotation is included in a paid reconciliation statement; undo payment before updating."
      );
    }

    const charges = await this.repository.listOrderChargesByOrderId(order.id);
    const snapshot = this.statementItem(order, pricing, charges, item.generatedAt);
    const withUpdatedItem = await this.repository.updateReconciliationStatementItem(item.id, {
      quantity: snapshot.quantity,
      quotedPrice: snapshot.quotedPrice,
      sampleAmount: snapshot.sampleAmount,
      patternFeeTotal: snapshot.patternFeeTotal ?? 0,
      customerPatternFee: snapshot.customerPatternFee ?? 0,
      otherChargeTotal: snapshot.otherChargeTotal,
      otherChargeNote: snapshot.otherChargeNote ?? null,
      customerChargeSnapshot: snapshot.customerChargeSnapshot ?? [],
      receivableTotal: snapshot.receivableTotal,
      internalCostSnapshot: snapshot.internalCostSnapshot ?? [],
      internalBaseCost: snapshot.internalBaseCost ?? 0,
      internalPatternCost: snapshot.internalPatternCost ?? 0,
      internalCuttingCost: snapshot.internalCuttingCost ?? 0,
      internalSewingCost: snapshot.internalSewingCost ?? 0,
      internalFinishingCost: snapshot.internalFinishingCost ?? 0,
      internalTotalCost: snapshot.internalTotalCost ?? 0,
      remark: snapshot.remark ?? null
    });
    const activeItems = withUpdatedItem.items.filter((current) => !current.returnedAt);
    return this.repository.updateReconciliationStatement(statement.id, {
      orderCount: activeItems.length,
      receivableAmount: activeItems.reduce(
        (sum, current) => sum + current.receivableTotal,
        0
      )
    });
  }

  async listReconciliationStatements(
    currentUser: CurrentUser,
    options: ReconciliationStatementListOptions = {}
  ) {
    this.ensureManager(currentUser);
    const [statements, orderById, pricingRecords] = await Promise.all([
      this.repository.listReconciliationStatements(),
      this.orderLookup(),
      this.repository.listPricingRecords()
    ]);
    const pricingByOrderId = new Map(pricingRecords.map((pricing) => [pricing.orderId, pricing]));
    const enrichedStatements = await Promise.all(
      statements.map((statement) => this.enrichStatement(statement, orderById, pricingByOrderId))
    );
    return {
      statements: enrichedStatements.filter((statement) => this.matchesFilters(statement, options))
    };
  }

  async downloadReconciliationStatements(
    payload: ReconciliationStatementDownloadPayload,
    currentUser: CurrentUser
  ): Promise<ReconciliationStatementDownload> {
    const statementIds = parseStatementIds(payload);
    const columns = parseStatementExportColumns(payload);
    const { statements } = await this.listReconciliationStatements(currentUser);
    const statementById = new Map(statements.map((statement) => [statement.id, statement]));
    const selectedStatements = statementIds.map((statementId) => {
      const statement = statementById.get(statementId);
      if (!statement) {
        throw new HttpError(404, "statement not found.");
      }
      return statement;
    });

    const orderIds = new Set(selectedStatements.flatMap((statement) =>
      statement.items.filter((item) => !item.returnedAt).map((item) => item.orderId)
    ));
    const [orders, sampleTypeOptions, deliveryRecordsByOrder] = await Promise.all([
      this.repository.listOrders(),
      columns.includes("sampleType") && this.exportDependencies.sampleTypeService
        ? this.exportDependencies.sampleTypeService.listOptions()
        : Promise.resolve([]),
      columns.includes("deliveryDate")
        ? Promise.all([...orderIds].map(async (orderId) => [
          orderId,
          await this.repository.listScanRecordsByOrderId(orderId)
        ] as const))
        : Promise.resolve([])
    ]);
    const orderById = new Map(
      orders.filter((order) => orderIds.has(order.id)).map((order) => [order.id, order])
    );
    const sampleTypeLabelByCode = new Map<string, string>(sampleTypeOptions.map((option) => [option.value, option.label]));
    const sampleRoundLabelByCode = new Map<string, string>(sampleRoundOptions.map((option) => [option.value, option.label]));
    const deliveryCompletedAtByOrderId = new Map(
      deliveryRecordsByOrder.map(([orderId, records]) => [orderId, latestQualifiedDeliveryAt(records)])
    );
    const contexts: Record<string, ReconciliationStatementExportContext> = {};

    for (const statement of selectedStatements) {
      const context: ReconciliationStatementExportContext = {};
      for (const item of statement.items.filter((candidate) => !candidate.returnedAt)) {
        const order = orderById.get(item.orderId);
        if (!order) continue;
        const deliveryCompletedAt = deliveryCompletedAtByOrderId.get(order.id);
        const exportItem: ReconciliationStatementExportContext[string] = {
          ...(columns.includes("orderCreatedDate") ? { orderCreatedAt: order.createdAt } : {}),
          ...(columns.includes("deliveryDate") && deliveryCompletedAt ? { deliveryCompletedAt } : {}),
          ...(columns.includes("sampleType")
            ? { sampleType: sampleTypeLabelByCode.get(order.sampleType) ?? order.sampleType }
            : {}),
          ...(columns.includes("sampleRound")
            ? { sampleRound: sampleRoundLabelByCode.get(order.sampleRound) ?? order.sampleRound }
            : {}),
          ...(columns.includes("otherChargeNote")
            ? { otherChargeNote: item.otherChargeNote ?? "" }
            : {})
        };

        if (columns.includes("thumbnail") && this.exportDependencies.fileStorage) {
          try {
            const attachment = preferredThumbnailAttachment(
              await this.repository.listOrderAttachments(order.id)
            );
            const extension = attachment ? thumbnailExtension(attachment.mimeType) : undefined;
            if (attachment?.storageKey && extension) {
              const bytes = await this.exportDependencies.fileStorage.readFile(attachment.storageKey);
              const size = simpleXlsxImageSize(bytes, extension);
              if (size) {
                exportItem.thumbnail = {
                  bytes,
                  extension,
                  width: size.width,
                  height: size.height,
                  altText: `${item.styleNo} ${item.styleName}`.trim()
                };
              }
            }
          } catch {
            // A missing or unreadable thumbnail leaves only this cell blank.
          }
        }
        context[item.orderId] = exportItem;
      }
      contexts[statement.id] = context;
    }

    return createStatementDownload(selectedStatements, columns, contexts);
  }

  async createReconciliationStatement(payload: StatementCreatePayload, currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    const generatedAt = new Date().toISOString();
    const orderIds = parseOrderIds(payload).sort();
    const sequenceKey = generatedAt.slice(0, 10);

    try {
      return await this.withCreationLock(() =>
        this.repository.withTransaction(async (repository) => {
          await repository.lockReconciliationCreation(sequenceKey);
          for (const orderId of orderIds) {
            await repository.lockOrderForWorkflow(orderId);
          }

          const [orders, pricingRecords, statements] = await Promise.all([
            repository.listOrders(),
            repository.listPricingRecords(),
            repository.listReconciliationStatements()
          ]);
          const orderById = new Map(orders.map((order) => [order.id, order]));
          const pricingByOrderId = new Map(pricingRecords.map((pricing) => [pricing.orderId, pricing]));
          const activeOrderIds = new Set(
            statements
              .filter((statement) => statement.status !== RECONCILIATION_STATEMENT_STATUSES.returned)
              .flatMap((statement) => statement.items.filter((item) => !item.returnedAt).map((item) => item.orderId))
          );
          const selectedOrders = orderIds.map((orderId) => {
            const order = orderById.get(orderId);
            if (!order) throw new HttpError(404, "order not found.");
            return order;
          });

          if (selectedOrders.some((order) => activeOrderIds.has(order.id))) {
            throw new HttpError(409, "部分订单已由其他操作生成对账单，列表已刷新。");
          }

          const firstOrder = selectedOrders[0]!;
          if (!selectedOrders.every((order) =>
            order.customerId === firstOrder.customerId && order.clientUserId === firstOrder.clientUserId
          )) {
            throw new HttpError(400, "请选择同一客户和业务员的订单生成对账单");
          }

          const items = await Promise.all(selectedOrders.map(async (order) => {
            const pricing = pricingByOrderId.get(order.id);
            if (!pricing) {
              throw new HttpError(400, "存在未定价订单，请先完成定价后再生成对账单");
            }
            const charges = await repository.listOrderChargesByOrderId(order.id);
            const eligibility = pricingReconciliationEligibility(
              pricing,
              summarizePricing(order, pricing, charges)
            );
            if (!eligibility.eligible) {
              if (eligibility.reason === "quotation_changed") {
                throw new HttpError(409, "报价已有新修改，请重新确认报价后再生成对账单。");
              }
              if (eligibility.reason === "quotation_snapshot_incomplete") {
                throw new HttpError(409, "报价快照不完整，请重新确认报价后再生成对账单。");
              }
              throw new HttpError(409, "请先确认客户报价，再生成对账单。");
            }
            return this.statementItem(order, pricing, charges, generatedAt);
          }));
          const receivableAmount = items.reduce((sum, item) => sum + item.receivableTotal, 0);
          const statement = await repository.createReconciliationStatement({
            statementNo: this.nextStatementNo(
              statements.map((record) => record.statementNo),
              new Date(generatedAt)
            ),
            customerName: firstOrder.customerName,
            salespersonName: firstOrder.salespersonName,
            billingPeriod: this.billingPeriod(selectedOrders),
            receivableAmount,
            generatedBy: currentUser.id,
            generatedAt,
            items
          });
          return { statement };
        })
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        ((error as { code?: unknown }).code === "P2002" ||
          (error as { code?: unknown }).code === "23505")
      ) {
        throw new HttpError(409, "部分订单已由其他操作生成对账单，列表已刷新。");
      }
      throw error;
    }
  }

  async returnReconciliationStatement(statementId: string, currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    return this.repository.withTransaction(async (repository) => {
      const statement = await this.lockStatementOrdersThenStatement(repository, statementId);

      if (statement.status === RECONCILIATION_STATEMENT_STATUSES.paid) {
        throw new HttpError(409, "已收款对账单不允许退回");
      }

      if (statement.status === RECONCILIATION_STATEMENT_STATUSES.returned) {
        return { statement };
      }

      const activeItems = statement.items.filter((candidate) => !candidate.returnedAt);
      const returnedAt = new Date().toISOString();
      for (const item of activeItems) {
        await repository.updateReconciliationStatementItem(item.id, {
          returnedAt,
          returnedBy: currentUser.id
        });
        const pricing = await repository.findPricingRecordByOrderId(item.orderId);
        if (pricing) {
          await repository.upsertPricingRecord(item.orderId, {
            quotationStatus: PRICING_QUOTATION_STATUSES.draft
          });
        }
      }

      return {
        statement: await repository.updateReconciliationStatement(statementId, {
          status: RECONCILIATION_STATEMENT_STATUSES.returned,
          returnedAt,
          returnedBy: currentUser.id
        })
      };
    });
  }

  async returnReconciliationStatementItem(
    statementId: string,
    itemId: string,
    currentUser: CurrentUser
  ) {
    this.ensureManager(currentUser);
    return this.repository.withTransaction(async (repository) => {
      const statement = await this.lockStatementOrdersThenStatement(repository, statementId);
      if (statement.status === RECONCILIATION_STATEMENT_STATUSES.paid) {
        throw new HttpError(409, "已收款对账单不允许退回订单");
      }
      if (statement.status === RECONCILIATION_STATEMENT_STATUSES.returned) {
        throw new HttpError(409, "已退回对账单不能再次退回订单");
      }
      const item = statement.items.find((candidate) => candidate.id === itemId);
      if (!item) throw new HttpError(404, "statement item not found.");
      if (item.returnedAt) return { statement };

      const returnedAt = new Date().toISOString();
      const withReturnedItem = await repository.updateReconciliationStatementItem(item.id, {
        returnedAt,
        returnedBy: currentUser.id
      });
      const pricing = await repository.findPricingRecordByOrderId(item.orderId);
      if (pricing) {
        await repository.upsertPricingRecord(item.orderId, {
          quotationStatus: PRICING_QUOTATION_STATUSES.draft
        });
      }
      const activeItems = withReturnedItem.items.filter((candidate) => !candidate.returnedAt);
      const updated = await repository.updateReconciliationStatement(statement.id, {
        ...(activeItems.length === 0
          ? {
              status: RECONCILIATION_STATEMENT_STATUSES.returned,
              returnedAt,
              returnedBy: currentUser.id
            }
          : {}),
        orderCount: activeItems.length,
        receivableAmount: activeItems.reduce((sum, candidate) => sum + candidate.receivableTotal, 0)
      });
      return { statement: updated };
    });
  }

  async paidStatementOrderIds() {
    const statements = await this.repository.listReconciliationStatements();
    return new Set(
      statements
        .filter((statement) => statement.status === RECONCILIATION_STATEMENT_STATUSES.paid)
        .flatMap((statement) => statement.items.filter((item) => !item.returnedAt).map((item) => item.orderId))
    );
  }

  async markReconciliationStatementPaid(statementId: string, currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    return this.repository.withTransaction(async (repository) => {
      const statement = await this.lockStatementOrdersThenStatement(repository, statementId);
      if (statement.status === RECONCILIATION_STATEMENT_STATUSES.returned) {
        throw new HttpError(409, "已退回对账单不能标记已收款");
      }
      if (statement.status === RECONCILIATION_STATEMENT_STATUSES.paid) {
        return { statement };
      }
      return {
        statement: await repository.updateReconciliationStatement(statementId, {
          status: RECONCILIATION_STATEMENT_STATUSES.paid,
          paidAmount: statement.receivableAmount,
          paidAt: new Date().toISOString(),
          paidBy: currentUser.id
        })
      };
    });
  }

  async undoReconciliationStatementPaid(statementId: string, currentUser: CurrentUser) {
    this.ensureManager(currentUser);
    return this.repository.withTransaction(async (repository) => {
      const statement = await this.lockStatementOrdersThenStatement(repository, statementId);
      if (statement.status !== RECONCILIATION_STATEMENT_STATUSES.paid) {
        throw new HttpError(409, "only a paid reconciliation statement can undo payment.");
      }

      return {
        statement: await repository.updateReconciliationStatement(statementId, {
          status: RECONCILIATION_STATEMENT_STATUSES.pendingPayment,
          paidAmount: 0,
          paidAt: null,
          paidBy: null
        })
      };
    });
  }
}
