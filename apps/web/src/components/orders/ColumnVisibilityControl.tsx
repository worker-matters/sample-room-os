import { Select } from "antd";

type ColumnOption<Key extends string> = {
  label: string;
  value: Key;
};

type ColumnVisibilityControlProps<Key extends string> = {
  value: Key[];
  options: readonly ColumnOption<Key>[];
  standardKeys: readonly Key[];
  compactKeys: readonly Key[];
  onChange: (keys: Key[]) => void;
  ariaLabel: string;
  className?: string;
};

const STANDARD_MODE = "__standard_mode__";
const COMPACT_MODE = "__compact_mode__";

export function ColumnVisibilityControl<Key extends string>({
  value,
  options,
  standardKeys,
  compactKeys,
  onChange,
  ariaLabel,
  className
}: ColumnVisibilityControlProps<Key>) {
  const handleChange = (next: Array<Key | typeof STANDARD_MODE | typeof COMPACT_MODE>) => {
    if (next.includes(STANDARD_MODE)) {
      onChange([...standardKeys]);
      return;
    }
    if (next.includes(COMPACT_MODE)) {
      onChange([...compactKeys]);
      return;
    }
    onChange(next as Key[]);
  };

  return (
    <Select<Array<Key | typeof STANDARD_MODE | typeof COMPACT_MODE>>
      mode="multiple"
      allowClear
      maxTagCount="responsive"
      placeholder="显示列"
      value={value}
      options={[
        { label: "标准模式", value: STANDARD_MODE },
        { label: "清爽模式", value: COMPACT_MODE },
        ...options
      ]}
      onChange={handleChange}
      {...(className ? { className } : {})}
      aria-label={ariaLabel}
    />
  );
}
