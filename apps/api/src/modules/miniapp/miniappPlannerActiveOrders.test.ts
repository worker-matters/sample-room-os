import { SAMPLE_REQUEST_ITEMS } from "@sample-room/shared";
import { describe, expect, it } from "vitest";
import {
  createClientOrder,
  headers,
  identityRepositories,
  repository,
  request,
  type JsonValue
} from "../receiver/testHelpers.js";
import { FormalAuthService } from "../auth/authService.js";
import { FORMAL_LOGIN_DEV_PASSWORD } from "../auth/devAuthAccounts.js";

async function loginAndroidPlanner() {
  const authService = new FormalAuthService(
    identityRepositories.accounts,
    identityRepositories.workerProfiles,
    identityRepositories.accountSessions,
    repository
  );
  const result = await authService.login({
    username: "planner@sample-room.test",
    password: FORMAL_LOGIN_DEV_PASSWORD,
    clientType: "android"
  });
  return result.token;
}

async function loginMiniappPlanner() {
  const result = await request("/api/miniapp/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "planner@sample-room.test",
      password: FORMAL_LOGIN_DEV_PASSWORD
    })
  });
  expect(result.response.status).toBe(200);
  return result.body.sessionToken as string;
}

async function acceptedOrder(styleNo: string) {
  const created = await createClientOrder(styleNo);
  const orderId = (created.body.order as JsonValue).id as string;
  await request(`/api/receiver/orders/${orderId}/accept`, {
    method: "POST",
    headers: headers("receiver"),
    body: JSON.stringify({
      patternStatus: "none",
      fabricStatus: "complete",
      trimStatus: "complete",
      sampleRequestItems: [SAMPLE_REQUEST_ITEMS.sampleGarment]
    })
  });
  return orderId;
}

describe("planner Android active order list", () => {
  it("excludes terminated orders only for Android sessions", async () => {
    const androidToken = await loginAndroidPlanner();
    const miniappToken = await loginMiniappPlanner();
    const orderId = await acceptedOrder("ANDROID-PLANNER-TERMINATED-HIDDEN");

    const beforeTermination = await request("/api/miniapp/planner/orders", {
      headers: { authorization: `Bearer ${androidToken}` }
    });
    expect((beforeTermination.body.orders as JsonValue[]).some((order) => order.id === orderId)).toBe(true);

    const terminated = await request(`/api/admin/orders/${orderId}/terminate`, {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({ reason: "Android active count regression" })
    });
    expect(terminated.response.status).toBe(200);

    const androidList = await request("/api/miniapp/planner/orders", {
      headers: { authorization: `Bearer ${androidToken}` }
    });
    expect((androidList.body.orders as JsonValue[]).some((order) => order.id === orderId)).toBe(false);

    const miniappList = await request("/api/miniapp/planner/orders", {
      headers: { authorization: `Bearer ${miniappToken}` }
    });
    expect((miniappList.body.orders as JsonValue[]).find((order) => order.id === orderId)).toMatchObject({
      terminated: true,
      stageLabel: "已终止"
    });

    const webPlannerList = await request("/api/planner/orders", {
      headers: headers("planner")
    });
    expect((webPlannerList.body.orders as JsonValue[]).find((order) => order.id === orderId)).toMatchObject({
      terminated: true,
      stageLabel: "已终止"
    });
  });
});
