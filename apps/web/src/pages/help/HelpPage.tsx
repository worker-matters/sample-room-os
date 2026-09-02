import { Card, Descriptions, Space, Steps, Typography } from "antd";
import { useDevSession } from "../../app/DevSessionContext";
import { WorkerMobilePage } from "../workers/WorkerMobilePage";

export function HelpPage() {
  const { session } = useDevSession();

  if (
    session.role === "worker" &&
    (session.activeWorkerType === "cutting" || session.activeWorkerType === "sewing")
  ) {
    return <WorkerMobilePage />;
  }

  return (
    <Space direction="vertical" size={16} className="full-width">
      <Card title="V2 人工测试说明" className="section-card">
        <Steps
          direction="vertical"
          current={-1}
          items={[
            {
              title: "打开开发测试模式",
              description: "在开发入口切换当前测试角色。正式模式不会显示这些测试入口。"
            },
            {
              title: "客户提交订单",
              description: "客户可先用照片简录打样需求，再等待接单员接单和补齐信息。"
            },
            {
              title: "接单员确认",
              description: "接单员在待接单中只确认客户来版或需制版，订单先进入版师处理。"
            },
            {
              title: "版师处理",
              description: "版师排版/制版后提交裁剪版；不需要打样的调整类任务可由版师记录并结束。"
            },
            {
              title: "生产扫码流转",
              description: "裁剪、组检完成时扫码一次；缝制开始和完成各扫码一次。版师从工作台领取综合任务。外部用户只查看允许的数据。"
            }
          ]}
        />
      </Card>
      <Card title="当前限制" className="section-card">
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="数据">
            memory 模式重启后会清空内存数据；Prisma 模式可做持久化验收。
          </Descriptions.Item>
          <Descriptions.Item label="生产员工">
            裁剪、缝制员工可使用正式工序账号进入手机工作台；组检/出库继续使用专用 Pad 工作台。
          </Descriptions.Item>
          <Descriptions.Item label="生产扫码">
            生产扫码页面不显示客户附件、客户资料、内部路径、成本或其他与当前扫码动作无关的信息。
          </Descriptions.Item>
          <Descriptions.Item label="安全">
            不连接外部部署服务，不提交 data/config/uploads/storage/.env。
          </Descriptions.Item>
        </Descriptions>
        <Typography.Paragraph className="help-note">
          这是用于本地人工验收的操作说明，不是生产部署说明。
        </Typography.Paragraph>
      </Card>
    </Space>
  );
}
