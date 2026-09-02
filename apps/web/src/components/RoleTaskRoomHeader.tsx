import type { ReactNode } from "react";
import { Card, Space, Tag, Typography } from "antd";

export type RoleTaskRoomStep = {
  label: string;
  help?: string;
  active?: boolean;
};

type RoleTaskRoomHeaderProps = {
  title: string;
  eyebrow: string;
  description: string;
  steps: RoleTaskRoomStep[];
  aside?: ReactNode;
  compact?: boolean;
};

export function RoleTaskRoomHeader({
  title,
  eyebrow,
  description,
  steps,
  aside,
  compact = false
}: RoleTaskRoomHeaderProps) {
  return (
    <Card className={`section-card role-task-room-card${compact ? " role-task-room-card-compact" : ""}`}>
      <div className="role-task-room-head">
        <Space direction="vertical" size={4} className="role-task-room-copy">
          <Typography.Text className="role-task-room-eyebrow">{eyebrow}</Typography.Text>
          <Typography.Title level={compact ? 4 : 3}>{title}</Typography.Title>
          <Typography.Text type="secondary">{description}</Typography.Text>
        </Space>
        {aside ? <div className="role-task-room-aside">{aside}</div> : null}
      </div>
      <div className="role-task-room-steps" aria-label={`${title} task flow`}>
        {steps.map((step, index) => (
          <div
            className={`role-task-room-step${step.active ? " role-task-room-step-active" : ""}`}
            key={`${step.label}-${index}`}
          >
            <Tag color={step.active ? "blue" : "default"}>{index + 1}</Tag>
            <div>
              <Typography.Text strong>{step.label}</Typography.Text>
              {step.help ? <Typography.Text type="secondary">{step.help}</Typography.Text> : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
