import { Alert, Button, Card, Input, Space, Typography, message } from "antd";
import { useEffect, useRef, useState } from "react";
import { parseOrderQrPayload } from "@sample-room/shared";
import {
  sampleRoomApi,
  type AttachmentMetadataInput,
  type MobileScanChargeContext,
  type OrderChargeRecord,
  type OrderChargeCreatePayload
} from "../../api/sampleRoomApi";
import { useDevSession } from "../../app/DevSessionContext";
import { OrderChargeLedger } from "../operations/OrderChargeLedger";
import { ClientAttachmentPicker } from "../ClientAttachmentPicker";

export function MobileScanChargePanel({
  role,
  initialToken
}: {
  role: "receiver" | "planner";
  initialToken?: string;
}) {
  const { session } = useDevSession();
  const [messageApi, contextHolder] = message.useMessage();
  const [scanValue, setScanValue] = useState("");
  const [token, setToken] = useState("");
  const [context, setContext] = useState<MobileScanChargeContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [orderAttachmentDraft, setOrderAttachmentDraft] = useState<AttachmentMetadataInput[]>([]);
  const [orderAttachmentUploading, setOrderAttachmentUploading] = useState(false);
  const initialTokenLoaded = useRef(false);

  const load = async (providedToken?: string) => {
    let nextToken = providedToken;
    try {
      nextToken ??= parseOrderQrPayload(scanValue).token;
    } catch {
      messageApi.warning("请扫描订单流转码或粘贴扫码内容");
      return;
    }
    setLoading(true);
    try {
      const result = await sampleRoomApi.getMobileScanChargeContext(session, role, nextToken);
      setToken(nextToken);
      setContext(result);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "读取订单费用失败");
    } finally {
      setLoading(false);
    }
  };

  const add = async (payload: OrderChargeCreatePayload, attachments: AttachmentMetadataInput[]) => {
    const result = await sampleRoomApi.addMobileOrderChargeByScanToken(session, role, token, payload);
    if (attachments.length > 0) {
      await sampleRoomApi.addOrderChargeAttachments(
        session,
        role,
        context!.order.id,
        result.charge.id,
        attachments
      );
    }
    await load(token);
  };

  const voidOwn = async (charge: OrderChargeRecord) => {
    await sampleRoomApi.voidOwnOrderCharge(session, role, charge.orderId, charge.id);
    await load(token);
  };

  const deleteAttachment = async (charge: OrderChargeRecord, attachmentId: string) => {
    await sampleRoomApi.deleteOrderChargeAttachment(session, role, charge.orderId, charge.id, attachmentId);
    await load(token);
  };

  const downloadAttachment = async (attachmentId: string) => {
    if (!context) return;
    if (role === "receiver") {
      await sampleRoomApi.downloadReceiverOrderAttachment(session, context.order.id, attachmentId);
    } else {
      await sampleRoomApi.downloadPlannerOrderAttachment(session, context.order.id, attachmentId);
    }
  };

  const uploadOrderAttachments = async () => {
    if (!context || orderAttachmentDraft.length === 0) return;
    setOrderAttachmentUploading(true);
    try {
      if (role === "receiver") {
        await sampleRoomApi.addReceiverOrderAttachments(session, context.order.id, orderAttachmentDraft);
      } else {
        await sampleRoomApi.addPlannerOrderAttachments(session, context.order.id, orderAttachmentDraft);
      }
      setOrderAttachmentDraft([]);
      messageApi.success("订单附件已上传");
    } finally {
      setOrderAttachmentUploading(false);
    }
  };

  useEffect(() => {
    if (!initialToken || initialTokenLoaded.current) return;
    initialTokenLoaded.current = true;
    setScanValue(initialToken);
    void load(initialToken);
    // load is intentionally invoked once for the token received from the scanned URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken]);

  if (!context) {
    return (
      <Card title="扫描费用" loading={loading}>
        {contextHolder}
        <Space direction="vertical" size={12} className="full-width">
          <Typography.Text type="secondary">扫描订单流转二维码不会推进任何工序或版师任务。</Typography.Text>
          <Input.Search
            value={scanValue}
            onChange={(event) => setScanValue(event.target.value)}
            onSearch={() => void load()}
            enterButton="读取订单"
            placeholder="扫描或粘贴订单流转码"
            autoFocus
          />
        </Space>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={12} className="full-width">
      {contextHolder}
      <Button onClick={() => { setContext(null); setToken(""); setScanValue(""); }}>重新扫描</Button>
      <Card title="订单费用" size="small">
        <Space direction="vertical" size={6} className="full-width">
          <Typography.Title level={5}>{context.order.styleNo} · {context.order.styleName}</Typography.Title>
          <Typography.Text>客户：{context.order.customerName ?? "-"}</Typography.Text>
          <Typography.Text>客户业务员：{context.order.salespersonName ?? "-"}</Typography.Text>
        </Space>
      </Card>
      {context.chargeLocked ? (
        <Alert type="warning" showIcon message={context.chargeLockReason === "paid" ? "已付款" : "已对账"} description="当前订单不能再增加其他费用；普通订单附件仍可继续上传。" />
      ) : null}
      <OrderChargeLedger
        charges={context.charges}
        sourceScene={`${role}_mobile_scan`}
        canAdd={!context.chargeLocked}
        onAdd={add}
        allowAttachments={!context.chargeLocked}
        currentUserId={session.userId}
        onVoidOwn={voidOwn}
        onAddAttachments={async (charge, attachments) => {
          await sampleRoomApi.addOrderChargeAttachments(session, role, charge.orderId, charge.id, attachments);
          await load(token);
        }}
        onRenameAttachment={async (charge, attachmentId, displayName) => {
          await sampleRoomApi.renameOrderChargeAttachment(
            session,
            role,
            charge.orderId,
            charge.id,
            attachmentId,
            displayName
          );
          await load(token);
        }}
        onDeleteAttachment={deleteAttachment}
        onDownloadAttachment={downloadAttachment}
      />
      <Card size="small" title="补充订单附件">
        <Space direction="vertical" size={8} className="full-width">
          <Typography.Text type="secondary">上传普通订单资料不会改变版师任务、生产工序或订单进度。</Typography.Text>
          <ClientAttachmentPicker
            value={orderAttachmentDraft}
            onChange={setOrderAttachmentDraft}
            defaultCategory="sample_room_upload"
            defaultVisibility="internal_only"
            title="拍照或选择附件"
            description="可拍照、从相册选择或上传文件。"
          />
          <Button
            type="primary"
            loading={orderAttachmentUploading}
            disabled={orderAttachmentDraft.length === 0}
            onClick={() => void uploadOrderAttachments()}
          >
            上传订单附件
          </Button>
        </Space>
      </Card>
    </Space>
  );
}
