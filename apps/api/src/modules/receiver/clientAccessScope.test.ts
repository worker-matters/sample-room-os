import { describe, expect, it } from "vitest";
import {
  createClientOrder,
  headers,
  request,
  type JsonValue
} from "./testHelpers.js";

describe("client access scope API regressions", () => {
  it("isolates client order lists by bound customer", async () => {
    const activeClient = headers("client_business_user", {
      userId: "mock-client-user-active",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active"
    });
    const otherClient = headers("client_business_user", {
      userId: "mock-client-user-other",
      customerId: "mock-customer-other",
      clientUserId: "mock-client-user-other"
    });

    await createClientOrder("ACTIVE-ONLY", activeClient);
    await createClientOrder("OTHER-ONLY", otherClient);

    const activeList = await request("/api/client/orders", { headers: activeClient });
    const otherList = await request("/api/client/orders", { headers: otherClient });

    expect((activeList.body.orders as JsonValue[]).map((order) => order.styleNo)).toEqual([
      "ACTIVE-ONLY"
    ]);
    expect((otherList.body.orders as JsonValue[]).map((order) => order.styleNo)).toEqual([
      "OTHER-ONLY"
    ]);
  });

  it("limits own-scope client users to their own orders under the same customer", async () => {
    const activeClient = headers("client_business_user", {
      userId: "mock-client-user-active",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active"
    });
    const secondClient = headers("client_business_user", {
      userId: "mock-client-user-second",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-second"
    });

    await createClientOrder("A-OWNER-ONLY", activeClient);
    await createClientOrder("A-SECOND-ONLY", secondClient);

    const activeList = await request("/api/client/orders", { headers: activeClient });
    const secondList = await request("/api/client/orders", { headers: secondClient });

    expect((activeList.body.orders as JsonValue[]).map((order) => order.styleNo)).toEqual([
      "A-OWNER-ONLY"
    ]);
    expect((secondList.body.orders as JsonValue[]).map((order) => order.styleNo)).toEqual([
      "A-SECOND-ONLY"
    ]);
  });

  it("lets customer_all client users see and filter same-customer business user orders only", async () => {
    const activeClient = headers("client_business_user", {
      userId: "mock-client-user-active",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active"
    });
    const secondClient = headers("client_business_user", {
      userId: "mock-client-user-second",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-second"
    });
    const otherClient = headers("client_business_user", {
      userId: "mock-client-user-other",
      customerId: "mock-customer-other",
      clientUserId: "mock-client-user-other"
    });
    const customerAdmin = headers("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });

    await createClientOrder("A-OWNER-VISIBLE", activeClient);
    await createClientOrder("A-SECOND-VISIBLE", secondClient);
    await createClientOrder("B-HIDDEN", otherClient);

    const allCustomerA = await request("/api/client/orders", { headers: customerAdmin });
    const secondOnly = await request(
      "/api/client/orders?clientUserId=mock-client-user-second",
      { headers: customerAdmin }
    );
    const crossCustomerFilter = await request(
      "/api/client/orders?clientUserId=mock-client-user-other",
      { headers: customerAdmin }
    );

    expect(allCustomerA.response.status).toBe(200);
    expect((allCustomerA.body.orders as JsonValue[]).map((order) => order.styleNo)).toEqual([
      "A-OWNER-VISIBLE",
      "A-SECOND-VISIBLE"
    ]);
    expect((allCustomerA.body.orders as JsonValue[]).map((order) => order.deliveryDate)).toEqual([
      "2026-06-30",
      "2026-06-30"
    ]);
    expect(
      (allCustomerA.body.orders as JsonValue[]).map((order) => order.salespersonName)
    ).toEqual(["客户 A 普通业务员", "客户 A 业务员 2"]);
    expect(
      (allCustomerA.body.orders as JsonValue[]).map(
        (order) => (order.clientUserSnapshot as JsonValue).displayName
      )
    ).toEqual(["客户 A 普通业务员", "客户 A 业务员 2"]);
    expect((allCustomerA.body.orders as JsonValue[]).every((order) => typeof order.createdAt === "string")).toBe(
      true
    );
    expect(allCustomerA.body.clientAccessScope).toBe("customer_all");
    expect((allCustomerA.body.clientUsers as JsonValue[]).map((clientUser) => clientUser.id)).toEqual([
      "mock-client-user-active",
      "mock-client-user-second"
    ]);
    expect((secondOnly.body.orders as JsonValue[]).map((order) => order.styleNo)).toEqual([
      "A-SECOND-VISIBLE"
    ]);
    expect(crossCustomerFilter.response.status).toBe(400);
    expect(crossCustomerFilter.body.error).toBe(
      "clientUserId filter is not available for this customer."
    );
  });

  it("blocks customer_all client users from creating sample requests or creating on behalf of others", async () => {
    const customerAdmin = headers("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });

    const asSelf = await createClientOrder("ADMIN-CREATE-SELF", customerAdmin);
    const onBehalf = await createClientOrder("ADMIN-CREATE-OTHER", customerAdmin, {
      clientUserId: "mock-client-user-second"
    });

    expect(asSelf.response.status).toBe(403);
    expect(onBehalf.response.status).toBe(403);
    expect(asSelf.body.error).toBe(
      "customer admin accounts cannot create sample requests in this phase."
    );
  });

  it("rejects unbound client sessions instead of returning all orders", async () => {
    await createClientOrder("BOUND-ORDER");

    const result = await request("/api/client/orders", {
      headers: {
        "content-type": "application/json",
        "x-dev-role": "client_business_user",
        "x-dev-unbound-client": "true"
      }
    });

    expect(result.response.status).toBe(403);
    expect(result.body.error).toBe("client user session is missing customer binding.");
  });

  it("rejects client sessions whose client user does not belong to the bound customer", async () => {
    const result = await request("/api/client/orders", {
      headers: headers("client_business_user", {
        customerId: "mock-customer-active",
        clientUserId: "mock-client-user-other"
      })
    });

    expect(result.response.status).toBe(403);
    expect(result.body.error).toBe("client user is not bound to an active customer.");
  });

  it("blocks client users from supplementing another customer's returned order", async () => {
    const activeClient = headers("client_business_user", {
      userId: "mock-client-user-active",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active"
    });
    const otherClient = headers("client_business_user", {
      userId: "mock-client-user-other",
      customerId: "mock-customer-other",
      clientUserId: "mock-client-user-other"
    });
    const created = await createClientOrder("SUPPLEMENT-BLOCK", activeClient);
    const id = (created.body.order as JsonValue).id as string;

    await request(`/api/receiver/orders/${id}/return`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({ returnReason: "Need customer supplement." })
    });
    const blocked = await request(`/api/client/orders/${id}/supplement`, {
      method: "PATCH",
      headers: otherClient,
      body: JSON.stringify({ remark: "cross customer write" })
    });

    expect(blocked.response.status).toBe(404);
  });

  it("blocks own-scope and customer_all users from supplementing orders outside their write scope", async () => {
    const activeClient = headers("client_business_user", {
      userId: "mock-client-user-active",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-active"
    });
    const secondClient = headers("client_business_user", {
      userId: "mock-client-user-second",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-second"
    });
    const customerAdmin = headers("client_admin", {
      userId: "mock-client-user-admin",
      customerId: "mock-customer-active",
      clientUserId: "mock-client-user-admin"
    });
    const created = await createClientOrder("SAME-CUSTOMER-SUPPLEMENT-BLOCK", secondClient);
    const id = (created.body.order as JsonValue).id as string;

    await request(`/api/receiver/orders/${id}/return`, {
      method: "POST",
      headers: headers("receiver"),
      body: JSON.stringify({ returnReason: "Need customer supplement." })
    });
    const ownBlocked = await request(`/api/client/orders/${id}/supplement`, {
      method: "PATCH",
      headers: activeClient,
      body: JSON.stringify({ remark: "same customer but not own" })
    });
    const adminBlocked = await request(`/api/client/orders/${id}/supplement`, {
      method: "PATCH",
      headers: customerAdmin,
      body: JSON.stringify({ remark: "admin write not allowed" })
    });

    expect(ownBlocked.response.status).toBe(404);
    expect(adminBlocked.response.status).toBe(403);
    expect(adminBlocked.body.error).toBe("customer admin accounts cannot change orders in this phase.");
  });
});
