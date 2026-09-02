import {
  BarChartOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  LogoutOutlined,
  QrcodeOutlined,
  ReloadOutlined
} from "@ant-design/icons";
import { Modal } from "antd";
import { BrowserQRCodeReader } from "@zxing/browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthSession } from "../../app/AuthSessionContext";
import { useDevSession } from "../../app/DevSessionContext";
import { useSampleTypeOptions } from "../../app/SampleTypeOptionsContext";
import { request } from "../../api/request";
import type { ScanPageState } from "../../api/sampleRoomApi";
import { WorkerMobilePerformanceSheet } from "./WorkerMobilePerformanceSheet";
import { WorkerMobileScanPanel } from "./WorkerMobileScanPanel";
import { findOwnedSewingTaskForScan } from "./workerMobileSewingScanRouting";
import "./workerMobile.css";
import "./workerMobilePolished.css";

type SewingTask = {
  orderId: string;
  styleNo: string;
  styleName: string;
  sampleType: string;
  sampleRound: string;
  quantity: number;
  startedAt: string;
  thumbnailUrl?: string;
  previousReworkReason?: string;
  collaboration?: boolean;
  participationId?: string;
  targetPieces?: number;
  collaborationRevision?: string;
};

type SewingTaskListResponse = {
  tasks: SewingTask[];
};

function workerTypeLabel(workerType: string | undefined) {
  if (workerType === "cutting") return "裁剪";
  if (workerType === "sewing") return "缝制";
  return "工序";
}

