import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { OrderAttachment, ScanRecord } from "../../api/sampleRoomApi";
import { orderCompletionLabel } from "../operations/OrderCompletionStatus";
import {
  scanRecordNoteLabel,
  scanRecordQualityScoreLabel,
  scanRecordTitle
} from "../scan/scanDisplay";
import { bossQcAction } from "./BossOrderManagementPanel";
import {
  initialCorrectionSampleRequestItems,
  receiverSampleSheetAttachment
} from "./ReceiverCorrectionModal";
import { getOrderThumbnailAttachment } from "./orderThumbnail";

const componentDir = dirname(fileURLToPath(import.meta.url));
const webSrcDir = resolve(componentDir, "../..");

function read(relativePath: string) {
  return readFileSync(resolve(webSrcDir, relativePath), "utf8").replaceAll("\r\n", "\n");
}

function thumbnailAttachment(
  id: string,
  category: string,
  hasFile = true
): OrderAttachment {
  return {
    id,
    orderId: "order-thumbnail",
    fileName: `${id}.jpg`,
    mimeType: "image/jpeg",
    size: 128,
    category,
    createdAt: "2026-07-24T00:00:00.000Z",
    visibility: "client_visible",
    hasFile
  };
}

describe("order thumbnail selection", () => {
  it("prefers the Android-selected style thumbnail over other image attachments", () => {
    const receiverPhoto = thumbnailAttachment("receiver-photo", "receiver_quick_photo");
    const styleThumbnail = thumbnailAttachment("style-thumbnail", "style_thumbnail");

    expect(
      getOrderThumbnailAttachment({
        attachments: [receiverPhoto, styleThumbnail]
      })
    ).toBe(styleThumbnail);
  });
});

describe("boss sewing workforce visibility", () => {
  it("shows the worker column only for the sewing-doing quick view and exposes collaborator names by tooltip", () => {
    const source = read("components/orders/BossOrderManagementPanel.tsx");
    expect(source).toContain('title: "缝制员工"');
    expect(source).toContain("showSewingWorkerColumn");
    expect(source).toContain("workforce.workerNames.join(\"、\")");
    expect(source).toContain('<Tag color="blue">多人</Tag>');
    expect(source).toContain('<Tag color="blue">协作</Tag>');
  });
});

describe("receiver correction defaults", () => {
  it("keeps an uncorrected pending-receive order's task selection unchanged", () => {
    expect(
      initialCorrectionSampleRequestItems({
        intakeStatus: "pending_receive",
        sampleRequestItems: ["sample_garment", "pattern_making"],
        correctionLogs: []
      })
    ).toEqual(["sample_garment", "pattern_making"]);
  });

  it("keeps a quick-photo draft empty until the receiver selects tasks", () => {
    expect(
      initialCorrectionSampleRequestItems({
        intakeStatus: "pending_receive",
        sampleRequestItems: [],
        correctionLogs: []
      })
    ).toEqual([]);
  });

  it("keeps an already saved task correction unchanged", () => {
    expect(
      initialCorrectionSampleRequestItems({
        intakeStatus: "pending_receive",
        sampleRequestItems: ["sample_garment", "pattern_making"],
        correctionLogs: [
          {
            id: "correction-1",
            fieldName: "sampleRequestItems",
            oldValue: "sample_garment,cutting,pattern_making",
            newValue: "sample_garment,pattern_making",
            changedAt: "2026-07-12T00:00:00.000Z",
            changedByRole: "receiver",
            changedByUserId: "receiver-1",
            changedByName: "Receiver"
          }
        ]
      })
    ).toEqual(["sample_garment", "pattern_making"]);
  });

  it("prefers an explicit sample sheet, then a receiver thumbnail, then a client quick photo", () => {
    const attachment = (id: string, category: string, uploadedBy = "receiver-1", uploadedByRole = "receiver") => ({
      id,
      orderId: "order-1",
      fileName: `${id}.pdf`,
      mimeType: "application/pdf",
      size: 10,
      category,
      uploadedBy,
      uploadedByRole,
      visibility: "client_visible",
      createdAt: "2026-07-14T00:00:00.000Z",
      hasFile: true
    }) as OrderAttachment;
    const first = attachment("first", "receiver_quick_photo");
    const selected = attachment("selected", "receiver_sample_sheet");
    const clientPhoto = attachment("client-photo", "client_quick_photo", "client-1", "client_business_user");
    const thumbnail = attachment("thumbnail", "style_thumbnail");

    expect(receiverSampleSheetAttachment([first], "receiver-1")?.id).toBe("first");
    expect(receiverSampleSheetAttachment([first, selected], "receiver-1")?.id).toBe("selected");
    expect(receiverSampleSheetAttachment([thumbnail, clientPhoto, first], "receiver-1")?.id).toBe("thumbnail");
    expect(receiverSampleSheetAttachment([thumbnail], "receiver-1")?.id).toBe("thumbnail");
    expect(receiverSampleSheetAttachment([clientPhoto, first], "receiver-1")?.id).toBe("client-photo");
    expect(receiverSampleSheetAttachment([attachment("other", "receiver_sample_sheet", "receiver-2")], "receiver-1")?.id)
      .toBeUndefined();
  });
});

