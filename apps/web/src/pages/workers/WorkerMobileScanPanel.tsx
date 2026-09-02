import { CloseOutlined, QrcodeOutlined } from "@ant-design/icons";
import { Modal } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { sampleRoomApi, type ScanPageState } from "../../api/sampleRoomApi";

type WorkerMobileScanPanelProps = {
  token: string;
  onClose: () => void;
  onDone: (message: string) => void;
  onOpenAssignedSewingTask?: (state: ScanPageState) => boolean | Promise<boolean>;
};

function actionTitle(state: ScanPageState) {
  if (state.blockedReason === "SEWING_ROUND_ALREADY_COMPLETED") return "你已完成本轮缝制";
  if (state.blockedReason === "terminated") return "订单已终止";
  if (state.blockedReason === "wrong_stage") {
    return state.message || `当前订单待${state.stageLabel || "对应工序"}`;
  }
  if (state.blockedReason === "previous_unfinished") return "上一工序尚未完成";
  if (state.blockedReason === "other_worker_started") return "该工序已由其他员工开始";
  if (state.blockedReason === "done") return "实体生产已完成";
  if (state.allowedAction === "takeover") return "需要接替缝制任务";
  if (state.allowedAction === "choose_sewing_assignment") return "选择接替或协作";
  if (state.allowedAction === "join_collaboration") return "加入多人协作";
  if (state.stage === "cutting" && state.allowedAction === "complete") return "登记裁剪完成";
  if (state.stage === "sewing" && state.allowedAction === "start") return "开始缝制";
  if (state.stage === "sewing" && state.allowedAction === "complete") return "完成缝制";
  return state.message || "当前订单不能处理";
}

function actionDescription(state: ScanPageState) {
  if (state.blockedReason === "SEWING_ROUND_ALREADY_COMPLETED") {
    return state.message || "本轮成果已经提交，不能重复加入或再次提交。";
  }
  if (state.blockedReason === "previous_unfinished" && state.activeTask) {
    return `${state.activeTask.stageLabel} / ${state.activeTask.workerName} 已经开始，请先完成上一工序。`;
  }
  if (state.blockedReason === "other_worker_started" && state.activeTask) {
    return `${state.activeTask.stageLabel} / ${state.activeTask.workerName} 已经接下该任务。`;
  }
  if (state.allowedAction === "takeover" && state.activeTask) {
    return `${state.activeTask.workerName} 正在处理。只有确需接替时才继续，系统会保留接替记录。`;
  }
  if (state.allowedAction === "choose_sewing_assignment") {
    return "选择接替会替换当前负责人；选择协作会保留现有负责人，并按认领件数共同完成。";
  }
  if (state.allowedAction === "join_collaboration") {
    return `当前已有 ${state.collaboration?.currentParticipantCount ?? 2} 名有效参与者，确认后可直接加入协作。`;
  }
  if (state.stage === "cutting" && state.allowedAction === "complete") {
    return "裁剪不需要先开始扫码，完成后登记件数和工时；填写完整后直接提交。";
  }
  if (state.stage === "sewing" && state.allowedAction === "start") {
    return "点击下方按钮后任务会立即记录到你的名下；之后可从“缝制中”或再次扫码录入完成结果。";
  }
  if (state.stage === "sewing" && state.allowedAction === "complete") {
    return "填写完成件数和工时后直接提交；备注选填。";
  }
  return state.message || "请返回后扫描其他订单二维码。";
}

function stageClass(state: ScanPageState) {
  if (state.allowedAction === "blocked") return "is-warning";
  if (state.allowedAction === "takeover") return "is-warning";
  if (state.allowedAction === "choose_sewing_assignment") return "is-warning";
  return "is-ready";
}

