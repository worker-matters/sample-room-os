import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CLIENT_ACCESS_SCOPES, type ClientAccessScope } from "@sample-room/shared";

export type DevRole =
  | "client_admin"
  | "client_business_user"
  | "receiver"
  | "pattern_maker"
  | "planner"
  | "worker"
  | "boss"
  | "system_owner";

export type DevSession = {
  role: DevRole;
  userId: string;
  displayName: string;
  phoneNumber?: string;
  customerId?: string;
  clientUserId?: string;
  clientAccessScope?: ClientAccessScope;
  authMode?: "dev" | "formal";
  mustChangePassword?: boolean;
  accountId?: string;
  accountType?: "business" | "worker";
  activeWorkerProfileId?: string;
  activeWorkerType?: "cutting" | "sewing" | "qc_delivery";
};

export type DevClientProfileId =
  | "customer-a-user"
  | "customer-a-admin"
  | "customer-b-user"
  | "customer-b-admin";

export type DevClientProfile = {
  id: DevClientProfileId;
  label: string;
  session: DevSession;
};

type DevSessionContextValue = {
  session: DevSession;
  setRole: (role: DevRole) => void;
  clientProfiles: DevClientProfile[];
  clientProfileId: DevClientProfileId;
  setClientProfile: (profileId: DevClientProfileId) => void;
};

export const devClientProfiles: DevClientProfile[] = [
  {
    id: "customer-a-user",
    label: "客户 A 普通业务员",
    session: {
      role: "client_business_user",
      userId: "mock-client-user-active",
      displayName: "客户 A 普通业务员",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active",
      clientAccessScope: CLIENT_ACCESS_SCOPES.own
    }
  },
  {
    id: "customer-a-admin",
    label: "客户 A 主管账号",
    session: {
      role: "client_admin",
      userId: "mock-client-user-admin",
      displayName: "客户 A 主管账号",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin",
      clientAccessScope: CLIENT_ACCESS_SCOPES.customerAll
    }
  },
  {
    id: "customer-b-user",
    label: "客户 B 普通业务员",
    session: {
      role: "client_business_user",
      userId: "mock-client-user-other",
      displayName: "客户 B 普通业务员",
      customerId: "mock-customer-other",
      clientUserId: "mock-client-user-other",
      clientAccessScope: CLIENT_ACCESS_SCOPES.own
    }
  },
  {
    id: "customer-b-admin",
    label: "客户 B 主管账号",
    session: {
      role: "client_admin",
      userId: "mock-client-user-other-admin",
      displayName: "客户 B 主管账号",
      customerId: "mock-customer-other",
      clientUserId: "mock-client-user-other-admin",
      clientAccessScope: CLIENT_ACCESS_SCOPES.customerAll
    }
  }
];

const roleDefaults: Record<Exclude<DevRole, "client_admin" | "client_business_user">, DevSession> = {
  worker: {
    role: "worker",
    userId: "formal-account-worker-qc",
    accountId: "formal-account-worker-qc",
    accountType: "worker",
    activeWorkerProfileId: "formal-worker-profile-qc",
    activeWorkerType: "qc_delivery",
    displayName: "组检出库员工一号",
    phoneNumber: "13800000003"
  },
  receiver: {
    role: "receiver",
    userId: "mock-receiver",
    displayName: "Mock Receiver"
  },
  pattern_maker: {
    role: "pattern_maker",
    userId: "mock-pattern-maker",
    displayName: "Mock Pattern Maker"
  },
  planner: {
    role: "planner",
    userId: "mock-planner",
    displayName: "Mock Planner"
  },
  boss: {
    role: "boss",
    userId: "mock-boss",
    displayName: "Mock Boss"
  },
  system_owner: {
    role: "system_owner",
    userId: "mock-system-owner",
    displayName: "Mock System Owner"
  }
};

export const roleHomePaths: Record<DevRole, string> = {
  client_admin: "/client/users",
  client_business_user: "/client",
  receiver: "/receiver",
  pattern_maker: "/pattern-maker",
  planner: "/planner",
  worker: "/qc/tablet",
  boss: "/admin",
  system_owner: "/system-owner"
};

