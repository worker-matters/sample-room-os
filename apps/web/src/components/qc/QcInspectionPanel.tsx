import { Alert, Button, Form, Image, Input, InputNumber, Modal, Radio, Space, Typography, message } from "antd";
import { useEffect, useState } from "react";
import type { AttachmentMetadataInput, ScanPageState } from "../../api/sampleRoomApi";
import { integerInputProps } from "../forms/numericInputProps";
import { QcEvidencePicker } from "./QcEvidencePicker";

export type QcInspectionValues = {
  pieces: number;
  qualityResult: "qualified" | "rework";
  qualityScore?: number | undefined;
  note?: string | undefined;
  attachments: AttachmentMetadataInput[];
};

type Props = {
  state: ScanPageState;
  submitting?: boolean | undefined;
  compact?: boolean | undefined;
  previousRework?: {
    note?: string | undefined;
    eventTime: string;
    photos: Array<{ id: string; fileName: string }>;
    photoUrl?: ((attachment: { id: string; fileName: string }) => string) | undefined;
  } | undefined;
  onSubmit: (values: QcInspectionValues) => Promise<void> | void;
};

type FormValues = Omit<QcInspectionValues, "attachments">;

export function QcInspectionPanel({ state, submitting, compact, previousRework, onSubmit }: Props) {
  const [form] = Form.useForm<FormValues>();
  const qualityResult = Form.useWatch("qualityResult", form) ?? "qualified";
  const [samplePhotos, setSamplePhotos] = useState<AttachmentMetadataInput[]>([]);
  const [measurementPhotos, setMeasurementPhotos] = useState<AttachmentMetadataInput[]>([]);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    form.resetFields();
    form.setFieldValue("qualityResult", "qualified");
    if (state.defaultPieces !== undefined) form.setFieldValue("pieces", state.defaultPieces);
    setSamplePhotos([]);
    setMeasurementPhotos([]);
  }, [form, state.defaultPieces, state.order.styleNo]);

  const submit = (values: FormValues) => {
    if (values.qualityResult === "qualified" && !samplePhotos.some((photo) => photo.category === "qc_sample_photo")) {
      void messageApi.error("请至少上传一张样衣 QC 照片");
      return;
    }
    const isRework = values.qualityResult === "rework";
    Modal.confirm({
      title: isRework ? "确认需要返工？" : "确认合格并完成？",
      content: isRework
        ? `实收件数：${values.pieces} 件；返工原因：${values.note?.trim() ?? ""}。提交后记录本次返工，订单继续等待复检，不会进入已完成。`
        : `实收件数：${values.pieces} 件；质量评分：${values.qualityScore} 分。提交后订单进入已完成。`,
      okText: isRework ? "确认返工" : "确认完成",
      cancelText: "返回核对",
      onOk: () => {
        const { qualityScore, ...rest } = values;
        return onSubmit({
          ...rest,
          ...(!isRework && qualityScore !== undefined ? { qualityScore } : {}),
          attachments: [
            ...samplePhotos,
            ...(!isRework ? measurementPhotos : [])
          ]
        });
      }
    });
  };

  return (
    <div className={compact ? "qc-inspection-panel qc-inspection-panel-compact" : "qc-inspection-panel"}>
      {contextHolder}
      {previousRework ? (
        <Alert
          className="qc-previous-rework"
          type="warning"
          showIcon
          message="上次返工信息"
          description={
            <Space direction="vertical" size={8}>
              <Typography.Text>返工原因：{previousRework.note || "-"}</Typography.Text>
              {previousRework.photos.length > 0 ? (
                <Image.PreviewGroup>
                  <Space wrap>
                    {previousRework.photos.map((photo) => (
                      <Image
                        key={photo.id}
                        width={72}
                        height={72}
                        className="qc-previous-photo"
                        src={previousRework.photoUrl?.(photo) ?? ""}
                        alt={photo.fileName}
                      />
                    ))}
                  </Space>
                </Image.PreviewGroup>
              ) : null}
            </Space>
          }
        />
      ) : null}

      <Form<FormValues>
        className="qc-inspection-form"
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={submit}
        initialValues={{ pieces: state.defaultPieces, qualityResult: "qualified" }}
      >
        <div className="qc-inspection-controls">
        <Form.Item label="QC 结果" name="qualityResult" rules={[{ required: true }]}>
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            options={[
              { label: "合格并完成", value: "qualified" },
              { label: "需要返工", value: "rework" }
            ]}
            onChange={(event) => {
              setSamplePhotos([]);
              setMeasurementPhotos([]);
              if (event.target.value === "rework") {
                form.setFieldValue("qualityScore", undefined);
              }
            }}
          />
        </Form.Item>

        <div className="qc-inspection-fields">
          <Form.Item label="实收 / 检查件数" name="pieces" rules={[{ required: true, message: "请输入实收件数" }]}>
            <InputNumber<number>
              {...integerInputProps}
              min={0}
              precision={0}
              parser={(value) => {
                const digits = value?.split(/[.,]/, 1)[0]?.replace(/[^0-9]/g, "") ?? "";
                return digits ? Number(digits) : 0;
              }}
              onKeyDown={(event) => {
                if (["e", "E", ".", ",", "-", "+"].includes(event.key)) event.preventDefault();
              }}
              addonAfter="件"
              className="full-width"
            />
          </Form.Item>
          {qualityResult === "qualified" ? (
            <Form.Item
              label="质量评分"
              name="qualityScore"
              rules={[
                { required: true, message: "请输入质量评分" },
                { validator: (_rule, value) => value === undefined || (Number.isInteger(value) && value >= 0 && value <= 100) ? Promise.resolve() : Promise.reject(new Error("质量评分必须是 0–100 的整数")) }
              ]}
            >
              <InputNumber {...integerInputProps} min={0} max={100} precision={0} addonAfter="分" className="full-width" />
            </Form.Item>
          ) : null}
        </div>

        <Form.Item
          label={qualityResult === "rework" ? "返工原因" : "异常说明（可选）"}
          name="note"
          rules={qualityResult === "rework" ? [{ required: true, whitespace: true, message: "请填写返工原因" }] : []}
        >
          <Input.TextArea rows={compact ? 2 : 3} placeholder={qualityResult === "rework" ? "请输入明确的返工原因" : "如有异常，可在这里说明"} />
        </Form.Item>
        </div>

        <div className="qc-inspection-photos">
          <Form.Item label={qualityResult === "rework" ? "问题照片（可选）" : "最终样衣照片（至少1张）"} required={qualityResult === "qualified"}>
            <QcEvidencePicker
              value={samplePhotos}
              onChange={setSamplePhotos}
              category={qualityResult === "rework" ? "qc_issue_photo" : "qc_sample_photo"}
              title={qualityResult === "rework" ? "拍摄或选择问题照片" : "拍摄或选择样衣照片"}
              description={qualityResult === "rework" ? "仅图片；返工时可不上传" : "仅图片；至少一张"}
            />
          </Form.Item>
          {qualityResult === "qualified" ? <Form.Item label="尺寸表照片（可选）">
            <QcEvidencePicker
              value={measurementPhotos}
              onChange={setMeasurementPhotos}
              category="qc_measurement_photo"
              title="拍摄或选择尺寸表照片"
              description="仅图片；可选"
            />
          </Form.Item> : null}
        </div>

        <div className="qc-inspection-submit-area">
          <Alert className="qc-submit-note" type="info" showIcon message={qualityResult === "rework" ? "返工时不填写质量评分；问题照片可选。只有点击“确认提交”后，才会记录本次组检人员。" : "合格必须填写质量评分并上传至少一张最终样衣照片。只有点击“确认提交”后，才会记录本次组检人员。"} />
          <Button type="primary" htmlType="submit" loading={submitting === true} size="large" block>
            确认提交
          </Button>
        </div>
      </Form>
    </div>
  );
}
