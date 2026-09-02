import { lazy, Suspense, type ComponentType } from "react";
import { CLIENT_ACCESS_SCOPES, type ClientAccessScope, type WorkerType } from "@sample-room/shared";
import type { DevRole } from "../app/DevSessionContext";
import { DevelopmentLoginPage } from "../pages/login/DevelopmentLoginPage";

export type AppRoute = {
  path: string;
  navLabel: string;
  Component: ComponentType;
  roles?: DevRole[];
  workerTypes?: WorkerType[];
  clientAccessScopes?: ClientAccessScope[];
  hideInNavigation?: boolean;
  hideInFormalNavigation?: boolean;
};

const AccountSecurityPage = lazy(() =>
  import("../pages/account/AccountSecurityPage").then((module) => ({
    default: module.AccountSecurityPage
  }))
);
const ForcePasswordChangePage = lazy(() =>
  import("../pages/account/ForcePasswordChangePage").then((module) => ({
    default: module.ForcePasswordChangePage
  }))
);
const AdminDashboardPage = lazy(() =>
  import("../pages/admin/AdminDashboardPage").then((module) => ({
    default: module.AdminDashboardPage
  }))
);
const ClientMobilePage = lazy(() =>
  import("../pages/client/ClientMobilePage").then((module) => ({
    default: module.ClientMobilePage
  }))
);
const ClientBusinessUserRegistrationPage = lazy(() =>
  import("../pages/client/ClientBusinessUserRegistrationPage").then((module) => ({
    default: module.ClientBusinessUserRegistrationPage
  }))
);
const ClientOrdersPage = lazy(() =>
  import("../pages/client/ClientOrdersPage").then((module) => ({
    default: module.ClientOrdersPage
  }))
);
const ClientUserManagementPage = lazy(() =>
  import("../pages/client/ClientUserManagementPage").then((module) => ({
    default: module.ClientUserManagementPage
  }))
);
const ClientWorkbenchPage = lazy(() =>
  import("../pages/client/ClientWorkbenchPage").then((module) => ({
    default: module.ClientWorkbenchPage
  }))
);
const HelpPage = lazy(() =>
  import("../pages/help/HelpPage").then((module) => ({
    default: module.HelpPage
  }))
);
const PatternTaskWorkbenchPage = lazy(() =>
  import("../pages/pattern-maker/PatternTaskWorkbenchPage").then((module) => ({
    default: module.PatternTaskWorkbenchPage
  }))
);
const PlannerWorkbenchPage = lazy(() =>
  import("../pages/planner/PlannerWorkbenchPage").then((module) => ({
    default: module.PlannerWorkbenchPage
  }))
);
const ReceiverMobilePage = lazy(() =>
  import("../pages/receiver/ReceiverMobilePage").then((module) => ({
    default: module.ReceiverMobilePage
  }))
);
const ReceiverWorkbenchPage = lazy(() =>
  import("../pages/receiver/ReceiverWorkbenchPage").then((module) => ({
    default: module.ReceiverWorkbenchPage
  }))
);
const ScanTaskPage = lazy(() =>
  import("../pages/scan/ScanTaskPage").then((module) => ({
    default: module.ScanTaskPage
  }))
);
const QcTabletPage = lazy(() =>
  import("../pages/qc/QcTabletPage").then((module) => ({
    default: module.QcTabletPage
  }))
);
const SystemOwnerPage = lazy(() =>
  import("../pages/system-owner/SystemOwnerPage").then((module) => ({
    default: module.SystemOwnerPage
  }))
);
const WorkerRegistrationPage = lazy(() =>
  import("../pages/workers/WorkerRegistrationPage").then((module) => ({
    default: module.WorkerRegistrationPage
  }))
);
const WorkerMobilePage = lazy(() =>
  import("../pages/workers/WorkerMobilePage").then((module) => ({
    default: module.WorkerMobilePage
  }))
);

const DevScanSimulatorPage = import.meta.env.DEV
  ? lazy(() =>
      import("../pages/dev/ScanSimulatorPage").then((module) => ({
        default: module.ScanSimulatorPage
      }))
    )
  : undefined;

