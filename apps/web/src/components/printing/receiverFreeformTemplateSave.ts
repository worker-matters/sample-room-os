import {
  cloneFreeform,
  type ReceiverQrPrintSettings,
  type ReceiverSavedLabelLayout
} from "@sample-room/shared";

export class ReceiverFreeformTemplateLimitError extends Error {}

function paperSizeChanged(
  saved: ReceiverSavedLabelLayout,
  current: ReceiverQrPrintSettings["freeform"]
) {
  return saved.settings.widthMm !== current.widthMm || saved.settings.heightMm !== current.heightMm;
}

export function prepareReceiverFreeformTemplateSave({
  settings,
  editingLayoutId,
  saveAsNew,
  createLayoutId,
  createLayoutName
}: {
  settings: ReceiverQrPrintSettings;
  editingLayoutId?: string | undefined;
  saveAsNew: boolean;
  createLayoutId: () => string;
  createLayoutName: (templateNumber: number) => string;
}): ReceiverQrPrintSettings {
  const editingLayout = settings.savedLayouts.find((layout) => layout.id === editingLayoutId);
  const shouldCreate = saveAsNew || !editingLayout || paperSizeChanged(editingLayout, settings.freeform);

  if (shouldCreate) {
    if (settings.savedLayouts.length >= 12) throw new ReceiverFreeformTemplateLimitError();
    const layoutId = createLayoutId();
    const layout: ReceiverSavedLabelLayout = {
      id: layoutId,
      name: createLayoutName(settings.savedLayouts.length + 1),
      settings: cloneFreeform(settings.freeform)
    };
    return {
      ...settings,
      selectedLayoutId: layoutId,
      savedLayouts: [...settings.savedLayouts, layout]
    };
  }

  return {
    ...settings,
    selectedLayoutId: editingLayout.id,
    savedLayouts: settings.savedLayouts.map((layout) => layout.id === editingLayout.id
      ? { ...layout, settings: cloneFreeform(settings.freeform) }
      : layout)
  };
}
