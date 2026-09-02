import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Empty,
  Form,
  Input,
  Modal,
  QRCode,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  sampleRoomApi,
  type IdentityQrIssueResult,
  type IdentityQrTokenSummary,
  type WorkerIdentityManagementItem,
  type WorkerIdentityProfileSummary
} from "../../api/sampleRoomApi";
import { request } from "../../api/request";
import type { DevSession } from "../../app/DevSessionContext";
import { BossStatsStrip } from "../boss/BossStatsStrip";

type Props = { session: DevSession };
type WorkerType = "cutting" | "sewing" | "qc_delivery";
type WorkerEditValues = { displayName: string; phoneNumber: string; password?: string };
type RegistrationChannel = "public" | "lan";
type RegistrationIssueCache = Partial<Record<WorkerType, IdentityQrIssueResult>>;

const registrationQrCacheKey = "sampleRoomWorkerRegistrationQrCacheV1";

const stageOptions: Array<{ label: string; value: WorkerType }> = [
  { label: "裁剪", value: "cutting" },
  { label: "缝制", value: "sewing" },
  { label: "组检/出库", value: "qc_delivery" }
];
const stageLabels = Object.fromEntries(
  stageOptions.map((option) => [option.value, option.label])
) as Record<WorkerType, string>;

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "-";
}

function isRegistrationTokenActive(token: IdentityQrTokenSummary) {
  return !token.usedAt && !token.revokedAt && Date.parse(token.expiresAt) > Date.now();
}

function loadRegistrationIssueCache(): RegistrationIssueCache {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(registrationQrCacheKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RegistrationIssueCache;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistRegistrationIssueCache(cache: RegistrationIssueCache) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(registrationQrCacheKey, JSON.stringify(cache));
  } catch {
    // QR display caching is a convenience only; server authorization remains authoritative.
  }
}

function workerStage(worker: WorkerIdentityManagementItem) {
  return worker.currentWorkerProfile?.workerType ?? worker.workerProfiles[0]?.workerType;
}

function matchesWorker(worker: WorkerIdentityManagementItem, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [worker.account.displayName, worker.account.phoneNumber]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .includes(normalized);
}

