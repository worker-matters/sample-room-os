import { parseOrderQrPayload } from "@sample-room/shared";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography
} from "antd";
import { useMemo, useState } from "react";
import {
  sampleRoomApi,
  type AttachmentMetadataInput,
  type ScanPageState,
  type ScanResolveResponse,
  type ScanTestIdentity
} from "../../api/sampleRoomApi";
import { ClientAttachmentPicker } from "../../components/ClientAttachmentPicker";

const identities: Array<{ value: ScanTestIdentity; label: string }> = [
  { value: "cutting", label: "裁剪" },
  { value: "sewing", label: "缝制" },
  { value: "qc_delivery", label: "组检 / 出库" },
  { value: "receiver", label: "接单员" },
  { value: "planner", label: "计划员" },
  { value: "boss", label: "老板" },
  { value: "client_supervisor", label: "客户主管（验证拒绝）" },
  { value: "client_salesperson", label: "客户业务员（验证拒绝）" }
];

type CompletionValues = {
  workHours?: number;
  pieces?: number;
  note?: string;
  qualityResult?: "qualified" | "rework" | "rejected";
  qualityScore?: number;
};

export function ScanSimulatorPage() {
  const [payload, setPayload] = useState("");
  const [identity, setIdentity] = useState<ScanTestIdentity>("cutting");
  const [resolved, setResolved] = useState<ScanResolveResponse>();
  const [state, setState] = useState<ScanPageState>();
  const [response, setResponse] = useState<unknown>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentMetadataInput[]>([]);
  const [form] = Form.useForm<CompletionValues>();

  const localParsed = useMemo(() => {
    try {
      return payload.trim() ? parseOrderQrPayload(payload) : undefined;
    } catch {
      return "invalid" as const;
    }
  }, [payload]);

  const run = async (operation: () => Promise<unknown>) => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await operation();
      setResponse(result);
      return result;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "request_failed";
      setError(message);
      setResponse({ error: message });
      return undefined;
    } finally {
      setLoading(false);
    }
  };

  const resolve = async () => {
    const result = await run(() => sampleRoomApi.resolveScanForTest(payload, identity));
    if (!result) {
      setResolved(undefined);
      setState(undefined);
      return;
    }
    const next = result as ScanResolveResponse;
    setResolved(next);
    setState(next.state);
    if (next.state?.defaultPieces !== undefined) {
      form.setFieldValue("pieces", next.state.defaultPieces);
    }
  };

  const mutate = async (kind: "start" | "complete", values?: CompletionValues) => {
    if (!localParsed || localParsed === "invalid") return;
    const result = await run(() =>
      kind === "start"
        ? sampleRoomApi.startScanForTest(localParsed.token, identity)
        : sampleRoomApi.completeScanForTest(
            localParsed.token,
            identity,
            { ...values, attachments }
          )
    );
    if (result && typeof result === "object" && "state" in result) {
      setState((result as { state: ScanPageState }).state);
      await resolve();
    }
  };

  return (
    <Space direction="vertical" size={16} className="full-width">
      <Alert
        type="warning"
        showIcon
        message="仅用于 development/test；生产构建不注册此页面，测试身份也会被 API 拒绝。"
      />
      <Card title="订单扫码模拟器">
        <Space direction="vertical" size={12} className="full-width">
          <Input.TextArea
            rows={4}
            value={payload}
            onChange={(event) => setPayload(event.target.value)}
            placeholder="SRS2|ORDER|order_scan_xxx、https://host/scan/...、/scan/... 或裸 token"
          />
          <Select value={identity} options={identities} onChange={setIdentity} />
          <Button type="primary" loading={loading} onClick={() => void resolve()}>
            解析并取得业务状态
          </Button>
        </Space>
      </Card>

      <Card title="本地解析结果（不会由正式 resolve 接口回显 token）">
        {localParsed === "invalid" ? (
          <Alert type="error" message="无效二维码载荷" />
        ) : localParsed ? (
          <pre>{JSON.stringify(localParsed, null, 2)}</pre>
        ) : (
          <Typography.Text type="secondary">请输入二维码原始文本。</Typography.Text>
        )}
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {resolved ? (
        <Card title="订单摘要与允许操作">
          <Descriptions column={1} size="small">
            <Descriptions.Item label="款号">{resolved.order.styleNo}</Descriptions.Item>
            <Descriptions.Item label="款名">{resolved.order.styleName}</Descriptions.Item>
            <Descriptions.Item label="客户">{resolved.order.customerName}</Descriptions.Item>
            <Descriptions.Item label="客户业务员">{resolved.order.salespersonName}</Descriptions.Item>
            <Descriptions.Item label="数量">{resolved.order.quantity}</Descriptions.Item>
            <Descriptions.Item label="身份">{resolved.actor.role ?? resolved.actor.kind}</Descriptions.Item>
            <Descriptions.Item label="允许操作">
              {resolved.allowedActions.join(", ") || "无"}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      ) : null}

      {state ? (
        <Card title="生产操作与最终状态">
          <Space direction="vertical" size={12} className="full-width">
            <Alert
              type={state.allowedAction === "blocked" ? "warning" : "info"}
              message={`${state.allowedAction}${state.message ? `：${state.message}` : ""}`}
            />
            {state.allowedAction === "start" ? (
              <Button loading={loading} onClick={() => void mutate("start")}>执行开始</Button>
            ) : null}
            {state.allowedAction === "complete" ? (
              <Form form={form} layout="vertical" onFinish={(values) => void mutate("complete", values)}>
                {state.stage !== "qc_delivery" ? (
                  <Form.Item name="workHours" label="工时" rules={[{ required: true }]}>
                    <InputNumber min={0.1} step={0.1} />
                  </Form.Item>
                ) : null}
                <Form.Item name="pieces" label="完成 / 实收件数" rules={[{ required: true }]}>
                  <InputNumber min={0} />
                </Form.Item>
                {state.stage === "qc_delivery" ? (
                  <>
                    <Form.Item name="qualityResult" label="质量结果" rules={[{ required: true }]}>
                      <Select options={[
                        { value: "qualified", label: "合格" },
                        { value: "rework", label: "返工" },
                        { value: "rejected", label: "不合格" }
                      ]} />
                    </Form.Item>
                    <Form.Item name="qualityScore" label="样衣评分" rules={[{ required: true }]}>
                      <InputNumber min={0} max={100} />
                    </Form.Item>
                    <ClientAttachmentPicker
                      value={attachments}
                      onChange={setAttachments}
                      defaultCategory="qc_sample_photo"
                      defaultVisibility="internal_only"
                      accept="image/*"
                      title="组检照片"
                      description="组检完成至少需要一张样衣照片。"
                    />
                  </>
                ) : null}
                <Form.Item
                  name="note"
                  label="备注"
                  rules={state.stage === "qc_delivery" ? [] : [{ required: true }]}
                >
                  <Input.TextArea />
                </Form.Item>
                <Button htmlType="submit" type="primary" loading={loading}>执行完成</Button>
              </Form>
            ) : null}
            <pre>{JSON.stringify(state, null, 2)}</pre>
          </Space>
        </Card>
      ) : null}

      <Card title="最近一次接口响应">
        <pre>{JSON.stringify(response ?? null, null, 2)}</pre>
      </Card>
    </Space>
  );
}
