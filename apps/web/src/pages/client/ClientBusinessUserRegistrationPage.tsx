import { Alert, Button, Card, Form, Input, Space, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  sampleRoomApi,
  type BusinessUserRegistrationInfo,
  type SubmitBusinessUserRegistrationPayload
} from "../../api/sampleRoomApi";

type RegistrationFormValues = SubmitBusinessUserRegistrationPayload & {
  confirmPassword: string;
};

export function ClientBusinessUserRegistrationPage() {
  const { token } = useParams();
  const [form] = Form.useForm<RegistrationFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [registration, setRegistration] = useState<BusinessUserRegistrationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError("注册链接无效");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await sampleRoomApi.getPublicBusinessUserRegistrationCode(token);
      setRegistration(result.registration);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "注册链接无效或已关闭");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (values: RegistrationFormValues) => {
    if (!token) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await sampleRoomApi.submitPublicBusinessUserRegistration(token, {
        businessUserName: values.businessUserName,
        contact: values.contact,
        username: values.username,
        password: values.password,
        ...(values.roleNote ? { roleNote: values.roleNote } : {}),
        ...(values.note ? { note: values.note } : {})
      });
      setSubmitted(true);
      messageApi.success("注册申请已提交");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "注册申请提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = !registration?.enabled;

  return (
    <div className="worker-token-page client-register-page">
      {contextHolder}
      <Card className="section-card worker-token-card client-register-card">
        <Space direction="vertical" size={16} className="full-width">
          <div>
            <Typography.Title level={3}>业务员注册申请</Typography.Title>
            <Typography.Text type="secondary">
              这个页面只用于提交本客户业务员账号申请。提交后需要老板审批，通过后才能登录系统。
            </Typography.Text>
          </div>

          {loading ? <Alert type="info" message="正在读取注册链接..." /> : null}
          {error ? <Alert type="error" showIcon message={error} /> : null}

          {registration?.code ? (
            <Space wrap>
              <Tag color={registration.enabled ? "green" : "default"}>
                {registration.enabled ? "注册码可用" : "注册码已关闭"}
              </Tag>
              <Tag color="blue">{registration.code.customerName}</Tag>
              <Typography.Text type="secondary">
                开启人：{registration.code.createdByName}
              </Typography.Text>
            </Space>
          ) : null}

          {submitted ? (
            <Alert
              type="success"
              showIcon
              message="注册申请已提交，等待老板审批"
              description="审批通过后，你可以用刚才填写的账号和密码登录。"
            />
          ) : null}

          {!submitted && disabled && !loading ? (
            <Alert
              type="warning"
              showIcon
              message={registration?.message ?? "当前注册码不可用，请联系客户主管重新开启。"}
            />
          ) : null}

          {!submitted && registration?.enabled ? (
            <Form
              form={form}
              layout="vertical"
              requiredMark={false}
              onFinish={submit}
            >
              <Form.Item
                label="姓名"
                name="businessUserName"
                rules={[{ required: true, message: "请输入业务员姓名" }]}
              >
                <Input placeholder="例如：王小样" autoComplete="name" />
              </Form.Item>
              <Form.Item
                label="联系方式"
                name="contact"
                rules={[{ required: true, message: "请输入手机号或邮箱" }]}
              >
                <Input placeholder="手机号或邮箱" autoComplete="tel" />
              </Form.Item>
              <Form.Item
                label="登录账号"
                name="username"
                rules={[{ required: true, message: "请输入登录账号" }]}
              >
                <Input placeholder="建议使用邮箱，也可填写英文账号名" autoComplete="username" />
              </Form.Item>
              <Form.Item
                label="登录密码"
                name="password"
                rules={[
                  { required: true, message: "请输入登录密码" },
                  { min: 8, message: "密码至少 8 位" }
                ]}
              >
                <Input.Password placeholder="至少 8 位" autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                label="确认密码"
                name="confirmPassword"
                dependencies={["password"]}
                rules={[
                  { required: true, message: "请再次输入登录密码" },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("password") === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error("两次输入的密码不一致"));
                    }
                  })
                ]}
              >
                <Input.Password placeholder="再次输入密码" autoComplete="new-password" />
              </Form.Item>
              <Form.Item label="职位说明" name="roleNote">
                <Input placeholder="例如：跟单业务员" />
              </Form.Item>
              <Form.Item label="备注" name="note">
                <Input.TextArea rows={3} placeholder="可选" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={submitting} block>
                提交注册申请
              </Button>
            </Form>
          ) : null}
        </Space>
      </Card>
    </div>
  );
}
