import { Alert, Button, Card, Col, Collapse, Row, Space, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  sampleRoomApi,
  type LifecycleOperationHistoryItem,
  type SystemOwnerRuntimeCheck
} from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";

type CheckStatus = "normal" | "warning" | "problem";
type UserCheck = {
  key: string;
  label: string;
  status: CheckStatus;
  summary: string;
  dataSafety: string;
  nextStep: string;
  technicalCode: string;
};

const statusPresentation: Record<CheckStatus, { label: string; color: string }> = {
  normal: { label: "正常", color: "green" },
  warning: { label: "需要留意", color: "orange" },
  problem: { label: "异常", color: "red" }
};

function runtimeStatus(check: SystemOwnerRuntimeCheck | undefined): CheckStatus {
  if (!check) return "warning";
  if (check.status === "pass") return "normal";
  return check.status === "fail" ? "problem" : "warning";
}

function historyStatus(record: LifecycleOperationHistoryItem | undefined): CheckStatus {
  if (!record || record.result === "success") return "normal";
  return record.result === "needs_review" ? "problem" : "warning";
}

export function SystemHealthPanel({ session }: { session: DevSession }) {
  const [checks, setChecks] = useState<UserCheck[]>([]);
  const [technicalChecks, setTechnicalChecks] = useState<SystemOwnerRuntimeCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string>();
  const [messageApi, contextHolder] = message.useMessage();

  const run = useCallback(async () => {
    setChecking(true);
    try {
      const [runtime, lifecycle, storage, updates, history] = await Promise.all([
        sampleRoomApi.runSystemOwnerRuntimeChecks(session),
        sampleRoomApi.getRecoveryPointOverview(session),
        sampleRoomApi.getStorageManagementOverview(session),
        sampleRoomApi.getSystemUpdateOverview(session),
        sampleRoomApi.getLifecycleOperationHistory(session)
      ]);
      const byKey = new Map(runtime.checks.map((item) => [item.key, item]));
      const latestUpdate = history.records.find((item) => item.operation === "系统更新");
      const latestRestore = history.records.find((item) => item.operation === "恢复系统");
      const backupStatus: CheckStatus = storage.backup.status === "normal" && lifecycle.backupReadiness?.canStart !== false ? "normal" : "warning";
      const items: UserCheck[] = [
        {
          key: "website",
          label: "网站服务",
          status: runtimeStatus(byKey.get("api_health")),
          summary: byKey.get("api_health")?.status === "pass" ? "页面和系统服务可以正常响应。" : "系统服务的完整检查未通过。",
          dataSafety: "检查不会修改业务数据。",
          nextStep: byKey.get("api_health")?.status === "pass" ? "无需处理。" : "请稍后再次点击“重新检查”。",
          technicalCode: "SYSTEM_API_HEALTH"
        },
        {
          key: "database",
          label: "数据库",
          status: runtimeStatus(byKey.get("postgresql_connectivity")),
          summary: runtimeStatus(byKey.get("postgresql_connectivity")) === "normal" ? "订单等业务数据可以正常读取。" : "数据库连接尚未完成正式检查。",
          dataSafety: "现有数据不会因为本次检查而改变。",
          nextStep: runtimeStatus(byKey.get("postgresql_connectivity")) === "normal" ? "无需处理。" : "请确认正式系统已启动后重新检查。",
          technicalCode: "SYSTEM_DATABASE_CONNECTIVITY"
        },
        {
          key: "files",
          label: "附件和业务文件",
          status: storage.data.status === "normal" ? "normal" : "problem",
          summary: storage.data.status === "normal" ? "业务文件保存位置可以使用。" : "业务文件保存位置暂时无法使用。",
          dataSafety: storage.data.status === "normal" ? "现有附件可继续使用。" : "请勿上传新附件，现有文件不会被本次检查删除。",
          nextStep: storage.data.status === "normal" ? "无需处理。" : "进入“存储管理”查看保存位置状态。",
          technicalCode: "SYSTEM_DATA_STORAGE"
        },
        {
          key: "backup",
          label: "系统备份",
          status: backupStatus,
          summary: backupStatus === "normal" ? "系统备份位置可以创建新的系统恢复点。" : "系统备份位置或可用空间需要处理。",
          dataSafety: "现有业务数据仍然安全，但可能暂时无法创建新备份。",
          nextStep: backupStatus === "normal" ? "无需处理。" : "进入“备份与恢复”查看空间状态。",
          technicalCode: "SYSTEM_BACKUP_STORAGE"
        },
        {
          key: "maintenance",
          label: "维护服务",
          status: lifecycle.runner.online ? "normal" : "warning",
          summary: lifecycle.runner.online ? "可以执行备份、恢复、更新和存储维护。" : "维护服务未启动，维护操作暂时不可用。",
          dataSafety: "日常查看和现有业务数据不受影响。",
          nextStep: lifecycle.runner.online ? "无需处理。" : "保持工厂运行账号已登录，稍后重新检查。",
          technicalCode: "SYSTEM_MAINTENANCE_SERVICE"
        },
        {
          key: "update",
          label: "最近系统更新",
          status: historyStatus(latestUpdate),
          summary: latestUpdate ? `${latestUpdate.operation}：${latestUpdate.result === "success" ? "成功" : latestUpdate.result === "needs_review" ? "系统状态需要检查" : "未完成"}。` : `当前版本 ${updates.currentVersion}，暂无更新记录。`,
          dataSafety: latestUpdate?.dataSafety ?? "当前系统版本未发现需要处理的更新记录。",
          nextStep: latestUpdate?.nextStep ?? "无需处理。",
          technicalCode: latestUpdate?.technicalCode ?? "SYSTEM_LAST_UPDATE"
        },
        {
          key: "restore",
          label: "最近系统恢复",
          status: historyStatus(latestRestore),
          summary: latestRestore ? `${latestRestore.operation}：${latestRestore.result === "success" ? "成功" : latestRestore.result === "needs_review" ? "系统状态需要检查" : "未完成"}。` : "暂无系统恢复记录。",
          dataSafety: latestRestore?.dataSafety ?? "当前没有需要处理的恢复记录。",
          nextStep: latestRestore?.nextStep ?? "无需处理。",
          technicalCode: latestRestore?.technicalCode ?? "SYSTEM_LAST_RESTORE"
        }
      ];
      setTechnicalChecks(runtime.checks);
      setChecks(items);
      setCheckedAt(runtime.generatedAt);
      messageApi.success("系统检查已完成");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "系统检查未完成，请稍后重试。");
    } finally {
      setChecking(false);
    }
  }, [messageApi, session]);

  useEffect(() => { void run(); }, [run]);

  const problemCount = useMemo(() => checks.filter((item) => item.status !== "normal").length, [checks]);

  return (
    <Space direction="vertical" size={16} className="full-width system-health-panel">
      {contextHolder}
      <Card size="small" className="system-management-check-card">
        <Space direction="vertical" size={10} className="full-width">
          <Typography.Title level={4} className="no-margin">检查系统</Typography.Title>
          <Typography.Text>这项检查只读取状态，不会修改订单、附件或系统设置。</Typography.Text>
          <Space wrap>
            <Button type="primary" onClick={() => void run()} loading={checking}>{checkedAt ? "重新检查" : "开始检查"}</Button>
            {checkedAt ? <Typography.Text type="secondary">最近检查：{new Date(checkedAt).toLocaleString()}</Typography.Text> : null}
          </Space>
        </Space>
      </Card>

      {checks.length ? (
        <Alert
          showIcon
          type={problemCount ? "warning" : "success"}
          message={problemCount ? `发现 ${problemCount} 项需要留意` : "系统检查正常"}
          description={problemCount ? "现有数据不会因为检查而改变。请按各项的“下一步”处理。" : "当前检查项目没有发现需要处理的问题。"}
        />
      ) : null}

      <Row gutter={[12, 12]}>
        {checks.map((item) => {
          const presentation = statusPresentation[item.status];
          return (
            <Col xs={24} md={12} key={item.key}>
              <Card size="small" className="system-health-result-card">
                <Space direction="vertical" size={8} className="full-width">
                  <Space className="system-health-result-heading">
                    <Typography.Text strong>{item.label}</Typography.Text>
                    <Tag color={presentation.color}>{presentation.label}</Tag>
                  </Space>
                  <Typography.Text>{item.summary}</Typography.Text>
                  {item.status !== "normal" ? (
                    <div className="system-health-guidance">
                      <Typography.Text><strong>当前影响：</strong>{item.dataSafety}</Typography.Text>
                      <Typography.Text><strong>下一步：</strong>{item.nextStep}</Typography.Text>
                    </div>
                  ) : null}
                  <Collapse ghost size="small" items={[{
                    key: "technical",
                    label: "查看技术详情",
                    children: <Typography.Text code>{item.technicalCode}</Typography.Text>
                  }]} />
                </Space>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Collapse items={[{
        key: "raw-checks",
        label: "高级检查详情",
        children: (
          <Space direction="vertical" size={6} className="full-width">
            {technicalChecks.map((item) => (
              <Typography.Text type="secondary" key={item.key}>
                {item.label} · {item.status} · {item.safeMessage}
              </Typography.Text>
            ))}
          </Space>
        )
      }]} />
    </Space>
  );
}