export function WorkerAccountManagementPanel({ session }: Props) {
  const [workers, setWorkers] = useState<WorkerIdentityManagementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [stageQueries, setStageQueries] = useState<Record<WorkerType, string>>({
    cutting: "",
    sewing: "",
    qc_delivery: ""
  });
  const [stoppedQueries, setStoppedQueries] = useState<Record<WorkerType, string>>({
    cutting: "",
    sewing: "",
    qc_delivery: ""
  });
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registrationStage, setRegistrationStage] = useState<WorkerType>("cutting");
  const [registrationIssues, setRegistrationIssues] = useState<RegistrationIssueCache>(
    () => loadRegistrationIssueCache()
  );
  const [registrationTokens, setRegistrationTokens] = useState<IdentityQrTokenSummary[]>([]);
  const [registrationTokenLoading, setRegistrationTokenLoading] = useState(false);
  const [registrationChannel, setRegistrationChannel] = useState<RegistrationChannel>("public");
  const [registrationGenerating, setRegistrationGenerating] = useState(false);
  const [changingWorker, setChangingWorker] = useState<WorkerIdentityManagementItem>();
  const [nextStage, setNextStage] = useState<WorkerType>("cutting");
  const [stageChanging, setStageChanging] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [historyWorker, setHistoryWorker] = useState<WorkerIdentityManagementItem>();
  const [editingWorker, setEditingWorker] = useState<WorkerIdentityManagementItem>();
  const [editSaving, setEditSaving] = useState(false);
  const [editForm] = Form.useForm<WorkerEditValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();

  const loadWorkers = async () => {
    setLoading(true);
    try {
      const result = await sampleRoomApi.listWorkerIdentityAccounts(session);
      setWorkers(result.workers);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载生产员工失败");
    } finally {
      setLoading(false);
    }
  };

  const loadRegistrationTokens = async (showError = true) => {
    setRegistrationTokenLoading(true);
    try {
      const result = await request<{ tokens: IdentityQrTokenSummary[] }>(
        session,
        "/api/workers/identity-tokens"
      );
      setRegistrationTokens(result.tokens);
      setRegistrationIssues((current) => {
        const next: RegistrationIssueCache = {};
        for (const stage of stageOptions) {
          const cached = current[stage.value];
          if (!cached) continue;
          const activeToken = result.tokens.find(
            (token) => token.id === cached.token.id &&
              token.workerType === stage.value &&
              isRegistrationTokenActive(token)
          );
          if (activeToken) {
            next[stage.value] = { ...cached, token: activeToken };
          }
        }
        persistRegistrationIssueCache(next);
        return next;
      });
    } catch (error) {
      if (showError) {
        messageApi.error(error instanceof Error ? error.message : "读取员工注册码失败");
      }
    } finally {
      setRegistrationTokenLoading(false);
    }
  };

  useEffect(() => { void loadWorkers(); }, []);

  const workingWorkers = workers.filter(
    (worker) => worker.account.status === "active" && Boolean(worker.currentWorkerProfile)
  );
  const stoppedWorkers = workers.filter(
    (worker) => worker.account.status === "suspended"
  );
  const workerGroups = stageOptions.map((stage) => ({
    ...stage,
    workers: workingWorkers.filter(
      (worker) => worker.currentWorkerProfile?.workerType === stage.value &&
        matchesWorker(worker, stageQueries[stage.value])
    )
  }));
  const stoppedGroups = stageOptions.map((stage) => ({
    ...stage,
    workers: stoppedWorkers.filter(
      (worker) => workerStage(worker) === stage.value && matchesWorker(worker, stoppedQueries[stage.value])
    ),
    profiles: workers.flatMap((worker) => worker.workerProfiles
      .filter((profile) => profile.status === "inactive" && profile.workerType === stage.value && matchesWorker(worker, stoppedQueries[stage.value]))
      .map((profile) => ({ worker, profile })))
  }));

  const stats = useMemo(() => [
    { label: "正常工作", value: workingWorkers.length, tone: "blue", featured: true },
    ...stageOptions.map((stage) => ({
      label: stage.label,
      value: workingWorkers.filter((worker) => worker.currentWorkerProfile?.workerType === stage.value).length,
      tone: stage.value === "cutting" ? "blue" : stage.value === "sewing" ? "green" : "purple"
    })),
    { label: "停用", value: stoppedWorkers.length, tone: "gray" }
  ], [workers]);

  const activeRegistrationToken = useMemo(
    () => registrationTokens.find(
      (token) => token.workerType === registrationStage && isRegistrationTokenActive(token)
    ),
    [registrationStage, registrationTokens]
  );

  const cachedRegistrationIssue = registrationIssues[registrationStage];
  const visibleRegistrationIssue = cachedRegistrationIssue?.token.id === activeRegistrationToken?.id
    ? cachedRegistrationIssue
    : undefined;
  const registrationUrl = visibleRegistrationIssue?.registrationUrls?.[registrationChannel] ?? null;

  const rememberRegistrationIssue = (stage: WorkerType, issue: IdentityQrIssueResult) => {
    setRegistrationIssues((current) => {
      const next = { ...current, [stage]: issue };
      persistRegistrationIssueCache(next);
      return next;
    });
  };

  const forgetRegistrationIssue = (stage: WorkerType, tokenId: string) => {
    setRegistrationIssues((current) => {
      if (current[stage]?.token.id !== tokenId) return current;
      const next = { ...current };
      delete next[stage];
      persistRegistrationIssueCache(next);
      return next;
    });
  };

  const generateRegistrationQrNow = async () => {
    const stage = registrationStage;
    setRegistrationGenerating(true);
    try {
      const issued = await sampleRoomApi.createWorkerRegistrationToken(session, stage);
      rememberRegistrationIssue(stage, issued);
      await loadRegistrationTokens(false);
      messageApi.success(`${stageLabels[stage]}员工注册二维码已生成`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "生成注册二维码失败");
    } finally {
      setRegistrationGenerating(false);
    }
  };

  const generateRegistrationQr = () => {
    if (!activeRegistrationToken) {
      void generateRegistrationQrNow();
      return;
    }
    modal.confirm({
      title: "重新生成注册码？",
      content: `当前${stageLabels[registrationStage]}二维码会立即失效，新二维码将长期有效，直到手动作废。`,
      okText: "重新生成",
      cancelText: "取消",
      onOk: generateRegistrationQrNow
    });
  };

  const revokeRegistrationQr = async () => {
    if (!activeRegistrationToken) return;
    const stage = registrationStage;
    const tokenId = activeRegistrationToken.id;
    try {
      await sampleRoomApi.revokeWorkerIdentityToken(session, tokenId);
      forgetRegistrationIssue(stage, tokenId);
      await loadRegistrationTokens(false);
      messageApi.success("员工注册二维码已作废");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "作废二维码失败");
    }
  };

  const confirmRevokeRegistrationQr = () => {
    if (!activeRegistrationToken) return;
    modal.confirm({
      title: "作废当前二维码？",
      content: "作废后，已经注册的员工账号不受影响；此二维码将不能再注册新员工。",
      okText: "确认作废",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: revokeRegistrationQr
    });
  };

  const copyRegistrationUrl = async () => {
    if (!registrationUrl) return;
    try {
      await navigator.clipboard.writeText(registrationUrl);
      messageApi.success("注册链接已复制");
    } catch {
      messageApi.error("复制失败，请直接打开注册页后复制地址");
    }
  };

  const openRegistrationModal = () => {
    setRegistrationOpen(true);
    void loadRegistrationTokens();
  };

  const closeRegistrationModal = () => {
    setRegistrationOpen(false);
  };

  const openEdit = (worker: WorkerIdentityManagementItem) => {
    setEditingWorker(worker);
    editForm.resetFields();
    editForm.setFieldsValue({
      displayName: worker.account.displayName,
      phoneNumber: worker.account.phoneNumber ?? ""
    });
  };

  const saveEdit = async () => {
    if (!editingWorker) return;
    const values = await editForm.validateFields();
    setEditSaving(true);
    try {
      await sampleRoomApi.updateWorkerIdentityAccount(session, editingWorker.account.id, {
        displayName: values.displayName,
        phoneNumber: values.phoneNumber,
        ...(values.password ? { password: values.password } : {})
      });
      messageApi.success(values.password ? "员工资料已更新，新密码将在下次登录生效" : "员工资料已更新");
      setEditingWorker(undefined);
      await loadWorkers();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存员工资料失败");
    } finally {
      setEditSaving(false);
    }
  };

  const setWorkerStatus = (worker: WorkerIdentityManagementItem, status: "active" | "suspended") => {
    modal.confirm({
      title: status === "suspended" ? `停用 ${worker.account.displayName}` : `恢复 ${worker.account.displayName}`,
      content: status === "suspended"
        ? "停用后该账号立即不能登录或执行扫码，岗位履历和历史绩效不会删除。"
        : "恢复后该账号可以重新登录；生产权限仍以其当前 WorkerProfile 为准。",
      okText: status === "suspended" ? "确认停用" : "确认恢复",
      ...(status === "suspended" ? { okButtonProps: { danger: true } } : {}),
      cancelText: "取消",
      onOk: async () => {
        await sampleRoomApi.updateWorkerIdentityAccount(session, worker.account.id, { status });
        messageApi.success(status === "suspended" ? "员工已停用" : "员工已恢复");
        await loadWorkers();
      }
    });
  };

  const openRoleChange = (worker: WorkerIdentityManagementItem) => {
    const current = worker.currentWorkerProfile?.workerType;
    setNextStage(stageOptions.find((option) => option.value !== current)?.value ?? "cutting");
    setChangingWorker(worker);
  };

  const changeStage = async () => {
    if (!changingWorker) return;
    setStageChanging(true);
    try {
      await sampleRoomApi.changeWorkerIdentityStage(session, changingWorker.account.id, nextStage);
      messageApi.success(`已切换到${stageLabels[nextStage]}，历史岗位记录保留`);
      setChangingWorker(undefined);
      await loadWorkers();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "岗位变更失败");
    } finally {
      setStageChanging(false);
    }
  };

  const toggleSelected = (accountId: string, checked: boolean) => {
    setSelectedAccountIds((current) => checked
      ? [...new Set([...current, accountId])]
      : current.filter((id) => id !== accountId));
  };

  const archiveSelected = () => {
    modal.confirm({
      title: `删除所选 ${selectedAccountIds.length} 个员工账号`,
      content: "账号会从名单中移除并立即不能登录，但账号 ID、岗位 ID 和历史工作记录永久保留。以后使用原手机号重新注册时会恢复同一账号和历史记录。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        await sampleRoomApi.archiveWorkerIdentityAccounts(session, selectedAccountIds);
        setSelectedAccountIds([]);
        messageApi.success("员工账号已归档，历史记录已保留");
        await loadWorkers();
      }
    });
  };

  const restoreProfile = (worker: WorkerIdentityManagementItem, profile: WorkerIdentityProfileSummary) => {
    modal.confirm({
      title: `恢复 ${profile.workerTypeLabel} 岗位`,
      content: `将 ${worker.account.displayName} 恢复到该历史岗位。当前岗位会先结束，历史订单和绩效归属不会改变。`,
      okText: "确认恢复",
      cancelText: "取消",
      onOk: async () => {
        await sampleRoomApi.restoreWorkerIdentityProfile(session, worker.account.id, profile.id);
        messageApi.success("历史岗位已恢复");
        setHistoryWorker(undefined);
        await loadWorkers();
      }
    });
  };

  const historyColumns = (worker: WorkerIdentityManagementItem) => [
    { title: "工序", dataIndex: "workerTypeLabel" },
    { title: "生效时间", dataIndex: "effectiveAt", render: formatTime },
    { title: "结束时间", dataIndex: "endedAt", render: formatTime },
    {
      title: "状态",
      dataIndex: "status",
      render: (status: WorkerIdentityProfileSummary["status"]) => (
        <Tag color={status === "active" ? "green" : status === "inactive" ? "blue" : "default"}>
          {status === "active" ? "当前" : status === "inactive" ? "历史" : "已结束"}
        </Tag>
      )
    },
    {
      title: "操作",
      width: 110,
      render: (_: unknown, profile: WorkerIdentityProfileSummary) => (
        <Button
          size="small"
          disabled={profile.status !== "inactive" || worker.account.status !== "active"}
          onClick={() => restoreProfile(worker, profile)}
        >
          恢复岗位
        </Button>
      )
    }
  ];

  const renderWorkerRow = (worker: WorkerIdentityManagementItem, stopped = false) => (
    <div className="worker-account-row" key={worker.account.id}>
      <div className="worker-account-primary">
        <Checkbox checked={selectedAccountIds.includes(worker.account.id)} onChange={(event) => toggleSelected(worker.account.id, event.target.checked)} />
        <Typography.Text strong>{worker.account.displayName}</Typography.Text>
        <Tag color={stopped ? "default" : "green"}>{stopped ? "已停用" : "正常"}</Tag>
      </div>
      <Space size={6} wrap className="worker-account-actions">
        <Button size="small" onClick={() => openEdit(worker)}>编辑</Button>
        {!stopped ? (
          <>
            <Button size="small" onClick={() => openRoleChange(worker)}>岗位变更</Button>
            <Button size="small" onClick={() => setHistoryWorker(worker)}>岗位履历</Button>
            <Button size="small" danger onClick={() => setWorkerStatus(worker, "suspended")}>停用</Button>
          </>
        ) : (
          <>
            <Button size="small" onClick={() => setHistoryWorker(worker)}>岗位履历</Button>
            <Button size="small" type="primary" onClick={() => setWorkerStatus(worker, "active")}>恢复</Button>
          </>
        )}
      </Space>
    </div>
  );

  const renderHistoricalProfileRow = (worker: WorkerIdentityManagementItem, profile: WorkerIdentityProfileSummary) => (
    <div className="worker-account-row" key={profile.id}>
      <div className="worker-account-primary">
        <Checkbox checked={selectedAccountIds.includes(worker.account.id)} onChange={(event) => toggleSelected(worker.account.id, event.target.checked)} />
        <Typography.Text strong>{worker.account.displayName}</Typography.Text>
        <Tag>历史岗位</Tag>
      </div>
      <Button size="small" disabled={worker.account.status !== "active"} onClick={() => restoreProfile(worker, profile)}>恢复此岗位</Button>
    </div>
  );

  const renderStageGroup = (
    group: {
      label: string;
      value: WorkerType;
      workers: WorkerIdentityManagementItem[];
      profiles?: Array<{ worker: WorkerIdentityManagementItem; profile: WorkerIdentityProfileSummary }>;
    },
    stopped = false
  ) => (
    <div className="worker-stage-group-body">
      <Input.Search
        allowClear
        size="small"
        placeholder={`搜索${group.label}员工姓名`}
        value={(stopped ? stoppedQueries : stageQueries)[group.value]}
        onChange={(event) => {
          const setter = stopped ? setStoppedQueries : setStageQueries;
          setter((current) => ({ ...current, [group.value]: event.target.value }));
        }}
        className="worker-stage-search"
      />
      {group.workers.length
        ? group.workers.map((worker) => renderWorkerRow(worker, stopped))
        : null}
      {stopped && group.profiles
        ? group.profiles.map(({ worker, profile }) => renderHistoricalProfileRow(worker, profile))
        : null}
      {group.workers.length === 0 && (!stopped || !group.profiles || group.profiles.length === 0)
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`暂无${group.label}员工`} />
        : null}
    </div>
  );

  return (
    <Space direction="vertical" size={12} className="full-width worker-account-management">
      {contextHolder}
      {modalContextHolder}
      <Card
        className="section-card"
        title="生产员工管理"
        extra={<Button onClick={() => void loadWorkers()} loading={loading}>刷新</Button>}
      >
        <Space direction="vertical" size={12} className="full-width">
          <BossStatsStrip
            scope="生产员工"
            title="员工统计"
            helper="在职名单按工序归类；账号资料和岗位履历仅在需要时查看。"
            ariaLabel="生产员工统计"
            items={stats}
          />
          <Space wrap>
            <Button type="primary" onClick={openRegistrationModal}>员工注册二维码</Button>
            <Button danger disabled={selectedAccountIds.length === 0} onClick={archiveSelected}>删除所选账号（{selectedAccountIds.length}）</Button>
          </Space>
        </Space>
      </Card>

      <Collapse
        className="worker-stage-collapse"
        items={workerGroups.map((group) => ({
          key: group.value,
          label: `${group.label}（${workingWorkers.filter((worker) => worker.currentWorkerProfile?.workerType === group.value).length}）`,
          children: renderStageGroup(group)
        }))}
      />

      <Collapse
        className="worker-stopped-collapse"
        items={[{
          key: "stopped",
          label: `停用（账号 ${stoppedWorkers.length} / 历史岗位 ${workers.reduce((count, worker) => count + worker.workerProfiles.filter((profile) => profile.status === "inactive").length, 0)}）`,
          children: (
            <Space direction="vertical" size={10} className="full-width">
              <Collapse
                className="worker-stopped-stage-collapse"
                items={stoppedGroups.map((group) => ({
                  key: group.value,
                  label: `${group.label}（${group.workers.length + group.profiles.length}）`,
                  children: renderStageGroup(group, true)
                }))}
              />
            </Space>
          )
        }]}
      />

      <Modal
        title="编辑生产员工"
        open={Boolean(editingWorker)}
        onCancel={() => setEditingWorker(undefined)}
        onOk={() => void saveEdit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={editSaving}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" requiredMark={false}>
          <Form.Item label="员工姓名" name="displayName" rules={[{ required: true, message: "请输入员工姓名" }]}>
            <Input placeholder="请输入员工姓名" />
          </Form.Item>
          <Form.Item label="登录账号" name="phoneNumber" rules={[{ required: true, message: "请输入登录账号" }]}>
            <Input placeholder="Worker 使用手机号作为登录账号" autoComplete="username" />
          </Form.Item>
          <Form.Item
            label="重置密码"
            name="password"
            extra="留空表示不修改。填写后员工下次登录需要修改为自用密码。"
            rules={[{ min: 8, message: "密码至少 8 位" }]}
          >
            <Input.Password placeholder="留空表示不修改" autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="员工注册二维码"
        open={registrationOpen}
        onCancel={closeRegistrationModal}
        footer={<Button onClick={closeRegistrationModal}>关闭</Button>}
      >
        <Space direction="vertical" size={14} className="full-width">
          <Space size={12} wrap style={{ width: "100%", alignItems: "flex-start" }}>
            <Space direction="vertical" size={6} style={{ flex: 1, minWidth: 180 }}>
              <Typography.Text type="secondary">初始工序</Typography.Text>
              <Select
                value={registrationStage}
                onChange={setRegistrationStage}
                options={stageOptions}
                style={{ width: "100%" }}
              />
            </Space>
            <Space direction="vertical" size={6} style={{ flex: 1, minWidth: 180 }}>
              <Typography.Text type="secondary">二维码通道</Typography.Text>
              <Select<RegistrationChannel>
                value={registrationChannel}
                onChange={setRegistrationChannel}
                options={[{ value: "public", label: "公网注册链接" }, { value: "lan", label: "局域网注册链接" }]}
                style={{ width: "100%" }}
              />
            </Space>
          </Space>

          {registrationTokenLoading && registrationTokens.length === 0 ? (
            <Typography.Text type="secondary">正在读取注册码…</Typography.Text>
          ) : activeRegistrationToken ? (
            <div style={{ border: "1px solid #e1e8f2", borderRadius: 10, background: "#f8fafc", padding: 18 }}>
              <Space direction="vertical" size={10} align="center" className="full-width">
                <Space size={6} wrap>
                  <Tag color="blue">{stageLabels[registrationStage]}</Tag>
                  <Tag color="green">长期有效</Tag>
                </Space>

                {visibleRegistrationIssue && registrationUrl ? (
                  <QRCode value={registrationUrl} size={196} />
                ) : null}

                <Typography.Text strong>{stageLabels[registrationStage]}员工注册码</Typography.Text>

                {visibleRegistrationIssue ? (
                  registrationUrl ? (
                    <>
                      <Typography.Text type="secondary">可重复注册，直到手动作废。</Typography.Text>
                      <Space size={8} wrap>
                        <Button size="small" onClick={() => void copyRegistrationUrl()}>复制链接</Button>
                        <Button size="small" href={registrationUrl} target="_blank" rel="noreferrer">打开注册页</Button>
                      </Space>
                    </>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message={`尚未配置${registrationChannel === "public" ? "公网 Web" : "局域网 Web"}基础地址，请由 System Owner 先设置。`}
                    />
                  )
                ) : (
                  <Alert
                    type="info"
                    showIcon
                    message="当前注册码仍然有效"
                    description="这枚码生成于本次升级前，旧二维码可以继续使用；之后新生成的二维码会保存在本浏览器中，切换工序或重新打开窗口都能再次显示。"
                  />
                )}

                <Space size={8} wrap>
                  <Button loading={registrationGenerating} onClick={generateRegistrationQr}>重新生成</Button>
                  <Button danger onClick={confirmRevokeRegistrationQr}>作废二维码</Button>
                </Space>
              </Space>
            </div>
          ) : (
            <div style={{ border: "1px solid #e1e8f2", borderRadius: 10, background: "#f8fafc", padding: 18, textAlign: "center" }}>
              <Space direction="vertical" size={10} align="center">
                <Typography.Text strong>当前工序暂无有效注册码</Typography.Text>
                <Button type="primary" loading={registrationGenerating} onClick={generateRegistrationQr}>
                  生成二维码
                </Button>
              </Space>
            </div>
          )}
        </Space>
      </Modal>

      <Modal
        title="岗位变更"
        open={Boolean(changingWorker)}
        onCancel={() => setChangingWorker(undefined)}
        onOk={() => void changeStage()}
        okText="确认更换工序"
        confirmLoading={stageChanging}
        cancelText="关闭"
      >
        <Space direction="vertical" size={14} className="full-width">
          <Typography.Text>员工：{changingWorker?.account.displayName}</Typography.Text>
          <Select value={nextStage} onChange={setNextStage} options={stageOptions} />
          <Alert type="info" showIcon message="无需员工扫码。确认后当前岗位进入停用区；若该员工以前做过目标工序，将恢复原岗位 ID。" />
        </Space>
      </Modal>

      <Modal
        title={`${historyWorker?.account.displayName ?? "员工"} · 岗位履历`}
        open={Boolean(historyWorker)}
        onCancel={() => setHistoryWorker(undefined)}
        footer={null}
        width={760}
      >
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={historyWorker?.workerProfiles ?? []}
          columns={historyWorker ? historyColumns(historyWorker) : []}
        />
      </Modal>
    </Space>
  );
}
