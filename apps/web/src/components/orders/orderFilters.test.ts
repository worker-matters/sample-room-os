import { describe, expect, it } from "vitest";
import type { OrderRecord } from "../../api/sampleRoomApi";
import {
  buildSalespersonOptions,
  clientOrderStatusFilterOptions,
  clientSampleRoundFilterOptions,
  createCurrentMonthOrderFilters,
  defaultOrderFilters,
  filterOrders,
  getQuickDateRange
} from "./orderFilters";
import { buildClientAdminBusinessStats } from "./clientAdminStatsModel";

function order(overrides: Partial<OrderRecord>): OrderRecord {
  return {
    id: "order-1",
    orderNo: "V2-MOCK-0001",
    sourceType: "client_submission",
    customerId: "mock-customer-active",
    clientUserId: "mock-client-user-active",
    customerName: "Mock Active Customer",
    salespersonId: "mock-client-user-active",
    salespersonName: "Mock Client User",
    customerSnapshot: { id: "mock-customer-active", name: "Mock Active Customer" },
    clientUserSnapshot: { id: "mock-client-user-active", displayName: "Mock Client User" },
    styleNo: "ST-001",
    styleName: "Demo Jacket",
    quantity: 1,
    sampleType: "first_sample",
    sampleRound: "round_1",
    deliveryDate: "2026-06-30",
    remark: "standard remark",
    intakeStatus: "pending_receive",
    stage: null,
    patternStatus: "none",
    patternSourceType: "none",
    sampleRequestItems: ["sample_garment", "pattern_making"],
    sampleGarmentRequired: true,
    fabricStatus: "missing",
    trimStatus: "partial",
    supplementCount: 0,
    createdAt: "2026-06-09T01:00:00.000Z",
    updatedAt: "2026-06-09T01:00:00.000Z",
    attachmentCount: 0,
    ...overrides
  };
}

