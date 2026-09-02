import { Typography } from "antd";
import type { OrderChargeRecord } from "../../api/sampleRoomApi";
import { OrderChargeList } from "./OrderChargeList";
import type { OrderChargeEditActions } from "./OrderChargeEditModal";

export function OrderChargeReadOnlyPanel({
  charges,
  currentUserId,
  canManageAll = false,
  tabletLayout = false,
  onDelete,
  ...editActions
}: {
  charges: OrderChargeRecord[];
  currentUserId?: string | undefined;
  canManageAll?: boolean | undefined;
  tabletLayout?: boolean | undefined;
  onDelete?: ((charge: OrderChargeRecord) => Promise<void>) | undefined;
} & OrderChargeEditActions) {
  const effectiveCharges = charges.filter(
    (charge) => charge.status === "confirmed" || charge.status === "effective"
  );
  const effectiveTotal = effectiveCharges.reduce((total, charge) => total + charge.amount, 0);

  return (
    <div className={`order-charge-readonly-panel data-workspace-charge-list${tabletLayout ? " tablet-contained-charge-list" : ""}`}>
      <div className="order-charge-readonly-summary">
        <div>
          <Typography.Text type="secondary">有效费用合计：</Typography.Text>
          <strong>¥{effectiveTotal.toFixed(2)}</strong>
        </div>
        <div>
          <Typography.Text type="secondary">有效费用记录：</Typography.Text>
          <strong>{effectiveCharges.length} 条</strong>
        </div>
      </div>

      <OrderChargeList
        charges={charges}
        currentUserId={currentUserId}
        canManageAll={canManageAll}
        scrollable
        pageSize={10}
        showPageSizeChanger
        pageSizeStorageKey="sample-room:order-detail-charges:page-size"
        onDelete={onDelete}
        {...editActions}
      />
    </div>
  );
}
