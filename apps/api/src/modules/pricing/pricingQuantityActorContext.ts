import { AsyncLocalStorage } from "node:async_hooks";
import type { CurrentUser } from "../auth/currentUser.js";

export type PricingOperationMode =
  | "pricing_confirm"
  | "statement_create"
  | "statement_return";

type PricingOperationContext = {
  currentUser: CurrentUser;
  mode: PricingOperationMode;
};

const pricingOperationStorage = new AsyncLocalStorage<PricingOperationContext>();

export function withPricingQuantityActor<T>(
  currentUser: CurrentUser,
  operation: () => T | Promise<T>,
  mode: PricingOperationMode = "pricing_confirm"
) {
  return pricingOperationStorage.run({ currentUser, mode }, operation);
}

export function currentPricingQuantityActor() {
  return pricingOperationStorage.getStore()?.currentUser;
}

export function currentPricingOperationMode() {
  return pricingOperationStorage.getStore()?.mode;
}
