import type { PricingRecord } from "./pricingTypes.js";

function positiveInteger(value: number | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

export function confirmedSettlementQuantity(
  orderQuantity: number,
  pricing: PricingRecord | undefined
) {
  const items = pricing?.confirmedCustomerChargeSnapshot ?? [];
  const mainProductionSample = items.find(
    (item) =>
      !item.archivedAt &&
      item.sourceType === "system_recommended" &&
      item.pricingMethod === "unit_quantity" &&
      (item.sourceTask === "生产样衣" || item.sourceTask === "生产小样")
  );

  return positiveInteger(mainProductionSample?.quantity) ?? orderQuantity;
}
