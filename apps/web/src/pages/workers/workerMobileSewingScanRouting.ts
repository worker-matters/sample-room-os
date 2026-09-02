import type { ScanPageState } from "../../api/sampleRoomApi";

export type SewingTaskIdentity = {
  orderId: string;
  styleNo: string;
  quantity: number;
  startedAt: string;
};

type PresentedScanState = ScanPageState & {
  order: ScanPageState["order"] & { recordSubmittedAt?: string };
};

export function findOwnedSewingTaskForScan<T extends SewingTaskIdentity>(
  state: ScanPageState,
  tasks: readonly T[]
): T | undefined {
  if (
    state.stage !== "sewing" ||
    state.allowedAction !== "complete" ||
    !state.startedByCurrentWorker
  ) {
    return undefined;
  }

  const presentedState = state as PresentedScanState;
  const startedAt = state.activeTask?.startedAt ?? presentedState.order.recordSubmittedAt;
  if (startedAt) {
    const exact = tasks.find(
      (task) =>
        task.startedAt === startedAt &&
        task.styleNo === state.order.styleNo &&
        task.quantity === state.order.quantity
    );
    if (exact) return exact;
  }

  const candidates = tasks.filter(
    (task) => task.styleNo === state.order.styleNo && task.quantity === state.order.quantity
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}
