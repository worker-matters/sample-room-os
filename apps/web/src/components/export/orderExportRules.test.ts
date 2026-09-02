import { describe, expect, it } from "vitest";
import type { OrderRecord } from "../../api/sampleRoomApi";
import {
  buildClientExportFilename,
  buildClientSelectedExportFilename,
  buildReceiverExportFilename,
  buildReceiverSelectedExportFilename,
  clientDefaultExportColumns,
  clientOptionalExportColumns,
  ensureXlsxExtension,
  exportRows,
  resolveOrderExportDataset,
  receiverDefaultExportColumns,
  receiverOptionalExportColumns,
  sanitizeFilenamePart
} from "./orderExportRules";

const fixedNow = new Date(2026, 5, 10, 15, 30);

const mockOrder: OrderRecord = {
  id: "order-1",
  orderNo: "V2-MOCK-0001",
  sourceType: "client_submission",
  customerId: "mock-customer-active",
  clientUserId: "mock-client-user-active",
  customerName: "Mock Active Customer",
  salespersonId: "mock-client-user-active",
  salespersonName: "客户A普通业务员",
  styleNo: "KH20260610",
  styleName: "连帽卫衣",
  quantity: 2,
  sampleType: "sample",
  sampleRound: "round_1",
  deliveryDate: "2026-06-17",
  remark: "客户备注",
  intakeStatus: "received",
  stage: "cutting_waiting",
  patternStatus: "has",
  patternSourceType: "customer_provided",
  sampleRequestItems: ["sample_garment", "pattern_making"],
  sampleGarmentRequired: true,
  fabricStatus: "complete",
  trimStatus: "partial",
  receivedAt: "2026-06-10T10:32:00.000Z",
  receivedBy: "receiver-user",
  returnReason: "缺少尺寸表",
  supplementCount: 0,
  createdAt: "2026-06-10T09:00:00.000Z",
  updatedAt: "2026-06-10T11:00:00.000Z",
  attachmentCount: 1,
  attachments: [
    {
      id: "attachment-1",
      orderId: "order-1",
      fileName: "tech-pack.pdf",
      mimeType: "application/pdf",
      size: 100,
      category: "client_requirement",
      uploadedBy: "客户A普通业务员",
      uploadedByRole: "client_business_user",
      createdAt: "2026-06-10T09:05:00.000Z",
      visibility: "client_visible"
    }
  ]
};

describe("role based order export rules", () => {
  it("defines receiver default columns for internal tracking", () => {
    expect(receiverDefaultExportColumns.map((column) => column.title)).toEqual([
      "款号",
      "款名",
      "客户",
      "客户业务员",
      "下单数量",
      "实际交货数量",
      "录入日期",
      "接单时间",
      "交期",
      "实际完成日期",
      "接单状态",
      "工序阶段",
      "面里料状态",
      "辅料状态",
      "单据位置",
      "附件数量",
      "最近操作人 / 最近更新人"
    ]);
    expect(receiverOptionalExportColumns.map((column) => column.title)).toContain("附件名称列表");
    expect(receiverOptionalExportColumns.map((column) => column.title)).toContain("最近更新时间");
  });

  it("defines client default columns for customer delivery and result review", () => {
    expect(clientDefaultExportColumns.map((column) => column.title)).toEqual([
      "客户业务员",
      "款号",
      "款名",
      "下单数量",
      "实际交货数量",
      "下单日期",
      "接单时间",
      "交期",
      "实际完成日期",
      "完成情况",
      "送达方式",
      "快递单号 / 送达备注"
    ]);
    expect(clientOptionalExportColumns.map((column) => column.title)).toContain("接单状态");
    expect(clientOptionalExportColumns.map((column) => column.title)).toContain("退回补充原因");
  });

  it("generates editable safe filenames for receiver exports", () => {
    expect(buildReceiverExportFilename({ keyword: "" }, fixedNow)).toBe(
      "接单员_订单全量_2026-06-10_1530.xlsx"
    );
    expect(buildReceiverSelectedExportFilename(fixedNow)).toBe(
      "接单员_勾选订单_2026-06-10_1530.xlsx"
    );
    expect(
      buildReceiverExportFilename(
        { keyword: "", status: "stage:done", startDate: "2026-06-01", endDate: "2026-06-10" },
        fixedNow
      )
    ).toBe("接单员_订单查询_已完成_2026-06-01_to_2026-06-10_1530.xlsx");
    expect(ensureXlsxExtension("接单员_订单查询")).toBe("接单员_订单查询.xlsx");
  });

  it("generates editable safe filenames for client exports", () => {
    expect(buildClientExportFilename({ keyword: "" }, "MockActiveCustomer", fixedNow)).toBe(
      "MockActiveCustomer_订单全量_2026-06-10_1530.xlsx"
    );
    expect(buildClientSelectedExportFilename("MockActiveCustomer", fixedNow)).toBe(
      "MockActiveCustomer_勾选订单_2026-06-10_1530.xlsx"
    );
    expect(
      buildClientExportFilename(
        { keyword: "", status: "stage:done", startDate: "2026-06-01", endDate: "2026-06-10" },
        "Mock/Active:Customer",
        fixedNow
      )
    ).toBe("Mock_Active_Customer_已完成订单_2026-06-01_to_2026-06-10_1530.xlsx");
    expect(sanitizeFilenamePart("Mock/Active:Customer")).toBe("Mock_Active_Customer");
  });

  it("exports only selected safe columns and does not include internal order numbers", () => {
    const rows = exportRows([mockOrder], clientDefaultExportColumns);
    const flattened = rows.flat().join("|");

    expect(flattened).toContain("KH20260610");
    expect(flattened).toContain("连帽卫衣");
    expect(flattened).not.toContain("V2-MOCK-0001");
    expect(flattened).not.toContain("scanToken");
    expect(flattened).not.toContain("cost");
    expect(flattened).not.toContain("price");
  });

  it("prioritizes selected rows over filters and keeps current visible order", () => {
    const first = { ...mockOrder, id: "order-1", styleNo: "A-001" };
    const second = { ...mockOrder, id: "order-2", styleNo: "A-002" };
    const third = { ...mockOrder, id: "order-3", styleNo: "A-003" };
    const filters = { keyword: "A" };

    expect(resolveOrderExportDataset([first, second, third], ["order-3", "order-1"], filters)).toEqual({
      orders: [first, third],
      scope: "selected"
    });
    expect(resolveOrderExportDataset([first, second], [], filters)).toEqual({
      orders: [first, second],
      scope: "filtered"
    });
    expect(resolveOrderExportDataset([first, second], [], { keyword: "" })).toEqual({
      orders: [first, second],
      scope: "all"
    });
    expect(resolveOrderExportDataset([first, second], ["hidden-order"], filters)).toEqual({
      orders: [first, second],
      scope: "filtered"
    });
  });
});
