import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Space, Table, Tabs, Tag, Typography, message } from "antd";
import { useDevSession } from "../../app/DevSessionContext";
import { RoleTaskRoomHeader } from "../../components/RoleTaskRoomHeader";
import {
  type CuttingInboxStatus,
  type SubmittedCuttingVersion,
  sampleRoomApi
} from "../../api/sampleRoomApi";

const statusLabels: Record<CuttingInboxStatus, string> = {
  pending_print: "待裁剪",
  printed: "待裁剪",
  cut: "已裁剪"
};

const statusColors: Record<CuttingInboxStatus, string> = {
  pending_print: "gold",
  printed: "blue",
  cut: "green"
};

function CuttingTable({
  loading,
  submissions
}: {
  loading: boolean;
  submissions: SubmittedCuttingVersion[];
}) {
  return (
    <Table
      rowKey="id"
      loading={loading}
      dataSource={submissions}
      pagination={false}
      className="compact-order-table"
      columns={[
        {
          title: "订单",
          render: (_: unknown, record: SubmittedCuttingVersion) => (
            <Space direction="vertical" size={2}>
              <Typography.Text strong>{record.order?.styleNo ?? record.orderId}</Typography.Text>
              <Typography.Text type="secondary">{record.order?.styleName ?? "未提供款名"}</Typography.Text>
            </Space>
          )
        },
        {
          title: "件数",
          width: 90,
          render: (_: unknown, record: SubmittedCuttingVersion) => record.order?.quantity ?? "-"
        },
        {
          title: "版师备注",
          render: (_: unknown, record: SubmittedCuttingVersion) => (
            <Typography.Paragraph ellipsis={{ rows: 2 }} className="no-margin">
              {record.order?.patternTaskNote || record.note || "无"}
            </Typography.Paragraph>
          )
        },
        {
          title: "版子文件",
          render: (_: unknown, record: SubmittedCuttingVersion) => (
            <Space direction="vertical" size={2}>
              {record.files.map((file) => (
                <Typography.Text key={file.id}>
                  {file.fileName}
                </Typography.Text>
              ))}
            </Space>
          )
        },
        {
          title: "文件状态",
          dataIndex: "status",
          width: 110,
          render: (status: CuttingInboxStatus) => (
            <Tag color={statusColors[status]}>{statusLabels[status]}</Tag>
          )
        },
        {
          title: "操作说明",
          width: 210,
          render: () => "裁剪完成后扫描一次并提交件数、工时"
        }
      ]}
    />
  );
}

export function CuttingRoomPage() {
  const { session } = useDevSession();
  const [messageApi, contextHolder] = message.useMessage();
  const [submissions, setSubmissions] = useState<SubmittedCuttingVersion[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const result = await sampleRoomApi.listCuttingRoomSubmissions(session);
      setSubmissions(result.submissions);
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const waiting = useMemo(
    () => submissions.filter((submission) => submission.status !== "cut"),
    [submissions]
  );
  const finished = useMemo(
    () => submissions.filter((submission) => submission.status === "cut"),
    [submissions]
  );

  return (
    <Space direction="vertical" size={16} className="full-width">
      {contextHolder}
      <RoleTaskRoomHeader
        eyebrow="裁剪版交付核对"
        title="裁剪版记录"
        description="裁剪人员在完成后扫码一次提交结果。这里仅供老板/System Owner 核对历史裁剪版记录和版师备注。"
        steps={[
          { label: "版师已交裁剪", help: "版师打印裁剪版并把纸板、资料交给裁剪房", active: true },
          { label: "线下交接版子", help: "裁剪人员按线下交接资料打印或使用版子" },
          { label: "扫码完成", help: "裁剪结果由扫码页提交到下一环节" }
        ]}
        aside={<Button onClick={refresh} loading={loading}>刷新</Button>}
      />
      <Alert
        type="info"
        showIcon
        message="裁剪人员不需要登录 Web 工作台；裁剪完成后在 /scan/:token 扫码页一次提交件数、工时和备注。本页不显示客户附件、扫码记录或内部无关信息。"
      />
      <Tabs
        items={[
          {
            key: "waiting",
            label: `待裁剪（${waiting.length}）`,
            children: <CuttingTable loading={loading} submissions={waiting} />
          },
          {
            key: "finished",
            label: `已裁剪（${finished.length}）`,
            children: <CuttingTable loading={loading} submissions={finished} />
          }
        ]}
      />
    </Space>
  );
}