function roundLabel(value: string) {
  if (value === "round_1") return "第1轮";
  if (value === "round_2") return "第2轮";
  if (value === "round_3") return "第3轮";
  return value || "-";
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.replace("T", " ").slice(0, 16);
  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function elapsedLabel(value: string) {
  const startedAt = new Date(value).getTime();
  if (!Number.isFinite(startedAt)) return "-";
  const minutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60_000));
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}小时${rest}分` : `${hours}小时`;
}

function parseOrderQrToken(raw: string) {
  const value = raw.trim();
  if (value.length > 320) throw new Error("二维码内容过长");
  const parts = value.split("|");
  if (parts.length !== 3 || parts[0] !== "SRS2" || parts[1] !== "ORDER") {
    throw new Error("不是样品间订单二维码");
  }
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(parts[2] ?? "")) {
    throw new Error("订单二维码无效");
  }
  return parts[2]!;
}

function WorkerQrScanner({
  onClose,
  onScanned
}: {
  onClose: () => void;
  onScanned: (raw: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handledRef = useRef(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let controls: { stop: () => void } | undefined;
    const reader = new BrowserQRCodeReader();

    async function startCamera() {
      const video = videoRef.current;
      if (!video) return;
      try {
        controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          },
          video,
          (result) => {
            if (!active || handledRef.current || !result) return;
            handledRef.current = true;
            controls?.stop();
            onScanned(result.getText());
          }
        );
      } catch (error) {
        if (!active) return;
        setCameraError(
          error instanceof Error
            ? `无法打开相机：${error.message}`
            : "无法打开相机，请检查 Safari 相机权限。"
        );
      }
    }

    void startCamera();
    return () => {
      active = false;
      controls?.stop();
    };
  }, [onScanned]);

  return (
    <div className="worker-mobile-scanner" role="dialog" aria-modal="true" aria-label="扫描订单二维码">
      <div className="worker-mobile-scanner-bar">
        <button
          type="button"
          className="worker-mobile-icon-button worker-mobile-icon-button-light"
          onClick={onClose}
          aria-label="关闭扫码"
        >
          <CloseOutlined />
        </button>
        <strong>扫描订单二维码</strong>
        <span className="worker-mobile-scanner-spacer" />
      </div>
      <div className="worker-mobile-scanner-stage">
        <video ref={videoRef} className="worker-mobile-scanner-video" muted playsInline />
        <div className="worker-mobile-scan-frame" aria-hidden="true">
          <span className="corner corner-tl" />
          <span className="corner corner-tr" />
          <span className="corner corner-bl" />
          <span className="corner corner-br" />
        </div>
        <p className="worker-mobile-scanner-hint">将样品间订单二维码放入框内</p>
      </div>
      {cameraError ? <div className="worker-mobile-scanner-error">{cameraError}</div> : null}
    </div>
  );
}

function SewingTaskCard({
  task,
  sampleType,
  onOpen
}: {
  task: SewingTask;
  sampleType: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="worker-mobile-task-card" onClick={onOpen}>
      <div className="worker-mobile-task-thumb" aria-hidden={!task.thumbnailUrl}>
        {task.thumbnailUrl ? (
          <img src={task.thumbnailUrl} alt={`${task.styleNo} 缩略图`} />
        ) : (
          <span>样衣</span>
        )}
      </div>
      <div className="worker-mobile-task-body">
        <strong className="worker-mobile-task-title">{task.styleNo || "未录入款号"}</strong>
        <span className="worker-mobile-task-name">{task.styleName || "-"}</span>
        <div className="worker-mobile-task-meta">
          <span className="worker-mobile-tag">{sampleType}</span>
          <span className="worker-mobile-tag">{roundLabel(task.sampleRound)}</span>
          <span>数量：{task.quantity}</span>
          {task.collaboration ? <span className="worker-mobile-tag">多人协作</span> : null}
        </div>
        {task.collaboration ? (
          <div className="worker-mobile-task-time">
            我的任务：参与缝制
          </div>
        ) : null}
        <div className="worker-mobile-task-time">
          <ClockCircleOutlined />
          <span>
            接单 {formatDateTime(task.startedAt)} · 已接单 {elapsedLabel(task.startedAt)}
          </span>
        </div>
        {task.previousReworkReason ? (
          <div className="worker-mobile-rework">上一轮返工：{task.previousReworkReason}</div>
        ) : null}
      </div>
      <span className="worker-mobile-chevron" aria-hidden="true">›</span>
    </button>
  );
}

export function WorkerMobilePage() {
  const navigate = useNavigate();
  const { logout } = useAuthSession();
  const { session } = useDevSession();
  const { labelFor } = useSampleTypeOptions();

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanToken, setScanToken] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [performanceOpen, setPerformanceOpen] = useState(false);

  const [tasks, setTasks] = useState<SewingTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [taskListOpen, setTaskListOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<SewingTask | null>(null);

  const [completionPieces, setCompletionPieces] = useState("");
  const [completionWorkHours, setCompletionWorkHours] = useState("");
  const [completionNote, setCompletionNote] = useState("");
  const [completionSubmitting, setCompletionSubmitting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);

  const isSewing = session.activeWorkerType === "sewing";
  const isCutting = session.activeWorkerType === "cutting";
  const stageLabel = workerTypeLabel(session.activeWorkerType);

  const loadTasks = useCallback(async () => {
    if (!isSewing) {
      setTasks([]);
      setTasksError(null);
      return;
    }

    setTasksLoading(true);
    setTasksError(null);
    try {
      const response = await request<SewingTaskListResponse>(
        session,
        "/api/miniapp/me/sewing-tasks"
      );
      setTasks(response.tasks ?? []);
    } catch (error) {
      setTasksError(error instanceof Error ? error.message : "缝制任务加载失败");
    } finally {
      setTasksLoading(false);
    }
  }, [isSewing, session]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!selectedTask) return;
    setCompletionPieces(selectedTask.collaboration ? "" : String(selectedTask.quantity));
    setCompletionWorkHours("");
    setCompletionNote("");
    setCompletionError(null);
  }, [selectedTask]);

  const scanDescription = useMemo(() => {
    if (isCutting) return "完成裁剪后扫描订单二维码";
    return "扫描订单二维码开始或完成任务";
  }, [isCutting]);

  const canCompleteSelectedTask = useMemo(() => {
    const numericPieces = Number(completionPieces);
    const numericHours = Number(completionWorkHours);
    return (
      completionPieces.trim() !== "" &&
      Number.isInteger(numericPieces) &&
      numericPieces >= 1 &&
      completionWorkHours.trim() !== "" &&
      Number.isFinite(numericHours) &&
      numericHours > 0
    );
  }, [completionPieces, completionWorkHours]);

  const handleScanned = useCallback((raw: string) => {
    try {
      const token = parseOrderQrToken(raw);
      setScanError(null);
      setScannerOpen(false);
      setScanToken(token);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "二维码无法识别");
      setScannerOpen(false);
    }
  }, []);

  const handleScanDone = useCallback(
    (message: string) => {
      setScanToken(null);
      setNotice(message);
      void loadTasks();
    },
    [loadTasks]
  );

  const openAssignedSewingTaskFromScan = useCallback(async (state: ScanPageState) => {
    let task = findOwnedSewingTaskForScan(state, tasks);
    if (!task) {
      const response = await request<SewingTaskListResponse>(
        session,
        "/api/miniapp/me/sewing-tasks"
      );
      const refreshedTasks = response.tasks ?? [];
      setTasks(refreshedTasks);
      task = findOwnedSewingTaskForScan(state, refreshedTasks);
    }
    if (!task) return false;

    setScanToken(null);
    setTaskListOpen(false);
    setSelectedTask(task);
    return true;
  }, [session, tasks]);

  const completeSelectedTask = () => {
    if (!selectedTask || !canCompleteSelectedTask) {
      setCompletionError("请填写完成件数和工时。");
      return;
    }

    const task = selectedTask;
    Modal.confirm({
      title: "确认完成缝制？",
      content: task.collaboration
        ? "系统会结合其他协作者的提交结果，判断是否进入下一工序。"
        : "提交后订单将进入下一工序。",
      okText: "确认",
      cancelText: "取消",
      centered: true,
      zIndex: 4200,
      onOk: async () => {
        setCompletionSubmitting(true);
        setCompletionError(null);
        try {
          await request(
            session,
            `/api/miniapp/me/sewing-tasks/${encodeURIComponent(task.orderId)}/complete`,
            {
              method: "POST",
              body: JSON.stringify({
                pieces: Number(completionPieces),
                workHours: Number(completionWorkHours),
                ...(task.participationId && task.collaborationRevision
                  ? {
                      expectedParticipationId: task.participationId,
                      expectedCollaborationRevision: task.collaborationRevision
                    }
                  : {}),
                ...(completionNote.trim() ? { note: completionNote.trim() } : {})
              })
            }
          );
          setSelectedTask(null);
          setTaskListOpen(false);
          setNotice("缝制完成已登记");
          await loadTasks();
        } catch (error) {
          setCompletionError(error instanceof Error ? error.message : "提交失败");
        } finally {
          setCompletionSubmitting(false);
        }
      }
    });
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  if (!isSewing && !isCutting) {
    return (
      <main className="worker-mobile-page worker-mobile-page-centered">
        <div className="worker-mobile-empty-card">
          <strong>当前岗位未开放手机工作台</strong>
          <p>本页面仅供裁剪和缝制员工使用。</p>
          <button
            type="button"
            className="worker-mobile-secondary-button"
            onClick={() => void handleLogout()}
          >
            退出登录
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="worker-mobile-page">
      <header className="worker-mobile-topbar">
        <div>
          <span className="worker-mobile-kicker">Sample Room OS</span>
          <h1>{stageLabel}工作台</h1>
        </div>
        <button
          type="button"
          className="worker-mobile-icon-button"
          onClick={() => void handleLogout()}
          aria-label="退出登录"
        >
          <LogoutOutlined />
        </button>
      </header>

      <section className="worker-mobile-content">
        <section className="worker-mobile-identity-card">
          <div className="worker-mobile-avatar">
            {(session.displayName || stageLabel).slice(0, 1)}
          </div>
          <div>
            <span className="worker-mobile-muted">{stageLabel}员工</span>
            <strong>你好呀，{session.displayName}</strong>
            <span>今天的任务都在这里</span>
          </div>
        </section>

        <button
          type="button"
          className="worker-mobile-scan-card"
          onClick={() => {
            setScanError(null);
            setNotice(null);
            setScannerOpen(true);
          }}
        >
          <span className="worker-mobile-scan-icon">
            <QrcodeOutlined />
          </span>
          <span className="worker-mobile-scan-copy">
            <strong>扫一扫</strong>
            <span>{scanDescription}</span>
          </span>
          <span className="worker-mobile-scan-arrow" aria-hidden="true">›</span>
        </button>

        <div className={`worker-mobile-secondary-action-grid${isCutting ? " is-single" : ""}`}>
          {isSewing ? (
            <button
              type="button"
              className="worker-mobile-secondary-action"
              onClick={() => setTaskListOpen(true)}
            >
              <span className="worker-mobile-secondary-action-icon"><ClockCircleOutlined /></span>
              <span className="worker-mobile-secondary-action-copy">
                <strong>缝制中 · {tasks.length}</strong>
                <span>{tasksLoading ? "正在刷新" : "查看已接任务"}</span>
              </span>
            </button>
          ) : null}

          <button
            type="button"
            className="worker-mobile-secondary-action"
            onClick={() => setPerformanceOpen(true)}
          >
            <span className="worker-mobile-secondary-action-icon"><BarChartOutlined /></span>
            <span className="worker-mobile-secondary-action-copy">
              <strong>我的绩效</strong>
              <span>查看完成记录与效率</span>
            </span>
          </button>
        </div>

        {notice ? <div className="worker-mobile-notice">{notice}</div> : null}
        {scanError ? <div className="worker-mobile-error">{scanError}</div> : null}
        {tasksError && !taskListOpen ? (
          <div className="worker-mobile-error">{tasksError}</div>
        ) : null}
      </section>

      {taskListOpen ? (
        <div
          className="worker-mobile-sheet-backdrop"
          role="presentation"
          onClick={() => setTaskListOpen(false)}
        >
          <section
            className="worker-mobile-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="缝制中任务"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="worker-mobile-sheet-handle" />
            <div className="worker-mobile-sheet-heading">
              <div>
                <span className="worker-mobile-muted">当前任务</span>
                <h2>缝制中 · {tasks.length}</h2>
              </div>
              <div className="worker-mobile-topbar-actions">
                <button
                  type="button"
                  className="worker-mobile-icon-button worker-mobile-icon-button-dark"
                  onClick={() => void loadTasks()}
                  aria-label="刷新任务"
                >
                  <ReloadOutlined spin={tasksLoading} />
                </button>
                <button
                  type="button"
                  className="worker-mobile-icon-button worker-mobile-icon-button-dark"
                  onClick={() => setTaskListOpen(false)}
                  aria-label="关闭任务列表"
                >
                  <CloseOutlined />
                </button>
              </div>
            </div>

            {tasksLoading && tasks.length === 0 ? (
              <div className="worker-mobile-loading">正在加载任务…</div>
            ) : null}
            {tasksError ? <div className="worker-mobile-error">{tasksError}</div> : null}
            {!tasksLoading && !tasksError && tasks.length === 0 ? (
              <div className="worker-mobile-empty-card">
                <strong>暂无缝制中的任务</strong>
                <p>扫描待缝制订单二维码后，任务会出现在这里。</p>
              </div>
            ) : null}

            <div className="worker-mobile-task-list">
              {tasks.map((task) => (
                <SewingTaskCard
                  key={task.orderId}
                  task={task}
                  sampleType={labelFor(task.sampleType)}
                  onOpen={() => {
                    setTaskListOpen(false);
                    setSelectedTask(task);
                  }}
                />
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {selectedTask ? (
        <div
          className="worker-mobile-sheet-backdrop"
          role="presentation"
          onClick={() => {
            if (completionSubmitting) return;
            setSelectedTask(null);
            setTaskListOpen(true);
          }}
        >
          <section
            className="worker-mobile-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="缝制任务详情"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="worker-mobile-sheet-handle" />
            <div className="worker-mobile-sheet-heading">
              <div>
                <span className="worker-mobile-muted">缝制任务</span>
                <h2>{selectedTask.styleNo || "未录入款号"}</h2>
                <p>{selectedTask.styleName || "-"}</p>
              </div>
              <button
                type="button"
                className="worker-mobile-icon-button worker-mobile-icon-button-dark"
                disabled={completionSubmitting}
                onClick={() => {
                  setSelectedTask(null);
                  setTaskListOpen(true);
                }}
                aria-label="关闭任务详情"
              >
                <CloseOutlined />
              </button>
            </div>

            <div className="worker-mobile-sheet-grid">
              <div>
                <span>样品类型</span>
                <strong>{labelFor(selectedTask.sampleType)}</strong>
              </div>
              <div>
                <span>轮次</span>
                <strong>{roundLabel(selectedTask.sampleRound)}</strong>
              </div>
              <div>
                <span>数量</span>
                <strong>{selectedTask.quantity} 件</strong>
              </div>
              <div>
                <span>我的任务</span>
                <strong>参与缝制</strong>
              </div>
              <div>
                <span>已接单</span>
                <strong>{elapsedLabel(selectedTask.startedAt)}</strong>
              </div>
            </div>

            {selectedTask.previousReworkReason ? (
              <div className="worker-mobile-sheet-rework">
                <span>上一轮返工</span>
                <p>{selectedTask.previousReworkReason}</p>
              </div>
            ) : null}

            <section className="worker-mobile-form-card">
              <label>
                <span>完成件数</span>
                <input
                  inputMode="numeric"
                  type="number"
                  min="1"
                  step="1"
                  value={completionPieces}
                  onChange={(event) => {
                    setCompletionPieces(event.target.value);
                    setCompletionError(null);
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
                  value={completionWorkHours}
                  onChange={(event) => {
                    setCompletionWorkHours(event.target.value);
                    setCompletionError(null);
                  }}
                  placeholder="例如 1.5"
                />
              </label>
              <label>
                <span>备注（选填）</span>
                <textarea
                  rows={3}
                  value={completionNote}
                  onChange={(event) => {
                    setCompletionNote(event.target.value);
                    setCompletionError(null);
                  }}
                  placeholder="有异常或需要说明时填写"
                />
              </label>

              {completionError ? (
                <div className="worker-mobile-error">{completionError}</div>
              ) : null}

              <button
                type="button"
                className="worker-mobile-primary-button"
                disabled={completionSubmitting || !canCompleteSelectedTask}
                onClick={() => void completeSelectedTask()}
              >
                {completionSubmitting ? "正在提交…" : "确认完成缝制"}
              </button>
            </section>
          </section>
        </div>
      ) : null}

      <WorkerMobilePerformanceSheet
        open={performanceOpen}
        session={session}
        workerType={isSewing ? "sewing" : "cutting"}
        onClose={() => setPerformanceOpen(false)}
      />

      {scannerOpen ? (
        <WorkerQrScanner onClose={() => setScannerOpen(false)} onScanned={handleScanned} />
      ) : null}
      {scanToken ? (
        <WorkerMobileScanPanel
          token={scanToken}
          onClose={() => setScanToken(null)}
          onDone={handleScanDone}
          onOpenAssignedSewingTask={openAssignedSewingTaskFromScan}
        />
      ) : null}
    </main>
  );
}
