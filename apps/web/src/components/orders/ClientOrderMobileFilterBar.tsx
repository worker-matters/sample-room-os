import {
  clientOrderStatusFilterOptions,
  type OrderFilters
} from "./orderFilters";
import { MobileOrderFilterPanel } from "./MobileOrderFilterPanel";

type ClientOrderMobileFilterBarProps = {
  filters: OrderFilters;
  onChange: (filters: OrderFilters) => void;
  businessUserOptions?: Array<{ label: string; value: string }>;
};

export function ClientOrderMobileFilterBar({
  filters,
  onChange,
  businessUserOptions = []
}: ClientOrderMobileFilterBarProps) {
  const showBusinessUserFilter = businessUserOptions.length > 0;

  return (
    <MobileOrderFilterPanel
      filters={filters}
      onChange={onChange}
      keywordPlaceholder="快速搜索款号/款名/订单号/备注"
      statusOptions={clientOrderStatusFilterOptions}
      businessUserOptions={businessUserOptions}
      showBusinessUserFilter={showBusinessUserFilter}
      showSampleRoundQuickFilter
      testId="client-mobile-filter-bar"
    />
  );
}
