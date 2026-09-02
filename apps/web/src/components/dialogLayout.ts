// Business-first ideal widths. A dialog keeps its ideal width while it fits and
// only yields when the viewport needs the shared 16px safety margin per side.
export const dialogIdealWidths = {
  form: 760,
  business: 1080,
  data: 1240,
  workspace: 1360
} as const;

export type DialogWidth = keyof typeof dialogIdealWidths;

// Height and scroll ownership stay component-specific because forms, data lists,
// and preview workspaces need different vertical space allocation.
export function viewportBoundDialogWidth(size: DialogWidth) {
  return `min(${dialogIdealWidths[size]}px, calc(100vw - 32px))`;
}
