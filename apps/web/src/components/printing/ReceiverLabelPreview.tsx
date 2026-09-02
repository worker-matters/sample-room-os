import { QRCode, Typography } from "antd";
import type { ReceiverQrPrintSettings } from "@sample-room/shared";
import { buildReceiverLabelPrintJob, type ReceiverLabelOrder } from "../../printing/receiverLabel";

const placeholderOrder: ReceiverLabelOrder = {
  orderId: "preview",
  scanValue: "SR2:ORDER:PREVIEW",
  customerName: "Mock Active Customer",
  businessUserName: "客户 A 普通业务员",
  styleNo: "312",
  styleName: "312",
  sampleType: "第一版",
  quantity: 1
};

export function ReceiverLabelPaper({
  settings,
  order = placeholderOrder,
  className = "",
  maxSize = 260,
  widthPx
}: {
  settings: ReceiverQrPrintSettings;
  order?: ReceiverLabelOrder;
  className?: string;
  maxSize?: number;
  widthPx?: number;
}) {
  const page = buildReceiverLabelPrintJob(settings, [order]).pages[0]!;
  const scale = widthPx
    ? widthPx / page.widthMm
    : Math.min(maxSize / page.widthMm, maxSize / page.heightMm);
  return (
    <div
      className={`receiver-b1-label-paper ${className}`.trim()}
      style={{ width: page.widthMm * scale, height: page.heightMm * scale }}
      aria-label={`${page.widthMm}mm × ${page.heightMm}mm 标签预览`}
    >
      {page.elements.map((element, index) => {
        const style = {
          left: `${element.x / page.widthMm * 100}%`,
          top: `${element.y / page.heightMm * 100}%`,
          width: `${element.width / page.widthMm * 100}%`,
          height: `${element.height / page.heightMm * 100}%`
        };
        if (element.type === "qr") {
          return (
            <div className="receiver-b1-preview-qr" style={style} key={`qr-${index}`}>
              <QRCode type="svg" value={element.value} bordered={false} size={512} />
            </div>
          );
        }
        return (
          <div
            className={`receiver-b1-preview-text ${element.multiline ? "is-multiline" : ""}`.trim()}
            style={{ ...style, fontSize: `${element.fontSize * scale}px`, fontWeight: element.bold ? 700 : 400, lineHeight: 1.15 }}
            key={`text-${index}`}
          >
            {element.value}
          </div>
        );
      })}
    </div>
  );
}

export function ReceiverLabelPreview({
  settings,
  order = placeholderOrder,
  compact = false
}: {
  settings: ReceiverQrPrintSettings;
  order?: ReceiverLabelOrder;
  compact?: boolean;
}) {
  const page = buildReceiverLabelPrintJob(settings, [order]).pages[0]!;
  return (
    <div className={`receiver-b1-label-preview ${compact ? "is-compact" : ""}`}>
      <ReceiverLabelPaper settings={settings} order={order} maxSize={compact ? 150 : 260} />
      <Typography.Text type="secondary" className="receiver-b1-preview-size">
        {page.widthMm}mm × {page.heightMm}mm
      </Typography.Text>
    </div>
  );
}
