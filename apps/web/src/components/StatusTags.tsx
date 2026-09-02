import { Tag } from "antd";
import {
  fabricStatusOptions,
  intakeStatusOptions,
  MATERIAL_STATUS_LABELS,
  ORDER_STAGE_LABELS,
  orderStageOptions,
  sampleRoundOptions,
  trimStatusOptions
} from "@sample-room/shared";
import type { IntakeStatus, MaterialStatus, OrderStage } from "../api/sampleRoomApi";
import { useSampleTypeOptions } from "../app/SampleTypeOptionsContext";

const intakeColors: Record<IntakeStatus, string> = {
  pending_receive: "gold",
  received: "green",
  needs_client_supplement: "orange"
};

const stageColors: Record<OrderStage, string> = {
  pending_receive: "gold",
  pattern_waiting: "purple",
  pattern_doing: "purple",
  cutting_handoff_waiting: "orange",
  cutting_waiting: "blue",
  cutting_doing: "blue",
  sewing_waiting: "cyan",
  sewing_doing: "cyan",
  qc_delivery_waiting: "geekblue",
  done: "default"
};

const materialColors: Record<MaterialStatus, string> = {
  missing: "red",
  partial: "orange",
  complete: "green"
};

function optionLabel<T extends string>(options: Array<{ label: string; value: T }>, value: T) {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function IntakeTag({ value }: { value: IntakeStatus }) {
  return <Tag color={intakeColors[value]}>{optionLabel(intakeStatusOptions, value)}</Tag>;
}

export function StageTag({ value, label }: { value: OrderStage | null; label?: string }) {
  return value ? (
    <Tag color={stageColors[value]}>{label ?? ORDER_STAGE_LABELS[value] ?? optionLabel(orderStageOptions, value)}</Tag>
  ) : (
    <Tag>未进工序</Tag>
  );
}

export function MaterialTag({ value }: { value: MaterialStatus }) {
  return <Tag color={materialColors[value]}>{MATERIAL_STATUS_LABELS[value]}</Tag>;
}

export function SampleTypeTag({ value }: { value: string }) {
  const { labelFor } = useSampleTypeOptions();
  return <Tag color="blue">{labelFor(value)}</Tag>;
}

export function SampleRoundTag({ value }: { value: string }) {
  return <Tag color="geekblue">{optionLabel(sampleRoundOptions, value)}</Tag>;
}

export const fabricOptions = fabricStatusOptions;
export const trimOptions = trimStatusOptions;
