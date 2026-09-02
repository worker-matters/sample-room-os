import { Alert, Button, Card, Col, Descriptions, Row, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  sampleRoomApi,
  type LifecycleMaintenanceJob,
  type RecoveryPointSummary,
  type StorageManagementOverview,
  type SystemUpdateOverview
} from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";

type OverviewData = {
  currentTask: LifecycleMaintenanceJob | undefined;
  latestTask: LifecycleMaintenanceJob | undefined;
  recentRecoveryPoint: RecoveryPointSummary | undefined;
  runnerOnline: boolean;
  backupReady: boolean | undefined;
  backupAvailableBytes: string | undefined;
  storage: StorageManagementOverview;
  updates: SystemUpdateOverview;
};

type SystemManagementOverviewPanelProps = {
  session: DevSession;
  onNavigate: (section: string) => void;
};

const actionLabel: Record<string, string> = {
  create_recovery_point: "创建系统恢复点",
  restore_recovery_point: "恢复系统",
  migrate_storage: "更换存储位置",
  preflight_update: "检查系统更新包",
  apply_update: "更新系统",
  diagnostic: "检查系统"
};

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "暂无";
}

function formatBytes(value?: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "正在读取";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB 可用`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB 可用`;
  return `${bytes} B 可用`;
}

function jobResult(job?: LifecycleMaintenanceJob) {
  if (!job) return { label: "暂无记录", color: "default" };
  if (job.errorCode === "MANUAL_REVIEW_REQUIRED") return { label: "系统状态需要检查", color: "red" };
  if (job.status === "completed") return { label: "已完成", color: "green" };
  if (job.status === "failed") return { label: "未完成", color: "red" };
  if (["queued", "claimed", "running"].includes(job.status)) return { label: "正在处理", color: "blue" };
  return { label: "已记录", color: "default" };
}

function storageStatusTag(loadFailed: boolean, runnerOnline: boolean | undefined, status?: "normal" | "unavailable") {
  if (loadFailed) return { label: "等待刷新", color: "default" };
  if (runnerOnline === false) return { label: "等待维护服务", color: "default" };
  if (status === "normal") return { label: "状态正常", color: "green" };
  if (status === "unavailable") return { label: "需要检查", color: "red" };
  return { label: "等待刷新", color: "default" };
}

