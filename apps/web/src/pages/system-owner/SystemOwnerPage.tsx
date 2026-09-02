import { Space } from "antd";
import { useDevSession } from "../../app/DevSessionContext";
import { InternalAccountManagementPanel } from "../../components/accounts/InternalAccountManagementPanel";
import { CustomerAccountManagementPanel } from "../../components/accounts/CustomerAccountManagementPanel";
import { BossOrderManagementPanel } from "../../components/orders/BossOrderManagementPanel";
import { BossPricingPanel } from "../../components/orders/BossPricingPanel";
import { WorkerRegistrationPanel } from "../../components/scan/WorkerRegistrationPanel";
import { BossPerformancePage } from "../admin/BossPerformancePage";
import { SystemOwnerMaintenancePanel } from "./SystemOwnerMaintenancePanel";
import { SampleTypeManagementPanel } from "../../components/sample-types/SampleTypeManagementPanel";

export type SystemOwnerSection =
  | "business"
  | "pricing"
  | "performance"
  | "customers"
  | "internal-accounts"
  | "workers"
  | "sample-types"
  | "maintenance";

type SystemOwnerPageProps = {
  section?: SystemOwnerSection;
};

function renderSystemOwnerSection(section: SystemOwnerSection, session: ReturnType<typeof useDevSession>["session"]) {
  if (section === "pricing") {
    return <BossPricingPanel session={session} />;
  }

  if (section === "performance") {
    return <BossPerformancePage />;
  }

  if (section === "customers") {
    return <CustomerAccountManagementPanel session={session} />;
  }

  if (section === "internal-accounts") {
    return <InternalAccountManagementPanel session={session} />;
  }

  if (section === "workers") {
    return <WorkerRegistrationPanel session={session} />;
  }

  if (section === "maintenance") {
    return <SystemOwnerMaintenancePanel session={session} />;
  }

  if (section === "sample-types") {
    return <SampleTypeManagementPanel session={session} />;
  }

  return <BossOrderManagementPanel session={session} />;
}

function sharedAdminSectionClass(section: SystemOwnerSection) {
  if (section === "maintenance") return "";
  const adminSection = section === "business" ? "orders" : section;
  return ` admin-dashboard-page admin-dashboard-${adminSection}-page`;
}

export function SystemOwnerPage({ section = "business" }: SystemOwnerPageProps) {
  const { session } = useDevSession();

  return (
    <Space
      direction="vertical"
      size={16}
      className={`full-width system-owner-${section}-page${sharedAdminSectionClass(section)}`}
    >
      {renderSystemOwnerSection(section, session)}
    </Space>
  );
}
