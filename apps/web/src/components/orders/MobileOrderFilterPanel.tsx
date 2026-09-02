import { Button, Input, Select, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  clientSampleRoundFilterOptions,
  defaultOrderFilters,
  fabricStatusFilterOptions,
  getQuickDateRange,
  trimStatusFilterOptions,
  type FilterOption,
  type OrderFilters,
  type QuickDateRange
} from "./orderFilters";
import { useSampleTypeOptions } from "../../app/SampleTypeOptionsContext";

type FilterChip = {
  key: string;
  label: string;
  clearPatch: Partial<OrderFilters>;
};

type MobileOrderFilterPanelProps = {
  filters: OrderFilters;
  onChange: (filters: OrderFilters) => void;
  keywordPlaceholder: string;
  statusOptions: FilterOption[];
  customerOptions?: FilterOption[];
  businessUserOptions?: FilterOption[];
  showCustomerFilter?: boolean;
  showBusinessUserFilter?: boolean;
  showSampleRoundQuickFilter?: boolean;
  showTrimStatusFilter?: boolean;
  testId?: string;
  defaultFilters?: OrderFilters | undefined;
};

function findOptionLabel(options: FilterOption[] | undefined, value: string | undefined) {
  if (!value) {
    return undefined;
  }

  return options?.find((option) => option.value === value)?.label ?? value;
}

function dateRangeLabel(startDate: string | undefined, endDate: string | undefined) {
  if (startDate && endDate) {
    return `${startDate} ~ ${endDate}`;
  }

  return startDate ? `${startDate} 起` : `截至 ${endDate}`;
}

function buildFilterChips({
  filters,
  statusOptions,
  customerOptions,
  businessUserOptions,
  showCustomerFilter,
  showBusinessUserFilter,
  showSampleRoundQuickFilter,
  showTrimStatusFilter,
  sampleTypeOptions
}: Pick<
  MobileOrderFilterPanelProps,
  | "filters"
  | "statusOptions"
  | "customerOptions"
  | "businessUserOptions"
  | "showCustomerFilter"
  | "showBusinessUserFilter"
  | "showSampleRoundQuickFilter"
  | "showTrimStatusFilter"
> & { sampleTypeOptions: FilterOption[] }) {
  const chips: FilterChip[] = [];

  if (filters.keyword.trim()) {
    chips.push({
      key: "keyword",
      label: `关键词=${filters.keyword.trim()}`,
      clearPatch: { keyword: "" }
    });
  }

  if (filters.status) {
    chips.push({
      key: "status",
      label: `状态=${findOptionLabel(statusOptions, filters.status)}`,
      clearPatch: { status: undefined }
    });
  }

  if (showSampleRoundQuickFilter && filters.sampleRound) {
    chips.push({
      key: "sampleRound",
      label: `轮次=${findOptionLabel(clientSampleRoundFilterOptions, filters.sampleRound)}`,
      clearPatch: { sampleRound: undefined }
    });
  }

  if (showCustomerFilter && filters.customerId) {
    chips.push({
      key: "customerId",
      label: `客户=${findOptionLabel(customerOptions, filters.customerId)}`,
      clearPatch: { customerId: undefined, salespersonId: undefined }
    });
  }

  if (showBusinessUserFilter && filters.salespersonId) {
    chips.push({
      key: "salespersonId",
      label: `业务员=${findOptionLabel(businessUserOptions, filters.salespersonId)}`,
      clearPatch: { salespersonId: undefined }
    });
  }

  if (filters.deliveryStartDate || filters.deliveryEndDate) {
    chips.push({
      key: "deliveryDate",
      label: `交期=${dateRangeLabel(filters.deliveryStartDate, filters.deliveryEndDate)}`,
      clearPatch: { deliveryStartDate: undefined, deliveryEndDate: undefined }
    });
  }

  if (filters.startDate || filters.endDate) {
    chips.push({
      key: "entryDate",
      label: `录入=${dateRangeLabel(filters.startDate, filters.endDate)}`,
      clearPatch: { startDate: undefined, endDate: undefined, quickDateRange: undefined }
    });
  }

  if (filters.sampleType) {
    chips.push({
      key: "sampleType",
      label: `样品类型=${findOptionLabel(sampleTypeOptions, filters.sampleType)}`,
      clearPatch: { sampleType: undefined }
    });
  }

  if (filters.fabricStatus) {
    chips.push({
      key: "fabricStatus",
      label: `面里料=${findOptionLabel(fabricStatusFilterOptions, filters.fabricStatus)}`,
      clearPatch: { fabricStatus: undefined }
    });
  }

  if (showTrimStatusFilter && filters.trimStatus) {
    chips.push({
      key: "trimStatus",
      label: `辅料=${findOptionLabel(trimStatusFilterOptions, filters.trimStatus)}`,
      clearPatch: { trimStatus: undefined }
    });
  }

  return chips;
}