const developmentScanRoutes: AppRoute[] = DevScanSimulatorPage
  ? [{
      path: "/dev/scan-simulator",
      navLabel: "扫码模拟器",
      Component: () => (
        <Suspense fallback={null}>
          <DevScanSimulatorPage />
        </Suspense>
      ),
      hideInFormalNavigation: true
    }]
  : [];

export const routes: AppRoute[] = [
  ...developmentScanRoutes,
  {
    path: "/login",
    navLabel: "角色切换",
    Component: DevelopmentLoginPage
  },
  {
    path: "/client/register/:token",
    navLabel: "业务员注册",
    Component: ClientBusinessUserRegistrationPage,
    hideInNavigation: true,
    hideInFormalNavigation: true
  },
  {
    path: "/workers/register/:token",
    navLabel: "工人身份绑定",
    Component: WorkerRegistrationPage,
    hideInNavigation: true,
    hideInFormalNavigation: true
  },
  {
    path: "/scan/:token",
    navLabel: "样品扫码",
    Component: ScanTaskPage,
    hideInNavigation: true,
    hideInFormalNavigation: true
  },
  {
    path: "/qc/tablet",
    navLabel: "组检/出库 Pad",
    Component: QcTabletPage,
    roles: ["worker"],
    workerTypes: ["qc_delivery"],
    hideInNavigation: true,
    hideInFormalNavigation: true
  },
  {
    path: "/worker/mobile",
    navLabel: "工序手机端",
    Component: WorkerMobilePage,
    roles: ["worker"],
    workerTypes: ["cutting", "sewing"],
    hideInNavigation: true
  },
  {
    path: "/receiver/tablet",
    navLabel: "接单员 Pad",
    Component: () => <ReceiverWorkbenchPage initialTab="self-entry" tablet />,
    roles: ["receiver"],
    hideInNavigation: true,
    hideInFormalNavigation: true
  },
  {
    path: "/planner/tablet",
    navLabel: "计划员 Pad",
    Component: () => <PlannerWorkbenchPage tablet />,
    roles: ["planner"],
    hideInNavigation: true,
    hideInFormalNavigation: true
  },
  {
    path: "/account/security",
    navLabel: "账号与安全",
    Component: AccountSecurityPage,
    roles: ["client_admin", "client_business_user", "receiver", "pattern_maker", "planner", "boss", "system_owner", "worker"],
    workerTypes: ["qc_delivery"],
    hideInNavigation: true
  },
  {
    path: "/account/force-password",
    navLabel: "强制修改密码",
    Component: ForcePasswordChangePage,
    hideInNavigation: true
  },
  {
    path: "/client",
    navLabel: "客户工作台",
    Component: ClientWorkbenchPage,
    roles: ["client_business_user"],
    clientAccessScopes: [CLIENT_ACCESS_SCOPES.own]
  },
  {
    path: "/client/users",
    navLabel: "客户员工管理",
    Component: ClientUserManagementPage,
    roles: ["client_admin"],
    clientAccessScopes: [CLIENT_ACCESS_SCOPES.customerAll]
  },
  {
    path: "/client/orders",
    navLabel: "客户订单",
    Component: ClientOrdersPage,
    roles: ["client_admin", "client_business_user"]
  },
  {
    path: "/client/mobile",
    navLabel: "客户手机端",
    Component: ClientMobilePage,
    roles: ["client_admin", "client_business_user"],
    hideInFormalNavigation: true
  },
  {
    path: "/receiver",
    navLabel: "订单录入",
    Component: () => <ReceiverWorkbenchPage initialTab="self-entry" />,
    roles: ["receiver"]
  },
  {
    path: "/receiver/pending-receive",
    navLabel: "待接单",
    Component: () => <ReceiverWorkbenchPage initialTab="pending" />,
    roles: ["receiver"]
  },
  {
    path: "/receiver/drafts",
    navLabel: "待接单",
    Component: () => <ReceiverWorkbenchPage initialTab="pending" />,
    roles: ["receiver"],
    hideInNavigation: true
  },
  {
    path: "/receiver/tracking",
    navLabel: "订单列表",
    Component: () => <ReceiverWorkbenchPage initialTab="list" />,
    roles: ["receiver"],
    hideInNavigation: true
  },
  {
    path: "/receiver/orders",
    navLabel: "订单列表",
    Component: () => <ReceiverWorkbenchPage initialTab="list" />,
    roles: ["receiver"]
  },
  {
    path: "/receiver/self-entry",
    navLabel: "订单录入",
    Component: () => <ReceiverWorkbenchPage initialTab="self-entry" />,
    roles: ["receiver"],
    hideInNavigation: true
  },
  {
    path: "/receiver/mobile",
    navLabel: "手机测试",
    Component: ReceiverMobilePage,
    roles: ["receiver"],
    hideInFormalNavigation: true
  },
  {
    path: "/pattern-maker",
    navLabel: "版师工作台",
    Component: PatternTaskWorkbenchPage,
    roles: ["pattern_maker"]
  },
  {
    path: "/planner",
    navLabel: "计划员工作台",
    Component: () => <PlannerWorkbenchPage />,
    roles: ["planner"]
  },
  {
    path: "/planner/mobile",
    navLabel: "计划员手机端",
    Component: () => <PlannerWorkbenchPage mobile />,
    roles: ["planner"],
    hideInFormalNavigation: true
  },
  {
    path: "/admin",
    navLabel: "订单与终止",
    Component: () => <AdminDashboardPage section="orders" />,
    roles: ["boss"]
  },
  {
    path: "/admin/pricing",
    navLabel: "定价对账",
    Component: () => <AdminDashboardPage section="pricing" />,
    roles: ["boss"]
  },
  {
    path: "/admin/performance",
    navLabel: "员工绩效",
    Component: () => <AdminDashboardPage section="performance" />,
    roles: ["boss"]
  },
  {
    path: "/admin/workers",
    navLabel: "员工管理",
    Component: () => <AdminDashboardPage section="workers" />,
    roles: ["boss"]
  },
  {
    path: "/admin/accounts",
    navLabel: "客户与账号",
    Component: () => <AdminDashboardPage section="customers" />,
    roles: ["boss"]
  },
  {
    path: "/admin/internal-accounts",
    navLabel: "内部账号",
    Component: () => <AdminDashboardPage section="internal-accounts" />,
    roles: ["boss"]
  },
  {
    path: "/admin/sample-types",
    navLabel: "样衣类型管理",
    Component: () => <AdminDashboardPage section="sample-types" />,
    roles: ["boss"]
  },
  {
    path: "/system-owner",
    navLabel: "订单与终止",
    Component: () => <SystemOwnerPage section="business" />,
    roles: ["system_owner"]
  },
  {
    path: "/system-owner/pricing",
    navLabel: "定价对账",
    Component: () => <SystemOwnerPage section="pricing" />,
    roles: ["system_owner"]
  },
  {
    path: "/system-owner/performance",
    navLabel: "员工绩效",
    Component: () => <SystemOwnerPage section="performance" />,
    roles: ["system_owner"]
  },
  {
    path: "/system-owner/customers",
    navLabel: "客户与账号",
    Component: () => <SystemOwnerPage section="customers" />,
    roles: ["system_owner"]
  },
  {
    path: "/system-owner/internal-accounts",
    navLabel: "内部账号",
    Component: () => <SystemOwnerPage section="internal-accounts" />,
    roles: ["system_owner"]
  },
  {
    path: "/system-owner/workers",
    navLabel: "员工管理",
    Component: () => <SystemOwnerPage section="workers" />,
    roles: ["system_owner"]
  },
  {
    path: "/system-owner/sample-types",
    navLabel: "样衣类型管理",
    Component: () => <SystemOwnerPage section="sample-types" />,
    roles: ["system_owner"]
  },
  {
    path: "/system-owner/maintenance",
    navLabel: "系统管理",
    Component: () => <SystemOwnerPage section="maintenance" />,
    roles: ["system_owner"]
  },
  {
    path: "/help",
    navLabel: "测试说明",
    Component: HelpPage,
    hideInFormalNavigation: true
  }
];
