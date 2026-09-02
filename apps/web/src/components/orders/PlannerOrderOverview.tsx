import {
  Alert,
  Descriptions,
  Space,
  Tag,
  Typography
} from "antd";
import {
  MATERIAL_STATUS_LABELS,
  ORDER_STAGES,
  physicalProductionRoute,
  sampleRequestItemOptions,
  sampleRoundOptions
} from "@sample-room/shared";
import type { PlannerOrder } from "../../api/sampleRoomApi";
import { OrderTaskStatusBadges, PatternTaskStatusBadges } from "../operations/PatternTaskStatusBadges";
import { ParallelProgress } from "../operations/ParallelProgress";
import { useSampleTypeOptions } from "../../app/SampleTypeOptionsContext";

const taskLabels = new Map<string, string>(
  sampleRequestItemOptions.map((option) => [option.value, option.label])
);
const sampleRoundLabels = new Map<string, string>(
  sampleRoundOptions.map((option) => [option.value, option.label])
);

function isMaterialComplete(value: string) {
  return value === "complete" || value === MATERIAL_STATUS_LABELS.complete;
}

const stageLabels: Record<string, string> = {
  pattern_waiting: "等待版师",
  pattern_doing: "制版中",
  cutting_handoff_waiting: "等待交裁剪",
  cutting_waiting: "等待裁剪",
  cutting_doing: "裁剪中",
  sewing_waiting: "等待样衣",
  sewing_doing: "样衣制作中",
  qc_delivery_waiting: "等待组检 / 出库",
  done: "已完成"
};

const routeLabels: Record<string, string> = {
  cutting: "裁剪",
  sewing: "生产样衣 / 小样",
  qc_delivery: "组检 / 出库"
};

function nextStep(order: PlannerOrder) {
  const route = physicalProductionRoute(order.sampleRequestItems ?? []);
  const stage = order.stage;
  if (!stage || stage === ORDER_STAGES.patternWaiting || stage === ORDER_STAGES.patternDoing) {
    return route[0] ? routeLabels[route[0]] : "版师任务完成";
  }
  if (stage === ORDER_STAGES.cuttingWaiting || stage === ORDER_STAGES.cuttingDoing) {
    return route.includes("sewing") ? "样衣工处理" : "组检 / 出库";
  }
  if (stage === ORDER_STAGES.sewingWaiting || stage === ORDER_STAGES.sewingDoing) {
    return "组检 / 出库";
  }
  return stage === ORDER_STAGES.done ? "订单已完成" : "相关工序员工处理";
}

function daysUntil(date: string) {
  const due = new Date(`${date}T23:59:59`).getTime();
  return Math.ceil((due - Date.now()) / 86_400_000);
}

export function PlannerOrderOverview({ order }: { order: PlannerOrder }) {
  const { labelFor: sampleTypeLabel } = useSampleTypeOptions();
  const currentHandler =
    order.activeWorker?.workerName ||
    order.patternTask?.patternMakerName ||
    "等待相关人员领取";
  const currentTask = order.activeWorker?.stageLabel || order.stageLabel || stageLabels[order.stage ?? ""] || "待处理";
  const dueDays = daysUntil(order.deliveryDate);
  const blockers = [
    ...(!isMaterialComplete(order.fabricStatus) ? ["面料未齐"] : []),
    ...(!isMaterialComplete(order.trimStatus) ? ["辅料未齐"] : []),
    ...(dueDays >= 0 && dueDays <= 2 ? [`交期临近（${dueDays} 天）`] : []),
    ...(dueDays < 0 && order.stage !== ORDER_STAGES.done ? ["订单已超过交期"] : [])
  ];
  const physicalTasks = (order.sampleRequestItems ?? []).filter((item) =>
    ["cutting", "sample_garment", "sample_small"].includes(item)
  );

  return (
    <Space direction="vertical" size={12} className="full-width planner-confirmed-overview">
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }} bordered>
        <Descriptions.Item label="交期">{order.deliveryDate}</Descriptions.Item>
        <Descriptions.Item label="数量">{order.quantity} 件</Descriptions.Item>
        <Descriptions.Item label="样品类型">
          {sampleTypeLabel(order.sampleType)}
        </Descriptions.Item>
        <Descriptions.Item label="样品轮次">
          {sampleRoundLabels.get(order.sampleRound) ?? order.sampleRound}
        </Descriptions.Item>
        <Descriptions.Item label="面里料">{order.fabricStatus}</Descriptions.Item>
        <Descriptions.Item label="辅料">{order.trimStatus}</Descriptions.Item>
        <Descriptions.Item label="备注" span={2}>{order.remark || "-"}</Descriptions.Item>
      </Descriptions>
      <div className="planner-primary-status">
        <div>
          <Typography.Text type="secondary">当前生产状态</Typography.Text>
          <Typography.Title level={3}>{order.stageLabel || stageLabels[order.stage ?? ""]}</Typography.Title>
        </div>
        <Tag color={order.stage === ORDER_STAGES.done ? "success" : "processing"}>
          {order.stage === ORDER_STAGES.done ? "已完成" : "进行中"}
        </Tag>
      </div>

      <ParallelProgress
        title="生产进度"
        sampleRequestItems={order.sampleRequestItems ?? []}
        stage={order.stage}
        {...(order.patternTask ? { patternTask: order.patternTask } : {})}
      />

      <Descriptions
        size="small"
        bordered
        column={{ xs: 1, sm: 2, lg: 4 }}
        className="planner-handler-grid"
      >
        <Descriptions.Item label="当前处理人">{currentHandler}</Descriptions.Item>
        <Descriptions.Item label="当前任务">{currentTask}</Descriptions.Item>
        <Descriptions.Item label="下一步">{nextStep(order)}</Descriptions.Item>
        <Descriptions.Item label="要求完成节点">{order.deliveryDate}</Descriptions.Item>
      </Descriptions>

      <div className="planner-task-groups">
        <section>
          <Typography.Text strong>版师任务</Typography.Text>
          <PatternTaskStatusBadges
            sampleRequestItems={order.sampleRequestItems ?? []}
            patternTask={order.patternTask}
            maxRows={3}
          />
          {order.patternTask?.patternMakerName ? (
            <Typography.Text type="secondary">
              版师：{order.patternTask.patternMakerName}
            </Typography.Text>
          ) : null}
        </section>
        <section>
          <Typography.Text strong>实体生产任务</Typography.Text>
          <OrderTaskStatusBadges
            sampleRequestItems={physicalTasks}
            stage={order.stage}
            patternTask={order.patternTask}
            maxRows={3}
          />
          {physicalTasks.length === 0 ? (
            <Typography.Text type="secondary">本单无实体生产任务</Typography.Text>
          ) : (
            <Typography.Text type="secondary">
              {physicalTasks.map((item) => taskLabels.get(item) ?? item).join("、")}
            </Typography.Text>
          )}
        </section>
      </div>

      {blockers.length > 0 ? (
        <Alert type="warning" showIcon message="需要计划员关注" description={blockers.join("；")} />
      ) : (
        <Alert type="success" showIcon message="当前无阻塞" />
      )}
    </Space>
  );
}
