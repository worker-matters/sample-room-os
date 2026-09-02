import { Alert, Card, Collapse, Grid, Select, Space, Tabs, Typography } from "antd";
import { useEffect, useState } from "react";
import type { DevSession } from "../../app/DevSessionContext";
import { AdvancedMaintenancePanel } from "./AdvancedMaintenancePanel";
import { AndroidAppReleasePanel } from "./AndroidAppReleasePanel";
import { LifecycleOperationHistoryPanel } from "./LifecycleOperationHistoryPanel";
import { RecoveryPointPanel } from "./RecoveryPointPanel";
import { StorageManagementPanel } from "./StorageManagementPanel";
import { SystemHealthPanel } from "./SystemHealthPanel";
import { SystemManagementOverviewPanel } from "./SystemManagementOverviewPanel";
import { SystemUpdatePanel } from "./SystemUpdatePanel";

type SystemOwnerMaintenancePanelProps = { session: DevSession };

const ACTIVE_SECTION_KEY = "system-owner-management-section";
const SECTION_OPTIONS = [
  { value: "overview", label: "系统概览" },
  { value: "backup", label: "备份与恢复" },
  { value: "updates", label: "系统更新" },
  { value: "app-releases", label: "App 版本" },
  { value: "storage", label: "存储管理" },
  { value: "migration", label: "系统迁移" },
  { value: "checks", label: "检查系统" },
  { value: "records", label: "操作记录" }
];

function PlannedMigrationPanel() {
  return (
    <Card size="small" title="系统迁移">
      <Space direction="vertical" size={16} className="full-width">
        <Alert
          type="info"
          showIcon
          message="此功能将在后续版本提供"
          description="未来可将数据、附件、非敏感配置和系统版本打包，用于更换电脑或重装系统。"
        />
        <Typography.Text>当前没有可点击的导出按钮，避免把尚未完成的功能误认为已经可用。</Typography.Text>
      </Space>
    </Card>
  );
}

export function SystemOwnerMaintenancePanel({ session }: SystemOwnerMaintenancePanelProps) {
  const screens = Grid.useBreakpoint();
  const [activeSection, setActiveSection] = useState(() => sessionStorage.getItem(ACTIVE_SECTION_KEY) ?? "overview");

  useEffect(() => { sessionStorage.setItem(ACTIVE_SECTION_KEY, activeSection); }, [activeSection]);

  return (
    <Card
      className="section-card system-owner-maintenance-panel"
      title={(
        <Space direction="vertical" size={0}>
          <Typography.Title level={4} className="no-margin">系统管理</Typography.Title>
          <Typography.Text type="secondary" className="system-management-subtitle">
            通过页面完成备份、恢复、更新和存储维护；高风险操作前系统会自动保护当前数据。
          </Typography.Text>
        </Space>
      )}
    >
      {!screens.lg ? (
        <Select
          aria-label="选择系统管理功能"
          className="system-management-mobile-select"
          value={activeSection}
          options={SECTION_OPTIONS}
          onChange={setActiveSection}
        />
      ) : null}
      <Tabs
        className="system-management-tabs"
        activeKey={activeSection}
        onChange={setActiveSection}
        tabPosition={screens.lg ? "left" : "top"}
        {...(screens.lg ? {} : { renderTabBar: () => <></> })}
        items={[
          { key: "overview", label: "系统概览", children: <SystemManagementOverviewPanel session={session} onNavigate={setActiveSection} /> },
          { key: "backup", label: "备份与恢复", children: <RecoveryPointPanel session={session} /> },
          { key: "updates", label: "系统更新", children: <SystemUpdatePanel session={session} onRestore={() => setActiveSection("backup")} /> },
          { key: "app-releases", label: "App 版本", children: <AndroidAppReleasePanel session={session} /> },
          { key: "storage", label: "存储管理", children: <StorageManagementPanel session={session} /> },
          { key: "migration", label: "系统迁移", children: <PlannedMigrationPanel /> },
          {
            key: "checks",
            label: "检查系统",
            children: (
              <Space direction="vertical" size={16} className="full-width">
                <SystemHealthPanel session={session} />
                <Collapse items={[{
                  key: "advanced",
                  label: "高级维护",
                  children: <AdvancedMaintenancePanel session={session} />
                }]} />
              </Space>
            )
          },
          { key: "records", label: "操作记录", children: <LifecycleOperationHistoryPanel session={session} /> }
        ]}
      />
    </Card>
  );
}
