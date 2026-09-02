import { Button, Modal, Space, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import { sampleRoomApi, type AttachmentMetadataInput, type OrderChargeCreatePayload, type OrderChargeRecord, type OrderRecord } from "../../api/sampleRoomApi";
import { useDevSession } from "../../app/DevSessionContext";
import { OrderChargeLedger } from "../operations/OrderChargeLedger";

type OrderChargeSummary = Pick<OrderRecord, "id" | "styleNo" | "styleName"> & {
  customerName?: string | undefined;
  salespersonName?: string | undefined;
  customerSnapshot?: { name?: string | undefined } | undefined;
  intakeStatus?: OrderRecord["intakeStatus"] | undefined;
};

type ReceiverOrderChargeModalProps = {
  order: OrderChargeSummary | null;
  charges: OrderChargeRecord[];
  sourceScene?: string;
  thumbnail?: ReactNode;
  role: "receiver" | "planner" | "admin";
  onCancel: () => void;
  onChargesChange: (charges: OrderChargeRecord[]) => void;
};

export function ReceiverOrderChargeModal({
  order,
  charges,
  sourceScene = "receiver_order_list",
  thumbnail,
  role,
  onCancel,
  onChargesChange
}: ReceiverOrderChargeModalProps) {
  const { session } = useDevSession();
  const effectiveTotal = charges
    .filter((charge) => charge.status === "confirmed" || charge.status === "effective")
    .reduce((total, charge) => total + charge.amount, 0);

  const refreshCharges = async () => {
    if (!order) return;
    const result = await sampleRoomApi.listOrderCharges(session, role, order.id);
    onChargesChange(result.charges);
  };

  const add = async (payload: OrderChargeCreatePayload, attachments: AttachmentMetadataInput[]) => {
    if (!order) return;
    const result = await sampleRoomApi.addOrderCharge(session, role, order.id, payload);
    if (attachments.length > 0) {
      await sampleRoomApi.addOrderChargeAttachments(session, role, order.id, result.charge.id, attachments);
    }
    await refreshCharges();
  };

  const loadAttachmentBlob = async (attachmentId: string) => {
    if (!order) throw new Error("当前订单不可用");
    return role === "receiver"
      ? sampleRoomApi.downloadReceiverOrderAttachment(session, order.id, attachmentId)
      : role === "planner"
        ? sampleRoomApi.downloadPlannerOrderAttachment(session, order.id, attachmentId)
        : sampleRoomApi.downloadAdminOrderAttachment(session, order.id, attachmentId);
  };

  return (
    <Modal
      title="追加费用"
      open={Boolean(order)}
      className="receiver-charge-modal"
      footer={<Button onClick={onCancel}>关闭</Button>}
      onCancel={onCancel}
      destroyOnHidden
    >
      {order ? (
        <Space direction="vertical" size={12} className="full-width receiver-charge-dialog">
          <div className="receiver-dialog-order-summary">
            <div className="receiver-dialog-order-thumbnail">{thumbnail}</div>
            <div>
              <Typography.Text type="secondary">款号</Typography.Text>
              <Typography.Text strong>{order.styleNo}</Typography.Text>
            </div>
            <div>
              <Typography.Text type="secondary">款名</Typography.Text>
              <Typography.Text strong>{order.styleName}</Typography.Text>
            </div>
            <div>
              <Typography.Text type="secondary">客户</Typography.Text>
              <Typography.Text strong>{order.customerName ?? order.customerSnapshot?.name ?? "-"}</Typography.Text>
            </div>
            <div>
              <Typography.Text type="secondary">客户业务员</Typography.Text>
              <Typography.Text strong>{order.salespersonName ?? "-"}</Typography.Text>
            </div>
            <div>
              <Typography.Text type="secondary">接单状态</Typography.Text>
              <Tag color={order.intakeStatus === "pending_receive" ? "processing" : "success"}>
                {order.intakeStatus === "pending_receive" ? "待校正" : "已接单"}
              </Tag>
            </div>
          </div>
          <OrderChargeLedger
            charges={charges}
            sourceScene={sourceScene}
            canAdd
            desktopModalLayout
            effectiveTotal={effectiveTotal}
            onAdd={add}
            onEdit={async (charge, payload) => {
              await sampleRoomApi.updateOrderCharge(
                session,
                role,
                charge.orderId,
                charge.id,
                payload
              );
              await refreshCharges();
            }}
            allowAttachments
            currentUserId={session.userId}
            canManageAll={role === "admin"}
            onVoidOwn={async (charge) => {
              await sampleRoomApi.deleteOrderCharge(
                session,
                role,
                charge.orderId,
                charge.id
              );
              await refreshCharges();
            }}
            onAddAttachments={async (charge, attachments) => {
              await sampleRoomApi.addOrderChargeAttachments(session, role, charge.orderId, charge.id, attachments);
              await refreshCharges();
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
              await refreshCharges();
            }}
            onDeleteAttachment={async (charge, attachmentId) => {
              await sampleRoomApi.deleteOrderChargeAttachment(session, role, charge.orderId, charge.id, attachmentId);
              await refreshCharges();
            }}
            loadAttachmentBlob={(attachment) => loadAttachmentBlob(attachment.id)}
          />
        </Space>
      ) : null}
    </Modal>
  );
}
