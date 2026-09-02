import { Alert, Button, Card, Form, Input, Space, Typography, message } from "antd";
import { useNavigate } from "react-router-dom";
import { sampleRoomApi, type ChangeOwnPasswordPayload } from "../../api/sampleRoomApi";
import { useAuthSession } from "../../app/AuthSessionContext";
import { returnToNativeTabletLogin } from "../qc/tabletNativeBridge";

export function ForcePasswordChangePage() {
  const navigate = useNavigate();
  const { logout } = useAuthSession();
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<ChangeOwnPasswordPayload>();

  const submit = async () => {
    const values = await form.validateFields();
    await sampleRoomApi.changeOwnPassword(values);
    messageApi.success("密码已修改，请重新登录");
    await logout();
    returnToNativeTabletLogin();
    navigate("/login", { replace: true });
  };

  return (
    <Space direction="vertical" size={16} className="full-width force-password-page">
      {contextHolder}
      <Card title="请先修改密码" className="section-card account-security-force-card">
        <Space direction="vertical" size={16} className="full-width">
          <Alert
            type="warning"
            showIcon
            message="你的密码已被管理员重置，请先修改密码。"
            description="修改完成后需要重新登录，之后才能进入业务页面。"
          />
          <Form form={form} layout="vertical" requiredMark={false}>
            <Form.Item
              label="当前密码 / 临时密码"
              name="currentPassword"
              rules={[{ required: true, message: "请输入当前密码或临时密码" }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Form.Item
              label="新密码"
              name="newPassword"
              rules={[
                { required: true, message: "请输入新密码" },
                { min: 8, message: "新密码至少 8 位" }
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              label="确认新密码"
              name="confirmPassword"
              dependencies={["newPassword"]}
              rules={[
                { required: true, message: "请再次输入新密码" },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    return !value || getFieldValue("newPassword") === value
                      ? Promise.resolve()
                      : Promise.reject(new Error("两次输入的新密码不一致"));
                  }
                })
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Space direction="vertical" size={8}>
              <Button type="primary" onClick={() => void submit()}>
                修改密码并重新登录
              </Button>
              <Typography.Text type="secondary">
                账号名称不能在这里修改，如需更换登录账号请联系客户主管或老板。
              </Typography.Text>
            </Space>
          </Form>
        </Space>
      </Card>
    </Space>
  );
}
