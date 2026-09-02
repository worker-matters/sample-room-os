import { Button, Modal, Pagination, Space, Typography, message } from "antd";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { OrderChargeRecord } from "../../api/sampleRoomApi";
import { formatEntryDate } from "./orderDisplay";
import {
  OrderChargeEditModal,
  type OrderChargeEditActions
} from "./OrderChargeEditModal";
import { NON_SEARCHABLE_PAGE_SIZE_CHANGER } from "../tablet/pagination";

export function OrderChargeList({
  charges,
  currentUserId,
  canManageAll = false,
  showStatus = false,
  maintenanceDisabled = false,
  scrollable = false,
  pageSize,
  showPageSizeChanger = false,
  pageSizeStorageKey,
  bodyHeight,
  onDelete,
  renderExtraActions,
  ...editActions
}: {
  charges: OrderChargeRecord[];
  currentUserId?: string | undefined;
  canManageAll?: boolean | undefined;
  showStatus?: boolean | undefined;
  maintenanceDisabled?: boolean | undefined;
  scrollable?: boolean | undefined;
  pageSize?: number | undefined;
  showPageSizeChanger?: boolean | undefined;
  pageSizeStorageKey?: string | undefined;
  bodyHeight?: number | undefined;
  onDelete?: ((charge: OrderChargeRecord) => Promise<void>) | undefined;
  renderExtraActions?: ((charge: OrderChargeRecord) => ReactNode) | undefined;
} & OrderChargeEditActions) {
  const [messageApi, contextHolder] = message.useMessage();
  const [editingChargeId, setEditingChargeId] = useState<string>();
  const [page, setPage] = useState(1);
  const [activePageSize, setActivePageSize] = useState(() => {
    if (!pageSizeStorageKey) return pageSize;
    const stored = Number(window.localStorage.getItem(pageSizeStorageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : pageSize;
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  const editingCharge = charges.find((charge) => charge.id === editingChargeId);
  const effectivePageSize = activePageSize ?? pageSize;
  const pageCount = effectivePageSize ? Math.max(1, Math.ceil(charges.length / effectivePageSize)) : 1;
  const currentPage = Math.min(page, pageCount);
  const visibleCharges = effectivePageSize
    ? charges.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize)
    : charges;

  useEffect(() => {
    if (!pageSizeStorageKey) setActivePageSize(pageSize);
  }, [pageSize, pageSizeStorageKey]);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  const scrollRowsToTop = () => {
    window.requestAnimationFrame(() => bodyRef.current?.scrollTo({ top: 0 }));
  };
  const canMaintain = (charge: OrderChargeRecord) =>
    !charge.archivedAt &&
    charge.status !== "void" &&
    (canManageAll || (
      charge.creatorId === currentUserId &&
      (charge.status === "effective" || charge.status === "pending")
    ));

  const statusLabel = (charge: OrderChargeRecord) => {
    if (charge.status === "confirmed" || charge.status === "effective") return "已确认";
    if (charge.status === "pending") return "待确认";
    if (charge.status === "rejected") return "已驳回";
    if (charge.status === "cancelled") return "已取消";
    return "已归档";
  };

  const confirmDelete = (charge: OrderChargeRecord) => {
    if (!onDelete) return;
    Modal.confirm({
      title: "确认删除这条其他费用？",
      content: "费用会从当前明细中移除，删除记录仍会保留用于审计。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await onDelete(charge);
          messageApi.success("其他费用已删除");
        } catch (error) {
          messageApi.error(error instanceof Error ? error.message : "其他费用删除失败");
          throw error;
        }
      }
    });
  };

  return (
    <>
      {contextHolder}
      <div className={`order-charge-shared-table${showStatus ? " has-status" : ""}`} role="table" aria-label="其他费用记录">
        <div className="order-charge-shared-header" role="row">
          <span>费用名称</span>
          <span>金额</span>
          <span>说明</span>
          <span>登记人</span>
          <span>登记时间</span>
          {showStatus ? <span>状态</span> : null}
          <span>附件</span>
          <span>操作</span>
        </div>
        <div
          ref={bodyRef}
          className={`order-charge-shared-body${scrollable || bodyHeight ? " is-scrollable" : ""}`}
          {...(bodyHeight ? { style: { height: bodyHeight, maxHeight: bodyHeight, overflowY: "auto" as const } } : {})}
        >
          {charges.length === 0 ? (
            <Typography.Text type="secondary" className="order-charge-shared-empty">
              暂无其他费用记录
            </Typography.Text>
          ) : visibleCharges.map((charge) => (
            <div
              className={`order-charge-shared-row${charge.archivedAt || charge.status === "void" ? " is-void" : ""}`}
              role="row"
              key={charge.id}
            >
              <Typography.Text strong data-label="费用名称">{charge.name}</Typography.Text>
              <Typography.Text data-label="金额">¥{charge.amount.toFixed(2)}</Typography.Text>
              <Typography.Text data-label="说明">{charge.explanation || "无说明"}</Typography.Text>
              <Typography.Text data-label="登记人">{charge.creatorName ?? "—"}</Typography.Text>
              <Typography.Text data-label="登记时间">{formatEntryDate(charge.createdAt)}</Typography.Text>
              {showStatus ? <Typography.Text data-label="状态">{statusLabel(charge)}</Typography.Text> : null}
              <Typography.Text data-label="附件">{(charge.attachments ?? []).length}个附件</Typography.Text>
              <div data-label="操作">
                {(canMaintain(charge) && editActions.onEdit && onDelete) || renderExtraActions ? (
                  <Space size={2} wrap={false}>
                    {canMaintain(charge) && editActions.onEdit && onDelete ? (
                      <>
                        <Button type="link" size="small" disabled={maintenanceDisabled} onClick={() => setEditingChargeId(charge.id)}>
                          编辑
                        </Button>
                        <Button type="link" danger size="small" disabled={maintenanceDisabled} onClick={() => confirmDelete(charge)}>
                          删除
                        </Button>
                      </>
                    ) : null}
                    {renderExtraActions?.(charge)}
                  </Space>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {effectivePageSize && (showPageSizeChanger || charges.length > effectivePageSize) ? (
        <Pagination
          className="order-charge-shared-pagination"
          current={currentPage}
          pageSize={effectivePageSize}
          total={charges.length}
          showSizeChanger={showPageSizeChanger ? NON_SEARCHABLE_PAGE_SIZE_CHANGER : false}
          pageSizeOptions={Array.from(new Set([effectivePageSize, 10, 20, 50])).sort((a, b) => a - b)}
          onChange={(nextPage, nextPageSize) => {
            if (nextPageSize !== effectivePageSize) {
              setActivePageSize(nextPageSize);
              setPage(1);
              if (pageSizeStorageKey) window.localStorage.setItem(pageSizeStorageKey, String(nextPageSize));
            } else {
              setPage(nextPage);
            }
            scrollRowsToTop();
          }}
        />
      ) : null}

      <OrderChargeEditModal
        charge={editingCharge}
        currentUserId={currentUserId}
        canManageAll={canManageAll}
        onCancel={() => setEditingChargeId(undefined)}
        {...editActions}
      />
    </>
  );
}
