import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import type { CurrentUser } from "../auth/currentUser.js";
import type { OrderRecord } from "../orders/orderTypes.js";
import type { OrderFolderRecord } from "./patternTypes.js";
import {
  buildOrderFolderInput,
  ensureOrderFolderOnDisk,
  getPatternFileRoots,
  withCurrentOrderFolderPaths
} from "./localPatternFileWorkflow.js";

export async function ensureOrderFolder(
  repository: SampleRoomRepository,
  order: OrderRecord,
  actor: Pick<CurrentUser, "id"> | string,
  env: NodeJS.ProcessEnv = process.env
): Promise<OrderFolderRecord> {
  const actorId = typeof actor === "string" ? actor : actor.id;
  const roots = getPatternFileRoots(env);
  const existing = await repository.findOrderFolderByOrderId(order.id);

  if (existing) {
    const currentPaths = withCurrentOrderFolderPaths(existing, roots);
    await ensureOrderFolderOnDisk(order, currentPaths, true);
    return {
      ...existing,
      ...currentPaths
    };
  }

  const input = buildOrderFolderInput(order, actorId, roots);
  await ensureOrderFolderOnDisk(order, input);
  const created = await repository.createOrderFolder(input);
  return {
    ...created,
    ...input
  };
}
