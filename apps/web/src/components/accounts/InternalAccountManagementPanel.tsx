import { Alert, Button, Card, Collapse, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Role } from "@sample-room/shared";
import {
  sampleRoomApi,
  type CreateInternalAccountPayload,
  type InternalAccountSummary,
  type UpdateInternalAccountPayload
} from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";
import { BossStatsStrip } from "../boss/BossStatsStrip";

type Props = {
  session: DevSession;
};

type InternalAccountFormValues = {
  username: string;
  displayName: string;
  password?: string;
  role?: CreateInternalAccountPayload["role"];
};

const staffRoleOptions: Array<{ label: string; value: CreateInternalAccountPayload["role"] }> = [
  { label: "接单员", value: "receiver" },
  { label: "计划员", value: "planner" },
  { label: "版师", value: "pattern_maker" }
];

const internalAccountRoleGroups: Array<{ key: Role; label: string }> = [
  { key: "receiver", label: "接单员" },
  { key: "planner", label: "计划员" },
  { key: "pattern_maker", label: "版师" },
  { key: "boss", label: "老板账号" }
];

const statusLabel: Record<InternalAccountSummary["status"], string> = {
  active: "启用",
  disabled: "停用",
  archived: "归档"
};

const roleLabel: Partial<Record<Role, string>> = {
  boss: "老板",
  receiver: "接单员",
  planner: "计划员",
  pattern_maker: "版师",
  client_admin: "客户主管",
  client_business_user: "客户业务员"
};

function StatusTag({ status }: { status: InternalAccountSummary["status"] }) {
  return <Tag color={status === "active" ? "green" : "default"}>{statusLabel[status]}</Tag>;
}

