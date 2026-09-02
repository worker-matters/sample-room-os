import {
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
  type TableProps
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  sampleRoomApi,
  type BulkRowResult,
  type BusinessUserRequestRecord,
  type ClientUserAccountSummary,
  type CustomerAccountSummary
} from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";

type Props = { session: DevSession };
type ClientRole = "client_admin" | "client_business_user";
type BulkMode = "customers" | "clientUsers";
type BusinessUserStopMode = "profile_and_login" | "login_only";

const roleLabel: Record<ClientRole, string> = {
  client_admin: "客户主管",
  client_business_user: "普通客户业务员"
};

function StatusTag({ active, activeText = "启用", inactiveText = "停用" }: {
  active: boolean;
  activeText?: string;
  inactiveText?: string;
}) {
  return <Tag color={active ? "green" : "default"}>{active ? activeText : inactiveText}</Tag>;
}

function parseCustomerRows(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .map((customerName) => ({ customerName }));
}

function parseClientUserRows(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [displayName = "", contact = ""] = line.split(/\t|,/).map((value) => value.trim());
    return { displayName, ...(contact ? { contact } : {}) };
  });
}

function accountStatusActive(profile: ClientUserAccountSummary) {
  return profile.loginStatus === "active";
}

function businessUserStopped(profile: ClientUserAccountSummary) {
  return profile.status !== "active" || (profile.hasLoginAccount && !accountStatusActive(profile));
}

function formatStoppedAt(value?: string) {
  return value ? new Date(value).toLocaleString() : "-";
}

