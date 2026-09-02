import { randomUUID } from "node:crypto";
import type { SampleRoomRepository } from "./sampleRoomRepository.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type {
  CustomerChargeItemCreateInput,
  CustomerChargeItemRecord,
  CustomerChargeItemUpdateInput,
  PricingRecord,
  PricingUpdateInput,
  ReconciliationStatementCreateInput,
  ReconciliationStatementItemUpdateInput
} from "../../modules/pricing/pricingTypes.js";
import {
  currentPricingOperationMode,
  currentPricingQuantityActor
} from "../../modules/pricing/pricingQuantityActorContext.js";
import { confirmedSettlementQuantity } from "../../modules/pricing/settlementQuantity.js";
import { withEffectiveQcCheckedPieces } from "../../modules/qc/qcCheckedPiecesCorrections.js";
import { withEffectiveProcessPieces } from "../../modules/scan/processPiecesCorrections.js";

const wrappedRepositories = new WeakMap<object, SampleRoomRepository>();

function isMainSampleQuantityRow(
  item: Pick<CustomerChargeItemRecord, "pricingMethod" | "sourceTask">
) {
  return item.pricingMethod === "unit_quantity" &&
    (item.sourceTask === "生产样衣" || item.sourceTask === "生产小样");
}

function requirePieceQuantity(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, "样衣/小样数量必须是大于 0 的整数。");
  }
  return value;
}

function pricingContainingItem(
  records: readonly PricingRecord[],
  itemId: string
) {
  return records.find((pricing) =>
    pricing.customerChargeItems?.some((item) => item.id === itemId && !item.archivedAt)
  );
}

async function settleOrderQuantity(
  repository: SampleRoomRepository,
  orderId: string,
  changedAt = new Date().toISOString()
) {
  const [order, pricing] = await Promise.all([
    repository.findOrderById(orderId),
    repository.findPricingRecordByOrderId(orderId)
  ]);
  if (!order) return undefined;

  const quantity = confirmedSettlementQuantity(order.quantity, pricing);
  if (quantity !== order.quantity) {
    const actor = currentPricingQuantityActor();
    const correctionLogs = actor
      ? [
          ...order.correctionLogs,
          {
            id: randomUUID(),
            changedAt,
            changedByRole: actor.role,
            changedByAccountId: actor.accountId ?? actor.id,
            ...(actor.displayName ? { changedByName: actor.displayName } : {}),
            fieldName: "quantity",
            oldValue: order.quantity,
            newValue: quantity
          }
        ]
      : order.correctionLogs;
    await repository.updateOrder(order.id, {
      quantity,
      ...(actor ? { correctionLogs } : {})
    });
  }
  return quantity;
}

export function withQcCheckedPiecesCorrections(
  repository: SampleRoomRepository
): SampleRoomRepository {
  const existing = wrappedRepositories.get(repository as object);
  if (existing) return existing;

  const proxy = new Proxy(repository, {
    get(target, property) {
      if (property === "listScanRecordsByOrderId") {
        return async (orderId: string) => {
          const [order, records] = await Promise.all([
            target.findOrderById(orderId),
            target.listScanRecordsByOrderId(orderId)
          ]);
          return order
            ? records.map((record) =>
                withEffectiveQcCheckedPieces(order, withEffectiveProcessPieces(order, record))
              )
            : records;
        };
      }

      if (property === "createCustomerChargeItem") {
        return async (input: CustomerChargeItemCreateInput) => {
          if (isMainSampleQuantityRow(input)) {
            requirePieceQuantity(input.quantity);
          }
          return target.createCustomerChargeItem(input);
        };
      }

      if (property === "updateCustomerChargeItem") {
        return async (itemId: string, input: CustomerChargeItemUpdateInput) => {
          const pricing = pricingContainingItem(await target.listPricingRecords(), itemId);
          const current = pricing?.customerChargeItems?.find(
            (item) => item.id === itemId && !item.archivedAt
          );
          if (current) {
            const candidate = {
              ...current,
              ...input,
              sourceTask: input.sourceTask === null
                ? undefined
                : input.sourceTask ?? current.sourceTask
            };
            if (isMainSampleQuantityRow(candidate)) {
              requirePieceQuantity(candidate.quantity);
            }
          }
          return target.updateCustomerChargeItem(itemId, input);
        };
      }

      if (property === "upsertPricingRecord") {
        return async (orderId: string, input: PricingUpdateInput) => {
          if (
            input.quotationStatus === "draft" &&
            currentPricingOperationMode() === "statement_return"
          ) {
            const current = await target.findPricingRecordByOrderId(orderId);
            if (current?.quotationStatus === "confirmed") {
              return current;
            }
          }

          const pricing = await target.upsertPricingRecord(orderId, input);
          if (
            currentPricingOperationMode() === "pricing_confirm" &&
            input.quotationStatus === "confirmed" &&
            pricing.confirmedCustomerChargeSnapshot?.length
          ) {
            await settleOrderQuantity(
              target,
              orderId,
              input.confirmedAt ?? new Date().toISOString()
            );
          }
          return pricing;
        };
      }

      if (property === "createReconciliationStatement") {
        return async (input: ReconciliationStatementCreateInput) => {
          const items = await Promise.all(
            input.items.map(async (item) => {
              const quantity = await settleOrderQuantity(target, item.orderId, input.generatedAt);
              return quantity === undefined ? item : { ...item, quantity };
            })
          );
          return target.createReconciliationStatement({ ...input, items });
        };
      }

      if (property === "updateReconciliationStatementItem") {
        return async (id: string, input: ReconciliationStatementItemUpdateInput) => {
          if (input.quantity === undefined) {
            return target.updateReconciliationStatementItem(id, input);
          }

          const statement = (await target.listReconciliationStatements()).find((candidate) =>
            candidate.items.some((item) => item.id === id)
          );
          const item = statement?.items.find((candidate) => candidate.id === id);
          if (!item) {
            return target.updateReconciliationStatementItem(id, input);
          }

          const quantity = await settleOrderQuantity(target, item.orderId);
          return target.updateReconciliationStatementItem(
            id,
            quantity === undefined ? input : { ...input, quantity }
          );
        };
      }

      if (property === "withTransaction") {
        return <T>(
          operation: (transactionRepository: SampleRoomRepository) => T | Promise<T>
        ) => target.withTransaction((transactionRepository) =>
          operation(withQcCheckedPiecesCorrections(transactionRepository))
        );
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as SampleRoomRepository;

  wrappedRepositories.set(repository as object, proxy);
  wrappedRepositories.set(proxy as object, proxy);
  return proxy;
}
