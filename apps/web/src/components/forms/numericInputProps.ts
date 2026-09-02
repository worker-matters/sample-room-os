import type { InputNumberProps } from "antd";

export const integerInputProps = {
  inputMode: "numeric",
  pattern: "[0-9]*"
} satisfies Pick<InputNumberProps, "inputMode" | "pattern">;

export const decimalInputProps = {
  inputMode: "decimal"
} satisfies Pick<InputNumberProps, "inputMode">;
