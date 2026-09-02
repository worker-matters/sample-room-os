import { Alert, Card, Collapse, Empty, List, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { sampleRoomApi, type LifecycleOperationHistoryItem } from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";

const resultPresentation: Record<LifecycleOperationHistoryItem["result"], { label: string; color: string }> = {
  in_progress: { label: "正在处理", color: "blue" },
  success: { label: "成功", color: "green" },
  failed: { label: "未完成", color: "red" },
  needs_review: { label: "系统状态需要检查", color: "red" },
  cancelled: { label: "已取消", color: "default" }
};

export function LifecycleOperationHistoryPanel({ session }: { session: DevSession }) {
  const [records, setRecords] = useState<LifecycleOperationHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setRecords((await sampleRoomApi.getLifecycleOperationHistory(session)).records);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Space direction="vertical" size={16} className="full-width operation-history-panel">
      <Card size="small">
        <Space direction="vertical" size={6}>
          <Typography.Title level={4} className="no-margin">操作记录</Typography.Title>
          <Typography.Text type="secondary">查看谁在什么时候进行了维护，以及操作是否成功。</Typography.Text>
        </Space>
      </Card>
      {loadFailed ? (
        <Alert type="warning" showIcon message="暂时无法读取操作记录" description="现有数据没有变化，请刷新页面后重试。" />
      ) : null}
      <List
        loading={loading}
        dataSource={records}
        locale={{ emptyText: <Empty description="暂无维护操作记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        renderItem={(item) => {
          const result = resultPresentation[item.result];
          return (
            <List.Item key={item.id}>
              <Card size="small" className="operation-history-card full-width">
                <Space direction="vertical" size={10} className="full-width">
                  <div className="operation-history-heading">
                    <div>
                      <Typography.Text strong>{item.operation}</Typography.Text>
                      <Typography.Text type="secondary" className="operation-history-time">
                        {new Date(item.requestedAt).toLocaleString()}
                      </Typography.Text>
                    </div>
                    <Tag color={result.color}>{result.label}</Tag>
                  </div>
                  <Typography.Text>操作人：{item.requestedBy}</Typography.Text>
                  {item.subject ? <Typography.Text>操作内容：{item.subject}</Typography.Text> : null}
                  <Typography.Text>操作原因：{item.requestReason}</Typography.Text>
                  {item.result === "failed" || item.result === "needs_review" ? (
                    <Alert
                      type="warning"
                      showIcon
                      message={item.result === "needs_review" ? "系统状态需要检查" : "操作未完成"}
                      description={(
                        <Space direction="vertical" size={4}>
                          <Typography.Text><strong>当前数据：</strong>{item.dataSafety}</Typography.Text>
                          <Typography.Text><strong>下一步：</strong>{item.nextStep}</Typography.Text>
                        </Space>
                      )}
                    />
                  ) : null}
                  <Collapse ghost size="small" items={[{
                    key: "technical",
                    label: "查看技术详情",
                    children: (
                      <Space direction="vertical" size={4}>
                        <Typography.Text type="secondary">记录编号：{item.id}</Typography.Text>
                        {item.technicalCode ? <Typography.Text code>{item.technicalCode}</Typography.Text> : null}
                      </Space>
                    )
                  }]} />
                </Space>
              </Card>
            </List.Item>
          );
        }}
      />
    </Space>
  );
}
