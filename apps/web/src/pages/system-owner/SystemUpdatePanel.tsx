import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
  Upload,
  message
} from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  sampleRoomApi,
  type LifecycleMaintenanceJob,
  type SystemUpdateOverview,
  type SystemUpdatePackage
} from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";

const phaseText: Record<string, string> = {
  preparing: "正在准备",
  checking_package: "正在检查更新包",
  package_ready: "更新包检查完成",
  safety_backup: "正在创建更新前安全备份",
  safety_backup_ready: "更新前安全备份已完成",
  backup_database: "正在保护订单数据",
  backup_files: "正在保护附件和文件",
  save_configuration: "正在保护系统设置",
  verify: "正在检查安全备份",
  preparing_update: "正在准备新版本",
  stopping_service: "正在短暂停止系统",
  completed: "系统更新完成"
};

function packageStatus(item: SystemUpdatePackage) {
  if (item.status === "ready") return <Tag color="green">检查通过，可以更新</Tag>;
  if (item.status === "rejected") return <Tag color="red">无法使用</Tag>;
  return <Tag color="blue">正在检查</Tag>;
}

function jobResult(job?: LifecycleMaintenanceJob) {
  if (!job) return "idle";
  if (job.errorCode === "MANUAL_REVIEW_REQUIRED") return "needs_review";
  if (job.status === "completed") return "completed";
  if (job.status === "failed" || job.status === "cancelled") return "failed";
  return "running";
}

function friendlyError(error: unknown, fallback: string) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    update_package_filename_invalid: "请选择系统供应方提供的正确更新包。当前系统和业务数据没有变化。",
    update_package_size_invalid: "更新包大小不符合要求。当前系统和业务数据没有变化。",
    update_package_required: "请先选择系统更新包。",
    maintenance_service_offline: "系统维护服务未启动，暂时不能更新。当前系统仍可正常使用，请先到“检查系统”重新检查。",
    lifecycle_job_already_active: "系统正在进行其他维护，请等待完成后再更新。",
    lifecycle_manual_review_required: "系统状态需要检查，请勿继续操作。请先到“检查系统”查看建议。",
    update_package_not_ready: "更新包尚未检查完成，请稍候刷新。",
    update_package_incompatible: "这个更新包不适用于当前版本，请选择正确版本。",
    update_package_requires_new_check: "系统版本已经变化，请重新上传并检查更新包。",
    update_reauthentication_failed: "密码确认不正确，请重新输入。",
    update_confirmation_required: "确认文字不一致，请按页面提示完整输入。"
  };
  return messages[code] ?? fallback;
}

