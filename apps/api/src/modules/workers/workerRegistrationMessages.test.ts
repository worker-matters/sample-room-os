import { beforeEach, describe, expect, it } from "vitest";
import { headers, identityRepositories, request, type JsonValue } from "../receiver/testHelpers.js";

const bossHeaders = () => headers("boss", { userId: "formal-account-boss" });

describe("worker registration conflict messages", () => {
  beforeEach(async () => {
    await identityRepositories.systemSettings!.upsertSystemSetting({
      key: "runtime_endpoint_bases_v1",
      value: {
        publicWebBaseUrl: "https://scan.example.com",
        lanWebBaseUrl: "http://192.168.10.20:5173",
        publicApiBaseUrl: "",
        lanApiBaseUrl: ""
      },
      updatedBy: "formal-account-system-owner"
    });
  });

  it("returns Chinese duplicate-name and duplicate-phone messages with the current worker role", async () => {
    const issued = await request("/api/workers/registration-tokens", {
      method: "POST",
      headers: bossHeaders(),
      body: JSON.stringify({ workerType: "sewing" })
    });
    expect(issued.response.status).toBe(201);

    const urls = issued.body.registrationUrls as JsonValue;
    const registrationUrl = (urls.public ?? urls.lan) as string;
    const rawToken = new URL(registrationUrl).pathname.split("/").pop()!;
    const payload = `REGISTER|${rawToken}`;

    const first = await request("/api/workers/registration/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload,
        phoneNumber: "13977770001",
        password: "worker-password",
        name: "提示测试员工甲"
      })
    });
    expect(first.response.status).toBe(201);

    const duplicatePhone = await request("/api/workers/registration/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload,
        phoneNumber: "13977770001",
        password: "worker-password",
        name: "提示测试员工乙"
      })
    });
    expect(duplicatePhone.response.status).toBe(409);
    expect(duplicatePhone.body.error).toBe("该手机号已注册，角色为：缝制员工");

    const duplicateName = await request("/api/workers/registration/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload,
        phoneNumber: "13977770002",
        password: "worker-password",
        name: "提示测试员工甲"
      })
    });
    expect(duplicateName.response.status).toBe(409);
    expect(duplicateName.body.error).toBe("该姓名已注册");
  });
});
