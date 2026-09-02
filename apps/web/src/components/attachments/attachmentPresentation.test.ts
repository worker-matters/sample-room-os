import { describe, expect, it } from "vitest";
import {
  attachmentRoleLabels,
  attachmentTagLabel,
  attachmentUploaderLabel
} from "./attachmentPresentation";

describe("attachment presentation", () => {
  it("uses one shared business label for receiver sample sheets", () => {
    expect(attachmentTagLabel("style_thumbnail")).toBe("打样单相关");
    expect(attachmentTagLabel("receiver_sample_sheet")).toBe("打样单相关");
    expect(attachmentTagLabel("receiver_quick_photo")).toBe("打样单相关");
    expect(attachmentTagLabel("receiver_material_record")).toBe("面辅料记录");
    expect(attachmentTagLabel("receiver_attachment")).toBe("普通附件");
    expect(attachmentTagLabel("client_result")).toBe("其他附件");
    expect(attachmentTagLabel("unknown_internal_category")).toBe("其他附件");
  });

  it("uses the shared role labels shown by every attachment list", () => {
    expect(attachmentRoleLabels.receiver).toBe("接单员");
    expect(attachmentRoleLabels.planner).toBe("计划员");
    expect(attachmentRoleLabels.pattern_maker).toBe("版师");
    expect(attachmentRoleLabels.boss).toBe("老板");
    expect(attachmentRoleLabels.system_owner).toBe("System Owner");
  });

  it("shows only the resolved uploader name and never exposes the internal account ID", () => {
    expect(
      attachmentUploaderLabel({
        uploadedBy: "formal-account-receiver"
      })
    ).toBe("-");
    expect(
      attachmentUploaderLabel({
        uploadedBy: "formal-account-receiver",
        uploadedByName: "Receiver"
      })
    ).toBe("Receiver");
  });
});
