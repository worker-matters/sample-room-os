import { ATTACHMENT_VISIBILITY } from "@sample-room/shared";
import { HttpError } from "../../shared/errors/httpError.js";

export type EffectiveAttachmentVisibility =
  | typeof ATTACHMENT_VISIBILITY.clientVisible
  | typeof ATTACHMENT_VISIBILITY.internalOnly;

export function normalizeAttachmentVisibility(
  visibility: string | null | undefined
): EffectiveAttachmentVisibility {
  return visibility === ATTACHMENT_VISIBILITY.clientVisible
    ? ATTACHMENT_VISIBILITY.clientVisible
    : ATTACHMENT_VISIBILITY.internalOnly;
}

export function attachmentVisibilityFromInput(
  visibility: string | null | undefined,
  defaultVisibility: EffectiveAttachmentVisibility
): EffectiveAttachmentVisibility {
  if (visibility === undefined || visibility === null || visibility.trim() === "") {
    return defaultVisibility;
  }
  if (
    visibility === ATTACHMENT_VISIBILITY.clientVisible ||
    visibility === ATTACHMENT_VISIBILITY.internalOnly
  ) {
    return visibility;
  }
  throw new HttpError(400, "attachment_visibility_invalid");
}
