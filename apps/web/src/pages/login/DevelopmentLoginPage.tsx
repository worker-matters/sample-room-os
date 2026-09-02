import { Button, Card, Col, Row, Select, Space, Steps, Tag, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import {
  roleHomePaths,
  roleLabels,
  useDevSession,
  type DevRole
} from "../../app/DevSessionContext";

const roleOptions: Array<{ label: string; value: DevRole; description: string }> = [
  {
    label: "客户主管",
    value: "client_admin",
    description: "查看所属客户全部订单并管理客户业务员账号。"
  },
  {
    label: "客户业务员",
    value: "client_business_user",
    description: "提交打样需求、查看自己的订单、补充被退回的资料。"
  },
  {
    label: "接单员",
    value: "receiver",
    description: "接收客户订单、退回补充、自主录入并维护跟踪状态。"
  },
  {
    label: "版师",
    value: "pattern_maker",
    description: "处理待排版任务、维护本地订单文件夹、提交裁剪版。"
  },
  {
    label: "老板",
    value: "boss",
    description: "管理员工注册、订单终止、内部流程和后续经营入口。"
  },
  {
    label: "System Owner",
    value: "system_owner",
    description: "系统最高维护入口，权限高于老板。"
  }
];

export function DevelopmentLoginPage() {
  const { session, setRole } = useDevSession();
  const navigate = useNavigate();

  const enterAs = (role: DevRole) => {
    setRole(role);
    navigate(roleHomePaths[role]);
  };

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={9}>
        <Card title="开发测试模式" className="section-card">
          <Space direction="vertical" size={16} className="full-width">
            <Typography.Paragraph>
              当前开发模式使用 dev session 和 x-dev-* header 模拟角色，仅用于本地人工验收。
            </Typography.Paragraph>
            <Select
              value={session.role}
              options={roleOptions}
              onChange={enterAs}
              className="full-width"
            />
            <Space wrap>
              <Tag color="blue">当前角色：{roleLabels[session.role]}</Tag>
              <Tag>Mock User：{session.userId}</Tag>
            </Space>
            <Button type="primary" onClick={() => enterAs(session.role)} block>
              进入当前角色工作台
            </Button>
          </Space>
        </Card>
      </Col>
      <Col xs={24} lg={15}>
        <Space direction="vertical" size={16} className="full-width">
          <Row gutter={[12, 12]}>
            {roleOptions.map((role) => (
              <Col xs={24} md={12} key={role.value}>
                <Card className="section-card role-card" onClick={() => enterAs(role.value)}>
                  <Space direction="vertical" size={8}>
                    <Typography.Title level={5}>{role.label}</Typography.Title>
                    <Typography.Text type="secondary">{role.description}</Typography.Text>
                    <Button type={session.role === role.value ? "primary" : "default"}>
                      切换并进入
                    </Button>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
          <Card title="人工测试路径" className="section-card">
            <Steps
              direction="vertical"
              current={-1}
              items={[
                { title: "客户提交", description: "在客户工作台提交新款，并上传附件。" },
                { title: "接单员待接单", description: "确认有版或无版，或退回客户补充资料。" },
                { title: "版师处理", description: "在版师工作台查看待安排订单、维护版师交付物，并决定完成归档或交裁剪。" },
                { title: "生产扫码流转", description: "裁剪、组检完成时扫码一次；缝制开始和完成各扫码一次。" },
                { title: "版师任务", description: "版师在工作台查看资料并领取综合任务，不通过扫码接单。" }
              ]}
            />
          </Card>
        </Space>
      </Col>
    </Row>
  );
}
