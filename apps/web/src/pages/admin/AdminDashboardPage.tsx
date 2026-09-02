import { Space } from "antd";
import { CustomerAccountManagementPanel } from "../../components/accounts/CustomerAccountManagementPanel";
import { InternalAccountManagementPanel } from "../../components/accounts/InternalAccountManagementPanel";
import { BossOrderManagementPanel } from "../../components/orders/BossOrderManagementPanel";
import { BossPricingPanel } from "../../components/orders/BossPricingPanel";
import { WorkerRegistrationPanel } from "../../components/scan/WorkerRegistrationPanel";
import { useDevSession } from "../../app/DevSessionContext";
import { BossPerformancePage } from "./BossPerformancePage";
import { SampleTypeManagementPanel } from "../../components/sample-types/SampleTypeManagementPanel";

export type AdminDashboardSection =
  | "orders"
  | "pricing"
  | "performance"
  | "workers"
  | "customers"
  | "internal-accounts"
  | "sample-types";

type AdminDashboardPageProps = {
  section?: AdminDashboardSection;
};

function renderAdminSection(section: AdminDashboardSection, session: ReturnType<typeof useDevSession>["session"]) {
  if (section === "pricing") {
    return <BossPricingPanel session={session} />;
  }

  if (section === "performance") {
    return <BossPerformancePage />;
  }

  if (section === "workers") {
    return <WorkerRegistrationPanel session={session} />;
  }

  if (section === "customers") {
    return <CustomerAccountManagementPanel session={session} />;
  }

  if (section === "internal-accounts") {
    return <InternalAccountManagementPanel session={session} />;
  }

  if (section === "sample-types") {
    return <SampleTypeManagementPanel session={session} />;
  }

  return <BossOrderManagementPanel session={session} />;
}

export function AdminDashboardPage({ section = "orders" }: AdminDashboardPageProps) {
  const { session } = useDevSession();

  return (
    <Space direction="vertical" size={16} className={`full-width admin-dashboard-page admin-dashboard-${section}-page`}>
      {renderAdminSection(section, session)}
    </Space>
  );
}
