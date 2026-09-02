import type { MiniappGlobalData } from "../app";
import { ensureSessionEndpoint } from "./endpointSession";

export async function requireMobileApiContext(globalData: MiniappGlobalData, roles?: string[]) {
  if (
    globalData.identity.status !== "active" ||
    globalData.identity.identityType !== "account" ||
    (roles?.length && !roles.includes(String(globalData.identity.role)))
  ) throw new Error("当前账号无权访问此页面");
  if (globalData.identityPreviewActive) throw new Error("身份预览仅用于页面验收，不读取或写入真实数据");
  if (!globalData.sessionToken) throw new Error("小程序会话已失效，请重新登录");
  const endpoint = await ensureSessionEndpoint(globalData);
  return { ...endpoint, sessionToken: globalData.sessionToken };
}
