import { describe, expect, it } from "vitest";
import type { OrderRecord } from "../../api/sampleRoomApi";
import { getOrderEntrySourceLabel, getOrderReceiverLabel } from "./orderDisplay";

function order(fields: Partial<OrderRecord>): OrderRecord {
  return fields as OrderRecord;
}

describe("management order account display names", () => {
  it("shows resolved creator and receiver names", () => {
    expect(
      getOrderEntrySourceLabel(
        order({ sourceType: "receiver_self_entry", createdByName: "接单员小陈" })
      )
    ).toBe("接单员录入 · 接单员小陈");
    expect(
      getOrderEntrySourceLabel(
        order({ sourceType: "internal_manual", createdByName: "内部录入员小李" })
      )
    ).toBe("内部录入 · 内部录入员小李");
    expect(getOrderReceiverLabel(order({ receivedByName: "接单员小陈" }))).toBe(
      "接单人：接单员小陈"
    );
  });

  it("uses safe fallback text and never displays internal account IDs", () => {
    const internalAccountId = "account-internal-123";

    expect(
      getOrderEntrySourceLabel(
        order({ sourceType: "receiver_self_entry", createdBy: internalAccountId })
      )
    ).toBe("接单员录入");
    expect(
      getOrderEntrySourceLabel(
        order({ sourceType: "internal_manual", createdBy: internalAccountId })
      )
    ).toBe("内部录入");
    expect(getOrderReceiverLabel(order({ receivedBy: internalAccountId }))).toBe("接单人未知");
  });
});
