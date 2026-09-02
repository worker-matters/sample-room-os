import { Pagination, Table, Typography, type TableProps } from "antd";
import { hasPhysicalProductionRoute } from "@sample-room/shared";
import { useEffect, useRef, useState, type Key, type ReactNode } from "react";
import type { OrderRecord } from "../api/sampleRoomApi";
import {
  IntakeTag,
  MaterialTag,
  SampleRoundTag,
  SampleTypeTag,
} from "./StatusTags";
import { OrderTitleCell } from "./orders/OrderTitleCell";
import {
  getOrderBusinessUserName,
  getOrderCustomerName,
} from "./orders/orderDisplay";
import { OrderCompletionTag } from "./operations/OrderCompletionStatus";
import { PatternTaskStatusBadges } from "./operations/PatternTaskStatusBadges";
import { NON_SEARCHABLE_PAGE_SIZE_CHANGER } from "./tablet/pagination";

type OrderTableRow = Pick<
  OrderRecord,
  | "id"
  | "orderNo"
  | "styleNo"
  | "styleName"
  | "quantity"
  | "sampleType"
  | "sampleRound"
  | "stage"
  | "stageLabel"
  | "patternTask"
  | "completionStatus"
  | "terminated"
> & {
  intakeStatus?: OrderRecord["intakeStatus"];
  sampleRequestItems?: OrderRecord["sampleRequestItems"];
  fabricStatus: string;
  trimStatus: string;
};

type OrderTableProps<TOrder extends OrderTableRow> = {
  orders: TOrder[];
  loading?: boolean;
  actions?: (order: TOrder) => ReactNode;
  titleExtra?: (order: TOrder) => ReactNode;
  titleThumbnail?: (order: TOrder) => ReactNode;
  audience?: "client" | "receiver";
  compact?: boolean;
  pageSize?: number;
  showPageSizeChanger?: boolean;
  workspace?: boolean;
  pageSizeStorageKey?: string;
  expandedRowRender?: (order: TOrder) => ReactNode;
  expandedRowKeys?: Key[];
  onExpandedRowKeysChange?: (expandedRowKeys: Key[]) => void;
  hideExpandControl?: boolean;
  selectable?: boolean;
  selectedRowKeys?: Key[];
  onSelectedRowKeysChange?: (selectedRowKeys: Key[]) => void;
  scrollY?: number | string;
  scrollX?: number | string;
  onOrderClick?: (order: TOrder) => void;
  rowClassName?: (order: TOrder) => string;
  clientQuotation?: (order: TOrder) => ReactNode;
  intakeStatusRender?: (order: TOrder) => ReactNode;
  fabricStatusRender?: (order: TOrder) => ReactNode;
  trimStatusRender?: (order: TOrder) => ReactNode;
  titleCellRender?: (order: TOrder) => ReactNode;
  customerContextRender?: (order: TOrder) => ReactNode;
};

