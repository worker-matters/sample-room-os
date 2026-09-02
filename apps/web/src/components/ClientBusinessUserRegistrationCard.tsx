import { Alert, Button, Card, QRCode, Space, Table, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  sampleRoomApi,
  type BusinessUserRegistrationInfo,
  type BusinessUserRequestRecord,
  type BusinessUserRequestStatus
} from "../api/sampleRoomApi";
import { useDevSession } from "../app/DevSessionContext";

const statusColor: Record<BusinessUserRequestStatus, string> = {
  pending: "gold",
  approved: "green",
  rejected: "red"
};

const statusLabel: Record<BusinessUserRequestStatus, string> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已拒绝"
};

function RequestStatusTag({ status }: { status: BusinessUserRequestStatus }) {
  return <Tag color={statusColor[status]}>{statusLabel[status]}</Tag>;
}

function fullRegistrationUrl(registration: BusinessUserRegistrationInfo) {
  if (!registration.code?.urlPath) {
    return "";
  }

  return registration.code.absoluteUrl ?? registration.code.recommendedUrl ?? "";
}

export function ClientBusinessUserRegistrationCard() {
  const { session } = useDevSession();
  const [messageApi, contextHolder] = message.useMessage();
  const [requests, setRequests] = useState<BusinessUserRequestRecord[]>([]);
  const [registration, setRegistration] = useState<BusinessUserRegistrationInfo>({ enabled: false });
  const [loading, setLoading] = useState(false);

  const registrationUrl = useMemo(() => fullRegistrationUrl(registration), [registration]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [requestResult, registrationResult] = await Promise.all([
        sampleRoomApi.listClientBusinessUserRequests(session),
        sampleRoomApi.getClientBusinessUserRegistrationCode(session)
      ]);
      setRequests(requestResult.requests);
      setRegistration(registrationResult.registration);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载业务员注册信息失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCode = async () => {
    const result = await sampleRoomApi.openClientBusinessUserRegistrationCode(session);
    setRegistration(result.registration);
    messageApi.success("业务员注册二维码已开启");
  };

  const closeCode = async () => {
    const result = await sampleRoomApi.closeClientBusinessUserRegistrationCode(session);
    setRegistration(result.registration);
    messageApi.success("业务员注册二维码已关闭");
  };

  const copyLink = async () => {
    if (!registrationUrl) {
      return;
    }

    await navigator.clipboard.writeText(registrationUrl);
    messageApi.success("注册链接已复制");
  };

  return (
    <Card
      title="业务员注册二维码"
      className="section-card client-registration-card"
      extra={
        <Space wrap>
          {registration.enabled ? (
            <Button onClick={() => void closeCode()}>关闭注册码</Button>
          ) : (
            <Button type="primary" onClick={() => void openCode()}>开启注册码</Button>
          )}
          <Button onClick={() => void load()} loading={loading}>刷新</Button>
        </Space>
      }
    >
      {contextHolder}
      <Space direction="vertical" size={14} className="full-width">
        <Typography.Text type="secondary">
          主管把二维码发给本客户的业务员。业务员扫码后自己填写姓名、联系方式、账号和密码，提交后仍需老板审批才会生效。
        </Typography.Text>

        <div className="client-registration-panel">
          <div className="client-registration-copy">
            <Space wrap>
              <Tag color={registration.enabled ? "green" : "default"}>
                {registration.enabled ? "注册码已开启" : "注册码未开启"}
              </Tag>
              {registration.code ? (
                <Typography.Text type="secondary">
                  开启人：{registration.code.createdByName}
                </Typography.Text>
              ) : null}
            </Space>
            <Typography.Title level={5}>只用于本客户业务员注册</Typography.Title>
            <Typography.Text type="secondary">
              扫码页不进入订单列表，也不会让业务员直接获得权限。老板通过后，业务员才能用自己填写的账号密码登录。
            </Typography.Text>
            {registrationUrl ? (
              <Space wrap className="client-registration-link-row">
                <Typography.Text copyable className="client-registration-link">
                  {registrationUrl}
                </Typography.Text>
                <Button onClick={() => void copyLink()}>复制链接</Button>
              </Space>
            ) : registration.enabled ? (
              <Alert type="warning" showIcon message="尚未配置公网 Web 基础地址，请联系 System Owner 设置后再生成二维码。" />
            ) : null}
          </div>
          <div className="client-registration-qr">
            {registration.enabled && registrationUrl ? (
              <QRCode value={registrationUrl} size={168} />
            ) : (
              <div className="client-registration-qr-placeholder">
                点击“开启注册码”后显示二维码
              </div>
            )}
          </div>
        </div>

        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={requests}
          pagination={{ pageSize: 5, showSizeChanger: false }}
          columns={[
            { title: "业务员", dataIndex: "businessUserName" },
            { title: "联系方式", dataIndex: "contact" },
            {
              title: "登录账号",
              dataIndex: "requestedUsername",
              render: (value?: string) => value || <Typography.Text type="secondary">审批后生成</Typography.Text>
            },
            {
              title: "来源",
              dataIndex: "source",
              width: 120,
              render: (value?: BusinessUserRequestRecord["source"]) =>
                value === "supervisor_registration_code" ? "扫码注册" : "主管提交"
            },
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
          locale={{ emptyText: "暂无业务员注册申请" }}
        />
      </Space>
    </Card>
  );
}
