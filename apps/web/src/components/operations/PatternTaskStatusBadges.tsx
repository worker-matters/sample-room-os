import { Space, Tag, Typography } from "antd";
import {
  ORDER_STAGES,
  SAMPLE_REQUEST_ITEMS,
  isSampleRequestItemComplete,
  patternTaskRequirementsFromItems,
  physicalProductionRoute,
  sampleRequestItemOptions,
  type SampleRequestItem
} from "@sample-room/shared";
import type { OrderPatternTaskSummary, OrderStage } from "../../api/sampleRoomApi";

const taskLabelMap = new Map<string, string>(sampleRequestItemOptions.map((option) => [option.value, option.label]));

const completedPatternStatuses = new Set(["completed", "submitted", "submitted_to_cutting"]);

export function patternTaskRequirements(input: {
  sampleRequestItems?: readonly SampleRequestItem[] | undefined;
  patternTask?: Pick<OrderPatternTaskSummary, "requirements"> | undefined;
}) {
  return input.patternTask?.requirements?.length
    ? input.patternTask.requirements
    : patternTaskRequirementsFromItems(input.sampleRequestItems ?? []);
}

export function patternTaskDisplayLabel(item: string) {
  return taskLabelMap.get(item) ?? item;
}

export function completedPatternTaskSet(patternTask?: Pick<OrderPatternTaskSummary, "completedRequirements" | "status">) {
  const completed = new Set(patternTask?.completedRequirements ?? []);
  if (patternTask?.status && completedPatternStatuses.has(patternTask.status)) {
    return completed;
  }
  return completed;
}

export function pendingPatternStageLabel(input: {
  sampleRequestItems?: readonly SampleRequestItem[] | undefined;
  patternTask?: Pick<OrderPatternTaskSummary, "requirements" | "completedRequirements" | "status"> | undefined;
}) {
  const requirements = patternTaskRequirements(input);
  const completed = completedPatternTaskSet(input.patternTask);
  const pending = requirements.find((requirement) => !completed.has(requirement));
  return pending ? `待${patternTaskDisplayLabel(pending)}` : "待完成版师任务";
}

export function pendingPatternOnlyLabel(input: {
  sampleRequestItems?: readonly SampleRequestItem[] | undefined;
  patternTask?: Pick<OrderPatternTaskSummary, "requirements" | "completedRequirements" | "status"> | undefined;
}) {
  const requirements = patternTaskRequirements(input);
  const completed = completedPatternTaskSet(input.patternTask);
  const pending = requirements.filter((requirement) => !completed.has(requirement));
  return pending.length > 0
    ? `未完成 · ${pending.map(patternTaskDisplayLabel).join(" / ")}`
    : "未完成版师任务";
}

export function PatternTaskStatusBadges({
  sampleRequestItems = [],
  patternTask,
  showEmpty = true,
  maxRows = 2
}: {
  sampleRequestItems?: readonly SampleRequestItem[] | undefined;
  patternTask?: Pick<OrderPatternTaskSummary, "requirements" | "completedRequirements" | "status"> | undefined;
  showEmpty?: boolean | undefined;
  maxRows?: number | undefined;
}) {
  const requirements = patternTaskRequirements({
    sampleRequestItems,
    ...(patternTask ? { patternTask } : {})
  });
  const completed = completedPatternTaskSet(patternTask);

  if (requirements.length === 0) {
    return showEmpty ? <Tag>无版师任务</Tag> : null;
  }

  return (
    <Space size={[4, 4]} wrap className={`pattern-task-badge-list pattern-task-badge-list-${maxRows}`}>
      {requirements.map((item) => {
        const done = completed.has(item);
        return (
          <Tag key={item} color={done ? "success" : "error"}>
            {done ? "已完成 · " : "未完成 · "}
            {patternTaskDisplayLabel(item)}
          </Tag>
        );
      })}
    </Space>
  );
}

type ProcessPieceReferences = {
  cutting?: number | undefined;
  sewing?: number | undefined;
  qc?: number | undefined;
};

