import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../../api/sampleRoomApi";
import {
  acceptsQcTabletLogin,
  qcTabletLoginError
} from "./qcTabletLoginBoundary";

function worker(
  activeWorkerType: "cutting" | "sewing" | "qc_delivery"
): AuthenticatedUser {
  return {
    id: `worker-${activeWorkerType}`,
    accountId: `worker-${activeWorkerType}`,
    accountType: "worker",
    role: "worker",
    homeRoute: "/worker/scan",
    activeWorkerProfileId: `profile-${activeWorkerType}`,
    activeWorkerType
  };
}

describe("QC tablet login boundary", () => {
  it("keeps a QC worker session and allows the tablet return path", async () => {
    expect(acceptsQcTabletLogin("/qc/tablet", worker("qc_delivery"))).toBe(true);
  });

  it.each(["cutting", "sewing"] as const)(
    "rejects a %s worker before the Web session is activated",
    async (workerType) => {
      expect(acceptsQcTabletLogin("/qc/tablet", worker(workerType))).toBe(false);
      expect(qcTabletLoginError).toBe(
        "此 Pad 仅供组检/出库员工使用。裁剪和缝制员工请使用工序 Android 应用。"
      );
    }
  );
});