const storageKey = "sample-room-v2-dev-role";
const clientProfileStorageKey = "sample-room-v2-dev-client-profile";
const DevSessionContext = createContext<DevSessionContextValue | null>(null);

function isDevRole(value: string | null): value is DevRole {
  return (
    value === "client_admin" ||
    value === "client_business_user" ||
    value === "receiver" ||
    value === "pattern_maker" ||
    value === "planner" ||
    value === "boss" ||
    value === "system_owner" ||
    value === "worker"
  );
}

function readInitialRole(): DevRole {
  const stored = window.localStorage.getItem(storageKey);
  return isDevRole(stored) ? stored : "client_business_user";
}

function isDevClientProfileId(value: string | null): value is DevClientProfileId {
  return (
    value === "customer-a-user" ||
    value === "customer-a-admin" ||
    value === "customer-b-user" ||
    value === "customer-b-admin"
  );
}

function readInitialClientProfile(): DevClientProfileId {
  const stored = window.localStorage.getItem(clientProfileStorageKey);
  return isDevClientProfileId(stored) ? stored : "customer-a-user";
}

type DevSessionProviderProps = {
  children: ReactNode;
  sessionOverride?: DevSession;
};

export function DevSessionProvider({ children, sessionOverride }: DevSessionProviderProps) {
  const [role, setRoleState] = useState<DevRole>(() => readInitialRole());
  const [clientProfileId, setClientProfileId] = useState<DevClientProfileId>(() =>
    readInitialClientProfile()
  );

  useEffect(() => {
    window.localStorage.setItem(storageKey, role);
  }, [role]);

  useEffect(() => {
    window.localStorage.setItem(clientProfileStorageKey, clientProfileId);
  }, [clientProfileId]);

  const setRole = (nextRole: DevRole) => {
    setRoleState(nextRole);
    if (nextRole === "client_admin" || nextRole === "client_business_user") {
      const current = devClientProfiles.find((profile) => profile.id === clientProfileId);
      if (current?.session.role !== nextRole) {
        setClientProfileId(
          devClientProfiles.find((profile) => profile.session.role === nextRole)!.id
        );
      }
    }
  };

  const setClientProfile = (profileId: DevClientProfileId) => {
    const profile = devClientProfiles.find((candidate) => candidate.id === profileId)!;
    setClientProfileId(profileId);
    setRoleState(profile.session.role);
  };

  const value = useMemo<DevSessionContextValue>(
    () => ({
      session:
        sessionOverride ??
        (role === "client_admin" || role === "client_business_user"
          ? devClientProfiles.find(
              (profile) => profile.id === clientProfileId && profile.session.role === role
            )?.session ?? devClientProfiles.find((profile) => profile.session.role === role)!.session
          : roleDefaults[role]),
      setRole: sessionOverride ? () => undefined : setRole,
      clientProfiles: devClientProfiles,
      clientProfileId,
      setClientProfile: sessionOverride ? () => undefined : setClientProfile
    }),
    [clientProfileId, role, sessionOverride]
  );

  return <DevSessionContext.Provider value={value}>{children}</DevSessionContext.Provider>;
}

export function useDevSession() {
  const value = useContext(DevSessionContext);
  if (!value) {
    throw new Error("useDevSession must be used inside DevSessionProvider");
  }

  return value;
}

export const roleLabels: Record<DevRole, string> = {
  client_admin: "客户主管",
  client_business_user: "客户业务员",
  receiver: "接单员",
  pattern_maker: "版师",
  planner: "计划员",
  worker: "工序员工",
  boss: "老板",
  system_owner: "System Owner"
};

const workerTypeLabels = {
  cutting: "裁剪",
  sewing: "缝制",
  qc_delivery: "组检/出库"
} as const;

export function sessionRoleLabel(
  session: Pick<DevSession, "role" | "activeWorkerType">
) {
  return session.role === "worker" && session.activeWorkerType
    ? workerTypeLabels[session.activeWorkerType]
    : roleLabels[session.role];
}
