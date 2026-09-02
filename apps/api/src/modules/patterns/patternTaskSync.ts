import {
  patternTaskRequirementsFromItems,
  type PatternTaskRequirement
} from "@sample-room/shared";
import type { SampleRoomRepository } from "../../db/repositories/sampleRoomRepository.js";
import { HttpError } from "../../shared/errors/httpError.js";
import type { OrderRecord } from "../orders/orderTypes.js";
import { PATTERN_TASK_STATUSES, type PatternTaskRecord } from "./patternTypes.js";

function sameRequirements(
  left: readonly PatternTaskRequirement[],
  right: readonly PatternTaskRequirement[]
) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function assertPatternRequirementsCanChange(
  task: PatternTaskRecord | undefined,
  nextRequirements: readonly PatternTaskRequirement[]
) {
  if (!task || sameRequirements(task.requirements, nextRequirements)) {
    return;
  }

  if (
    [
      PATTERN_TASK_STATUSES.completed,
      PATTERN_TASK_STATUSES.submitted,
      PATTERN_TASK_STATUSES.submittedToCutting
    ].includes(task.status as typeof PATTERN_TASK_STATUSES.completed)
  ) {
    throw new HttpError(409, "版师任务已完成或已交付，不能再修改打样任务。");
  }

  if (
    task.status === PATTERN_TASK_STATUSES.active ||
    task.status === PATTERN_TASK_STATUSES.inProgress
  ) {
    throw new HttpError(409, "版师正在处理该任务，请先等待任务暂停后再修改。");
  }
}

export async function syncPatternTaskForOrder(
  repository: SampleRoomRepository,
  order: OrderRecord
): Promise<PatternTaskRecord | undefined> {
  const requirements = patternTaskRequirementsFromItems(order.sampleRequestItems);
  const existing = await repository.findPatternTaskByOrderId(order.id);
  assertPatternRequirementsCanChange(existing, requirements);

  if (requirements.length === 0) {
    if (existing && existing.status === PATTERN_TASK_STATUSES.pending && !existing.patternMakerId) {
      await repository.deletePendingPatternTask(existing.id);
    }
    return undefined;
  }

  if (!existing) {
    return repository.createPatternTask({
      orderId: order.id,
      status: PATTERN_TASK_STATUSES.pending,
      requirements
    });
  }

  if (sameRequirements(existing.requirements, requirements)) return existing;
  const selected = new Set(requirements);
  return repository.updatePatternTask(existing.id, {
    requirements,
    completedRequirements: existing.completedRequirements.filter((requirement) =>
      selected.has(requirement)
    )
  });
}
