import {
  AlignCenterOutlined,
  FontSizeOutlined,
  QrcodeOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import { Button, Dropdown, Space, Typography } from "antd";
import type { MenuProps } from "antd";
import type {
  ReceiverLabelFreeformBox,
  ReceiverLabelFreeformSettings,
  ReceiverQrPrintSettings
} from "@sample-room/shared";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { ReceiverLabelPaper } from "./ReceiverLabelPreview";
import {
  clampFreeformValue,
  scaleFreeformBox
} from "./receiverFreeformGeometry";

type ElementName = "qr" | "summary";
type ResizeCorner = "nw" | "ne" | "sw" | "se";
type Interaction = {
  element: ElementName;
  action: "move" | "resize";
  corner?: ResizeCorner;
  startX: number;
  startY: number;
  box: ReceiverLabelFreeformBox;
};
type ActivePointer = { element: ElementName; x: number; y: number };
type PointerStart = ActivePointer & { box: ReceiverLabelFreeformBox };
type PinchInteraction = {
  element: ElementName;
  startDistance: number;
  startCenterX: number;
  startCenterY: number;
  box: ReceiverLabelFreeformBox;
};

function pointerDistance(first: ActivePointer, second: ActivePointer) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function ReceiverFreeformLabelDesigner({
  settings,
  freeform,
  onChange,
  onReset
}: {
  settings: ReceiverQrPrintSettings;
  freeform: ReceiverLabelFreeformSettings;
  onChange: (next: Partial<ReceiverLabelFreeformSettings>) => void;
  onReset: () => void;
}) {
  const [selected, setSelected] = useState<ElementName>("qr");
  const [canvasBounds, setCanvasBounds] = useState({ width: 440, height: 330 });
  const canvasFrameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | undefined>(undefined);
  const activePointersRef = useRef(new Map<number, PointerStart>());
  const pinchRef = useRef<PinchInteraction | undefined>(undefined);
  const editorSettings = useMemo(() => ({
    ...settings,
    selectedLayoutId: "freeform-editor",
    savedLayouts: [{ id: "freeform-editor", name: "编辑中", settings: freeform }]
  }), [freeform, settings]);

  const displayQrBox = useMemo(() => {
    const physicalSize = Math.min(
      freeform.qrBox.width * freeform.widthMm,
      freeform.qrBox.height * freeform.heightMm
    );
    return {
      ...freeform.qrBox,
      width: physicalSize / freeform.widthMm,
      height: physicalSize / freeform.heightMm
    };
  }, [freeform.heightMm, freeform.qrBox, freeform.widthMm]);

  const canvasDimensions = useMemo(() => {
    const scale = Math.min(canvasBounds.width / freeform.widthMm, canvasBounds.height / freeform.heightMm);
    return { width: freeform.widthMm * scale, height: freeform.heightMm * scale };
  }, [canvasBounds.height, canvasBounds.width, freeform.heightMm, freeform.widthMm]);

  useEffect(() => {
    const frame = canvasFrameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const updateBounds = () => {
      setCanvasBounds({
        width: Math.max(120, frame.clientWidth - 48),
        height: Math.max(120, frame.clientHeight - 48)
      });
    };
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const updateBox = (element: ElementName, box: ReceiverLabelFreeformBox) => {
    onChange(element === "qr" ? { qrBox: box } : { summaryBox: box });
  };

  const updateResizedBox = (
    element: ElementName,
    box: ReceiverLabelFreeformBox
  ) => {
    if (element === "qr") {
      onChange({ qrBox: box });
      return;
    }
    onChange({ summaryBox: box });
  };

  const startInteraction = (
    event: PointerEvent<HTMLElement>,
    element: ElementName,
    action: "move" | "resize",
    corner?: ResizeCorner
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelected(element);
    interactionRef.current = {
      element,
      action,
      ...(corner ? { corner } : {}),
      startX: event.clientX,
      startY: event.clientY,
      box: element === "qr" ? displayQrBox : freeform.summaryBox
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startElementInteraction = (event: PointerEvent<HTMLDivElement>, element: ElementName) => {
    event.preventDefault();
    event.stopPropagation();
    setSelected(element);
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, {
      element,
      x: event.clientX,
      y: event.clientY,
      box: element === "qr" ? displayQrBox : freeform.summaryBox
    });
    const pointers = [...activePointersRef.current.values()].filter((pointer) => pointer.element === element);
    if (pointers.length >= 2) {
      const [first, second] = pointers;
      pinchRef.current = {
        element,
        startDistance: Math.max(pointerDistance(first!, second!), 1),
        startCenterX: (first!.x + second!.x) / 2,
        startCenterY: (first!.y + second!.y) / 2,
        box: second!.box
      };
      interactionRef.current = undefined;
      return;
    }
    interactionRef.current = {
      element,
      action: "move",
      startX: event.clientX,
      startY: event.clientY,
      box: element === "qr" ? displayQrBox : freeform.summaryBox
    };
  };

  const moveInteraction = (event: PointerEvent<HTMLElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
      const tracked = activePointersRef.current.get(event.pointerId);
    if (tracked) {
      activePointersRef.current.set(event.pointerId, { ...tracked, x: event.clientX, y: event.clientY });
      const pinch = pinchRef.current;
      const pointers = pinch
        ? [...activePointersRef.current.values()].filter((pointer) => pointer.element === pinch.element)
        : [];
      if (pinch && pointers.length >= 2) {
        const [first, second] = pointers;
        const centerX = (first!.x + second!.x) / 2;
        const centerY = (first!.y + second!.y) / 2;
        const box = scaleFreeformBox(
          pinch.box,
          pointerDistance(first!, second!) / pinch.startDistance,
          pinch.element === "qr" ? 0.14 : 0.16,
          {
            x: pinch.box.x + pinch.box.width / 2 + (centerX - pinch.startCenterX) / width,
            y: pinch.box.y + pinch.box.height / 2 + (centerY - pinch.startCenterY) / height
          }
        );
        updateResizedBox(pinch.element, box);
        return;
      }
    }
    const interaction = interactionRef.current;
    if (!interaction) return;
    const dx = (event.clientX - interaction.startX) / width;
    const dy = (event.clientY - interaction.startY) / height;
    const minimum = interaction.element === "qr" ? 0.14 : 0.16;
    let next = { ...interaction.box };
    if (interaction.action === "move") {
      next.x = clampFreeformValue(interaction.box.x + dx, 0, 1 - interaction.box.width);
      next.y = clampFreeformValue(interaction.box.y + dy, 0, 1 - interaction.box.height);
    } else {
      const corner = interaction.corner ?? "se";
      const left = interaction.box.x;
      const top = interaction.box.y;
      const right = left + interaction.box.width;
      const bottom = top + interaction.box.height;
      if (interaction.element === "qr") {
        const pointerX = (corner.includes("w") ? left : right) * width + dx * width;
        const pointerY = (corner.includes("n") ? top : bottom) * height + dy * height;
        const anchorX = (corner.includes("w") ? right : left) * width;
        const anchorY = (corner.includes("n") ? bottom : top) * height;
        const availableWidth = corner.includes("w") ? anchorX - pointerX : pointerX - anchorX;
        const availableHeight = corner.includes("n") ? anchorY - pointerY : pointerY - anchorY;
        const maximumSize = Math.min(
          corner.includes("w") ? anchorX : width - anchorX,
          corner.includes("n") ? anchorY : height - anchorY
        );
        const size = clampFreeformValue(Math.min(availableWidth, availableHeight), minimum * Math.min(width, height), maximumSize);
        next.width = size / width;
        next.height = size / height;
        next.x = corner.includes("w") ? (anchorX - size) / width : anchorX / width;
        next.y = corner.includes("n") ? (anchorY - size) / height : anchorY / height;
      } else {
        const nextLeft = corner.includes("w") ? clampFreeformValue(left + dx, 0, right - minimum) : left;
        const nextRight = corner.includes("e") ? clampFreeformValue(right + dx, left + minimum, 1) : right;
        const nextTop = corner.includes("n") ? clampFreeformValue(top + dy, 0, bottom - minimum) : top;
        const nextBottom = corner.includes("s") ? clampFreeformValue(bottom + dy, top + minimum, 1) : bottom;
        next = {
          x: nextLeft,
          y: nextTop,
          width: nextRight - nextLeft,
          height: nextBottom - nextTop
        };
      }
    }
    if (interaction.action === "resize") {
      updateResizedBox(interaction.element, next);
    }
    else updateBox(interaction.element, next);
  };

  const endElementInteraction = (event: PointerEvent<HTMLElement>) => {
    activePointersRef.current.delete(event.pointerId);
    interactionRef.current = undefined;
    if (activePointersRef.current.size < 2) pinchRef.current = undefined;
  };

  const startResizeInteraction = (
    event: PointerEvent<HTMLElement>,
    element: ElementName,
    corner: ResizeCorner
  ) => {
    activePointersRef.current.clear();
    pinchRef.current = undefined;
    startInteraction(event, element, "resize", corner);
  };

  const align: MenuProps["onClick"] = ({ key }) => {
    const current = selected === "qr" ? displayQrBox : freeform.summaryBox;
    const next = { ...current };
    if (key === "left") next.x = 0.03;
    if (key === "center") next.x = (1 - next.width) / 2;
    if (key === "right") next.x = 0.97 - next.width;
    if (key === "top") next.y = 0.03;
    if (key === "middle") next.y = (1 - next.height) / 2;
    if (key === "bottom") next.y = 0.97 - next.height;
    updateBox(selected, next);
  };

  const canvasStyle = canvasDimensions;
  return (
    <div className="receiver-freeform-designer">
      <div className="receiver-freeform-toolbar">
        <Button type={selected === "qr" ? "primary" : "text"} icon={<QrcodeOutlined />} onClick={() => setSelected("qr")}>二维码</Button>
        <Button type={selected === "summary" ? "primary" : "text"} icon={<FontSizeOutlined />} disabled={!freeform.showOrderSummary} onClick={() => setSelected("summary")}>文本</Button>
        <Dropdown menu={{ onClick: align, items: [
          { key: "left", label: "左对齐" },
          { key: "center", label: "水平居中" },
          { key: "right", label: "右对齐" },
          { type: "divider" },
          { key: "top", label: "顶部对齐" },
          { key: "middle", label: "垂直居中" },
          { key: "bottom", label: "底部对齐" }
        ] }}>
          <Button type="text" icon={<AlignCenterOutlined />}>对齐</Button>
        </Dropdown>
        <Button type="text" icon={<ReloadOutlined />} onClick={onReset}>重置摘要</Button>
      </div>

      <div className="receiver-freeform-canvas-section">
        <Typography.Text strong>标签画布</Typography.Text>
        <div ref={canvasFrameRef} className="receiver-freeform-canvas-frame">
          <div className="receiver-freeform-ruler receiver-freeform-ruler-x"><span>0</span><span>{Math.round(freeform.widthMm / 2)}</span><span>{freeform.widthMm} mm</span></div>
          <div className="receiver-freeform-ruler receiver-freeform-ruler-y"><span>0</span><span>{Math.round(freeform.heightMm / 2)}</span><span>{freeform.heightMm}</span></div>
          <div ref={canvasRef} className="receiver-freeform-canvas" style={canvasStyle}>
            <ReceiverLabelPaper settings={editorSettings} className="receiver-freeform-paper" widthPx={canvasDimensions.width} />
            <div
              className={`receiver-freeform-selection ${selected === "qr" ? "is-selected" : ""}`}
              style={{ left: `${displayQrBox.x * 100}%`, top: `${displayQrBox.y * 100}%`, width: `${displayQrBox.width * 100}%`, height: `${displayQrBox.height * 100}%` }}
              onPointerDown={(event) => startElementInteraction(event, "qr")}
              onPointerMove={moveInteraction}
              onPointerUp={endElementInteraction}
              onPointerCancel={endElementInteraction}
            >
              {(["nw", "ne", "sw", "se"] as ResizeCorner[]).map((corner) => (
                <span key={corner} className={`receiver-freeform-resize is-${corner}`} onPointerDown={(event) => startResizeInteraction(event, "qr", corner)} />
              ))}
            </div>
            {freeform.showOrderSummary ? (
              <div
                className={`receiver-freeform-selection ${selected === "summary" ? "is-selected" : ""}`}
                style={{ left: `${freeform.summaryBox.x * 100}%`, top: `${freeform.summaryBox.y * 100}%`, width: `${freeform.summaryBox.width * 100}%`, height: `${freeform.summaryBox.height * 100}%` }}
                onPointerDown={(event) => startElementInteraction(event, "summary")}
                onPointerMove={moveInteraction}
                onPointerUp={endElementInteraction}
                onPointerCancel={endElementInteraction}
              >
                {(["nw", "ne", "sw", "se"] as ResizeCorner[]).map((corner) => (
                  <span key={corner} className={`receiver-freeform-resize is-${corner}`} onPointerDown={(event) => startResizeInteraction(event, "summary", corner)} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <Space size={6} className="receiver-freeform-hint">
          <span className="receiver-freeform-info">i</span>
          <Typography.Text type="secondary">拖动元素调整位置；拖动四角或在元素上双指缩放调整大小。</Typography.Text>
        </Space>
      </div>

      <div className="receiver-freeform-live-preview">
        <Typography.Text strong>预览</Typography.Text>
        <div className="receiver-freeform-live-preview-paper">
          <ReceiverLabelPaper settings={editorSettings} maxSize={140} />
        </div>
      </div>
    </div>
  );
}
