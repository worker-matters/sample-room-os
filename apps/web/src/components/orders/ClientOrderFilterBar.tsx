import { Button, Input, Select } from "antd";
import {
  clientOrderStatusFilterOptions,
  clientSampleRoundFilterOptions,
  defaultOrderFilters,
  type OrderFilters
} from "./orderFilters";
import { useSampleTypeOptions } from "../../app/SampleTypeOptionsContext";

type ClientOrderFilterBarProps = {
  filters: OrderFilters;
  onChange: (filters: OrderFilters) => void;
  businessUserOptions?: Array<{ label: string; value: string }>;
};

export function ClientOrderFilterBar({
  filters,
  onChange,
  businessUserOptions = []
}: ClientOrderFilterBarProps) {
  const { options: sampleTypeOptions } = useSampleTypeOptions();
  const patchFilters = (patch: Partial<OrderFilters>) => {
    onChange({ ...filters, ...patch });
  };
  const showBusinessUserFilter = businessUserOptions.length > 0;

  return (
    <div className="order-filter-bar client-order-filter-bar" data-testid="client-order-filter-bar">
      <Input
        allowClear
        placeholder="搜索款号/款名/订单号/备注"
        value={filters.keyword}
        onChange={(event) => patchFilters({ keyword: event.target.value })}
        className="order-filter-keyword"
      />
      <Select
        allowClear
        placeholder="全部状态"
        value={filters.status ?? null}
        options={clientOrderStatusFilterOptions}
        onChange={(status) => patchFilters({ status: status ?? undefined })}
        className="order-filter-select"
      />
      {showBusinessUserFilter ? (
        <Select
          allowClear
          placeholder="全部业务员"
          value={filters.salespersonId ?? null}
          options={businessUserOptions}
          onChange={(salespersonId) => patchFilters({ salespersonId: salespersonId ?? undefined })}
          className="order-filter-select"
        />
      ) : null}
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
        placeholder="全部轮次"
        value={filters.sampleRound ?? null}
        options={clientSampleRoundFilterOptions}
        onChange={(sampleRound) => patchFilters({ sampleRound: sampleRound ?? undefined })}
        className="order-filter-select"
      />
      <Button onClick={() => onChange({ ...defaultOrderFilters })}>重置</Button>
    </div>
  );
}
