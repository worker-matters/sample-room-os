import { Button, Card, Progress, Space, Table, Tag, Typography, type TableProps } from "antd";
import { useState } from "react";
import type { ClientOrder } from "../../api/sampleRoomApi";
import {
  buildClientAdminBusinessStats,
  type ClientAdminBusinessUserStat
} from "./clientAdminStatsModel";

type ClientAdminStatisticsProps = {
  orders: ClientOrder[];
  variant?: "web" | "mobile";
};

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="client-admin-stat-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function SummaryHeader({
  summary
}: {
  summary: ReturnType<typeof buildClientAdminBusinessStats>["summary"];
}) {
  return (
    <div className="client-admin-stat-header">
      <Space direction="vertical" size={0}>
        <Typography.Text strong>业务员统计</Typography.Text>
        <Typography.Text type="secondary" className="client-admin-stat-scope">
          当前筛选统计
        </Typography.Text>
      </Space>
      <div className="client-admin-stat-summary" data-testid="client-admin-stat-summary">
        <SummaryPill label="下单总数" value={summary.orderCount} />
        <SummaryPill label="完成单数" value={summary.completedOrderCount} />
        <SummaryPill label="安排件数" value={summary.arrangedQuantity} />
        <SummaryPill label="已完成件数" value={summary.completedQuantity} />
      </div>
    </div>
  );
}

function CompletionRate({ row }: { row: ClientAdminBusinessUserStat }) {
  return (
    <Space direction="vertical" size={2} className="client-admin-completion-rate">
      <Typography.Text>{row.completionRate}%</Typography.Text>
      <Progress percent={row.completionRate} showInfo={false} size="small" />
    </Space>
  );
}

function WebStatisticsTable({ rows }: { rows: ClientAdminBusinessUserStat[] }) {
  const columns: TableProps<ClientAdminBusinessUserStat>["columns"] = [
    {
      title: "客户业务员",
      dataIndex: "businessUserName",
      render: (value) => <Typography.Text strong>{value}</Typography.Text>
    },
    { title: "下单数", dataIndex: "orderCount", width: 88 },
    { title: "完成单数", dataIndex: "completedOrderCount", width: 96 },
    { title: "安排件数", dataIndex: "arrangedQuantity", width: 96 },
    { title: "已完成件数", dataIndex: "completedQuantity", width: 108 },
    {
      title: "完成率",
      dataIndex: "completionRate",
      width: 150,
      render: (_, row) => <CompletionRate row={row} />
    }
  ];

  return (
    <Table
      rowKey="businessUserId"
      size="small"
      pagination={false}
      columns={columns}
      dataSource={rows}
      locale={{ emptyText: "当前筛选下暂无业务员订单" }}
    />
  );
}

function MobileStatisticsRows({ rows }: { rows: ClientAdminBusinessUserStat[] }) {
  if (rows.length === 0) {
    return <Card size="small">当前筛选下暂无业务员订单</Card>;
  }

  return (
    <div className="client-admin-mobile-stat-list">
      {rows.map((row) => (
        <Card size="small" key={row.businessUserId} className="client-admin-mobile-stat-card">
          <Space direction="vertical" size={8} className="full-width">
            <Space className="mobile-card-head">
              <Typography.Text strong>{row.businessUserName}</Typography.Text>
              <Tag color="blue">完成率 {row.completionRate}%</Tag>
            </Space>
            <div className="client-admin-mobile-stat-grid">
              <span>下单：{row.orderCount}</span>
              <span>完成：{row.completedOrderCount}</span>
              <span>安排件数：{row.arrangedQuantity}</span>
              <span>已完成件数：{row.completedQuantity}</span>
            </div>
            <Progress percent={row.completionRate} showInfo={false} size="small" />
          </Space>
        </Card>
      ))}
    </div>
  );
}

export function ClientAdminStatistics({
  orders,
  variant = "web"
}: ClientAdminStatisticsProps) {
  const statistics = buildClientAdminBusinessStats(orders);
  const isMobile = variant === "mobile";
  const [activeKeys, setActiveKeys] = useState<string[]>([]);

  return (
    <Card
      size="small"
      className={`client-admin-statistics ${isMobile ? "client-admin-statistics-mobile" : ""}`}
      data-testid="client-admin-statistics"
    >
      <div className="client-admin-stat-toggle">
        <SummaryHeader summary={statistics.summary} />
        <Button
          type="link"
          size="small"
          className="client-admin-stat-expand"
          onClick={() =>
            setActiveKeys((keys) => (keys.includes("business-user-statistics") ? [] : ["business-user-statistics"]))
          }
        >
          {activeKeys.length > 0 ? "收起" : "展开"}
        </Button>
      </div>
      {activeKeys.includes("business-user-statistics") ? (
        <div className="client-admin-stat-body" data-section="business-user-statistics">
          <Space direction="vertical" size={8} className="full-width">
            {isMobile ? (
              <MobileStatisticsRows rows={statistics.rows} />
            ) : (
              <WebStatisticsTable rows={statistics.rows} />
            )}
            <Typography.Text type="secondary" className="client-admin-stat-note">
              已完成件数按当前 Alpha 已完成订单的下单数量统计；真实交货数量待出库/完成模块补齐。
            </Typography.Text>
          </Space>
        </div>
      ) : null}
    </Card>
  );
}
