import type { DevSession } from "../../app/DevSessionContext";
import { WorkerAccountManagementPanel } from "../accounts/WorkerAccountManagementPanel";

type WorkerRegistrationPanelProps = {
  session: DevSession;
};

export function WorkerRegistrationPanel(props: WorkerRegistrationPanelProps) {
  return <WorkerAccountManagementPanel {...props} />;
}
