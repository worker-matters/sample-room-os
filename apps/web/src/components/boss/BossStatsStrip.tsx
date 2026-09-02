import { Card, Space, Typography } from "antd";
import type { KeyboardEvent, ReactNode } from "react";

export type BossStatsTone = "blue" | "cyan" | "green" | "orange" | "purple" | "geekblue" | "red" | "gray";

export type BossStatsStripItem = {
  label: string;
  value: ReactNode;
  tone?: BossStatsTone | string;
  helper?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
};

type BossStatsStripProps = {
  scope: ReactNode;
  title: ReactNode;
  helper?: ReactNode;
  ariaLabel: string;
  items: BossStatsStripItem[];
  className?: string;
};

const ALL_ORDERS_LABEL = "全部订单";
const TODAY_DELIVERY_LABEL = "今日交期";
const TERMINATED_LABEL = "已终止";

function handleItemKeyDown(event: KeyboardEvent<HTMLElement>, onClick: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onClick();
}

function numericStatValue(value: ReactNode) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function buildBossStatsStripItems(items: BossStatsStripItem[]) {
  const terminatedItem = items.find((item) => item.label === TERMINATED_LABEL);

  return items
    .filter((item) => item.label !== TODAY_DELIVERY_LABEL && item.label !== TERMINATED_LABEL)
    .map((item) => {
      if (item.label !== ALL_ORDERS_LABEL || !terminatedItem) {
        return item;
      }

      const activeAndCompletedCount = numericStatValue(item.value);
      const terminatedCount = numericStatValue(terminatedItem.value);
      const value = activeAndCompletedCount !== null && terminatedCount !== null
        ? activeAndCompletedCount + terminatedCount
        : item.value;

      if (!item.onClick && !terminatedItem.onClick) {
        return { ...item, value };
      }

      return {
        ...item,
        value,
        onClick: () => {
          item.onClick?.();
          terminatedItem.onClick?.();
        }
      };
    });
}

function BossStatsReminder({
  item,
  label,
  warning = false
}: {
  item: BossStatsStripItem;
  label: string;
  warning?: boolean;
}) {
  const onClick = item.onClick;
  const hasPositiveValue = (numericStatValue(item.value) ?? 0) > 0;

  return (
    <Typography.Text
      type={warning && hasPositiveValue ? "warning" : "secondary"}
      {...(onClick
        ? {
            role: "button",
            tabIndex: 0,
            "aria-pressed": Boolean(item.selected),
            onClick,
            onKeyDown: (event: KeyboardEvent<HTMLElement>) => handleItemKeyDown(event, onClick),
            style: {
              cursor: "pointer",
              fontWeight: item.selected ? 600 : undefined
            }
          }
        : {})}
    >
      {label} <strong>{item.value}</strong>
    </Typography.Text>
  );
}

export function BossStatsStrip({ scope, title, helper, ariaLabel, items, className }: BossStatsStripProps) {
  const displayItems = buildBossStatsStripItems(items);
  const todayDeliveryItem = items.find((item) => item.label === TODAY_DELIVERY_LABEL);
  const terminatedItem = items.find((item) => item.label === TERMINATED_LABEL);

  return (
    <Card className={`section-card boss-stats-strip${className ? ` ${className}` : ""}`}>
      <div className="boss-stats-strip-layout">
        <div className="boss-stats-strip-copy">
          <Typography.Text type="secondary" className="boss-stats-strip-scope">
            {scope}
          </Typography.Text>
          <Typography.Title level={4}>{title}</Typography.Title>
          {helper ? (
            <Typography.Text type="secondary" className="boss-stats-strip-helper">
              {helper}
            </Typography.Text>
          ) : null}
          {todayDeliveryItem || terminatedItem ? (
            <Space size={12} wrap>
              {todayDeliveryItem ? (
                <BossStatsReminder item={todayDeliveryItem} label="今日到期" warning />
              ) : null}
              {terminatedItem ? (
                <BossStatsReminder item={terminatedItem} label="已终止" />
              ) : null}
            </Space>
          ) : null}
        </div>
        <div className="boss-stats-strip-rail" aria-label={ariaLabel}>
          {displayItems.map((item) => {
            const onClick = item.onClick;
            return (
              <div
                className={`boss-stats-strip-item boss-stats-strip-item-${item.tone ?? "blue"}`}
                key={item.label}
                {...(onClick
                  ? {
                      role: "button",
                      tabIndex: 0,
                      "aria-pressed": Boolean(item.selected),
                      onClick,
                      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => handleItemKeyDown(event, onClick),
                      style: {
                        cursor: "pointer",
                        borderRadius: 8,
                        background: item.selected ? "rgba(22, 119, 255, 0.08)" : undefined
                      }
                    }
                  : {})}
              >
                <span className="boss-stats-strip-label">{item.label}</span>
                <strong className="boss-stats-strip-value">{item.value}</strong>
                {item.helper ? <span className="boss-stats-strip-item-helper">{item.helper}</span> : null}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
