import { describe, expect, it } from "vitest";
import { environmentExample } from "../miniprogram/config/environment.example";
import { IDENTITY_PREVIEW_OPTIONS, identityPreviewAt, identityPreviewEnabled } from "../miniprogram/utils/identityPreview";

describe("development identity preview", () => {
  it("is disabled in the production configuration", () => {
    expect(environmentExample.buildMode).toBe("production");
    expect(environmentExample.enableDevIdentityPreview).toBe(false);
    expect(identityPreviewEnabled("release")).toBe(false);
  });

  it("covers every Account and Worker role plus unbound and disabled states", () => {
    expect(IDENTITY_PREVIEW_OPTIONS.map((option) => option.key)).toEqual([
      "unbound", "disabled", "boss", "receiver", "planner", "client_admin",
      "client_business_user", "cutting", "sewing", "qc_delivery"
    ]);
  });

  it("contains presentation state only and never a trusted target identifier", () => {
    for (let index = 0; index < IDENTITY_PREVIEW_OPTIONS.length; index += 1) {
      const identity = identityPreviewAt(index);
      expect(identity).not.toHaveProperty("accountId");
      expect(identity).not.toHaveProperty("workerId");
    }
    expect(identityPreviewAt(5).canScanOrder).toBe(false);
    expect(identityPreviewAt(6).canScanOrder).toBe(false);
    expect(identityPreviewAt(7)).toMatchObject({
      identityType: "account",
      role: "worker",
      workerType: "cutting"
    });
  });

  it("routes the receiver preview to the Phase 1 receiver home", () => {
    expect(identityPreviewAt(3)).toMatchObject({
      role: "receiver",
      homeRoute: "/pages/receiver/home"
    });
  });
});