export function MobileOrderFilterPanel({
  filters,
  onChange,
  keywordPlaceholder,
  statusOptions,
  customerOptions = [],
  businessUserOptions = [],
  showCustomerFilter = false,
  showBusinessUserFilter = false,
  showSampleRoundQuickFilter = false,
  showTrimStatusFilter = true,
  testId = "mobile-order-filter-panel",
  defaultFilters = defaultOrderFilters
}: MobileOrderFilterPanelProps) {
  const { options: sampleTypeOptions } = useSampleTypeOptions();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<OrderFilters>(filters);

  useEffect(() => {
    if (!advancedOpen) {
      setDraftFilters(filters);
    }
  }, [advancedOpen, filters]);

  const patchQuickFilters = (patch: Partial<OrderFilters>) => {
    const nextFilters = { ...filters, ...patch };
    setDraftFilters((current) => ({ ...current, ...patch }));
    onChange(nextFilters);
  };

  const setQuickDateRange = (quickDateRange: QuickDateRange) => {
    patchQuickFilters({ ...getQuickDateRange(quickDateRange), quickDateRange });
  };

  const patchDraftFilters = (patch: Partial<OrderFilters>) => {
    setDraftFilters((current) => ({ ...current, ...patch }));
  };

  const reset = () => {
    const nextFilters = { ...defaultFilters };
    setDraftFilters(nextFilters);
    onChange(nextFilters);
    setAdvancedOpen(false);
  };

  const confirm = () => {
    onChange(draftFilters);
    setAdvancedOpen(false);
  };

  const chips = useMemo(
    () =>
      buildFilterChips({
        filters,
        statusOptions,
        customerOptions,
        businessUserOptions,
        showCustomerFilter,
        showBusinessUserFilter,
        showSampleRoundQuickFilter,
        showTrimStatusFilter,
        sampleTypeOptions
      }),
    [
      businessUserOptions,
      customerOptions,
      filters,
      showBusinessUserFilter,
      showCustomerFilter,
      showSampleRoundQuickFilter,
      showTrimStatusFilter,
      sampleTypeOptions,
      statusOptions
    ]
  );

  const clearChip = (chip: FilterChip) => {
    onChange({ ...filters, ...chip.clearPatch });
  };

  return (
    <div className="mobile-filter-panel" data-testid={testId}>
      <Input
        allowClear
        placeholder={keywordPlaceholder}
        value={filters.keyword}
        onFocus={(event) => event.currentTarget.scrollIntoView({ block: "center" })}
        onChange={(event) => patchQuickFilters({ keyword: event.target.value })}
        className="mobile-filter-search"
      />
      <div className="mobile-filter-quick-grid">
        <Select
          allowClear
          placeholder="全部状态"
          value={filters.status ?? null}
          options={statusOptions}
          onChange={(status) => patchQuickFilters({ status: status ?? undefined })}
          className="mobile-filter-select"
        />
        {showSampleRoundQuickFilter ? (
          <Select
            allowClear
            placeholder="全部轮次"
            value={filters.sampleRound ?? null}
            options={clientSampleRoundFilterOptions}
            onChange={(sampleRound) => patchQuickFilters({ sampleRound: sampleRound ?? undefined })}
            className="mobile-filter-select"
          />
        ) : null}
        {showCustomerFilter ? (
          <Select
            allowClear
            placeholder="全部客户"
            value={filters.customerId ?? null}
            options={customerOptions}
            onChange={(customerId) =>
              patchQuickFilters({ customerId: customerId ?? undefined, salespersonId: undefined })
            }
            className="mobile-filter-select"
          />
        ) : null}
        {showBusinessUserFilter ? (
          <Select
            allowClear
            placeholder="全部业务员"
            value={filters.salespersonId ?? null}
            options={businessUserOptions}
            onChange={(salespersonId) => patchQuickFilters({ salespersonId: salespersonId ?? undefined })}
            className="mobile-filter-select"
          />
        ) : null}
      </div>
      <Space.Compact className="mobile-filter-date-shortcuts">
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
      <Button
        type="link"
        className="mobile-more-filter-trigger"
        onClick={() => {
          setDraftFilters(filters);
          setAdvancedOpen((current) => !current);
        }}
        data-testid="mobile-filter-more-trigger"
      >
        更多筛选 {advancedOpen ? "收起" : "展开"}
      </Button>

      {advancedOpen ? (
        <div className="mobile-advanced-filter-panel" data-testid="mobile-filter-advanced-panel">
          <div className="mobile-date-range-row">
            <Typography.Text>交期</Typography.Text>
            <Input
              type="date"
              value={draftFilters.deliveryStartDate}
              onChange={(event) => patchDraftFilters({ deliveryStartDate: event.target.value })}
            />
            <span>~</span>
            <Input
              type="date"
              value={draftFilters.deliveryEndDate}
              onChange={(event) => patchDraftFilters({ deliveryEndDate: event.target.value })}
            />
          </div>
          <div className="mobile-date-range-row">
            <Typography.Text>录入日期</Typography.Text>
            <Input
              type="date"
              value={draftFilters.startDate}
              onChange={(event) => patchDraftFilters({ startDate: event.target.value, quickDateRange: undefined })}
            />
            <span>~</span>
            <Input
              type="date"
              value={draftFilters.endDate}
              onChange={(event) => patchDraftFilters({ endDate: event.target.value, quickDateRange: undefined })}
            />
          </div>
          <div className="mobile-filter-advanced-grid">
            <Select
              allowClear
              placeholder="全部样品类型"
              value={draftFilters.sampleType ?? null}
              options={sampleTypeOptions}
              onChange={(sampleType) => patchDraftFilters({ sampleType: sampleType ?? undefined })}
              className="mobile-filter-select"
            />
            <Select
              allowClear
              placeholder="全部面里料状态"
              value={draftFilters.fabricStatus ?? null}
              options={fabricStatusFilterOptions}
              onChange={(fabricStatus) => patchDraftFilters({ fabricStatus: fabricStatus ?? undefined })}
              className="mobile-filter-select"
            />
            {showTrimStatusFilter ? (
              <Select
                allowClear
                placeholder="全部辅料状态"
                value={draftFilters.trimStatus ?? null}
                options={trimStatusFilterOptions}
                onChange={(trimStatus) => patchDraftFilters({ trimStatus: trimStatus ?? undefined })}
                className="mobile-filter-select"
              />
            ) : null}
          </div>
          <div className="mobile-filter-footer">
            <Button onClick={reset} data-testid="mobile-filter-reset">
              重置
            </Button>
            <Button type="primary" onClick={confirm} data-testid="mobile-filter-confirm">
              确定
            </Button>
          </div>
        </div>
      ) : null}

      {chips.length > 0 ? (
        <Space wrap size={[4, 6]} className="mobile-filter-chips" data-testid="mobile-filter-chip-summary">
          <Typography.Text type="secondary">已筛选：</Typography.Text>
          {chips.map((chip) => (
            <Tag
              key={chip.key}
              closable
              onClose={(event) => {
                event.preventDefault();
                clearChip(chip);
              }}
            >
              {chip.label}
            </Tag>
          ))}
        </Space>
      ) : null}
    </div>
  );
}
