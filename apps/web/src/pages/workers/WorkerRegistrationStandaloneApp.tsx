import { useEffect, useState, type FormEvent } from "react";
import sampleRoomOsMark from "../../assets/sample-room-os-mark.svg";
import "./workerRegistrationStandalone.css";

type WorkerType = "cutting" | "sewing" | "qc_delivery";

type RegistrationInfo = {
  enabled: boolean;
  workerType: WorkerType;
  workerTypeLabel: string;
  expiresAt?: string;
};

type RegistrationResult = {
  account: {
    displayName: string;
    phoneNumber: string | null;
  };
  workerProfile: {
    workerType: WorkerType;
    workerTypeLabel: string;
  };
  restored: boolean;
};

type ApiErrorBody = {
  error?: string;
  message?: string;
};

function tokenFromPath() {
  const match = window.location.pathname.match(/^\/workers\/register\/([^/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function errorText(body: unknown, status: number) {
  if (body && typeof body === "object") {
    const candidate = body as ApiErrorBody;
    if (typeof candidate.error === "string" && candidate.error.trim()) return candidate.error.trim();
    if (typeof candidate.message === "string" && candidate.message.trim()) return candidate.message.trim();
  }
  return `HTTP ${status}`;
}

function friendlyError(message: string) {
  if (message.includes("phone_number_already_exists")) return "该手机号已注册";
  if (message.includes("worker name already exists")) return "该姓名已注册";
  if (message.includes("password must be at least 8 characters")) return "密码至少 8 位";
  if (message.includes("registration token") || message.includes("identity token")) {
    return "该注册码已失效，请联系老板重新获取";
  }
  if (message === "Failed to fetch" || message.includes("NetworkError")) {
    return "网络连接失败，请检查网络后重试";
  }
  return message;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

async function loadRegistration(token: string) {
  const response = await fetch(`/api/workers/registration/${encodeURIComponent(token)}`, {
    credentials: "same-origin",
    cache: "no-store"
  });
  const body = await readJson(response);
  if (!response.ok) throw new Error(errorText(body, response.status));
  return (body as { registration: RegistrationInfo }).registration;
}

async function completeRegistration(
  token: string,
  payload: { name: string; phoneNumber: string; password: string }
) {
  const response = await fetch(`/api/workers/registration/${encodeURIComponent(token)}/complete`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await readJson(response);
  if (!response.ok) throw new Error(errorText(body, response.status));
  return body as RegistrationResult;
}

export function WorkerRegistrationStandaloneApp() {
  const token = tokenFromPath();
  const [registration, setRegistration] = useState<RegistrationInfo>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [completed, setCompleted] = useState<RegistrationResult>();
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const refresh = async () => {
    if (!token) {
      setLoadError("注册链接无效");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(undefined);
    try {
      const info = await loadRegistration(token);
      setRegistration(info);
      document.title = "Sample Room OS";
    } catch (error) {
      setLoadError(friendlyError(error instanceof Error ? error.message : "注册链接无效"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.title = "Sample Room OS";
    void refresh();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(undefined);

    const normalizedName = name.trim();
    const normalizedPhone = phoneNumber.trim();
    if (!normalizedName) {
      setSubmitError("请输入姓名");
      return;
    }
    if (!normalizedPhone) {
      setSubmitError("请输入手机号");
      return;
    }
    if (password.length < 8) {
      setSubmitError("密码至少 8 位");
      return;
    }
    if (password !== confirmPassword) {
      setSubmitError("两次密码不一致");
      return;
    }

    setSubmitting(true);
    try {
      const result = await completeRegistration(token, {
        name: normalizedName,
        phoneNumber: normalizedPhone,
        password
      });
      setCompleted(result);
      document.title = "Sample Room OS";
    } catch (error) {
      setSubmitError(friendlyError(error instanceof Error ? error.message : "注册失败，请重试"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="worker-register-page">
      <section className="worker-register-card" aria-live="polite">
        <header className="worker-register-brand">
          <img src={sampleRoomOsMark} alt="" aria-hidden="true" />
          <div>
            <span>Sample Room OS</span>
            <strong>员工注册</strong>
          </div>
        </header>

        {loading ? (
          <div className="worker-register-state">
            <span className="worker-register-spinner" aria-hidden="true" />
            <strong>正在确认注册码</strong>
          </div>
        ) : loadError ? (
          <div className="worker-register-state worker-register-state-error">
            <span className="worker-register-state-icon">!</span>
            <strong>{loadError}</strong>
            <button type="button" className="worker-register-secondary" onClick={() => void refresh()}>
              重新加载
            </button>
          </div>
        ) : registration && !registration.enabled ? (
          <div className="worker-register-state worker-register-state-error">
            <span className="worker-register-state-icon">!</span>
            <strong>注册码已失效</strong>
            <p>请联系老板获取新的注册码</p>
          </div>
        ) : completed ? (
          <div className="worker-register-success">
            <span className="worker-register-check" aria-hidden="true">✓</span>
            <h1>注册成功</h1>
            <div className="worker-register-success-name">{completed.account.displayName}</div>
            <div className="worker-register-role-pill">{completed.workerProfile.workerTypeLabel}</div>
            <p>现在可以使用手机号和密码登录</p>
          </div>
        ) : registration ? (
          <>
            <div className="worker-register-heading">
              <div className="worker-register-role-pill">{registration.workerTypeLabel}</div>
              <h1>创建员工账号</h1>
            </div>

            {submitError ? <div className="worker-register-error">{submitError}</div> : null}

            <form className="worker-register-form" onSubmit={submit}>
              <label>
                <span>姓名</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  placeholder="请输入姓名"
                  disabled={submitting}
                />
              </label>
              <label>
                <span>手机号</span>
                <input
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  inputMode="tel"
                  autoComplete="username"
                  placeholder="以后使用此手机号登录"
                  disabled={submitting}
                />
              </label>
              <label>
                <span>密码</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  placeholder="至少 8 位"
                  disabled={submitting}
                />
              </label>
              <label>
                <span>确认密码</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  placeholder="再次输入密码"
                  disabled={submitting}
                />
              </label>

              <button type="submit" className="worker-register-primary" disabled={submitting}>
                {submitting ? "正在注册…" : "完成注册"}
              </button>
            </form>

            <p className="worker-register-footnote">工序已由老板指定，注册后直接使用手机号登录。</p>
          </>
        ) : null}
      </section>
    </main>
  );
}
