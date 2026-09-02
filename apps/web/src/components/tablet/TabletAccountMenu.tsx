import { DownOutlined, LogoutOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import { Avatar, Button, Dropdown, Space, Typography, message } from "antd";
import { useNavigate } from "react-router-dom";
import { useAuthSession } from "../../app/AuthSessionContext";
import { useDevSession } from "../../app/DevSessionContext";
import { returnToNativeTabletLogin } from "../../pages/qc/tabletNativeBridge";

export function TabletAccountMenu({ roleLabel }: { roleLabel: string }) {
  const navigate = useNavigate();
  const { logout } = useAuthSession();
  const { session } = useDevSession();
  const [messageApi, contextHolder] = message.useMessage();

  const logoutNow = async () => {
    const result = await logout();
    if (result.warning) void messageApi.warning(result.warning);
    if (!returnToNativeTabletLogin()) navigate("/login", { replace: true });
  };

  return (
    <>
      {contextHolder}
      <Dropdown
        trigger={["click"]}
        menu={{
          items: [
            { key: "security", icon: <SafetyCertificateOutlined />, label: "账号与安全" },
            { type: "divider" },
            { key: "logout", icon: <LogoutOutlined />, label: "退出登录", danger: true }
          ],
          onClick: ({ key }) => {
            if (key === "security") navigate("/account/security");
            if (key === "logout") void logoutNow();
          }
        }}
      >
        <Button type="text" size="large" className="tablet-account-trigger">
          <Space size={8}>
            <Avatar size="small" icon={<UserOutlined />} />
            <Typography.Text strong>{session.displayName}（{roleLabel}）</Typography.Text>
            <DownOutlined />
          </Space>
        </Button>
      </Dropdown>
    </>
  );
}
