import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canUserOpenReturnPath,
  getFormalPostLoginPath,
  getFormalRoleHomePath
} from "./formalRouting";
import { sessionRoleLabel, type DevSession } from "./DevSessionContext";
import { canSessionOpenRoute } from "./App";
import { routes } from "../routes/routes";

describe("app shell layout CSS", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8");
  const appSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");
  const brandSvgSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../assets/sample-room-os-mark.svg"),
    "utf8"
  );
  const authSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "AuthSessionContext.tsx"),
    "utf8"
  );
  const formalLoginSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/login/FormalLoginPage.tsx"),
    "utf8"
  );
  const scanTaskSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/scan/ScanTaskPage.tsx"),
    "utf8"
  );
  const routesSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../routes/routes.tsx"),
    "utf8"
  );
  const workerRegistrationPanelSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../components/scan/WorkerRegistrationPanel.tsx"),
    "utf8"
  );
  const workerRegistrationPageSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/workers/WorkerRegistrationPage.tsx"),
    "utf8"
  );
  const workerAccountManagementSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../components/accounts/WorkerAccountManagementPanel.tsx"),
    "utf8"
  );
  const clientWorkbenchSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/client/ClientWorkbenchPage.tsx"),
    "utf8"
  );
  const receiverWorkbenchSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/receiver/ReceiverWorkbenchPage.tsx"),
    "utf8"
  );
  const adminDashboardSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/admin/AdminDashboardPage.tsx"),
    "utf8"
  );
  const accountSecuritySource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/account/AccountSecurityPage.tsx"),
    "utf8"
  );
  const bossPerformanceSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/admin/BossPerformancePage.tsx"),
    "utf8"
  );
  const systemOwnerPageSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/system-owner/SystemOwnerPage.tsx"),
    "utf8"
  );
  const systemOwnerMaintenancePanelSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/system-owner/SystemOwnerMaintenancePanel.tsx"),
    "utf8"
  );
  const systemManagementOverviewPanelSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/system-owner/SystemManagementOverviewPanel.tsx"),
    "utf8"
  );
  const systemHealthPanelSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/system-owner/SystemHealthPanel.tsx"),
    "utf8"
  );
  const operationHistoryPanelSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/system-owner/LifecycleOperationHistoryPanel.tsx"),
    "utf8"
  );
  const advancedMaintenancePanelSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/system-owner/AdvancedMaintenancePanel.tsx"),
    "utf8"
  );
  const storageManagementPanelSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/system-owner/StorageManagementPanel.tsx"),
    "utf8"
  );
  const systemUpdatePanelSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../pages/system-owner/SystemUpdatePanel.tsx"),
    "utf8"
  );
  const bossPricingPanelSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../components/orders/BossPricingPanel.tsx"),
    "utf8"
  );
  const dynamicPricingModalSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../components/orders/DynamicPricingModal.tsx"),
    "utf8"
  );
  const internalAccountPanelSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../components/accounts/InternalAccountManagementPanel.tsx"),
    "utf8"
  );
  const customerAccountPanelSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../components/accounts/CustomerAccountManagementPanel.tsx"),
    "utf8"
  );

  const clientSession: DevSession = {
    authMode: "formal",
    role: "client_business_user",
    userId: "formal-user-client-own",
    displayName: "Client",
    customerId: "mock-customer-active",
    clientUserId: "mock-client-user-active",
    clientAccessScope: "own"
  };

  const customerAdminSession: DevSession = {
    authMode: "formal",
    role: "client_admin",
    userId: "formal-user-client-admin",
    displayName: "Customer A Supervisor",
    customerId: "mock-customer-active",
    clientUserId: "mock-client-admin-active",
    clientAccessScope: "customer_all"
  };

  const receiverSession: DevSession = {
    authMode: "formal",
    role: "receiver",
    userId: "formal-user-receiver",
    displayName: "Receiver"
  };

  const patternMakerSession: DevSession = {
    authMode: "formal",
    role: "pattern_maker",
    userId: "formal-user-pattern-maker",
    displayName: "Pattern Maker"
  };

  const plannerSession: DevSession = {
    authMode: "formal",
    role: "planner",
    userId: "formal-user-planner",
    displayName: "Planner"
  };

  const bossSession: DevSession = {
    authMode: "formal",
    role: "boss",
    userId: "formal-user-boss",
    displayName: "Boss"
  };

  const systemOwnerSession: DevSession = {
    authMode: "formal",
    role: "system_owner",
    userId: "formal-user-system-owner",
    displayName: "System Owner"
  };

  it("keeps the final boss performance design role-specific and free of invented metrics", () => {
    for (const label of ["版师绩效", "裁剪绩效", "缝制绩效", "接单员绩效", "后整绩效", "组检/出库绩效"]) {
      expect(bossPerformanceSource).toContain(label);
    }
    expect(bossPerformanceSource).toContain("完成综合版师任务数");
    expect(bossPerformanceSource).toContain("实际裁剪件数");
    expect(bossPerformanceSource).toContain("每小时产出");
    expect(bossPerformanceSource).toContain("正式录入订单数");
    expect(bossPerformanceSource).toContain("老板录入后整金额总计");
    expect(bossPerformanceSource).toContain("客诉比例");
    expect(bossPerformanceSource).not.toContain("每日产出");
    expect(bossPerformanceSource).not.toContain("后整员工");
    expect(bossPerformanceSource).toContain('error.message === "forbidden"');
    expect(bossPerformanceSource).toContain("登录会话已失效，请重新登录");
    expect(bossPerformanceSource).toContain("initialLoadStarted.current");
  });

  it("keeps the app header tall and visible enough for title and role controls", () => {
    expect(css).toContain(".app-header");
    expect(css).toContain("min-height: 80px;");
    expect(css).toContain("height: auto;");
    expect(css).toContain("overflow: visible;");
    expect(css).toContain("line-height: 1.4;");
  });

  it("uses the Sample Room OS brand lockup without increasing the shared header height", () => {
    expect(appSource).toContain('import sampleRoomOsMark from "../assets/sample-room-os-mark.svg"');
    expect(appSource).toContain('className="app-brand-lockup"');
    expect(appSource).toContain('aria-label="Sample Room OS"');
    expect(appSource).toContain('<span className="app-brand-name">Sample Room OS</span>');
    expect(css).toContain(".app-brand-lockup");
    expect(css).toContain("height: 36px;");
    expect(css).toContain("flex: 0 0 32px;");
    expect(css).toContain("gap: 10px;");
    expect(css).toContain("color: #123b63;");
    expect(css).toContain("color: #7b91a8;");
    expect(css).toContain("font-size: 18px;");
    expect(css).toContain("font-size: 11px;");
    expect(brandSvgSource).toContain('viewBox="0 0 64 64"');
    expect(brandSvgSource).toContain('fill="#173c5a"');
    expect(brandSvgSource).toContain('stroke="#72d5c7"');
  });

  it("adds the compact formal login layout classes without replacing the workbench shell", () => {
    expect(css).toContain(".formal-login-page");
    expect(css).toContain(".formal-login-grid");
    expect(css).toContain("width: min(100%, 980px);");
    expect(css).toContain("grid-template-columns: 330px minmax(0, 500px);");
    expect(css).toContain("linear-gradient(135deg, #f7faff 0%, #e7f0fc 52%, #dce9f9 100%)");
    expect(formalLoginSource).toContain("样品间管理系统");
    expect(formalLoginSource).toContain("样品管理 · 高效有序");
    expect(formalLoginSource).toContain("Web 登录");
    expect(formalLoginSource).toContain('label="账号 / 手机号"');
    expect(formalLoginSource).not.toContain("扫码配置网络");
  });

  it("defaults the frontend to formal auth while retaining the explicit compatibility flag", () => {
    expect(authSource).toContain("VITE_AUTH_MODE");
    expect(authSource).toContain('if (!value || value === "formal")');
    expect(authSource).toContain("Use \"dev\" or \"formal\"");
  });

  it("loads route pages lazily while keeping the login bootstrap eager", () => {
    const eagerPageImports = routesSource
      .split(/\r?\n/)
      .filter((line) => line.startsWith("import ") && line.includes('from "../pages/'));

    expect(eagerPageImports).toEqual([
      'import { DevelopmentLoginPage } from "../pages/login/DevelopmentLoginPage";'
    ]);

    for (const page of [
      "AccountSecurityPage",
      "ForcePasswordChangePage",
      "AdminDashboardPage",
      "ClientMobilePage",
      "ClientBusinessUserRegistrationPage",
      "ClientOrdersPage",
      "ClientUserManagementPage",
      "ClientWorkbenchPage",
      "HelpPage",
      "PatternTaskWorkbenchPage",
      "PlannerWorkbenchPage",
      "ReceiverMobilePage",
      "ReceiverWorkbenchPage",
      "ScanTaskPage",
      "QcTabletPage",
      "SystemOwnerPage",
      "WorkerRegistrationPage"
    ]) {
      expect(routesSource).toContain(`default: module.${page}`);
    }

    expect(appSource).toContain("<Suspense");
    expect(appSource).toContain("renderRouteComponent(route)");
  });

  it("hides dev role controls from the formal authenticated shell", () => {
    expect(appSource).toContain("FormalAuthenticatedShell");
    expect(appSource).toContain("正式登录");
    expect(appSource).toContain("退出登录");
    expect(appSource).toContain("开发测试模式");

    const formalShellSource = appSource.slice(
      appSource.indexOf("function FormalAuthenticatedShell"),
      appSource.indexOf("function FormalShell")
    );
    expect(formalShellSource).not.toContain("role-select");
    expect(formalShellSource).not.toContain("client-profile-select");
    expect(formalShellSource).not.toContain("DevelopmentLoginPage");
  });

  it("keeps formal desktop navigation free of mobile route entries", () => {
    expect(routesSource).toContain('path: "/client/register/:token"');
    expect(routesSource).toContain('path: "/client/mobile"');
    expect(routesSource).toContain('path: "/receiver/mobile"');
    expect(routesSource).toContain('path: "/planner/mobile"');
    expect(routesSource).toContain('path: "/qc/tablet"');
    expect(routesSource).toContain('workerTypes: ["qc_delivery"]');
    expect(appSource).toContain("route.workerTypes.includes(session.activeWorkerType)");
    expect(appSource).toContain("if (!canSessionOpenRoute(route, session))");
    expect(routesSource.match(/hideInFormalNavigation: true/g)).toHaveLength(11);
    expect(routesSource).toContain('path: "/dev/scan-simulator"');
    expect(routesSource).toContain("import.meta.env.DEV");
    expect(appSource).toContain("route.hideInFormalNavigation");
    expect(appSource).toContain("route.hideInNavigation");
  });

  it("wires customer account security and forced-password routes outside sidebar navigation", () => {
    expect(routesSource).toContain("AccountSecurityPage");
    expect(routesSource).toContain("ForcePasswordChangePage");
    expect(routesSource).toContain('path: "/account/security"');
    expect(routesSource).toContain('path: "/account/force-password"');
    expect(appSource).toContain("const forcePasswordPath = \"/account/force-password\"");
    expect(appSource).toContain("session.mustChangePassword");
    expect(appSource).toContain("navigate(\"/account/security\")");
    expect(appSource).toContain("Dropdown");

    const accountSecurityRoute = routesSource.slice(
      routesSource.indexOf('path: "/account/security"'),
      routesSource.indexOf('path: "/account/force-password"')
    );

    expect(accountSecurityRoute).toContain('roles: ["client_admin", "client_business_user", "receiver", "pattern_maker", "planner", "boss", "system_owner", "worker"]');
    expect(accountSecurityRoute).toContain('workerTypes: ["qc_delivery"]');
    expect(accountSecurityRoute).toContain("hideInNavigation: true");
    expect(appSource).toContain('["client_admin", "client_business_user", "receiver", "pattern_maker", "planner", "boss", "system_owner"].includes(session.role)');
    expect(canUserOpenReturnPath(patternMakerSession, "/account/security")).toBe(true);
    expect(canUserOpenReturnPath(bossSession, "/account/security")).toBe(true);
    expect(canUserOpenReturnPath(systemOwnerSession, "/account/security")).toBe(true);
    expect(accountSecuritySource).toContain('session.role === "boss"');
    expect(accountSecuritySource).toContain('session.role === "system_owner"');
    expect(accountSecuritySource).toContain('session.role === "pattern_maker"');
    expect(accountSecuritySource).toContain("版师可以维护自己的登录用户名、姓名、联系方式和密码；修改用户名后需要重新登录。");
    expect(accountSecuritySource).toContain("System Owner 可以维护自己的登录用户名");
    expect(accountSecuritySource).not.toContain("WechatBindingControl");
    expect(accountSecuritySource).not.toContain("device-bind");


    const forcePasswordRoute = routesSource.slice(
      routesSource.indexOf('path: "/account/force-password"'),
      routesSource.indexOf('path: "/client"')
    );

    expect(forcePasswordRoute).not.toContain("roles:");
    expect(forcePasswordRoute).toContain("hideInNavigation: true");
  });

  it("applies account-security worker type restrictions only to worker sessions", () => {
    const accountSecurityRoute = routes.find((route) => route.path === "/account/security");
    expect(accountSecurityRoute).toBeDefined();

    expect(canSessionOpenRoute(accountSecurityRoute!, receiverSession)).toBe(true);
    expect(canSessionOpenRoute(accountSecurityRoute!, plannerSession)).toBe(true);
    expect(canSessionOpenRoute(accountSecurityRoute!, bossSession)).toBe(true);
    expect(canSessionOpenRoute(accountSecurityRoute!, {
      authMode: "formal",
      role: "worker",
      userId: "formal-user-qc",
      displayName: "QC",
      activeWorkerType: "qc_delivery"
    })).toBe(true);
    expect(canSessionOpenRoute(accountSecurityRoute!, {
      authMode: "formal",
      role: "worker",
      userId: "formal-user-sewing",
      displayName: "Sewing",
      activeWorkerType: "sewing"
    })).toBe(false);
  });

  it("hides test instructions from formal navigation while preserving the dev help route", () => {
    const helpRouteStart = routesSource.indexOf('path: "/help"');
    expect(helpRouteStart).toBeGreaterThan(-1);

    const helpRoute = routesSource.slice(helpRouteStart);

    expect(helpRoute).toContain('path: "/help"');
    expect(helpRoute).toContain("HelpPage");
    expect(helpRoute).toContain("hideInFormalNavigation: true");
    expect(helpRoute).not.toContain("hideInNavigation: true");
    expect(appSource).toContain("options.formalMode && route.hideInFormalNavigation");
  });

  it("keeps mobile routes available as protected formal routes", () => {
    const clientMobileRoute = routesSource.slice(
      routesSource.indexOf('path: "/client/mobile"'),
      routesSource.indexOf('path: "/receiver"')
    );
    const receiverMobileRoute = routesSource.slice(
      routesSource.indexOf('path: "/receiver/mobile"'),
      routesSource.indexOf('path: "/admin"')
    );
    const plannerMobileRoute = routesSource.slice(
      routesSource.indexOf('path: "/planner/mobile"'),
      routesSource.indexOf('path: "/admin"')
    );

    expect(clientMobileRoute).toContain('roles: ["client_admin", "client_business_user"]');
    expect(receiverMobileRoute).toContain('roles: ["receiver"]');
    expect(plannerMobileRoute).toContain('roles: ["planner"]');
    expect(clientMobileRoute).toContain("hideInFormalNavigation: true");
    expect(receiverMobileRoute).toContain("hideInFormalNavigation: true");
    expect(plannerMobileRoute).toContain("hideInFormalNavigation: true");
  });

  it("keeps customer supervisor formal navigation to employee management and orders only", () => {
    expect(routesSource).toContain('path: "/client/users"');
    expect(routesSource).toContain("ClientUserManagementPage");
    expect(routesSource).toContain("clientAccessScopes: [CLIENT_ACCESS_SCOPES.own]");
    expect(routesSource).toContain("clientAccessScopes: [CLIENT_ACCESS_SCOPES.customerAll]");
    expect(appSource).toContain("canSessionOpenRoute");
    expect(appSource).toContain("route.clientAccessScopes.includes(session.clientAccessScope)");
    expect(canUserOpenReturnPath(customerAdminSession, "/client/users")).toBe(true);
    expect(canUserOpenReturnPath(customerAdminSession, "/client/orders")).toBe(true);
    expect(canUserOpenReturnPath(customerAdminSession, "/client")).toBe(false);
    expect(canUserOpenReturnPath(clientSession, "/client")).toBe(true);
    expect(canUserOpenReturnPath(clientSession, "/client/users")).toBe(false);
  });

  it("keeps receiver formal desktop navigation to the three current primary work entries", () => {
    expect(routesSource).toContain('path: "/receiver"');
    expect(routesSource).toContain('path: "/receiver/pending-receive"');
    expect(routesSource).toContain('path: "/receiver/orders"');
    expect(routesSource).toContain('navLabel: "订单录入"');
    expect(routesSource).toContain('navLabel: "待接单"');
    expect(routesSource).toContain('navLabel: "订单列表"');
    expect(routesSource).toContain('initialTab="self-entry"');
    expect(routesSource).toContain('initialTab="pending"');
    expect(routesSource).toContain('initialTab="list"');
    expect(routesSource).not.toContain('initialTab="drafts"');
    expect(routesSource).not.toContain('navLabel: "待补资料"');
    expect(routesSource).toContain("hideInNavigation: true");
  });

  it("keeps the pattern maker workbench without historical device QR routes", () => {
    expect(routesSource).toContain('path: "/pattern-maker"');
    expect(routesSource).not.toContain('path: "/pattern-maker/devices"');
    expect(routesSource).toContain("PatternTaskWorkbenchPage");
    expect(routesSource).not.toContain("PatternMakerDevicesPage");
    expect(routesSource).toContain('roles: ["pattern_maker"]');
    expect(routesSource).not.toContain('path: "/cutting-room"');
    expect(routesSource).not.toContain("CuttingRoomPage");
    expect(routesSource).toContain("hideInFormalNavigation: true");
    expect(routesSource).not.toContain('"pattern_maker", "system_owner"');
    expect(routesSource).not.toContain('"pattern_maker", "boss", "system_owner"');
    expect(routesSource).not.toContain('"pattern_maker", "receiver", "boss", "system_owner"');
    expect(appSource).toContain('{ label: "版师", value: "pattern_maker" }');
  });

  it("keeps formal unauthenticated redirects pointed at login with a return target", () => {
    expect(appSource).toContain("const returnTo = `${location.pathname}${location.search}${location.hash}`");
    expect(appSource).toContain("state={loginState}");
    expect(appSource).toContain("location.pathname !== \"/login\"");
    expect(appSource).toContain("publicTokenRoutes()");
    expect(appSource).toContain("isPublicTokenPath(location.pathname)");
    expect(appSource).toContain("PublicTokenRoutes");
    expect(routesSource).toContain('path: "/scan/:token"');
    expect(routesSource).toContain('path: "/workers/register/:token"');
    expect(routesSource).toContain("ScanTaskPage");
    expect(routesSource).toContain("WorkerRegistrationPage");
    expect(routesSource).toContain("hideInNavigation: true");
  });

  it("shows the formal Worker header label from the active worker type", () => {
    expect(sessionRoleLabel({ role: "worker", activeWorkerType: "cutting" })).toBe("裁剪");
    expect(sessionRoleLabel({ role: "worker", activeWorkerType: "sewing" })).toBe("缝制");
    expect(sessionRoleLabel({ role: "worker", activeWorkerType: "qc_delivery" })).toBe("组检/出库");
    expect(appSource).toContain("sessionRoleLabel(session)");
    expect(formalLoginSource).toContain("acceptsQcTabletLogin");
    expect(authSource).toContain("if (!acceptUser(result.user))");
    expect(authSource).toContain("await sampleRoomApi.logout()");
    expect(formalLoginSource).not.toContain('navigate("/help"');
  });

  it("returns a formally authenticated worker to the hidden scan page", () => {
    const workerSession = { role: "worker" } as never;
    expect(getFormalPostLoginPath(workerSession, { returnTo: "/scan/order_scan_qc" })).toBe(
      "/scan/order_scan_qc"
    );
    expect(getFormalPostLoginPath(workerSession, { returnTo: "/admin" })).not.toBe("/admin");
    expect(scanTaskSource).toContain('navigate("/login", {');
    expect(scanTaskSource).toContain('state: { returnTo: `/scan/${encodeURIComponent(token)}` }');
  });

  it("renders public worker token routes outside the formal app shell even with a session", () => {
    const publicRouteSource = appSource.slice(
      appSource.indexOf("function PublicTokenRoutes"),
      appSource.indexOf("function prefersMobileHome")
    );
    const appByAuthModeSource = appSource.slice(
      appSource.indexOf("function AppByAuthMode"),
      appSource.indexOf("export function App")
    );
    const formalShellSource = appSource.slice(
      appSource.indexOf("function FormalShell"),
      appSource.indexOf("function AppByAuthMode")
    );

    expect(publicRouteSource).toContain("publicTokenRoutes().map");
    expect(publicRouteSource).not.toContain("AppFrame");
    expect(publicRouteSource).not.toContain("FormalAuthenticatedShell");
    expect(appByAuthModeSource.indexOf("isPublicTokenPath(location.pathname)")).toBeLessThan(
      appByAuthModeSource.indexOf('authMode === "formal"')
    );
    expect(formalShellSource.indexOf("isPublicTokenPath(location.pathname)")).toBeLessThan(
      formalShellSource.indexOf('status === "checking"')
    );
  });

  it("returns allowed mobile users to their requested H5 route after login", () => {
    expect(canUserOpenReturnPath(clientSession, "/client/mobile")).toBe(true);
    expect(canUserOpenReturnPath(receiverSession, "/receiver/mobile")).toBe(true);
    expect(getFormalPostLoginPath(clientSession, { returnTo: "/client/mobile" })).toBe(
      "/client/mobile"
    );
    expect(getFormalPostLoginPath(receiverSession, { returnTo: "/receiver/mobile" })).toBe(
      "/receiver/mobile"
    );
  });

  it("falls back to the role home when a mobile return target does not match the role", () => {
    expect(canUserOpenReturnPath(clientSession, "/receiver/mobile")).toBe(false);
    expect(canUserOpenReturnPath(receiverSession, "/client/mobile")).toBe(false);
    expect(getFormalPostLoginPath(clientSession, { returnTo: "/receiver/mobile" })).toBe(
      "/client"
    );
    expect(getFormalPostLoginPath(receiverSession, { returnTo: "/client/mobile" })).toBe(
      "/receiver"
    );
  });

  it("keeps desktop role landing unchanged while preferring H5 routes on mobile viewport", () => {
    expect(getFormalRoleHomePath(clientSession)).toBe("/client");
    expect(getFormalRoleHomePath(customerAdminSession)).toBe("/client/users");
    expect(getFormalRoleHomePath(receiverSession)).toBe("/receiver");
    expect(getFormalRoleHomePath(patternMakerSession)).toBe("/pattern-maker");
    expect(getFormalRoleHomePath(plannerSession)).toBe("/planner");
    expect(getFormalRoleHomePath(clientSession, { preferMobileHome: true })).toBe(
      "/client/mobile"
    );
    expect(getFormalRoleHomePath(receiverSession, { preferMobileHome: true })).toBe(
      "/receiver/mobile"
    );
    expect(getFormalRoleHomePath(plannerSession, { preferMobileHome: true })).toBe(
      "/planner/mobile"
    );
    expect(getFormalRoleHomePath(patternMakerSession, { preferMobileHome: true })).toBe(
      "/pattern-maker"
    );
  });

  it("adds planner web and mobile routing without exposing it to clients", () => {
    expect(routesSource).toContain('path: "/planner"');
    expect(routesSource).toContain("PlannerWorkbenchPage");
    expect(routesSource).toContain('roles: ["planner"]');
    expect(appSource).toContain('{ label: "计划员", value: "planner" }');
    expect(canUserOpenReturnPath(plannerSession, "/planner/mobile")).toBe(true);
    expect(canUserOpenReturnPath(clientSession, "/planner/mobile")).toBe(false);
  });

  it("rejects historical pattern maker device return targets and allows system owner maintenance sections", () => {
    expect(canUserOpenReturnPath(patternMakerSession, "/pattern-maker")).toBe(true);
    expect(canUserOpenReturnPath(patternMakerSession, "/pattern-maker/devices")).toBe(false);
    expect(canUserOpenReturnPath(patternMakerSession, "/cutting-room")).toBe(false);
    expect(canUserOpenReturnPath(systemOwnerSession, "/cutting-room")).toBe(false);
    expect(canUserOpenReturnPath(systemOwnerSession, "/system-owner/maintenance")).toBe(true);
    expect(canUserOpenReturnPath(systemOwnerSession, "/system-owner/performance")).toBe(true);
    expect(canUserOpenReturnPath(systemOwnerSession, "/system-owner/internal-accounts")).toBe(true);
    expect(canUserOpenReturnPath(bossSession, "/cutting-room")).toBe(false);
    expect(canUserOpenReturnPath(clientSession, "/cutting-room")).toBe(false);
    expect(getFormalPostLoginPath(patternMakerSession, { returnTo: "/cutting-room" })).toBe(
      "/pattern-maker"
    );
    expect(getFormalPostLoginPath(patternMakerSession, { returnTo: "/pattern-maker/devices" })).toBe("/pattern-maker");
  });

  it("allows boss deep links to the left-sidebar management sections", () => {
    expect(canUserOpenReturnPath(bossSession, "/admin/pricing")).toBe(true);
    expect(canUserOpenReturnPath(bossSession, "/admin/workers")).toBe(true);
    expect(canUserOpenReturnPath(bossSession, "/admin/accounts")).toBe(true);
    expect(canUserOpenReturnPath(bossSession, "/admin/internal-accounts")).toBe(true);
    expect(canUserOpenReturnPath(receiverSession, "/admin/pricing")).toBe(false);
    expect(routesSource).toContain('Component: () => <AdminDashboardPage section="pricing" />');
    expect(routesSource).toContain('Component: () => <AdminDashboardPage section="workers" />');
  });

  it("uses system owner left-sidebar sections without a separate business-user request tab", () => {
    expect(routesSource).toContain('path: "/system-owner"');
    expect(routesSource).toContain('path: "/system-owner/pricing"');
    expect(routesSource).toContain('path: "/system-owner/performance"');
    expect(routesSource).toContain('path: "/system-owner/customers"');
    expect(routesSource).toContain('path: "/system-owner/internal-accounts"');
    expect(routesSource).toContain('path: "/system-owner/workers"');
    expect(routesSource).toContain('path: "/system-owner/maintenance"');
    expect(routesSource).toContain('navLabel: "订单与终止"');
    expect(routesSource).toContain('navLabel: "定价对账"');
    expect(routesSource).toContain('navLabel: "员工绩效"');
    expect(routesSource).toContain('navLabel: "客户与账号"');
    expect(routesSource).toContain('navLabel: "内部账号"');
    expect(routesSource).toContain('navLabel: "员工管理"');
    expect(routesSource).toContain('navLabel: "系统管理"');
    expect(systemOwnerPageSource).toContain("BossOrderManagementPanel");
    expect(systemOwnerPageSource).toContain("BossPricingPanel");
    expect(systemOwnerPageSource).toContain("BossPerformancePage");
    expect(systemOwnerPageSource).toContain("CustomerAccountManagementPanel");
    expect(systemOwnerPageSource).toContain("InternalAccountManagementPanel");
    expect(systemOwnerPageSource).toContain("WorkerRegistrationPanel");
    expect(systemOwnerPageSource).toContain("SystemOwnerMaintenancePanel");
    expect(systemOwnerPageSource).not.toContain("RoleTaskRoomHeader");
    expect(systemOwnerPageSource).not.toContain("InternalBusinessUserRequestReviewCard");
    expect(systemOwnerPageSource).not.toContain("<Tabs");
    expect(systemOwnerPageSource).not.toContain("业务员申请");
  });

  it("keeps the hidden developer entry config-gated on the formal login page", () => {
    expect(authSource).toContain("VITE_ENABLE_DEV_ENTRY");
    expect(authSource).toContain("VITE_DEV_ENTRY_CODE");
    expect(authSource).toContain("DEV-SRO-7396");
    expect(authSource).toContain('setAuthMode("dev")');
    expect(authSource).toContain("activateDeveloperEntry");
    expect(formalLoginSource).toContain("activateDeveloperEntry(values.username)");
    expect(formalLoginSource).toContain("isDeveloperEntryUsername(values.username)");
    expect(formalLoginSource.indexOf("activateDeveloperEntry(values.username)")).toBeLessThan(
      formalLoginSource.indexOf("login(loginPayloadForAccount(values.username, values.password)")
    );
  });

  it("uses boss-issued Web registration URLs and direct WorkerProfile stage management", () => {
    expect(workerRegistrationPanelSource).toContain("WorkerAccountManagementPanel");
    expect(workerAccountManagementSource).toContain("公网注册链接");
    expect(workerAccountManagementSource).toContain("局域网注册链接");
    expect(workerAccountManagementSource).toContain("changeWorkerIdentityStage");
    expect(workerAccountManagementSource).toContain("archiveWorkerIdentityAccounts");
    expect(workerAccountManagementSource).toContain("删除所选账号");
    expect(workerAccountManagementSource).toContain("历史岗位");
    expect(workerAccountManagementSource).not.toContain("createWorkerRoleBindToken");

    expect(workerRegistrationPageSource).toContain("生产员工账号注册");
    expect(workerRegistrationPageSource).toContain("老板指定工序");
    expect(workerRegistrationPageSource).toContain("登录手机号");
    expect(workerRegistrationPageSource).toContain("原账号和历史记录已恢复");
    expect(workerRegistrationPageSource).not.toContain("getCurrentWorkerDeviceBinding");
    expect(workerRegistrationPageSource).not.toContain("stageOptions");
    expect(clientWorkbenchSource).not.toContain("WorkerRegistrationPanel");
    expect(receiverWorkbenchSource).not.toContain("WorkerRegistrationPanel");
  });

  it("replaces boss pricing/export placeholders with a protected pricing panel", () => {
    expect(adminDashboardSource).toContain("BossPricingPanel");
    expect(adminDashboardSource).toContain("renderAdminSection");
    expect(adminDashboardSource).not.toContain("tabPosition=\"left\"");
    expect(adminDashboardSource).not.toContain("<Tabs");
    expect(routesSource).toContain('path: "/admin/pricing"');
    expect(routesSource).toContain('path: "/admin/workers"');
    expect(routesSource).toContain('path: "/admin/accounts"');
    expect(routesSource).toContain('path: "/admin/internal-accounts"');
    expect(routesSource).toContain('navLabel: "定价对账"');
    expect(routesSource).toContain('navLabel: "员工管理"');
    expect(routesSource).toContain('navLabel: "客户与账号"');
    expect(routesSource).toContain('navLabel: "内部账号"');
    expect(adminDashboardSource).not.toContain("定价管理");
    expect(adminDashboardSource).not.toContain("报表导出");
    expect(adminDashboardSource).not.toContain("待迁移");

    expect(bossPricingPanelSource).toContain("定价对账");
    expect(bossPricingPanelSource).toContain("生成对账单");
    expect(bossPricingPanelSource).not.toContain("生成对账单并下载 Excel");
    expect(bossPricingPanelSource).toContain("对账单");
    expect(bossPricingPanelSource).toContain("批量退回到待对账");
    expect(bossPricingPanelSource).toContain("DynamicPricingModal");
    expect(bossPricingPanelSource).not.toContain("客户报价 · 样衣单价");
    expect(bossPricingPanelSource).not.toContain("特殊 / 例外内部成本");
    expect(bossPricingPanelSource).toContain("OrderAttachmentThumbnail");
    expect(bossPricingPanelSource).toContain("sampleRoomApi.downloadAdminOrderAttachment");
    expect(dynamicPricingModalSource).toContain("内部成本（客户不可见）");
    expect(dynamicPricingModalSource).toContain("客户报价小计");
    expect(dynamicPricingModalSource).toContain("确认客户报价");
    expect(dynamicPricingModalSource).toContain("新增成本项");
    expect(dynamicPricingModalSource).toContain("新增收费项");
    expect(dynamicPricingModalSource).toContain("其他费用明细（");
    expect(dynamicPricingModalSource).toContain("pageSize={5}");
    expect(dynamicPricingModalSource).not.toContain("新增其他费用");
    expect(dynamicPricingModalSource).not.toContain("定价：");
    expect(bossPricingPanelSource).toContain("sampleRoomApi.listAdminPricingRows");
    expect(bossPricingPanelSource).toContain("sampleRoomApi.createAdminReconciliationStatement");
    expect(bossPricingPanelSource).toContain("sampleRoomApi.returnAdminReconciliationStatement");
    expect(bossPricingPanelSource).toContain("sampleRoomApi.markAdminReconciliationStatementPaid");
    expect(bossPricingPanelSource).toContain("客户版对账单");
  });

  it("adds boss internal web account management without mixing it into client accounts", () => {
    expect(adminDashboardSource).toContain("InternalAccountManagementPanel");
    expect(routesSource).toContain('navLabel: "客户与账号"');
    expect(routesSource).toContain('navLabel: "内部账号"');
    expect(adminDashboardSource).not.toContain("RoleTaskRoomHeader");
    expect(customerAccountPanelSource).toContain('title="客户管理"');
    expect(customerAccountPanelSource).toContain('session.authMode === "dev"');
    expect(customerAccountPanelSource).toContain("客户/业务员资料与登录账号已经分离");
    expect(customerAccountPanelSource).toContain("客户可以没有主管，也可以有多个主管");
    expect(customerAccountPanelSource).toContain("业务员资料数");
    expect(customerAccountPanelSource).toContain("登录账号数");
    expect(customerAccountPanelSource).toContain("主管账号数");
    expect(customerAccountPanelSource).toContain("历史订单");
    expect(customerAccountPanelSource).toContain("停用业务员及登录");
    expect(customerAccountPanelSource).toContain("仅禁止登录（高级选项）");
    expect(customerAccountPanelSource).toContain("恢复业务员");
    expect(customerAccountPanelSource).toContain("生成账号");
    expect(customerAccountPanelSource).not.toContain("查看账号");
    expect(customerAccountPanelSource).not.toContain("停用资料");
    expect(customerAccountPanelSource).toContain("设为主管");
    expect(customerAccountPanelSource).toContain("改为普通业务员");
    expect(customerAccountPanelSource).toContain("批量创建客户");
    expect(customerAccountPanelSource).toContain("批量录入业务员");
    expect(customerAccountPanelSource).toContain("导入前预览");
    expect(customerAccountPanelSource).toContain("确认创建");
    expect(customerAccountPanelSource).toContain("客户业务员注册申请");
    expect(customerAccountPanelSource).toContain("updateCustomerAccount");
    expect(customerAccountPanelSource).toContain("updateClientUserAccount");
    expect(customerAccountPanelSource).toContain("resetClientUserAccountPassword");
    expect(customerAccountPanelSource).toContain("updateClientUserAccountStatus");
    expect(customerAccountPanelSource).toContain("createClientUserLoginAccount");
    expect(customerAccountPanelSource).toContain("updateClientUserLoginStatus");
    expect(customerAccountPanelSource).toContain("updateClientUserLoginRole");
    expect(customerAccountPanelSource).not.toContain("每个客户必须有且只能有一个主管");
    expect(customerAccountPanelSource).not.toContain("删除业务员");
    expect(internalAccountPanelSource).toContain("接单员、计划员、版师和老板");
    expect(internalAccountPanelSource).toContain("账号统计");
    expect(internalAccountPanelSource).toContain("老板账号不计入合计");
    expect(internalAccountPanelSource).toContain("新增内部账号");
    expect(internalAccountPanelSource).toContain("createInternalAccount");
    expect(internalAccountPanelSource).toContain('value: "receiver"');
    expect(internalAccountPanelSource).toContain('value: "planner"');
    expect(internalAccountPanelSource).toContain('value: "pattern_maker"');
    expect(internalAccountPanelSource).toContain('value: "boss" as const');
    expect(internalAccountPanelSource).toContain('session.role === "system_owner"');
    expect(internalAccountPanelSource).toContain("System Owner 可以新增老板及普通内部账号。");
    expect(internalAccountPanelSource).toContain("老板可以新增接单员、计划员和版师账号。");
    expect(internalAccountPanelSource).not.toContain("老板账号不能在这里新增");
    expect(internalAccountPanelSource).toContain("重置密码");
    expect(internalAccountPanelSource).toContain("停用");
    expect(internalAccountPanelSource).toContain("启用");
    expect(internalAccountPanelSource).toContain("internalAccountRoleGroups");
    expect(internalAccountPanelSource).toContain('{ key: "receiver", label: "接单员" }');
    expect(internalAccountPanelSource).toContain('{ key: "planner", label: "计划员" }');
    expect(internalAccountPanelSource).toContain('{ key: "pattern_maker", label: "版师" }');
    expect(internalAccountPanelSource).toContain('{ key: "boss", label: "老板账号" }');
    expect(internalAccountPanelSource).toContain("internal-account-role-collapse");
    expect(internalAccountPanelSource).toContain("internal-account-role-${group.key}");
    expect(internalAccountPanelSource).toContain("defaultActiveKey={[]}");
    expect(internalAccountPanelSource).toContain("dataSource={group.accounts}");
    expect(internalAccountPanelSource).toContain("columns={accountColumns}");
    expect(internalAccountPanelSource).toContain('locale={{ emptyText: "暂无该角色账号" }}');
    expect(internalAccountPanelSource).not.toContain("dataSource={accounts}");
  });

  it("keeps legacy technical reports inside the advanced maintenance area", () => {
    expect(systemOwnerPageSource).toContain("SystemOwnerMaintenancePanel");
    expect(systemOwnerPageSource).not.toContain("SystemMaintenancePlaceholder");
    expect(systemOwnerPageSource).not.toContain("待迁移");

    expect(systemOwnerMaintenancePanelSource).toContain("AdvancedMaintenancePanel");
    expect(advancedMaintenancePanelSource).toContain("getSystemOwnerMaintenanceSnapshot");
    expect(advancedMaintenancePanelSource).toContain("导出脱敏报告");
    expect(advancedMaintenancePanelSource).toContain("高级维护区域");
  });

  it("shows the retained storage page as unavailable without migration controls", () => {
    expect(systemOwnerMaintenancePanelSource).toContain("StorageManagementPanel");
    for (const label of ["存储管理", "当前版本暂未开放", "当前系统数据目录", "附件存档目录", "当前系统备份目录"]) {
      expect(storageManagementPanelSource).toContain(label);
    }
    for (const internalLabel of ["StorageMigrationPlan", "Runner action", "迁移任务ID", "staging", "volume", "mount", "preflightStorageMigration", "executeStorageMigration"]) {
      expect(storageManagementPanelSource).not.toContain(internalLabel);
    }
  });

  it("keeps automatic restore and update unavailable while retaining backup status and history", () => {
    expect(systemOwnerMaintenancePanelSource).toContain("SystemUpdatePanel");
    for (const label of [
      "当前版本暂未开放自动更新",
      "自动更新暂未开放",
      "更新内容",
      "更新风险",
      "正式部署包"
    ]) {
      expect(systemUpdatePanelSource).toContain(label);
    }
    const recoveryPointPanelSource = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../pages/system-owner/RecoveryPointPanel.tsx"),
      "utf8"
    );
    for (const label of ["当前版本暂未开放自动恢复", "自动恢复暂未开放", "人工冷恢复", "立即创建系统恢复点"]) {
      expect(recoveryPointPanelSource).toContain(label);
    }
    expect(systemUpdatePanelSource).toContain("getSystemUpdateOverview");
    expect(systemUpdatePanelSource).toContain("window.setInterval");
    expect(systemUpdatePanelSource).toContain("页面刷新后仍可继续查看");
    for (const forbiddenLabel of ["LifecycleJob", "Lease", "Manifest", "SHA256", "Docker", "PowerShell", "Container", "Image"]) {
      expect(systemUpdatePanelSource).not.toContain(`>${forbiddenLabel}<`);
    }
  });

  it("splits system maintenance into a non-technical responsive management center", () => {
    for (const label of ["系统概览", "备份与恢复", "存储管理", "系统更新", "系统迁移", "检查系统", "操作记录"]) {
      expect(systemOwnerMaintenancePanelSource).toContain(`label: "${label}"`);
    }
    expect(systemOwnerMaintenancePanelSource).toContain('tabPosition={screens.lg ? "left" : "top"}');
    expect(systemHealthPanelSource).toContain("查看技术详情");
    expect(operationHistoryPanelSource).toContain("查看技术详情");
    expect(systemOwnerMaintenancePanelSource).toContain("当前没有可点击的导出按钮");
    expect(systemOwnerMaintenancePanelSource).toContain("sessionStorage");
    expect(systemManagementOverviewPanelSource).toContain("系统运行正常");
    expect(systemManagementOverviewPanelSource).toContain("常用维护");
    expect(systemManagementOverviewPanelSource).toContain("现有业务数据没有变化");
    expect(css).toContain(".system-management-tabs > .ant-tabs-content-holder");
    expect(css).toContain("@media (max-width: 991px)");
  });
});
