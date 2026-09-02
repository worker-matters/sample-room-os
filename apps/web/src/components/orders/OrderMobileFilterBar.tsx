import type { OrderRecord } from "../../api/sampleRoomApi";
import {
  buildCustomerOptions,
  buildSalespersonOptions,
  orderStatusFilterOptions,
  type OrderFilters
} from "./orderFilters";
import { MobileOrderFilterPanel } from "./MobileOrderFilterPanel";

type OrderMobileFilterBarProps = {
  orders: OrderRecord[];
  filters: OrderFilters;
  onChange: (filters: OrderFilters) => void;
  defaultFilters?: OrderFilters | undefined;
};

export function OrderMobileFilterBar({ defaultFilters, orders, filters, onChange }: OrderMobileFilterBarProps) {
  const customerOptions = buildCustomerOptions(orders);
  const salespersonOptions = buildSalespersonOptions(orders, filters.customerId);

  return (
    <MobileOrderFilterPanel
      filters={filters}
      onChange={onChange}
      keywordPlaceholder="快速搜索款号/款名/订单号/备注"
      statusOptions={orderStatusFilterOptions}
      customerOptions={customerOptions}
      businessUserOptions={salespersonOptions}
      showCustomerFilter
      showBusinessUserFilter
      showSampleRoundQuickFilter
      showTrimStatusFilter
      defaultFilters={defaultFilters}
      testId="receiver-mobile-filter-bar"
    />
  );
}