export function CustomerAccountManagementPanel({ session }: Props) {
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();
  const [customers, setCustomers] = useState<CustomerAccountSummary[]>([]);
  const [requests, setRequests] = useState<BusinessUserRequestRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCustomerId, setActiveCustomerId] = useState<string>();
  const [stoppedQuery, setStoppedQuery] = useState("");
  const [stoppedCustomerId, setStoppedCustomerId] = useState<string>();
  const [requestCustomerId, setRequestCustomerId] = useState<string>();
  const [stoppingProfile, setStoppingProfile] = useState<ClientUserAccountSummary | null>(null);
  const [businessUserStopMode, setBusinessUserStopMode] =
    useState<BusinessUserStopMode>("profile_and_login");

  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [createCustomerForm] = Form.useForm<{ customerName: string }>();
  const [profileCustomer, setProfileCustomer] = useState<CustomerAccountSummary | null>(null);
  const [profileForm] = Form.useForm<{ displayName: string; contact?: string }>();
  const [editingProfile, setEditingProfile] = useState<ClientUserAccountSummary | null>(null);
  const [editProfileForm] = Form.useForm<{ displayName: string; contact?: string; username?: string }>();
  const [editingCustomer, setEditingCustomer] = useState<CustomerAccountSummary | null>(null);
  const [editCustomerForm] = Form.useForm<{ name: string }>();

  const [loginProfile, setLoginProfile] = useState<ClientUserAccountSummary | null>(null);
  const [loginForm] = Form.useForm<{ username: string; password?: string; role: ClientRole }>();
  const [reviewingRequest, setReviewingRequest] = useState<BusinessUserRequestRecord | null>(null);
  const [reviewForm] = Form.useForm<{ targetClientUserId?: string; reviewNote?: string }>();

  const [bulkMode, setBulkMode] = useState<BulkMode | null>(null);
  const [bulkCustomer, setBulkCustomer] = useState<CustomerAccountSummary | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkPreview, setBulkPreview] = useState<Array<BulkRowResult<unknown>>>([]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [customerResult, requestResult] = await Promise.all([
        sampleRoomApi.listCustomerAccounts(session),
        sampleRoomApi.listAllBusinessUserRequests(session)
      ]);
      setCustomers(customerResult.customers);
      setRequests(requestResult.requests);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载客户资料失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi, session]);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeCustomers = useMemo(() => customers
    .filter((customer) => customer.status === "active")
    .map((customer) => ({
      ...customer,
      clientUsers: customer.clientUsers.filter((profile) => !businessUserStopped(profile))
    })), [customers]);

  const filteredCustomers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return activeCustomers.filter((customer) => {
      if (activeCustomerId && customer.id !== activeCustomerId) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return [customer.name, ...customer.clientUsers.flatMap((profile) => [
          profile.displayName,
          profile.contact,
          profile.loginUsername
        ])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [activeCustomerId, activeCustomers, query]);

  const stoppedCustomerGroups = useMemo(() => customers.flatMap((customer) => {
    const stoppedUsers = customer.status === "archived"
      ? customer.clientUsers
      : customer.clientUsers.filter(businessUserStopped);
    return customer.status === "archived" || stoppedUsers.length
      ? [{ ...customer, clientUsers: stoppedUsers }]
      : [];
  }), [customers]);

  const filteredStoppedCustomerGroups = useMemo(() => {
    const keyword = stoppedQuery.trim().toLowerCase();
    return stoppedCustomerGroups.flatMap((customer) => {
      if (stoppedCustomerId && customer.id !== stoppedCustomerId) {
        return [];
      }
      if (!keyword) {
        return [customer];
      }
      if (customer.name.toLowerCase().includes(keyword)) {
        return [customer];
      }
      const matchingUsers = customer.clientUsers.filter((profile) =>
        [profile.displayName, profile.loginUsername, profile.contact]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(keyword)
      );
      return matchingUsers.length ? [{ ...customer, clientUsers: matchingUsers }] : [];
    });
  }, [stoppedCustomerGroups, stoppedCustomerId, stoppedQuery]);

  const stoppedBusinessUserCount = stoppedCustomerGroups.reduce(
    (total, customer) => total + customer.clientUsers.length,
    0
  );

  const showCredential = (title: string, username: string, temporaryPassword: string) => {
    modal.info({
      title,
      width: 520,
      content: (
        <Space direction="vertical" className="full-width">
          <Alert type="warning" showIcon message="临时密码只在本次操作中显示，请安全交给本人。" />
          <Typography.Text copyable>登录账号：{username}</Typography.Text>
          <Typography.Text copyable>临时密码：{temporaryPassword}</Typography.Text>
        </Space>
      )
    });
  };

  const createCustomer = async () => {
    const values = await createCustomerForm.validateFields();
    await sampleRoomApi.createCustomer(session, values);
    messageApi.success("客户资料已创建；当前没有登录账号，也不需要主管账号");
    setCreateCustomerOpen(false);
    createCustomerForm.resetFields();
    await refresh();
  };

  const createProfile = async () => {
    if (!profileCustomer) return;
    const values = await profileForm.validateFields();
    await sampleRoomApi.createClientUserProfile(session, profileCustomer.id, values);
    messageApi.success("客户业务员资料已创建，可立即用于接单");
    setProfileCustomer(null);
    profileForm.resetFields();
    await refresh();
  };

  const saveCustomer = async () => {
    if (!editingCustomer) return;
    const values = await editCustomerForm.validateFields();
    await sampleRoomApi.updateCustomerAccount(session, editingCustomer.id, values);
    setEditingCustomer(null);
    messageApi.success("客户资料已更新");
    await refresh();
  };

  const saveProfile = async () => {
    if (!editingProfile) return;
    const values = await editProfileForm.validateFields();
    await sampleRoomApi.updateClientUserAccount(session, editingProfile.id, values);
    setEditingProfile(null);
    messageApi.success("客户业务员资料已更新");
    await refresh();
  };

  const createLogin = async () => {
    if (!loginProfile) return;
    const values = await loginForm.validateFields();
    const result = await sampleRoomApi.createClientUserLoginAccount(session, loginProfile.id, values);
    setLoginProfile(null);
    loginForm.resetFields();
    showCredential("客户登录账号已生成", result.loginCredential.username, result.loginCredential.temporaryPassword);
    await refresh();
  };

  const stopBusinessUser = async () => {
    if (!stoppingProfile) return;

    if (businessUserStopMode === "login_only") {
      await sampleRoomApi.updateClientUserLoginStatus(session, stoppingProfile.id, "archived");
      messageApi.success("已禁止该业务员登录；业务资料和历史订单保持不变");
    } else {
      if (stoppingProfile.hasLoginAccount && accountStatusActive(stoppingProfile)) {
        await sampleRoomApi.updateClientUserLoginStatus(session, stoppingProfile.id, "archived");
      }
      await sampleRoomApi.updateClientUserAccountStatus(session, stoppingProfile.id, "archived");
      messageApi.success("业务员资料和登录账号已停用，历史订单保持不变");
    }

    setStoppingProfile(null);
    setBusinessUserStopMode("profile_and_login");
    await refresh();
  };

  const openStopBusinessUser = (profile: ClientUserAccountSummary) => {
    setStoppingProfile(profile);
    setBusinessUserStopMode("profile_and_login");
  };

  const confirmCustomerStatus = (
    customer: CustomerAccountSummary,
    status: "active" | "archived"
  ) => {
    modal.confirm({
      title: status === "archived" ? `停用客户「${customer.name}」` : `恢复客户「${customer.name}」`,
      content: status === "archived"
        ? "客户停用后，该客户下已有的登录账号将同时停用，业务资料和历史订单不会删除。"
        : "恢复客户会同时恢复该客户下所有已有登录账号，请确认这是你的预期操作。",
      okText: status === "archived" ? "确认停用" : "确认恢复",
      ...(status === "archived" ? { okButtonProps: { danger: true } } : {}),
      onOk: async () => {
        await sampleRoomApi.updateCustomerAccountStatus(session, customer.id, status);
        messageApi.success(status === "archived"
          ? "客户及其登录账号已停用"
          : "客户及其登录账号已恢复");
        await refresh();
      }
    });
  };

  const restoreBusinessUser = (
    customer: CustomerAccountSummary,
    profile: ClientUserAccountSummary
  ) => {
    modal.confirm({
      title: `恢复业务员「${profile.displayName}」`,
      content: customer.status === "archived"
        ? "所属客户会自动恢复；只恢复该业务员资料和登录账号，其他业务员账号继续保持停用。"
        : "将恢复该业务员当前停用的资料和登录账号，不影响同客户的其他业务员。",
      okText: "确认恢复",
      onOk: async () => {
        if (profile.status !== "active") {
          await sampleRoomApi.updateClientUserAccountStatus(session, profile.id, "active");
        }
        if (profile.hasLoginAccount && (!accountStatusActive(profile) || customer.status === "archived")) {
          await sampleRoomApi.updateClientUserLoginStatus(session, profile.id, "active");
        }
        messageApi.success(customer.status === "archived"
          ? "客户与该业务员已恢复，其他业务员保持停用"
          : "业务员已恢复");
        await refresh();
      }
    });
  };

  const updateRole = async (profile: ClientUserAccountSummary, role: ClientRole) => {
    await sampleRoomApi.updateClientUserLoginRole(session, profile.id, role);
    messageApi.success(role === "client_admin" ? "已设为客户主管" : "已改为普通客户业务员");
    await refresh();
  };

  const resetPassword = async (profile: ClientUserAccountSummary) => {
    const result = await sampleRoomApi.resetClientUserAccountPassword(session, profile.id);
    if (result.loginCredential) {
      showCredential("登录密码已重置", result.loginCredential.username, result.loginCredential.temporaryPassword);
    }
  };

  const openBulk = (mode: BulkMode, customer?: CustomerAccountSummary) => {
    setBulkMode(mode);
    setBulkCustomer(customer ?? null);
    setBulkText("");
    setBulkPreview([]);
  };

  const previewBulk = async () => {
    if (bulkMode === "customers") {
      const result = await sampleRoomApi.previewBulkCustomers(session, parseCustomerRows(bulkText));
      setBulkPreview(result.results);
    } else if (bulkMode === "clientUsers" && bulkCustomer) {
      const result = await sampleRoomApi.previewBulkClientUsers(
        session,
        bulkCustomer.id,
        parseClientUserRows(bulkText)
      );
      setBulkPreview(result.results);
    }
  };

  const confirmBulk = async () => {
    setBulkSubmitting(true);
    try {
      const result = bulkMode === "customers"
        ? await sampleRoomApi.bulkCreateCustomers(session, parseCustomerRows(bulkText))
        : bulkCustomer
          ? await sampleRoomApi.bulkCreateClientUsers(session, bulkCustomer.id, parseClientUserRows(bulkText))
          : { results: [] };
      setBulkPreview(result.results);
      const success = result.results.filter((row) => row.status === "created").length;
      const failed = result.results.length - success;
      messageApi.info(`批量处理完成：成功 ${success} 条，失败 ${failed} 条`);
      await refresh();
    } finally {
      setBulkSubmitting(false);
    }
  };

  const approveRequest = async () => {
    if (!reviewingRequest) return;
    const values = await reviewForm.validateFields();
    const result = await sampleRoomApi.reviewBusinessUserRequest(session, reviewingRequest.id, {
      status: "approved",
      ...values
    });
    setReviewingRequest(null);
    reviewForm.resetFields();
    if (result.loginCredential) {
      showCredential("注册申请已通过", result.loginCredential.username, result.loginCredential.temporaryPassword);
    } else {
      messageApi.success("注册申请已通过并关联已有资料/账号");
    }
    await refresh();
  };

  const rejectRequest = async (request: BusinessUserRequestRecord) => {
    await sampleRoomApi.reviewBusinessUserRequest(session, request.id, { status: "rejected" });
    messageApi.success("注册申请已拒绝，未创建资料或账号");
    await refresh();
  };

  const profileColumns = (
    customer: CustomerAccountSummary
  ): NonNullable<TableProps<ClientUserAccountSummary>["columns"]> => [
    { title: "姓名", dataIndex: "displayName", width: 140 },
    { title: "所属客户", render: () => customer.name, width: 160 },
    { title: "联系方式", dataIndex: "contact", render: (value?: string) => value || "-", width: 160 },
    {
      title: "历史订单",
      dataIndex: "historicalOrderCount",
      render: (value?: number) => `${value ?? 0} 单`,
      width: 90
    },
    {
      title: "业务资料",
      width: 100,
      render: (_, profile) => <StatusTag active={profile.status === "active"} />
    },
    {
      title: "登录账号",
      width: 180,
      render: (_, profile) => profile.hasLoginAccount ? (
        <Space direction="vertical" size={2}>
          <Typography.Text copyable>{profile.loginUsername}</Typography.Text>
          <Space size={4}>
            <Tag color={profile.loginRole === "client_admin" ? "blue" : "default"}>
              {profile.loginRole ? roleLabel[profile.loginRole] : "-"}
            </Tag>
            <StatusTag active={accountStatusActive(profile)} activeText="账号启用" inactiveText="账号停用" />
          </Space>
        </Space>
      ) : <Tag>未生成账号</Tag>
    },
    {
      title: "操作",
      width: 430,
      render: (_, profile) => (
        <Space wrap>
          <Button size="small" onClick={() => {
            setEditingProfile(profile);
            editProfileForm.setFieldsValue({
              displayName: profile.displayName,
              ...(profile.contact ? { contact: profile.contact } : {}),
              ...(profile.loginUsername ? { username: profile.loginUsername } : {})
            });
          }}>编辑资料</Button>
          <Button size="small" danger onClick={() => openStopBusinessUser(profile)}>停用业务员</Button>
          {!profile.hasLoginAccount ? (
            <Button size="small" type="primary" onClick={() => {
              setLoginProfile(profile);
              loginForm.setFieldsValue({
                username: profile.contact?.includes("@") ? profile.contact : "",
                role: "client_business_user"
              });
            }}>生成账号</Button>
          ) : (
            <>
              <Button size="small" onClick={() => void resetPassword(profile)}>重置密码</Button>
              {profile.loginRole === "client_admin"
                ? <Button size="small" onClick={() => void updateRole(profile, "client_business_user")}>改为普通业务员</Button>
                : <Button size="small" onClick={() => void updateRole(profile, "client_admin")}>设为主管</Button>}
            </>
          )}
        </Space>
      )
    }
  ];

  const customerColumns: TableProps<CustomerAccountSummary>["columns"] = [
    { title: "客户", dataIndex: "name", width: 200 },
    { title: "业务员资料数", render: (_, customer) => customer.clientUsers.length, width: 120 },
    { title: "登录账号数", render: (_, customer) => customer.clientUsers.filter((item) => item.hasLoginAccount).length, width: 110 },
    {
      title: "主管账号数",
      render: (_, customer) => customer.clientUsers.filter((item) => item.loginRole === "client_admin").length,
      width: 110
    },
    { title: "状态", render: (_, customer) => <StatusTag active={customer.status === "active"} />, width: 90 },
    {
      title: "操作",
      width: 390,
      render: (_, customer) => (
        <Space wrap>
          <Button size="small" onClick={() => {
            setEditingCustomer(customer);
            editCustomerForm.setFieldsValue({ name: customer.name });
          }}>编辑客户</Button>
          <Button size="small" onClick={() => setProfileCustomer(customer)}>新建业务员资料</Button>
          <Button size="small" onClick={() => openBulk("clientUsers", customer)}>批量录入业务员</Button>
          {customer.status === "active"
            ? <Button size="small" danger onClick={() => confirmCustomerStatus(customer, "archived")}>停用客户</Button>
            : <Button size="small" onClick={() => confirmCustomerStatus(customer, "active")}>恢复客户</Button>}
        </Space>
      )
    }
  ];

  const stoppedProfileColumns = (
    customer: CustomerAccountSummary
  ): NonNullable<TableProps<ClientUserAccountSummary>["columns"]> => [
    { title: "业务员", dataIndex: "displayName", width: 150 },
    {
      title: "登录账号",
      width: 220,
      render: (_, profile) => profile.hasLoginAccount ? (
        <Space direction="vertical" size={2}>
          <Typography.Text copyable>{profile.loginUsername}</Typography.Text>
          <Tag color={profile.loginRole === "client_admin" ? "blue" : "default"}>
            {profile.loginRole ? roleLabel[profile.loginRole] : "-"}
          </Tag>
        </Space>
      ) : <Tag>未生成账号</Tag>
    },
    { title: "联系方式", dataIndex: "contact", render: (value?: string) => value || "-", width: 170 },
    {
      title: "停用状态",
      width: 240,
      render: (_, profile) => (
        <Space wrap size={4}>
          {customer.status === "archived" ? <Tag>随客户停用</Tag> : null}
          {customer.status === "active" && businessUserStopped(profile) ? <Tag>业务员停用</Tag> : null}
          {!profile.hasLoginAccount ? <Tag>无登录账号</Tag> : null}
        </Space>
      )
    },
    {
      title: "停用时间",
      width: 180,
      render: (_, profile) => formatStoppedAt(profile.archivedAt ?? customer.archivedAt)
    },
    {
      title: "操作",
      width: 140,
      render: (_, profile) => (
        profile.hasLoginAccount || customer.status === "active"
          ? <Button size="small" type="primary" onClick={() => restoreBusinessUser(customer, profile)}>恢复业务员</Button>
          : <Typography.Text type="secondary">请先恢复客户</Typography.Text>
      )
    }
  ];

  const stoppedCustomerColumns: TableProps<CustomerAccountSummary>["columns"] = [
    { title: "客户", dataIndex: "name", width: 240 },
    {
      title: "停用状态",
      width: 180,
      render: (_, customer) => customer.status === "archived"
        ? <Tag>客户停用</Tag>
        : <Tag color="orange">客户正常，存在停用业务员</Tag>
    },
    {
      title: "停用业务员",
      render: (_, customer) => customer.clientUsers.length,
      width: 120
    },
    {
      title: "客户停用时间",
      render: (_, customer) => customer.status === "archived" ? formatStoppedAt(customer.archivedAt) : "-",
      width: 180
    },
    {
      title: "操作",
      width: 150,
      render: (_, customer) => customer.status === "archived"
        ? <Button size="small" type="primary" onClick={() => confirmCustomerStatus(customer, "active")}>恢复客户</Button>
        : <Typography.Text type="secondary">按业务员恢复</Typography.Text>
    }
  ];

  const pendingRequests = requests.filter((request) => request.status === "pending");
  const filteredPendingRequests = pendingRequests.filter(
    (request) => !requestCustomerId || request.customerId === requestCustomerId
  );
  const requestCustomerOptions = customers
    .filter((customer) => pendingRequests.some((request) => request.customerId === customer.id))
    .map((customer) => ({ value: customer.id, label: customer.name }));
  const requestColumns: TableProps<BusinessUserRequestRecord>["columns"] = [
    { title: "客户", dataIndex: "customerName" },
    { title: "申请人", dataIndex: "businessUserName" },
    { title: "联系方式", dataIndex: "contact" },
    { title: "登录账号", dataIndex: "requestedUsername", render: (value?: string) => value || "审批后生成" },
    {
      title: "来源",
      dataIndex: "source",
      render: (value?: string) => value === "supervisor_registration_code" ? "主管注册码" : "主管提交"
    },
    {
      title: "操作",
      render: (_, request) => (
        <Space>
          <Button size="small" type="primary" onClick={() => {
            setReviewingRequest(request);
            const customer = customers.find((item) => item.id === request.customerId);
            const matches = customer?.clientUsers.filter((profile) =>
              profile.status === "active" &&
              profile.contact?.trim().toLowerCase() === request.contact.trim().toLowerCase()
            ) ?? [];
            reviewForm.setFieldsValue(
              matches.length === 1 && matches[0]
                ? { targetClientUserId: matches[0].id }
                : {}
            );
          }}>审批</Button>
          <Button size="small" danger onClick={() => void rejectRequest(request)}>拒绝</Button>
        </Space>
      )
    }
  ];

  const reviewProfiles = reviewingRequest
    ? customers.find((customer) => customer.id === reviewingRequest.customerId)?.clientUsers
      .filter((profile) => profile.status === "active") ?? []
    : [];

  return (
    <Space direction="vertical" size={16} className="full-width customer-account-page">
      {contextHolder}
      {modalContextHolder}
      {session.authMode === "dev" ? (
        <Alert
          type="info"
          showIcon
          message="客户/业务员资料与登录账号已经分离"
          description="资料创建后即可用于接单。客户可以没有主管，也可以有多个主管。日常停用业务员会同时停用业务资料与登录账号；只有特殊安全场景才使用“仅禁止登录”。"
        />
      ) : null}
      <Card
        className="customer-account-card"
        title="客户管理"
        extra={<Space wrap>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            className="customer-account-compact-select"
            placeholder="全部启用客户"
            value={activeCustomerId}
            onChange={(value) => setActiveCustomerId(value)}
            options={activeCustomers.map((customer) => ({
              value: customer.id,
              label: customer.name
            }))}
          />
          <Input.Search
            allowClear
            className="customer-account-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索启用客户、业务员或账号"
          />
          <Button type="primary" onClick={() => setCreateCustomerOpen(true)}>新建客户</Button>
          <Button onClick={() => openBulk("customers")}>批量创建客户</Button>
          <Button loading={loading} onClick={() => void refresh()}>刷新</Button>
        </Space>}
      >
        <Table
          rowKey="id"
          className="customer-account-table"
          loading={loading}
          dataSource={filteredCustomers}
          columns={customerColumns}
          pagination={false}
          scroll={{ x: 1150 }}
          expandable={{
            rowExpandable: (customer) => customer.clientUsers.length > 0,
            expandedRowRender: (customer) => (
              <div className="customer-account-subtable-shell">
                <Table
                  rowKey="id"
                  className="customer-account-table customer-account-subtable"
                  size="small"
                  pagination={false}
                  dataSource={customer.clientUsers}
                  columns={profileColumns(customer)}
                  scroll={{ x: 1150 }}
                />
              </div>
            )
          }}
        />
      </Card>

      <Collapse
        className="customer-account-archive-collapse"
        items={[{
          key: "stopped-customer-accounts",
          label: `停用客户与账号（${stoppedCustomerGroups.length} 个客户 / ${stoppedBusinessUserCount} 名停用业务员）`,
          children: (
            <Space direction="vertical" size={12} className="full-width customer-account-archive-panel">
              <div className="customer-account-archive-toolbar">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  className="customer-account-compact-select"
                  placeholder="全部停用客户"
                  value={stoppedCustomerId}
                  onChange={(value) => setStoppedCustomerId(value)}
                  options={stoppedCustomerGroups.map((customer) => ({
                    value: customer.id,
                    label: customer.name
                  }))}
                />
                <Input.Search
                  allowClear
                  className="customer-account-archive-search"
                  value={stoppedQuery}
                  onChange={(event) => setStoppedQuery(event.target.value)}
                  placeholder="搜索客户名称、业务员用户名或联系方式"
                />
              </div>
              <Table
                rowKey="id"
                className="customer-account-table"
                loading={loading}
                dataSource={filteredStoppedCustomerGroups}
                columns={stoppedCustomerColumns}
                pagination={false}
                scroll={{ x: 1000 }}
                locale={{ emptyText: "暂无停用客户或业务员账号" }}
                expandable={{
                  rowExpandable: (customer) => customer.clientUsers.length > 0,
                  expandedRowRender: (customer) => (
                    <div className="customer-account-subtable-shell">
                      <Table
                        rowKey="id"
                        className="customer-account-table customer-account-subtable"
                        size="small"
                        pagination={false}
                        dataSource={customer.clientUsers}
                        columns={stoppedProfileColumns(customer)}
                        scroll={{ x: 1100 }}
                      />
                    </div>
                  )
                }}
              />
            </Space>
          )
        }]}
      />

      <Collapse
        className="customer-account-request-collapse"
        items={[{
          key: "customer-business-user-requests",
          label: `客户业务员注册申请（待审批 ${pendingRequests.length}）`,
          children: (
            <Space direction="vertical" size={12} className="full-width">
              <div className="customer-account-request-toolbar">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  className="customer-account-compact-select"
                  placeholder="全部申请客户"
                  value={requestCustomerId}
                  onChange={(value) => setRequestCustomerId(value)}
                  options={requestCustomerOptions}
                />
              </div>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={filteredPendingRequests}
                columns={requestColumns}
              />
            </Space>
          )
        }]}
      />

      <Modal
        title={`停用业务员「${stoppingProfile?.displayName ?? ""}」`}
        open={Boolean(stoppingProfile)}
        okText="确认停用"
        okButtonProps={{ danger: true }}
        onCancel={() => {
          setStoppingProfile(null);
          setBusinessUserStopMode("profile_and_login");
        }}
        onOk={stopBusinessUser}
      >
        <Typography.Paragraph>
          默认同时停用业务资料与登录账号，历史订单和操作记录不会删除。
        </Typography.Paragraph>
        <Radio.Group
          className="customer-account-stop-options"
          value={businessUserStopMode}
          onChange={(event) => setBusinessUserStopMode(event.target.value as BusinessUserStopMode)}
        >
          <Space direction="vertical">
            <Radio value="profile_and_login">
              <Typography.Text strong>停用业务员及登录</Typography.Text>
              <br />
              <Typography.Text type="secondary">停止参与新业务，同时禁止本人继续登录。</Typography.Text>
            </Radio>
            <Radio value="login_only" disabled={!stoppingProfile?.hasLoginAccount}>
              <Typography.Text strong>仅禁止登录（高级选项）</Typography.Text>
              <br />
              <Typography.Text type="secondary">
                业务资料仍可用于接单和历史归属，仅用于账号安全等特殊场景。
              </Typography.Text>
            </Radio>
          </Space>
        </Radio.Group>
      </Modal>

      <Modal title="新建客户资料" open={createCustomerOpen} onCancel={() => setCreateCustomerOpen(false)} onOk={() => void createCustomer()}>
        <Alert type="success" showIcon message="只创建业务资料，不自动创建主管或登录账号。" />
        <Form form={createCustomerForm} layout="vertical" className="top-gap">
          <Form.Item name="customerName" label="客户名称" rules={[{ required: true, message: "请输入客户名称" }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`为 ${profileCustomer?.name ?? ""} 新建业务员资料`} open={Boolean(profileCustomer)} onCancel={() => setProfileCustomer(null)} onOk={() => void createProfile()}>
        <Form form={profileForm} layout="vertical">
          <Form.Item name="displayName" label="姓名" rules={[{ required: true, message: "请输入姓名" }]}><Input /></Form.Item>
          <Form.Item name="contact" label="联系方式"><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal title="编辑客户资料" open={Boolean(editingCustomer)} onCancel={() => setEditingCustomer(null)} onOk={() => void saveCustomer()}>
        <Form form={editCustomerForm} layout="vertical">
          <Form.Item name="name" label="客户名称" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal title="编辑客户业务员资料" open={Boolean(editingProfile)} onCancel={() => setEditingProfile(null)} onOk={() => void saveProfile()}>
        <Form form={editProfileForm} layout="vertical">
          <Form.Item name="displayName" label="业务资料：姓名" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="contact" label="业务资料：联系方式"><Input /></Form.Item>
          {editingProfile?.hasLoginAccount ? (
            <Form.Item name="username" label="登录账号：用户名" rules={[{ required: true }]}><Input /></Form.Item>
          ) : <Alert type="info" message="该业务员尚未生成登录账号。" />}
        </Form>
      </Modal>

      <Modal title={`为 ${loginProfile?.displayName ?? ""} 生成登录账号`} open={Boolean(loginProfile)} onCancel={() => setLoginProfile(null)} onOk={() => void createLogin()}>
        <Form form={loginForm} layout="vertical">
          <Form.Item name="role" label="客户侧角色" rules={[{ required: true }]}>
            <Select options={[
              { value: "client_business_user", label: "普通客户业务员" },
              { value: "client_admin", label: "客户主管" }
            ]} />
          </Form.Item>
          <Form.Item name="username" label="登录用户名" rules={[{ required: true }]}><Input autoComplete="username" /></Form.Item>
          <Form.Item name="password" label="临时密码" extra="留空则自动生成；首次登录后强制修改" rules={[{ min: 8 }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={bulkMode === "customers" ? "批量创建客户" : `批量录入 ${bulkCustomer?.name ?? ""} 的业务员`}
        open={Boolean(bulkMode)}
        onCancel={() => setBulkMode(null)}
        footer={[
          <Button key="preview" onClick={() => void previewBulk()}>导入前预览</Button>,
          <Button key="confirm" type="primary" loading={bulkSubmitting} disabled={!bulkPreview.some((row) => row.status === "valid")} onClick={() => void confirmBulk()}>
            确认创建
          </Button>
        ]}
        width={720}
      >
        <Typography.Paragraph type="secondary">
          {bulkMode === "customers"
            ? "每行一个客户名称。"
            : "每行一个业务员，格式为：姓名,联系方式（也支持 Tab 分隔）。"}
        </Typography.Paragraph>
        <Input.TextArea rows={7} value={bulkText} onChange={(event) => {
          setBulkText(event.target.value);
          setBulkPreview([]);
        }} />
        {bulkPreview.length ? (
          <Table
            className="top-gap"
            rowKey="index"
            size="small"
            pagination={false}
            dataSource={bulkPreview}
            columns={[
              { title: "行", dataIndex: "index", render: (value: number) => value + 1, width: 60 },
              { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "failed" ? "red" : value === "created" ? "green" : "blue"}>{value}</Tag>, width: 90 },
              { title: "内容", dataIndex: "data", render: (value: unknown) => value ? JSON.stringify(value) : "-" },
              { title: "错误", dataIndex: "error", render: (value?: string) => value || "-" }
            ]}
          />
        ) : null}
      </Modal>

      <Modal title="审批客户业务员注册" open={Boolean(reviewingRequest)} onCancel={() => setReviewingRequest(null)} onOk={() => void approveRequest()}>
        <Alert
          type="warning"
          showIcon
          message="请确认是否关联已有业务员资料"
          description="联系方式唯一匹配时已自动选择。存在多个候选时必须人工选择；留空表示审批后创建新资料。已有登录账号不会被重复创建或覆盖。"
        />
        <Form form={reviewForm} layout="vertical" className="top-gap">
          <Form.Item name="targetClientUserId" label="关联已有业务员资料（可选）">
            <Select allowClear options={reviewProfiles.map((profile) => ({
              value: profile.id,
              label: `${profile.displayName} · ${profile.contact || "无联系方式"} · ${profile.hasLoginAccount ? "已有账号" : "无账号"}`
            }))} />
          </Form.Item>
          <Form.Item name="reviewNote" label="审批备注"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
