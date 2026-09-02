import { Card, Space, Steps, Tag, Typography } from "antd";
import {
  hasPatternTaskRequirements,
  patternTaskRequirementsFromItems,
  physicalProductionRoute,
  type SampleRequestItem
} from "@sample-room/shared";
import type { OrderPatternTaskSummary, OrderStage } from "../../api/sampleRoomApi";

const requirementLabels: Record<string, string> = {
  pattern_making: "制版",
  pattern_revision: "改版",
  pattern_full_size: "推全码版",
  quote_material_check: "报价核料",
  bulk_material_check: "大货核料",
  pattern_padding_amount: "充棉/绒量",
  pattern_zipper_length: "核拉链长度"
};

const physicalLabels = { cutting: "裁剪", sewing: "缝制", qc_delivery: "组检/交付" } as const;

const patternStatusLabels: Record<string, string> = {
  pending: "待领取",
  active: "进行中",
  in_progress: "进行中",
  paused: "已暂停",
  completed: "已完成",
  submitted: "已完成",
  submitted_to_cutting: "已完成"
};

function currentPhysicalIndex(route: ReturnType<typeof physicalProductionRoute>, stage: OrderStage | null) {
  if (!stage) return -1;
  if (stage === "done") return route.length;
  if (stage === "cutting_waiting" || stage === "cutting_doing") return route.indexOf("cutting");
  if (stage === "sewing_waiting" || stage === "sewing_doing") return route.indexOf("sewing");
  if (stage === "qc_delivery_waiting") return route.indexOf("qc_delivery");
  return -1;
}

export function ParallelProgress({
  sampleRequestItems = [],
  stage,
  patternTask,
  compact = false,
  stacked = false,
  title = "双线进度"
}: {
  sampleRequestItems?: readonly SampleRequestItem[];
  stage: OrderStage | null;
  patternTask?: OrderPatternTaskSummary;
  compact?: boolean;
  stacked?: boolean;
  title?: string;
}) {
  const requirements = patternTask?.requirements?.length
    ? patternTask.requirements
    : patternTaskRequirementsFromItems(sampleRequestItems);
  const patternRequired = requirements.length > 0 || hasPatternTaskRequirements(sampleRequestItems);
  const route = physicalProductionRoute(sampleRequestItems);
  const completedCount = patternTask?.completedRequirements?.filter((item) => requirements.includes(item)).length ?? 0;
  const physicalIndex = currentPhysicalIndex(route, stage);
  const patternCompleted = patternTask && ["completed", "submitted", "submitted_to_cutting"].includes(patternTask.status);

  const body = (
    <div className={`parallel-progress${stacked ? " parallel-progress-stacked" : ""}`}>
      <div className="parallel-progress-lane">
        <div className="parallel-progress-heading">
          <Typography.Text strong>综合版师任务</Typography.Text>
          <Tag color={patternCompleted ? "success" : patternTask?.status === "paused" ? "warning" : patternTask ? "processing" : "default"}>
            {patternRequired
              ? `${patternStatusLabels[patternTask?.status ?? "pending"] ?? patternTask?.status ?? "待领取"}${requirements.length ? ` · ${completedCount}/${requirements.length}` : ""}`
              : "无版师任务"}
          </Tag>
        </div>
        <Space size={[4, 4]} wrap>
          {requirements.length > 0 ? requirements.map((item) => (
            <Tag key={item} color={patternTask?.completedRequirements?.includes(item) ? "success" : "default"}>
              {requirementLabels[item] ?? item}
            </Tag>
          )) : <Typography.Text type="secondary">本单无需版师处理</Typography.Text>}
        </Space>
      </div>
      <div className="parallel-progress-lane">
        <div className="parallel-progress-heading">
          <Typography.Text strong>实体生产路线</Typography.Text>
          <Tag color={stage === "done" ? "success" : stage === "pattern_waiting" || stage === "pattern_doing" ? "warning" : "blue"}>
            {stage === "done" ? "已完成" : stage === "pattern_waiting" || stage === "pattern_doing" ? "等待版师成果" : stage ? "流转中" : "路线预览"}
          </Tag>
        </div>
        {route.length > 0 ? (
          <Steps
            size="small"
            current={physicalIndex < 0 ? 0 : Math.min(physicalIndex, route.length)}
            status={physicalIndex < 0 ? "wait" : "process"}
            items={route.map((item, index) => ({
              title: physicalLabels[item],
              status: stage === "done" || (physicalIndex >= 0 && index < physicalIndex)
                ? "finish"
                : index === physicalIndex
                  ? "process"
                  : "wait"
            }))}
          />
        ) : <Typography.Text type="secondary">仅资料/版师任务，无实体生产</Typography.Text>}
      </div>
    </div>
  );

  return compact ? body : <Card size="small" title={title}>{body}</Card>;
}
