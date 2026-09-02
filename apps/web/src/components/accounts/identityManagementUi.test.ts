import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const workerAccountSource = readFileSync(resolve(here, "WorkerAccountManagementPanel.tsx"), "utf8");
const workerEntrySource = readFileSync(resolve(here, "../scan/WorkerRegistrationPanel.tsx"), "utf8");
const internalAccountSource = readFileSync(resolve(here, "InternalAccountManagementPanel.tsx"), "utf8");
const customerAccountSource = readFileSync(resolve(here, "CustomerAccountManagementPanel.tsx"), "utf8");

describe("unified Account and WorkerProfile management UI", () => {
  it("uses the new worker account view from the existing boss worker entry", () => {
    expect(workerEntrySource).toContain("return <WorkerAccountManagementPanel {...props} />");
    expect(workerAccountSource).toContain("生产员工管理");
    expect(workerAccountSource).toContain("workerGroups");
    expect(workerAccountSource).toContain("worker-stage-group");
    expect(workerAccountSource).toContain("裁剪");
    expect(workerAccountSource).toContain("缝制");
    expect(workerAccountSource).toContain("组检/出库");
    expect(workerAccountSource).toContain("账号资料和岗位履历仅在需要时查看");
    expect(workerAccountSource).toContain("setHistoryWorker");
    expect(workerAccountSource).toContain("worker-stage-collapse");
    expect(workerAccountSource).toContain("worker-stopped-collapse");
    expect(workerAccountSource).toContain("stageQueries");
    expect(workerAccountSource).toContain("stoppedQueries");
    expect(workerAccountSource).not.toContain("登录手机号：");
    expect(workerAccountSource).not.toContain("无当前岗位");
    expect(workerAccountSource).not.toContain("Account ID");
    expect(workerAccountSource).not.toContain("Profile ID");
    expect(workerAccountSource).not.toContain("accountType");
  });

  it("connects boss-controlled registration and position history actions to the identity API", () => {
    expect(workerAccountSource).toContain("生成 Worker 注册二维码");
    expect(workerAccountSource).toContain("初始工序由老板指定");
    expect(workerAccountSource).toContain("createWorkerRegistrationToken");
    expect(workerAccountSource).toContain("changeWorkerIdentityStage");
    expect(workerAccountSource).toContain("archiveWorkerIdentityAccounts");
    expect(workerAccountSource).toContain("restoreWorkerIdentityProfile");
    expect(workerAccountSource).toContain("revokeWorkerIdentityToken");
    expect(workerAccountSource).toContain("<QRCode");
    expect(workerAccountSource).toContain("恢复岗位");
    expect(workerAccountSource).toContain("updateWorkerIdentityAccount");
    expect(workerAccountSource).toContain("编辑生产员工");
    expect(workerAccountSource).toContain("确认停用");
    expect(workerAccountSource).toContain("使用微信扫一扫打开网页注册");
    expect(workerAccountSource).toContain("公网注册链接");
    expect(workerAccountSource).toContain("局域网注册链接");
    expect(workerAccountSource).toContain('profile.status !== "inactive"');
    expect(workerAccountSource).not.toContain("createWorkerRegistrationLink");
    expect(workerAccountSource).not.toContain("updateProductionWorker");
    expect(workerAccountSource).not.toContain("createWorkerRoleBindToken");
    expect(workerAccountSource).not.toContain("待 API");
  });

  it("shows Business Account fields and hides formal WeChat binding controls", () => {
    expect(internalAccountSource).toContain("phoneNumber（密码恢复）");
    expect(internalAccountSource).toContain("Business Account");
    expect(internalAccountSource).toContain("当前 role");
    expect(internalAccountSource).toContain('value: "boss" as const');
    expect(internalAccountSource).toContain('session.role === "system_owner"');
    expect(internalAccountSource).toContain("System Owner 可以新增老板及普通内部账号。");
    expect(internalAccountSource).toContain("老板可以新增接单员、计划员和版师账号。");
    expect(internalAccountSource).not.toContain("老板账号不能在这里新增");
    expect(internalAccountSource).not.toContain("WechatBindingControl");
    expect(customerAccountSource).toContain("恢复联系方式");
    expect(customerAccountSource).toContain("客户主管");
    expect(customerAccountSource).toContain("客户业务员");
  });

  it("separates active and stopped customer account management", () => {
    expect(customerAccountSource).toContain("activeCustomers");
    expect(customerAccountSource).toContain("stoppedCustomerGroups");
    expect(customerAccountSource).toContain("停用客户与账号");
    expect(customerAccountSource).toContain("搜索客户名称、业务员用户名或联系方式");
    expect(customerAccountSource).toContain("全部启用客户");
    expect(customerAccountSource).toContain("全部停用客户");
    expect(customerAccountSource).toContain("恢复客户");
    expect(customerAccountSource).toContain("恢复业务员");
    expect(customerAccountSource).toContain("其他业务员保持停用");
    expect(customerAccountSource).toContain("customer-account-archive-collapse");
  });

  it("keeps customer account actions compact and folds registration requests", () => {
    expect(customerAccountSource).toContain('session.authMode === "dev"');
    expect(customerAccountSource).toContain("customer-account-request-collapse");
    expect(customerAccountSource).toContain("全部申请客户");
    expect(customerAccountSource).toContain("filteredPendingRequests");
    expect(customerAccountSource).toContain("停用业务员及登录");
    expect(customerAccountSource).toContain("仅禁止登录（高级选项）");
    expect(customerAccountSource).toContain('useState<BusinessUserStopMode>("profile_and_login")');
    expect(customerAccountSource).toContain('businessUserStopMode === "login_only"');
    expect(customerAccountSource).toContain("sampleRoomApi.updateClientUserLoginStatus");
    expect(customerAccountSource).toContain("sampleRoomApi.updateClientUserAccountStatus");
    expect(customerAccountSource).not.toContain("查看账号");
    expect(customerAccountSource).not.toContain("停用资料");
  });
});
