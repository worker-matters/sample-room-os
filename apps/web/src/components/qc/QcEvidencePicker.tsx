import { DeleteOutlined, EditOutlined, InboxOutlined } from "@ant-design/icons";
import { Button, Input, Modal, Select, Space, Tag, Upload, message } from "antd";
import { useEffect, useState } from "react";
import type { AttachmentMetadataInput, OrderAttachment } from "../../api/sampleRoomApi";
import { isNativeTabletRuntime } from "../../pages/qc/tabletNativeBridge";
import { NativeTabletImagePicker } from "../tablet/NativeTabletImagePicker";

export type QcPhotoCategory = "qc_issue_photo" | "qc_sample_photo" | "qc_measurement_photo";

type Props = {
  value: AttachmentMetadataInput[];
  onChange: (value: AttachmentMetadataInput[]) => void;
  category: QcPhotoCategory;
  title: string;
  description: string;
};

const categoryLabels: Record<QcPhotoCategory, string> = {
  qc_issue_photo: "问题照片",
  qc_sample_photo: "样衣照片",
  qc_measurement_photo: "尺寸表照片"
};

type Editing = { index: number; fileName: string; visibility: OrderAttachment["visibility"]; category: QcPhotoCategory };

export function QcEvidencePicker({ value, onChange, category, title, description }: Props) {
  const nativeTablet = isNativeTabletRuntime();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [preview, setPreview] = useState<{ fileName: string; url: string } | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const addFiles = (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length !== files.length) void messageApi.warning("QC 证据只支持图片");
    onChange([...value, ...images.map((file) => ({
      file,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      category,
      visibility: "internal_only" as const
    }))]);
  };

  return (
    <div className="qc-evidence-picker">
      {contextHolder}
      {nativeTablet ? (
        <div className="qc-evidence-native-upload">
          <div className="qc-evidence-native-upload-copy">
            <strong>{title}</strong>
            <span>{description}</span>
          </div>
          <NativeTabletImagePicker onFiles={addFiles} />
        </div>
      ) : (
        <Upload.Dragger
          accept="image/*"
          multiple
          showUploadList={false}
          beforeUpload={(file, files) => {
            if (file.uid === files[0]?.uid) addFiles(files as File[]);
            return false;
          }}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">{title}</p>
          <p className="ant-upload-hint">{description}</p>
        </Upload.Dragger>
      )}
      {value.length > 0 ? <><strong className="qc-evidence-count">已选图片（{value.length}）</strong><div className="qc-evidence-list">
        {value.map((item, index) => {
          const itemCategory = (item.category ?? category) as QcPhotoCategory;
          return <div className="qc-evidence-row" key={`${item.fileName}-${index}`}>
            <Button
              type="link"
              className="qc-evidence-name"
              title={item.fileName}
              disabled={!item.file}
              onClick={() => {
                if (!item.file) return;
                closePreview();
                setPreview({ fileName: item.fileName, url: URL.createObjectURL(item.file) });
              }}
            >
              {item.fileName}
            </Button>
            <Tag color={itemCategory === "qc_issue_photo" ? "red" : "green"}>{categoryLabels[itemCategory]}</Tag>
            <Tag color="blue">{item.visibility === "client_visible" ? "客户可见" : "仅内部"}</Tag>
            <Button type="link" icon={<EditOutlined />} onClick={() => setEditing({ index, fileName: item.fileName, visibility: item.visibility ?? "internal_only", category: itemCategory })}>编辑</Button>
            <Button type="link" danger icon={<DeleteOutlined />} onClick={() => onChange(value.filter((_entry, itemIndex) => itemIndex !== index))}>删除</Button>
          </div>;
        })}
      </div></> : null}
      <Modal title="编辑照片" open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => {
        if (!editing?.fileName.trim()) { void messageApi.error("文件名不能为空"); return; }
        onChange(value.map((item, index) => index === editing.index ? { ...item, fileName: editing.fileName.trim(), visibility: editing.visibility, category: editing.category } : item));
        setEditing(null);
      }} okText="保存" cancelText="取消">
        {editing ? <Space direction="vertical" size={16} className="full-width">
          <label>文件名<Input value={editing.fileName} onChange={(event) => setEditing({ ...editing, fileName: event.target.value })} /></label>
          <label>可见范围<Select className="full-width" value={editing.visibility} onChange={(visibility) => setEditing({ ...editing, visibility })} options={[{ label: "仅内部", value: "internal_only" }, { label: "客户可见", value: "client_visible" }]} /></label>
          <label>图片标签<Select className="full-width" value={editing.category} onChange={(nextCategory) => setEditing({ ...editing, category: nextCategory })} options={Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))} /></label>
        </Space> : null}
      </Modal>
      <Modal title={preview?.fileName} open={Boolean(preview)} onCancel={closePreview} footer={<Button type="primary" onClick={closePreview}>关闭</Button>} width="min(92vw, 920px)">
        {preview ? <img className="qc-local-photo-preview" src={preview.url} alt={preview.fileName} /> : null}
      </Modal>
    </div>
  );
}
