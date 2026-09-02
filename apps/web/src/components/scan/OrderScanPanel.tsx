import { Button, Empty, QRCode, Space, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import {
  sampleRoomApi,
  type OrderRecord,
  type ScanRecord
} from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";
import { useSampleTypeOptions } from "../../app/SampleTypeOptionsContext";
import { qrValueForOrderLink, urlForQrPath } from "../../utils/publicUrl";
import {
  orderStageLabel,
  sampleRoundLabel,
  scanRecordNoteLabel,
  scanRecordQualityScoreLabel,
  scanRecordTitle
} from "./scanDisplay";

type OrderScanPanelProps = {
  order: OrderRecord;
  session: DevSession;
  autoLoad?: boolean;
};

function formatTime(value: string) {
  return new Date(value).toLocaleString();
}

export function OrderScanPanel({ order, session, autoLoad = false }: OrderScanPanelProps) {
  const { labelFor: sampleTypeLabel } = useSampleTypeOptions();
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const [scanValue, setScanValue] = useState<string | null>(null);
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const loadScanData = async () => {
    setLoading(true);
    try {
      const [linkResult, recordsResult] = await Promise.all([
        sampleRoomApi.ensureReceiverOrderScanLink(session, order.id),
        sampleRoomApi.listReceiverOrderScanRecords(session, order.id)
      ]);
      const nextUrl = urlForQrPath(linkResult.scanLink);
      const nextValue = qrValueForOrderLink(linkResult.scanLink);
      setScanUrl(nextUrl);
      setScanValue(nextValue);
      setRecords(recordsResult.records);
      return nextValue;
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "扫码信息加载失败");
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoLoad) {
      void loadScanData();
    }
  }, [autoLoad, order.id]);

  const copyScanLink = async () => {
    const nextValue = scanValue ?? (await loadScanData());
    if (!nextValue) {
      return;
    }

    await navigator.clipboard.writeText(nextValue);
    messageApi.success("流转二维码内容已复制");
  };

  return (
    <Space direction="vertical" size={12} className="full-width">
      {contextHolder}
      <Space direction="vertical" size={6} className="full-width">
        <Typography.Text strong>订单流转二维码</Typography.Text>
        <Typography.Text type="secondary">
          工人需先通过老板员工注册二维码绑定身份。裁剪、组检完成时扫码一次；缝制开始和完成各扫码一次。
        </Typography.Text>
      </Space>

      <Space wrap className="scan-order-summary">
        <Tag>款号：{order.styleNo}</Tag>
        <Tag>款名：{order.styleName}</Tag>
        <Tag>数量：{order.quantity}</Tag>
        <Tag>样品类型：{sampleTypeLabel(order.sampleType)}</Tag>
        <Tag>样品轮次：{sampleRoundLabel(order.sampleRound)}</Tag>
        <Tag>当前状态：{order.stageLabel ?? orderStageLabel(order.stage)}</Tag>
        <Tag>当前工序：{orderStageLabel(order.stage)}</Tag>
      </Space>

      <Space wrap>
        <Button size="small" type="primary" loading={loading} onClick={() => void loadScanData()}>
          生成/刷新流转二维码
        </Button>
        <Button size="small" disabled={!scanUrl && loading} onClick={() => void copyScanLink()}>
          复制链接
        </Button>
        {scanUrl ? (
          <Button size="small" href={scanUrl} target="_blank" rel="noreferrer">
            打开扫码页
          </Button>
        ) : null}
      </Space>

      {scanValue ? (
        <div className="order-scan-link-card">
          <QRCode value={scanValue} size={156} />
          <Space direction="vertical" size={8} className="order-scan-link-copy">
            <Typography.Text type="secondary">手机扫码或复制链接给已绑定工人。</Typography.Text>
            <Typography.Text copyable className="scan-link-text">
              {scanValue}
            </Typography.Text>
          </Space>
        </div>
      ) : (
        <Typography.Text type="secondary">接单并进入生产工序后可生成工人扫码流转链接。</Typography.Text>
      )}

      <Typography.Text strong>扫码记录</Typography.Text>
      {records.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无扫码记录" />
      ) : (
        <Space direction="vertical" size={8} className="full-width">
          {records.map((record) => (
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
          ))}
        </Space>
      )}
    </Space>
  );
}
