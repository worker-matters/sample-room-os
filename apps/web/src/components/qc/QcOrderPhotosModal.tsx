import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Image,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
  message
} from "antd";
import { DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, ShareAltOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DevSession } from "../../app/DevSessionContext";
import {
  sampleRoomApi,
  type AttachmentMetadataInput,
  type OrderAttachment,
  type QcTabletOrder,
  type QcTabletOrderDetail
} from "../../api/sampleRoomApi";
import { splitAttachmentFileName, validateAttachmentFileNameBody } from "../attachmentFileName";
import { downloadBlob } from "../../utils/downloadBlob";
import { formatQcTime } from "./qcTabletUtils";
import { downloadWithNativeTablet, isNativeTabletRuntime, shareWithNativeTablet } from "../../pages/qc/tabletNativeBridge";
import { SampleRoundTag, SampleTypeTag } from "../StatusTags";
import { NativeTabletImagePicker } from "../tablet/NativeTabletImagePicker";

type Props = {
  open: boolean;
  order: QcTabletOrder | null;
  session: DevSession;
  onClose: () => void;
  onChanged?: () => void;
};

type PreviewState = { attachment: OrderAttachment; url: string; blob: Blob };
type EditState = { attachment: OrderAttachment; baseName: string; extension: string; visibility: "internal_only" | "client_visible"; category: "qc_issue_photo" | "qc_sample_photo" | "qc_measurement_photo" };
type PendingPhoto = { key: string; attachment: AttachmentMetadataInput; url: string };

function visibilityTag(value: OrderAttachment["visibility"]) {
  return value === "client_visible" ? <Tag color="green">客户可见</Tag> : <Tag color="blue">仅内部</Tag>;
}

