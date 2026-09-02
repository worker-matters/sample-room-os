import { Alert, Typography } from "antd";

type PlaceholderPageProps = {
  title: string;
  role: string;
  route: string;
};

export function PlaceholderPage({ title, role, route }: PlaceholderPageProps) {
  return (
    <main className="placeholder-page">
      <section className="placeholder-panel">
        <Typography.Title level={2}>{title}</Typography.Title>
        <Alert
          type="info"
          showIcon
          message="暂未迁移业务功能"
          description="当前页面只保留 V2 路由和角色边界占位，不包含真实写入逻辑。"
        />
        <div className="placeholder-meta">
          <div className="placeholder-meta-item">
            <Typography.Text type="secondary">路由</Typography.Text>
            <Typography.Paragraph strong>{route}</Typography.Paragraph>
          </div>
          <div className="placeholder-meta-item">
            <Typography.Text type="secondary">角色说明</Typography.Text>
            <Typography.Paragraph>{role}</Typography.Paragraph>
          </div>
        </div>
      </section>
    </main>
  );
}