export function WorkerMobileScanPanel({
  token,
  onClose,
  onDone,
  onOpenAssignedSewingTask
}: WorkerMobileScanPanelProps) {
  const [state, setState] = useState<ScanPageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pieces, setPieces] = useState("");
  const [workHours, setWorkHours] = useState("");
  const [note, setNote] = useState("");
  const [takeoverReason, setTakeoverReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await sampleRoomApi.getScanState(token);
      if (!result.state) throw new Error("订单扫码状态不可用");
      const nextState = result.state;
      if (
        nextState.stage === "sewing" &&
        nextState.allowedAction === "complete" &&
        nextState.startedByCurrentWorker &&
        onOpenAssignedSewingTask &&
        await onOpenAssignedSewingTask(nextState)
      ) {
        return;
      }
      setState(nextState);
      if (nextState.defaultPieces !== undefined) {
        setPieces(String(nextState.defaultPieces));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法读取订单扫码状态");
    } finally {
      setLoading(false);
    }
  }, [onOpenAssignedSewingTask, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const canComplete = useMemo(() => {
    const numericPieces = Number(pieces);
    const numericHours = Number(workHours);
    return (
      pieces.trim() !== "" &&
      Number.isInteger(numericPieces) &&
      numericPieces >= ((state?.collaboration?.currentParticipantCount ?? 0) > 1 ? 0 : 1) &&
      workHours.trim() !== "" &&
      Number.isFinite(numericHours) &&
      numericHours > 0
    );
  }, [pieces, state?.collaboration?.currentParticipantCount, workHours]);

  const submitStartSewing = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await sampleRoomApi.startScan(token);
      onDone("已开始缝制任务");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "开始失败");
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const submitCompleteTask = async () => {
    if (submitting) return;
    if (!canComplete) {
      setError("请填写完成件数和工时。");
      return;
    }

    const stage = state?.stage;
    setSubmitting(true);
    setError(null);
    try {
      await sampleRoomApi.completeScan(token, {
        pieces: Number(pieces),
        workHours: Number(workHours),
        ...(state?.collaboration?.participationId && state.collaboration.revision
          ? {
              expectedParticipationId: state.collaboration.participationId,
              expectedCollaborationRevision: state.collaboration.revision
            }
          : {}),
        ...(note.trim() ? { note: note.trim() } : {})
      });
      onDone(stage === "cutting" ? "裁剪完成已登记" : "缝制完成已登记");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交失败");
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const submitTakeoverSewing = async () => {
    const expectedWorkerId = state?.activeTask?.workerId;
    if (!expectedWorkerId || !takeoverReason.trim()) {
      setError("请填写接替原因。");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await sampleRoomApi.takeoverSewingScan(
        token,
        takeoverReason.trim(),
        expectedWorkerId
      );
      onDone("已接替缝制任务");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "接替失败");
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const submitJoinCollaboration = async () => {
    const expectedCollaborationRevision = state?.collaboration?.revision;
    if (!expectedCollaborationRevision) {
      setError("协作状态已变化，请刷新后重试。");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await sampleRoomApi.joinCollaborativeSewingScan(
        token,
        expectedCollaborationRevision
      );
      onDone("已加入多人协作缝制");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "加入协作失败");
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const takeoverSewing = () => {
    const expectedWorkerId = state?.activeTask?.workerId;
    if (!expectedWorkerId || !takeoverReason.trim()) {
      setError("请填写接替原因。");
      return;
    }

    Modal.confirm({
      title: "确认接替当前缝制任务？",
      content: "系统会保留原员工和接替原因。",
      okText: "确认接替",
      cancelText: "取消",
      centered: true,
      zIndex: 4200,
      okButtonProps: { danger: true },
      onOk: submitTakeoverSewing
    });
  };

  return (
    <div
      className="worker-mobile-action-layer"
      role="dialog"
      aria-modal="true"
      aria-label="订单扫码操作"
    >
      <header className="worker-mobile-action-topbar">
        <button
          type="button"
          className="worker-mobile-icon-button worker-mobile-icon-button-light"
          onClick={onClose}
          aria-label="返回"
        >
          <CloseOutlined />
        </button>
        <div>
          <span>订单扫码</span>
          <strong>
            {state?.worker
              ? `${state.worker.stageLabel} · ${state.worker.name}`
              : "正在确认员工身份"}
          </strong>
        </div>
        <button
          type="button"
          className="worker-mobile-text-button-light"
          disabled={loading || submitting}
          onClick={() => void load()}
        >
          刷新
        </button>
      </header>

      <div className="worker-mobile-action-content">
        {loading ? (
          <div className="worker-mobile-loading worker-mobile-action-loading">
            正在读取订单状态…
          </div>
        ) : null}
        {error ? <div className="worker-mobile-error">{error}</div> : null}

        {state ? (
          <>
            <section className="worker-mobile-scan-order-card">
              <div className="worker-mobile-scan-order-thumb">
                {state.order.thumbnailUrl ? (
                  <img
                    src={state.order.thumbnailUrl}
                    alt={`${state.order.styleNo} 缩略图`}
                  />
                ) : (
                  <span>样衣</span>
                )}
              </div>
              <div className="worker-mobile-scan-order-copy">
                <span className={`worker-mobile-stage-pill ${stageClass(state)}`}>
                  {state.stageLabel || "待处理"}
                </span>
                <h2>{state.order.styleNo || "未录入款号"}</h2>
                <p>{state.order.styleName || "-"}</p>
                <span>数量：{state.order.quantity}</span>
              </div>
            </section>

            <section className={`worker-mobile-state-card ${stageClass(state)}`}>
              <strong>{actionTitle(state)}</strong>
              <p>{actionDescription(state)}</p>
            </section>

            {state.allowedAction === "start" && state.stage === "sewing" ? (
              <button
                type="button"
                className="worker-mobile-primary-button"
                disabled={submitting}
                onClick={() => void submitStartSewing()}
              >
                <QrcodeOutlined /> {submitting ? "正在提交…" : "确认开始缝制"}
              </button>
            ) : null}

            {state.allowedAction === "complete" &&
            (state.stage === "cutting" || state.stage === "sewing") ? (
              <section className="worker-mobile-form-card">
                <label>
                  <span>完成件数</span>
                  <input
                    inputMode="numeric"
                    type="number"
                    min="0"
                    step="1"
                    value={pieces}
                    onChange={(event) => {
                      setPieces(event.target.value);
                      setError(null);
                    }}
                    placeholder="请输入完成件数"
                  />
                </label>
                <label>
                  <span>工时（小时）</span>
                  <input
                    inputMode="decimal"
                    type="number"
                    min="0"
                    step="0.1"
                    value={workHours}
                    onChange={(event) => {
                      setWorkHours(event.target.value);
                      setError(null);
                    }}
                    placeholder="例如 1.5"
                  />
                </label>
                <label>
                  <span>备注（选填）</span>
                  <textarea
                    rows={3}
                    value={note}
                    onChange={(event) => {
                      setNote(event.target.value);
                      setError(null);
                    }}
                    placeholder="有异常或需要说明时填写"
                  />
                </label>
                <button
                  type="button"
                  className="worker-mobile-primary-button"
                  disabled={submitting || !canComplete}
                  onClick={() => void submitCompleteTask()}
                >
                  {submitting
                    ? "正在提交…"
                    : state.stage === "cutting"
                      ? "确认完成裁剪"
                      : "确认完成缝制"}
                </button>
              </section>
            ) : null}

            {(state.allowedAction === "takeover" ||
              state.allowedAction === "choose_sewing_assignment") &&
            state.stage === "sewing" ? (
              <section className="worker-mobile-form-card worker-mobile-takeover-card">
                <label>
                  <span>接替原因</span>
                  <textarea
                    rows={3}
                    value={takeoverReason}
                    onChange={(event) => setTakeoverReason(event.target.value)}
                    placeholder="必填：为什么需要接替"
                  />
                </label>
                <button
                  type="button"
                  className="worker-mobile-danger-button"
                  disabled={submitting || !takeoverReason.trim()}
                  onClick={takeoverSewing}
                >
                  {submitting ? "正在提交…" : "确认并接替缝制任务"}
                </button>
              </section>
            ) : null}

            {(state.allowedAction === "choose_sewing_assignment" ||
              state.allowedAction === "join_collaboration") &&
            state.stage === "sewing" ? (
              <section className="worker-mobile-form-card">
                <p className="worker-mobile-muted">
                  加入后请在完成时填写自己的实际件数；计划件数由计划员单独协调。
                </p>
                <button
                  type="button"
                  className="worker-mobile-primary-button"
                  disabled={submitting}
                  onClick={() => void submitJoinCollaboration()}
                >
                  {submitting ? "正在提交…" : "确认加入协作"}
                </button>
              </section>
            ) : null}

            {state.allowedAction === "blocked" ? (
              <button
                type="button"
                className="worker-mobile-secondary-button"
                onClick={onClose}
              >
                返回工作台
              </button>
            ) : null}

            <p className="worker-mobile-safety-note worker-mobile-action-note">
              本页面只显示当前工序需要的信息，不展示客户、业务员、附件、价格、成本或内部管理数据。
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
