import { Collapse, Empty, Space, Tag, Typography } from "antd";
import type { OrderCorrectionLogEntry } from "../../api/sampleRoomApi";

type ReceiverCorrectionLogProps = {
  logs?: OrderCorrectionLogEntry[] | undefined;
  defaultActive?: boolean;
  active?: boolean | undefined;
  onActiveChange?: ((active: boolean) => void) | undefined;
};

const correctionFieldLabels: Record<string, string> = {
  styleNo: "款号",
  styleName: "款名",
  quantity: "数量",
  sampleType: "样品类型",
  sampleRound: "样品轮次",
  deliveryDate: "交期",
  remark: "备注",
  fabricStatus: "面里料状态",
  trimStatus: "辅料状态",
  sampleRequestItems: "打样要求",
  sampleGarmentRequired: "是否生产样衣",
  taskInstructionNote: "任务备注"
};

const correctionValueLabels: Record<string, string> = {
  partial: "部分齐",
  complete: "全齐",
  missing: "未齐",
  has: "客户来版",
  none: "需制版",
  customer_provided: "客户来版",
  previous_order: "基于历史订单版",
  same_order_revision: "本订单补改版",
  true: "是",
  false: "否"
};

const roleLabels: Record<string, string> = {
  receiver: "接单员",
  boss: "老板",
  pattern_maker: "版师",
  client_admin: "客户主管",
  client_business_user: "客户业务员",
  system_owner: "系统管理员",
  planner: "计划员"
};

export function formatCorrectionFieldName(fieldName: string) {
  return correctionFieldLabels[fieldName] ?? fieldName;
}

export function formatCorrectionValue(value: string | number | null) {
  if (value === null || value === "") {
    return "未填写";
  }

  const rawValue = String(value);
  return correctionValueLabels[rawValue] ?? rawValue;
}

export function formatRoleName(role: string) {
  return roleLabels[role] ?? role;
}

function formatCorrectionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

export function ReceiverCorrectionLog({
  logs = [],
  defaultActive = false,
  active,
  onActiveChange
}: ReceiverCorrectionLogProps) {
  const visibleLogs = logs.filter(
    (log) => log.fieldName !== "patternStatus" && log.fieldName !== "patternSourceType"
  );

  return (
    <Collapse
      size="small"
      className="receiver-correction-log"
      {...(active === undefined
        ? { defaultActiveKey: defaultActive ? ["correction-log"] : [] }
        : { activeKey: active ? ["correction-log"] : [] })}
      onChange={(keys) => {
        const activeKeys = Array.isArray(keys) ? keys : [keys];
        onActiveChange?.(activeKeys.includes("correction-log"));
      }}
      items={[
        {
          key: "correction-log",
          label: `订单资料修改记录 ${visibleLogs.length}`,
          children:
            visibleLogs.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无修改记录" />
            ) : (
              <Space direction="vertical" size={8} className="full-width receiver-correction-log-list">
                {visibleLogs.map((log) => (
                  <div className="receiver-correction-log-row" key={log.id}>
                    <Space direction="vertical" size={4} className="full-width">
                      <Tag color="blue">{formatCorrectionFieldName(log.fieldName)}</Tag>
                      <Space wrap size={6}>
                      <Typography.Text strong>{formatCorrectionValue(log.oldValue)}</Typography.Text>
                      <Typography.Text type="secondary">→</Typography.Text>
                      <Typography.Text strong>{formatCorrectionValue(log.newValue)}</Typography.Text>
                      </Space>
                    </Space>
                    <Typography.Text type="secondary">
                      {formatCorrectionTime(log.changedAt)} · {formatRoleName(log.changedByRole)} ·{" "}
                      {log.changedByName || log.changedByUserId}
                    </Typography.Text>
                  </div>
                ))}
              </Space>
            )
        }
      ]}
    />
  );
}
