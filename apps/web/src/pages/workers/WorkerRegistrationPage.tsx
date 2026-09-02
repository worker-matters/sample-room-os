import { Alert, Button, Card, Form, Input, Space, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { sampleRoomApi, type WorkerAccountRegistrationInfo } from "../../api/sampleRoomApi";

type RegistrationValues = {
  name: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
};

export function WorkerRegistrationPage() {
  const { token } = useParams();
  const [registration, setRegistration] = useState<WorkerAccountRegistrationInfo>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string>();
  const [messageApi, contextHolder] = message.useMessage();

  const load = useCallback(async () => {
    if (!token) { setError("注册链接无效"); setLoading(false); return; }
    try {
      setRegistration((await sampleRoomApi.getWorkerAccountRegistration(token)).registration);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "注册链接无效或已作废");
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (values: RegistrationValues) => {
    if (!token) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await sampleRoomApi.completeWorkerAccountRegistration(token, {
        name: values.name,
        phoneNumber: values.phoneNumber,
        password: values.password
      });
      setCompleted(true);
      messageApi.success(result.restored ? "原账号和历史记录已恢复" : "员工账号注册成功");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "注册失败");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="worker-token-page">
      {contextHolder}
      <Card className="section-card worker-token-card">
        <Space direction="vertical" size={16} className="full-width">
          <div>
            <Typography.Title level={3}>生产员工账号注册</Typography.Title>
            <Typography.Text type="secondary">注册后使用手机号和密码登录微信小程序或 Android 应用。</Typography.Text>
          </div>
          {loading ? <Alert type="info" message="正在读取注册链接..." /> : null}
          {error ? <Alert type="error" showIcon message={error} /> : null}
          {registration ? (
            <Space direction="vertical" size={12} className="full-width">
              <Space wrap>
                <Tag color={registration.enabled ? "green" : "default"}>{registration.enabled ? "注册链接有效" : "注册链接已失效"}</Tag>
                <Tag color="blue">老板指定工序：{registration.workerTypeLabel}</Tag>
              </Space>
              <Alert type="info" showIcon message="工序已由老板确定，员工不能自行选择。若该手机号曾被归档，将恢复原账号和历史工作记录。" />
              {completed ? (
                <Alert type="success" showIcon message="注册完成" description="如需继续注册其他员工，可返回扫码页面重新扫码；当前注册码仍保持有效。" />
              ) : registration.enabled ? (
                <Form<RegistrationValues> layout="vertical" requiredMark={false} onFinish={(values) => void submit(values)}>
                  <Form.Item label="姓名" name="name" rules={[{ required: true, message: "请输入姓名" }]}>
                    <Input autoComplete="name" placeholder="请输入真实姓名" />
                  </Form.Item>
                  <Form.Item label="登录手机号" name="phoneNumber" rules={[{ required: true, message: "请输入手机号" }]}>
                    <Input inputMode="tel" autoComplete="username" placeholder="以后用这个手机号登录" />
                  </Form.Item>
                  <Form.Item label="设置密码" name="password" rules={[{ required: true }, { min: 8, message: "密码至少 8 位" }]}>
                    <Input.Password autoComplete="new-password" placeholder="至少 8 位" />
                  </Form.Item>
                  <Form.Item label="确认密码" name="confirmPassword" dependencies={["password"]} rules={[
                    { required: true, message: "请再次输入密码" },
                    ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue("password") === value ? Promise.resolve() : Promise.reject(new Error("两次密码不一致")); } })
                  ]}>
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={submitting} block>完成注册</Button>
                </Form>
              ) : null}
            </Space>
          ) : null}
        </Space>
      </Card>
    </div>
  );
}
