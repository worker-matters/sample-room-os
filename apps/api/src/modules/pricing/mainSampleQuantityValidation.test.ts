import { describe, expect, it } from "vitest";
import {
  createReceiverSelfEntry,
  headers,
  repository,
  request,
  type JsonValue
} from "../receiver/testHelpers.js";

describe("main production sample pricing quantity", () => {
  it("rejects fractional pieces without changing the order quantity", async () => {
    const created = await createReceiverSelfEntry("MAIN-SAMPLE-INTEGER", {
      quantity: 1,
      sampleRequestItems: ["sample_garment"]
    });
    const orderId = (created.body.order as JsonValue).id as string;

    const initialized = await request(`/api/admin/orders/${orderId}/pricing/initialize`, {
      method: "POST",
      headers: headers("boss")
    });
    expect(initialized.response.status).toBe(200);
    const items = (initialized.body.pricing as JsonValue).customerChargeItems as JsonValue[];
    const sampleCharge = items.find((item) => item.sourceTask === "生产样衣");
    expect(sampleCharge).toBeTruthy();

    const invalid = await request(
      `/api/admin/orders/${orderId}/pricing/customer-charges/${sampleCharge!.id as string}`,
      {
        method: "PATCH",
        headers: headers("boss"),
        body: JSON.stringify({ unitPrice: 200, quantity: 1.5 })
      }
    );

    expect(invalid.response.status).toBe(400);
    expect(invalid.body.error).toBe("样衣/小样数量必须是大于 0 的整数。");
    expect((await repository.findOrderById(orderId))?.quantity).toBe(1);
  });
});
