import { Alert, Button, Card, Descriptions, Form, Input, Modal, Space, Table, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { sampleRoomApi, type BackupReadiness, type LifecycleMaintenanceJob, type RecoveryPointSummary } from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";

function status(point: RecoveryPointSummary) {
  if (point.status === "verified") return <Tag color="green">已验证，可用于人工恢复</Tag>;
  if (point.status === "failed") return <Tag color="red">创建失败</Tag>;
  return <Tag color="blue">创建中</Tag>;
}
function bytes(value: string) { const n = Number(value); return Number.isFinite(n) ? `${(n / 1024 / 1024).toFixed(1)} MB` : "-"; }
const phaseLabel: Record<string, string> = { preparing: "正在准备", backup_database: "正在备份数据库", backup_files: "正在备份附件和文件", save_configuration: "正在保存系统配置", verify: "正在检查备份完整性", completed: "系统恢复点创建完成" };

type RecoveryPointCrypto = {
  randomUUID?: () => string;
  getRandomValues?: (values: Uint32Array) => Uint32Array;
};

export function createRecoveryPointIdempotencyKey(
  cryptoApi: RecoveryPointCrypto | undefined = globalThis.crypto
) {
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  const randomWords = new Uint32Array(4);
  if (typeof cryptoApi?.getRandomValues === "function") {
    cryptoApi.getRandomValues(randomWords);
  } else {
    for (let index = 0; index < randomWords.length; index += 1) {
      randomWords[index] = Math.floor(Math.random() * 0x1_0000_0000);
    }
  }
  const entropy = Array.from(randomWords, (word) => word.toString(16).padStart(8, "0")).join("");
  return `recovery-point-${Date.now().toString(36)}-${entropy}`;
}

export function RecoveryPointPanel({ session }: { session: DevSession }) {
  const [points, setPoints] = useState<RecoveryPointSummary[]>([]); const [current, setCurrent] = useState<string>(); const [progressText, setProgressText] = useState<string>(); const [runnerOnline, setRunnerOnline] = useState(false); const [readiness, setReadiness] = useState<BackupReadiness>(); const [open, setOpen] = useState(false); const [loading, setLoading] = useState(false); const [form] = Form.useForm<{ reason: string }>(); const [messageApi, holder] = message.useMessage();
  const load = useCallback(async () => { const result = await sampleRoomApi.getRecoveryPointOverview(session); setPoints(result.recoveryPoints); setCurrent(result.currentTask?.status); setRunnerOnline(result.runner.online); setReadiness(result.backupReadiness); if (result.currentTask) { const events = await sampleRoomApi.getLifecycleJobEvents(session, result.currentTask.id); const latest = events.events.at(-1); setProgressText(latest?.phase ? phaseLabel[latest.phase] ?? "正在处理" : "正在处理"); } else { setProgressText(undefined); } }, [session]);
  const [latestTask, setLatestTask] = useState<LifecycleMaintenanceJob>();
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 5000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { let active = true; const refreshLatest = async () => { const result = await sampleRoomApi.getRecoveryPointOverview(session); if (active) setLatestTask(result.latestTask); }; void refreshLatest(); const timer = window.setInterval(() => void refreshLatest(), 5000); return () => { active = false; window.clearInterval(timer); }; }, [session]);
  const create = async () => { const values = await form.validateFields(); setLoading(true); try { await sampleRoomApi.createRecoveryPoint(session, { requestReason: values.reason, idempotencyKey: createRecoveryPointIdempotencyKey() }); setOpen(false); messageApi.success("系统恢复点创建任务已开始，可刷新页面继续查看进度。"); await load(); } catch (error) { messageApi.error(error instanceof Error ? error.message : "无法创建系统恢复点，请确认系统维护服务已启动。"); } finally { setLoading(false); } };
  return <Card title="备份与恢复" extra={<Button onClick={() => void load()}>刷新状态</Button>}>
    {holder}<Space direction="vertical" className="full-width" size={16}>
      {latestTask?.errorCode === "RESTORE_INTERRUPTED_RETURNED_TO_PRE_RESTORE" ? <Alert type="warning" showIcon message="系统恢复未完成" description="当前状态：已恢复到恢复前状态。建议：重新检查系统恢复点后再次尝试。" /> : null}
      {latestTask?.errorCode === "MANUAL_REVIEW_REQUIRED" ? <Alert type="error" showIcon message="系统状态需要检查，请勿继续操作" description="当前数据状态无法自动确认。恢复前安全备份仍保留；请先执行检查系统，确认结果后再进行恢复。" /> : null}
      <Alert type="info" showIcon message="系统恢复点包含数据库、附件、应用运行数据和脱敏配置，可与同版本部署包配合执行人工冷恢复。" />
      <Alert type="warning" showIcon message="当前版本暂未开放自动恢复" description="需要恢复时，请保留已验证的系统恢复点，并联系维护人员使用对应版本的正式部署包在隔离环境执行人工冷恢复。" />
      <Alert type={current ? "warning" : runnerOnline ? "info" : "error"} showIcon message={current ? progressText ?? "系统正在维护" : runnerOnline ? "系统备份功能已就绪" : "系统维护服务未启动"} description={current ? "维护期间暂时不能新增或修改内容，查询仍可使用。刷新页面后仍可继续查看进度。" : runnerOnline ? "可以创建并验证系统恢复点；自动恢复暂未开放。" : "现有数据仍然安全。请进入“检查系统”重新检查维护服务。"} />
      <Descriptions bordered size="small"><Descriptions.Item label="最近一次系统恢复点">{points[0] ? new Date(points[0].createdAt).toLocaleString() : "暂无"}</Descriptions.Item><Descriptions.Item label="当前状态">{points[0] ? status(points[0]) : "暂无"}</Descriptions.Item><Descriptions.Item label="预计备份大小">{readiness ? bytes(readiness.estimatedSizeBytes) : "正在计算"}</Descriptions.Item><Descriptions.Item label="备份盘可用空间">{readiness ? bytes(readiness.availableSpaceBytes) : "正在读取"}</Descriptions.Item></Descriptions>
      <Button type="primary" disabled={Boolean(current) || !runnerOnline || readiness?.canStart !== true} onClick={() => { form.setFieldsValue({ reason: "手动安全备份" }); setOpen(true); }}>立即创建系统恢复点</Button>
      <Table tableLayout="fixed" size="small" rowKey="id" pagination={false} dataSource={points} columns={[{ title: "创建时间", dataIndex: "createdAt", width: 142, render: (v) => new Date(v).toLocaleString() }, { title: "创建原因", dataIndex: "requestReason", ellipsis: true }, { title: "系统版本", dataIndex: "appVersion", width: 82, responsive: ["lg"] }, { title: "大小", dataIndex: "totalSizeBytes", width: 82, responsive: ["lg"], render: bytes }, { title: "状态", width: 152, render: (_, point: RecoveryPointSummary) => status(point) }, { title: "创建人", width: 88, responsive: ["lg"], ellipsis: true, render: (_, point: RecoveryPointSummary) => point.createdBy.actorName }, { title: "操作", width: 142, render: () => <Button size="small" disabled>自动恢复暂未开放</Button> }]} />
      <Modal open={open} title="创建系统恢复点" okText="确认创建" cancelText="取消" confirmLoading={loading} onOk={() => void create()} onCancel={() => setOpen(false)}><Typography.Paragraph>系统将备份数据库、订单附件和文件，并保存系统配置和版本信息。创建期间会短暂暂停新增和修改操作。</Typography.Paragraph><Form form={form} layout="vertical"><Form.Item name="reason" label="创建原因" rules={[{ required: true, message: "请填写创建原因" }]}><Input /></Form.Item></Form></Modal>
    </Space></Card>;
}
