import { useEffect, useRef, useState } from "react";
import type { OrderAttachment } from "../../api/sampleRoomApi";
import { getOrderThumbnailAttachment } from "./orderThumbnail";
import { isSafeImagePreviewMime } from "../attachments/attachmentPreview";

type AttachmentOrder<TAttachment extends OrderAttachment> = {
  attachments?: TAttachment[];
};

type OrderAttachmentThumbnailProps<
  TAttachment extends OrderAttachment,
  TOrder extends AttachmentOrder<TAttachment>
> = {
  order: TOrder;
  loadPreview?: (order: TOrder, attachment: TAttachment) => Promise<Blob>;
  onPreview?: (attachment: TAttachment) => void;
};

export function OrderAttachmentThumbnail<
  TAttachment extends OrderAttachment,
  TOrder extends AttachmentOrder<TAttachment>
>({ order, loadPreview, onPreview }: OrderAttachmentThumbnailProps<TAttachment, TOrder>) {
  const attachment = getOrderThumbnailAttachment(order);
  const [url, setUrl] = useState<string>();
  const hasPreviewLoader = Boolean(loadPreview);
  const orderRef = useRef(order);
  const loadPreviewRef = useRef(loadPreview);
  orderRef.current = order;
  loadPreviewRef.current = loadPreview;

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setUrl(undefined);

    if (!attachment || !loadPreviewRef.current || !isSafeImagePreviewMime(attachment.mimeType)) {
      return () => {
        cancelled = true;
      };
    }

    void loadPreviewRef.current(orderRef.current, attachment).then((blob) => {
      if (cancelled || !isSafeImagePreviewMime(blob.type)) {
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {
      if (!cancelled) {
        setUrl(undefined);
      }
    });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [attachment?.id, attachment?.mimeType, hasPreviewLoader]);

  if (!attachment) {
    return <span className="order-title-thumbnail-placeholder" aria-hidden="true" />;
  }

  const content = url ? <img src={url} alt={attachment.fileName} /> : <span />;

  if (onPreview) {
    return (
      <button
        type="button"
        className="order-title-thumbnail"
        aria-label={`预览订单图片：${attachment.fileName}`}
        title="点击查看大图"
        style={{ appearance: "none", padding: 0, cursor: "zoom-in", font: "inherit" }}
        onClick={() => onPreview(attachment)}
      >
        {content}
      </button>
    );
  }

  return (
    <span className="order-title-thumbnail" aria-label="订单缩略图">
      {content}
    </span>
  );
}
