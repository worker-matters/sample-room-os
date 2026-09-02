import { CLIENT_ACCESS_SCOPES, type ClientAccessScope } from "@sample-room/shared";
import { Button, Card, Collapse, Form, Input, Modal, Space, Table, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  sampleRoomApi,
  type ClientUserAccountSummary,
  type UpdateClientUserAccountPayload
} from "../../api/sampleRoomApi";
import { useDevSession } from "../../app/DevSessionContext";
import { ClientBusinessUserRegistrationCard } from "../../components/ClientBusinessUserRegistrationCard";

const clientScopeLabels: Record<ClientAccessScope, string> = {
  own: "业务员账号",
  customer_all: "主管账号"
};

export function ClientUserManagementPage() {
  const { session } = useDevSession();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();
  const [clientUsers, setClientUsers] = useState<ClientUserAccountSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingClientUser, setEditingClientUser] = useState<ClientUserAccountSummary | null>(null);
  const [editForm] = Form.useForm<UpdateClientUserAccountPayload>();
  const isCustomerAdmin = session.clientAccessScope === CLIENT_ACCESS_SCOPES.customerAll;

  const loadClientUsers = useCallback(async () => {
    if (!isCustomerAdmin) {
      setClientUsers([]);
      return;
    }

    setLoading(true);
    try {
      const result = await sampleRoomApi.listClientManagedBusinessUsers(session);
      setClientUsers(result.clientUsers);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载客户员工失败");
    } finally {
      setLoading(false);
    }
  }, [isCustomerAdmin, messageApi, session]);

  useEffect(() => {
    void loadClientUsers();
  }, [loadClientUsers]);

  if (!isCustomerAdmin) {
    return <Navigate to="/client" replace />;
  }

  const activeBusinessUsers = clientUsers.filter(
    (clientUser) => clientUser.clientAccessScope === CLIENT_ACCESS_SCOPES.own && clientUser.status === "active"
  );
  const archivedBusinessUsers = clientUsers.filter(
    (clientUser) => clientUser.clientAccessScope === CLIENT_ACCESS_SCOPES.own && clientUser.status === "archived"
  );

  const setClientUserStatus = async (
    clientUser: ClientUserAccountSummary,
    status: ClientUserAccountSummary["status"]
  ) => {
    await sampleRoomApi.updateClientManagedBusinessUserStatus(session, clientUser.id, status);
    messageApi.success(status === "active" ? "业务员已恢复" : "业务员已停用");
    await loadClientUsers();
  };

  const openEditClientUser = (clientUser: ClientUserAccountSummary) => {
    setEditingClientUser(clientUser);
    editForm.setFieldsValue({
      displayName: clientUser.displayName,
      ...(clientUser.loginUsername !== undefined ? { username: clientUser.loginUsername } : {}),
      ...(clientUser.contact !== undefined ? { contact: clientUser.contact } : {})
    });
  };

  const saveClientUserAccount = async () => {
    if (!editingClientUser) {
      return;
    }

    const values = await editForm.validateFields();
    await sampleRoomApi.updateClientManagedBusinessUserAccount(session, editingClientUser.id, values);
    setEditingClientUser(null);
    messageApi.success("业务员账号已更新");
    await loadClientUsers();
  };

  const resetClientUserPassword = async (clientUser: ClientUserAccountSummary) => {
    const result = await sampleRoomApi.resetClientManagedBusinessUserPassword(session, clientUser.id);
    if (result.loginCredential) {
      modal.success({
        title: "临时密码已生成",
        content: (
          <Space direction="vertical" size={4}>
            <Typography.Text>账号：{result.loginCredential.username}</Typography.Text>
            <Typography.Text copyable>临时密码：{result.loginCredential.temporaryPassword}</Typography.Text>
            <Typography.Text type="secondary">
              此密码只显示一次，请交给业务员。业务员下次登录后必须先修改密码。
            </Typography.Text>
          </Space>
        )
      });
    } else {
      messageApi.success("密码已重置");
    }
    await loadClientUsers();
  };

  return (
    <Space direction="vertical" size={16} className="full-width">
      {contextHolder}
      {modalContextHolder}
      <Modal
        title="编辑业务员账号"
        open={Boolean(editingClientUser)}
        onCancel={() => setEditingClientUser(null)}
        onOk={() => void saveClientUserAccount()}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" requiredMark={false}>
          <Form.Item
            label="业务员姓名"
            name="displayName"
            rules={[{ required: true, message: "请输入业务员姓名" }]}
          >
            <Input placeholder="请输入业务员姓名" />
          </Form.Item>
          <Form.Item
            label="登录账号"
            name="username"
            rules={[{ required: true, message: "请输入登录账号" }]}
          >
            <Input autoComplete="username" placeholder="请输入全系统唯一的登录账号" />
          </Form.Item>
          <Form.Item label="联系方式" name="contact">
            <Input placeholder="手机号、邮箱或其他联系方式" />
          </Form.Item>
          <Space direction="vertical" size={4} className="full-width">
            <Typography.Text type="secondary">所属客户：本客户</Typography.Text>
            <Typography.Text type="secondary">角色：客户业务员</Typography.Text>
            <Typography.Text type="secondary">
              状态：{editingClientUser?.status === "archived" ? "停用" : "启用"}
            </Typography.Text>
          </Space>
        </Form>
      </Modal>
      <Card
        title="客户员工管理"
        className="section-card"
        extra={<Button onClick={() => navigate("/client/orders")}>客户订单</Button>}
      >
        <Space direction="vertical" size={8}>
          <Typography.Text>
            管理本客户业务员账号申请，并维护启用和停用业务员。
          </Typography.Text>
          <Typography.Text type="secondary">
            主管不能停用自己，也不能管理其他客户账号；业务员停用后会进入回收区，历史订单不会删除。
          </Typography.Text>
        </Space>
      </Card>

      <ClientBusinessUserRegistrationCard />

      <Card title="启用业务员账号" className="section-card">
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={activeBusinessUsers}
          pagination={false}
          columns={[
            { title: "业务员姓名", dataIndex: "displayName" },
            {
              title: "联系方式",
              dataIndex: "contact",
              render: (value?: string) => value || <Typography.Text type="secondary">-</Typography.Text>
            },
            {
              title: "登录账号",
              render: (_: unknown, clientUser: ClientUserAccountSummary) =>
                clientUser.loginUsername ?? (clientUser.hasLoginAccount ? "已绑定" : "未创建")
            },
            {
              title: "账号范围",
              dataIndex: "clientAccessScope",
              width: 140,
              render: (scope: ClientAccessScope) => <Tag color="blue">{clientScopeLabels[scope] ?? scope}</Tag>
            },
            {
              title: "状态",
              width: 100,
              render: () => <Tag color="green">启用</Tag>
            },
            {
              title: "操作",
              width: 260,
              render: (_: unknown, clientUser: ClientUserAccountSummary) => (
                <Space wrap>
                  <Button size="small" onClick={() => openEditClientUser(clientUser)}>
                    编辑账号
                  </Button>
                  <Button size="small" onClick={() => void resetClientUserPassword(clientUser)}>
                    重置密码
                  </Button>
                  <Button size="small" danger onClick={() => void setClientUserStatus(clientUser, "archived")}>
                    停用业务员
                  </Button>
                </Space>
              )
            }
          ]}
          locale={{ emptyText: "暂无业务员账号" }}
        />
      </Card>

      <Collapse
        size="small"
        className="customer-account-archive-collapse"
        items={[
          {
            key: "archived-business-users",
            label: `停用业务员回收区（${archivedBusinessUsers.length}）`,
            children: (
              <Table
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={archivedBusinessUsers}
                pagination={false}
                columns={[
                  { title: "业务员姓名", dataIndex: "displayName" },
                  {
                    title: "登录账号",
                    render: (_: unknown, clientUser: ClientUserAccountSummary) =>
                      clientUser.loginUsername ?? (clientUser.hasLoginAccount ? "已绑定" : "未创建")
                  },
                  {
                    title: "联系方式",
                    dataIndex: "contact",
                    render: (value?: string) => value || <Typography.Text type="secondary">-</Typography.Text>
                  },
                  {
                    title: "停用时间",
                    render: (_: unknown, clientUser: ClientUserAccountSummary) =>
                      clientUser.archivedAt ? new Date(clientUser.archivedAt).toLocaleString() : "-"
                  },
                  {
                    title: "停用人",
                    render: (_: unknown, clientUser: ClientUserAccountSummary) => clientUser.archivedBy || "-"
                  },
                  {
                    title: "操作",
                    width: 220,
                    render: (_: unknown, clientUser: ClientUserAccountSummary) => (
                      <Space wrap>
                        <Button size="small" onClick={() => openEditClientUser(clientUser)}>
                          编辑账号
                        </Button>
                        <Button size="small" type="primary" onClick={() => void setClientUserStatus(clientUser, "active")}>
                          恢复业务员
                        </Button>
                      </Space>
                    )
                  }
                ]}
                locale={{ emptyText: "暂无停用业务员" }}
              />
            )
          }
        ]}
      />
    </Space>
  );
}
