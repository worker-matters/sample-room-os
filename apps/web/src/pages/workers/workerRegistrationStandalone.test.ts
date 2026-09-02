import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(resolve(here, "../../main.tsx"), "utf8");
const fullRootSource = readFileSync(resolve(here, "../../FullApplicationRoot.tsx"), "utf8");
const standaloneSource = readFileSync(resolve(here, "WorkerRegistrationStandaloneApp.tsx"), "utf8");
const managementSource = readFileSync(
  resolve(here, "../../components/accounts/WorkerAccountManagementPanel.tsx"),
  "utf8"
);

describe("worker registration lightweight public entry", () => {
  it("keeps the worker registration route outside the full Ant Design app bootstrap", () => {
    expect(mainSource).toContain("workerRegistrationPath");
    expect(mainSource).toContain('import("./pages/workers/WorkerRegistrationStandaloneApp")');
    expect(mainSource).toContain('import("./FullApplicationRoot")');
    expect(mainSource).not.toContain("@ant-design/v5-patch-for-react-19");
    expect(mainSource).not.toContain("antd/dist/reset.css");
    expect(fullRootSource).toContain("@ant-design/v5-patch-for-react-19");
    expect(fullRootSource).toContain("antd/dist/reset.css");
    expect(standaloneSource).not.toContain('from "antd"');
    expect(standaloneSource).not.toContain("AuthSessionProvider");
    expect(standaloneSource).toContain("/api/workers/registration/");
  });

  it("uses compact Chinese registration and success wording", () => {
    expect(standaloneSource).toContain("创建员工账号");
    expect(standaloneSource).toContain("注册成功");
    expect(standaloneSource).toContain("该姓名已注册");
    expect(standaloneSource).toContain("该手机号已注册");
    expect(standaloneSource).toContain("现在可以使用手机号和密码登录");
  });

  it("keeps generated QR display data by production stage in the manager browser", () => {
    expect(managementSource).toContain("sampleRoomWorkerRegistrationQrCacheV1");
    expect(managementSource).toContain("registrationIssues[registrationStage]");
    expect(managementSource).toContain("persistRegistrationIssueCache");
    expect(managementSource).toContain("切换工序或重新打开窗口都能再次显示");
    expect(managementSource).not.toContain("系统只保存二维码校验信息；如需再次展示二维码，请重新生成");
  });
});
