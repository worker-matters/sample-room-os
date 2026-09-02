import { Button, Modal, Space, Spin, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { downloadBlob } from "../../utils/downloadBlob";
import { attachmentOperationErrorMessage } from "./attachmentErrors";
import {
  isSafeAttachmentPreviewMime,
  isSafeImagePreviewMime
} from "./attachmentPreview";

export type AttachmentPreviewRequest = {
  key: string;
  fileName: string;
  mimeType?: string;
  load: () => Promise<Blob>;
};

type LoadedPreview = {
  blob?: Blob;
  mimeType?: string;
  url?: string;
  loading: boolean;
  error?: string;
};

export function AttachmentPreviewModal({
  request,
  onClose
}: {
  request?: AttachmentPreviewRequest | undefined;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<LoadedPreview>({ loading: false });
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const urlRef = useRef<string | undefined>(undefined);
  const requestIdRef = useRef(0);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | undefined>(undefined);

  const releaseUrl = useCallback(() => {
    if (!urlRef.current) return;
    URL.revokeObjectURL(urlRef.current);
    urlRef.current = undefined;
  }, []);

  const resetInteraction = useCallback(() => {
    setTransform({ scale: 1, x: 0, y: 0 });
    dragRef.current = undefined;
  }, []);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    releaseUrl();
    resetInteraction();
    if (!request) {
      setPreview({ loading: false });
      return;
    }

    setPreview({ loading: true });
    void request.load().then((blob) => {
      if (requestId !== requestIdRef.current) return;
      const mimeType = blob.type || request.mimeType;
      if (!isSafeAttachmentPreviewMime(mimeType)) {
        setPreview({ blob, ...(mimeType ? { mimeType } : {}), loading: false });
        return;
      }
      const url = URL.createObjectURL(blob);
      if (requestId !== requestIdRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      urlRef.current = url;
      setPreview({ blob, ...(mimeType ? { mimeType } : {}), url, loading: false });
    }).catch((error) => {
      if (requestId !== requestIdRef.current) return;
      releaseUrl();
      setPreview({ loading: false, error: attachmentOperationErrorMessage(error) });
    });
  }, [releaseUrl, request?.key, resetInteraction]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    releaseUrl();
  }, [releaseUrl]);

  const close = () => {
    requestIdRef.current += 1;
    releaseUrl();
    resetInteraction();
    setPreview({ loading: false });
    onClose();
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!preview.url) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.1 : -0.1;
    setTransform((current) => ({
      ...current,
      scale: Math.min(4, Math.max(0.5, Number((current.scale + delta).toFixed(2))))
    }));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !preview.url) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setTransform((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  };

  const stopDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <Modal
      title={request ? `附件预览 · ${request.fileName}` : "附件预览"}
      open={Boolean(request)}
      footer={(
        <Space>
          <Button
            disabled={!preview.blob}
            onClick={() => {
              if (preview.blob && request) downloadBlob(preview.blob, request.fileName);
            }}
          >
            下载
          </Button>
          <Button onClick={close}>关闭</Button>
        </Space>
      )}
      onCancel={close}
      destroyOnHidden
      width="calc(100vw - 48px)"
      style={{ top: 24, maxWidth: "calc(100vw - 48px)" }}
      className="attachment-preview-modal"
    >
      <Spin spinning={preview.loading}>
        <div
          className={`unified-attachment-preview-body${preview.url ? " is-interactive" : ""}`}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          {preview.error ? (
            <Typography.Text type="danger">{preview.error}</Typography.Text>
          ) : preview.url && isSafeImagePreviewMime(preview.mimeType) ? (
            <div
              className="unified-attachment-preview-canvas"
              style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
            >
              <img src={preview.url} alt={request?.fileName} draggable={false} />
            </div>
          ) : preview.url && preview.mimeType?.toLowerCase() === "application/pdf" ? (
            <div
              className="unified-attachment-preview-canvas unified-attachment-preview-pdf"
              style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
            >
              <iframe src={preview.url} title={request?.fileName} />
            </div>
          ) : preview.loading ? (
            <Typography.Text type="secondary">正在加载附件预览…</Typography.Text>
          ) : preview.blob ? (
            <Typography.Text type="secondary">当前格式不支持在线预览</Typography.Text>
          ) : null}
        </div>
      </Spin>
    </Modal>
  );
}
