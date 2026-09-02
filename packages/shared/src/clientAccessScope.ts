export const CLIENT_ACCESS_SCOPES = {
  own: "own",
  customerAll: "customer_all"
} as const;

export type ClientAccessScope =
  (typeof CLIENT_ACCESS_SCOPES)[keyof typeof CLIENT_ACCESS_SCOPES];

export const CLIENT_ACCESS_SCOPE_LABELS: Record<ClientAccessScope, string> = {
  own: "本人订单",
  customer_all: "客户全部订单"
};
