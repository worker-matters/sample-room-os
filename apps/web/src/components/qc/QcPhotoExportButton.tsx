import { Button, Form, Input, InputNumber, Modal, Space, Typography, message } from "antd";
import { DownloadOutlined, EditOutlined } from "@ant-design/icons";
import { useState } from "react";
import type { OrderAttachment } from "../../api/sampleRoomApi";
import { request } from "../../api/request";
import { useDevSession } from "../../app/DevSessionContext";
import { downloadBlob } from "../../utils/downloadBlob";
import { saveGeneratedWithNativeTablet } from "../../pages/qc/tabletNativeBridge";
import { createQcPhotoExport, type QcPhotoExportOrder, type QcPhotoExportFormat } from "./qcPhotoExport";

type QcPhotoExportButtonOrder = QcPhotoExportOrder & {
  id?: string | undefined;
};

type EffectiveQcResult = {
  orderId: string;
  scanRecordId: string;
  pieces?: number;
  originalPieces?: number;
  correctionCount: number;
  workerName?: string;
  eventTime: string;
  lastCorrectedAt?: string;
  lastCorrectedBy?: string;
};

type CorrectionForm = {
  pieces: number;
  reason: string;
};

export function QcPhotoExportButton({ order, photos, loadPhoto, autoOpen = false, onClose }: {
  order: QcPhotoExportButtonOrder;
  photos: OrderAttachment[];
  loadPhoto: (photo: OrderAttachment) => Promise<Blob>;
  autoOpen?: boolean;
  onClose?: () => void;
}) {
  const { session } = useDevSession();
  const [open, setOpen] = useState(autoOpen);
  const [busy, setBusy] = useState<QcPhotoExportFormat>();
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionLoading, setCorrectionLoading] = useState(false);
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [qcResult, setQcResult] = useState<EffectiveQcResult | null>(null);
  const [correctionForm] = Form.useForm<CorrectionForm>();
  const [messageApi, contextHolder] = message.useMessage();
  const orderId = order.id;
  const canCorrectQcPieces = Boolean(orderId) && (session.role === "boss" || session.role === "system_owner");

  const exportPhotos = async (format: QcPhotoExportFormat) => {
    setBusy(format);
    try {
      const result = await createQcPhotoExport(order, photos, format, loadPhoto);
      if (!await saveGeneratedWithNativeTablet(result.blob, result.fileName, result.mimeType)) {
        downloadBlob(result.blob, result.fileName);
      }
      setOpen(false);
      onClose?.();
      void messageApi.success(`已生成${format === "pdf" ? " PDF" : "合并照片"}`);
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : "照片导出失败");
    } finally {
      setBusy(undefined);
    }
  };

  const openCorrection = async () => {
    if (!orderId) return;
    setCorrectionOpen(true);
    setCorrectionLoading(true);
    setQcResult(null);
    correctionForm.resetFields();
    try {
      const response = await request<{ result: EffectiveQcResult | null }>(
        session,
        `/api/admin/orders/${encodeURIComponent(orderId)}/qc-result/effective-pieces`
      );
      setQcResult(response.result);
      if (response.result?.pieces !== undefined) {
        correctionForm.setFieldValue("pieces", response.result.pieces);
      }
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : "组检记录加载失败");
    } finally {
      setCorrectionLoading(false);
    }
  };

  const saveCorrection = async () => {
    if (!qcResult || !orderId) return;
    const values = await correctionForm.validateFields();
    setCorrectionSaving(true);
    try {
      const response = await request<{ result: EffectiveQcResult | null }>(
        session,
        `/api/admin/orders/${encodeURIComponent(orderId)}/qc-result/pieces`,
        {
          method: "PATCH",
          body: JSON.stringify(values)
        }
      );
      setQcResult(response.result);
      setCorrectionOpen(false);
      correctionForm.resetFields();
      window.dispatchEvent(new CustomEvent("sample-room:qc-pieces-corrected", {
        detail: { orderId, pieces: response.result?.pieces }
      }));
      void messageApi.success("组检实际检验件数已修正；重新打开组检报告会显示最新值。");
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : "修改失败");
    } finally {
      setCorrectionSaving(false);
    }
  };

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <>
      {contextHolder}
      {!autoOpen ? (
        <Space size={6}>
          {canCorrectQcPieces ? (
            <Button icon={<EditOutlined />} onClick={() => void openCorrection()}>
              修改检验件数
            </Button>
          ) : null}
          <Button icon={<DownloadOutlined />} disabled={photos.length === 0} onClick={() => setOpen(true)}>
            组检报告导出
          </Button>
        </Space>
      ) : null}

      <Modal title="选择组检报告导出格式" open={open} footer={null} onCancel={close} destroyOnHidden>
        <Space direction="vertical" size={12} className="full-width">
          <Button block type="primary" loading={busy === "pdf"} disabled={Boolean(busy)} onClick={() => void exportPhotos("pdf")}>导出 PDF</Button>
          <Button block loading={busy === "image"} disabled={Boolean(busy)} onClick={() => void exportPhotos("image")}>导出合并照片</Button>
        </Space>
      </Modal>

      <Modal
        title="修改组检实际检验件数"
        open={correctionOpen}
        onCancel={() => setCorrectionOpen(false)}
        onOk={() => void saveCorrection()}
        okText="确认修改"
        cancelText="取消"
        confirmLoading={correctionSaving}
        okButtonProps={{ disabled: correctionLoading || !qcResult }}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} className="full-width">
          <Typography.Text type="secondary">
            这里只修正组检实际检验记录和绩效统计，不会修改订单数量、裁剪件数或缝制件数。
          </Typography.Text>
          {qcResult?.originalPieces !== undefined ? (
            <Typography.Text type="secondary">
              原始录入：{qcResult.originalPieces} 件；已修正 {qcResult.correctionCount} 次。
            </Typography.Text>
          ) : null}
          <Form<CorrectionForm> form={correctionForm} layout="vertical" disabled={correctionLoading}>
            <Form.Item
              name="pieces"
              label="实际检验件数"
              rules={[
                { required: true, message: "请输入实际检验件数" },
                {
                  validator: async (_, value) => {
                    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
                      throw new Error("请输入大于等于 0 的整数");
                    }
                  }
                }
              ]}
            >
              <InputNumber min={0} precision={0} addonAfter="件" className="full-width" />
            </Form.Item>
            <Form.Item
              name="reason"
              label="修改原因"
              rules={[
                { required: true, whitespace: true, message: "请填写修改原因" },
                { max: 500, message: "修改原因不能超过 500 个字符" }
              ]}
            >
              <Input.TextArea rows={3} maxLength={500} showCount placeholder="例如：组检员工录入错误，实际只检验 5 件" />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </>
  );
}