describe("orderFilters", () => {
  const orders = [
    order({ id: "a", styleNo: "ST-ALPHA-001", styleName: "Linen Jacket" }),
    order({
      id: "b",
      orderNo: "V2-MOCK-0002",
      styleNo: "ST-BETA-002",
      styleName: "Silk Dress",
      remark: "other customer remark",
      customerId: "mock-customer-other",
      customerName: "Mock Other Customer",
      salespersonId: "mock-client-user-other",
      salespersonName: "Mock Other Client User",
      stage: "cutting_waiting",
      patternStatus: "has",
      fabricStatus: "complete",
      trimStatus: "complete",
      intakeStatus: "received",
      createdAt: "2026-06-02T01:00:00.000Z"
    })
  ];

  it("matches keyword against style number and style name", () => {
    expect(filterOrders(orders, { ...defaultOrderFilters, keyword: "alpha" })).toHaveLength(1);
    expect(filterOrders(orders, { ...defaultOrderFilters, keyword: "dress" })).toHaveLength(1);
    expect(filterOrders(orders, { ...defaultOrderFilters, keyword: "0001" })).toHaveLength(1);
    expect(filterOrders(orders, { ...defaultOrderFilters, keyword: "standard" })).toHaveLength(1);
  });

  it("filters by customer and linked salesperson", () => {
    expect(
      filterOrders(orders, {
        ...defaultOrderFilters,
        customerId: "mock-customer-other",
        salespersonId: "mock-client-user-other"
      }).map((item) => item.id)
    ).toEqual(["b"]);

    expect(buildSalespersonOptions(orders, "mock-customer-other")).toEqual([
      { label: "Mock Other Client User", value: "mock-client-user-other" }
    ]);
  });

  it("filters status across intake, stage, pattern, fabric, and trim fields", () => {
    expect(filterOrders(orders, { ...defaultOrderFilters, status: "intakeStatus:pending_receive" })).toHaveLength(1);
    expect(filterOrders(orders, { ...defaultOrderFilters, status: "stage:cutting_waiting" })).toHaveLength(1);
    expect(filterOrders(orders, { ...defaultOrderFilters, status: "patternStatus:has" })).toHaveLength(1);
    expect(filterOrders(orders, { ...defaultOrderFilters, status: "fabricStatus:complete" })).toHaveLength(1);
    expect(filterOrders(orders, { ...defaultOrderFilters, status: "trimStatus:partial" })).toHaveLength(1);
    expect(filterOrders(orders, { ...defaultOrderFilters, status: "receiverActiveTracking" }).map((item) => item.id)).toEqual(["b"]);
  });

  it("exposes client-visible status options aligned with intake and workflow stages", () => {
    expect(clientOrderStatusFilterOptions.map((option) => option.label)).toEqual([
      "接单：待接单",
      "接单：已接单",
      "接单：待客户补充",
      "工序：待制版",
      "工序：制版中",
      "工序：待裁剪",
      "工序：裁剪中",
      "工序：待缝制",
      "工序：缝制中",
      "工序：待组检/出库",
      "工序：已完成"
    ]);
  });

  it("filters client orders by sample type code and shared sample round dictionary", () => {
    expect(clientSampleRoundFilterOptions.some((option) => option.value === "round_1")).toBe(true);
    expect(filterOrders(orders, { ...defaultOrderFilters, sampleType: "first_sample" })).toHaveLength(2);
    expect(filterOrders(orders, { ...defaultOrderFilters, sampleType: "fit_sample" })).toHaveLength(0);
    expect(filterOrders(orders, { ...defaultOrderFilters, sampleRound: "round_1" })).toHaveLength(2);
  });

  it("filters by quick ranges and date range on createdAt", () => {
    expect(getQuickDateRange("week", new Date("2026-06-09T12:00:00+08:00"))).toEqual({
      startDate: "2026-06-08",
      endDate: "2026-06-14"
    });
    expect(getQuickDateRange("quarter", new Date("2026-06-09T12:00:00+08:00"))).toEqual({
      startDate: "2026-04-01",
      endDate: "2026-06-30"
    });
    expect(createCurrentMonthOrderFilters(new Date("2026-06-09T12:00:00+08:00"))).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      quickDateRange: "month"
    });
    expect(
      filterOrders(orders, { ...defaultOrderFilters, startDate: "2026-06-08", endDate: "2026-06-14" })
    ).toHaveLength(1);
  });

  it("filters by delivery date and independent material status fields", () => {
    expect(
      filterOrders(orders, {
        ...defaultOrderFilters,
        deliveryStartDate: "2026-06-29",
        deliveryEndDate: "2026-06-30"
      })
    ).toHaveLength(2);
    expect(filterOrders(orders, { ...defaultOrderFilters, deliveryStartDate: "2026-07-01" })).toHaveLength(0);
    expect(filterOrders(orders, { ...defaultOrderFilters, patternStatus: "none" })).toHaveLength(1);
    expect(filterOrders(orders, { ...defaultOrderFilters, fabricStatus: "complete" })).toHaveLength(1);
    expect(filterOrders(orders, { ...defaultOrderFilters, trimStatus: "partial" })).toHaveLength(1);
  });

  it("reset filters return all orders", () => {
    expect(filterOrders(orders, { ...defaultOrderFilters })).toHaveLength(2);
  });

  it("builds client admin business-user statistics from the authorized current dataset", () => {
    const stats = buildClientAdminBusinessStats([
      order({
        id: "user-a-1",
        quantity: 3,
        salespersonId: "client-a",
        salespersonName: "Client A",
        stage: "done",
        completionStatus: "completed",
        intakeStatus: "received"
      }),
      order({
        id: "user-a-2",
        quantity: 2,
        salespersonId: "client-a",
        salespersonName: "Client A",
        stage: "cutting_waiting",
        completionStatus: "in_progress",
        intakeStatus: "received"
      }),
      order({
        id: "user-b-1",
        quantity: 5,
        salespersonId: "client-b",
        salespersonName: "Client B",
        stage: "done",
        completionStatus: "completed",
        intakeStatus: "received"
      })
    ]);

    expect(stats.summary).toEqual({
      orderCount: 3,
      completedOrderCount: 2,
      arrangedQuantity: 10,
      completedQuantity: 8
    });
    expect(stats.rows).toEqual([
      {
        businessUserId: "client-a",
        businessUserName: "Client A",
        orderCount: 2,
        completedOrderCount: 1,
        arrangedQuantity: 5,
        completedQuantity: 3,
        completionRate: 60
      },
      {
        businessUserId: "client-b",
        businessUserName: "Client B",
        orderCount: 1,
        completedOrderCount: 1,
        arrangedQuantity: 5,
        completedQuantity: 5,
        completionRate: 100
      }
    ]);
  });
});
