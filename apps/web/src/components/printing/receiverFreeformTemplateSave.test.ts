import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
  cloneFreeform,
  type ReceiverQrPrintSettings
} from "@sample-room/shared";
import {
  prepareReceiverFreeformTemplateSave,
  ReceiverFreeformTemplateLimitError
} from "./receiverFreeformTemplateSave";

function settingsWithOneTemplate(): ReceiverQrPrintSettings {
  const first = {
    id: "freeform-first",
    name: "50mm × 50mm（自由设计 1）",
    settings: cloneFreeform(DEFAULT_RECEIVER_QR_PRINT_SETTINGS.freeform)
  };
  return {
    ...DEFAULT_RECEIVER_QR_PRINT_SETTINGS,
    selectedLayoutId: first.id,
    freeform: cloneFreeform(first.settings),
    savedLayouts: [first]
  };
}

function save(settings: ReceiverQrPrintSettings, options?: { saveAsNew?: boolean }) {
  return prepareReceiverFreeformTemplateSave({
    settings,
    editingLayoutId: "freeform-first",
    saveAsNew: options?.saveAsNew ?? false,
    createLayoutId: () => "freeform-second",
    createLayoutName: (number) => `${settings.freeform.widthMm}mm × ${settings.freeform.heightMm}mm（自由设计 ${number}）`
  });
}

describe("receiver freeform template saving", () => {
  it("keeps the previous template when the paper size changes", () => {
    const current = settingsWithOneTemplate();
    current.freeform = { ...current.freeform, widthMm: 40, heightMm: 65 };

    const result = save(current);

    expect(result.savedLayouts).toHaveLength(2);
    expect(result.savedLayouts[0]?.settings).toMatchObject({ widthMm: 50, heightMm: 50 });
    expect(result.savedLayouts[1]?.settings).toMatchObject({ widthMm: 40, heightMm: 65 });
    expect(result.selectedLayoutId).toBe("freeform-second");
  });

  it("updates the current template when its paper size is unchanged", () => {
    const current = settingsWithOneTemplate();
    current.freeform = { ...current.freeform, summaryText: "新摘要" };

    const result = save(current);

    expect(result.savedLayouts).toHaveLength(1);
    expect(result.savedLayouts[0]?.settings.summaryText).toBe("新摘要");
  });

  it("can save another template with the same paper size", () => {
    const current = settingsWithOneTemplate();
    current.freeform = { ...current.freeform, summaryText: "同尺寸的另一套排版" };

    const result = save(current, { saveAsNew: true });

    expect(result.savedLayouts).toHaveLength(2);
    expect(result.savedLayouts[0]?.settings.summaryText).not.toBe("同尺寸的另一套排版");
    expect(result.savedLayouts[1]?.settings.summaryText).toBe("同尺寸的另一套排版");
  });

  it("keeps the existing limit when creating another template", () => {
    const current = settingsWithOneTemplate();
    current.savedLayouts = Array.from({ length: 12 }, (_, index) => ({
      ...current.savedLayouts[0]!,
      id: `freeform-${index}`
    }));

    expect(() => save(current, { saveAsNew: true })).toThrow(ReceiverFreeformTemplateLimitError);
  });
});
