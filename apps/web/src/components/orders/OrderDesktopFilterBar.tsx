import { Button, Input, Select, Space } from "antd";
import type { OrderRecord } from "../../api/sampleRoomApi";
import {
  buildCustomerOptions,
  buildSalespersonOptions,
  clientSampleRoundFilterOptions,
  defaultOrderFilters,
  getQuickDateRange,
  orderStatusFilterOptions,
  type OrderFilters,
  type QuickDateRange
} from "./orderFilters";
import { useSampleTypeOptions } from "../../app/SampleTypeOptionsContext";

type OrderDesktopFilterBarProps = {
  orders: OrderRecord[];
  filters: OrderFilters;
  onChange: (filters: OrderFilters) => void;
  defaultFilters?: OrderFilters | undefined;
};

export function OrderDesktopFilterBar({
  defaultFilters = defaultOrderFilters,
  orders,
  filters,
  onChange
}: OrderDesktopFilterBarProps) {
  const { options: sampleTypeOptions } = useSampleTypeOptions();
  const customerOptions = buildCustomerOptions(orders);
  const salespersonOptions = buildSalespersonOptions(orders, filters.customerId);

  const patchFilters = (patch: Partial<OrderFilters>) => {
    onChange({ ...filters, ...patch });
  };

  const setQuickDateRange = (quickDateRange: QuickDateRange) => {
    patchFilters({ ...getQuickDateRange(quickDateRange), quickDateRange });
  };

  const reset = () => {
    onChange({ ...defaultFilters });
  };

  return (
    <div className="order-filter-bar">
      <Input
        allowClear
        placeholder="输入款号/款名搜索..."
        value={filters.keyword}
        onChange={(event) => patchFilters({ keyword: event.target.value })}
        className="order-filter-keyword"
      />
      <Select
        allowClear
        placeholder="全部客户"
        value={filters.customerId ?? null}
        options={customerOptions}
        onChange={(customerId) => patchFilters({ customerId: customerId ?? undefined, salespersonId: undefined })}
        className="order-filter-select"
      />
      <Select
        allowClear
        placeholder="全部业务员"
        value={filters.salespersonId ?? null}
        options={salespersonOptions}
        onChange={(salespersonId) => patchFilters({ salespersonId: salespersonId ?? undefined })}
        className="order-filter-select"
      />
      <Select
        allowClear
        placeholder="全部状态"
        value={filters.status ?? null}
        options={orderStatusFilterOptions}
        onChange={(status) => patchFilters({ status: status ?? undefined })}
        className="order-filter-select"
      />
      <Select
        allowClear
        placeholder="全部样品类型"
        value={filters.sampleType ?? null}
        options={sampleTypeOptions}
        onChange={(sampleType) => patchFilters({ sampleType: sampleType ?? undefined })}
        className="order-filter-select"
      />
      <Select
        allowClear
        placeholder="全部样品轮次"
        value={filters.sampleRound ?? null}
        options={clientSampleRoundFilterOptions}
        onChange={(sampleRound) => patchFilters({ sampleRound: sampleRound ?? undefined })}
        className="order-filter-select"
      />
      <Space.Compact>
        <Button type={filters.quickDateRange === "week" ? "primary" : "default"} onClick={() => setQuickDateRange("week")}>
          本周
        </Button>
        <Button type={filters.quickDateRange === "month" ? "primary" : "default"} onClick={() => setQuickDateRange("month")}>
          本月
        </Button>
        <Button type={filters.quickDateRange === "quarter" ? "primary" : "default"} onClick={() => setQuickDateRange("quarter")}>
          近三月
        </Button>
      </Space.Compact>
      <span className="order-filter-date-label">自定义日期</span>
      <Input
        type="date"
        value={filters.startDate}
        onChange={(event) => patchFilters({ startDate: event.target.value, quickDateRange: undefined })}
        className="order-filter-date"
      />
      <Input
        type="date"
        value={filters.endDate}
        onChange={(event) => patchFilters({ endDate: event.target.value, quickDateRange: undefined })}
        className="order-filter-date"
      />
      <Button onClick={reset}>重置</Button>
    </div>
  );
}
