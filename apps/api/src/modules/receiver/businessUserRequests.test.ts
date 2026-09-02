import { describe, expect, it } from "vitest";
import {
  createBusinessUserRequest,
  headers,
  identityRepositories,
  repository,
  request,
  type JsonValue
} from "./testHelpers.js";

describe("business-user request API regressions", () => {
  it("lets customer_all client users create and list business-user account requests under their own customer", async () => {
    const customerAdmin = headers("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });

    const created = await createBusinessUserRequest(customerAdmin, {
      customerId: "mock-customer-other",
      businessUserName: "客户 A 新业务员",
      contact: "new-a@example.com"
    });
    const list = await request("/api/client/business-user-requests", {
      headers: customerAdmin
    });
    const requestRecord = created.body.request as JsonValue;

    expect(created.response.status).toBe(201);
    expect(requestRecord).toMatchObject({
      customerId: "mock-customer-active",
      customerName: "Mock Active Customer",
      requestedByClientUserId: "mock-client-user-admin",
      requestedByName: "客户 A 主管账号",
      businessUserName: "客户 A 新业务员",
      contact: "new-a@example.com",
      status: "pending"
    });
    expect(requestRecord.customerId).not.toBe("mock-customer-other");
    expect((list.body.requests as JsonValue[])).toHaveLength(1);
  });

  it("blocks own-scope clients and receivers from creating customer business-user requests", async () => {
    const ownClient = headers("client_business_user", {
      userId: "mock-client-user-active",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active"
    });

    const ownBlocked = await createBusinessUserRequest(ownClient);
    const receiverBlocked = await createBusinessUserRequest(headers("receiver"));

    expect(ownBlocked.response.status).toBe(403);
    expect(ownBlocked.body.error).toBe("forbidden");
    expect(receiverBlocked.response.status).toBe(403);
  });

  it("stores only the registration password hash internally and never returns it from APIs", async () => {
    const customerAdmin = headers("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });
    const opened = await request("/api/client/business-user-registration-code/open", {
      method: "POST",
      headers: customerAdmin
    });
    const token = ((opened.body.registration as JsonValue).code as JsonValue).token as string;
    const submitted = await request(`/api/client/business-user-registration/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        businessUserName: "Registration Applicant",
        contact: "registration-applicant@example.com",
        username: "registration-applicant@example.com",
        password: "Registration123"
      })
    });
    const listed = await request("/api/system-owner/business-user-requests", {
      headers: headers("boss")
    });
    const stored = (await repository.listBusinessUserRequests()).find(
      (item) => item.id === (submitted.body.request as JsonValue).id
    );

    expect(submitted.response.status).toBe(201);
    expect(JSON.stringify(submitted.body)).not.toContain("requestedPasswordHash");
    expect(JSON.stringify(listed.body)).not.toContain("requestedPasswordHash");
    expect(stored?.requestedPasswordHash).toBeTruthy();
    expect(stored?.requestedPasswordHash).not.toBe("Registration123");
  });

  it("lets boss and System Owner approve requests and create active own-scope client users", async () => {
    const customerAdmin = headers("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });
    const initialClientUsers = await repository.listClientUsersByCustomerId("mock-customer-active");
    const created = await createBusinessUserRequest(customerAdmin, {
      businessUserName: "审批测试业务员",
      contact: "approved-user@example.com"
    });
    const id = (created.body.request as JsonValue).id as string;

    const bossList = await request("/api/system-owner/business-user-requests", {
      headers: headers("boss")
    });
    const approved = await request(`/api/system-owner/business-user-requests/${id}/review`, {
      method: "PATCH",
      headers: headers("system_owner"),
      body: JSON.stringify({ status: "approved" })
    });
    const systemOwnerList = await request("/api/system-owner/business-user-requests", {
      headers: headers("system_owner")
    });
    const finalClientUsers = await repository.listClientUsersByCustomerId("mock-customer-active");
    const createdClientUser = finalClientUsers.find(
      (clientUser) => clientUser.displayName === "审批测试业务员"
    );

    expect(bossList.response.status).toBe(200);
    expect((bossList.body.requests as JsonValue[]).map((item) => item.id)).toContain(id);
    expect(approved.body.request).toMatchObject({
      id,
      status: "approved",
      reviewedBy: "mock-system-owner",
      reviewedByRole: "system_owner",
      createdClientUserId: createdClientUser?.id
    });
    expect((systemOwnerList.body.requests as JsonValue[])[0]).toMatchObject({
      id,
      status: "approved"
    });
    expect(finalClientUsers).toHaveLength(initialClientUsers.length + 1);
    expect(createdClientUser).toMatchObject({
      customerId: "mock-customer-active",
      displayName: "审批测试业务员",
      contact: "approved-user@example.com",
      status: "active",
      clientAccessScope: "own"
    });
    expect(await identityRepositories.accounts.findAccountById(createdClientUser!.accountId!)).toMatchObject({
      role: "client_business_user"
    });
  });

  it("creates customer and salesperson profiles without login accounts, then adds logins on demand", async () => {
    const created = await request("/api/system-owner/customer-accounts", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({
        customerName: "资料账号拆分测试客户"
      })
    });
    const customer = created.body.customer as JsonValue;
    expect(created.response.status).toBe(201);
    expect(customer).toMatchObject({
      name: "资料账号拆分测试客户"
    });
    expect(customer.clientUsers).toEqual([]);

    const ordinaryProfile = await request(
      `/api/system-owner/customer-accounts/${customer.id}/client-users`,
      {
        method: "POST",
        headers: headers("boss"),
        body: JSON.stringify({
          displayName: "无账号普通业务员",
          contact: "profile-only-ordinary@example.com"
        })
      }
    );
    const adminProfile = await request(
      `/api/system-owner/customer-accounts/${customer.id}/client-users`,
      {
        method: "POST",
        headers: headers("boss"),
        body: JSON.stringify({
          displayName: "无账号主管候选人",
          contact: "profile-only-admin@example.com"
        })
      }
    );
    expect(ordinaryProfile.response.status).toBe(201);
    expect(adminProfile.response.status).toBe(201);
    expect(ordinaryProfile.body.clientUser).toMatchObject({
      hasLoginAccount: false,
      status: "active"
    });
    expect(adminProfile.body.clientUser).toMatchObject({
      hasLoginAccount: false,
      status: "active"
    });

    const ordinaryLogin = await request(
      `/api/system-owner/client-users/${(ordinaryProfile.body.clientUser as JsonValue).id}/account`,
      {
        method: "POST",
        headers: headers("boss"),
        body: JSON.stringify({
          username: "profile-only-ordinary@example.com",
          role: "client_business_user"
        })
      }
    );
    const adminLogin = await request(
      `/api/system-owner/client-users/${(adminProfile.body.clientUser as JsonValue).id}/account`,
      {
        method: "POST",
        headers: headers("boss"),
        body: JSON.stringify({
          username: "profile-only-admin@example.com",
          role: "client_admin"
        })
      }
    );

    expect(ordinaryLogin.response.status).toBe(201);
    expect(ordinaryLogin.body.clientUser).toMatchObject({
      hasLoginAccount: true,
      loginRole: "client_business_user",
      clientAccessScope: "own"
    });
    expect(adminLogin.response.status).toBe(201);
    expect(adminLogin.body.clientUser).toMatchObject({
      hasLoginAccount: true,
      loginRole: "client_admin",
      clientAccessScope: "customer_all"
    });
    expect(await identityRepositories.accounts.findAccountByUsername("profile-only-admin@example.com")).toMatchObject({
      role: "client_admin"
    });
    expect(((adminLogin.body.loginCredential as JsonValue).temporaryPassword as string).length).toBeGreaterThanOrEqual(8);

    const duplicateLogin = await request(
      `/api/system-owner/client-users/${(adminProfile.body.clientUser as JsonValue).id}/account`,
      {
        method: "POST",
        headers: headers("boss"),
        body: JSON.stringify({
          username: "profile-only-admin-duplicate@example.com",
          role: "client_admin"
        })
      }
    );
    expect(duplicateLogin.response.status).toBe(409);
  });

  it("keeps customer account list reads write-free when customers have zero or multiple supervisors", async () => {
    const noSupervisorCustomer = await repository.createCustomer({
      name: "Legacy No Supervisor",
      status: "active"
    });
    const multiSupervisorCustomer = await repository.createCustomer({
      name: "Legacy Multi Supervisor",
      status: "active"
    });
    const supervisorA = await repository.createClientUser({
      customerId: multiSupervisorCustomer.id,
      displayName: "Legacy Supervisor A",
      status: "active",
      clientAccessScope: "customer_all"
    });
    const supervisorB = await repository.createClientUser({
      customerId: multiSupervisorCustomer.id,
      displayName: "Legacy Supervisor B",
      status: "active",
      clientAccessScope: "customer_all"
    });
    const beforeNoSupervisor = await repository.listClientUsersByCustomerId(noSupervisorCustomer.id);
    const beforeMultiSupervisor = await repository.listClientUsersByCustomerId(multiSupervisorCustomer.id);

    const listed = await request("/api/system-owner/customer-accounts", {
      headers: headers("boss")
    });
    const customers = listed.body.customers as JsonValue[];
    const noSupervisorSummary = customers.find(
      (customer) => customer.id === noSupervisorCustomer.id
    )!;
    const multiSupervisorSummary = customers.find(
      (customer) => customer.id === multiSupervisorCustomer.id
    )!;
    const afterNoSupervisor = await repository.listClientUsersByCustomerId(noSupervisorCustomer.id);
    const afterMultiSupervisor = await repository.listClientUsersByCustomerId(multiSupervisorCustomer.id);

    expect(listed.response.status).toBe(200);
    expect(noSupervisorSummary.clientUsers).toEqual([]);
    expect((multiSupervisorSummary.clientUsers as JsonValue[])).toHaveLength(2);
    expect((multiSupervisorSummary.clientUsers as JsonValue[]).every(
      (profile) => profile.hasLoginAccount === false
    )).toBe(true);
    expect(afterNoSupervisor).toEqual(beforeNoSupervisor);
    expect(afterMultiSupervisor).toEqual(beforeMultiSupervisor);
    expect(afterMultiSupervisor.map((profile) => profile.id)).toEqual([supervisorA.id, supervisorB.id]);
  });

  it("supports multiple supervisors, role conversion, and independent profile and login status", async () => {
    const customer = await repository.createCustomer({
      name: "多主管与独立状态测试客户",
      status: "active"
    });
    const profileA = await repository.createClientUser({
      customerId: customer.id,
      displayName: "多主管 A",
      contact: "multi-admin-a@example.com",
      status: "active",
      clientAccessScope: "own"
    });
    const profileB = await repository.createClientUser({
      customerId: customer.id,
      displayName: "多主管 B",
      contact: "multi-admin-b@example.com",
      status: "active",
      clientAccessScope: "own"
    });
    for (const [profile, username] of [
      [profileA, "multi-admin-a@example.com"],
      [profileB, "multi-admin-b@example.com"]
    ] as const) {
      const generated = await request(`/api/system-owner/client-users/${profile.id}/account`, {
        method: "POST",
        headers: headers("boss"),
        body: JSON.stringify({ username, role: "client_admin" })
      });
      expect(generated.response.status).toBe(201);
      expect(generated.body.clientUser).toMatchObject({ loginRole: "client_admin" });
    }

    const downgraded = await request(`/api/system-owner/client-users/${profileA.id}/account/role`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ role: "client_business_user" })
    });
    const upgraded = await request(`/api/system-owner/client-users/${profileA.id}/account/role`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ role: "client_admin" })
    });
    const accountDisabled = await request(`/api/system-owner/client-users/${profileA.id}/account/status`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ status: "archived" })
    });
    const profileAfterAccountDisable = await repository.findClientUserById(profileA.id);
    const profileArchived = await request(`/api/system-owner/client-users/${profileA.id}/status`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ status: "archived" })
    });
    const loginAfterProfileArchive = await identityRepositories.accounts.findAccountByUsername(
      "multi-admin-a@example.com"
    );

    expect(downgraded.response.status).toBe(200);
    expect(downgraded.body.clientUser).toMatchObject({
      loginRole: "client_business_user",
      clientAccessScope: "own"
    });
    expect(upgraded.response.status).toBe(200);
    expect(upgraded.body.clientUser).toMatchObject({
      loginRole: "client_admin",
      clientAccessScope: "customer_all",
      loginStatus: "active"
    });
    expect(accountDisabled.response.status).toBe(200);
    expect(accountDisabled.body.clientUser).toMatchObject({
      loginStatus: "disabled",
      status: "active"
    });
    expect(profileAfterAccountDisable).toMatchObject({ status: "active" });
    expect(profileArchived.response.status).toBe(200);
    expect(profileArchived.body.clientUser).toMatchObject({
      status: "archived",
      loginStatus: "disabled"
    });
    expect(loginAfterProfileArchive).toMatchObject({ status: "suspended", role: "client_admin" });
  });

  it("cascades customer login status and restores only the selected salesperson when requested", async () => {
    const customer = await repository.createCustomer({
      name: "客户停用级联测试",
      status: "active"
    });
    const profileA = await repository.createClientUser({
      customerId: customer.id,
      displayName: "级联业务员 A",
      contact: "cascade-a@example.com",
      status: "active",
      clientAccessScope: "own"
    });
    const profileB = await repository.createClientUser({
      customerId: customer.id,
      displayName: "级联业务员 B",
      contact: "cascade-b@example.com",
      status: "active",
      clientAccessScope: "own"
    });

    for (const [profile, username] of [
      [profileA, "cascade-a@example.com"],
      [profileB, "cascade-b@example.com"]
    ] as const) {
      const generated = await request(`/api/system-owner/client-users/${profile.id}/account`, {
        method: "POST",
        headers: headers("boss"),
        body: JSON.stringify({ username, role: "client_business_user" })
      });
      expect(generated.response.status).toBe(201);
    }

    const archived = await request(`/api/system-owner/customer-accounts/${customer.id}/status`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ status: "archived" })
    });
    expect(archived.response.status).toBe(200);
    expect(archived.body.customer).toMatchObject({
      status: "archived",
      archivedBy: "mock-boss"
    });
    expect(typeof (archived.body.customer as JsonValue).archivedAt).toBe("string");
    expect(await identityRepositories.accounts.findAccountByUsername("cascade-a@example.com")).toMatchObject({
      status: "suspended"
    });
    expect(await identityRepositories.accounts.findAccountByUsername("cascade-b@example.com")).toMatchObject({
      status: "suspended"
    });

    const restoredA = await request(`/api/system-owner/client-users/${profileA.id}/account/status`, {
      method: "PATCH",
      headers: headers("system_owner"),
      body: JSON.stringify({ status: "active" })
    });
    expect(restoredA.response.status).toBe(200);
    expect(restoredA.body.clientUser).toMatchObject({ loginStatus: "active" });
    expect(await repository.findCustomerById(customer.id)).toMatchObject({ status: "active" });
    expect(await identityRepositories.accounts.findAccountByUsername("cascade-b@example.com")).toMatchObject({
      status: "suspended"
    });

    await request(`/api/system-owner/customer-accounts/${customer.id}/status`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ status: "archived" })
    });
    const restoredCustomer = await request(`/api/system-owner/customer-accounts/${customer.id}/status`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ status: "active" })
    });
    expect(restoredCustomer.response.status).toBe(200);
    expect(restoredCustomer.body.customer).toMatchObject({ status: "active" });
    expect(await identityRepositories.accounts.findAccountByUsername("cascade-a@example.com")).toMatchObject({
      status: "active"
    });
    expect(await identityRepositories.accounts.findAccountByUsername("cascade-b@example.com")).toMatchObject({
      status: "active"
    });
  });

  it("lets customer supervisors edit and reset same-customer business-user login accounts only", async () => {
    const customerAdmin = headers("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });

    const edited = await request("/api/client/business-users/mock-client-user-active", {
      method: "PATCH",
      headers: customerAdmin,
      body: JSON.stringify({
        displayName: "客户 A 业务员账号已编辑",
        username: "customer-a-sales-renamed@example.com",
        contact: "sales-renamed@example.com"
      })
    });
    const duplicateUsername = await request("/api/client/business-users/mock-client-user-active", {
      method: "PATCH",
      headers: customerAdmin,
      body: JSON.stringify({ username: "client-admin@sample-room.test" })
    });
    const roleChangeBlocked = await request("/api/client/business-users/mock-client-user-active", {
      method: "PATCH",
      headers: customerAdmin,
      body: JSON.stringify({ clientAccessScope: "customer_all" })
    });
    const selfBlocked = await request("/api/client/business-users/mock-client-user-admin", {
      method: "PATCH",
      headers: customerAdmin,
      body: JSON.stringify({ username: "admin-self-renamed@example.com" })
    });
    const crossCustomerBlocked = await request("/api/client/business-users/mock-client-user-other", {
      method: "PATCH",
      headers: customerAdmin,
      body: JSON.stringify({ username: "other-renamed@example.com" })
    });
    const reset = await request("/api/client/business-users/mock-client-user-active/reset-password", {
      method: "POST",
      headers: customerAdmin,
      body: JSON.stringify({})
    });

    expect(edited.response.status).toBe(200);
    expect(edited.body.clientUser).toMatchObject({
      id: "mock-client-user-active",
      displayName: "客户 A 业务员账号已编辑",
      contact: "sales-renamed@example.com",
      loginUsername: "customer-a-sales-renamed@example.com",
      clientAccessScope: "own"
    });
    expect(duplicateUsername.response.status).toBe(409);
    expect(roleChangeBlocked.response.status).toBe(409);
    expect(selfBlocked.response.status).toBe(409);
    expect(crossCustomerBlocked.response.status).toBe(403);
    expect(reset.response.status).toBe(200);
    expect(reset.body.loginCredential).toMatchObject({
      username: "customer-a-sales-renamed@example.com"
    });
    expect(((reset.body.loginCredential as JsonValue).temporaryPassword as string).length).toBeGreaterThanOrEqual(8);
  });

  it("lets boss and customer supervisors archive and restore ordinary business users only", async () => {
    const clientUser = await repository.createClientUser({
      customerId: "mock-customer-active",
      displayName: "停用恢复测试业务员",
      contact: "archive-restore@example.com",
      status: "active",
      clientAccessScope: "own"
    });
    const customerAdmin = headers("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });
    const ownClient = headers("client_business_user", {
      userId: "mock-client-user-active",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active"
    });

    const bossArchived = await request(`/api/system-owner/client-users/${clientUser.id}/status`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ status: "archived" })
    });
    const bossRestored = await request(`/api/system-owner/client-users/${clientUser.id}/status`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ status: "active" })
    });
    const supervisorArchived = await request(`/api/client/business-users/${clientUser.id}/status`, {
      method: "PATCH",
      headers: customerAdmin,
      body: JSON.stringify({ status: "archived" })
    });
    const archivedList = await request("/api/client/business-users", {
      headers: customerAdmin
    });
    const supervisorRestored = await request(`/api/client/business-users/${clientUser.id}/status`, {
      method: "PATCH",
      headers: customerAdmin,
      body: JSON.stringify({ status: "active" })
    });
    const selfBlocked = await request("/api/client/business-users/mock-client-user-admin/status", {
      method: "PATCH",
      headers: customerAdmin,
      body: JSON.stringify({ status: "archived" })
    });
    const crossCustomerBlocked = await request("/api/client/business-users/mock-client-user-other/status", {
      method: "PATCH",
      headers: customerAdmin,
      body: JSON.stringify({ status: "archived" })
    });
    const ownScopeBlocked = await request(`/api/client/business-users/${clientUser.id}/status`, {
      method: "PATCH",
      headers: ownClient,
      body: JSON.stringify({ status: "archived" })
    });

    expect(bossArchived.response.status).toBe(200);
    expect(bossArchived.body.clientUser).toMatchObject({
      status: "archived",
      archivedBy: "mock-boss"
    });
    expect(typeof (bossArchived.body.clientUser as JsonValue).archivedAt).toBe("string");
    expect(bossRestored.response.status).toBe(200);
    expect(bossRestored.body.clientUser).toMatchObject({ status: "active" });
    expect(supervisorArchived.response.status).toBe(200);
    expect(supervisorArchived.body.clientUser).toMatchObject({
      status: "archived",
      archivedBy: "mock-client-user-admin"
    });
    expect(typeof (supervisorArchived.body.clientUser as JsonValue).archivedAt).toBe("string");
    expect((archivedList.body.clientUsers as JsonValue[])).toContainEqual(
      expect.objectContaining({
        id: clientUser.id,
        status: "archived",
        clientAccessScope: "own",
        archivedBy: "mock-client-user-admin"
      })
    );
    expect(supervisorRestored.response.status).toBe(200);
    expect(supervisorRestored.body.clientUser).toMatchObject({ status: "active" });
    expect(selfBlocked.response.status).toBe(409);
    expect(crossCustomerBlocked.response.status).toBe(403);
    expect(ownScopeBlocked.response.status).toBe(403);
  });

  it("does not create duplicate client users when approving the same request twice", async () => {
    const customerAdmin = headers("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });
    const initialClientUsers = await repository.listClientUsersByCustomerId("mock-customer-active");
    const created = await createBusinessUserRequest(customerAdmin, {
      businessUserName: "重复审批业务员",
      contact: "repeat-approval@example.com"
    });
    const id = (created.body.request as JsonValue).id as string;

    const firstApproval = await request(`/api/system-owner/business-user-requests/${id}/review`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ status: "approved" })
    });
    const secondApproval = await request(`/api/system-owner/business-user-requests/${id}/review`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ status: "approved" })
    });
    const finalClientUsers = await repository.listClientUsersByCustomerId("mock-customer-active");

    expect(firstApproval.response.status).toBe(200);
    expect(secondApproval.response.status).toBe(200);
    expect(secondApproval.body.request).toMatchObject({
      id,
      status: "approved",
      createdClientUserId: (firstApproval.body.request as JsonValue).createdClientUserId
    });
    expect(finalClientUsers).toHaveLength(initialClientUsers.length + 1);
  });

  it("reuses a unique accountless profile and keeps a later duplicate-account registration pending", async () => {
    const customerAdmin = headers("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });
    const existingProfile = await repository.createClientUser({
      customerId: "mock-customer-active",
      displayName: "已有无账号业务员资料",
      contact: "same-contact@example.com",
      status: "active",
      clientAccessScope: "own"
    });
    const initialClientUsers = await repository.listClientUsersByCustomerId("mock-customer-active");
    const first = await createBusinessUserRequest(customerAdmin, {
      businessUserName: "联系方式重复业务员",
      contact: "same-contact@example.com"
    });
    const second = await createBusinessUserRequest(customerAdmin, {
      businessUserName: "联系方式重复业务员二号",
      contact: "same-contact@example.com"
    });

    const firstApproval = await request(
      `/api/system-owner/business-user-requests/${(first.body.request as JsonValue).id}/review`,
      {
        method: "PATCH",
        headers: headers("boss"),
        body: JSON.stringify({ status: "approved" })
      }
    );
    const secondApproval = await request(
      `/api/system-owner/business-user-requests/${(second.body.request as JsonValue).id}/review`,
      {
        method: "PATCH",
        headers: headers("system_owner"),
        body: JSON.stringify({ status: "approved" })
      }
    );
    const finalClientUsers = await repository.listClientUsersByCustomerId("mock-customer-active");

    expect(firstApproval.response.status).toBe(200);
    expect((firstApproval.body.request as JsonValue).createdClientUserId).toBe(existingProfile.id);
    expect(secondApproval.response.status).toBe(409);
    expect(secondApproval.body.error).toContain("already has a login account");
    const requests = await repository.listBusinessUserRequests();
    expect(requests.find((item) => item.id === (second.body.request as JsonValue).id)).toMatchObject({
      status: "pending"
    });
    expect(finalClientUsers).toHaveLength(initialClientUsers.length);
  });

  it("lets boss reject business-user account requests without creating client users", async () => {
    const customerAdmin = headers("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });
    const initialClientUsers = await repository.listClientUsersByCustomerId("mock-customer-active");
    const created = await createBusinessUserRequest(customerAdmin, {
      businessUserName: "待拒绝业务员",
      contact: "rejected-user@example.com"
    });
    const id = (created.body.request as JsonValue).id as string;

    const rejected = await request(`/api/system-owner/business-user-requests/${id}/review`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ status: "rejected", reviewNote: "资料不完整" })
    });

    expect(rejected.response.status).toBe(200);
    expect(rejected.body.request).toMatchObject({
      id,
      status: "rejected",
      reviewedBy: "mock-boss",
      reviewedByRole: "boss",
      reviewNote: "资料不完整"
    });
    const finalClientUsers = await repository.listClientUsersByCustomerId("mock-customer-active");
    expect(finalClientUsers).toHaveLength(
      initialClientUsers.length
    );
    expect(
      finalClientUsers
        .some((clientUser) => clientUser.contact === "rejected-user@example.com")
    ).toBe(false);
  });

  it("returns per-row preview and creation results for partially invalid bulk input", async () => {
    const customerPreview = await request("/api/system-owner/customer-accounts/bulk-preview", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({
        rows: [
          { customerName: "批量客户有效项" },
          { customerName: "" },
          { customerName: "Mock Active Customer" }
        ]
      })
    });
    const customerCreated = await request("/api/system-owner/customer-accounts/bulk", {
      method: "POST",
      headers: headers("boss"),
      body: JSON.stringify({
        rows: [
          { customerName: "批量客户有效项" },
          { customerName: "" },
          { customerName: "Mock Active Customer" }
        ]
      })
    });

    expect(customerPreview.response.status).toBe(200);
    expect((customerPreview.body.results as JsonValue[]).map((row) => row.status)).toEqual([
      "valid",
      "failed",
      "failed"
    ]);
    expect(customerCreated.response.status).toBe(207);
    expect((customerCreated.body.results as JsonValue[]).map((row) => row.status)).toEqual([
      "created",
      "failed",
      "failed"
    ]);

    const createdCustomer = ((customerCreated.body.results as JsonValue[])[0]!.data as JsonValue);
    const profileCreated = await request(
      `/api/system-owner/customer-accounts/${createdCustomer.id}/client-users/bulk`,
      {
        method: "POST",
        headers: headers("boss"),
        body: JSON.stringify({
          rows: [
            { displayName: "批量业务员有效项", contact: "bulk-valid@example.com" },
            { displayName: "" },
            { displayName: "重复联系方式", contact: "bulk-valid@example.com" }
          ]
        })
      }
    );
    expect(profileCreated.response.status).toBe(207);
    expect((profileCreated.body.results as JsonValue[]).map((row) => row.status)).toEqual([
      "created",
      "failed",
      "failed"
    ]);
    expect(((profileCreated.body.results as JsonValue[])[0]!.data as JsonValue)).toMatchObject({
      displayName: "批量业务员有效项",
      hasLoginAccount: false
    });
  });

  it("exposes approved client users to receiver self-entry options and customer admin filters", async () => {
    const customerAdmin = headers("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });
    const created = await createBusinessUserRequest(customerAdmin, {
      businessUserName: "可选业务员",
      contact: "selectable@example.com"
    });
    const rejected = await createBusinessUserRequest(customerAdmin, {
      businessUserName: "不可选业务员",
      contact: "not-selectable@example.com"
    });

    await request(`/api/system-owner/business-user-requests/${(created.body.request as JsonValue).id}/review`, {
      method: "PATCH",
      headers: headers("system_owner"),
      body: JSON.stringify({ status: "approved" })
    });
    await request(`/api/system-owner/business-user-requests/${(rejected.body.request as JsonValue).id}/review`, {
      method: "PATCH",
      headers: headers("boss"),
      body: JSON.stringify({ status: "rejected" })
    });
    const accountlessProfile = await request(
      "/api/system-owner/customer-accounts/mock-customer-active/client-users",
      {
        method: "POST",
        headers: headers("boss"),
        body: JSON.stringify({
          displayName: "无账号可选业务员",
          contact: "accountless-selectable@example.com"
        })
      }
    );
    expect(accountlessProfile.response.status).toBe(201);
    expect(accountlessProfile.body.clientUser).toMatchObject({ hasLoginAccount: false });

    const receiverOptions = await request("/api/receiver/self-entry-options", {
      headers: headers("receiver")
    });
    const customerAdminOrders = await request("/api/client/orders", {
      headers: customerAdmin
    });
    const activeCustomerOptions = (receiverOptions.body.customers as JsonValue[]).find(
      (customer) => customer.id === "mock-customer-active"
    )!;
    const otherCustomerOptions = (receiverOptions.body.customers as JsonValue[]).find(
      (customer) => customer.id === "mock-customer-other"
    )!;

    expect((activeCustomerOptions.clientUsers as JsonValue[]).map((clientUser) => clientUser.displayName)).toContain(
      "可选业务员"
    );
    expect((activeCustomerOptions.clientUsers as JsonValue[]).map((clientUser) => clientUser.displayName)).toContain(
      "无账号可选业务员"
    );
    expect((activeCustomerOptions.clientUsers as JsonValue[]).map((clientUser) => clientUser.displayName)).not.toContain(
      "不可选业务员"
    );
    expect((otherCustomerOptions.clientUsers as JsonValue[]).map((clientUser) => clientUser.displayName)).not.toContain(
      "可选业务员"
    );
    expect((customerAdminOrders.body.clientUsers as JsonValue[]).map((clientUser) => clientUser.displayName)).toContain(
      "可选业务员"
    );
    expect((customerAdminOrders.body.clientUsers as JsonValue[]).map((clientUser) => clientUser.displayName)).toContain(
      "无账号可选业务员"
    );
    expect((customerAdminOrders.body.clientUsers as JsonValue[]).map((clientUser) => clientUser.displayName)).not.toContain(
      "不可选业务员"
    );
  });
});
