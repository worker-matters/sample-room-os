import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  patternTaskRequirementsFromItems,
  physicalProductionRoute,
  sampleRequestItemOptions
} from "@sample-room/shared";
import {
  receiverIntakeSubmissionAttachments,
  receiverIntakeThumbnailAttachmentIndex,
  type ReceiverIntakeAttachmentState
} from "./ReceiverIntakeAttachmentWorkspace";

function attachment(fileName: string, mimeType: string, category: string) {
  return { fileName, mimeType, category, size: 10, visibility: "internal_only" as const };
}

describe("receiver Web intake UI rules", () => {
  it("uses the one shared ten-item definition in the confirmed row-major order", () => {
    expect(sampleRequestItemOptions.map((option) => option.label)).toEqual([
      "生产样衣", "生产小样", "制版",
      "改版", "推全码版", "报价核料",
      "大货核料", "充棉/绒量", "核拉链长度",
      "裁剪"
    ]);

    const pageSource = readFileSync(fileURLToPath(new URL("../../pages/receiver/ReceiverWorkbenchPage.tsx", import.meta.url)), "utf8");
    const sectionSource = readFileSync(fileURLToPath(new URL("./ReceiverSampleRequestSection.tsx", import.meta.url)), "utf8");
    expect(pageSource.match(/<ReceiverSampleRequestSection \/>/g)).toHaveLength(2);
    expect(sectionSource).toContain("options={sampleRequestItemOptions}");
  });

  it("derives only selected pattern tasks and keeps cutting in the physical route", () => {
    const selected = ["sample_garment", "pattern_making", "cutting"] as const;
    expect(patternTaskRequirementsFromItems(selected)).toEqual(["pattern_making"]);
    expect(physicalProductionRoute(selected)).toEqual(["cutting", "sewing", "qc_delivery"]);
    expect(patternTaskRequirementsFromItems(["sample_garment", "cutting"])).toEqual([]);
  });

  it("combines sample-sheet files before ordinary files and limits thumbnails to sample images", () => {
    const state: ReceiverIntakeAttachmentState = {
      sampleSheetAttachments: [
        attachment("sample.pdf", "application/pdf", "receiver_quick_photo"),
        attachment("thumbnail.png", "image/png", "receiver_quick_photo")
      ],
      ordinaryAttachments: [attachment("ordinary.png", "image/png", "receiver_attachment")],
      thumbnailSampleIndex: 1
    };

    expect(receiverIntakeSubmissionAttachments(state).map((item) => item.category)).toEqual([
      "receiver_quick_photo",
      "receiver_quick_photo",
      "receiver_attachment"
    ]);
    expect(receiverIntakeThumbnailAttachmentIndex(state)).toBe(1);
    expect(receiverIntakeThumbnailAttachmentIndex({ ...state, thumbnailSampleIndex: 0 })).toBeUndefined();
  });

  it("keeps independent attachment state for full and quick modes", () => {
    const pageSource = readFileSync(fileURLToPath(new URL("../../pages/receiver/ReceiverWorkbenchPage.tsx", import.meta.url)), "utf8");
    expect(pageSource).toContain("const [quickEntryAttachments, setQuickEntryAttachments]");
    expect(pageSource).toContain("const [fullEntryAttachments, setFullEntryAttachments]");
    expect(pageSource).not.toContain("selfEntryAttachments");
  });

  it("keeps the sample-sheet workspace stable when the attachment list is empty", () => {
    const styles = readFileSync(fileURLToPath(new URL("../../app/styles.css", import.meta.url)), "utf8");
    expect(styles).toContain(".app-data-workbench-shell .receiver-intake-sample-scroll");
    expect(styles).toContain("height: clamp(220px, 23dvh, 236px)");
    expect(styles).not.toContain(".app-data-workbench-shell .receiver-intake-sample-scroll > .ant-empty");
  });

  it("requires a positive-integer quick-photo quantity and includes eligible pending orders in the order list", () => {
    const pageSource = readFileSync(fileURLToPath(new URL("../../pages/receiver/ReceiverWorkbenchPage.tsx", import.meta.url)), "utf8");
    expect(pageSource).toContain("initialValues={{ quantity: 1");
    expect(pageSource).toContain('name="quantity"');
    expect(pageSource).toContain("Number.isInteger(value) && value > 0");
    expect(pageSource).toContain('order.sourceType === "receiver_self_entry"');
    expect(pageSource).toContain('order.intakeStatus === "pending_receive"');
    expect(pageSource).toContain("order.stage !== null");
    expect(pageSource).not.toContain("productionWorkflowStages.has(order.stage)");
    expect(pageSource).toContain('const canShowOrderScanLink = (order: OrderRecord) =>');
  });
});
