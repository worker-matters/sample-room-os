import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuthSession } from "../../app/AuthSessionContext";
import { getFormalPostLoginPath } from "../../app/formalRouting";
import { loginPayloadForAccount } from "../../api/sampleRoomApi";
import { BrandLockup } from "../../components/BrandLockup";
import {
  acceptsQcTabletLogin,
  isQcTabletLoginTarget,
  qcTabletLoginError
} from "./qcTabletLoginBoundary";

type LoginFormValues = {
  username: string;
  password: string;
};

const invalidCredentialErrors = new Set(["invalid_credentials", "unauthenticated"]);

function loginErrorMessage(error: unknown) {
  if (error instanceof Error && invalidCredentialErrors.has(error.message)) {
    return "账号或密码不正确。";
  }

  if (error instanceof Error && error.message === "formal_auth_disabled") {
    return "当前服务未启用正式登录模式，请确认 AUTH_MODE=formal。";
  }

  return "登录失败，请稍后重试。";
}

export function FormalLoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activateDeveloperEntry, isDeveloperEntryUsername, login } = useAuthSession();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const returnTo =
    typeof location.state === "object" &&
    location.state !== null &&
    "returnTo" in location.state
      ? location.state.returnTo
      : undefined;

  const submitLogin = async (values: LoginFormValues) => {
    setError(null);

    if (activateDeveloperEntry(values.username)) {
      return;
    }

    if (isDeveloperEntryUsername(values.username)) {
      setError(loginErrorMessage(new Error("invalid_credentials")));
      return;
    }

    setSubmitting(true);
    try {
      const user = await login(loginPayloadForAccount(values.username, values.password),
        (candidate) => acceptsQcTabletLogin(returnTo, candidate)
      );
      if (isQcTabletLoginTarget(returnTo) && !acceptsQcTabletLogin(returnTo, user)) {
        setError(qcTabletLoginError);
        return;
      }
      const target = getFormalPostLoginPath(user, {
        preferMobileHome: window.matchMedia("(max-width: 768px)").matches,
        returnTo
      });
      if (target === "/worker/mobile") {
        // A hard navigation re-enters main.tsx so formal cutting/sewing workers use the
        // lightweight H5 bootstrap instead of carrying the already-loaded desktop shell.
        window.location.replace(target);
        return;
      }
      navigate(target, { replace: true });
    } catch (loginError) {
      setError(loginErrorMessage(loginError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="formal-login-page">
      <main className="formal-login-grid">
        <section className="formal-login-brand" aria-label="样品管理理念">
          <Typography.Title level={2}>样品管理 · 高效有序</Typography.Title>
          <Typography.Text>规范管理&nbsp;&nbsp;|&nbsp;&nbsp;快速查找&nbsp;&nbsp;|&nbsp;&nbsp;安全可控</Typography.Text>
        </section>

        <Card className="formal-login-card">
          <header className="formal-login-heading">
            <BrandLockup className="formal-login-card-lockup" />
            <Typography.Title level={1} className="formal-login-title">
              样品间管理系统
            </Typography.Title>
            <Typography.Text>Web 登录</Typography.Text>
          </header>

          {error ? <Alert className="formal-login-error" type="error" showIcon message={error} /> : null}

          <Form
            name="sample-room-login"
            autoComplete="on"
            layout="vertical"
            requiredMark={false}
            onFinish={submitLogin}
          >
            <Form.Item
              label="账号 / 手机号"
              name="username"
              rules={[{ required: true, message: "请输入账号或手机号。" }]}
            >
              <Input
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                disabled={submitting}
                placeholder="请输入账号或手机号"
                autoFocus
              />
            </Form.Item>

            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: "请输入密码。" }]}
            >
              <Input.Password
                name="password"
                autoComplete="current-password"
                disabled={submitting}
                placeholder="请输入密码"
              />
            </Form.Item>

            <Button className="formal-login-submit" type="primary" htmlType="submit" loading={submitting} block>
              登录
            </Button>
          </Form>

          <Typography.Text className="formal-login-note">
            登录后将按账号权限进入对应工作台
          </Typography.Text>
        </Card>
      </main>
    </div>
  );
}