export function OrderTable<TOrder extends OrderTableRow>({
  orders,
  loading,
  actions,
  titleExtra,
  titleThumbnail,
  audience = "receiver",
  compact = false,
  pageSize = 8,
  showPageSizeChanger = false,
  workspace = false,
  pageSizeStorageKey,
  expandedRowRender,
  expandedRowKeys,
  onExpandedRowKeysChange,
  hideExpandControl = false,
  selectable = false,
  selectedRowKeys = [],
  onSelectedRowKeysChange,
  scrollY,
  scrollX,
  onOrderClick,
  rowClassName,
  clientQuotation,
  intakeStatusRender,
  fabricStatusRender,
  trimStatusRender,
  titleCellRender,
  customerContextRender,
}: OrderTableProps<TOrder>) {
  const isClient = audience === "client";
  const [currentPage, setCurrentPage] = useState(1);
  const [currentPageSize, setCurrentPageSize] = useState(() => {
    if (!pageSizeStorageKey) return pageSize;
    const stored = Number(window.localStorage.getItem(pageSizeStorageKey));
    return Number.isInteger(stored) && stored > 0 ? stored : pageSize;
  });

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(orders.length / currentPageSize));
    if (currentPage > lastPage) setCurrentPage(lastPage);
  }, [currentPage, currentPageSize, orders.length]);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const lastPage = Math.max(1, Math.ceil(orders.length / currentPageSize));
  const validCurrentPage = Math.min(currentPage, lastPage);
  const visibleOrders = workspace
    ? orders.slice((validCurrentPage - 1) * currentPageSize, validCurrentPage * currentPageSize)
    : orders;

  const changePage = (nextPage: number, nextPageSize: number) => {
    const pageSizeChanged = nextPageSize !== currentPageSize;
    if (pageSizeChanged) {
      setCurrentPageSize(nextPageSize);
      setCurrentPage(1);
      if (pageSizeStorageKey) window.localStorage.setItem(pageSizeStorageKey, String(nextPageSize));
    } else {
      setCurrentPage(nextPage);
    }
    requestAnimationFrame(() => workspaceRef.current?.querySelector<HTMLElement>(".ant-table-body")?.scrollTo({ top: 0 }));
  };
  const columns: TableProps<TOrder>["columns"] = [
    {
      title: "订单",
      dataIndex: "styleNo",
      width: isClient ? 300 : compact ? 300 : 320,
      render: (_, order) =>
        titleCellRender?.(order) ?? (
          <OrderTitleCell
            order={order as unknown as OrderRecord}
            audience={audience}
            showMeta={isClient}
            extra={titleExtra?.(order)}
            thumbnail={titleThumbnail?.(order)}
          />
        ),
    },
    ...(isClient
      ? []
      : [
          {
            title: "客户/业务员",
            key: "customerContext",
            width: compact ? 150 : 170,
            render: (_value: unknown, order: TOrder) =>
              customerContextRender?.(order) ?? (
                <div className="order-customer-context-cell">
                  <Typography.Text strong>
                    {getOrderCustomerName(order as unknown as OrderRecord)}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {getOrderBusinessUserName(order as unknown as OrderRecord)}
                  </Typography.Text>
                </div>
              ),
          },
        ]),
    {
      title: "数量",
      dataIndex: "quantity",
      width: isClient ? 70 : compact ? 56 : 60,
      render: (value, order) => hasPhysicalProductionRoute(order.sampleRequestItems ?? []) ? value : "N/A",
    },
    {
      title: "样品类型",
      dataIndex: "sampleType",
      width: isClient ? 92 : compact ? 84 : 92,
      render: (value) => <SampleTypeTag value={value} />,
    },
    {
      title: "轮次",
      dataIndex: "sampleRound",
      width: isClient ? 78 : compact ? 72 : 78,
      render: (value) => <SampleRoundTag value={value} />,
    },
    {
      title: "接单状态",
      dataIndex: "intakeStatus",
      width: isClient ? 110 : compact ? 90 : 100,
      render: (value, order) =>
        intakeStatusRender?.(order) ?? (value ? <IntakeTag value={value} /> : "-"),
    },
    {
      title: "版师任务",
      key: "patternTask",
      width: isClient ? 150 : compact ? 150 : 170,
      render: (_value, order) => (
        <PatternTaskStatusBadges
          sampleRequestItems={order.sampleRequestItems ?? []}
          patternTask={order.patternTask}
          maxRows={2}
        />
      ),
    },
    {
      title: "工序阶段",
      dataIndex: "stage",
      width: isClient ? 110 : compact ? 96 : 105,
      render: (_value, order) => (
        order.terminated ? <Typography.Text type="danger">已终止</Typography.Text> : (
          <OrderCompletionTag
            sampleRequestItems={order.sampleRequestItems ?? []}
            stage={order.stage}
            {...(order.stageLabel ? { stageLabel: order.stageLabel } : {})}
            simplified={isClient}
            {...(order.completionStatus ? { completionStatus: order.completionStatus } : {})}
            {...(order.patternTask ? { patternTask: order.patternTask } : {})}
          />
        )
      ),
    },
    {
      title: "面里料",
      dataIndex: "fabricStatus",
      width: isClient ? 90 : compact ? 72 : 80,
      render: (value, order) => hasPhysicalProductionRoute(order.sampleRequestItems ?? [])
        ? fabricStatusRender?.(order) ?? <MaterialTag value={value as OrderRecord["fabricStatus"]} />
        : "N/A",
    },
    ...(isClient
      ? []
      : [
          {
            title: "辅料",
            dataIndex: "trimStatus",
            width: compact ? 72 : 80,
            render: (value: string, order: TOrder) =>
              hasPhysicalProductionRoute(order.sampleRequestItems ?? [])
                ? trimStatusRender?.(order) ?? <MaterialTag value={value as OrderRecord["trimStatus"]} />
                : "N/A",
          },
        ]),
  ];

  if (isClient && clientQuotation) {
    columns.push({
      title: "打样报价",
      width: 116,
      render: (_, order) => clientQuotation(order)
    });
  }

  if (actions) {
    columns.push({
      title: "操作",
      width: isClient ? 150 : compact ? 132 : 150,
      render: (_, order) => actions(order),
    });
  }

  const table = (
    <Table
      rowKey="id"
      size={compact ? "small" : "middle"}
      className={`${compact ? "compact-order-table " : ""}${workspace ? "data-workspace-table" : ""}`.trim()}
      columns={columns}
      dataSource={visibleOrders}
      loading={Boolean(loading)}
      pagination={workspace ? false : {
        current: validCurrentPage,
        pageSize: currentPageSize,
        showSizeChanger: showPageSizeChanger ? NON_SEARCHABLE_PAGE_SIZE_CHANGER : false,
        pageSizeOptions: Array.from(new Set([pageSize, 10, 20, 50])).sort((a, b) => a - b),
        onChange: changePage
      }}
      {...(rowClassName ? { rowClassName } : {})}
      {...(selectable
        ? {
            rowSelection: {
              selectedRowKeys,
              preserveSelectedRowKeys: false,
              onChange: (nextSelectedRowKeys: Key[]) =>
                onSelectedRowKeysChange?.(nextSelectedRowKeys),
            },
          }
        : {})}
      {...(expandedRowRender
        ? {
            expandable: {
              expandedRowRender,
              showExpandColumn: !hideExpandControl,
              ...(expandedRowKeys ? { expandedRowKeys } : {}),
              onExpandedRowsChange: (nextExpandedRowKeys) =>
                onExpandedRowKeysChange?.([...nextExpandedRowKeys]),
            },
          }
        : {})}
      tableLayout="fixed"
      {...(onOrderClick
        ? {
            onRow: (order) => ({
              onClick: (event) => {
                const target = event.target as HTMLElement;
                if (
                  target.closest(
                    "button, a, input, textarea, select, [role='button'], [role='checkbox'], [role='combobox'], .ant-checkbox-wrapper, .ant-select, .ant-dropdown-trigger"
                  )
                ) {
                  return;
                }
                onOrderClick(order);
              },
            }),
          }
        : {})}
      {...(scrollX || scrollY || workspace
        ? {
            scroll: {
              ...(scrollX ? { x: scrollX } : {}),
              ...(workspace ? { y: "100%" } : scrollY ? { y: scrollY } : {}),
              scrollToFirstRowOnChange: true,
            },
          }
        : {})}
    />
  );

  if (!workspace) return table;

  return (
    <div ref={workspaceRef} className="order-table-data-workspace">
      {table}
      <Pagination
        className="order-table-workspace-pagination"
        current={validCurrentPage}
        pageSize={currentPageSize}
        total={orders.length}
        showSizeChanger={showPageSizeChanger ? NON_SEARCHABLE_PAGE_SIZE_CHANGER : false}
        pageSizeOptions={Array.from(new Set([pageSize, 10, 20, 50])).sort((a, b) => a - b)}
        onChange={changePage}
      />
    </div>
  );
}
