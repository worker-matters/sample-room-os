import { Alert, Button, Card, Form, Image, Input, InputNumber, Modal, Select, Space, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { sampleRequestItemOptions } from "@sample-room/shared";
import {
  sampleRoomApi,
  type AttachmentMetadataInput,
  type ScanPageState
} from "../../api/sampleRoomApi";
import { ClientAttachmentPicker } from "../../components/ClientAttachmentPicker";
import { integerInputProps } from "../../components/forms/numericInputProps";
import { useAuthSession } from "../../app/AuthSessionContext";
import { scanActionButtonLabel } from "../../components/scan/scanDisplay";
import { QcInspectionPanel } from "../../components/qc/QcInspectionPanel";
import { useVisibleAutoRefresh } from "../../hooks/useVisibleAutoRefresh";

type CompleteFormValues = {
  workHours?: number | string;
  pieces?: number;
  note?: string;
  qualityResult?: "qualified" | "rework" | "rejected";
  qualityScore?: number;
  attachments?: AttachmentMetadataInput[];
};

function statusColor(action: ScanPageState["allowedAction"]) {
  if (action === "start") {
    return "blue";
  }

  if (action === "complete") {
    return "green";
  }

  if (action === "takeover" || action === "choose_sewing_assignment" || action === "join_collaboration") return "gold";

  return "default";
}

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "-";
}

const sampleRequestItemLabel = new Map<string, string>(
  sampleRequestItemOptions.map((option) => [option.value, option.label] as const)
);

function stateMessage(state: ScanPageState) {
  if (state.allowedAction === "start") {
    return {
      type: "success" as const,
      message: "已轮到你的工序",
      description: "确认后开始缝制任务。"
    };
  }

  if (state.allowedAction === "complete") {
    if (state.stage === "cutting") {
      return { type: "info" as const, message: "裁剪完成登记", description: "裁剪不需要开始扫码，完成后直接录入件数、工时和备注。" };
    }
    if (state.stage === "qc_delivery") {
      return { type: "info" as const, message: "组检完成登记", description: "组检不需要开始扫码，请确认实收件数、样衣评分、质量结果和现场照片。" };
    }
    return {
      type: "info" as const,
      message: "你已开始该工序",
      description: "确认完成件数和工时后提交缝制结果。"
    };
  }

  if (state.allowedAction === "takeover" && state.activeTask) {
    return {
      type: "warning" as const,
      message: "该缝制任务正在由其他员工处理",
      description: `${state.activeTask.workerName} 已开始。仅在确需接替时操作；系统会保留原员工、接替人和原因。`
    };
  }

  if (state.allowedAction === "choose_sewing_assignment" && state.activeTask) {
    return {
      type: "warning" as const,
      message: "该订单已有一名缝制员工",
      description: `${state.activeTask.workerName} 正在处理。请选择替代原负责人，或直接加入协作。`
    };
  }

  if (state.allowedAction === "join_collaboration") {
    return {
      type: "info" as const,
      message: "加入多人协作",
      description: "确认后直接加入协作；实际完成件数在交货时填写。"
    };
  }

  if (state.blockedReason === "terminated") {
    return {
      type: "warning" as const,
      message: "订单已终止",
      description: "5 秒后自动返回当前角色界面，也可以立即返回。"
    };
  }

  if (state.blockedReason === "previous_unfinished" && state.activeTask) {
    return {
      type: "warning" as const,
      message: "上一工序还没有完成扫码",
      description: `${state.activeTask.stageLabel} / ${state.activeTask.workerName} 已经接下任务，但还没有提交完成结果。请联系该员工完成流程，或退回给计划员处理。`
    };
  }

  if (state.blockedReason === "other_worker_started" && state.activeTask) {
    return {
      type: "warning" as const,
      message: "该工序已由其他员工开始",
      description: `${state.activeTask.stageLabel} / ${state.activeTask.workerName} 已经接下任务。请联系该员工完成流程，或退回给计划员处理。`
    };
  }

  if (state.blockedReason === "wrong_stage") {
    return {
      type: "warning" as const,
      message: state.message ?? `当前订单待${state.stageLabel ?? "对应工序"}`,
      description: "5 秒后自动返回当前角色界面，也可以立即返回。"
    };
  }

  if (state.blockedReason === "done") {
    return {
      type: "success" as const,
      message: "实体生产已完成",
      description: "无需继续扫码。"
    };
  }

  return {
    type: "warning" as const,
    message: state.message ?? "当前订单不能扫码处理"
  };
}

