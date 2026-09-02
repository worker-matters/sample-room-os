import { Space, Typography } from "antd";
import type { ReactNode } from "react";

export type MobileOrderKeyItem = {
  label: string;
  value: ReactNode;
  wide?: boolean;
};

export function MobileOrderTitleBlock({
  styleNo,
  styleName,
  extra
}: {
  styleNo: ReactNode;
  styleName: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="mobile-card-head mobile-order-title-block">
      <Space direction="vertical" size={0} className="mobile-order-title-text">
        <Typography.Text strong className="mobile-style-no">
          {styleNo}
        </Typography.Text>
        <Typography.Text type="secondary" className="mobile-style-name">
          {styleName}
        </Typography.Text>
      </Space>
      {extra ? <div className="mobile-order-title-extra">{extra}</div> : null}
    </div>
  );
}

export function MobileOrderStatusBlock({ children }: { children: ReactNode }) {
  return (
    <Space wrap size={[6, 6]} className="mobile-card-status-row">
      {children}
    </Space>
  );
}

export function MobileOrderKeyGrid({ items }: { items: MobileOrderKeyItem[] }) {
  return (
    <div className="mobile-key-field-grid">
      {items.map((item) => (
        <div
          className={item.wide ? "mobile-key-field mobile-key-field-wide" : "mobile-key-field"}
          key={item.label}
        >
          <span className="mobile-key-field-label">{item.label}</span>
          <strong className="mobile-key-field-value">{item.value ?? "-"}</strong>
        </div>
      ))}
    </div>
  );
}

export function MobileOrderSecondaryBlock({ children }: { children: ReactNode }) {
  return <div className="mobile-card-secondary-block">{children}</div>;
}

export function MobileOrderActionRow({ children }: { children?: ReactNode }) {
  return children ? <div className="mobile-card-action-row">{children}</div> : null;
}
