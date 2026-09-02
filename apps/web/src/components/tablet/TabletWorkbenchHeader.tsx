import { ScanOutlined } from "@ant-design/icons";
import { Button, Space, Typography } from "antd";
import { BrandLockup } from "../BrandLockup";
import { TabletAccountMenu } from "./TabletAccountMenu";
import { TabletNetworkControl } from "./TabletNetworkControl";

export function TabletWorkbenchHeader({
  roleLabel,
  onScan,
  scanning = false
}: {
  roleLabel: string;
  onScan: () => void;
  scanning?: boolean;
}) {
  return (
    <header className="tablet-workbench-header">
      <Space size={12}>
        <BrandLockup className="tablet-brand-lockup" />
        <TabletNetworkControl />
        <Typography.Title level={4}>{roleLabel}</Typography.Title>
        <Button type="primary" size="large" icon={<ScanOutlined />} loading={scanning} onClick={onScan}>
          扫码
        </Button>
      </Space>
      <TabletAccountMenu roleLabel={roleLabel} />
    </header>
  );
}
