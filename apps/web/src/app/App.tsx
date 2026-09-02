import { Button, Dropdown, Layout, Menu, Select, Space, Spin, Tag, Typography, message } from "antd";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  matchPath,
  useLocation,
  useNavigate
} from "react-router-dom";
import { Suspense, useEffect, type ReactNode } from "react";
import {
  DevSessionProvider,
  roleHomePaths,
  roleLabels,
  sessionRoleLabel,
  useDevSession,
  type DevRole,
  type DevSession
} from "./DevSessionContext";
import { AuthSessionProvider, useAuthSession } from "./AuthSessionContext";
import { getFormalRoleHomePath, isSafeInternalReturnPath } from "./formalRouting";
import { routes, type AppRoute } from "../routes/routes";
import { DevelopmentLoginPage } from "../pages/login/DevelopmentLoginPage";
import { FormalLoginPage } from "../pages/login/FormalLoginPage";
import { SampleTypeOptionsProvider } from "./SampleTypeOptionsContext";
import {
  isNativeTabletRuntime,
  reportNativeTabletReady,
  returnToNativeTabletLogin
} from "../pages/qc/tabletNativeBridge";
import { TabletNetworkControl } from "../components/tablet/TabletNetworkControl";
import sampleRoomOsMark from "../assets/sample-room-os-mark.svg";

const { Header, Sider, Content } = Layout;

const roleOptions: Array<{ label: string; value: DevRole }> = [
  { label: "客户主管", value: "client_admin" },
  { label: "客户业务员", value: "client_business_user" },
  { label: "接单员", value: "receiver" },
  { label: "版师", value: "pattern_maker" },
  { label: "计划员", value: "planner" },
  { label: "老板", value: "boss" },
  { label: "System Owner", value: "system_owner" }
];

const clientScopeLabels: Record<string, string> = {
  own: "本人订单",
  customer_all: "本客户全部订单"
};

const forcePasswordPath = "/account/force-password";
const tabletWorkbenchPaths = new Set(["/qc/tablet", "/receiver/tablet", "/planner/tablet"]);

function protectedRoutes() {
  return routes.filter((route) => route.path !== "/login");
}

function publicTokenRoutes() {
  return routes.filter((route) => route.path !== "/login" && !route.roles && route.hideInNavigation);
}

function isPublicTokenPath(pathname: string) {
  return publicTokenRoutes().some((route) => matchPath({ path: route.path, end: true }, pathname));
}

function renderRouteComponent(route: AppRoute) {
  return (
    <Suspense
      fallback={
        <Spin tip="页面加载中...">
          <span aria-hidden="true" />
        </Spin>
      }
    >
      <route.Component />
    </Suspense>
  );
}