export function SystemUpdatePanel({ session }: { session: DevSession; onRestore: () => void }) {
  const [overview, setOverview] = useState<SystemUpdateOverview>();
  const [selected, setSelected] = useState<SystemUpdatePackage>();
  const [progress, setProgress] = useState("正在准备");
  const [safetyBackupReady, setSafetyBackupReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const load = useCallback(async () => {
    try {
      const next = await sampleRoomApi.getSystemUpdateOverview(session);
      setOverview(next);
      const activePackage = next.packages.find((item) => item.id === next.currentTask?.updateArtifactId);
      setSelected((current) => activePackage ?? next.packages.find((item) => item.id === current?.id) ?? next.packages[0]);
      const trackedTask = next.currentTask ?? next.latestUpdate;
      if (trackedTask) {
        const result = await sampleRoomApi.getLifecycleJobEvents(session, trackedTask.id);
        const latest = [...result.events].reverse().find((event) => event.phase);
        setProgress(latest?.phase ? phaseText[latest.phase] ?? "系统正在处理中" : "系统正在处理中");
        setSafetyBackupReady(result.events.some((event) => event.phase === "safety_backup_ready"));
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "系统更新状态加载失败");
    }
  }, [messageApi, session]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!overview?.currentTask || jobResult(overview.currentTask) !== "running") return undefined;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [load, overview?.currentTask]);

  const upload = async (file: File) => {
    if (!/^Deploy-V\d+\.\d+\.\d+\.zip$/i.test(file.name)) {
      messageApi.error("请选择名称为 Deploy-V版本号.zip 的系统更新包。");
      return;
    }
    setUploading(true);
    try {
      const result = await sampleRoomApi.uploadSystemUpdatePackage(session, file);
      setSelected(result.updatePackage);
      messageApi.success(result.duplicate ? "这个更新包已经检查过。" : "更新包已上传，系统正在自动检查。");
      await load();
    } catch (error) {
      messageApi.error(friendlyError(error, "更新包上传失败。当前系统没有变化，请重新选择文件。"));
    } finally {
      setUploading(false);
    }
  };

  const currentResult = jobResult(overview?.currentTask ?? overview?.latestUpdate);
  const step = overview?.currentTask ? 3 : selected?.status === "ready" ? 2 : selected ? 1 : 0;
  const history = useMemo(() => overview?.packages ?? [], [overview?.packages]);

  return (
    <Space direction="vertical" size={16} className="full-width">
      {contextHolder}
      <Card size="small" title="系统更新">
        <Space direction="vertical" size={14} className="full-width">
          <Alert type="warning" showIcon message="当前版本暂未开放自动更新" description="请先创建并验证系统恢复点，再由维护人员使用正式部署包更新。现有更新记录仍可查看。" />
          <Typography.Paragraph className="no-margin">
            上传系统提供的更新包后，系统会先检查影响并自动创建安全备份；检查通过且由你确认后才会更新。
          </Typography.Paragraph>
          <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
            <Descriptions.Item label="当前版本">{overview?.currentVersion ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="维护服务">
              <Tag color={overview?.maintenanceServiceOnline ? "green" : "red"}>
                {overview?.maintenanceServiceOnline ? "正常" : "未启动"}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
          <Steps
            size="small"
            current={step}
            responsive
            items={[{ title: "上传系统更新包" }, { title: "系统检查" }, { title: "确认更新" }, { title: "自动更新" }]}
          />
          {!overview?.maintenanceServiceOnline ? (
            <Alert type="warning" showIcon message="系统维护服务未启动" description="当前系统仍可正常使用，但暂时不能更新。请先在“检查系统”中重新检查。" />
          ) : null}
          {overview?.maintenanceInProgress && !overview.currentTask ? (
            <Alert type="warning" showIcon message="系统正在进行其他维护" description="请等待当前维护完成后再上传或开始更新。" />
          ) : null}
          <Upload.Dragger
            accept=".zip"
            disabled
            showUploadList={false}
            beforeUpload={(file) => {
              void upload(file as File);
              return Upload.LIST_IGNORE;
            }}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">点击选择，或将系统更新包拖到这里</p>
            <p className="ant-upload-hint">只接受由系统供应方提供、名称类似 Deploy-V1.2.0.zip 的文件</p>
          </Upload.Dragger>
        </Space>
      </Card>

      {selected ? (
        <Card size="small" title="更新检查结果" extra={packageStatus(selected)}>
          <Space direction="vertical" size={14} className="full-width">
            {selected.failure ? (
              <Alert
                type="error"
                showIcon
                message="更新包无法使用"
                description={<Space direction="vertical" size={2}>
                  <span>发生了什么：{selected.failure.whatHappened}</span>
                  <span>当前数据：{selected.failure.dataSafety}</span>
                  <span>下一步：{selected.failure.nextStep}</span>
                </Space>}
              />
            ) : null}
            <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered>
              <Descriptions.Item label="当前版本">{overview?.currentVersion ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="新版本">{selected.displayVersion}</Descriptions.Item>
              <Descriptions.Item label="更新风险">{selected.riskLevel}</Descriptions.Item>
              <Descriptions.Item label="预计暂停时间">{selected.estimatedDowntime}</Descriptions.Item>
              <Descriptions.Item label="订单数据">{selected.databaseImpact}</Descriptions.Item>
              <Descriptions.Item label="附件和文件">{selected.attachmentImpact}</Descriptions.Item>
              <Descriptions.Item label="系统设置">{selected.configurationImpact}</Descriptions.Item>
              <Descriptions.Item label="自动保护">更新前创建系统恢复点</Descriptions.Item>
            </Descriptions>
            <div>
              <Typography.Text strong>更新内容</Typography.Text>
              <ul>{selected.changes.map((change) => <li key={change}>{change}</li>)}</ul>
            </div>
            <Alert type="info" showIcon message="如果更新未完成怎么办？" description="页面会说明停止位置和当前数据状态，并提供“恢复系统”入口，使用更新前安全备份恢复。" />
            <Button type="primary" disabled>自动更新暂未开放</Button>
          </Space>
        </Card>
      ) : null}

      {overview?.currentTask || currentResult === "failed" || currentResult === "needs_review" || currentResult === "completed" ? (
        <Card size="small" title="更新状态">
          <Space direction="vertical" size={12} className="full-width">
            {currentResult === "running" ? <Alert type="info" showIcon message={progress} description="系统仍在处理中，请勿关闭服务器或重复操作。页面刷新后仍可继续查看。" /> : null}
            {currentResult === "completed" ? <Alert type="success" showIcon message="系统更新完成" description="新版本已经启动，系统检查已通过。" /> : null}
            {currentResult === "failed" ? <Alert type="error" showIcon message="系统更新未完成" description={<Space direction="vertical" size={2}><span>停止位置：{progress}。</span><span>当前数据：{safetyBackupReady ? "更新前安全备份已创建并保留。" : "系统没有进入版本切换，现有数据仍然安全。"}</span><span>下一步：停止继续操作并联系维护人员检查；如需恢复，使用正式部署包和已验证恢复点执行人工冷恢复。</span></Space>} /> : null}
            {currentResult === "needs_review" ? <Alert type="error" showIcon message="系统状态需要检查，请勿继续操作" description={<Space direction="vertical" size={2}><span>停止位置：{progress}。</span><span>当前数据：更新前安全备份已保留，但系统无法确认当前状态。</span><span>下一步：停止继续操作并联系维护人员执行检查或人工冷恢复。</span></Space>} /> : null}
            {(overview?.currentTask ?? overview?.latestUpdate)?.errorCode ? (
              <Collapse items={[{ key: "technical", label: "查看技术详情", children: <Typography.Text code>{(overview?.currentTask ?? overview?.latestUpdate)?.errorCode}</Typography.Text> }]} />
            ) : null}
          </Space>
        </Card>
      ) : null}

      <Card size="small" title="已检查的更新包">
        <Table<SystemUpdatePackage>
          size="small"
          rowKey="id"
          pagination={{ pageSize: 5 }}
          scroll={{ x: 620 }}
          dataSource={history}
          onRow={(record) => ({ onClick: () => setSelected(record) })}
          columns={[
            { title: "版本", dataIndex: "displayVersion", width: 120 },
            { title: "更新说明", dataIndex: "title", ellipsis: true },
            { title: "风险", dataIndex: "riskLevel", width: 80 },
            { title: "状态", width: 170, render: (_, record) => packageStatus(record) },
            { title: "上传时间", dataIndex: "discoveredAt", width: 170, render: (value: string) => new Date(value).toLocaleString() }
          ]}
        />
      </Card>

      <Card size="small" title="最近更新">
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 5 }}
          dataSource={overview?.updateHistory ?? []}
          columns={[
            { title: "版本", dataIndex: "displayVersion", width: 120 },
            { title: "开始时间", dataIndex: "startedAt", render: (value: string) => new Date(value).toLocaleString() },
            { title: "完成时间", dataIndex: "completedAt", render: (value?: string) => value ? new Date(value).toLocaleString() : "-" },
            { title: "结果", dataIndex: "status", width: 150, render: (value: string) => value === "completed" ? <Tag color="green">成功</Tag> : value === "needs_review" ? <Tag color="red">系统状态需要检查</Tag> : value === "failed" ? <Tag color="red">失败</Tag> : <Tag color="blue">进行中</Tag> }
          ]}
        />
      </Card>

    </Space>
  );
}