export function InternalAccountManagementPanel({ session }: Props) {
  const [messageApi, contextHolder] = message.useMessage();
  const [accounts, setAccounts] = useState<InternalAccountSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingAccount, setEditingAccount] = useState<InternalAccountSummary | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<InternalAccountFormValues>();
  const [createForm] = Form.useForm<InternalAccountFormValues>();
  const creatableRoleOptions = useMemo(
    () => session.role === "system_owner"
      ? [{ label: "老板", value: "boss" as const }, ...staffRoleOptions]
      : staffRoleOptions,
    [session.role]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await sampleRoomApi.listInternalAccounts(session);
      setAccounts(result.accounts);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载内部账号失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi, session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeStaffStats = useMemo(() => {
    const activeAccounts = accounts.filter((account) => account.status === "active");
    const receiverCount = activeAccounts.filter((account) => account.role === "receiver").length;
    const plannerCount = activeAccounts.filter((account) => account.role === "planner").length;
    const patternMakerCount = activeAccounts.filter((account) => account.role === "pattern_maker").length;
    const inactiveCount = accounts.filter((account) => account.status !== "active").length;

    return [
      { label: "接单员", value: receiverCount, tone: "blue" },
      { label: "计划员", value: plannerCount, tone: "green" },
      { label: "版师", value: patternMakerCount, tone: "purple" },
      { label: "启用合计", value: receiverCount + plannerCount + patternMakerCount, tone: "orange" },
      { label: "停用账号", value: inactiveCount, tone: "gray" }
    ];
  }, [accounts]);

  const roleGroups = useMemo(
    () =>
      internalAccountRoleGroups.map((group) => {
        const groupAccounts = accounts.filter((account) => account.role === group.key);
        const activeCount = groupAccounts.filter((account) => account.status === "active").length;
        const inactiveCount = groupAccounts.filter((account) => account.status !== "active").length;
        return {
          ...group,
          accounts: groupAccounts,
          activeCount,
          inactiveCount,
          totalCount: groupAccounts.length
        };
      }),
    [accounts]
  );

  const openEdit = (account: InternalAccountSummary) => {
    setEditingAccount(account);
    form.setFieldsValue({
      username: account.username,
      displayName: account.displayName
    });
  };

  const openCreate = () => {
    createForm.resetFields();
    createForm.setFieldsValue({ role: "receiver" });
    setCreateOpen(true);
  };

  const showTemporaryPassword = (
    title: string,
    account: InternalAccountSummary,
    temporaryPassword: string
  ) => {
    Modal.info({
      title,
      content: (
        <Space direction="vertical" size={8}>
          <Typography.Text>
            临时密码只显示一次，请立即复制给员工。员工首次登录后必须修改密码。
          </Typography.Text>
          <Typography.Text>
            账号：<Typography.Text copyable>{account.username}</Typography.Text>
          </Typography.Text>
          <Typography.Text>
            临时密码：<Typography.Text copyable>{temporaryPassword}</Typography.Text>
          </Typography.Text>
        </Space>
      )
    });
  };

  const saveCreate = async () => {
    const values = await createForm.validateFields();
    const payload: CreateInternalAccountPayload = {
      username: values.username.trim(),
      displayName: values.displayName.trim(),
      role: values.role ?? "receiver",
      ...(values.password?.trim() ? { password: values.password.trim() } : {})
    };

    setSaving(true);
    try {
      const result = await sampleRoomApi.createInternalAccount(session, payload);
      setCreateOpen(false);
      messageApi.success("内部账号已创建");
      showTemporaryPassword("内部账号已创建", result.account, result.temporaryPassword);
      await refresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "创建内部账号失败");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editingAccount) {
      return;
    }

    const values = await form.validateFields();
    const payload: UpdateInternalAccountPayload = {
      username: values.username.trim(),
      displayName: values.displayName.trim(),
      ...(values.password?.trim() ? { password: values.password.trim() } : {})
    };

    setSaving(true);
    try {
      await sampleRoomApi.updateInternalAccount(session, editingAccount.id, payload);
      messageApi.success("内部账号已更新");
      setEditingAccount(null);
      await refresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存内部账号失败");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (account: InternalAccountSummary, status: "active" | "disabled") => {
    try {
      await sampleRoomApi.updateInternalAccount(session, account.id, { status });
      messageApi.success(status === "active" ? "账号已启用" : "账号已停用");
      await refresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "账号状态更新失败");
    }
  };

  const resetPassword = async (account: InternalAccountSummary) => {
    try {
      const result = await sampleRoomApi.resetInternalAccountPassword(session, account.id);
      showTemporaryPassword("临时密码已重置", result.account, result.temporaryPassword);
      await refresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "重置密码失败");
    }
  };

  const accountColumns = [
    { title: "姓名", dataIndex: "displayName" },
    { title: "username", dataIndex: "username" },
    {
      title: "phoneNumber（密码恢复）",
      dataIndex: "phoneNumber",
      render: (value?: string) => value || <Typography.Text type="secondary">待身份 API</Typography.Text>
    },
    {
      title: "accountType",
      render: () => <Tag color="blue">Business Account</Tag>
    },
    {
      title: "当前 role",
      dataIndex: "role",
      render: (role: Role) => <Tag color="geekblue">{roleLabel[role] ?? role}</Tag>
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (status: InternalAccountSummary["status"]) => <StatusTag status={status} />
    },
    {
      title: "操作",
      width: 250,
      render: (_: unknown, account: InternalAccountSummary) => (
        <Space wrap>
          <Button size="small" className="internal-account-edit-button" onClick={() => openEdit(account)}>
            编辑
          </Button>
          <Button
            size="small"
            className="internal-account-reset-password-button"
            onClick={() => void resetPassword(account)}
          >
            重置密码
          </Button>
          <Button
            size="small"
            danger={account.status === "active"}
            className="internal-account-toggle-status-button"
            onClick={() =>
              void setStatus(account, account.status === "active" ? "disabled" : "active")
            }
          >
            {account.status === "active" ? "停用" : "启用"}
          </Button>
        </Space>
      )
    }
  ];

  const roleGroupTitle = (group: (typeof roleGroups)[number]) =>
    group.key === "boss"
      ? `${group.label}（共 ${group.totalCount}）`
      : `${group.label}（启用 ${group.activeCount} / 停用 ${group.inactiveCount} / 共 ${group.totalCount}）`;

  return (
    <Card
      title="内部账号管理"
      className="section-card"
      extra={(
        <Space>
          <Button type="primary" className="internal-account-create-button" onClick={openCreate}>
            新增内部账号
          </Button>
          <Button onClick={() => void refresh()} loading={loading}>刷新</Button>
        </Space>
      )}
    >
      {contextHolder}
      <Space direction="vertical" size={12} className="full-width">
        <BossStatsStrip
          scope="内部员工账号"
          title="账号统计"
          helper="统计启用的接单员、计划员和版师；老板账号不计入合计。"
          ariaLabel="内部账号统计"
          items={activeStaffStats}
        />
        <Typography.Text type="secondary">
          管理接单员、计划员、版师和老板这些 Web 端账号。客户业务员账号仍在“客户与账号”中管理。
        </Typography.Text>
        <Alert
          type="info"
          showIcon
          message="Business Account 使用 username 登录，phoneNumber 仅用于密码恢复"
          description="每个 Account 同时只有一个 active role；设备绑定和 OpenID 身份入口已从正式管理界面隐藏。"
        />
        <Collapse
          className="internal-account-role-collapse"
          defaultActiveKey={[]}
          items={roleGroups.map((group) => ({
            key: group.key,
            className: `internal-account-role-group internal-account-role-${group.key}`,
            label: (
              <Typography.Text strong className="internal-account-role-title">
                {roleGroupTitle(group)}
              </Typography.Text>
            ),
            children: (
              <Table
                rowKey="id"
                size="small"
                className="internal-account-role-table"
                loading={loading}
                dataSource={group.accounts}
                pagination={false}
                columns={accountColumns}
                locale={{ emptyText: "暂无该角色账号" }}
              />
            )
          }))}
        />
      </Space>

      <Modal
        title="编辑内部账号"
        open={Boolean(editingAccount)}
        onCancel={() => setEditingAccount(null)}
        onOk={() => void saveEdit()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="显示名"
            name="displayName"
            rules={[{ required: true, message: "请输入显示名" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="新密码（可选）"
            name="password"
            rules={[{ min: 8, message: "密码至少 8 位" }]}
            extra="留空则不修改密码。"
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item label="状态预览">
            <Select
              disabled
              value={editingAccount?.status}
              options={[
                { label: "启用", value: "active" },
                { label: "停用", value: "disabled" }
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新增内部账号"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void saveCreate()}
        confirmLoading={saving}
        okText="创建账号"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            label="登录账号"
            name="username"
            rules={[{ required: true, message: "请输入登录账号" }]}
          >
            <Input placeholder="例如 receiver2@sample-room.test" autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="显示名"
            name="displayName"
            rules={[{ required: true, message: "请输入显示名" }]}
          >
            <Input placeholder="例如 接单员 2" />
          </Form.Item>
          <Form.Item
            label="角色"
            name="role"
            rules={[{ required: true, message: "请选择角色" }]}
            extra={session.role === "system_owner"
              ? "System Owner 可以新增老板及普通内部账号。"
              : "老板可以新增接单员、计划员和版师账号。"}
          >
            <Select options={creatableRoleOptions} />
          </Form.Item>
          <Form.Item
            label="初始密码（可选）"
            name="password"
            rules={[{ min: 8, message: "密码至少 8 位" }]}
            extra="留空则由系统生成临时密码；新账号首次登录后必须修改密码。"
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
