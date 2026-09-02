import { ROLES } from "@sample-room/shared";
import { describe, expect, it, vi } from "vitest";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import type { CurrentUser } from "../auth/currentUser.js";
import { OrderChargeService } from "./orderChargeService.js";
import {
  currentConfirmedCustomerQuotation,
  pricingReconciliationEligibility,
  summarizePricing
} from "./pricingCalculationService.js";
import {
  CUSTOMER_CHARGE_PRICING_METHODS,
  ORDER_CHARGE_STATUSES,
  PRICING_ITEM_SOURCE_TYPES,
  PRICING_QUOTATION_STATUSES,
  RECONCILIATION_STATEMENT_STATUSES,
  type OrderChargeRecord,
  type PricingRecord
} from "./pricingTypes.js";

const now = "2026-08-22T12:00:00.000Z";

function confirmedPricing(): PricingRecord {
  const customerCharge = {
    id: "customer-charge-1",
    pricingRecordId: "pricing-1",
    name: "样衣费",
    pricingMethod: CUSTOMER_CHARGE_PRICING_METHODS.fixed,
    amount: 500,
    sourceType: PRICING_ITEM_SOURCE_TYPES.manual,
    createdAt: now,
    updatedAt: now
  };
  return {
    id: "pricing-1",
    orderId: "order-1",
    quotationStatus: PRICING_QUOTATION_STATUSES.confirmed,
    confirmedAt: now,
    confirmedBy: "boss-1",
    confirmedCustomerChargeSnapshot: [customerCharge],
    confirmedCustomerQuoteSubtotal: 500,
    confirmedOtherChargeSnapshot: [],
    confirmedOtherChargeTotal: 0,
    confirmedReceivableTotal: 500,
    customerChargeItems: [customerCharge],
    extraCharges: [],
    createdAt: now,
    updatedAt: now
  };
}

function effectiveCharge(amount: number): OrderChargeRecord {
  return {
    id: "order-charge-1",
    orderId: "order-1",
    name: "快递费",
    amount,
    explanation: "实际发生费用",
    sourceScene: "manual",
    creatorId: "receiver-1",
    creatorName: "Receiver",
    creatorRole: ROLES.receiver,
    status: ORDER_CHARGE_STATUSES.effective,
    createdAt: now,
    updatedAt: now
  };
}

function receiverUser(): CurrentUser {
  return {
    id: "receiver-1",
    username: "receiver",
    displayName: "Receiver",
    role: ROLES.receiver
  } as CurrentUser;
}

function chargeRepository(options: { reconciled?: boolean } = {}) {
  const pricing = confirmedPricing();
  const mock = {
    withTransaction: vi.fn(async (operation: (repository: SampleRoomRepository) => Promise<unknown>) =>
      operation(mock as unknown as SampleRoomRepository)
    ),
    lockOrderForWorkflow: vi.fn(async () => undefined),
    findOrderById: vi.fn(async () => ({ id: "order-1", terminated: false })),
    findPricingRecordByOrderId: vi.fn(async () => pricing),
    listReconciliationStatements: vi.fn(async () =>
      options.reconciled
        ? [
            {
              id: "statement-1",
              status: RECONCILIATION_STATEMENT_STATUSES.pendingPayment,
              items: [{ id: "item-1", orderId: "order-1" }]
            }
          ]
        : []
    ),
    createOrderCharge: vi.fn(async (input: Record<string, unknown>) => ({
      id: "order-charge-1",
      ...input,
      createdAt: now,
      updatedAt: now
    })),
    listOrderAttachments: vi.fn(async () => [])
  };
  return { mock, repository: mock as unknown as SampleRoomRepository };
}

describe("dynamic other charges after quotation confirmation", () => {
  it("keeps OrderCharge writable after the base quotation is confirmed", async () => {
    const { mock, repository } = chargeRepository();
    const service = new OrderChargeService(repository);

    await expect(
      service.create(
        "order-1",
        { name: "快递费", amount: 80, explanation: "实际快递" },
        receiverUser()
      )
    ).resolves.toMatchObject({
      orderId: "order-1",
      amount: 80,
      status: ORDER_CHARGE_STATUSES.effective
    });

    expect(mock.createOrderCharge).toHaveBeenCalledOnce();
    expect(mock.findPricingRecordByOrderId).not.toHaveBeenCalled();
  });

  it("still rejects other-charge writes after an active reconciliation statement exists", async () => {
    const { repository } = chargeRepository({ reconciled: true });
    const service = new OrderChargeService(repository);

    await expect(
      service.create("order-1", { name: "快递费", amount: 80 }, receiverUser())
    ).rejects.toThrow("当前订单已进入对账单，如需增加费用，请联系老板退回该款式");
  });

  it("keeps the confirmed base quote fixed while live effective charges change receivable", () => {
    const pricing = confirmedPricing();
    const order = {
      id: "order-1",
      quantity: 1,
      sampleRequestItems: []
    };

    const with80 = [effectiveCharge(80)];
    const quote80 = currentConfirmedCustomerQuotation(pricing, undefined, with80);
    const summary80 = summarizePricing(order, pricing, with80);
    expect(quote80).toMatchObject({
      customerQuoteSubtotal: 500,
      effectiveCustomerOtherCharges: 80,
      receivableTotal: 580
    });
    expect(pricingReconciliationEligibility(pricing, summary80)).toEqual({ eligible: true });

    const with100 = [effectiveCharge(100)];
    const quote100 = currentConfirmedCustomerQuotation(pricing, undefined, with100);
    expect(quote100).toMatchObject({
      customerQuoteSubtotal: 500,
      effectiveCustomerOtherCharges: 100,
      receivableTotal: 600
    });

    const voided = [{
      ...effectiveCharge(100),
      status: ORDER_CHARGE_STATUSES.void,
      archivedAt: now
    }];
    const quoteAfterVoid = currentConfirmedCustomerQuotation(pricing, undefined, voided);
    const summaryAfterVoid = summarizePricing(order, pricing, voided);
    expect(quoteAfterVoid).toMatchObject({
      customerQuoteSubtotal: 500,
      effectiveCustomerOtherCharges: 0,
      receivableTotal: 500
    });
    expect(pricingReconciliationEligibility(pricing, summaryAfterVoid)).toEqual({ eligible: true });
  });
});