export function ScanTaskPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { authMode, session, status } = useAuthSession();
  const locatorRole = session?.role === "receiver" || session?.role === "planner" ? session.role : undefined;
  const isOrderLocatorRole = Boolean(locatorRole);
  const isClientAccount = session?.role === "client_admin" || session?.role === "client_business_user";
  const [state, setState] = useState<ScanPageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [takeoverReason, setTakeoverReason] = useState("");
  const [takeoverExpectedWorkerId, setTakeoverExpectedWorkerId] = useState("");
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [qcSamplePhotos, setQcSamplePhotos] = useState<AttachmentMetadataInput[]>([]);
  const [qcMeasurementPhotos, setQcMeasurementPhotos] = useState<AttachmentMetadataInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitTerminated, setSubmitTerminated] = useState(false);
  const [form] = Form.useForm<CompleteFormValues>();
  const qualityResult = Form.useWatch("qualityResult", form);
  const isNormalQcRework =
    state?.stage === "qc_delivery" &&
    state.allowedAction === "complete" &&
    qualityResult === "rework";
  const [messageApi, contextHolder] = message.useMessage();
  const returnToRoleHome = useCallback(() => {
    navigate(state?.worker?.stage === "qc_delivery" ? "/qc/tablet" : "/help", { replace: true });
  }, [navigate, state?.worker?.stage]);

  useEffect(() => {
    if (authMode !== "formal" || status !== "unauthenticated" || !token) {
      return;
    }

    navigate("/login", {
      replace: true,
      state: { returnTo: `/scan/${encodeURIComponent(token)}` }
    });
  }, [authMode, navigate, status, token]);

  const loadState = useCallback(async (silent = false) => {
    if (authMode === "formal" && status !== "authenticated") {
      return;
    }
    if (isOrderLocatorRole) {
      if (!silent) setLoading(false);
      return;
    }
    if (isClientAccount) {
      if (!silent) setError("客户账号不使用订单二维码");
      if (!silent) setLoading(false);
      return;
    }
    if (!token) {
      if (!silent) setError("扫码链接无效");
      if (!silent) setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    if (!silent) setError(null);
    if (!silent) setSubmitTerminated(false);
    try {
      const result = await sampleRoomApi.getScanState(token);
      setState(result.state);
      if (!silent && result.state.defaultPieces !== undefined) {
        form.setFieldValue("pieces", result.state.defaultPieces);
      }
    } catch (loadError) {
      if (!silent) setError(loadError instanceof Error ? loadError.message : "扫码链接不可用");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [authMode, form, isClientAccount, isOrderLocatorRole, status, token]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useVisibleAutoRefresh(() => loadState(true), Boolean(token) && !isOrderLocatorRole && !isClientAccount);

  useEffect(() => {
    if (
      state?.blockedReason !== "wrong_stage" &&
      state?.blockedReason !== "terminated" &&
      !submitTerminated
    ) return;
    const timer = window.setTimeout(returnToRoleHome, 5000);
    return () => window.clearTimeout(timer);
  }, [returnToRoleHome, state?.blockedReason, submitTerminated]);

  useEffect(() => {
    if (!token || !isOrderLocatorRole) return;
    navigate(`/${locatorRole}/mobile?scanToken=${encodeURIComponent(token)}`, { replace: true });
  }, [isOrderLocatorRole, locatorRole, navigate, token]);

  const startTask = async () => {
    if (!token) {
      return;
    }

    setSubmitting(true);
    try {
      const result = await sampleRoomApi.startScan(token);
      setState(result.state);
      messageApi.success("已开始当前工序");
      if (result.state.defaultPieces !== undefined) {
        form.setFieldValue("pieces", result.state.defaultPieces);
      }
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "开始失败");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmStartTask = () => {
    Modal.confirm({
      title: "开始缝制任务？",
      content: "开始后该任务会记录在你的名下；完成时仍需再次扫码提交结果。",
      okText: "确认开始",
      cancelText: "取消",
      onOk: startTask
    });
  };

  const completeTask = async (values: CompleteFormValues) => {
    if (!token) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const isNormalQcRework =
        state?.stage === "qc_delivery" &&
        state.allowedAction === "complete" &&
        values.qualityResult === "rework";
      const payload = {
        ...(values.workHours !== undefined && values.workHours !== "" ? { workHours: Number(values.workHours) } : {}),
        ...(values.pieces !== undefined ? { pieces: values.pieces } : {}),
        ...(values.note !== undefined ? { note: values.note } : {}),
        ...(values.qualityResult !== undefined ? { qualityResult: values.qualityResult } : {}),
        ...(!isNormalQcRework && values.qualityScore !== undefined ? { qualityScore: values.qualityScore } : {}),
        ...(values.attachments !== undefined ? { attachments: values.attachments } : {}),
        ...(state?.collaboration?.participationId && state.collaboration.revision
          ? {
              expectedParticipationId: state.collaboration.participationId,
              expectedCollaborationRevision: state.collaboration.revision
            }
          : {})
      };
      const result = await sampleRoomApi.completeScan(token, payload);
      setState(result.state);
      messageApi.success(
        state?.stage === "qc_delivery" && values.qualityResult === "qualified"
            ? "组检合格，订单已完成。"
            : state?.stage === "qc_delivery" && values.qualityResult === "rework"
              ? "返工已记录，订单等待复检。"
              : "工序已完成"
      );
      form.resetFields();
      setQcSamplePhotos([]);
      setQcMeasurementPhotos([]);
    } catch (completeError) {
      const text = completeError instanceof Error ? completeError.message : "完成失败";
      setError(text);
      if (text === "订单已终止") {
        setSubmitTerminated(true);
        messageApi.error(text);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitCompletion = (values: CompleteFormValues) => {
    if (state?.stage === "qc_delivery" && state.allowedAction === "complete") {
      if (qcSamplePhotos.length === 0) {
        messageApi.error(values.qualityResult === "rework" ? "请至少上传一张问题照片" : "请至少上传一张 QC 照片");
        return;
      }
      if (values.qualityResult === "rework" && !values.note?.trim()) {
        messageApi.error("需要返工时必须填写返工原因");
        return;
      }
      const isRework = values.qualityResult === "rework";
      Modal.confirm({
        title: isRework ? "确认需要返工？" : "确认合格并完成？",
        content: isRework
          ? `实收件数：${values.pieces ?? "未填写"} 件；返工原因：${values.note?.trim() ?? "未填写"}。提交后记录本次返工，订单继续等待复检，不会进入已完成。`
          : `实收件数：${values.pieces ?? "未填写"} 件；质量评分：${values.qualityScore ?? "未填写"} 分。提交后订单进入已完成。`,
        okText: isRework ? "确认返工" : "确认完成",
        cancelText: "返回核对",
        onOk: () => completeTask({
          ...values,
          attachments: [...qcSamplePhotos, ...qcMeasurementPhotos]
        })
      });
      return;
    }
    if (state?.stage === "qc_delivery") {
      if (qcSamplePhotos.length === 0) {
        messageApi.error("请至少上传一张样衣照片");
        return;
      }
      if (values.qualityResult !== "qualified" && !values.note?.trim()) {
        messageApi.error("需返工或不合格时必须填写备注");
        return;
      }
      Modal.confirm({
        title: "确认组检/出库结果？",
        content: `样衣评分：${values.qualityScore ?? "未填写"} 分；实收件数：${values.pieces ?? "未填写"} 件。提交后将完成实体生产。`,
        okText: "确认完成",
        cancelText: "返回核对",
        onOk: () => completeTask({ ...values, attachments: [...qcSamplePhotos, ...qcMeasurementPhotos] })
      });
      return;
    }
    if (state?.stage !== "sewing") {
      return completeTask(values);
    }
    Modal.confirm({
      title: "确认完成缝制？",
      content: state.collaboration?.currentParticipantCount && state.collaboration.currentParticipantCount > 1
        ? `完成件数：${values.pieces ?? state.defaultPieces ?? "未填写"}；系统会结合其他协作者的实际提交判断是否进入组检。`
        : `完成件数：${values.pieces ?? state.defaultPieces ?? "未填写"}；提交后订单将进入组检。`,
      okText: "确认完成",
      cancelText: "返回核对",
      onOk: () => completeTask(values)
    });
  };

  const takeoverTask = async () => {
    if (!token || !takeoverReason.trim() || !takeoverExpectedWorkerId) return;
    setSubmitting(true);
    try {
      const result = await sampleRoomApi.takeoverSewingScan(
        token,
        takeoverReason.trim(),
        takeoverExpectedWorkerId
      );
      setState(result.state);
      setTakeoverOpen(false);
      setTakeoverReason("");
      setTakeoverExpectedWorkerId("");
      messageApi.success("已接替缝制任务，接替原因已记录");
    } catch (takeoverError) {
      setError(takeoverError instanceof Error ? takeoverError.message : "接替失败");
      await loadState();
    } finally {
      setSubmitting(false);
    }
  };

  const joinCollaboration = async () => {
    if (!token || !state) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await sampleRoomApi.joinCollaborativeSewingScan(
        token,
        state.collaboration?.revision ?? ""
      );
      setState(result.state);
      setCollaborationOpen(false);
      messageApi.success("已加入多人协作缝制");
      if (result.state.defaultPieces !== undefined) form.setFieldValue("pieces", result.state.defaultPieces);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "加入协作失败");
      await loadState();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="worker-token-page">
      {contextHolder}
      <Card className="section-card worker-token-card">
        <Space direction="vertical" size={16} className="full-width">
          {loading ? <Alert type="info" message="正在读取订单扫码状态..." /> : null}
          {error ? <Alert type="error" showIcon message={error} /> : null}

          {state ? (
            <Space direction="vertical" size={12} className="full-width">
              <div>
                <Typography.Title level={3}>
                  {state.worker ? `${state.worker.stageLabel} / ${state.worker.name}` : "未登录生产员工"}
                </Typography.Title>
                {state.worker ? (
                  <Typography.Text type="secondary">账号身份与当前生产岗位已由服务端确认</Typography.Text>
                ) : (
                  <Typography.Text type="secondary">
                    请先登录有效的生产员工账号。
                  </Typography.Text>
                )}
              </div>

              <Card size="small" className="scan-summary-card">
                <Space direction="vertical" size={8} className="full-width">
                  {state.worker ? (
                    <Tag color={statusColor(state.allowedAction)}>{state.stageLabel ?? state.worker.stageLabel}</Tag>
                  ) : null}
                  {state.order.thumbnailUrl ? (
                    <Image src={state.order.thumbnailUrl} alt={`${state.order.styleNo} 缩略图`} width={160} preview={false} />
                  ) : null}
                  <Typography.Title level={4}>{state.order.styleNo}</Typography.Title>
                  <Typography.Text>{state.order.styleName}</Typography.Text>
                  <Typography.Text type="secondary">客户：{state.order.customerName}</Typography.Text>
                  <Typography.Text type="secondary">客户业务员：{state.order.salespersonName}</Typography.Text>
                  <Typography.Text type="secondary">数量：{state.order.quantity}</Typography.Text>
                </Space>
              </Card>

              {submitTerminated ? (
                <Alert
                  showIcon
                  type="warning"
                  message="订单已终止"
                  description="5 秒后自动返回当前角色界面，也可以立即返回。"
                />
              ) : <Alert showIcon {...stateMessage(state)} />}

              {state.patternTaskWarning ? (
                <Alert
                  type="warning"
                  showIcon
                  message={state.patternTaskWarning.unclaimed ? "综合版师任务尚未领取" : "综合版师任务尚未完成"}
                  description={(
                    <Space direction="vertical" size={2}>
                      <Typography.Text>综合任务状态：<Tag>{state.patternTaskWarning.status}</Tag></Typography.Text>
                      <Typography.Text>负责人：{state.patternTaskWarning.unclaimed ? "未领取" : state.patternTaskWarning.patternMakerName ?? "已领取（姓名待同步）"}</Typography.Text>
                      <Typography.Text>未完成要求：{state.patternTaskWarning.unfinishedRequirements.map((item) => sampleRequestItemLabel.get(item) ?? item).join("、") || "状态待确认"}</Typography.Text>
                      <Typography.Text type="secondary">此提示不阻断当前实体工序。</Typography.Text>
                    </Space>
                  )}
                />
              ) : null}

              {state.activeTask ? (
                <Typography.Text type="secondary">
                  已开始：{state.activeTask.stageLabel} / {state.activeTask.workerName} ·{" "}
                  {formatTime(state.activeTask.startedAt)}
                </Typography.Text>
              ) : null}

              {!submitTerminated && state.allowedAction === "start" ? (
                <Button type="primary" size="large" loading={submitting} onClick={confirmStartTask} block>
                  {scanActionButtonLabel(state.stage, "start")}
                </Button>
              ) : null}

              {!submitTerminated && state.allowedAction === "takeover" ? (
                <Button danger size="large" loading={submitting} onClick={() => {
                  setTakeoverExpectedWorkerId(state.activeTask?.workerId ?? "");
                  setTakeoverOpen(true);
                }} block>
                  确认并接替缝制任务
                </Button>
              ) : null}

              {!submitTerminated && state.allowedAction === "choose_sewing_assignment" ? (
                <Space direction="vertical" className="full-width">
                  <Button danger size="large" loading={submitting} onClick={() => {
                    setTakeoverExpectedWorkerId(state.activeTask?.workerId ?? "");
                    setTakeoverOpen(true);
                  }} block>
                    替代当前缝制工
                  </Button>
                  <Button type="primary" size="large" loading={submitting} onClick={() => {
                    setCollaborationOpen(true);
                  }} block>
                    加入协作
                  </Button>
                </Space>
              ) : null}

              {!submitTerminated && state.allowedAction === "join_collaboration" ? (
                <Button type="primary" size="large" loading={submitting} onClick={() => {
                  setCollaborationOpen(true);
                }} block>
                  加入协作
                </Button>
              ) : null}

              {state.stage === "qc_delivery" && state.allowedAction === "complete" ? (
                <QcInspectionPanel
                  state={state}
                  submitting={submitting}
                  previousRework={state.latestRework ? {
                    note: state.latestRework.note,
                    eventTime: state.latestRework.eventTime,
                    photos: state.latestRework.photos,
                    photoUrl: (photo) => state.latestRework!.photos.find((item) => item.id === photo.id)?.previewUrl ?? ""
                  } : undefined}
                  onSubmit={(values) => {
                    const { note, qualityScore, ...required } = values;
                    return completeTask({
                      ...required,
                      ...(note !== undefined ? { note } : {}),
                      ...(qualityScore !== undefined ? { qualityScore } : {})
                    });
                  }}
                />
              ) : null}

              {!submitTerminated && state.allowedAction === "complete" &&
              !(state.stage === "qc_delivery" && state.allowedAction === "complete") ? (
                <Form
                  form={form}
                  layout="vertical"
                  requiredMark={false}
                  onFinish={(values) => void submitCompletion(values)}
                  initialValues={{ pieces: state.defaultPieces, attachments: [] }}
                >
                   {state.stage !== "qc_delivery" ? (
                     <Form.Item
                       label="工时"
                       name="workHours"
                       rules={[{ required: true, message: "请输入工时" }]}
                     >
                       <Input
                         type="number"
                         min={0}
                         step="any"
                         inputMode="decimal"
                         className="full-width"
                         addonAfter="小时"
                       />
                     </Form.Item>
                   ) : null}
                   {state.stage === "cutting" || state.stage === "sewing" ? (
                     <Form.Item label="完成件数" name="pieces" rules={[{ required: true, message: "请输入完成件数" }]}>
                       <InputNumber {...integerInputProps} min={state.stage === "sewing" ? 1 : 0} precision={0} className="full-width" />
                    </Form.Item>
                  ) : null}
                  {state.stage === "qc_delivery" ? (
                    <>
                      <Form.Item
                        label="质量结果"
                        name="qualityResult"
                        rules={[{ required: true, message: "请选择质量结果" }]}
                      >
                        <Select options={[
                          { label: "合格并完成", value: "qualified" },
                          { label: "需要返工", value: "rework" }
                        ]} onChange={(value) => {
                          if (value === "rework" && state.allowedAction === "complete") {
                            form.setFieldValue("qualityScore", undefined);
                          }
                        }} />
                      </Form.Item>
                      {!isNormalQcRework ? (
                        <Form.Item
                          label="质量评分（0-100分）"
                          name="qualityScore"
                          rules={[
                            { required: true, message: "请输入质量评分" },
                            {
                              validator: (_rule, value) =>
                                value === undefined || (Number.isInteger(value) && value >= 0 && value <= 100)
                                  ? Promise.resolve()
                                  : Promise.reject(new Error("质量评分必须是 0-100 的整数"))
                            }
                          ]}
                        >
                          <InputNumber {...integerInputProps} min={0} max={100} precision={0} className="full-width" />
                        </Form.Item>
                      ) : null}
                      <Form.Item
                        label="实收件数"
                        name="pieces"
                        rules={[{ required: true, message: "请输入实收件数" }]}
                      >
                        <InputNumber {...integerInputProps} min={0} precision={0} className="full-width" />
                      </Form.Item>
                      <Form.Item
                        label={isNormalQcRework ? "问题照片" : "QC 照片"}
                        required
                        extra={isNormalQcRework ? "至少一张，用于记录返工问题" : "至少一张，用于组检完成留证"}
                      >
                        <ClientAttachmentPicker
                          value={qcSamplePhotos}
                          onChange={(files) => setQcSamplePhotos(files.filter((file) => file.mimeType.startsWith("image/")))}
                          defaultCategory="qc_sample_photo"
                          defaultVisibility="internal_only"
                          accept="image/*"
                          title={isNormalQcRework ? "拍摄或选择问题照片" : "拍摄或选择 QC 照片"}
                          description="仅图片；至少一张。"
                        />
                      </Form.Item>
                      <Form.Item label="尺寸表照片（可选）" extra="最多一张；与样衣照片分开归档">
                        <ClientAttachmentPicker
                          value={qcMeasurementPhotos}
                          onChange={(files) => setQcMeasurementPhotos(files.filter((file) => file.mimeType.startsWith("image/")).slice(-1))}
                          defaultCategory="qc_measurement_photo"
                          defaultVisibility="internal_only"
                          accept="image/*"
                          title="拍摄或选择尺寸表照片"
                          description="仅图片；最多一张。"
                        />
                      </Form.Item>
                    </>
                  ) : null}
                  <Form.Item
                    label={state.stage === "qc_delivery" && qualityResult === "rework" ? "返工原因" : "备注"}
                    name="note"
                    dependencies={["qualityResult"]}
                    rules={[
                      ({ getFieldValue }) => ({
                        required:
                          state.stage === "cutting" ||
                          state.stage === "sewing" ||
                          (state.stage === "qc_delivery" && getFieldValue("qualityResult") === "rework"),
                        whitespace: true,
                        message: state.stage === "qc_delivery" ? "请填写返工原因" : "请填写备注"
                      })
                    ]}
                  >
                    <Input.TextArea
                      rows={3}
                      placeholder={state.stage === "qc_delivery" ? "合格时可不填；返工时必须填写原因" : "请填写完成备注"}
                    />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={submitting} block>
                    {scanActionButtonLabel(state.stage, "complete")}
                  </Button>
                </Form>
              ) : null}

              {submitTerminated || state.blockedReason === "wrong_stage" || state.blockedReason === "terminated" ? (
                <Button type="primary" onClick={returnToRoleHome} block>立即返回</Button>
              ) : null}

              <Button onClick={() => void loadState()} block>
                刷新状态
              </Button>
            </Space>
          ) : null}
        </Space>
      </Card>
      <Modal
        title="接替缝制任务"
        open={takeoverOpen}
        okText="确认接替"
        cancelText="取消"
        confirmLoading={submitting}
        okButtonProps={{ danger: true, disabled: !takeoverReason.trim() }}
        onOk={() => void takeoverTask()}
        onCancel={() => { setTakeoverOpen(false); setTakeoverReason(""); setTakeoverExpectedWorkerId(""); }}
      >
        <Alert type="warning" showIcon message="接替会保留原员工记录，并将当前缝制任务转到你名下。" />
        <Input.TextArea
          className="scan-takeover-reason"
          rows={3}
          value={takeoverReason}
          onChange={(event) => setTakeoverReason(event.target.value)}
          placeholder="必填：为什么需要接替"
        />
      </Modal>
      <Modal
        title="加入多人协作"
        open={collaborationOpen}
        okText="确认协作"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => void joinCollaboration()}
        onCancel={() => setCollaborationOpen(false)}
      >
        <Space direction="vertical" className="full-width">
          <Alert type="info" showIcon message="加入后请在完成时填写自己的实际件数；计划件数由计划员单独协调。" />
        </Space>
      </Modal>
    </div>
  );
}
