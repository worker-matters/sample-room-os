export const ORDER_QR_VERSION = "SRS2" as const;
export const ORDER_QR_TYPE = "ORDER" as const;
export const MAX_ORDER_QR_TOKEN_LENGTH = 256;

const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export type OrderQrPayload = {
  version: typeof ORDER_QR_VERSION;
  type: typeof ORDER_QR_TYPE;
  token: string;
};

export class OrderQrPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderQrPayloadError";
  }
}

export const parseMiniappOrderQrPayload = (payload: string): OrderQrPayload => {
  const parts = payload.split("|");
  if (parts.length !== 3) {
    throw new OrderQrPayloadError("不是有效的样品间订单二维码");
  }

  const [version, type, token] = parts;
  if (version !== ORDER_QR_VERSION) {
    throw new OrderQrPayloadError("二维码版本不受支持");
  }
  if (type !== ORDER_QR_TYPE) {
    throw new OrderQrPayloadError("二维码类型不是订单码");
  }
  if (!token) {
    throw new OrderQrPayloadError("订单二维码 token 为空");
  }
  if (token.length > MAX_ORDER_QR_TOKEN_LENGTH) {
    throw new OrderQrPayloadError("订单二维码载荷过长");
  }
  if (!TOKEN_PATTERN.test(token)) {
    throw new OrderQrPayloadError("订单二维码 token 含非法字符");
  }

  return { version, type, token };
};

export const maskOrderQrToken = (token: string): string => {
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
};