export function QcOrderPhotosModal({ open, order, session, onClose, onChanged }: Props) {
  const nativeTablet = isNativeTabletRuntime();
  const [detail, setDetail] = useState<QcTabletOrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const pendingPhotosRef = useRef<PendingPhoto[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(() => new Set());
  const [messageApi, contextHolder] = message.useMessage();

  const load = async () => {
    if (!order) return;
    setLoading(true);
    try { setDetail((await sampleRoomApi.getQcOrder(session, order.orderId)).order); }
    catch (error) { void messageApi.error(error instanceof Error ? error.message : "照片信息加载失败"); }
    finally { setLoading(false); }
  };

  const clearPendingChanges = () => {
    pendingPhotosRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    pendingPhotosRef.current = [];
    setPendingPhotos([]);
    setPendingDeleteIds(new Set());
  };

  useEffect(() => {
    pendingPhotosRef.current = pendingPhotos;
  }, [pendingPhotos]);
  useEffect(() => {
    if (open && order) {
      clearPendingChanges();
      void load();
    }
  }, [open, order?.orderId]);
  useEffect(() => () => {
    pendingPhotosRef.current.forEach((item) => URL.revokeObjectURL(item.url));
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const groups = useMemo(() => ({
    sample: detail?.attachments.filter((item) => item.category === "qc_sample_photo" && !pendingDeleteIds.has(item.id)) ?? [],
    measurement: detail?.attachments.filter((item) => item.category === "qc_measurement_photo" && !pendingDeleteIds.has(item.id)) ?? []
  }), [detail, pendingDeleteIds]);

  const pendingGroups = useMemo(() => ({
    sample: pendingPhotos.filter((item) => item.attachment.category === "qc_sample_photo"),
    measurement: pendingPhotos.filter((item) => item.attachment.category === "qc_measurement_photo")
  }), [pendingPhotos]);

  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  const openPreview = async (attachment: OrderAttachment) => {
    if (!order) return;
    setSaving(true);
    try {
      const blob = await sampleRoomApi.downloadQcOrderPhoto(session, order.orderId, attachment.id);
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview({ attachment, blob, url: URL.createObjectURL(blob) });
    } catch (error) { void messageApi.error(error instanceof Error ? error.message : "图片预览失败"); }
    finally { setSaving(false); }
  };

  const stageUpload = (files: File[], category: "qc_sample_photo" | "qc_measurement_photo") => {
    if (files.length === 0) return;
    setPendingPhotos((current) => [
      ...current,
      ...files.map((file, index): PendingPhoto => ({
        key: `${Date.now()}-${index}-${file.name}`,
        url: URL.createObjectURL(file),
        attachment: {
        file,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        category,
        visibility: "internal_only"
        }
      }))
    ]);
  };

  const saveEdit = async () => {
    if (!order || !editing) return;
    const error = validateAttachmentFileNameBody(editing.baseName, editing.extension);
    if (error) { void messageApi.error(error); return; }
    setSaving(true);
    try {
      await sampleRoomApi.updateQcOrderPhoto(session, order.orderId, editing.attachment.id, {
        displayName: editing.baseName.trim(),
        visibility: editing.visibility,
        category: editing.category
      });
      setEditing(null);
      void messageApi.success("照片信息已保存");
      await load();
      onChanged?.();
    } catch (saveError) { void messageApi.error(saveError instanceof Error ? saveError.message : "保存失败"); }
    finally { setSaving(false); }
  };

  const stageRemove = (attachment: OrderAttachment) => {
    setPendingDeleteIds((current) => new Set(current).add(attachment.id));
  };

  const removePendingPhoto = (item: PendingPhoto) => {
    URL.revokeObjectURL(item.url);
    setPendingPhotos((current) => current.filter((candidate) => candidate.key !== item.key));
  };

  const applyPendingChanges = async () => {
    if (!order) return;
    setSaving(true);
    try {
      if (pendingPhotos.length > 0) {
        await sampleRoomApi.addQcOrderPhotos(session, order.orderId, pendingPhotos.map((item) => item.attachment));
      }
      for (const attachmentId of pendingDeleteIds) {
        await sampleRoomApi.deleteQcOrderPhoto(session, order.orderId, attachmentId);
      }
      clearPendingChanges();
      void messageApi.success("照片更新已保存");
      onChanged?.();
      onClose();
    } catch (error) {
      void messageApi.error(error instanceof Error ? error.message : "照片更新失败");
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (pendingPhotos.length === 0 && pendingDeleteIds.size === 0) {
      onClose();
      return;
    }
    Modal.confirm({
      title: "是否确认更新",
      content: `本次将新增 ${pendingPhotos.length} 张、删除 ${pendingDeleteIds.size} 张照片。`,
      okText: "确认更新",
      cancelText: "不保存退出",
      onOk: applyPendingChanges,
      onCancel: () => {
        clearPendingChanges();
        onClose();
      }
    });
  };

  const share = async () => {
    if (!preview || !order) return;
    const relativePath = `/api/qc/me/orders/${encodeURIComponent(order.orderId)}/photos/${encodeURIComponent(preview.attachment.id)}/download`;
    const mimeType = preview.blob.type || preview.attachment.mimeType || "application/octet-stream";
    if (shareWithNativeTablet(relativePath, preview.attachment.fileName, mimeType)) return;
    const file = new File([preview.blob], preview.attachment.fileName, { type: preview.blob.type || preview.attachment.mimeType });
    if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
      void messageApi.info("当前浏览器不支持直接分享，请下载后分享");
      return;
    }
    try { await navigator.share({ files: [file], title: preview.attachment.fileName }); }
    catch (error) { if ((error as DOMException).name !== "AbortError") void messageApi.error("分享失败，请下载后分享"); }
  };

  const downloadPreview = () => {
    if (!preview || !order) return;
    const relativePath = `/api/qc/me/orders/${encodeURIComponent(order.orderId)}/photos/${encodeURIComponent(preview.attachment.id)}/download`;
    const mimeType = preview.blob.type || preview.attachment.mimeType || "application/octet-stream";
    if (!downloadWithNativeTablet(relativePath, preview.attachment.fileName, mimeType)) {
      downloadBlob(preview.blob, preview.attachment.fileName);
    }
  };

  const photoGroup = (title: string, category: "qc_sample_photo" | "qc_measurement_photo", photos: OrderAttachment[], pending: PendingPhoto[]) => (
    <div className="qc-photo-group">
      <div className="qc-photo-group-header">
        <Typography.Title level={5}>{title}</Typography.Title>
        {nativeTablet ? (
          <NativeTabletImagePicker
            className="qc-photo-group-upload-actions"
            disabled={saving}
            onFiles={(files) => stageUpload(files, category)}
          />
        ) : (
          <Upload
            accept="image/*"
            multiple
            showUploadList={false}
            beforeUpload={(file, files) => { if (file.uid === files[0]?.uid) stageUpload(files as File[], category); return false; }}
          >
            <Button icon={<PlusOutlined />} loading={saving}>补充上传</Button>
          </Upload>
        )}
      </div>
      {photos.length || pending.length ? (
        <div className="qc-photo-grid">
          {pending.map((item) => (
            <Card key={item.key} size="small" className="qc-photo-card is-pending" cover={
              <Image preview src={item.url} alt={item.attachment.fileName} />
            }>
              <Space direction="vertical" size={6} className="full-width">
                <Tag color="orange">待保存</Tag>
                <Typography.Text ellipsis className="qc-photo-name">{item.attachment.fileName}</Typography.Text>
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removePendingPhoto(item)}>移除</Button>
              </Space>
            </Card>
          ))}
          {photos.map((photo) => (
            <Card key={photo.id} size="small" className="qc-photo-card" cover={
              <button type="button" className="qc-photo-thumb-button" onClick={() => void openPreview(photo)}>
                <Image preview={false} src={`/api/qc/me/orders/${encodeURIComponent(order!.orderId)}/photos/${encodeURIComponent(photo.id)}/download`} alt={photo.fileName} />
              </button>
            }>
              <Space direction="vertical" size={6} className="full-width">
                {visibilityTag(photo.visibility)}
                <Button type="link" className="qc-photo-name" onClick={() => {
                  const name = splitAttachmentFileName(photo.fileName);
                  setEditing({ attachment: photo, baseName: name.baseName, extension: name.extension, visibility: photo.visibility, category: photo.category as EditState["category"] });
                }}>{photo.fileName}</Button>
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => {
                    const name = splitAttachmentFileName(photo.fileName);
                    setEditing({ attachment: photo, baseName: name.baseName, extension: name.extension, visibility: photo.visibility, category: photo.category as EditState["category"] });
                  }}>编辑</Button>
                  <Popconfirm title="删除这张照片？" description="将标记为待删除，退出弹窗时再确认保存。" onConfirm={() => stageRemove(photo)}>
                    <Button size="small" danger icon={<DeleteOutlined />} aria-label={`删除 ${photo.fileName}`} />
                  </Popconfirm>
                </Space>
              </Space>
            </Card>
          ))}
        </div>
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无照片" />}
    </div>
  );

  return (
    <>
      {contextHolder}
      <Modal className="qc-photo-manager-modal" width={980} title="查看 / 补充" open={open} onCancel={requestClose} footer={<Button onClick={requestClose}>关闭</Button>} destroyOnHidden>
        <Spin spinning={loading || saving}>
          {detail && order ? (
            <Row gutter={24}>
              <Col xs={24} md={8} className="qc-photo-order-column">
                <Typography.Title level={5}>订单信息（只读）</Typography.Title>
                <Space direction="vertical" size={10}>
                  {detail.thumbnailUrl ? <img className="qc-completed-order-thumb" src={detail.thumbnailUrl} alt={detail.styleName} /> : null}
                  <Typography.Title level={4}>{detail.styleNo}</Typography.Title>
                  <Typography.Text strong>{detail.styleName}</Typography.Text>
                  <Space size={4}><Typography.Text>样衣类别：</Typography.Text><SampleTypeTag value={detail.sampleType} /></Space>
                  <Space size={4}><Typography.Text>轮次：</Typography.Text><SampleRoundTag value={detail.sampleRound} /></Space>
                  <Typography.Text>数量：{detail.quantity} 件</Typography.Text>
                  <Typography.Text>客户：{detail.customerName}</Typography.Text>
                  <Typography.Text>业务员：{detail.salespersonName}</Typography.Text>
                  <Typography.Text>完成时间：{formatQcTime(detail.eventTime)}</Typography.Text>
                  <Typography.Text>最终 QC 结果：<Tag color="green">合格</Tag></Typography.Text>
                  <Typography.Text>质量评分：<Typography.Text className="qc-score">{detail.qualityScore ?? "-"} 分</Typography.Text></Typography.Text>
                  <Typography.Text>检查件数：{detail.pieces ?? "-"} 件</Typography.Text>
                  <Typography.Text>组检人员：{detail.workerName ?? "-"}</Typography.Text>
                  <Typography.Text>最终说明：{detail.note || "-"}</Typography.Text>
                </Space>
              </Col>
              <Col xs={24} md={16} className="qc-photo-workspace">
                <Typography.Title level={5}>照片补充</Typography.Title>
                {pendingPhotos.length || pendingDeleteIds.size ? <Tag color="orange">待保存：新增 {pendingPhotos.length} 张，删除 {pendingDeleteIds.size} 张</Tag> : null}
                {photoGroup("A. 样衣照片", "qc_sample_photo", groups.sample, pendingGroups.sample)}
                {photoGroup("B. 尺寸表照片", "qc_measurement_photo", groups.measurement, pendingGroups.measurement)}
              </Col>
            </Row>
          ) : null}
        </Spin>
      </Modal>

      <Modal title={preview?.attachment.fileName} open={Boolean(preview)} onCancel={closePreview} footer={preview ? [
        <Button key="download" icon={<DownloadOutlined />} onClick={downloadPreview}>下载</Button>,
        <Button key="share" icon={<ShareAltOutlined />} onClick={() => void share()}>分享</Button>,
        <Button key="close" type="primary" onClick={closePreview}>关闭</Button>
      ] : null} width="min(92vw, 920px)" className="qc-photo-preview-modal">
        {preview ? <img src={preview.url} alt={preview.attachment.fileName} className="qc-photo-preview-image" /> : null}
      </Modal>

      <Modal title="编辑照片" open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => void saveEdit()} confirmLoading={saving} okText="保存" cancelText="取消">
        {editing ? (
          <Form layout="vertical">
            <Form.Item label="文件名" {...(validateAttachmentFileNameBody(editing.baseName, editing.extension) ? { validateStatus: "error" as const, help: validateAttachmentFileNameBody(editing.baseName, editing.extension) } : {})}>
              <Input value={editing.baseName} addonAfter={editing.extension || "无扩展名"} onChange={(event) => setEditing({ ...editing, baseName: event.target.value })} />
            </Form.Item>
            <Form.Item label="可见范围">
              <Select value={editing.visibility} onChange={(visibility) => setEditing({ ...editing, visibility })} options={[
                { label: "仅内部", value: "internal_only" },
                { label: "客户可见", value: "client_visible" }
              ]} />
            </Form.Item>
            <Form.Item label="图片标签">
              <Select value={editing.category} onChange={(category) => setEditing({ ...editing, category })} options={[
                { label: "问题照片", value: "qc_issue_photo" },
                { label: "样衣照片", value: "qc_sample_photo" },
                { label: "尺寸表照片", value: "qc_measurement_photo" }
              ]} />
            </Form.Item>
          </Form>
        ) : null}
      </Modal>
    </>
  );
}