function processPieceDetail(
  item: SampleRequestItem,
  index: number,
  items: readonly SampleRequestItem[],
  processPieces?: ProcessPieceReferences
) {
  if (!processPieces) return "";
  if (item === SAMPLE_REQUEST_ITEMS.cutting && processPieces.cutting !== undefined) {
    return `${processPieces.cutting}件`;
  }

  const firstSampleTaskIndex = items.findIndex(
    (candidate) =>
      candidate === SAMPLE_REQUEST_ITEMS.sampleGarment ||
      candidate === SAMPLE_REQUEST_ITEMS.sampleSmall
  );
  if (index !== firstSampleTaskIndex) return "";
  if (item !== SAMPLE_REQUEST_ITEMS.sampleGarment && item !== SAMPLE_REQUEST_ITEMS.sampleSmall) {
    return "";
  }

  const details: string[] = [];
  if (processPieces.sewing !== undefined) details.push(`缝制${processPieces.sewing}件`);
  if (processPieces.qc !== undefined) details.push(`组检${processPieces.qc}件`);
  return details.join(" · ");
}

export function OrderTaskStatusBadges({
  sampleRequestItems = [],
  stage,
  patternTask,
  processPieces,
  maxRows = 2
}: {
  sampleRequestItems?: readonly SampleRequestItem[] | undefined;
  stage: OrderStage | null;
  patternTask?: Pick<OrderPatternTaskSummary, "completedRequirements"> | undefined;
  processPieces?: ProcessPieceReferences | undefined;
  maxRows?: number | undefined;
}) {
  if (sampleRequestItems.length === 0) {
    return <Tag>无任务</Tag>;
  }

  return (
    <Space size={[4, 4]} wrap className={`pattern-task-badge-list pattern-task-badge-list-${maxRows}`}>
      {sampleRequestItems.map((item, index) => {
        const done = isSampleRequestItemComplete({
          item,
          orderStage: stage,
          completedPatternRequirements: patternTask?.completedRequirements ?? []
        });
        const detail = processPieceDetail(item, index, sampleRequestItems, processPieces);
        return (
          <Tag key={item} color={done ? "success" : "error"}>
            {done ? "已完成 · " : "未完成 · "}
            {patternTaskDisplayLabel(item)}
            {detail ? ` · ${detail}` : ""}
          </Tag>
        );
      })}
    </Space>
  );
}

export function productionStageLabel(input: {
  sampleRequestItems?: readonly SampleRequestItem[] | undefined;
  stage: OrderStage | null;
  patternTask?: Pick<OrderPatternTaskSummary, "requirements" | "completedRequirements" | "status"> | undefined;
}) {
  const items = input.sampleRequestItems ?? [];
  const route = physicalProductionRoute(items);
  if (input.stage === ORDER_STAGES.patternWaiting || input.stage === ORDER_STAGES.patternDoing) {
    return pendingPatternStageLabel(input);
  }
  if (route.length === 0) {
    return "无打样需求";
  }

  switch (input.stage) {
    case ORDER_STAGES.cuttingHandoffWaiting:
    case ORDER_STAGES.cuttingWaiting:
      return "待裁剪";
    case ORDER_STAGES.cuttingDoing:
      return "裁剪中";
    case ORDER_STAGES.sewingWaiting:
      return "待缝制";
    case ORDER_STAGES.sewingDoing:
      return "缝制中";
    case ORDER_STAGES.qcDeliveryWaiting:
      return "待组检";
    case ORDER_STAGES.done:
      return "已完成";
    case ORDER_STAGES.pendingReceive:
      return "待接单";
    default:
      return route[0] === "cutting" ? "待裁剪" : route[0] === "sewing" ? "待缝制" : "无打样需求";
  }
}

export function ProductionStageTag({
  sampleRequestItems = [],
  stage,
  patternTask
}: {
  sampleRequestItems?: readonly SampleRequestItem[] | undefined;
  stage: OrderStage | null;
  patternTask?: Pick<OrderPatternTaskSummary, "requirements" | "completedRequirements" | "status"> | undefined;
}) {
  const label = productionStageLabel({
    sampleRequestItems,
    stage,
    ...(patternTask ? { patternTask } : {})
  });
  const color =
    label === "已完成"
      ? "success"
      : label === "无打样需求"
        ? "default"
        : label === "待完成版师任务" || label === "待制版" || label === "待改版"
          ? "purple"
          : label.startsWith("待")
            ? "blue"
            : "processing";
  return (
    <Typography.Text>
      <Tag color={color}>{label}</Tag>
    </Typography.Text>
  );
}
