import type { AuthenticatedUser } from "../../api/sampleRoomApi";
import { getPathnameFromInternalPath, isSafeInternalReturnPath } from "../../app/formalRouting";

export const qcTabletLoginError =
  "此 Pad 仅供组检/出库员工使用。裁剪和缝制员工请使用工序 Android 应用。";

export function isQcTabletLoginTarget(returnTo: unknown) {
  return typeof returnTo === "string" &&
    isSafeInternalReturnPath(returnTo) &&
    getPathnameFromInternalPath(returnTo) === "/qc/tablet";
}

export function isQcTabletWorker(user: AuthenticatedUser) {
  return user.role === "worker" &&
    user.accountType === "worker" &&
    user.activeWorkerType === "qc_delivery" &&
    Boolean(user.activeWorkerProfileId);
}

export function acceptsQcTabletLogin(
  returnTo: unknown,
  user: AuthenticatedUser
) {
  return !isQcTabletLoginTarget(returnTo) || isQcTabletWorker(user);
}
