import type { SelectProps } from "antd";

/** Page-size options are a fixed short list; disabling search avoids opening a Pad keyboard. */
export const NON_SEARCHABLE_PAGE_SIZE_CHANGER: SelectProps = {
  showSearch: false
};
