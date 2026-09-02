import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { sampleRoomApi, type AuthenticatedUser, type LoginPayload } from "../api/sampleRoomApi";
import type { DevSession } from "./DevSessionContext";

export type FrontendAuthMode = "dev" | "formal";
export type FormalAuthStatus = "checking" | "authenticated" | "unauthenticated";

type LogoutResult = {
  warning?: string;
};

type AuthSessionContextValue = {
  authMode: FrontendAuthMode;
  status: FormalAuthStatus;
  user: AuthenticatedUser | null;
  session: DevSession | null;
  activateDeveloperEntry: (username: string) => boolean;
  isDeveloperEntryUsername: (username: string) => boolean;
  login: (
    payload: LoginPayload,
    acceptUser?: (user: AuthenticatedUser) => boolean
  ) => Promise<AuthenticatedUser>;
  logout: () => Promise<LogoutResult>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function getFrontendAuthMode(): FrontendAuthMode {
  const value = import.meta.env.VITE_AUTH_MODE;

  if (!value || value === "formal") {
    return "formal";
  }

  if (value === "dev") {
    return "dev";
  }

  throw new Error(`Unsupported VITE_AUTH_MODE "${value}". Use "dev" or "formal".`);
}

const defaultDeveloperEntryCode = "DEV-SRO-7396";

export function isDeveloperEntryEnabled() {
  return import.meta.env.VITE_ENABLE_DEV_ENTRY === "true";
}

export function getDeveloperEntryCode() {
  const configuredCode = import.meta.env.VITE_DEV_ENTRY_CODE;
  return typeof configuredCode === "string" && configuredCode.trim()
    ? configuredCode.trim()
    : defaultDeveloperEntryCode;
}

export function isDeveloperEntryUsername(username: string) {
  return username.trim() === getDeveloperEntryCode();
}

function toFormalSession(user: AuthenticatedUser): DevSession {
  return {
    authMode: "formal",
    role: user.role,
    userId: user.id,
    accountId: user.accountId,
    accountType: user.accountType,
    displayName: user.displayName ?? user.id,
    ...(user.phoneNumber ? { phoneNumber: user.phoneNumber } : {}),
    ...(user.customerId !== undefined ? { customerId: user.customerId } : {}),
    ...(user.clientUserId !== undefined ? { clientUserId: user.clientUserId } : {}),
    ...(user.clientAccessScope !== undefined
      ? { clientAccessScope: user.clientAccessScope }
      : {}),
    ...(user.mustChangePassword !== undefined
      ? { mustChangePassword: user.mustChangePassword }
      : {}),
    ...(user.activeWorkerProfileId ? { activeWorkerProfileId: user.activeWorkerProfileId } : {}),
    ...(user.activeWorkerType ? { activeWorkerType: user.activeWorkerType } : {})
  };
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const configuredAuthMode = getFrontendAuthMode();
  const [authMode, setAuthMode] = useState<FrontendAuthMode>(configuredAuthMode);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [status, setStatus] = useState<FormalAuthStatus>(
    configuredAuthMode === "formal" ? "checking" : "unauthenticated"
  );

  useEffect(() => {
    if (authMode !== "formal") {
      setStatus("unauthenticated");
      setUser(null);
      return;
    }

    let cancelled = false;

    async function loadCurrentUser() {
      setStatus("checking");
      try {
        const currentUser = await sampleRoomApi.getCurrentUser();
        if (cancelled) {
          return;
        }

        setUser(currentUser);
        setStatus(currentUser ? "authenticated" : "unauthenticated");
      } catch {
        if (!cancelled) {
          setUser(null);
          setStatus("unauthenticated");
        }
      }
    }

    void loadCurrentUser();

    return () => {
      cancelled = true;
    };
  }, [authMode]);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      authMode,
      status,
      user,
      session: user ? toFormalSession(user) : null,
      activateDeveloperEntry(username) {
        if (!isDeveloperEntryEnabled() || !isDeveloperEntryUsername(username)) {
          return false;
        }

        setUser(null);
        setStatus("unauthenticated");
        setAuthMode("dev");
        return true;
      },
      isDeveloperEntryUsername,
      async login(payload, acceptUser = () => true) {
        const result = await sampleRoomApi.login(payload);
        if (!acceptUser(result.user)) {
          try {
            await sampleRoomApi.logout();
          } catch {
            // The local session must remain inactive even if the logout request fails.
          } finally {
            setUser(null);
            setStatus("unauthenticated");
          }
          return result.user;
        }
        setUser(result.user);
        setStatus("authenticated");
        return result.user;
      },
      async logout() {
        try {
          await sampleRoomApi.logout();
          setUser(null);
          setStatus("unauthenticated");
          return {};
        } catch {
          setUser(null);
          setStatus("unauthenticated");
          return { warning: "退出请求未完成，本地登录状态已清除。" };
        }
      }
    }),
    [authMode, status, user]
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession() {
  const value = useContext(AuthSessionContext);
  if (!value) {
    throw new Error("useAuthSession must be used inside AuthSessionProvider");
  }

  return value;
}