function PublicTokenRoutes() {
  return (
    <Routes>
      {publicTokenRoutes().map((route) => (
        <Route key={route.path} path={route.path} element={renderRouteComponent(route)} />
      ))}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

function prefersMobileHome() {
  return window.matchMedia("(max-width: 768px)").matches;
}

export function canSessionOpenRoute(route: AppRoute, session: DevSession) {
  if (route.roles && !route.roles.includes(session.role)) {
    return false;
  }

  if (
    route.workerTypes &&
    session.role === "worker" &&
    (!session.activeWorkerType || !route.workerTypes.includes(session.activeWorkerType))
  ) {
    return false;
  }

  if (route.clientAccessScopes) {
    return (
      (session.role === "client_admin" || session.role === "client_business_user") &&
      session.clientAccessScope !== undefined &&
      route.clientAccessScopes.includes(session.clientAccessScope)
    );
  }

  return true;
}

function visibleRoutes(session: DevSession, options: { formalMode?: boolean | undefined } = {}) {
  return protectedRoutes().filter((route) => {
    if (route.hideInNavigation) {
      return false;
    }

    if (options.formalMode && route.hideInFormalNavigation) {
      return false;
    }

    return canSessionOpenRoute(route, session);
  });
}

function routeElement(route: AppRoute, session: DevSession, homePath: string) {
  if (session.mustChangePassword && route.path !== forcePasswordPath) {
    return <Navigate to={forcePasswordPath} replace />;
  }

  if (!session.mustChangePassword && route.path === forcePasswordPath) {
    return <Navigate to={homePath} replace />;
  }

  if (!canSessionOpenRoute(route, session)) {
    return <Navigate to={homePath} replace />;
  }

  return renderRouteComponent(route);
}

function ShellRoutes({
  devMode = false,
  homePath,
  session
}: {
  devMode?: boolean;
  homePath?: string | undefined;
  session: DevSession;
}) {
  const effectiveHomePath = homePath ?? getFormalRoleHomePath(session);

  return (
    <Routes>
      <Route path="/" element={<Navigate to={devMode ? "/login" : effectiveHomePath} replace />} />
      <Route
        path="/login"
        element={devMode ? <DevelopmentLoginPage /> : <Navigate to={effectiveHomePath} replace />}
      />
      {protectedRoutes().map((route) => (
        <Route key={route.path} path={route.path} element={routeElement(route, session, effectiveHomePath)} />
      ))}
      <Route path="*" element={<Navigate to={devMode ? "/login" : effectiveHomePath} replace />} />
    </Routes>
  );
}

function AppFrame({
  headerActions,
  devMode,
  formalMode,
  homePath,
  session
}: {
  headerActions: ReactNode;
  devMode?: boolean;
  formalMode?: boolean;
  homePath?: string | undefined;
  session: DevSession;
}) {
  const location = useLocation();
  const dataWorkbench = new Set([
    "/receiver",
    "/receiver/orders",
    "/receiver/pending-receive",
    "/planner",
    "/pattern-maker",
    "/admin",
    "/admin/pricing",
    "/system-owner",
    "/system-owner/pricing"
  ]).has(location.pathname);
  const menuRoutes = visibleRoutes(session, { formalMode });
  const plannerDedicatedNavigation = location.pathname === "/planner";
  const bossTablet = session.role === "boss" && isNativeTabletRuntime();
  const framelessWorkerMobile = location.pathname === "/worker/mobile" &&
    session.role === "worker" &&
    (session.activeWorkerType === "cutting" || session.activeWorkerType === "sewing");
  const framelessTabletAccountSecurity = location.pathname === "/account/security" && isNativeTabletRuntime() && (
    session.role === "receiver" || session.role === "planner" ||
    (session.role === "worker" && session.activeWorkerType === "qc_delivery")
  );

  if (
    framelessWorkerMobile ||
    tabletWorkbenchPaths.has(location.pathname) ||
    framelessTabletAccountSecurity ||
    (location.pathname === forcePasswordPath && isNativeTabletRuntime())
  ) {
    return (
      <SampleTypeOptionsProvider session={session}>
        <ShellRoutes devMode={devMode === true} homePath={homePath} session={session} />
      </SampleTypeOptionsProvider>
    );
  }

  return (
    <Layout className={`app-shell${bossTablet ? " boss-tablet-shell" : ""}${dataWorkbench ? " app-data-workbench-shell" : ""}`}>
      <Header className="app-header">
        <div className="app-header-leading">
          {bossTablet ? <TabletNetworkControl /> : null}
          <div className="app-brand-lockup" aria-label="Sample Room OS">
            <img className="app-brand-mark" src={sampleRoomOsMark} alt="" aria-hidden="true" />
            <span className="app-brand-copy" aria-hidden="true">
              <span className="app-brand-name">Sample Room OS</span>
            </span>
          </div>
        </div>
        {headerActions}
      </Header>
      <Layout>
        {plannerDedicatedNavigation ? null : (
          <Sider width={bossTablet ? 180 : 220} className="app-sider">
            <Menu
              mode="inline"
              selectedKeys={[location.pathname]}
              items={menuRoutes.map((route) => ({
                key: route.path,
                label: <NavLink to={route.path}>{route.navLabel}</NavLink>
              }))}
            />
          </Sider>
        )}
        <Content className="app-content">
          <SampleTypeOptionsProvider session={session}>
            <ShellRoutes devMode={devMode === true} homePath={homePath} session={session} />
          </SampleTypeOptionsProvider>
        </Content>
      </Layout>
    </Layout>
  );
}

function DevAppShell() {
  const navigate = useNavigate();
  const { clientProfileId, clientProfiles, session, setClientProfile, setRole } = useDevSession();

  const changeRole = (role: DevRole) => {
    setRole(role);
    navigate(roleHomePaths[role]);
  };

  return (
    <AppFrame
      devMode
      session={session}
      headerActions={
        <Space className="app-header-actions" size={12} wrap>
          <Tag color="gold">开发测试模式</Tag>
          <Typography.Text>测试角色切换</Typography.Text>
          <Select
            value={session.role}
            options={roleOptions}
            onChange={changeRole}
            className="role-select"
          />
          {session.role === "client_admin" || session.role === "client_business_user" ? (
            <Select
              value={clientProfileId}
              options={clientProfiles.map((profile) => ({ label: profile.label, value: profile.id }))}
              onChange={setClientProfile}
              className="client-profile-select"
            />
          ) : null}
          <Tag color="blue">{roleLabels[session.role]}</Tag>
        </Space>
      }
    />
  );
}

function FormalAuthenticatedShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [messageApi, contextHolder] = message.useMessage();
  const { logout } = useAuthSession();
  const { session } = useDevSession();
  const homePath = getFormalRoleHomePath(session, { preferMobileHome: prefersMobileHome() });
  const scopeLabel = session.clientAccessScope
    ? clientScopeLabels[session.clientAccessScope] ?? session.clientAccessScope
    : undefined;
  const isMobileWorkbench =
    location.pathname === "/receiver/mobile" ||
    location.pathname === "/planner/mobile" ||
    location.pathname === "/worker/mobile";

  useEffect(() => {
    if (isNativeTabletRuntime()) reportNativeTabletReady();
  }, []);

  const handleLogout = async () => {
    const result = await logout();
    if (result.warning) {
      void messageApi.warning(result.warning);
    }
    if (!returnToNativeTabletLogin()) navigate("/login", { replace: true });
  };

  const accountMenu = {
    items: [
      { key: "security", label: "账号与安全" },
      { type: "divider" as const },
      { key: "logout", label: "退出登录" }
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "security") {
        navigate("/account/security");
        return;
      }

      if (key === "logout") {
        void handleLogout();
      }
    }
  };

  return (
    <>
      {contextHolder}
      <AppFrame
        formalMode
        homePath={homePath}
        session={session}
        headerActions={
          <Space className="app-header-actions" size={10} wrap>
            <Tag color="green">正式登录</Tag>
            <Tag color="blue">{sessionRoleLabel(session)}</Tag>
            {scopeLabel ? <Tag color="cyan">{scopeLabel}</Tag> : null}
            {["client_admin", "client_business_user", "receiver", "pattern_maker", "planner", "boss", "system_owner"].includes(session.role) && !isMobileWorkbench ? (
              <Dropdown menu={accountMenu} trigger={["click"]}>
                <Button>{session.displayName}</Button>
              </Dropdown>
            ) : (
              <>
                <Typography.Text strong>{session.displayName}</Typography.Text>
                <Button onClick={handleLogout}>退出登录</Button>
              </>
            )}
          </Space>
        }
      />
    </>
  );
}

