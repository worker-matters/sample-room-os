import { Tag } from "antd";
import { deriveOrderCompletionStatus, type SampleRequestItem } from "@sample-room/shared";
import type { OrderPatternTaskSummary, OrderStage } from "../../api/sampleRoomApi";
import { pendingPatternOnlyLabel, productionStageLabel } from "./PatternTaskStatusBadges";

export function orderCompletionLabel(input: {
  sampleRequestItems?: readonly SampleRequestItem[];
  stage: OrderStage | null;
  stageLabel?: string;
  patternTask?: OrderPatternTaskSummary;
  completionStatus?: "in_progress" | "pattern_only_pending" | "production_completed_pattern_pending" | "completed";
}) {
  const result = input.completionStatus ?? deriveOrderCompletionStatus({
    sampleRequestItems: input.sampleRequestItems ?? [],
    orderStage: input.stage,
    patternTaskStatus: input.patternTask?.status
  });

  if (result === "production_completed_pattern_pending") {
    return "生产已完成，版师任务未完成";
  }
  if (result === "pattern_only_pending") {
    return pendingPatternOnlyLabel({
      sampleRequestItems: input.sampleRequestItems,
      ...(input.patternTask ? { patternTask: input.patternTask } : {})
    });
  }
  if (result === "completed") {
    return "已完成";
  }

  if (input.stageLabel) {
    return input.stageLabel;
  }

  return productionStageLabel({
    ...(input.sampleRequestItems ? { sampleRequestItems: input.sampleRequestItems } : {}),
    stage: input.stage,
    ...(input.patternTask ? { patternTask: input.patternTask } : {})
  });
}

export function OrderCompletionTag(props: {
  sampleRequestItems?: readonly SampleRequestItem[];
  stage: OrderStage | null;
  stageLabel?: string;
  patternTask?: OrderPatternTaskSummary;
  completionStatus?: "in_progress" | "pattern_only_pending" | "production_completed_pattern_pending" | "completed";
  simplified?: boolean;
}) {
  const label = orderCompletionLabel(props);
  const color =
    label === "已完成"
      ? "success"
      : label.includes("版师任务未完成")
        ? "warning"
        : label.startsWith("未完成 ·")
          ? "error"
        : label === "无打样需求"
          ? "default"
          : label.startsWith("待")
            ? "blue"
            : "processing";
  return <Tag className="order-completion-tag" color={color}>{label}</Tag>;
}
