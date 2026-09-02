import type { MiniappGlobalData } from "../app";
import type { IdentityState } from "../types/contracts";
import { ensureSessionEndpoint } from "./endpointSession";

export function isActivePlannerIdentity(identity: IdentityState) {
  return identity.status === "active" &&
    identity.identityType === "account" &&
    identity.role === "planner";
}

export function plannerHomeRedirect(identity: IdentityState) {
  return isActivePlannerIdentity(identity) ? "/pages/planner/home" : identity.homeRoute;
}

export async function requirePlannerApiContext(globalData: MiniappGlobalData) {
  if (!isActivePlannerIdentity(globalData.identity)) {
    throw new Error("当前微信身份不是计划员");
  }
  if (globalData.identityPreviewActive) {
    throw new Error("身份预览仅用于页面验收，不读取或写入真实数据");
  }
  if (!globalData.sessionToken) {
    throw new Error("小程序会话已失效，请重新进入");
  }
  const endpoint = await ensureSessionEndpoint(globalData);
  return { ...endpoint, sessionToken: globalData.sessionToken };
}