describe("alpha order list usability", () => {
  it("keeps boss QC dialog close from restarting the background order refresh", () => {
    const source = read("components/orders/BossOrderManagementPanel.tsx");

    expect(source).toContain("qcResultOpenRef.current");
    expect(source).toContain("qcResultRefreshBlockedUntilRef.current");
    expect(source).toContain("const closeQcResult = () =>");
    expect(source).toContain("onCancel={closeQcResult}");
  });

  it("hides internal order numbers from the visible primary title cell", () => {
    const source = read("components/orders/OrderTitleCell.tsx");

    expect(source).toContain("Tooltip");
    expect(source).toContain("订单号：");
    expect(source).not.toContain(
      '<Typography.Text type="secondary" className="order-title-order-no">',
    );
  });

  it("keeps client web primary columns focused on business status and action", () => {
    const source = read("components/OrderTable.tsx");

    expect(source).toContain('audience?: "client" | "receiver"');
    expect(source).toMatch(/isClient\s*\?\s*\[\]/);
    expect(source).toContain("<OrderTitleCell");
    expect(source).toContain("titleCellRender?.(order)");
    expect(source).toContain("audience={audience}");
    expect(source).toContain("showMeta={isClient}");
    expect(source).toContain("extra={titleExtra?.(order)}");
    expect(source).toContain('title: "接单状态"');
    expect(source).toContain('title: "工序阶段"');
    expect(source).not.toContain('title: "版子"');
    expect(source).toContain('title: "面里料"');
    expect(source).toContain('title: "操作"');
    expect(source).not.toContain("scroll={{ x:");
  });

  it("keeps sample type and round visible in receiver and client order browsing tables", () => {
    const tableSource = read("components/OrderTable.tsx");
    const statusTagSource = read("components/StatusTags.tsx");
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const clientOrdersSource = read("pages/client/ClientOrdersPage.tsx");

    expect(tableSource).toContain('dataIndex: "sampleType"');
    expect(tableSource).toContain('dataIndex: "sampleRound"');
    expect(tableSource).toContain("SampleTypeTag");
    expect(tableSource).toContain("SampleRoundTag");
    expect(tableSource).toContain('title: "客户/业务员"');
    expect(tableSource).toContain("getOrderCustomerName(order as unknown as OrderRecord)");
    expect(tableSource).toContain("getOrderBusinessUserName(order as unknown as OrderRecord)");
    expect(tableSource.indexOf('key: "customerContext"')).toBeLessThan(
      tableSource.indexOf('dataIndex: "quantity"'),
    );
    expect(tableSource.indexOf('dataIndex: "quantity"')).toBeLessThan(
      tableSource.indexOf('dataIndex: "sampleType"'),
    );
    expect(tableSource.indexOf('dataIndex: "sampleType"')).toBeLessThan(
      tableSource.indexOf('dataIndex: "sampleRound"'),
    );
    expect(tableSource.indexOf('dataIndex: "sampleRound"')).toBeLessThan(
      tableSource.indexOf('dataIndex: "intakeStatus"'),
    );
    expect(tableSource.indexOf('dataIndex: "sampleType"')).toBeLessThan(
      tableSource.indexOf("columns.push"),
    );
    expect(statusTagSource).toContain("export function SampleTypeTag");
    expect(statusTagSource).toContain("export function SampleRoundTag");
    expect(statusTagSource).toContain("useSampleTypeOptions");
    expect(statusTagSource).toContain("labelFor(value)");
    expect(statusTagSource).toContain("sampleRoundOptions");
    expect(receiverSource).toContain("actions={pendingRowActions}");
    expect(receiverSource).toContain("selectedOrderPanel");
    expect(receiverSource).toContain("onOrderClick={openOrderDetail}");
    expect(clientOrdersSource).toContain('audience="client"');
  });

  it("keeps planner order columns in quantity then sample type then round reading order", () => {
    const plannerSource = read("pages/planner/PlannerWorkbenchPage.tsx");
    const tableSource = read("components/OrderTable.tsx");

    expect(plannerSource).toContain("<OrderTable");
    expect(plannerSource).toContain("planner-receiver-style-order-list");
    expect(tableSource.indexOf('dataIndex: "quantity"')).toBeLessThan(
      tableSource.indexOf('dataIndex: "sampleType"'),
    );
    expect(tableSource.indexOf('dataIndex: "sampleType"')).toBeLessThan(
      tableSource.indexOf('dataIndex: "sampleRound"'),
    );
    expect(tableSource.indexOf('dataIndex: "sampleRound"')).toBeLessThan(
      tableSource.indexOf('dataIndex: "intakeStatus"'),
    );
    expect(plannerSource).not.toContain('key: "sampleMeta"');
  });

  it("renders receiver desktop workspace sections with compact V1-style list density", () => {
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const tableSource = read("components/OrderTable.tsx");
    const unifiedAttachmentSource = read("components/attachments/UnifiedAttachmentTable.tsx");
    const styles = read("app/styles.css");

    expect(receiverSource).toContain("receiver-workbench full-width");
    expect(receiverSource).toContain(
      'tablet && activeTab !== "self-entry" ? " receiver-tablet-list-state" : ""',
    );
    expect(receiverSource).not.toContain("receiver-summary-stats");
    expect(receiverSource).toContain("receiver-status-preview");
    expect(receiverSource).toContain("receiver-full-list-panel");
    expect(receiverSource).toContain("receiver-order-detail-dialog");
    expect(receiverSource).toContain("activeOrderRecordSections");
    expect(receiverSource).toContain("order-detail-record-section");
    expect(receiverSource).toContain('activeKey={scanRecordsActive ? ["scan-records"] : []}');
    expect(receiverSource).toContain("onActiveChange={(active) => setOrderRecordSectionActive");
    expect(receiverSource).toContain("receiver-filter-card");
    expect(receiverSource).toContain("receiver-tabs-card");
    expect(receiverSource).toContain("receiver-list-panel");
    expect(receiverSource).toContain("receiver-intake-form");
    expect(receiverSource).toContain('tabLabel("待校正订单"');
    expect(receiverSource).toContain('tabLabel("订单列表"');
    expect(receiverSource).toContain("ReceiverSampleRequestSection");
    expect(receiverSource).not.toContain('tabLabel("待补资料"');
    expect(receiverSource).toContain('key: "self-entry"');
    expect(receiverSource).toContain('key: "pending"');
    expect(receiverSource).toContain('key: "list"');
    expect(receiverSource).not.toContain('key: "tracking"');
    expect(receiverSource).not.toContain('key: "query"');
    expect(receiverSource).toContain('tabBarStyle={{ display: "none" }}');
    expect(receiverSource).toContain("<OrderDesktopFilterBar");
    expect(receiverSource).toContain("completeReceiverOrders");
    expect(receiverSource).toContain(
      "defaultFilters={getReceiverTabDefaultFilters(activeTab)}",
    );
    expect(receiverSource.indexOf("<OrderDesktopFilterBar")).toBeLessThan(
      receiverSource.indexOf('className="receiver-workbench-tabs"'),
    );
    expect(receiverSource.match(/<OrderDesktopFilterBar/g)).toHaveLength(1);
    expect(receiverSource.match(/\r?\n\s+compact\r?\n/g) ?? []).toHaveLength(4);
    expect(receiverSource.match(/pageSize=\{12\}/g)).toHaveLength(2);
    expect(receiverSource).toContain("onFinish={(values) => void submitSelfEntry(values)}");
    expect(receiverSource).toContain("onFinish={(values) => void submitFullSelfEntry(values)}");
    expect(tableSource).toContain("compact?: boolean");
    expect(tableSource).toContain("pageSize?: number");
    expect(tableSource).toContain('size={compact ? "small" : "middle"}');
    expect(tableSource).toContain('workspace ? "data-workspace-table" : ""');
    expect(tableSource).toContain("showPageSizeChanger?: boolean");
    expect(tableSource).toContain("current: validCurrentPage");
    expect(tableSource).toContain("pageSize: currentPageSize");
    expect(tableSource).toContain("showSizeChanger: showPageSizeChanger ? NON_SEARCHABLE_PAGE_SIZE_CHANGER : false");
    expect(tableSource).toContain("pageSizeStorageKey");
    expect(tableSource).toContain('className="order-table-workspace-pagination"');
    expect(tableSource).toContain("dataSource={visibleOrders}");
    expect(tableSource).toContain('workspace ? { y: "100%" }');
    expect(tableSource).toContain("selectable?: boolean");
    expect(tableSource).toContain("rowSelection");
    expect(tableSource).toContain("selectedRowKeys");
    expect(tableSource).toContain("type OrderTableProps<TOrder extends OrderTableRow>");
    expect(tableSource).toContain("onOrderClick?: (order: TOrder) => void");
    expect(tableSource).toContain("rowClassName?: (order: TOrder) => string");
    expect(tableSource).toContain("hideExpandControl?: boolean");
    expect(tableSource).toContain("showExpandColumn: !hideExpandControl");
    expect(styles).toContain(".receiver-workbench");
    expect(styles).toContain("max-width: none");
    expect(styles).toContain(".receiver-status-preview");
    expect(styles).toContain(".receiver-full-list-panel");
    expect(styles).toContain(".receiver-order-detail-dialog");
    expect(styles).toContain(".receiver-filter-card");
    expect(styles).toContain(".receiver-workbench .order-filter-bar");
    expect(styles).toContain(".receiver-workbench .compact-order-table");
    expect(styles).toContain(".order-detail-record-section.is-expanded");
    expect(styles).toContain(".order-detail-record-section.is-collapsed");
    expect(styles).toContain(".order-detail-records-tab .ant-collapse-content-box > .ant-empty");
    expect(styles).not.toContain(".order-detail-records-tab > .ant-space-item:has(.ant-collapse-item-active .ant-empty)");
    expect(styles).toContain(".order-detail-records-tab .ant-collapse-item-active > .ant-collapse-content");
    expect(styles).not.toContain(".order-detail-records-tab .ant-collapse-content,\n");
    expect(styles).toContain(".order-attachment-panel.is-workspace > .ant-space-item:has(> .unified-attachment-layout)");
    expect(styles).toContain(".unified-attachment-layout.is-workspace > .ant-space-item:has(> .unified-attachment-log-collapse)");
    expect(styles).toContain("max-height: min(240px, 42%)");
    expect(styles).toContain(".attachment-log-table .ant-table-body");
    expect(styles).toContain(".attachment-log-table .ant-table-header");
    expect(styles).toContain("min-height: 40px;\n  flex: 0 0 auto;");
    expect(unifiedAttachmentSource).toContain('className="attachment-log-table"');
    expect(styles).toContain(".unified-attachment-layout.is-workspace .unified-attachment-data-region {\n  min-height: 172px;");
    expect(styles).toContain(".order-attachment-panel.is-workspace .unified-attachment-table .ant-table-header");
    expect(styles).toContain("Small-height order details keep structural controls visible");
    expect(styles).toContain(".unified-attachment-layout.is-workspace .unified-attachment-table .ant-table-body {\n    min-height: 0;");
    expect(styles).toContain("max-height: 108px");
    expect(styles).toContain("max-height: 72px");
    expect(styles).toContain(".receiver-tablet-list-state .receiver-row-actions");
    expect(styles).toContain("height: 28px;");
    expect(styles).toContain("min-height: 28px;");
  });

  it("adds the accepted role task-room UI structure without changing business modules", () => {
    const roleHeaderSource = read("components/RoleTaskRoomHeader.tsx");
    const styles = read("app/styles.css");
    const clientSource = read("pages/client/ClientWorkbenchPage.tsx");
    const clientMobileSource = read("pages/client/ClientMobilePage.tsx");
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const receiverMobileSource = read("pages/receiver/ReceiverMobilePage.tsx");
    const plannerSource = read("pages/planner/PlannerWorkbenchPage.tsx");
    const patternSource = read("pages/pattern-maker/PatternTaskWorkbenchPage.tsx");
    const adminSource = read("pages/admin/AdminDashboardPage.tsx");
    const systemOwnerSource = read("pages/system-owner/SystemOwnerPage.tsx");

    expect(roleHeaderSource).toContain("RoleTaskRoomHeader");
    expect(roleHeaderSource).toContain("role-task-room-card");
    expect(roleHeaderSource).toContain("role-task-room-steps");
    expect(styles).toContain(".role-task-room-card");
    expect(styles).toContain(".role-task-room-step-active");
    expect(styles).toContain(".mobile-task-room-steps");

    expect(clientSource).toContain("客户任务间");
    expect(clientSource).toContain("截图/照片录入");
    expect(clientSource).toContain("接单员确认后会补齐订单资料并推动流转");
    expect(clientMobileSource).toContain("mobile-task-room-steps");
    expect(clientMobileSource).toContain("接单员补齐");

    expect(receiverSource).toContain("接单员工作间");
    expect(receiverSource).toContain("receiverStatusPreviewItems");
    expect(receiverMobileSource).toContain("接单员手机端主流程");
    expect(receiverMobileSource).toContain("可先拍照上传打样单");

    expect(plannerSource).toContain("计划员任务间");
    expect(plannerSource).toContain("全部订单");
    expect(plannerSource).toContain("缝制中");
    expect(plannerSource).toContain("计划员不在系统内分配缝制员工");
    expect(plannerSource).not.toContain("选择缝制员工");
    expect(patternSource).toContain("版师工作台");
    expect(patternSource).toContain("pattern-workbench-stats");
    expect(patternSource).toContain("pattern-current-task-grid");
    expect(patternSource).toContain("pattern-current-materials");
    expect(patternSource).toContain("showAdvancedFilters");
    expect(patternSource).toContain('label: "当前任务"');
    expect(patternSource).toContain('label: "未完成任务"');
    expect(patternSource).toContain('label: "任务列表"');
    expect(patternSource).toContain('label: "历史任务"');
    expect(patternSource).toContain("pattern-workspace-nav");
    expect(patternSource).toContain("先看资料");
    expect(patternSource).toContain("pattern-task-materials-modal");
    expect(patternSource).toContain("pattern-task-preview-context");
    expect(patternSource).not.toContain("<Drawer");
    expect(patternSource).toContain("开始任务");
    expect(patternSource).toContain("资料与附件");
    expect(patternSource).toContain("资料 / 附件");
    expect(patternSource).not.toContain("实体生产路线");
    expect(patternSource).toContain("制版和改版之外的任务不阻塞综合任务完成");
    expect(patternSource).toContain("追加新版本");
    expect(patternSource).toContain("查看成果");
    expect(patternSource).toContain("openVersionUpload(task)");
    expect(patternSource).toContain('placeholder="选择版师任务类别"');
    expect(patternSource).toContain('compactLabel="新版本附件（可选）"');
    expect(patternSource).toContain('compactLabel="交付附件（可选）"');
    expect(patternSource).toContain("compactTrailingAction");
    expect(patternSource).toContain("enableBulkDelete");
    expect(patternSource).toContain("workspace={workspace}");
    expect(styles).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
    expect(styles).toContain(".app-data-workbench-shell .pattern-maker-page > .ant-space-item:has(> .pattern-workbench-tabs-card)");
    expect(styles).not.toContain(".pattern-maker-page > .ant-space-item:not(:last-child)");
    expect(patternSource).not.toContain("bodyHeight={260}");
    expect(patternSource).not.toContain('okText="上传新版本"');
    expect(patternSource).not.toContain('onOk={() => void uploadVersion()}');
    expect(patternSource).toContain("V1 / V2 / V3");
    expect(patternSource).toContain("getPatternWorkbench");
    expect(patternSource).toContain("startPatternTask");
    expect(patternSource).toContain("listPatternOrderAttachments");
    expect(patternSource).toContain("appendPatternDeliverableVersion");
    expect(patternSource.match(/appendPatternDeliverableVersion/g)?.length).toBe(2);
    expect(patternSource).not.toContain('name="version"');
    expect(patternSource).not.toContain("addPatternOrderAttachments");
    expect(patternSource).not.toContain("扫码收资料");
    expect(patternSource).not.toContain("确认收资料");
    expect(patternSource).not.toContain("flowDecision");
    expect(patternSource).not.toContain("deletePatternOrderAttachment");
    expect(patternSource).not.toContain("updatePatternOrderAttachment");
    expect(adminSource).not.toContain("经营管理任务间");
    expect(adminSource).not.toContain("RoleTaskRoomHeader");
    expect(systemOwnerSource).not.toContain("RoleTaskRoomHeader");
    expect(systemOwnerSource).toContain("BossPerformancePage");
  });

  it("uses the final dynamic pricing modal and removes the obsolete fixed-field implementation", () => {
    const panelSource = read("components/orders/BossPricingPanel.tsx");
    const modalSource = read("components/orders/DynamicPricingModal.tsx");

    expect(panelSource).toContain("DynamicPricingModal");
    expect(panelSource).not.toContain("客户报价 · 样衣单价");
    expect(panelSource).not.toContain("特殊 / 例外内部成本");
    expect(panelSource).not.toContain("internalCostExceptionNote");
    expect(modalSource).toContain("新增成本项");
    expect(modalSource).toContain("新增收费项");
    expect(modalSource).toContain("其他费用明细（");
    expect(modalSource).not.toContain("新增其他费用");
    expect(modalSource).not.toContain("定价：");
    expect(modalSource).toContain("确认客户报价");
    expect(modalSource).toContain('placeholder="金额"');
    expect(modalSource).toContain("focusNextAmountInput");
    expect(panelSource).toContain("visibleOrderReference");
    expect(panelSource).toContain("/^V2-MOCK-/i");
  });

  it("uses explicit boss QC button states", () => {
    expect(bossQcAction({})).toEqual({ label: "尚未组检", className: "is-empty", disabled: true });
    expect(bossQcAction({ qcRecordStatus: "rework" })).toEqual({ label: "返工中", className: "is-rework", disabled: false });
    expect(bossQcAction({ qcRecordStatus: "completed" })).toEqual({ label: "组检记录", className: "is-completed", disabled: false });
  });

  it("keeps boss and boss Pad order details bounded with scrollable tabs and designed rework records", () => {
    const source = read("components/orders/BossOrderManagementPanel.tsx");
    const styles = read("app/styles.css");

    expect(source).toContain('title: "操作"');
    expect(source).toContain("查看瑕疵记录");
    expect(source).toContain('title="返工瑕疵记录"');
    expect(source).toContain("sewingWorkerName");
    expect(source).toContain("boss-rework-photo-strip");
    expect(source).toContain('defaultPageSize: 10');
    expect(source).toContain('showTotal: (total) => `共 ${total} 条`');
    expect(styles).toContain("height: min(1120px, calc(100dvh - 32px));");
    expect(source).toContain('height: "min(1120px, calc(100dvh - 48px))"');
    expect(styles).toContain(".boss-order-detail-modal .ant-tabs-tabpane-active");
    expect(styles).toContain("overflow-y: auto;");
    expect(styles).toContain(".boss-rework-photo-modal .ant-modal-content");
    expect(styles).toContain("height: 620px;");
    expect(styles).toContain("overflow-x: auto;");
    expect(styles).toContain("width: calc((100% - 32px) / 3);");
  });

  it("previews PDF QR batches and keeps material records previewable and editable", () => {
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const pickerSource = read("components/ClientAttachmentPicker.tsx");
    expect(receiverSource).toContain("批量打印 PDF 二维码预览");
    expect(receiverSource).toContain("确认并输出 PDF");
    expect(receiverSource).toContain("receiver-material-record-order-summary");
    expect(receiverSource).toContain("allowPreview");
    expect(receiverSource).toContain("simple");
    expect(pickerSource).toContain("AttachmentPreviewModal");
  });

  it("uses order tasks only for recommendation and source labels", () => {
    const source = read("components/orders/DynamicPricingModal.tsx");
    const summarySource = read("components/orders/BossOrderSummaryHeader.tsx");

    expect(source).toContain('aria-label="内部成本"');
    expect(source).toContain('aria-label="客户报价"');
    expect(source).toContain("BossOrderSummaryHeader");
    expect(summarySource).toContain("OrderTaskStatusBadges");
    expect(source).toContain("系统推荐与人工新增处于同一层级");
    expect(source).toContain("人工新增");
    expect(source).toContain("maskClosable={false}");
    expect(source).toContain("keyboard={false}");
    expect(source).not.toContain('label="成本项目"');
    expect(source).not.toContain('{ label: "材料成本", value: "material" }');
    expect(source).not.toContain("特殊 / 例外内部成本");
  });

  it("keeps normal customer charges, pass-through charges, and internal costs distinct", () => {
    const source = read("components/orders/DynamicPricingModal.tsx");
    const chargeListSource = read("components/orders/OrderChargeList.tsx");
    const styles = read("app/styles.css");

    expect(source).toContain("客户报价小计");
    expect(source).toContain("应收总额");
    expect(source).toContain("内部成本合计");
    expect(source).toContain("预计毛利");
    expect(source).toContain("毛利率");
    expect(source).toContain("其他费用明细（");
    expect(source).toContain('className="dynamic-pricing-internal-cost-summary"');
    expect(source).toContain("查看明细");
    expect(chargeListSource).toContain("暂无其他费用记录");
    expect(chargeListSource).toContain("pageSizeStorageKey?: string");
    expect(chargeListSource).toContain("showPageSizeChanger || charges.length > effectivePageSize");
    expect(chargeListSource).toContain("bodyRef.current?.scrollTo({ top: 0 })");
    expect(chargeListSource).toContain("[effectivePageSize, 10, 20, 50]");
    expect(styles).toContain(".native-tablet-runtime .order-detail-records-tab .ant-collapse-content-box");
    expect(styles).toContain("max-height: none;");
  });

  it("keeps reconciliation statement generation as a selected-row batch action", () => {
    const source = read("components/orders/BossPricingPanel.tsx");

    expect(source).toContain("createStatement(selectedRows)");
    expect(source).not.toContain("createStatementAndDownload");
    expect(source).not.toContain("downloadStatementExcel");
    expect(source).not.toContain("downloadAdminReconciliationStatements(session, [");
  });

  it("keeps reconciliation statement filters and batch downloads on the statements tab", () => {
    const source = read("components/orders/BossPricingPanel.tsx");

    expect(source).toContain("statementDraftFilters");
    expect(source).toContain("statementListOptions(statementFilters)");
    expect(source).toContain("搜索订单号 / 款号 / SR编号 / 客户款名");
    expect(source).toContain("对账单生成日期");
    expect(source).toContain("downloadAdminReconciliationStatements");
    expect(source).toContain("批量下载");
    expect(source).toContain("canReturnSelectedStatements");
  });

  it("opens statement-item pricing directly from both the order cell and edit button", () => {
    const source = read("components/orders/BossPricingPanel.tsx");
    const statementColumns = source.slice(
      source.indexOf("const statementItemColumns"),
      source.indexOf("const pendingToolbar")
    );

    expect(source).toContain("aria-label={`修改定价：${item.styleNo}`}");
    expect(source).toContain("onClick={() => void openStatementItemPricing(item)}");
    expect(source).toContain('title: "退回这个订单？"');
    expect(source).toContain("本对账单保留，其余订单和历史记录不受影响");
    expect(source).toContain("退回此订单");
    expect(source).toContain("退回整单");
    expect(statementColumns).toContain('title: "款号 / 款名"');
    expect(statementColumns).not.toContain("{item.orderNo}");
    expect(source).not.toContain("退回并修改定价");
    expect(source).not.toContain("confirmReturnStatementItem(statement, item, true)");
    expect(source).not.toContain('{ title: "账期", dataIndex: "billingPeriod"');
  });

  it("keeps reconciliation money columns ordered and actions fixed at the right edge", () => {
    const source = read("components/orders/BossPricingPanel.tsx");
    const statementColumns = source.slice(
      source.indexOf("const statementColumns"),
      source.indexOf("const visibleStatementColumns")
    );
    const statementItemColumns = source.slice(
      source.indexOf("const statementItemColumns"),
      source.indexOf("const pendingToolbar")
    );

    const expectedOrder = [
      'title: "款号 / 款名"',
      'title: "样衣单价"',
      'title: "数量"',
      'title: "样衣总价"',
      'title: "版费"',
      'title: "其他费用"',
      'title: "订单毛利"',
      'title: "应收合计"',
      'title: "操作"'
    ];
    for (let index = 1; index < expectedOrder.length; index += 1) {
      expect(statementItemColumns.indexOf(expectedOrder[index - 1]!))
        .toBeLessThan(statementItemColumns.indexOf(expectedOrder[index]!));
    }
    expect(statementItemColumns).toContain('fixed: "right"');
    expect(source).toContain('{ label: "对账单毛利", value: "grossMargin" }');
    expect(source).not.toContain('{ label: "已收金额", value: "paidAmount" }');
    expect(statementColumns.indexOf('title: "状态"'))
      .toBeLessThan(statementColumns.indexOf('title: "对账单毛利"'));
    expect(statementColumns.indexOf('title: "对账单毛利"'))
      .toBeLessThan(statementColumns.indexOf('title: "操作"'));
    expect(statementColumns.indexOf('key: "spacer"'))
      .toBeLessThan(statementColumns.indexOf('title: "操作"'));
    expect(source).toContain('key === "spacer"');
    expect(source).toContain('key: "actions",\n      width: 90,\n      align: "center",\n      fixed: "right"');
    expect(source).toContain("撤回已收款");
    expect(source).toContain("已生成对账单款数");
  });

  it("allows selecting pending pricing and reconciliation rows by clicking non-action cells", () => {
    const source = read("components/orders/BossPricingPanel.tsx");

    expect(source).toContain("function isTableActionTarget");
    expect(source).toContain("className: isPriced(row) ? \"pricing-selectable-row\" : \"\"");
    expect(source).toContain("setSelectedOrderKeys((current) =>");
    expect(source).toContain('className: "pricing-selectable-row"');
    expect(source).toContain("setSelectedStatementKeys((current) =>");
    expect(source).toContain("if (isTableActionTarget(event.target)) return;");
  });

  it("closes the pricing modal after a successful quotation confirmation", () => {
    const source = read("components/orders/DynamicPricingModal.tsx");

    expect(source).toContain("if (confirmed) {");
    expect(source).toContain("onClose();");
  });

  it("shows all order tasks in pending pricing and keeps statement details customer-facing", () => {
    const source = read("components/orders/BossPricingPanel.tsx");
    const statementColumns = source.slice(
      source.indexOf("const statementItemColumns"),
      source.indexOf("const pendingToolbar")
    );

    expect(source).toContain('title: "订单任务"');
    expect(source).toContain("<OrderTaskStatusBadges");
    expect(source).not.toContain('title: "工序阶段"');
    expect(statementColumns).not.toContain('title: "版师成本"');
    expect(statementColumns).not.toContain('title: "裁剪成本"');
    expect(statementColumns).not.toContain('title: "缝制成本"');
    expect(statementColumns).not.toContain('title: "后整成本"');
    expect(statementColumns).not.toContain('title: "内部成本合计"');
    expect(statementColumns).not.toContain("showStatementCostDetails");
    expect(statementColumns).not.toContain('title: "当前状态"');
  });

  it("persists boss table column choices and confirms statement export fields", () => {
    const bossOrders = read("components/orders/BossOrderManagementPanel.tsx");
    const pricing = read("components/orders/BossPricingPanel.tsx");

    expect(bossOrders).not.toContain('title: "接单状态"');
    expect(bossOrders).toContain("sample-room:boss-active-order-columns:v4");
    expect(bossOrders).toContain('ariaLabel="选择活跃订单显示列"');
    expect(bossOrders).toContain("compactBossActiveColumns");
    expect(bossOrders).toContain('key: "layoutSpacer"');
    expect(bossOrders).toContain("formatOrderDate(order.receivedAt)");
    expect(pricing).toContain("sample-room:boss-pricing-pending-columns:v4");
    const pendingDefaults = pricing.slice(
      pricing.indexOf("const defaultPendingColumns"),
      pricing.indexOf("const compactPendingColumns")
    );
    const pendingDefinitions = pricing.slice(
      pricing.indexOf("const pendingColumnDefinitions"),
      pricing.indexOf("const pendingColumns")
    );
    expect(pendingDefaults).toContain('"sampleType"');
    expect(pendingDefaults).toContain('"sampleRound"');
    expect(pendingDefinitions.indexOf('title: "样品类型"')).toBeLessThan(
      pendingDefinitions.indexOf('title: "数量"')
    );
    expect(pendingDefinitions.indexOf('title: "轮次"')).toBeLessThan(
      pendingDefinitions.indexOf('title: "数量"')
    );
    expect(pricing).toContain('ariaLabel="选择待对账显示列"');
    expect(pricing).toContain("compactPendingColumns");
    expect(pricing).toContain("compactStatementColumns");
    expect(pricing).not.toContain("显示费用明细");
    expect(pricing).toContain("选择订单明细字段");
    expect(pricing).toContain("下载对账单");
    expect(pricing).not.toContain("重新下载");
    const exportColumns = pricing.slice(
      pricing.indexOf("const statementExportColumnOptions"),
      pricing.indexOf("const defaultStatementExportColumns")
    );
    for (const [label, value] of [
      ["接单日期", "orderCreatedDate"],
      ["交样日期", "deliveryDate"],
      ["缩略图", "thumbnail"],
      ["款号", "styleNo"],
      ["款名", "styleName"],
      ["样品类型", "sampleType"],
      ["轮次", "sampleRound"],
      ["数量", "quantity"],
      ["样衣单价", "quotedPrice"],
      ["样衣总价", "sampleAmount"],
      ["版费", "customerPatternFee"],
      ["其他费用", "otherChargeTotal"],
      ["其他费用明细说明", "otherChargeNote"],
      ["应收总计", "receivableTotal"]
    ]) {
      expect(exportColumns).toContain(`{ label: "${label}", value: "${value}" }`);
    }
    expect(exportColumns.indexOf('value: "orderCreatedDate"')).toBeLessThan(
      exportColumns.indexOf('value: "thumbnail"')
    );
    expect(exportColumns.indexOf('value: "deliveryDate"')).toBeLessThan(
      exportColumns.indexOf('value: "thumbnail"')
    );
    expect(exportColumns).not.toContain('value: "orderNo"');
    expect(exportColumns).not.toContain('value: "folderCode"');
  });

  it("uses the compact previewable picker for receiver material records", () => {
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const pickerSource = read("components/ClientAttachmentPicker.tsx");
    const pickerStart = receiverSource.indexOf("value={materialRecordAttachments}");
    const materialModal = receiverSource.slice(
      receiverSource.indexOf('title="添加面辅料记录"'),
      receiverSource.indexOf("<ReceiverCorrectionModal")
    );
    const materialPicker = receiverSource.slice(
      pickerStart,
      receiverSource.indexOf("/>", pickerStart) + 2
    );

    expect(materialPicker).toContain("compact");
    expect(materialPicker).toContain("allowPreview");
    expect(materialPicker).toContain("showCamera={false}");
    expect(materialPicker).toContain('defaultCategory="receiver_material_record"');
    expect(materialPicker).toContain('compactLabel="选择待上传文件"');
    expect(materialPicker).toContain("showVisibilityChoice");
    expect(materialModal).toContain("上传记录");
    expect(pickerSource).toContain("integratedDropZone = false");
    expect(pickerSource).toContain('role: "button"');
    expect(pickerSource).toContain('event.key === "Enter" || event.key === " "');
  });

  it("keeps quick-photo intake on the entry tab after a successful submission", () => {
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const quickSubmit = receiverSource.slice(
      receiverSource.indexOf("const submitSelfEntry"),
      receiverSource.indexOf("const canMaintainTrackingOrder")
    );
    const fullSubmit = receiverSource.slice(
      receiverSource.indexOf("const submitFullSelfEntry"),
      receiverSource.indexOf("const submitDetailAttachments")
    );

    expect(quickSubmit).toContain("已生成待校正订单");
    expect(quickSubmit).toContain("selfEntryForm.resetFields()");
    expect(quickSubmit).toContain("sampleRequestItems: DEFAULT_SAMPLE_REQUEST_ITEMS");
    expect(quickSubmit).toContain("setQuickEntryAttachments(emptyReceiverIntakeAttachmentState())");
    expect(quickSubmit).toContain("await loadOrders()");
    expect(quickSubmit).not.toContain('changeTab("pending")');
    expect(quickSubmit).not.toContain('setActiveTab("pending")');
    expect(quickSubmit).not.toContain('setSelfEntryMode("full")');
    expect(fullSubmit).toContain("完整订单已录入");
    expect(fullSubmit).toContain("fullEntryForm.resetFields()");
    expect(fullSubmit).toContain("setFullEntryAttachments(emptyReceiverIntakeAttachmentState())");
    expect(fullSubmit).toContain("await loadOrders()");
  });

  it("uses one task status column and an all-selected task filter in boss active orders", () => {
    const source = read("components/orders/BossOrderManagementPanel.tsx");
    const columns = source.slice(
      source.indexOf("const activeColumnDefinitions"),
      source.indexOf("const activeColumns")
    );

    expect(columns).toContain('title: "订单任务"');
    expect(columns).toContain('key: "orderTasks"');
    expect(columns).toContain("<OrderTaskStatusBadges");
    expect(columns).not.toContain('title: "版师任务"');
    expect(columns).not.toContain('title: "工序阶段"');
    expect(source).toContain('aria-label="筛选订单任务"');
    expect(source).toContain('placeholder="订单任务（包含全部已选）"');
    expect(source).toContain("filters.taskItems.every");
  });

  it("aligns boss and system-owner order charges and current-stage entries", () => {
    const bossOrders = read("components/orders/BossOrderManagementPanel.tsx");
    const pricing = read("components/orders/BossPricingPanel.tsx");
    const pricingModal = read("components/orders/DynamicPricingModal.tsx");
    const summaryHeader = read("components/orders/BossOrderSummaryHeader.tsx");
    const styles = read("app/styles.css");
    const adminPage = read("pages/admin/AdminDashboardPage.tsx");
    const systemOwnerPage = read("pages/system-owner/SystemOwnerPage.tsx");

    expect(bossOrders).toContain('{ label: "当前工序", value: "currentStage" }');
    expect(bossOrders).toContain('title: "当前工序"');
    expect(bossOrders).toContain("<OrderCompletionTag");
    expect(bossOrders).toContain("其他费用 {order.chargeCount ?? 0}");
    expect(bossOrders).toContain("<ReceiverOrderChargeModal");
    expect(bossOrders).toContain('role="admin"');
    expect(bossOrders).toContain('sourceScene="boss_order_list"');
    expect(bossOrders).toContain('label: `其他费用 ${detailCharges.length}`');
    expect(bossOrders).toContain("<OrderChargeReadOnlyPanel");
    expect(pricing).toContain('{ label: "当前工序", value: "currentStage" }');
    expect(pricing).toContain('title: "当前工序"');
    expect(pricing).toContain("<OrderCompletionTag");
    expect(pricingModal).toContain("<OrderChargeList");
    expect(pricingModal).not.toContain("renderExtraActions");
    expect(pricingModal).not.toContain("showStatus");
    expect(pricingModal).not.toContain("confirmAdminOrderCharge");
    expect(pricingModal).not.toContain("rejectAdminOrderCharge");
    expect(pricingModal).not.toContain("cancelAdminOrderChargeConfirmation");
    expect(pricingModal).not.toContain("取消确认");
    expect(pricingModal).toContain("maintenanceDisabled={locked}");
    expect(pricingModal).toContain("pageSize={5}");
    expect(pricingModal).toContain("bodyHeight={260}");
    expect(pricingModal).toContain("<BossOrderSummaryHeader");
    expect(bossOrders).toContain("<BossOrderSummaryHeader");
    expect(summaryHeader).toContain("OrderCompletionTag");
    expect(summaryHeader).toContain("OrderTaskStatusBadges");
    expect(styles).toContain(".boss-order-summary-thumbnail");
    expect(styles).toContain("--boss-order-summary-thumbnail-size: clamp(96px, 12dvh, 170px)");
    expect(styles).toContain("grid-template-columns: var(--boss-order-summary-thumbnail-size) minmax(0, 1fr)");
    expect(styles).toContain("margin-top: clamp(8px, calc(4dvh - 28px), 24px)");
    expect(styles).not.toContain("A shorter viewport gives the tab workspace priority");
    expect(styles).toContain("aspect-ratio: 1 / 1;");
    expect(styles).toContain("flex: 1 1 100%;");
    expect(styles).toContain("max-width: 100%;");
    expect(styles).toContain("max-height: 100%;");
    expect(styles).toContain("object-fit: contain;");
    expect(styles).toContain("object-position: center;");
    expect(pricing).toContain("pendingOrderCompletion(row).label");
    expect(pricing).toContain('label: "全部当前工序"');
    expect(pricing).toContain("setCurrentStageFilter(\"all\")");
    expect(pricing.indexOf('{ label: "订单状态", value: "orderStatus" }')).toBeGreaterThan(
      pricing.indexOf('{ label: "当前工序", value: "currentStage" }')
    );
    expect(pricing).toContain('title: "订单状态"');
    expect(pricing).toContain('"orderStatus"');
    expect(pricing).toContain('sample-room:boss-pricing-pending-columns:v4');
    expect(pricing).toContain('label: "全部订单状态"');
    expect(pricing).toContain('value={orderStatusFilter}');
    expect(pricing).toContain('setOrderStatusFilter("all")');
    expect(pricing.match(/y: "100%", scrollToFirstRowOnChange: true/g)).toHaveLength(2);
    expect(adminPage).toContain("BossOrderManagementPanel");
    expect(adminPage).toContain("BossPricingPanel");
    expect(systemOwnerPage).toContain("BossOrderManagementPanel");
    expect(systemOwnerPage).toContain("BossPricingPanel");
  });

  it("uses N/A for quantity and material fields when an order has no physical route", () => {
    const tableSource = read("components/OrderTable.tsx");
    const correctionSource = read("components/orders/ReceiverCorrectionModal.tsx");
    const bossSource = read("components/orders/BossOrderManagementPanel.tsx");

    expect(tableSource).toContain("hasPhysicalProductionRoute(order.sampleRequestItems ?? [])");
    expect(tableSource).toContain('value : "N/A"');
    expect(correctionSource).toContain("N/A（无实体生产路线）");
    expect(bossSource).toContain('hasPhysicalProduction(order) ? order.quantity : "N/A"');
  });

  it("uses receiver quick-photo intake for desktop order entry before correction", () => {
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const intakeAttachmentSource = read("components/receiver/ReceiverIntakeAttachmentWorkspace.tsx");
    const apiSource = read("api/sampleRoomApi.ts");
    const tableSource = read("components/OrderTable.tsx");
    const titleCellSource = read("components/orders/OrderTitleCell.tsx");
    const thumbnailSource = read("components/orders/orderThumbnail.ts");

    expect(receiverSource).toContain("quickEntryAttachments");
    expect(receiverSource).toContain("fullEntryAttachments");
    expect(receiverSource).toContain("submitSelfEntry");
    expect(receiverSource).toContain("createReceiverQuickPhotoOrder");
    expect(receiverSource).toContain("ReceiverIntakeAttachmentWorkspace");
    expect(intakeAttachmentSource).toContain("receiver_quick_photo");
    expect(intakeAttachmentSource).toContain("receiver_attachment");
    const quickEntrySubmitSource = receiverSource.slice(
      receiverSource.indexOf("async function submitSelfEntry"),
      receiverSource.indexOf("async function submitFullSelfEntry")
    );
    expect(quickEntrySubmitSource).not.toContain("changeTab(\"pending\")");
    expect(receiverSource).toContain("titleThumbnail={orderThumbnail}");
    expect(receiverSource).not.toContain("待补资料");
    expect(receiverSource).not.toContain("确认接单");
    expect(apiSource).toContain("createReceiverQuickPhotoOrder");
    expect(apiSource).toContain("bodyForReceiverQuickPhoto");
    expect(tableSource).toContain("titleThumbnail?: (order: TOrder) => ReactNode");
    expect(tableSource).toContain("thumbnail={titleThumbnail?.(order)}");
    expect(titleCellSource).toContain("thumbnail?: ReactNode");
    expect(thumbnailSource).toContain("style_thumbnail");
    expect(thumbnailSource).toContain("receiver_quick_photo");
  });

  it("keeps receiver web order rows and dialogs aligned with the approved compact interaction", () => {
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const pickerSource = read("components/ClientAttachmentPicker.tsx");
    const tableSource = read("components/OrderTable.tsx");
    const chargeDialogSource = read("components/orders/ReceiverOrderChargeModal.tsx");
    const chargeLedgerSource = read("components/operations/OrderChargeLedger.tsx");
    const printSettingsSource = read("components/printing/ReceiverPrintSettingsModal.tsx");
    const labelSource = read("printing/receiverLabel.ts");
    const printerSource = read("printing/receiverPrinter.ts");
    const styles = read("app/styles.css");

    expect(receiverSource).toContain("onOrderClick={openOrderDetail}");
    expect(receiverSource).toContain("onOrderClick={(order) => setCorrectingOrder(order)}");
    expect(receiverSource).toContain("校正资料");
    expect(receiverSource).toContain("打印二维码");
    expect(receiverSource).toContain("其他费用 {order.chargeCount ?? 0}");
    expect(receiverSource).toContain("面辅料记录");
    expect(receiverSource).toContain('category: "receiver_material_record"');
    expect(receiverSource).toContain('defaultVisibility="internal_only"');
    expect(receiverSource).toContain("默认仅内部可见，也可为每个文件设置客户可见");
    expect(receiverSource).toContain("showVisibilityChoice");
    expect(receiverSource).toContain("allowRename");
    expect(pickerSource).toContain("allowRename = false");
    expect(receiverSource).not.toContain("查看详情");
    expect(receiverSource).not.toContain("查看完整详情");
    expect(receiverSource).not.toContain("查看操作记录");
    expect(receiverSource).not.toContain("终止打样");
    expect(receiverSource).not.toContain("恢复打样");
    expect(receiverSource).toContain('key: "overview"');
    expect(receiverSource).toContain('key: "attachments"');
    expect(receiverSource).toContain('key: "records"');
    expect(receiverSource).toContain('footer={<Button onClick={() => setInspectingOrderId(undefined)}>关闭</Button>}');
    expect(receiverSource).toContain('blockTerminatedOrder');
    expect(receiverSource).toContain('? <Tag color="red">已终止</Tag>');
    expect(tableSource).toContain("[role='checkbox']");
    expect(tableSource).toContain("[role='combobox']");
    expect(tableSource).toContain(".ant-dropdown-trigger");
    expect(chargeDialogSource).toContain('className="receiver-charge-modal"');
    expect(chargeDialogSource).not.toContain("width={880}");
    expect(chargeDialogSource).toContain('footer={<Button onClick={onCancel}>关闭</Button>}');
    expect(chargeDialogSource).toContain("OrderChargeLedger");
    expect(chargeDialogSource).toContain("effectiveTotal={effectiveTotal}");
    expect(chargeDialogSource).not.toContain('className="receiver-charge-total"');
    expect(chargeLedgerSource).toContain('className="order-charge-desktop-heading"');
    expect(chargeLedgerSource).toContain("有效其他费用合计");
    expect(chargeDialogSource).toContain("salespersonName?: string");
    expect(chargeDialogSource).toContain('order.salespersonName ?? "-"');
    expect(chargeLedgerSource).toContain('compactLabel="费用凭证附件（可选）"');
    expect(pickerSource).toContain("点击/拖入文件上传");
    expect(pickerSource).toContain("client-attachment-picker-compact-actions");
    expect(pickerSource).toContain("client-attachment-picker-compact-list");
    expect(pickerSource).toContain("formatFileSize(attachment.size)");
    expect(pickerSource).toContain("未选择附件");
    expect(styles).toContain("max-height: 120px;");
    expect(styles).toContain("max-height: 220px;");
    expect(styles).toContain("--receiver-charge-viewport-width:");
    expect(styles).toContain("--receiver-charge-max-width:");
    expect(styles).toContain("--receiver-charge-viewport-height:");
    expect(styles).toContain("--receiver-charge-max-height:");
    expect(styles).toContain("var(--receiver-charge-viewport-width)");
    expect(styles).toContain("var(--receiver-charge-viewport-height)");
    expect(styles).toContain(".receiver-charge-modal .order-charge-shared-body.is-scrollable");
    expect(styles).toContain("@media (min-width: 901px) and (max-height:");
    expect(styles).toContain(".receiver-charge-modal .order-charge-desktop-section");
    expect(printSettingsSource).toContain("RECEIVER_LABEL_TEMPLATES.qrOnly33");
    expect(printSettingsSource).toContain("RECEIVER_LABEL_TEMPLATES.summary50");
    expect(printSettingsSource).toContain("updateReceiverPrintSettings");
    expect(printSettingsSource).toContain("connectB1Printer");
    expect(labelSource).toContain("x: 2, y: 2, width: 29, height: 29");
    expect(labelSource).toContain('printerModel: "B1"');
    expect(printerSource).toContain("printReceiverLabels");
    expect(printerSource).toContain("printB1Labels");
    expect(chargeDialogSource).toContain("receiver-dialog-order-thumbnail");
  });

  it("keeps the freeform label preview readable without a no-op select tool", () => {
    const designerSource = read("components/printing/ReceiverFreeformLabelDesigner.tsx");
    const styles = read("app/styles.css");

    expect(designerSource).not.toContain(">选择</Button>");
    expect(designerSource).toContain("maxSize={140}");
    expect(styles).toContain(".receiver-freeform-live-preview-paper");
    expect(styles).toContain("flex: 0 0 170px;");
  });

  it("keeps desktop route-level navigation in the sidebar instead of duplicate top tabs", () => {
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const clientWorkbenchSource = read("pages/client/ClientWorkbenchPage.tsx");
    const clientOrdersSource = read("pages/client/ClientOrdersPage.tsx");

    expect(receiverSource).toContain('tabBarStyle={{ display: "none" }}');
    expect(clientWorkbenchSource).not.toContain("<Tabs");
    expect(clientOrdersSource).not.toContain("<Tabs");
  });

  it("keeps the deprecated cutting room out of the global navigation", () => {
    const routesSource = read("routes/routes.tsx");
    const formalRoutingSource = read("app/formalRouting.ts");

    expect(routesSource).not.toContain('path: "/cutting-room"');
    expect(routesSource).not.toContain("CuttingRoomPage");
    expect(formalRoutingSource).not.toContain('"/cutting-room": ["system_owner"]');
  });

  it("keeps receiver attachment logs, query maintenance, and real scan entry in folded expanded details", () => {
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const detailSource = read("components/orders/OrderAttachmentDetail.tsx");
    const scanPanelSource = read("components/scan/OrderScanPanel.tsx");
    const scanRecordsPanelSource = read(
      "components/scan/OrderScanRecordsPanel.tsx",
    );
    const printSettingsSource = read("components/printing/ReceiverPrintSettingsModal.tsx");
    const webPrinterSource = read("printing/niimbotWebClient.ts");
    const tableSource = read("components/OrderTable.tsx");
    const clientOrdersSource = read("pages/client/ClientOrdersPage.tsx");
    const clientWorkbenchSource = read("pages/client/ClientWorkbenchPage.tsx");

    expect(tableSource).toContain(
      "expandedRowRender?: (order: TOrder) => ReactNode",
    );
    expect(tableSource).toContain(
      "titleExtra?: (order: TOrder) => ReactNode",
    );
    expect(tableSource).toContain("showMeta={isClient}");
    expect(tableSource).toContain("extra={titleExtra?.(order)}");
    expect(receiverSource).toContain("renderOrderOverview");
    expect(receiverSource).toContain("renderOrderAttachments");
    expect(receiverSource).toContain("renderOrderRecords");
    expect(receiverSource).toContain('label: "订单概览"');
    expect(receiverSource).toContain('label: `资料与附件');
    expect(receiverSource).toContain('label: `其他费用');
    expect(receiverSource).toContain('label: "记录"');
    expect(receiverSource).toContain("OrderChargeReadOnlyPanel");
    expect(receiverSource).toContain("录入时间");
    expect(receiverSource).toContain("客户业务员");
    expect(receiverSource).toContain("addReceiverOrderAttachments");
    expect(receiverSource).toContain("detailUploadOpen");
    expect(receiverSource).toContain("拖拽、粘贴或点击选择文件");
    expect(receiverSource).not.toContain("orderFolder");
    expect(receiverSource).not.toContain("订单文件夹");
    expect(receiverSource).toContain("ReceiverPrintSettingsModal");
    expect(receiverSource).toContain("OrderScanRecordsPanel");
    expect(receiverSource).toContain(
      '<OrderScanRecordsPanel order={order} session={session} variant="timeline" />',
    );
    expect(receiverSource).toContain("pendingRowActions");
    expect(receiverSource).toContain("selectedOrderPanel");
    expect(receiverSource).toContain("receiver-order-detail-dialog");
    expect(receiverSource).toContain("onOrderClick={openOrderDetail}");
    expect(receiverSource).toContain('title="订单详情"');
    expect(receiverSource).toContain("单击订单行打开订单详情");
    expect(receiverSource).toContain("勾选框只用于批量打印二维码、生成 PDF 二维码或导出 Excel");
    expect(receiverSource).toContain("canMaintainTrackingOrder");
    expect(receiverSource).toContain("printSingleOrder(order)");
    expect(receiverSource).toContain("打印二维码");
    expect(receiverSource).toContain("批量打印二维码");
    expect(receiverSource).toContain("openBatchScanPrint");
    expect(receiverSource).toContain("batchScanPrintItems");
    expect(receiverSource).toContain("buildReceiverLabelPrintJob");
    expect(receiverSource).toContain("printReceiverLabels");
    expect(receiverSource).toContain("qrValueForOrderLink(result.scanLink)");
    expect(receiverSource).toContain("receiverStatusControl");
    expect(receiverSource).toContain("openTrackingEdit(order)");
    expect(detailSource).toContain("附件日志");
    expect(detailSource).toContain("扫码记录");
    expect(detailSource).toContain("scanPanel ??");
    expect(detailSource).toContain("onDeleteAttachment");
    expect(detailSource).toContain("Popconfirm");
    expect(detailSource).toContain("删除附件");
    expect(receiverSource).toContain("deleteReceiverOrderAttachment");
    expect(scanRecordsPanelSource).toContain("listReceiverOrderScanRecords");
    expect(scanRecordsPanelSource).toContain("暂无扫码记录");
    expect(scanRecordsPanelSource).toContain("工序：");
    expect(scanRecordsPanelSource).toContain("人员：");
    expect(scanRecordsPanelSource).toContain("动作：");
    expect(scanRecordsPanelSource).toContain("时间：");
    expect(scanRecordsPanelSource).not.toContain("ensureReceiverOrderScanLink");
    expect(scanRecordsPanelSource).not.toContain("订单流转二维码");
    expect(scanRecordsPanelSource).not.toContain("生成/刷新流转二维码");
    expect(scanRecordsPanelSource).not.toContain("复制链接");
    expect(scanRecordsPanelSource).not.toContain("QRCode");
    expect(scanPanelSource).toContain("ensureReceiverOrderScanLink");
    expect(scanPanelSource).toContain("listReceiverOrderScanRecords");
    expect(scanPanelSource).toContain("订单流转二维码");
    expect(scanPanelSource).toContain("QRCode");
    expect(scanPanelSource).toContain("生成/刷新流转二维码");
    expect(scanPanelSource).toContain("复制链接");
    expect(scanPanelSource).toContain("orderStageLabel(order.stage)");
    expect(scanPanelSource).toContain("sampleTypeLabel(order.sampleType)");
    expect(scanPanelSource).toContain("sampleRoundLabel(order.sampleRound)");
    expect(scanPanelSource).toContain("工序：");
    expect(scanPanelSource).toContain("动作：");
    expect(scanPanelSource).toContain("人员：");
    expect(scanPanelSource).toContain("时间：");
    expect(printSettingsSource).toContain("打印设置");
    expect(printSettingsSource).toContain("保存设置");
    expect(webPrinterSource).toContain("DrawLableQrCode");
    expect(webPrinterSource).toContain("startJob");
    expect(webPrinterSource).toContain("commitJob");
    expect(detailSource).not.toContain("scanToken");
    expect(scanPanelSource).not.toContain("scanToken");
    expect(webPrinterSource).not.toContain("scanToken");
    expect(clientOrdersSource).not.toContain("OrderScanPanel");
    expect(clientOrdersSource).not.toContain("OrderScanPrintSheet");
    expect(clientWorkbenchSource).not.toContain("OrderScanPanel");
    expect(detailSource).not.toContain("defaultActiveKey");
  });

  it("uses the Phase 1.1 unified attachment table for internal roles", () => {
    const materialsSource = read("components/operations/ThreeSourceMaterials.tsx");
    const unifiedSource = read("components/attachments/UnifiedAttachmentTable.tsx");
    const previewModalSource = read("components/attachments/AttachmentPreviewModal.tsx");
    const styles = read("app/styles.css");
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const plannerSource = read("pages/planner/PlannerWorkbenchPage.tsx");
    const patternSource = read("pages/pattern-maker/PatternTaskWorkbenchPage.tsx");
    const clientSource = read("components/client/ClientOrderOverview.tsx");
    const bossSource = read("components/orders/BossOrderManagementPanel.tsx");
    const attachmentPanelSource = read("components/attachments/OrderAttachmentPanel.tsx");
    const pickerSource = read("components/ClientAttachmentPicker.tsx");
    const dialogLayoutSource = read("components/dialogLayout.ts");

    expect(materialsSource).toContain('title="资料与附件"');
    expect(materialsSource).toContain('aria-label="筛选附件来源"');
    expect(materialsSource).toContain("全部来源");
    expect(materialsSource).toContain("<Pagination");
    expect(materialsSource).not.toContain('title="三类资料"');
    expect(styles).toContain(".three-source-material-scroll");
    expect(styles).toContain("height: 320px;");
    expect(styles).toContain("overflow-y: auto;");
    expect(receiverSource).not.toContain("<ThreeSourceMaterials");
    expect(receiverSource).toContain("receiver-unified-attachment-table");
    expect(receiverSource).toContain("scroll={{ x: 825, y: 320 }}");
    expect(receiverSource).toContain('className="receiver-order-detail-modal order-detail-fixed-height-modal"');
    expect(receiverSource).toContain('responsive: ["xs", "sm"]');
    expect(receiverSource).toContain('fixed: "right"');
    expect(receiverSource).toContain("detailAttachmentKeyword");
    expect(receiverSource).toContain("detailAttachmentSource");
    expect(receiverSource).not.toContain("流程概览");
    expect(receiverSource).toContain("pageSize: 8");
    expect(receiverSource).toContain("附件日志（${logs.length}）");
    expect(receiverSource).not.toContain("receiver-attachment-preview");
    expect(receiverSource).not.toContain("打样单附件");
    expect(receiverSource).not.toContain("全部资料");
    expect(unifiedSource).toContain("attachmentSourceRoleOptions");
    expect(unifiedSource).toContain("全部标签");
    expect(unifiedSource).toContain('title: "版本"');
    expect(unifiedSource).not.toContain("版本筛选");
    expect(unifiedSource).toContain('title="改名附件"');
    expect(unifiedSource).toContain("{canRename(row) ? (");
    expect(unifiedSource).toContain("uploadedBy === currentUserId");
    expect(unifiedSource).toContain("validateAttachmentFileNameBody");
    expect(unifiedSource).toContain('label: "设为仅内部"');
    expect(unifiedSource).toContain('label: "设为客户可见"');
    expect(previewModalSource).toContain("URL.createObjectURL(blob)");
    expect(previewModalSource).toContain("URL.revokeObjectURL");
    expect(previewModalSource).toContain("isSafeAttachmentPreviewMime");
    expect(previewModalSource).toContain("当前格式不支持在线预览");
    expect(unifiedSource).not.toContain("设为可见");
    expect(unifiedSource).not.toContain("取消可见");
    expect(unifiedSource).not.toContain("预览/打开");
    expect(unifiedSource).toContain("downloadSelectedRows");
    expect(unifiedSource).toContain("修改文件名：${row.fileName}");
    expect(unifiedSource).toContain("删除");
    expect(unifiedSource).toContain("enableBulkDelete = false");
    expect(unifiedSource).toContain("删除选中的 ${selectedRows.length} 个附件？");
    expect(unifiedSource).toContain("...(!enableBulkDelete ? [{");
    expect(unifiedSource).toContain("selectedRows.every(canChangeVisibility)");
    expect(unifiedSource).toContain("所选附件中包含无权修改可见范围的文件");
    expect(unifiedSource).toContain('className={`unified-attachment-table');
    expect(unifiedSource).toContain("const [pageSize, setPageSize] = useState(() =>");
    expect(unifiedSource).toContain(
      "showSizeChanger={showPageSizeChanger ? NON_SEARCHABLE_PAGE_SIZE_CHANGER : false}",
    );
    expect(unifiedSource).toContain("bodyHeight = 360");
    expect(unifiedSource).toContain("compact = false");
    expect(unifiedSource).toContain('size: "small" as const');
    expect(unifiedSource).toContain("unified-attachment-toolbar-actions");
    expect(unifiedSource).toContain('y: workspace ? "100%" : bodyHeight');
    expect(unifiedSource).toContain("formatAttachmentDate(value)");
    expect(previewModalSource).toContain('width="calc(100vw - 48px)"');
    expect(previewModalSource).toContain('className="attachment-preview-modal"');
    expect(styles).toContain(".unified-attachment-table .ant-table-body");
    expect(styles).toContain("--unified-attachment-body-height");
    expect(styles).toContain("height: calc(100vh - 48px);");
    expect(plannerSource).toContain("<UnifiedAttachmentTable");
    expect(patternSource).toContain("<UnifiedAttachmentTable");
    expect(patternSource).toContain("compact\n      enableBulkDelete");
    expect(clientSource).toContain("<ThreeSourceMaterials");
    expect(receiverSource).toContain("<OrderAttachmentPanel");
    expect(bossSource).toContain("<OrderAttachmentPanel");
    expect(plannerSource).toContain("<OrderAttachmentPanel");
    expect(attachmentPanelSource).toContain("<ClientAttachmentPicker");
    expect(attachmentPanelSource).toContain("<UnifiedAttachmentTable");
    expect(attachmentPanelSource).toContain("enableBulkDelete");
    expect(attachmentPanelSource).toContain("compact");
    expect(attachmentPanelSource).toContain('compactLabel="附件（可选）"');
    expect(attachmentPanelSource).toContain("compactTrailingAction");
    expect(attachmentPanelSource).toContain("workspace?: boolean");
    expect(attachmentPanelSource).toContain('workspace ? " is-workspace" : ""');
    expect(receiverSource).toContain("<OrderAttachmentPanel\n          key={order.id}\n          workspace");
    expect(plannerSource).toContain("<OrderAttachmentPanel\n                        key={selectedOrder.id}\n                        workspace");
    expect(bossSource).toContain("<OrderAttachmentPanel\n          key={detailOrder.id}\n          workspace");
    expect(styles).toContain(".order-attachment-panel.is-workspace");
    expect(styles).toContain(".order-attachment-panel.is-workspace .client-attachment-picker-compact-list");
    expect(styles).toContain(".order-attachment-panel.is-workspace .unified-attachment-table .ant-table-body");
    expect(styles).toContain("overflow-y: auto !important;");
    expect(dialogLayoutSource).toContain("viewportBoundDialogWidth");
    expect(dialogLayoutSource).toContain("calc(100vw - 32px)");
    expect(attachmentPanelSource).not.toContain("uploadOpen");
    expect(attachmentPanelSource).not.toContain("sampleRoomApi.");
    expect(attachmentPanelSource).not.toContain("ReceiverOrderAttachment");
    expect(attachmentPanelSource).not.toContain("AdminOrderAttachment");
    expect(pickerSource).toContain('showVisibilityChoice = false');
    expect(pickerSource).toContain('showVisibilityChoice ? " has-visibility" : ""');
    expect(pickerSource).toContain('<span>客户可见</span>');
  });

  it("uses the compact attachment rename dialog for intake and other-charge attachments", () => {
    const pickerSource = read("components/ClientAttachmentPicker.tsx");
    const ledgerSource = read("components/operations/OrderChargeLedger.tsx");
    const readOnlySource = read("components/orders/OrderChargeReadOnlyPanel.tsx");
    const editModalSource = read("components/orders/OrderChargeEditModal.tsx");
    const chargeDialogSource = read("components/orders/ReceiverOrderChargeModal.tsx");
    const apiSource = read("api/sampleRoomApi.ts");

    expect(pickerSource).toContain('title="修改附件展示名称"');
    expect(pickerSource).toContain("<EditOutlined");
    expect(pickerSource).not.toContain("onBlur={() => normalizeNameAt(index)}");
    expect(ledgerSource.match(/allowRename/g)?.length).toBeGreaterThanOrEqual(2);
    expect(ledgerSource).toContain("onRenameAttachment");
    expect(readOnlySource).toContain("OrderChargeList");
    expect(editModalSource).toContain("onRenameAttachment");
    expect(editModalSource).toContain('title="编辑其他费用"');
    expect(chargeDialogSource).toContain("renameOrderChargeAttachment");
    expect(apiSource).toContain("/display-name");
  });

  it("adds boss order termination controls while keeping receiver and client active lists safe", () => {
    const adminSource = read("pages/admin/AdminDashboardPage.tsx");
    const systemOwnerSource = read("pages/system-owner/SystemOwnerPage.tsx");
    const bossPanelSource = read(
      "components/orders/BossOrderManagementPanel.tsx",
    );
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const clientOrdersSource = read("pages/client/ClientOrdersPage.tsx");
    const tableSource = read("components/OrderTable.tsx");
    const apiSource = read("api/sampleRoomApi.ts");
    const styles = read("app/styles.css");
    const activeActions = bossPanelSource.slice(
      bossPanelSource.indexOf("const activeActions"),
      bossPanelSource.indexOf("const terminatedActions")
    );

    expect(adminSource).toContain("BossOrderManagementPanel");
    expect(systemOwnerSource).toContain("BossOrderManagementPanel");
    expect(bossPanelSource).toContain("listAdminActiveOrders");
    expect(bossPanelSource).toContain("listAdminTerminatedOrders");
    expect(bossPanelSource).toContain("terminateAdminOrder");
    expect(bossPanelSource).toContain("restoreAdminOrder");
    expect(bossPanelSource).toContain('setTerminatedKeyword("")');
    expect(bossPanelSource).not.toContain("setTerminatedKeyword(terminatingOrder.styleNo)");
    expect(bossPanelSource).toContain("getAdminOrderDetail");
    expect(bossPanelSource).toContain("downloadAdminOrderAttachment");
    expect(bossPanelSource).toContain("loadDeliverablePreview");
    expect(bossPanelSource).toContain("OrderAttachmentThumbnail");
    expect(bossPanelSource).toContain("订单状态总览");
    expect(bossPanelSource).toContain("活跃订单（");
    expect(bossPanelSource).toContain("终止订单");
    expect(bossPanelSource).toContain("查看详情");
    expect(activeActions).not.toContain("查看详情");
    expect(activeActions).toContain("其他费用 {order.chargeCount ?? 0}");
    expect(bossPanelSource).toContain("订单详情");
    expect(bossPanelSource).toContain("附件资料");
    expect(bossPanelSource).toContain("流程记录");
    expect(bossPanelSource).toContain("查看瑕疵记录");
    expect(bossPanelSource).toContain("downloadAdminQcReworkPhoto");
    expect(bossPanelSource).toContain("qcReworkRecords");
    expect(bossPanelSource).toContain('activeKey={detailTab}');
    expect(bossPanelSource).toContain('key: "complaints"');
    expect(bossPanelSource).not.toContain('key: "overview"');
    expect(bossPanelSource).not.toContain('key: "scans"');
    expect(bossPanelSource).not.toContain('key: "termination"');
    expect(bossPanelSource).toContain("defaultPageSize: 10");
    expect(bossPanelSource).toContain('scroll={{ y: "100%" }}');
    expect(bossPanelSource).toContain("恢复订单");
    expect(bossPanelSource).toContain("订单不会删除");
    expect(bossPanelSource).toContain('title: "接单时间"');
    expect(bossPanelSource).toContain("终止前状态");
    expect(bossPanelSource).toContain("boss-active-filter-bar");
    expect(bossPanelSource).toContain("bossStageFilterOptions");
    expect(bossPanelSource).toContain("matchesBossStageFilter");
    expect(bossPanelSource).toContain('aria-label="筛选当前工序"');
    expect(bossPanelSource).not.toContain("orderStatusFilterOptions");
    expect(bossPanelSource).not.toContain("ORDER_STAGES.cuttingHandoffWaiting");
    expect(bossPanelSource).toContain("boss-terminated-search");
    expect(bossPanelSource).toContain("搜索终止订单 / 款号 / 客户 / 终止原因");
    expect(bossPanelSource).toContain("boss-active-table");
    expect(bossPanelSource).toContain('scroll={{ x: "max-content", y: "100%", scrollToFirstRowOnChange: true }}');
    expect(bossPanelSource).toContain("const updateTerminatedKeyword = (keyword: string) =>");
    expect(bossPanelSource).toContain("if (activePage !== currentActivePage) setActivePage(currentActivePage)");
    expect(bossPanelSource).toContain("if (terminatedPage !== currentTerminatedPage) setTerminatedPage(currentTerminatedPage)");
    expect(read("components/orders/BossPricingPanel.tsx").match(
      /y: "100%", scrollToFirstRowOnChange: true/g
    )).toHaveLength(2);
    expect(bossPanelSource).toContain('scroll={{ x: 1440, y: "100%", scrollToFirstRowOnChange: true }}');
    expect(bossPanelSource).toContain("width: 360");
    expect(bossPanelSource).toContain("width: 220");
    expect(bossPanelSource).toContain("width: 116");
    expect(bossPanelSource).toContain('className="boss-order-row-action"');
    expect(bossPanelSource).toContain("const [terminatedExpanded, setTerminatedExpanded] = useState(false)");
    expect(bossPanelSource).toContain("aria-expanded={terminatedExpanded}");
    expect(bossPanelSource).toContain("setTerminatedExpanded((expanded) => !expanded)");
    expect(bossPanelSource).toContain('{terminatedExpanded ? "收起" : "展开"}');
    expect(bossPanelSource).toContain("{terminatedExpanded ? (");
    expect(styles).toContain(".boss-order-detail-modal");
    expect(styles).toContain(".boss-order-summary-header");
    expect(styles).toContain(".boss-order-detail-group");
    expect(styles).toContain(".boss-order-table .ant-table-container");
    expect(styles).toContain(".boss-order-table .ant-table-content");
    expect(styles).toContain("overflow-x: auto;");
    expect(styles).toContain(".boss-active-table .ant-table-tbody > tr > td");
    expect(styles).toContain(".boss-order-workspace-pagination {\n  display: flex;");
    expect(styles).toContain("justify-content: flex-end;");
    expect(styles).not.toContain(".boss-active-table .ant-table-body,\n.boss-pricing-pending-table");
    expect(styles).not.toContain(".terminated-orders-section.is-expanded:has(.ant-table-placeholder)");
    expect(styles).toContain(".boss-pricing-pending-table .ant-table-body");
    expect(styles).toContain(".boss-pricing-statements-table .ant-table-body");
    expect(styles).toContain("height: clamp(280px, calc(100vh - 500px), 720px);");
    const summaryHeader = read("components/orders/BossOrderSummaryHeader.tsx");
    expect(summaryHeader).toContain("客户业务员");
    expect(summaryHeader).toContain("order.receivedAt ? formatOrderDate(order.receivedAt) : \"未接单\"");
    expect(summaryHeader).toContain("hasPhysicalProductionRoute(order.sampleRequestItems)");
    expect(summaryHeader).toContain("maxRows={2}");
    expect(bossPanelSource).not.toContain("<IntakeTag value={detailOrder.intakeStatus}");
    expect(bossPanelSource).not.toContain("<Tag color=\"green\">活跃</Tag>");
    expect(styles).toContain("min-height: 76px;");
    expect(styles).toContain("white-space: normal;");
    expect(styles).toContain("overflow-wrap: anywhere;");
    expect(styles).toContain("word-break: break-word;");
    expect(styles).toContain(".boss-order-row-action");
    expect(styles).toContain("white-space: nowrap;");
    expect(adminSource).not.toContain("RoleTaskRoomHeader");
    expect(receiverSource).toContain("!order.terminated");
    expect(receiverSource.match(/workspace/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(receiverSource).toContain('pageSizeStorageKey="sample-room:receiver-orders:page-size"');
    expect(clientOrdersSource).toContain('scrollY="calc(100vh - 430px)"');
    expect(tableSource).toContain("scrollY?: number | string");
    expect(tableSource).toContain("scrollX?: number | string");
    expect(tableSource).toContain("...(scrollX ? { x: scrollX } : {})");
    expect(tableSource).toContain('...(workspace ? { y: "100%" } : scrollY ? { y: scrollY } : {})');
    expect(apiSource).toContain("/api/admin/orders");
    expect(apiSource).toContain("/api/admin/orders/terminated");
    expect(clientOrdersSource).not.toContain("terminateAdminOrder");
    expect(clientOrdersSource).not.toContain("terminationReason");
  });

  it("keeps worker scan pages identity-first and free of raw order enum labels", () => {
    const scanTaskSource = read("pages/scan/ScanTaskPage.tsx");
    const scanDisplaySource = read("components/scan/scanDisplay.ts");

    expect(scanTaskSource).toContain("未登录生产员工");
    expect(scanTaskSource).toContain("请先登录有效的生产员工账号。");
    expect(scanTaskSource).toContain("账号身份与当前生产岗位已由服务端确认");
    expect(scanTaskSource).not.toContain("设备：");
    expect(scanTaskSource).toContain("客户：{state.order.customerName}");
    expect(scanTaskSource).toContain("客户业务员：{state.order.salespersonName}");
    expect(scanTaskSource).not.toContain("quotedPrice");
    expect(scanTaskSource).not.toContain("internalCost");
    expect(scanTaskSource).not.toContain("profit");
    expect(scanTaskSource).toContain("已轮到你的工序");
    expect(scanTaskSource).toContain("确认后开始缝制任务。");
    expect(scanTaskSource).toContain("你已开始该工序");
    expect(scanTaskSource).toContain("确认完成件数和工时后提交缝制结果。");
    expect(scanTaskSource).toContain("裁剪不需要开始扫码");
    expect(scanTaskSource).toContain("组检不需要开始扫码");
    expect(scanTaskSource).toContain("qc_sample_photo");
    expect(scanTaskSource).toContain("qc_measurement_photo");
    expect(scanTaskSource).toContain("takeoverExpectedWorkerId");
    expect(scanTaskSource).toContain("此提示不阻断当前实体工序");
    expect(scanTaskSource).toContain("5 秒后自动返回当前角色界面");
    expect(scanTaskSource).toContain("立即返回");
    expect(scanTaskSource).toContain("上一工序还没有完成扫码");
    expect(scanTaskSource).toContain("该工序已由其他员工开始");
    expect(scanTaskSource).toContain("实体生产已完成");
    expect(scanTaskSource).toContain('message: "订单已终止"');
    expect(scanTaskSource).toContain('text === "订单已终止"');
    expect(scanTaskSource).not.toContain("termination_complete");
    expect(scanTaskSource).not.toContain("缝制终止结算");
    expect(scanTaskSource).not.toContain("terminationCompleteScan");
    expect(scanTaskSource).toContain(
      'scanActionButtonLabel(state.stage, "start")',
    );
    expect(scanTaskSource).toContain(
      'scanActionButtonLabel(state.stage, "complete")',
    );
    expect(scanTaskSource).toContain("state.order.customerName");
    expect(scanTaskSource).toContain("state.order.salespersonName");
    expect(scanTaskSource).toContain("state.order.thumbnailUrl");
    expect(scanTaskSource).not.toContain("sampleTypeLabel(state.order.sampleType)");
    expect(scanTaskSource).not.toContain("sampleRoundLabel(state.order.sampleRound)");
    expect(scanTaskSource).not.toContain("orderStageLabel(state.order.stage)");
    expect(scanDisplaySource).toContain("orderStageOptions");
    expect(scanDisplaySource).not.toContain("sampleTypeOptions");
    expect(scanDisplaySource).toContain("sampleRoundOptions");
    expect(scanDisplaySource).toContain("制版");
    expect(scanDisplaySource).toContain("裁剪");
    expect(scanDisplaySource).toContain("缝制");
    expect(scanDisplaySource).toContain("组检/出库");
    expect(scanDisplaySource).toContain("开始");
    expect(scanDisplaySource).toContain("完成");
    expect(scanDisplaySource).toContain("termination_complete");
    expect(scanDisplaySource).toContain("终止完成");
    expect(scanTaskSource).not.toContain("{state.order.stage ??");
    expect(scanTaskSource).not.toContain("{state.order.sampleType}");
    expect(scanTaskSource).not.toContain("{state.order.sampleRound}");
  });

  it("derives rework order labels and normal QC record wording", () => {
    expect(orderCompletionLabel({
      stage: "qc_delivery_waiting",
      stageLabel: "待组检/出库",
      completionStatus: "in_progress"
    })).toBe("待组检/出库");
    expect(orderCompletionLabel({
      stage: "qc_delivery_waiting",
      stageLabel: "待返工",
      completionStatus: "in_progress"
    })).toBe("待返工");
    expect(orderCompletionLabel({
      stage: "done",
      stageLabel: "已完成",
      completionStatus: "completed"
    })).toBe("已完成");

    const reworkRecord: ScanRecord = {
      id: "qc-rework",
      orderId: "order-qc",
      stage: "qc_delivery",
      stageLabel: "组检/出库",
      orderStage: "qc_delivery_waiting",
      action: "complete",
      actionLabel: "完成",
      workerId: "qc-a",
      workerName: "组检 A",
      eventTime: "2026-08-05T00:00:00.000Z",
      qualityResult: "rework",
      qualityScore: 80,
      note: "tac"
    };
    expect(scanRecordTitle(reworkRecord)).toBe("组检退回返工");
    expect(scanRecordNoteLabel(reworkRecord)).toBe("返工原因：tac");
    expect(scanRecordQualityScoreLabel(reworkRecord)).toBeUndefined();

    const qualifiedRecord: ScanRecord = {
      ...reworkRecord,
      id: "qc-qualified",
      orderStage: "done",
      qualityResult: "qualified",
      qualityScore: 95,
      note: "复检通过"
    };
    expect(scanRecordTitle(qualifiedRecord)).toBe("组检合格并完成");
    expect(scanRecordQualityScoreLabel(qualifiedRecord)).toBe("质量评分：95");
    expect(scanRecordNoteLabel(qualifiedRecord)).toBe("备注：复检通过");

    expect(read("components/OrderTable.tsx")).toContain("stageLabel: order.stageLabel");
    expect(read("pages/receiver/ReceiverWorkbenchPage.tsx")).toContain("label: order.stageLabel");
    expect(read("pages/planner/PlannerWorkbenchPage.tsx")).toContain("stageLabel={order.stageLabel}");
    expect(read("components/orders/BossOrderSummaryHeader.tsx")).toContain(
      "stageLabel: order.stageLabel"
    );
  });

  it("adds receiver-only order correction with protected ownership and folded logs", () => {
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const correctionModalSource = read(
      "components/orders/ReceiverCorrectionModal.tsx",
    );
    const correctionLogSource = read(
      "components/orders/ReceiverCorrectionLog.tsx",
    );
    const apiSource = read("api/sampleRoomApi.ts");
    const clientOrdersSource = read("pages/client/ClientOrdersPage.tsx");
    const clientMobileSource = read("pages/client/ClientMobilePage.tsx");

    expect(receiverSource).toContain("correctionAction");
    expect(receiverSource).toContain("校正资料");
    expect(receiverSource).toContain("ReceiverCorrectionModal");
    expect(receiverSource).toContain("ReceiverCorrectionLog");
    expect(receiverSource).toContain("correctReceiverOrder(session, correctingOrder.id, values)");
    expect(receiverSource).toContain("acceptOrder(session, correctingOrder.id");
    expect(receiverSource).toContain("intent === \"complete\"");
    expect(receiverSource).toContain("addReceiverOrderAttachments");
    expect(apiSource).toContain("/api/receiver/orders/${id}/correction");
    expect(correctionModalSource).toContain("校正订单资料");
    expect(correctionModalSource).toContain("保存草稿");
    expect(correctionModalSource).toContain("完成校正并进入订单列表");
    expect(correctionModalSource).toContain("style_thumbnail");
    expect(correctionModalSource).toContain("thumbnailAttachments");
    expect(correctionModalSource).toContain("receiver-correction-thumbnail-controls");
    expect(correctionModalSource).not.toContain("receiver-correction-thumbnail-drop");
    expect(correctionModalSource).toContain("onThumbnailPaste");
    expect(correctionModalSource).toContain("款号");
    expect(correctionModalSource).toContain("款名");
    expect(correctionModalSource).toContain("数量 / 打样件数");
    expect(correctionModalSource).toContain("样品类型");
    expect(correctionModalSource).toContain("样品轮次");
    expect(correctionModalSource).toContain("期望交期");
    expect(correctionModalSource).not.toContain("版子状态");
    expect(correctionModalSource).toContain("面里料状态");
    expect(correctionModalSource).toContain("辅料状态");
    expect(correctionModalSource).toContain("裁剪已提交或缝制已接单，件数不可修改。");
    expect(correctionModalSource).toContain("canEditOrderQuantityForReceiver");
    expect(correctionModalSource).toContain("quantityCorrectionLocked");
    expect(correctionModalSource).not.toContain("ORDER_STAGES.qcDeliveryWaiting");
    expect(correctionModalSource).not.toContain('name="customerId"');
    expect(correctionModalSource).not.toContain('name="clientUserId"');
    expect(correctionLogSource).toContain("订单资料修改记录");
    expect(correctionLogSource).toContain("暂无修改记录");
    expect(correctionLogSource).toContain("defaultActive = false");
    expect(correctionLogSource).toContain("defaultActiveKey");
    expect(correctionLogSource).toContain("formatCorrectionFieldName");
    expect(correctionLogSource).toContain("formatCorrectionValue");
    expect(correctionLogSource).toContain("formatRoleName");
    expect(clientOrdersSource).not.toContain("ReceiverCorrectionLog");
    expect(clientMobileSource).not.toContain("ReceiverCorrectionLog");
  });

  it("keeps legacy pattern status out of receiver correction and traditional intake forms", () => {
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const receiverMobileSource = read("pages/receiver/ReceiverMobilePage.tsx");

    expect(receiverSource).not.toContain('<Form.Item label="版子状态" name="patternStatus"');
    expect(receiverMobileSource).not.toContain('<Form.Item label="版子状态" name="patternStatus"');
    expect(receiverSource).toContain('patternStatus: "none"');
    expect(receiverMobileSource).toContain('patternStatus: "none"');
  });

  it("keeps the required receiver all-status filter and exports the order-query filtered dataset", () => {
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const filterSource = read("components/orders/OrderDesktopFilterBar.tsx");
    const filterModelSource = read("components/orders/orderFilters.ts");
    const dialogSource = read("components/export/OrderExportDialog.tsx");

    expect(filterSource).toContain('onClick={() => setQuickDateRange("week")}');
    expect(filterSource).toContain(
      'onClick={() => setQuickDateRange("month")}',
    );
    expect(filterSource).toContain(
      'onClick={() => setQuickDateRange("quarter")}',
    );
    expect(filterSource).toContain("order-filter-date-label");
    expect(filterSource).toContain("useSampleTypeOptions");
    expect(filterSource).toContain("options={sampleTypeOptions}");
    expect(filterSource).toContain("clientSampleRoundFilterOptions");
    expect(filterModelSource).toContain("receiverActiveTracking");
    expect(filterModelSource).toContain('quickDateRange: "month"');
    expect(receiverSource).toContain("createCurrentMonthOrderFilters");
    expect(receiverSource).toContain("导出 Excel");
    expect(receiverSource).toContain("OrderExportDialog");
    expect(receiverSource).toContain('role="receiver"');
    expect(receiverSource).toContain("selectedQueryRowKeys");
    expect(receiverSource).toContain(
      "resolveOrderExportDataset(filteredQueryOrders, selectedQueryRowKeys, filters)",
    );
    expect(receiverSource).toContain("orders={exportDataset.orders}");
    expect(receiverSource).toContain("exportScope={exportDataset.scope}");
    expect(receiverSource).toContain("selectable");
    expect(receiverSource).toContain("已选择 {exportDataset.orders.length} 条");
    expect(dialogSource).toContain("默认文件名");
    expect(dialogSource).toContain("当前浏览器将使用默认下载目录");
    expect(dialogSource).toContain("已勾选订单优先导出");
    expect(dialogSource).toContain(
      "createXlsxBlob(exportRows(orders, selectedColumns)",
    );
    expect(receiverSource).not.toContain("exportReceiverOrdersToExcel");
    expect(receiverSource).not.toContain("application/vnd.ms-excel");
    expect(receiverSource).not.toContain("orderNo");
  });

  it("shows safe entry date, delivery date, and business user in web order rows", () => {
    const titleCellSource = read("components/orders/OrderTitleCell.tsx");
    const clientOrdersSource = read("pages/client/ClientOrdersPage.tsx");

    expect(titleCellSource).toContain("formatEntryDate(order.createdAt)");
    expect(titleCellSource).toContain("formatDeliveryDate(order.deliveryDate)");
    expect(titleCellSource).toContain("getOrderBusinessUserName(order)");
    expect(titleCellSource).toContain("getOrderCustomerName(order)");
    expect(titleCellSource).toContain("录入：");
    expect(titleCellSource).toContain("交期：");
    expect(titleCellSource).toContain("业务员：");
    expect(titleCellSource).toContain("客户：");
    expect(clientOrdersSource).toContain('audience="client"');
  });

  it("shows entry and delivery dates in client workbench recent orders", () => {
    const source = read("pages/client/ClientWorkbenchPage.tsx");

    expect(source).toContain("formatEntryDate(order.createdAt)");
    expect(source).toContain("formatDeliveryDate(order.deliveryDate)");
    expect(source).toContain("RecentOrderSummary");
    expect(source).not.toContain("showBusinessUser={!canCreateOrder}");
  });

  it("shows entry date, delivery date, and business user on client mobile cards", () => {
    const source = read("pages/client/ClientMobilePage.tsx");

    expect(source).toContain("formatEntryDate(order.createdAt)");
    expect(source).toContain("formatDeliveryDate(order.deliveryDate)");
    expect(source).toContain("getOrderBusinessUserName(order)");
    expect(source).toContain('label: "业务员"');
    expect(source).toContain('label: "录入"');
    expect(source).toContain('label: "交期"');
  });

  it("shows the accepted receive date, customer, and business user on receiver mobile cards", () => {
    const source = read("pages/receiver/ReceiverMobilePage.tsx");

    expect(source).toContain("formatEntryDate(order.createdAt)");
    expect(source).not.toContain("formatDeliveryDate(order.deliveryDate)");
    expect(source).toContain("getOrderBusinessUserName(order)");
    expect(source).toContain("getOrderCustomerName(order)");
    expect(source).toContain('label: "客户"');
    expect(source).toContain('label: "业务员"');
    expect(source).toContain('label: "接单日期"');
  });

  it("keeps sample type and round visible in client and receiver mobile browsing cards", () => {
    const clientMobileSource = read("pages/client/ClientMobilePage.tsx");
    const receiverMobileSource = read("pages/receiver/ReceiverMobilePage.tsx");

    expect(clientMobileSource).toContain(
      "sampleTypeLabel(order.sampleType)",
    );
    expect(clientMobileSource).toContain(
      "optionLabel(sampleRoundOptions, order.sampleRound)",
    );
    expect(clientMobileSource).toContain("order.sampleType");
    expect(clientMobileSource).toContain("order.sampleRound");
    expect(receiverMobileSource).toContain(
      "sampleTypeLabel(order.sampleType)",
    );
    expect(receiverMobileSource).toContain(
      "optionLabel(sampleRoundOptions, order.sampleRound)",
    );
    expect(receiverMobileSource).toContain("order.sampleType");
    expect(receiverMobileSource).toContain("order.sampleRound");
  });

  it("uses structured mobile order card sections for receiver and client browsing", () => {
    const clientMobileSource = read("pages/client/ClientMobilePage.tsx");
    const receiverMobileSource = read("pages/receiver/ReceiverMobilePage.tsx");
    const mobilePartsSource = read(
      "components/orders/MobileOrderCardParts.tsx",
    );
    const styles = read("app/styles.css");

    for (const source of [clientMobileSource, receiverMobileSource]) {
      expect(source).toContain("MobileOrderTitleBlock");
      expect(source).toContain("MobileOrderStatusBlock");
      expect(source).toContain("MobileOrderKeyGrid");
      expect(source).toContain("MobileOrderActionRow");
    }

    expect(mobilePartsSource).toContain("mobile-order-title-block");
    expect(mobilePartsSource).toContain("mobile-card-status-row");
    expect(mobilePartsSource).toContain("mobile-key-field-grid");
    expect(mobilePartsSource).toContain("mobile-card-action-row");
    expect(styles).toContain(".mobile-order-title-block");
    expect(styles).toContain(".mobile-card-status-row");
    expect(styles).toContain(".mobile-key-field-grid");
    expect(styles).toContain(".mobile-card-action-row");
    expect(styles).toContain("@media (max-width: 360px)");
  });

  it("lets receiver web intake fill wide screens and rename selected files without a camera-only input", () => {
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const intakeAttachmentSource = read("components/receiver/ReceiverIntakeAttachmentWorkspace.tsx");
    const styles = read("app/styles.css");
    const webIntakeSource = receiverSource.slice(
      receiverSource.indexOf('key: "self-entry"'),
      receiverSource.indexOf('key: "pending"'),
    );

    expect(styles).toContain(".receiver-workbench {");
    expect(styles).toContain("max-width: none;");
    expect(webIntakeSource.match(/<ReceiverIntakeAttachmentWorkspace/g)).toHaveLength(2);
    expect(intakeAttachmentSource).toContain("拍摄下一张");
    expect(intakeAttachmentSource).toContain("从相册选择");
    expect(intakeAttachmentSource).toContain("renameAttachment");
    expect(intakeAttachmentSource).toContain('capture="environment"');
    expect(intakeAttachmentSource).toContain('ref={sampleInputRef} hidden type="file" multiple');
    expect(intakeAttachmentSource).toContain('ref={ordinaryInputRef} hidden type="file" multiple');
  });

  it("keeps own-charge maintenance as the default and enables explicit admin maintenance", () => {
    const receiverSource = read("pages/receiver/ReceiverWorkbenchPage.tsx");
    const plannerSource = read("pages/planner/PlannerWorkbenchPage.tsx");
    const readOnlySource = read("components/orders/OrderChargeReadOnlyPanel.tsx");
    const chargeListSource = read("components/orders/OrderChargeList.tsx");
    const chargeLedgerSource = read("components/operations/OrderChargeLedger.tsx");
    const editModalSource = read("components/orders/OrderChargeEditModal.tsx");
    const chargeDialogSource = read("components/orders/ReceiverOrderChargeModal.tsx");
    const correctionSource = read("components/orders/ReceiverCorrectionModal.tsx");
    const dynamicPricingSource = read("components/orders/DynamicPricingModal.tsx");
    const styles = read("app/styles.css");

    expect(receiverSource).not.toContain("登记其他费用");
    expect(plannerSource).not.toContain("登记其他费用");
    expect(readOnlySource).toContain("OrderChargeList");
    expect(chargeLedgerSource).toContain("OrderChargeList");
    expect(chargeListSource).toContain("showStatus = false");
    expect(chargeListSource).toContain("showStatus ? <span>状态</span> : null");
    expect(chargeListSource).toContain('charge.status === "effective" || charge.status === "pending"');
    expect(chargeListSource).toContain("canManageAll || (");
    expect(chargeListSource).toContain("maintenanceDisabled");
    expect(chargeListSource).toContain('{(charge.attachments ?? []).length}个附件');
    expect(chargeListSource).toContain('charge.creatorName ?? "—"');
    expect(chargeListSource).toContain("OrderChargeEditModal");
    expect(editModalSource).toContain("onAddAttachments");
    expect(editModalSource).toContain("onDeleteAttachment");
    expect(editModalSource).toContain("loadAttachmentBlob");
    expect(editModalSource).toContain("<AttachmentPreviewModal");
    expect(editModalSource).not.toContain("onPreviewAttachment");
    expect(editModalSource).not.toContain("onDownloadAttachment");
    expect(editModalSource).toContain("canManageAll || attachment.uploadedBy === currentUserId");
    expect(editModalSource).toContain('width={viewportBoundDialogWidth("form")}');
    expect(editModalSource).toContain("app-workspace-modal-data order-charge-edit-modal");
    expect(editModalSource).toContain('className="order-charge-edit-attachment-body"');
    expect(styles).toContain(".order-charge-edit-modal .order-charge-edit-attachment-body");
    expect(styles).toContain(".order-charge-edit-modal .client-attachment-picker-compact-list");
    expect(correctionSource).toContain('width={viewportBoundDialogWidth("workspace")}');
    expect(correctionSource).toContain("app-workspace-modal-data receiver-correction-wide-modal");
    expect(correctionSource).toContain("onWheel={onPreviewWheel}");
    expect(correctionSource).toContain("onPointerMove={onPreviewPointerMove}");
    expect(dynamicPricingSource).toContain('width={viewportBoundDialogWidth("data")}');
    expect(dynamicPricingSource).toContain("dynamic-pricing-workspace");
    expect(dynamicPricingSource).toContain("dynamic-pricing-data-workspace");
    expect(dynamicPricingSource).toContain("<Table.Summary fixed>");
    expect(dynamicPricingSource).toContain('className="dynamic-pricing-internal-cost-summary"');
    expect(styles).toContain("height: min(1040px, calc(100dvh - 32px));");
    expect(styles).toContain("grid-template-rows: minmax(244px, 1.08fr) minmax(194px, 1fr);");
    expect(styles).not.toContain("height: 445px;");
    expect(styles).toContain(".dynamic-pricing-internal-cost-table .ant-table-summary");
    expect(styles).toContain(".app-workspace-modal .ant-modal-content");
    expect(styles).toContain(".app-workspace-modal-scroll .ant-modal-body");
    expect(chargeDialogSource).toContain("desktopModalLayout");
    expect(chargeLedgerSource).not.toContain("bodyHeight={280}");
    expect(chargeDialogSource).toContain("addOrderChargeAttachments");
    expect(chargeDialogSource).toContain('role: "receiver" | "planner" | "admin"');
    expect(chargeDialogSource).toContain('canManageAll={role === "admin"}');
  });

  it("keeps receiver mobile limited to现场录入、只读订单和扫描费用", () => {
    const receiverMobileSource = read("pages/receiver/ReceiverMobilePage.tsx");

    expect(receiverMobileSource).toContain(
      'type MobileTab = "list" | "self-entry" | "scan-charge"',
    );
    expect(receiverMobileSource).toContain('key: "list"');
    expect(receiverMobileSource).toContain('key: "self-entry"');
    expect(receiverMobileSource).toContain('key: "scan-charge"');
    expect(receiverMobileSource).not.toContain('key: "tracking"');
    expect(receiverMobileSource).not.toContain('key: "all"');
    expect(receiverMobileSource).toContain(
      'getReceiverMobileTabDefaultFilters("list")',
    );
    expect(receiverMobileSource).toContain("createCurrentMonthOrderFilters");
    expect(receiverMobileSource).toContain("MobileScanChargePanel");
    expect(receiverMobileSource).toContain("手机端订单详情为只读页面");
    expect(receiverMobileSource).toContain("onClick={() => setViewingOrder(order)}");
    expect(receiverMobileSource).toContain("ReceiverSelfEntryAttachmentFields");
    expect(receiverMobileSource).toContain("autoOpenTarget=\"camera\"");
    expect(receiverMobileSource).toContain("addReceiverOrderAttachments");
  });

  it("keeps receiver mobile high-frequency filters visible in the compact shared panel", () => {
    const receiverSource = read("components/orders/OrderMobileFilterBar.tsx");
    const panelSource = read("components/orders/MobileOrderFilterPanel.tsx");

    expect(receiverSource).toContain("MobileOrderFilterPanel");
    expect(receiverSource).toContain("orderStatusFilterOptions");
    expect(receiverSource).toContain("showCustomerFilter");
    expect(receiverSource).toContain("showBusinessUserFilter");
    expect(receiverSource).toContain("showSampleRoundQuickFilter");
    expect(panelSource).toContain("keywordPlaceholder");
    expect(panelSource).toContain('onClick={() => setQuickDateRange("week")}');
    expect(panelSource).toContain('onClick={() => setQuickDateRange("month")}');
    expect(panelSource).toContain(
      'onClick={() => setQuickDateRange("quarter")}',
    );
    expect(panelSource).toContain("mobile-filter-date-shortcuts");
    expect(panelSource).toContain('placeholder="全部状态"');
    expect(panelSource).toContain('placeholder="全部客户"');
    expect(panelSource).toContain('placeholder="全部业务员"');
    expect(panelSource).toContain('data-testid="mobile-filter-more-trigger"');
    expect(panelSource).toContain('data-testid="mobile-filter-chip-summary"');
    expect(panelSource).toContain("deliveryStartDate");
    expect(panelSource).toContain("startDate");
    expect(panelSource).not.toContain("patternStatusFilterOptions");
    expect(panelSource).toContain("fabricStatusFilterOptions");
    expect(panelSource).toContain("trimStatusFilterOptions");
  });

  it("keeps only one reset action in the shared mobile filter panel", () => {
    const receiverSource = read("components/orders/OrderMobileFilterBar.tsx");
    const clientSource = read(
      "components/orders/ClientOrderMobileFilterBar.tsx",
    );
    const panelSource = read("components/orders/MobileOrderFilterPanel.tsx");

    expect(receiverSource).not.toContain("Drawer");
    expect(clientSource).not.toContain("Drawer");
    expect(
      panelSource.match(/data-testid="mobile-filter-reset"/g),
    ).toHaveLength(1);
  });

  it("requires QC score and received pieces and keeps them in the boss QC result", () => {
    const scanSource = read("pages/scan/ScanTaskPage.tsx");
    const bossSource = read("components/orders/BossOrderManagementPanel.tsx");

    expect(scanSource).toContain('label="质量评分（0-100分）"');
    expect(scanSource).toContain('name="qualityScore"');
    expect(scanSource).toContain('label="实收件数"');
    expect(scanSource).toContain('name="pieces"');
    expect(scanSource).toContain("确认组检/出库结果？");
    expect(bossSource).toContain('{ key: "score", label: "质量评分"');
    expect(bossSource).toContain('{ key: "pieces", label: "检查件数"');
  });

  it("labels QC evidence as a QC report and filters internal materials by uploader role", () => {
    const materialsSource = read("components/operations/ThreeSourceMaterials.tsx");

    expect(materialsSource).toContain("样衣QC报告");
    expect(materialsSource).toContain('{ label: "组检/出库", value: "qc_delivery" }');
    expect(materialsSource).toContain('{ label: "版师", value: "pattern_maker" }');
    expect(materialsSource).toContain('{ label: "裁剪", value: "cutting" }');
    expect(materialsSource).toContain('{ label: "接单员", value: "receiver" }');
    expect(materialsSource).toContain('{ label: "计划员", value: "planner" }');
    expect(materialsSource).toContain('attachment.category === "qc_sample_photo"');
    expect(materialsSource).toContain('attachment.category === "qc_measurement_photo"');
    expect(materialsSource).toContain('attachment.category === "receiver_material_record"');
    expect(materialsSource).toContain("接单员上传");
    expect(materialsSource).toContain("面辅料记录");
  });

  it("lets the boss register traceable complaints and shows them in a dedicated detail tab", () => {
    const bossSource = read("components/orders/BossOrderManagementPanel.tsx");

    expect(bossSource).toContain("登记客诉");
    expect(bossSource).toContain("sampleGarmentRequiredFromItems(order.sampleRequestItems)");
    expect(bossSource).toContain("registerAdminOrderComplaint");
    expect(bossSource).toContain("deleteAdminOrderComplaint");
    expect(bossSource).toContain('label: `客诉记录 ${detailComplaints.length}`');
    expect(bossSource).toContain('<Empty description="暂无客诉记录" />');
    expect(bossSource).toContain("complaint.qcWorkerNameSnapshot");
    expect(bossSource).toContain("最近一次组检/出库完成人员");
    expect(bossSource).toContain('title: "客诉情况"');
    expect(bossSource).toContain("有客诉");
    expect(bossSource).toContain("删除这条客诉记录？");
    expect(bossSource).toContain('key === "complaintStatus"');
    expect(bossSource).toContain('placeholder="全部客诉情况"');
    expect(bossSource).toContain('complaint: complaint as BossActiveFilters["complaint"]');
    expect(bossSource).toContain('key: "actions"');
    expect(bossSource).toContain('fixed: "right"');
    expect(bossSource).not.toMatch(/key: "complaintStatus",[\s\S]*?fixed: "right",[\s\S]*?key: "actions"/);
    expect(bossSource).toContain('scroll={{ x: "max-content", y:');
  });

  it("shows order details only for a selected cutting, sewing, or QC employee", () => {
    const source = read("pages/admin/BossPerformancePage.tsx");
    expect(source).not.toContain('toLocaleDateString("sv-SE")');
    expect(source).toContain("bossPerformanceQuickRangeDates");
    expect(source).toContain('useMemo(() => quickRangeDates("week"), [])');
    expect(source).toContain('<Input type="date" value={dateFrom}');
    expect(source).toContain('const dates = quickRangeDates("week")');
    expect(source).toContain("includeOrderDetails:");
    expect(source).toContain("const changeEmployee =");
    expect(source).toContain("void load(stage, nextIdentityId)");
    expect(source).toContain("onChange={changeEmployee}");
    expect(source).toContain('title="总工时"');
    expect(source).toContain('title="每小时产出"');
    expect(source).toContain("所选员工完成订单");
    expect(source).toContain("最终组检评分");
    for (const label of ["日期", "客户", "客户业务员", "款号", "款名", "件数", "质量评分", "返工次数", "投诉情况"]) {
      expect(source).toContain(`title: "${label}"`);
    }
    expect(source).toContain('dataIndex: "salespersonName"');
    expect(source).toContain('["cutting", "sewing", "qc_delivery"].includes(stage)');
  });

  it("organizes System Owner maintenance into user-facing sections with technical details collapsed", () => {
    const source = read("pages/system-owner/SystemOwnerMaintenancePanel.tsx");
    const health = read("pages/system-owner/SystemHealthPanel.tsx");
    const history = read("pages/system-owner/LifecycleOperationHistoryPanel.tsx");

    for (const section of ["系统概览", "备份与恢复", "系统更新", "存储管理", "系统迁移", "检查系统", "操作记录"]) {
      expect(source).toContain(section);
    }
    expect(source).toContain("高级维护");
    expect(source).toContain("sessionStorage");
    expect(health).toContain("当前影响");
    expect(health).toContain("下一步");
    expect(history).toContain("当前数据");
    expect(history).toContain("查看技术详情");
    expect(source).not.toContain("StorageMigrationPlan");
    expect(source).not.toContain("LifecycleJob");
    expect(source).not.toContain("Runner");
  });
});
