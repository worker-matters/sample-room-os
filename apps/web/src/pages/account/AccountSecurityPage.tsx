import { ArrowLeftOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Space, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  sampleRoomApi,
  type AccountSecurityProfile,
  type ChangeOwnPasswordPayload,
  type UpdateOwnAccountProfilePayload
} from "../../api/sampleRoomApi";
import { useAuthSession } from "../../app/AuthSessionContext";
import { useDevSession } from "../../app/DevSessionContext";
import { isNativeTabletRuntime, returnToNativeTabletLogin } from "../qc/tabletNativeBridge";

export function AccountSecurityPage() {
  const navigate = useNavigate();
  const { session } = useDevSession();
  const { logout } = useAuthSession();
  const [messageApi, contextHolder] = message.useMessage();
  const [profile, setProfile] = useState<AccountSecurityProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [profileForm] = Form.useForm<UpdateOwnAccountProfilePayload>();
  const [passwordForm] = Form.useForm<ChangeOwnPasswordPayload>();
  const isWorker = profile?.accountType === "worker" || session.role === "worker";
  const isTabletWorkbenchAccount = isNativeTabletRuntime() && (
    session.role === "receiver" || session.role === "planner" ||
    (session.role === "worker" && session.activeWorkerType === "qc_delivery")
  );
  const canRenameAccount = session.role === "receiver" || session.role === "pattern_maker" || session.role === "planner" || session.role === "boss" || session.role === "system_owner" || session.role === "client_admin" || session.role === "client_business_user";
  const profileHelp = isWorker
    ? "组检/出库员工使用手机号登录；修改手机号后需要使用新手机号重新登录。"
    : session.role === "system_owner"
    ? "System Owner 可以维护自己的登录用户名、姓名、联系方式和密码；修改用户名后需要重新登录。"
    : session.role === "boss"
    ? "老板可以维护自己的登录用户名、姓名、联系方式和密码；修改用户名后需要重新登录。"
    : session.role === "pattern_maker"
    ? "版师可以维护自己的登录用户名、姓名、联系方式和密码；修改用户名后需要重新登录。"
    : session.role === "client_admin" || session.role === "client_business_user"
      ? "客户账号可以维护自己的登录用户名、姓名、联系方式和密码；修改用户名后需要重新登录。"
      : canRenameAccount
      ? "接单员和计划员可以维护自己的登录用户名、姓名、联系方式和密码；修改用户名后需要重新登录。"
      : "你可以在这里维护自己的姓名、联系方式和密码。";

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      try {
        const result = await sampleRoomApi.getAccountSecurityProfile();
        if (cancelled) {
          return;
        }
        setProfile(result.profile);
        profileForm.setFieldsValue({
          ...(result.profile.username !== null ? { username: result.profile.username } : {}),
          ...(result.profile.phoneNumber !== null ? { phoneNumber: result.profile.phoneNumber } : {}),
          displayName: result.profile.displayName,
          ...(result.profile.contact !== undefined ? { contact: result.profile.contact } : {})
        });
      } catch (error) {
        if (!cancelled) {
          messageApi.error(error instanceof Error ? error.message : "加载账号资料失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [messageApi, profileForm]);

  const saveProfile = async () => {
    const values = await profileForm.validateFields();
    const credentialChanged = isWorker
      ? values.phoneNumber !== profile?.phoneNumber
      : canRenameAccount && values.username !== profile?.username;
    const result = await sampleRoomApi.updateOwnAccountProfile(values);
    setProfile(result.profile);
    profileForm.setFieldsValue({
      ...(result.profile.username !== null ? { username: result.profile.username } : {}),
      ...(result.profile.phoneNumber !== null ? { phoneNumber: result.profile.phoneNumber } : {}),
      displayName: result.profile.displayName,
      ...(result.profile.contact !== undefined ? { contact: result.profile.contact } : {})
    });
    if (credentialChanged) {
      messageApi.success(isWorker ? "登录手机号已更新，请使用新手机号重新登录" : "登录用户名已更新，请使用新用户名重新登录");
      await logout();
      if (!returnToNativeTabletLogin()) navigate("/login", { replace: true });
      return;
    }
    messageApi.success("账号资料已更新");
  };

  const changePassword = async () => {
    const values = await passwordForm.validateFields();
    await sampleRoomApi.changeOwnPassword(values);
    messageApi.success("密码已修改，请重新登录");
    await logout();
    if (!returnToNativeTabletLogin()) navigate("/login", { replace: true });
  };

  const tabletReturnPath = session.role === "receiver"
    ? "/receiver/tablet"
    : session.role === "planner"
      ? "/planner/tablet"
      : "/qc/tablet";

  return (
    <Space direction="vertical" size={16} className={`full-width account-security-page${isTabletWorkbenchAccount ? " tablet-account-security" : ""}`}>
      {contextHolder}
      {isTabletWorkbenchAccount ? (
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(tabletReturnPath)}>返回工作台</Button>
      ) : null}
      <Card title="账号与安全" className="section-card" loading={loading}>
        <Space direction="vertical" size={16} className="full-width">
          <Alert
            type="info"
            showIcon
            message={profileHelp}
          />
          <Form form={profileForm} layout="vertical" requiredMark={false}>
            <div className="account-security-grid">
              {isWorker ? (
                <Form.Item
                  label="手机号"
                  name="phoneNumber"
                  rules={[{ required: true, message: "请输入登录手机号" }]}
                >
                  <Input inputMode="tel" autoComplete="tel" />
                </Form.Item>
              ) : (
                <Form.Item
                  label="登录账号"
                  name="username"
                  {...(canRenameAccount ? { rules: [{ required: true, message: "请输入登录用户名" }] } : {})}
                >
                  <Input disabled={!canRenameAccount} autoComplete="username" />
                </Form.Item>
              )}
              {profile?.customerName ? <Form.Item label="所属客户"><Input value={profile.customerName} disabled /></Form.Item> : null}
              <Form.Item label="角色">
                <Input value={profile?.roleLabel ?? ""} disabled />
              </Form.Item>
              <Form.Item
                label="姓名 / 显示名"
                name="displayName"
                rules={[{ required: true, message: "请输入姓名或显示名" }]}
              >
                <Input placeholder="请输入姓名或显示名" />
              </Form.Item>
              {!isWorker ? <Form.Item label="联系方式" name="contact">
                <Input placeholder="手机号、邮箱或其他联系方式" />
              </Form.Item> : null}
              {canRenameAccount || isWorker ? (
                <Form.Item
                  label={isWorker ? "当前密码（修改手机号时必填）" : "当前密码（修改登录用户名时必填）"}
                  name="currentPassword"
                  dependencies={[isWorker ? "phoneNumber" : "username"]}
                  rules={[({ getFieldValue }) => ({
                    validator(_, value) {
                      const unchanged = isWorker
                        ? getFieldValue("phoneNumber") === profile?.phoneNumber
                        : getFieldValue("username") === profile?.username;
                      return unchanged || value
                        ? Promise.resolve()
                        : Promise.reject(new Error(isWorker ? "修改手机号需要验证当前密码" : "修改登录用户名需要验证当前密码"));
                    }
                  })]}
                >
                  <Input.Password autoComplete="current-password" />
                </Form.Item>
              ) : null}
            </div>
            <Button type="primary" onClick={() => void saveProfile()}>
              保存资料
            </Button>
          </Form>
        </Space>
      </Card>

      <Card title="修改密码" className="section-card">
        <Form form={passwordForm} layout="vertical" requiredMark={false}>
          <Form.Item
            label="当前密码"
            name="currentPassword"
            rules={[{ required: true, message: "请输入当前密码" }]}
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
            <Button type="primary" onClick={() => void changePassword()}>
              修改密码
            </Button>
            <Typography.Text type="secondary">
              修改成功后需要重新登录，之后请使用新密码进入系统。
            </Typography.Text>
          </Space>
        </Form>
      </Card>

    </Space>
  );
}
