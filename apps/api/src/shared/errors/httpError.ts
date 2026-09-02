const USER_FACING_ERROR_MESSAGES: Record<string, string> = {
  "The order is included in an active reconciliation statement and its other charges are locked.":
    "当前订单已进入对账单，如需增加费用，请联系老板退回该款式"
};

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(USER_FACING_ERROR_MESSAGES[message] ?? message);
    this.name = "HttpError";
  }
}