function FormalShell() {
  const location = useLocation();
  const { session, status } = useAuthSession();

  if (isPublicTokenPath(location.pathname)) {
    return <PublicTokenRoutes />;
  }

  if (status === "checking") {
    return (
      <Layout className="app-shell">
        <Content className="app-content auth-check-content">
          <Spin tip="正在检查登录状态...">
            <span aria-hidden="true" />
          </Spin>
        </Content>
      </Layout>
    );
  }

  if (!session) {
    if (isNativeTabletRuntime()) {
      return <NativeTabletLoginHandoff />;
    }
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    const loginState = isSafeInternalReturnPath(returnTo) && location.pathname !== "/login"
      ? { returnTo }
      : undefined;

    return (
      <Routes>
        <Route path="/login" element={<FormalLoginPage />} />
        {publicTokenRoutes().map((route) => (
          <Route key={route.path} path={route.path} element={renderRouteComponent(route)} />
        ))}
        <Route path="*" element={<Navigate to="/login" replace state={loginState} />} />
      </Routes>
    );
  }

  return (
    <DevSessionProvider sessionOverride={session}>
      <FormalAuthenticatedShell />
    </DevSessionProvider>
  );
}

function NativeTabletLoginHandoff() {
  useEffect(() => {
    returnToNativeTabletLogin();
  }, []);
  return null;
}

function AppByAuthMode() {
  const location = useLocation();
  const { authMode } = useAuthSession();
  const nativeTabletRuntime = isNativeTabletRuntime();

  useEffect(() => {
    document.documentElement.classList.toggle("native-tablet-runtime", nativeTabletRuntime);
    return () => document.documentElement.classList.remove("native-tablet-runtime");
  }, [nativeTabletRuntime]);

  if (isPublicTokenPath(location.pathname)) {
    return <PublicTokenRoutes />;
  }

  if (authMode === "formal") {
    return <FormalShell />;
  }

  return (
    <DevSessionProvider>
      <DevAppShell />
    </DevSessionProvider>
  );
}

export function App() {
  return (
    <AuthSessionProvider>
      <AppByAuthMode />
    </AuthSessionProvider>
  );
}
