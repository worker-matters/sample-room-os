import { CLIENT_ACCESS_SCOPES } from "@sample-room/shared";
import { Button, Card, Form, Input, Modal, Space, Table, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  sampleRoomApi,
  type BusinessUserRequestRecord,
  type BusinessUserRequestStatus,
  type CreateBusinessUserRequestPayload
} from "../api/sampleRoomApi";
import { useDevSession } from "../app/DevSessionContext";

const statusColor: Record<BusinessUserRequestStatus, string> = {
  pending: "gold",
  approved: "green",
  rejected: "red"
};

const statusLabel: Record<BusinessUserRequestStatus, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已拒绝"
};

function RequestStatusTag({ status }: { status: BusinessUserRequestStatus }) {
  return <Tag color={statusColor[status]}>{statusLabel[status]}</Tag>;
}

export function ClientBusinessUserRequestCard() {
  const { session } = useDevSession();
  const [form] = Form.useForm<CreateBusinessUserRequestPayload>();
  const [messageApi, contextHolder] = message.useMessage();
  const [requests, setRequests] = useState<BusinessUserRequestRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const isCustomerAdmin = session.clientAccessScope === CLIENT_ACCESS_SCOPES.customerAll;

  const loadRequests = useCallback(async () => {
    if (!isCustomerAdmin) {
      setRequests([]);
      return;
    }

    setLoading(true);
    try {
      const result = await sampleRoomApi.listClientBusinessUserRequests(session);
      setRequests(result.requests);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载业务员账号申请失败");
    } finally {
      setLoading(false);
    }
  }, [isCustomerAdmin, messageApi, session]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  if (!isCustomerAdmin) {
    return null;
  }

  const submitRequest = async () => {
    const values = await form.validateFields();
    await sampleRoomApi.createClientBusinessUserRequest(session, values);
    messageApi.success("业务员账号申请已提交，等待老板或 System Owner 审批");
    form.resetFields();
    setOpen(false);
    await loadRequests();
  };

  return (
    <Card
      title="申请新增业务员账号"
      className="section-card"
      extra={<Button type="primary" onClick={() => setOpen(true)}>新增业务员</Button>}
    >
      {contextHolder}
      <Space direction="vertical" size={12} className="full-width">
        <Typography.Text type="secondary">
          主管账号可提交新增业务员申请。审批通过后，老板或 System Owner 会生成正式登录账号和临时密码。
        </Typography.Text>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={requests}
          pagination={false}
          columns={[
            { title: "业务员姓名", dataIndex: "businessUserName" },
            { title: "联系方式", dataIndex: "contact" },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (status: BusinessUserRequestStatus) => <RequestStatusTag status={status} />
            },
            {
              title: "提交时间",
              dataIndex: "createdAt",
              width: 180,
              render: (value: string) => new Date(value).toLocaleString()
            }
          ]}
        />
      </Space>
      <Modal
        title="申请新增业务员账号"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submitRequest()}
        okText="提交申请"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="业务员姓名"
            name="businessUserName"
            rules={[{ required: true, message: "请输入业务员姓名" }]}
          >
            <Input placeholder="例如 王小样" />
          </Form.Item>
          <Form.Item
            label="邮箱或手机号"
            name="contact"
            rules={[{ required: true, message: "请输入邮箱或手机号" }]}
          >
            <Input placeholder="例如 13800000000 或 user@example.com" />
          </Form.Item>
          <Form.Item label="职位/角色说明" name="roleNote">
            <Input placeholder="例如 跟单业务员 / 版房对接人" />
          </Form.Item>
          <Form.Item label="备注 / 申请说明" name="note">
            <Input.TextArea rows={3} placeholder="补充申请原因或账号用途" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

export function InternalBusinessUserRequestReviewCard() {
  const { session } = useDevSession();
  const [messageApi, contextHolder] = message.useMessage();
  const [requests, setRequests] = useState<BusinessUserRequestRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const result = await sampleRoomApi.listAllBusinessUserRequests(session);
      setRequests(result.requests);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载客户业务员账号申请失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi, session]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const review = async (
    request: BusinessUserRequestRecord,
    status: Exclude<BusinessUserRequestStatus, "pending">
  ) => {
    const result = await sampleRoomApi.reviewBusinessUserRequest(session, request.id, {
      status,
      reviewNote:
        status === "approved"
          ? "审批通过并生成或绑定客户业务员正式登录账号。"
          : "申请已拒绝，不创建业务员账号。"
    });

    if (result.loginCredential) {
      Modal.info({
        title: "业务员登录账号已生成",
        content: (
          <Space direction="vertical" size={8}>
            <Typography.Text>
              账号：<Typography.Text copyable strong>{result.loginCredential.username}</Typography.Text>
            </Typography.Text>
            <Typography.Text>
              临时密码：<Typography.Text copyable strong>{result.loginCredential.temporaryPassword}</Typography.Text>
            </Typography.Text>
            <Typography.Text type="secondary">
              请由老板线下交付给客户业务员。后续正式邀请、密码重置和短信/邮件发送仍是账号管理增强项。
            </Typography.Text>
          </Space>
        )
      });
    }

    messageApi.success(status === "approved" ? "已批准并处理账号" : "已拒绝申请");
    await loadRequests();
  };

  return (
    <Card title="客户业务员账号申请" className="section-card">
      {contextHolder}
      <Space direction="vertical" size={12} className="full-width">
        <Typography.Text type="secondary">
          批准后会创建或绑定客户业务员正式登录账号，并返回账号与临时密码供老板线下交付。
        </Typography.Text>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={requests}
          pagination={false}
          columns={[
            { title: "客户", dataIndex: "customerName" },
            { title: "申请人", dataIndex: "requestedByName" },
            { title: "申请业务员", dataIndex: "businessUserName" },
            { title: "联系方式", dataIndex: "contact" },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (status: BusinessUserRequestStatus) => <RequestStatusTag status={status} />
            },
            {
              title: "操作",
              width: 180,
              render: (_: unknown, request: BusinessUserRequestRecord) =>
                request.status === "pending" ? (
                  <Space>
                    <Button size="small" type="primary" onClick={() => void review(request, "approved")}>
                      批准
                    </Button>
                    <Button size="small" danger onClick={() => void review(request, "rejected")}>
                      拒绝
                    </Button>
                  </Space>
                ) : (
                  <Typography.Text type="secondary">已处理</Typography.Text>
                )
            }
          ]}
        />
      </Space>
    </Card>
  );
}
