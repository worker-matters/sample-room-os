import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ordersDirectory = dirname(fileURLToPath(import.meta.url));
const thumbnailSource = readFileSync(
  resolve(ordersDirectory, "OrderAttachmentThumbnail.tsx"),
  "utf8"
);
const summarySource = readFileSync(
  resolve(ordersDirectory, "BossOrderSummaryHeader.tsx"),
  "utf8"
);
const pricingPanelSource = readFileSync(
  resolve(ordersDirectory, "BossPricingPanel.tsx"),
  "utf8"
);
const pricingFixCss = readFileSync(
  resolve(ordersDirectory, "../../app/pricingWorkflowFixes.css"),
  "utf8"
);

describe("boss pricing thumbnail preview", () => {
  it("keeps order thumbnails non-interactive unless a preview handler is provided", () => {
    expect(thumbnailSource).toContain("onPreview?: (attachment: TAttachment) => void;");
    expect(thumbnailSource).toContain("if (onPreview)");
    expect(thumbnailSource).toContain("onClick={() => onPreview(attachment)}");
  });

  it("opens the shared attachment preview from the boss order summary thumbnail", () => {
    expect(summarySource).toContain("AttachmentPreviewModal");
    expect(summarySource).toContain("onPreview={openThumbnailPreview}");
    expect(summarySource).toContain("load: () => loadPreview(order, attachment)");
    expect(summarySource).toContain("request={previewRequest}");
  });

  it("labels pricing actions from pricing history instead of unrelated row tags", () => {
    expect(pricingPanelSource).toContain("function pricingActionLabel(row: PricingRow)");
    expect(pricingPanelSource).toContain('quotationStatus === "confirmed"');
    expect(pricingPanelSource).toContain("Boolean(row.confirmedQuotation)");
    expect(pricingPanelSource).toContain("Boolean(row.quotationHasUnconfirmedChanges)");
    expect(pricingPanelSource).toContain("{pricingActionLabel(row)}");
    expect(pricingFixCss).not.toContain(":has(.ant-tag-green, .ant-tag-warning)");
    expect(pricingFixCss).not.toContain('content: "修改定价"');
  });
});
