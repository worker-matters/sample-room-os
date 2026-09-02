import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { OrderRecord } from "./orderTypes.js";

export const TERMINATED_ORDER_WRITE_MESSAGE = "订单已终止，无法继续修改。";

export async function lockActiveOrderForBusinessWrite(
  repository: SampleRoomRepository,
  orderId: string
): Promise<OrderRecord> {
  await repository.lockOrderForWorkflow(orderId);
  const order = await repository.findOrderById(orderId);
  if (!order) throw new HttpError(404, "order not found.");
  if (order.terminated) {
    throw new HttpError(409, TERMINATED_ORDER_WRITE_MESSAGE);
  }
  return order;
}
