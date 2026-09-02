import type { IdentityState } from "../types/contracts";
import { environment } from "../config/environment";

export const IDENTITY_PREVIEW_OPTIONS = [
  { key: "unbound", label: "未登录", identity: { status: "unbound", homeRoute: "/pages/identity/identity", canScanOrder: false } },
  { key: "disabled", label: "停用", identity: { status: "disabled", homeRoute: "/pages/identity/disabled", canScanOrder: false } },
  { key: "boss", label: "老板", identity: { status: "active", identityType: "account", role: "boss", homeRoute: "/pages/account/boss", canScanOrder: false } },
  { key: "receiver", label: "接单员", identity: { status: "active", identityType: "account", role: "receiver", homeRoute: "/pages/receiver/home", canScanOrder: true } },
  { key: "planner", label: "计划员", identity: { status: "active", identityType: "account", role: "planner", homeRoute: "/pages/planner/home", canScanOrder: true } },
  { key: "client_admin", label: "客户主管", identity: { status: "active", identityType: "account", role: "client_admin", homeRoute: "/pages/client/orders", canScanOrder: false } },
  { key: "client_business_user", label: "客户业务员", identity: { status: "active", identityType: "account", role: "client_business_user", homeRoute: "/pages/client/orders", canScanOrder: false } },
  { key: "cutting", label: "裁剪", identity: { status: "active", identityType: "account", role: "worker", workerType: "cutting", homeRoute: "/pages/worker/home", canScanOrder: true } },
  { key: "sewing", label: "缝制", identity: { status: "active", identityType: "account", role: "worker", workerType: "sewing", homeRoute: "/pages/worker/home", canScanOrder: true } },
  { key: "qc_delivery", label: "组检/出库", identity: { status: "active", identityType: "account", role: "worker", workerType: "qc_delivery", homeRoute: "/pages/worker/home", canScanOrder: true } }
] as const satisfies ReadonlyArray<{ key: string; label: string; identity: IdentityState }>;

export function identityPreviewAt(index: number): IdentityState {
  return IDENTITY_PREVIEW_OPTIONS[index]?.identity ?? IDENTITY_PREVIEW_OPTIONS[0].identity;
}

export function identityPreviewForPersonaKey(key: string): IdentityState {
  const normalized = key.replace(/-/g, "_");
  if (normalized === "system_owner") {
    return { status: "active", identityType: "account", role: "system_owner", homeRoute: "/pages/account/boss", canScanOrder: false };
  }
  if (normalized === "pattern_maker") {
    return { status: "active", identityType: "account", role: "pattern_maker", homeRoute: "/pages/account/pattern-maker", canScanOrder: false };
  }
  const option = IDENTITY_PREVIEW_OPTIONS.find((item) => item.key === normalized);
  return option?.identity ?? IDENTITY_PREVIEW_OPTIONS[0].identity;
}

export function identityPreviewEnabled(envVersion: "develop" | "trial" | "release") {
  return envVersion !== "release" &&
    environment.buildMode === "development" &&
    environment.enableDevIdentityPreview;
}

export function developmentPersonaLoginEnabled(envVersion: "develop" | "trial" | "release") {
  return envVersion === "develop" &&
    environment.buildMode === "development" &&
    environment.enableDevFakeIdentityLogin;
}
