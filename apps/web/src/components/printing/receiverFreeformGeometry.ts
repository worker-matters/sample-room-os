import type { ReceiverLabelFreeformBox } from "@sample-room/shared";

export function clampFreeformValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function scaleFreeformBox(
  box: ReceiverLabelFreeformBox,
  requestedScale: number,
  minimumSize: number,
  center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
): ReceiverLabelFreeformBox {
  const minimumScale = Math.max(minimumSize / box.width, minimumSize / box.height);
  const maximumScale = Math.min(1 / box.width, 1 / box.height);
  const scale = clampFreeformValue(requestedScale, minimumScale, maximumScale);
  const width = box.width * scale;
  const height = box.height * scale;
  return {
    x: clampFreeformValue(center.x - width / 2, 0, 1 - width),
    y: clampFreeformValue(center.y - height / 2, 0, 1 - height),
    width,
    height
  };
}