export function SystemManagementOverviewPanel({
  session,
  onNavigate
}: SystemManagementOverviewPanelProps) {
  const [data, setData] = useState<OverviewData>();
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [lifecycle, storage, updates] = await Promise.all([
        sampleRoomApi.getRecoveryPointOverview(session),
        sampleRoomApi.getStorageManagementOverview(session),
        sampleRoomApi.getSystemUpdateOverview(session)
      ]);
      setData({
        currentTask: lifecycle.currentTask,
        latestTask: lifecycle.latestTask,
        recentRecoveryPoint: lifecycle.recentRecoveryPoint,
        runnerOnline: lifecycle.runner.online,
        backupReady: lifecycle.backupReadiness?.canStart,
        backupAvailableBytes: lifecycle.backupReadiness?.availableSpaceBytes,
        storage,
        updates
      });
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const health = useMemo(() => {
    if (loadFailed || !data) {
      return {
        type: "warning" as const,
        title: "暂时无法读取完整状态",
        description: "现有业务数据没有变化。请稍后刷新；若持续出现，可进入“检查系统”查看原因。"
      };
    }
    if (data.latestTask?.errorCode === "MANUAL_REVIEW_REQUIRED") {
      return {
        type: "error" as const,
        title: "系统状态需要检查",
        description: "当前数据状态尚未确认。请勿继续维护，先点击“检查系统”查看下一步。"
      };
    }
    if (data.currentTask) {
      return {
        type: "warning" as const,
        title: "系统正在维护",
        description: "查询仍可使用。请等待当前操作完成，不要重复提交维护操作。"
      };
    }
    if (!data.runnerOnline) {
      return {
        type: "warning" as const,
        title: "系统维护服务未启动",
        description: "现有业务数据仍然安全，但暂时不能创建备份、恢复系统、更新系统或更换存储位置。请进入“检查系统”重新检查。"
      };
    }
    if (data.backupReady === false || data.storage?.backup.status !== "normal") {
      return {
        type: "warning" as const,
        title: "系统备份位置需要处理",
        description: "现有业务数据仍然安全，但可能无法创建新的系统恢复点。请进入“备份与恢复”查看详情。"
      };
    }
    return {
      type: "success" as const,
      title: "系统运行正常",
      description: "备份、恢复和存储维护入口均可使用。"
    };
  }, [data, loadFailed]);

  const latestResult = jobResult(data?.latestTask);
  const dataStorageStatus = storageStatusTag(loadFailed, data?.runnerOnline, data?.storage.data.status);
  const backupStorageStatus = storageStatusTag(loadFailed, data?.runnerOnline, data?.storage.backup.status);

  return (
    <Space direction="vertical" size={16} className="full-width system-management-overview">
      <Alert
        type={health.type}
        showIcon
        message={health.title}
        description={health.description}
        action={<Button onClick={() => void load()} loading={loading}>刷新状态</Button>}
      />

      <Row gutter={[12, 12]}>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small" className="system-management-status-card">
            <Typography.Text type="secondary">最近系统恢复点</Typography.Text>
            <Typography.Title level={5}>{formatTime(data?.recentRecoveryPoint?.verifiedAt)}</Typography.Title>
            <Tag color={data?.recentRecoveryPoint ? "green" : "default"}>
              {data?.recentRecoveryPoint ? "已验证，可用于恢复" : "尚未创建"}
            </Tag>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small" className="system-management-status-card">
            <Typography.Text type="secondary">业务数据</Typography.Text>
            <Typography.Title level={5}>{loadFailed ? "暂时无法读取" : data?.storage.data.displayName ?? "正在读取"}</Typography.Title>
            <Tag color={dataStorageStatus.color}>{dataStorageStatus.label}</Tag>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small" className="system-management-status-card">
            <Typography.Text type="secondary">系统备份</Typography.Text>
            <Typography.Title level={5}>{loadFailed ? "暂时无法读取" : data?.storage.backup.displayName ?? "正在读取"}</Typography.Title>
            <Tag color={backupStorageStatus.color}>{backupStorageStatus.label}</Tag>
            <Typography.Text type="secondary">{formatBytes(data?.backupAvailableBytes)}</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small" className="system-management-status-card">
            <Typography.Text type="secondary">维护服务</Typography.Text>
            <Typography.Title level={5}>{loadFailed ? "暂时无法读取" : data?.runnerOnline ? "正常" : "未启动"}</Typography.Title>
            <Typography.Text type="secondary">
              {loadFailed ? "请稍后刷新状态" : data?.runnerOnline ? "可以执行维护操作" : "现有业务不受影响"}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small" className="system-management-status-card">
            <Typography.Text type="secondary">当前版本</Typography.Text>
            <Typography.Title level={5}>{data?.updates.currentVersion || data?.recentRecoveryPoint?.appVersion || "尚未记录"}</Typography.Title>
            <Typography.Text type="secondary">当前正在运行的系统版本</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small" className="system-management-status-card">
            <Typography.Text type="secondary">最近系统更新</Typography.Text>
            <Typography.Title level={5}>{data?.updates.latestUpdate ? formatTime(data.updates.latestUpdate.createdAt) : "暂无记录"}</Typography.Title>
            <Tag color={jobResult(data?.updates.latestUpdate).color}>{jobResult(data?.updates.latestUpdate).label}</Tag>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small" className="system-management-status-card">
            <Typography.Text type="secondary">最近维护结果</Typography.Text>
            <Typography.Title level={5}>
              {data?.latestTask ? actionLabel[data.latestTask.action] ?? "系统维护" : "暂无记录"}
            </Typography.Title>
            <Tag color={latestResult.color}>{latestResult.label}</Tag>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card size="small" className="system-management-status-card">
            <Typography.Text type="secondary">磁盘空间</Typography.Text>
            <Typography.Title level={5}>{data?.backupReady === false ? "空间不足" : data?.backupReady === true ? "空间充足" : "正在读取"}</Typography.Title>
            <Tag color={data?.backupReady === false ? "red" : data?.backupReady === true ? "green" : "default"}>
              {data?.backupReady === false ? "需要处理" : data?.backupReady === true ? "状态正常" : "等待刷新"}
            </Tag>
          </Card>
        </Col>
      </Row>

      <Card size="small" title="常用维护" className="system-management-actions-card">
        <Row gutter={[12, 12]}>
          <Col xs={24} md={6}>
            <Button block type="primary" onClick={() => onNavigate("backup")}>备份与恢复</Button>
          </Col>
          <Col xs={24} md={6}>
            <Button block onClick={() => onNavigate("updates")}>更新系统</Button>
          </Col>
          <Col xs={24} md={6}>
            <Button block onClick={() => onNavigate("storage")}>更换业务数据保存位置</Button>
          </Col>
          <Col xs={24} md={6}>
            <Button block onClick={() => onNavigate("checks")}>检查系统</Button>
          </Col>
        </Row>
      </Card>

      {data?.latestTask ? (
        <Descriptions size="small" column={{ xs: 1, md: 3 }} title="最近一次维护">
          <Descriptions.Item label="操作">{actionLabel[data.latestTask.action] ?? "系统维护"}</Descriptions.Item>
          <Descriptions.Item label="时间">{formatTime(data.latestTask.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="结果"><Tag color={latestResult.color}>{latestResult.label}</Tag></Descriptions.Item>
        </Descriptions>
      ) : null}
    </Space>
  );
}
