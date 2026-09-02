import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Space, Switch, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { sampleRoomApi, type MiniappReleasePreviewConfig } from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";

type FormValue = {
  enabled: boolean;
  username: string;
  password?: string;
  expiresInHours: number;
};

export function MiniappReleasePreviewControl({ session }: { session: DevSession }) {
  const [config, setConfig] = useState<MiniappReleasePreviewConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<FormValue>();
  const [messageApi, contextHolder] = message.useMessage();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await sampleRoomApi.getMiniappReleasePreviewConfig(session);
      setConfig(result.config);
      form.setFieldsValue({
        enabled: result.config.enabled,
        username: result.config.username,
        password: "",
        expiresInHours: 8
      });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "测试模式配置加载失败");
    } finally {
      setLoading(false);
    }
  }, [form, messageApi, session]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    const value = await form.validateFields();
    setLoading(true);
    try {
      const result = await sampleRoomApi.updateMiniappReleasePreviewConfig(session, {
        enabled: value.enabled,
        username: value.username.trim(),
        ...(value.password ? { password: value.password } : {}),
        ...(value.enabled ? { expiresInHours: value.expiresInHours } : {})
      });
      setConfig(result.config);
      form.setFieldValue("password", "");
      messageApi.success(value.enabled ? "小程序 release 安全预览已开启" : "小程序 release 安全预览已关闭");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "测试模式配置保存失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card size="small" title="微信小程序 release 安全预览账号">
      {contextHolder}
      <Space direction="vertical" size={16} className="full-width">
        <Alert
          type="warning"
          showIcon
          message="该账号只预览角色 UI，不读取真实订单，也不能执行任何正式写操作。"
          description="开启时间最长 24 小时。保存配置会立即撤销之前的所有测试会话；密码只可重置，系统不会显示原密码。"
        />
        <Descriptions size="small" bordered column={{ xs: 1, md: 3 }}>
          <Descriptions.Item label="当前状态">
            <Tag color={config?.enabled ? "green" : "default"}>{config?.enabled ? "已开启" : "已关闭"}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="已设置密码">{config?.configured ? "是" : "否"}</Descriptions.Item>
          <Descriptions.Item label="到期时间">
            {config?.expiresAt ? new Date(config.expiresAt).toLocaleString() : "-"}
          </Descriptions.Item>
        </Descriptions>
        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ enabled: false, expiresInHours: 8 }}>
          <Form.Item name="enabled" label="允许 release 安全预览" valuePropName="checked">
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
          <Form.Item name="username" label="测试登录用户名" rules={[{ required: true }, { min: 4, max: 80 }]}>
            <Input autoComplete="off" placeholder="例如 miniapp-release-preview" />
          </Form.Item>
          <Form.Item name="password" label="设置/重置测试密码" extra="留空表示保留现有密码；首次开启时必须填写，至少 10 位。">
            <Input.Password autoComplete="new-password" placeholder="至少 10 位" />
          </Form.Item>
          <Form.Item name="expiresInHours" label="本次开启有效时间（小时）" rules={[{ required: true }]}>
            <InputNumber min={1} max={24} precision={0} />
          </Form.Item>
          <Space wrap>
            <Button type="primary" loading={loading} onClick={() => void save()}>保存测试模式配置</Button>
            <Button loading={loading} onClick={() => void load()}>刷新</Button>
          </Space>
        </Form>
        <Typography.Text type="secondary">
          release 预览不会建立 receiver、planner、客户或 Worker 的正式 AccountSession，因此不能成为生产权限入口。
        </Typography.Text>
      </Space>
    </Card>
  );
}
