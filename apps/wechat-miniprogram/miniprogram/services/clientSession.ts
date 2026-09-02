import type { MiniappGlobalData } from "../app";
import type { IdentityState } from "../types/contracts";
import { ensureSessionEndpoint } from "./endpointSession";

export function isActiveClientIdentity(identity: IdentityState) {
  return identity.status === "active" &&
    identity.identityType === "account" &&
    (identity.role === "client_admin" || identity.role === "client_business_user");
}

export function isClientAdminIdentity(identity: IdentityState) {
  return isActiveClientIdentity(identity) && identity.role === "client_admin";
}

export function isClientBusinessIdentity(identity: IdentityState) {
  return isActiveClientIdentity(identity) && identity.role === "client_business_user";
}

export async function requireClientApiContext(globalData: MiniappGlobalData) {
  if (!isActiveClientIdentity(globalData.identity)) {
    throw new Error("当前微信身份不是客户账号");
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
