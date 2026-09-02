import { Alert, Button, Card, Col, Descriptions, Form, Input, QRCode, Row, Select, Space, Statistic, Table, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  sampleRoomApi,
  type LanEndpointCandidate,
  type RuntimeEndpointConfig,
  type SystemOwnerMaintenanceSnapshot,
  type SystemOwnerRuntimeChecksResult,
  type SystemOwnerRuntimeStatus
} from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";
import { MiniappReleasePreviewControl } from "../../components/system-owner/MiniappReleasePreviewControl";
import { createNetworkConfigQrPayload } from "../../utils/networkConfigQr";

function statusColor(status: string) {
  if (status === "pass" || status.includes("configured")) return "green";
  if (status === "warn" || status === "configured_http") return "orange";
  if (status === "fail") return "red";
  return "default";
}

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "-";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AdvancedMaintenancePanel({ session }: { session: DevSession }) {
  const [snapshot, setSnapshot] = useState<SystemOwnerMaintenanceSnapshot>();
  const [runtimeStatus, setRuntimeStatus] = useState<SystemOwnerRuntimeStatus>();
  const [runtimeChecks, setRuntimeChecks] = useState<SystemOwnerRuntimeChecksResult>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lanCandidates, setLanCandidates] = useState<LanEndpointCandidate[]>([]);
  const [endpointConfig, setEndpointConfig] = useState<RuntimeEndpointConfig>();
  const [endpointForm] = Form.useForm<RuntimeEndpointConfig>();
  const [messageApi, contextHolder] = message.useMessage();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [snapshotResult, statusResult, endpointResult] = await Promise.all([
        sampleRoomApi.getSystemOwnerMaintenanceSnapshot(session),
        sampleRoomApi.getSystemOwnerRuntimeStatus(session),
        sampleRoomApi.getRuntimeEndpointConfig(session)
      ]);
      setSnapshot(snapshotResult.snapshot);
      setRuntimeStatus(statusResult.runtimeStatus);
      setEndpointConfig(endpointResult.config);
      endpointForm.setFieldsValue(endpointResult.config);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "高级维护信息加载失败");
    } finally {
      setLoading(false);
    }
  }, [endpointForm, messageApi, session]);

  useEffect(() => { void load(); }, [load]);

  const cards = useMemo(() => snapshot ? [
    { title: "订单", value: snapshot.counts.orders.total },
    { title: "客户账号", value: snapshot.counts.accounts.customers },
    { title: "生产员工", value: snapshot.counts.workers.workerAccounts },
    { title: "扫码记录", value: snapshot.counts.scan.records },
    { title: "版房与裁剪", value: snapshot.counts.patternAndCutting.patternTasks },
    { title: "定价记录", value: snapshot.counts.pricing.pricingRecords }
  ] : [], [snapshot]);

  const networkQrState = useMemo(() => {
    const codes: Array<{ key: string; title: string; address: string; payload: string }> = [];
    const errors: string[] = [];
    if (!endpointConfig) return { codes, errors };
    for (const candidate of [
      endpointConfig.lanApiBaseUrl ? {
        key: "lan",
        title: "局域网网络配置二维码",
        address: endpointConfig.lanApiBaseUrl,
        addressType: "LAN" as const,
        displayName: "工厂局域网 API"
      } : null,
      endpointConfig.publicApiBaseUrl ? {
        key: "public",
        title: "公网网络配置二维码",
        address: endpointConfig.publicApiBaseUrl,
        addressType: "PUBLIC" as const,
        displayName: "公网 API"
      } : null
    ]) {
      if (!candidate) continue;
      try {
        codes.push({
          ...candidate,
          payload: createNetworkConfigQrPayload({
            addressType: candidate.addressType,
            baseUrl: candidate.address,
            displayName: candidate.displayName
          })
        });
      } catch (error) {
        errors.push(`${candidate.title}：${error instanceof Error ? error.message : "地址格式错误"}`);
      }
    }
    return { codes, errors };
  }, [endpointConfig]);

  const saveEndpoints = async () => {
    const values = await endpointForm.validateFields();
    setSaving(true);
    try {
      const result = await sampleRoomApi.updateRuntimeEndpointConfig(session, values);
      endpointForm.setFieldsValue(result.config);
      setEndpointConfig(result.config);
      messageApi.success("访问地址设置已保存");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "访问地址保存失败");
    } finally { setSaving(false); }
  };

  const detectLan = async () => {
    try {
      const result = await sampleRoomApi.detectLanEndpointCandidates(session);
      setLanCandidates(result.candidates);
      messageApi.success(result.candidates.length ? "已找到可选的厂内访问地址" : "暂未找到厂内访问地址");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "地址检查失败");
    }
  };

  const runTechnicalChecks = async () => {
    setChecking(true);
    try {
      setRuntimeChecks(await sampleRoomApi.runSystemOwnerRuntimeChecks(session));
      messageApi.success("高级检查已完成");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "高级检查失败");
    } finally { setChecking(false); }
  };

  const exportJson = () => {
    const payload = { snapshot, runtimeStatus, runtimeChecks, exportedAt: new Date().toISOString(), redacted: true };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), `sample-room-system-report-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const downloadMarkdown = async () => {
    try {
      const result = await sampleRoomApi.downloadSystemOwnerMaintenanceSummaryMarkdown(session);
      downloadBlob(result.blob, result.filename ?? "sample-room-maintenance-summary.md");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "报告生成失败");
    }
  };

  return (
    <Space direction="vertical" size={16} className="full-width advanced-maintenance-panel">
      {contextHolder}
      <Alert type="warning" showIcon message="高级维护区域" description="这里保留部署地址、运行摘要和脱敏报告。日常备份、恢复、更新和存储维护不需要使用这些设置。" />

      <Card size="small" title="业务运行摘要" loading={loading}>
        <Descriptions size="small" column={{ xs: 1, md: 3 }}>
          <Descriptions.Item label="生成时间">{formatTime(snapshot?.generatedAt)}</Descriptions.Item>
          <Descriptions.Item label="登录方式">{runtimeStatus?.mode.authMode ?? "-"}</Descriptions.Item>
          <Descriptions.Item label="数据保存方式">{runtimeStatus?.mode.persistenceMode ?? "-"}</Descriptions.Item>
        </Descriptions>
        <Row gutter={[8, 8]}>
          {cards.map((card) => <Col xs={12} md={8} key={card.title}><Card size="small"><Statistic title={card.title} value={card.value} /></Card></Col>)}
        </Row>
      </Card>

      <Card size="small" title="访问地址设置">
        <Form form={endpointForm} layout="vertical" requiredMark={false}>
          <Row gutter={12}>
            <Col xs={24} md={12}><Form.Item name="publicWebBaseUrl" label="公网网页地址"><Input placeholder="https://..." /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="publicApiBaseUrl" label="公网服务地址"><Input placeholder="https://..." /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="lanWebBaseUrl" label="厂内网页地址"><Input placeholder="http://厂内地址:3001" /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="lanApiBaseUrl" label="厂内服务地址"><Input placeholder="http://厂内地址:3001" /></Form.Item></Col>
          </Row>
          <Space wrap>
            <Button onClick={() => void detectLan()}>查找厂内地址</Button>
            {lanCandidates.length ? (
              <Select
                style={{ minWidth: 260, maxWidth: "100%" }}
                placeholder="选择厂内地址"
                options={lanCandidates.map((item) => ({ value: item.address, label: item.address }))}
                onChange={(address) => {
                  const candidate = lanCandidates.find((item) => item.address === address);
                  if (candidate) endpointForm.setFieldsValue({ lanWebBaseUrl: candidate.lanWebBaseUrl, lanApiBaseUrl: candidate.lanApiBaseUrl });
                }}
              />
            ) : null}
            <Button type="primary" loading={saving} onClick={() => void saveEndpoints()}>保存地址设置</Button>
          </Space>
        </Form>
        <Alert
          className="top-gap"
          type="info"
          showIcon
          message="Android 使用运行时网络配置"
          description="首次安装仍用下方二维码配置任一可用地址；之后 Android 手机与 Pad 会在登录界面从已验证服务器自动读取这里保存的局域网和公网 API 地址，逐项验证后保存。二维码继续作为离线兜底，配置只含非敏感地址、类型和协议版本。"
        />
        {networkQrState.errors.length ? (
          <Alert
            className="top-gap"
            type="error"
            showIcon
            message="以下地址不能生成网络配置二维码"
            description={networkQrState.errors.join("；")}
          />
        ) : null}
        <Row gutter={[12, 12]} className="top-gap">
          {networkQrState.codes.map((item) => (
            <Col xs={24} md={12} key={item.key}>
              <Card size="small" title={item.title}>
                <Space direction="vertical" align="center" className="full-width">
                  <QRCode value={item.payload} size={196} />
                  <Typography.Text copyable>{item.address}</Typography.Text>
                  <Typography.Text type="secondary">仅用于 Android“网络设置”扫码，不是普通网页二维码。</Typography.Text>
                </Space>
              </Card>
            </Col>
          ))}
          {!networkQrState.codes.length ? (
            <Col span={24}>
              <Alert type="warning" showIcon message="请先保存至少一个厂内或公网 API 地址，再生成网络配置二维码。" />
            </Col>
          ) : null}
        </Row>
      </Card>

      <MiniappReleasePreviewControl session={session} />

      <Card size="small" title="高级检查和脱敏报告">
        <Space direction="vertical" size={12} className="full-width">
          <Space wrap>
            <Button onClick={() => void runTechnicalChecks()} loading={checking}>运行高级检查</Button>
            <Button onClick={exportJson} disabled={!snapshot || !runtimeStatus}>导出脱敏报告</Button>
            <Button onClick={() => void downloadMarkdown()}>下载维护摘要</Button>
            <Button onClick={() => void load()} loading={loading}>刷新</Button>
          </Space>
          <Table
            size="small"
            rowKey="key"
            pagination={false}
            scroll={{ x: 680 }}
            dataSource={runtimeChecks?.checks ?? []}
            locale={{ emptyText: "尚未运行高级检查" }}
            columns={[
              { title: "检查项", dataIndex: "label" },
              { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag> },
              { title: "说明", dataIndex: "safeMessage" },
              { title: "时间", dataIndex: "checkedAt", render: formatTime }
            ]}
          />
        </Space>
      </Card>
    </Space>
  );
}
