import { Empty, Space, Tag, Timeline, Typography, message } from "antd";
import { useEffect, useState } from "react";
import {
  sampleRoomApi,
  type OrderRecord,
  type ScanRecord
} from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";
import {
  scanRecordNoteLabel,
  scanRecordQualityScoreLabel,
  scanRecordTitle
} from "./scanDisplay";

type OrderScanRecordsPanelProps = {
  order: OrderRecord;
  session: DevSession;
  variant?: "list" | "timeline";
};

function formatTime(value: string) {
  return new Date(value).toLocaleString();
}

export function OrderScanRecordsPanel({ order, session, variant = "list" }: OrderScanRecordsPanelProps) {
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    let mounted = true;

    async function loadRecords() {
      setLoading(true);
      try {
        const result = await sampleRoomApi.listReceiverOrderScanRecords(session, order.id);
        if (mounted) {
          setRecords(result.records);
        }
      } catch (error) {
        if (mounted) {
          messageApi.error(error instanceof Error ? error.message : "扫码记录加载失败");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadRecords();
    return () => {
      mounted = false;
    };
  }, [messageApi, order.id, session]);

  if (records.length === 0) {
    return (
      <>
        {contextHolder}
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={loading ? "正在加载扫码记录" : "暂无扫码记录"}
        />
      </>
    );
  }

  return (
    <Space direction="vertical" size={8} className="full-width order-scan-records-list">
      {contextHolder}
      {variant === "timeline" ? (
        <Timeline
          className="receiver-scan-timeline"
          items={records.map((record) => ({
            color: record.action === "start" ? "blue" : "green",
            children: (
              <Space direction="vertical" size={2}>
                <Typography.Text type="secondary">{formatTime(record.eventTime)}</Typography.Text>
                <Typography.Text strong>
                  {scanRecordTitle(record)}
                </Typography.Text>
                <Typography.Text type="secondary">{record.workerName}</Typography.Text>
                {scanRecordQualityScoreLabel(record) ? (
                  <Typography.Text type="secondary">{scanRecordQualityScoreLabel(record)}</Typography.Text>
                ) : null}
                {record.note ? (
                  <Typography.Text type="secondary">
                    {record.stage === "qc_delivery" && record.action === "complete"
                      ? scanRecordNoteLabel(record)
                      : record.note}
                  </Typography.Text>
                ) : null}
              </Space>
            )
          }))}
        />
      ) : (
      records.map((record) => (
        <div className="scan-record-row" key={record.id}>
          <Space direction="vertical" size={2}>
            <Space wrap>
              <Tag>{`工序：${record.stageLabel}`}</Tag>
              <Tag color={record.action === "start" ? "blue" : "green"}>
                {`动作：${scanRecordTitle(record)}`}
              </Tag>
            </Space>
            <Typography.Text strong>{`人员：${record.workerName}`}</Typography.Text>
            <Typography.Text type="secondary">
              {`时间：${formatTime(record.eventTime)}`}
              {record.workHours !== undefined ? ` · 工时 ${record.workHours}` : ""}
              {record.pieces !== undefined ? ` · 件数 ${record.pieces}` : ""}
            </Typography.Text>
            {scanRecordQualityScoreLabel(record) ? (
              <Typography.Text type="secondary">{scanRecordQualityScoreLabel(record)}</Typography.Text>
            ) : null}
            {record.note ? <Typography.Text type="secondary">{scanRecordNoteLabel(record)}</Typography.Text> : null}
          </Space>
        </div>
      ))
      )}
    </Space>
  );
}
