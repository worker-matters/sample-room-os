import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("planner workbench source", () => {
  const source = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "PlannerWorkbenchPage.tsx",
    ),
    "utf8",
  );
  const apiSource = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../api/sampleRoomApi.ts",
    ),
    "utf8",
  );
  const collaborationDialogSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "PlannerCollaborationDialog.tsx"),
    "utf8",
  );
  const appSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../app/App.tsx"),
    "utf8",
  );
  const cssSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../app/styles.css"),
    "utf8",
  );

  it("shows the planner progress visibility workflow without sewing assignment controls", () => {
    expect(source).toContain("计划员工作台");
    expect(source).toContain("计划员手机端");
    expect(source).toContain("全部订单");
    expect(source).toContain("待缝制（");
    expect(source).toContain("缝制中（");
    expect(source).toContain("planner-reference-sidebar");
    expect(source).toContain("planner-reference-metrics");
    expect(source).toContain('label: "已完成"');
    expect(source).toContain('key: "waiting"');
    expect(source).toContain('key: "in-progress"');
    expect(source).toContain('...getQuickDateRange("month")');
    expect(source).toContain('quickDateRange: "month"');
    expect(source).toContain("缝制人员");
    expect(source).toContain("planner-filter-card");
    expect(source).toContain("搜款号 / 款名 / 客户 / 业务员 / 备注");
    expect(source).toContain("全部客户");
    expect(source).toContain("全部业务员");
    expect(source).toContain("全部状态");
    expect(source).toContain("全部样衣类型");
    expect(source).toContain("全部轮次");
    expect(source).toContain("本周");
    expect(source).toContain("本月");
    expect(source).toContain("近三月");
    expect(source).toContain("自定义时间");
    expect(source).toContain("录入：");
    expect(source).toContain("交期：");
    expect(source).toContain("件数");
    expect(source).toContain("样品类型");
    expect(source).toContain("轮次");
    expect(source).not.toContain("样衣/件数");
    expect(source).toContain("接手时间");
    expect(source).toContain("OrderTable");
    expect(source).toContain("plannerOrderTitleCell");
    expect(source).toContain("plannerCustomerContext");
    expect(source).toContain("planner-receiver-style-order-list");
    expect(source).toContain("const sewingColumns");
    expect(source).toContain("render: (_value, order) => plannerOrderTitleCell(order)");
    expect(source).not.toContain('title: "日期"');
    expect(source).toContain("customerOptions");
    expect(source).toContain("salespersonOptions");
    expect(source).toContain("matchesCreatedDateRange");
    expect(source).toContain("getQuickDateRange");
    expect(source).toContain("planner-dense-table");
    expect(source).toContain('tableLayout="fixed"');
    expect(source).toContain('title: "款式 / 款号"');
    expect(source).toContain('title: "客户 / 业务员"');
    expect(source).toContain("planner-mobile-info-block");
    expect(source).toContain("款式 / 款号");
    expect(source).toContain("客户 / 业务员");
    expect(source).toContain('scroll={{ x: 1200, y: "100%", scrollToFirstRowOnChange: true }}');
    expect(source).toContain('className="order-scroll-table planner-order-table planner-dense-table data-workspace-table"');
    expect(source).not.toContain('title: "物料状态"');
    expect(source).not.toContain("选择缝制员工");
    expect(source).not.toContain("assignPlannerSewing");
  });

  it("uses the planner's own vertical navigation and preserves the shared full-height order workspace", () => {
    expect(appSource).toContain('const plannerDedicatedNavigation = location.pathname === "/planner"');
    expect(appSource).toContain("{plannerDedicatedNavigation ? null : (");
    expect(cssSource).toContain(".planner-reference-table > .receiver-list-panel");
    expect(cssSource).toContain(".planner-reference-table > .planner-doing-data-workspace");
    expect(cssSource).toContain("flex: 1 1 auto;");
    expect(cssSource).toContain("overflow: hidden;");
  });

  it("presents collaboration performance as a neutral report and only warns when active work remains", () => {
    expect(collaborationDialogSource).toContain("已申报绩效：{collaboration.completedPieces}件");
    expect(collaborationDialogSource).toContain("绩效数量待确认");
    expect(collaborationDialogSource).toContain("当前仍有 ${collaboration.activeParticipantCount} 名员工在缝制");
    expect(collaborationDialogSource).toContain("collaboration.completedPieces >= collaboration.quantity && collaboration.activeParticipantCount > 0");
    expect(collaborationDialogSource).toContain("绩效件数仅老板可更正");
    expect(collaborationDialogSource).toContain("确认取消参与");
    expect(collaborationDialogSource).toContain("仅适用于误加入或实际未参与的情况");
    expect(collaborationDialogSource).not.toContain("数量门槛已达到");
    expect(collaborationDialogSource).not.toContain("实际完成还差");
    expect(collaborationDialogSource).not.toContain("暂未分配");
  });

  it("uses planner-specific APIs instead of client or receiver APIs", () => {
    expect(source).toContain("listPlannerOrders");
    expect(source).not.toContain("listPlannerSewingWorkers");
    expect(source).not.toContain("assignPlannerSewing");
    expect(apiSource).toContain("listPlannerOrders");
    expect(apiSource).toContain("/api/planner/orders");
  });

  it("shows the planner order source and creator supplied by the planner DTO", () => {
    expect(apiSource).toContain(
      'sourceType: "client_submission" | "receiver_self_entry" | "internal_manual";',
    );
    expect(apiSource).toContain("createdByName?: string;");
    expect(source).toContain('order.sourceType === "client_submission"');
    expect(source).toContain('return "客户提交"');
    expect(source).toContain('return "接单员录入"');
    expect(source).toContain('return "内部录入"');
    expect(source).toContain('return order.createdByName ?? "－"');
  });

  it("separates detail browsing into tabs and keeps charge entry in the order list", () => {
    expect(source).toContain("planner-order-detail-tabs");
    expect(source).toContain('label: "订单概览"');
    expect(source).toContain('label: `资料与附件');
    expect(source).toContain('label: `扫码记录');
    expect(source).toContain('title: "操作"');
    expect(source).toContain("追加费用");
    expect(source).toContain("ReceiverOrderChargeModal");
    expect(source).toContain('sourceScene="planner_order_list"');
    expect(source).toContain("PlannerOrderThumbnail");
    expect(source).toContain("receiver-detail-hero");
    expect(source).toContain("receiver-detail-hero-meta");
    expect(source).toContain("<ParallelProgress");
    expect(source).not.toContain("订单号：{selectedOrder.orderNo}");
    expect(source).not.toContain("订单号：{order.orderNo}");
    expect(source).not.toContain("打样单照片");
    expect(source).toContain("OrderChargeReadOnlyPanel");
    expect(source).toContain('key: "charges"');
    expect(source).toContain("showAdvancedFilters");
    expect(source).toContain("loadDeliverablePreview");
    expect(source).toContain("addPlannerOrderAttachments");
    expect(source).toContain("OrderAttachmentPanel");
    expect(source).toContain("key={selectedOrder.id}");
    expect(source).toContain("compact");
    expect(source).toContain("showAdvancedFilters");
    expect(source).toContain("查看详情");
    expect(source).toContain('className="planner-order-detail-modal order-detail-fixed-height-modal"');
    expect(source).toContain("style={{ top: 24 }}");
    expect(source).not.toContain("<Drawer");
    expect(source).toContain("openChargeDialog");
    expect(source).not.toContain("planner_order_detail");
    expect(source).not.toContain("planner_scan_charge");
    expect(source).not.toContain("addPlannerOrderChargeByScanToken");
    expect(source).not.toContain("校正资料");
    expect(source).not.toContain("打印二维码");
    expect(source).not.toContain("面辅料记录");
    expect(source.match(/className="planner-order-detail-modal order-detail-fixed-height-modal"/g)).toHaveLength(1);
    expect(source).toContain("onOrderClick={openPlannerOrder}");
    expect(source).toContain('? renderOrderView(desktopCurrentOrders, sewingColumns, "waiting")');
    expect(source).toContain('? renderOrderView(desktopCurrentOrders, sewingColumns, "doing")');
    expect(source).toContain("operationColumn,");
  });
});
