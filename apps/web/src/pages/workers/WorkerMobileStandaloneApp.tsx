import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DevSession } from "../../app/DevSessionContext";
import sampleRoomOsMark from "../../assets/sample-room-os-mark.svg";
import {
  toWorkerMobileSession,
  workerMobileLiteApi,
  type WorkerMobileSewingTask
} from "./workerMobileLiteApi";
import { findOwnedSewingTaskForScan } from "./workerMobileSewingScanRouting";
import "./workerMobile.css";
import "./workerMobilePolished.css";
import "./workerMobileStandalone.css";

const LazyWorkerMobilePerformanceSheet = lazy(() =>
  import("./WorkerMobilePerformanceSheet").then((module) => ({
    default: module.WorkerMobilePerformanceSheet
  }))
);

const LazyWorkerMobileScanPanel = lazy(() =>
  import("./WorkerMobileScanPanel").then((module) => ({
    default: module.WorkerMobileScanPanel
  }))
);

type WorkerType = "cutting" | "sewing";

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

function QrIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h6v6H4V4Zm2 2v2h2V6H6Zm8-2h6v6h-6V4Zm2 2v2h2V6h-2ZM4 14h6v6H4v-6Zm2 2v2h2v-2H6Zm8-2h2v2h-2v-2Zm4 0h2v4h-2v-4Zm-4 4h4v2h-4v-2Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 9 9 9.01 9.01 0 0 0-9-9Zm0 16a7 7 0 1 1 7-7 7.01 7.01 0 0 1-7 7Zm1-12h-2v6l5 3 1-1.73-4-2.27V7Z" />
    </svg>
  );
}

function PerformanceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19h16v2H2V3h2v16Zm3-2H5v-5h2v5Zm4 0H9V8h2v9Zm4 0h-2v-7h2v7Zm4 0h-2V5h2v12Z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 4H5v16h5v-2H7V6h3V4Zm8.59 7-3.3-3.29 1.42-1.42L22.41 12l-5.7 5.71-1.42-1.42 3.3-3.29H10v-2h8.59Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6.7 5.3 5.3 5.29 5.3-5.3 1.4 1.42-5.29 5.3 5.3 5.29-1.42 1.4-5.3-5.29-5.29 5.3-1.4-1.42 5.29-5.3-5.3-5.29L6.7 5.3Z" />
    </svg>
  );
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

    async function startCamera() {
      const video = videoRef.current;
      if (!video) return;
      try {
        // Keep ZXing out of the initial H5 bundle. It is downloaded only after the user taps Scan.
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (!active) return;
        const reader = new BrowserQRCodeReader();
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
          className="worker-mobile-icon-button worker-mobile-icon-button-light worker-mobile-lite-icon"
          onClick={onClose}
          aria-label="关闭扫码"
        >
          <CloseIcon />
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
  task: WorkerMobileSewingTask;
  sampleType: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="worker-mobile-task-card" onClick={onOpen}>
      <div className="worker-mobile-task-thumb" aria-hidden={!task.thumbnailUrl}>
        {task.thumbnailUrl ? <img src={task.thumbnailUrl} alt={`${task.styleNo} 缩略图`} /> : <span>样衣</span>}
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
          <span className="worker-mobile-lite-inline-icon"><ClockIcon /></span>
          <span>接单 {formatDateTime(task.startedAt)} · 已接单 {elapsedLabel(task.startedAt)}</span>
        </div>
        {task.previousReworkReason ? (
          <div className="worker-mobile-rework">上一轮返工：{task.previousReworkReason}</div>
        ) : null}
      </div>
      <span className="worker-mobile-chevron" aria-hidden="true">›</span>
    </button>
  );
}

function LoadingShell({ message = "正在进入工作台…" }: { message?: string }) {
  return (
    <main className="worker-mobile-lite-boot">
      <div className="worker-mobile-lite-boot-brand">
        <img src={sampleRoomOsMark} alt="" aria-hidden="true" />
        <div>
          <strong>Sample Room OS</strong>
        </div>
      </div>
      <span className="worker-mobile-lite-spinner" aria-hidden="true" />
      <p>{message}</p>
    </main>
  );
}

export function WorkerMobileStandaloneApp() {
  const [session, setSession] = useState<DevSession | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [sampleTypeLabels, setSampleTypeLabels] = useState<Record<string, string>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanToken, setScanToken] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [performanceOpen, setPerformanceOpen] = useState(false);
  const [tasks, setTasks] = useState<WorkerMobileSewingTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [taskListOpen, setTaskListOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<WorkerMobileSewingTask | null>(null);
  const [completionPieces, setCompletionPieces] = useState("");
  const [completionWorkHours, setCompletionWorkHours] = useState("");
  const [completionNote, setCompletionNote] = useState("");
  const [completionSubmitting, setCompletionSubmitting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      setBootError(null);
      try {
        const user = await workerMobileLiteApi.currentUser();
        if (!active) return;
        if (!user) {
          window.location.replace("/login");
          return;
        }
        if (user.mustChangePassword) {
          window.location.replace("/account/force-password");
          return;
        }
        if (
          user.role !== "worker" ||
          (user.activeWorkerType !== "cutting" && user.activeWorkerType !== "sewing") ||
          !user.activeWorkerProfileId
        ) {
          const target = user.homeRoute && user.homeRoute !== "/worker/mobile" ? user.homeRoute : "/login";
          window.location.replace(target);
          return;
        }

        setSession(toWorkerMobileSession(user));
        void workerMobileLiteApi.sampleTypes().then((result) => {
          if (!active) return;
          setSampleTypeLabels(Object.fromEntries(result.items.map((item) => [item.value, item.label])));
        }).catch(() => undefined);
      } catch (error) {
        if (active) setBootError(error instanceof Error ? error.message : "工作台加载失败");
      }
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, [bootAttempt]);

  const isSewing = session?.activeWorkerType === "sewing";
  const isCutting = session?.activeWorkerType === "cutting";
  const workerType = session?.activeWorkerType as WorkerType | undefined;
  const stageLabel = workerTypeLabel(workerType);

  const labelFor = useCallback(
    (code: string) => sampleTypeLabels[code] ?? (code || "-"),
    [sampleTypeLabels]
  );

  const loadTasks = useCallback(async () => {
    if (!isSewing || !session) {
      setTasks([]);
      return;
    }
    setTasksLoading(true);
    setTasksError(null);
    try {
      const result = await workerMobileLiteApi.sewingTasks();
      setTasks(result.tasks ?? []);
    } catch (error) {
      setTasksError(error instanceof Error ? error.message : "缝制任务加载失败");
    } finally {
      setTasksLoading(false);
    }
  }, [isSewing, session]);

  useEffect(() => {
    if (session) void loadTasks();
  }, [loadTasks, session]);

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

  const scanDescription = useMemo(
    () => isCutting ? "完成裁剪后扫描订单二维码" : "扫描订单二维码开始或完成任务",
    [isCutting]
  );

  const canCompleteSelectedTask = useMemo(() => {
    const pieces = Number(completionPieces);
    const hours = Number(completionWorkHours);
    return completionPieces.trim() !== "" && Number.isInteger(pieces) && pieces >= 1 &&
      completionWorkHours.trim() !== "" && Number.isFinite(hours) && hours > 0;
  }, [completionPieces, completionWorkHours]);

  const handleScanned = useCallback((raw: string) => {
    try {
      setScanToken(parseOrderQrToken(raw));
      setScanError(null);
      setScannerOpen(false);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "二维码无法识别");
      setScannerOpen(false);
    }
  }, []);

  const handleScanDone = useCallback((message: string) => {
    setScanToken(null);
    setNotice(message);
    void loadTasks();
  }, [loadTasks]);

  const openAssignedSewingTaskFromScan = useCallback(async (state: Parameters<typeof findOwnedSewingTaskForScan>[0]) => {
    let task = findOwnedSewingTaskForScan(state, tasks);
    if (!task) {
      const result = await workerMobileLiteApi.sewingTasks();
      const refreshedTasks = result.tasks ?? [];
      setTasks(refreshedTasks);
      task = findOwnedSewingTaskForScan(state, refreshedTasks);
    }
    if (!task) return false;

    setScanToken(null);
    setTaskListOpen(false);
    setSelectedTask(task);
    return true;
  }, [tasks]);

  const completeSelectedTask = async () => {
    if (!selectedTask || !canCompleteSelectedTask) {
      setCompletionError("请填写完成件数和工时。");
      return;
    }
    const confirmation = selectedTask.collaboration
      ? "确认完成缝制？\n系统会结合其他协作者的提交结果判断是否进入下一工序。"
      : "确认完成缝制？\n提交后订单将进入下一工序。";
    if (!window.confirm(confirmation)) return;

    setCompletionSubmitting(true);
    setCompletionError(null);
    try {
      await workerMobileLiteApi.completeSewingTask(selectedTask.orderId, {
        pieces: Number(completionPieces),
        workHours: Number(completionWorkHours),
        ...(completionNote.trim() ? { note: completionNote.trim() } : {})
      });
      setSelectedTask(null);
      setTaskListOpen(false);
      setNotice("缝制完成已登记");
      await loadTasks();
    } catch (error) {
      setCompletionError(error instanceof Error ? error.message : "提交失败");
    } finally {
      setCompletionSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await workerMobileLiteApi.logout();
    } finally {
      window.location.replace("/login");
    }
  };

  if (!session) {
    if (!bootError) return <LoadingShell />;
    return (
      <main className="worker-mobile-lite-boot">
        <div className="worker-mobile-lite-boot-brand">
          <img src={sampleRoomOsMark} alt="" aria-hidden="true" />
          <div><strong>Sample Room OS</strong></div>
        </div>
        <div className="worker-mobile-error">{bootError}</div>
        <button type="button" className="worker-mobile-secondary-button" onClick={() => setBootAttempt((value) => value + 1)}>
          重新加载
        </button>
      </main>
    );
  }

  return (
    <main className="worker-mobile-page worker-mobile-lite-page">
      <header className="worker-mobile-lite-header">
        <div className="worker-mobile-lite-brand">
          <img src={sampleRoomOsMark} alt="" aria-hidden="true" />
          <div><strong>Sample Room OS</strong></div>
        </div>
        <button type="button" className="worker-mobile-lite-header-button" onClick={() => void handleLogout()} aria-label="退出登录">
          <LogoutIcon />
        </button>
      </header>

      <section className="worker-mobile-content">
        <section className="worker-mobile-identity-card">
          <div className="worker-mobile-avatar">{(session.displayName || stageLabel).slice(0, 1)}</div>
          <div>
            <span className="worker-mobile-muted">{stageLabel}员工</span>
            <strong>你好呀，{session.displayName}</strong>
            <span>{isSewing ? `${tasks.length} 个任务进行中` : "完成后扫一扫即可登记"}</span>
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
          <span className="worker-mobile-scan-icon worker-mobile-lite-svg"><QrIcon /></span>
          <span className="worker-mobile-scan-copy"><strong>扫一扫</strong><span>{scanDescription}</span></span>
          <span className="worker-mobile-scan-arrow" aria-hidden="true">›</span>
        </button>

        <div className={`worker-mobile-secondary-action-grid${isCutting ? " is-single" : ""}`}>
          {isSewing ? (
            <button type="button" className="worker-mobile-secondary-action" onClick={() => setTaskListOpen(true)}>
              <span className="worker-mobile-secondary-action-icon worker-mobile-lite-svg"><ClockIcon /></span>
              <span className="worker-mobile-secondary-action-copy">
                <strong>缝制中 · {tasks.length}</strong>
                <span>{tasksLoading ? "正在刷新" : "查看当前任务"}</span>
              </span>
            </button>
          ) : null}
          <button type="button" className="worker-mobile-secondary-action" onClick={() => setPerformanceOpen(true)}>
            <span className="worker-mobile-secondary-action-icon worker-mobile-lite-svg"><PerformanceIcon /></span>
            <span className="worker-mobile-secondary-action-copy"><strong>我的绩效</strong><span>查看完成记录</span></span>
          </button>
        </div>

        {notice ? <div className="worker-mobile-notice">{notice}</div> : null}
        {scanError ? <div className="worker-mobile-error">{scanError}</div> : null}
        {tasksError && !taskListOpen ? <div className="worker-mobile-error">{tasksError}</div> : null}
      </section>

      {taskListOpen ? (
        <div className="worker-mobile-sheet-backdrop" role="presentation" onClick={() => setTaskListOpen(false)}>
          <section className="worker-mobile-sheet" role="dialog" aria-modal="true" aria-label="缝制中任务" onClick={(event) => event.stopPropagation()}>
            <div className="worker-mobile-sheet-handle" />
            <div className="worker-mobile-sheet-heading">
              <div><span className="worker-mobile-muted">当前任务</span><h2>缝制中 · {tasks.length}</h2></div>
              <div className="worker-mobile-lite-sheet-actions">
                <button type="button" onClick={() => void loadTasks()} disabled={tasksLoading}>刷新</button>
                <button type="button" onClick={() => setTaskListOpen(false)} aria-label="关闭任务列表"><CloseIcon /></button>
              </div>
            </div>
            {tasksLoading && tasks.length === 0 ? <div className="worker-mobile-loading">正在加载任务…</div> : null}
            {tasksError ? <div className="worker-mobile-error">{tasksError}</div> : null}
            {!tasksLoading && !tasksError && tasks.length === 0 ? (
              <div className="worker-mobile-empty-card"><strong>暂无缝制中的任务</strong><p>扫描待缝制订单二维码后，任务会出现在这里。</p></div>
            ) : null}
            <div className="worker-mobile-task-list">
              {tasks.map((task) => (
                <SewingTaskCard
                  key={task.orderId}
                  task={task}
                  sampleType={labelFor(task.sampleType)}
                  onOpen={() => { setTaskListOpen(false); setSelectedTask(task); }}
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
          <section className="worker-mobile-sheet" role="dialog" aria-modal="true" aria-label="缝制任务详情" onClick={(event) => event.stopPropagation()}>
            <div className="worker-mobile-sheet-handle" />
            <div className="worker-mobile-sheet-heading">
              <div><span className="worker-mobile-muted">缝制任务</span><h2>{selectedTask.styleNo || "未录入款号"}</h2><p>{selectedTask.styleName || "-"}</p></div>
              <button
                type="button"
                className="worker-mobile-lite-close-button"
                disabled={completionSubmitting}
                onClick={() => { setSelectedTask(null); setTaskListOpen(true); }}
                aria-label="关闭任务详情"
              ><CloseIcon /></button>
            </div>
            <div className="worker-mobile-sheet-grid">
              <div><span>样品类型</span><strong>{labelFor(selectedTask.sampleType)}</strong></div>
              <div><span>轮次</span><strong>{roundLabel(selectedTask.sampleRound)}</strong></div>
              <div><span>数量</span><strong>{selectedTask.quantity} 件</strong></div>
              <div><span>我的任务</span><strong>参与缝制</strong></div>
              <div><span>已接单</span><strong>{elapsedLabel(selectedTask.startedAt)}</strong></div>
            </div>
            {selectedTask.previousReworkReason ? (
              <div className="worker-mobile-sheet-rework"><span>上一轮返工</span><p>{selectedTask.previousReworkReason}</p></div>
            ) : null}
            <section className="worker-mobile-form-card">
              <label><span>完成件数</span><input inputMode="numeric" type="number" min="1" step="1" value={completionPieces} onChange={(event) => { setCompletionPieces(event.target.value); setCompletionError(null); }} /></label>
              <label><span>工时（小时）</span><input inputMode="decimal" type="number" min="0" step="0.1" value={completionWorkHours} onChange={(event) => { setCompletionWorkHours(event.target.value); setCompletionError(null); }} placeholder="例如 1.5" /></label>
              <label><span>备注（选填）</span><textarea rows={3} value={completionNote} onChange={(event) => { setCompletionNote(event.target.value); setCompletionError(null); }} placeholder="有异常或需要说明时填写" /></label>
              {completionError ? <div className="worker-mobile-error">{completionError}</div> : null}
              <button type="button" className="worker-mobile-primary-button" disabled={completionSubmitting || !canCompleteSelectedTask} onClick={() => void completeSelectedTask()}>
                {completionSubmitting ? "正在提交…" : "确认完成缝制"}
              </button>
            </section>
          </section>
        </div>
      ) : null}

      {scannerOpen ? <WorkerQrScanner onClose={() => setScannerOpen(false)} onScanned={handleScanned} /> : null}

      {scanToken ? (
        <Suspense fallback={<div className="worker-mobile-lite-lazy-layer">正在打开订单…</div>}>
          <LazyWorkerMobileScanPanel
            token={scanToken}
            onClose={() => setScanToken(null)}
            onDone={handleScanDone}
            onOpenAssignedSewingTask={openAssignedSewingTaskFromScan}
          />
        </Suspense>
      ) : null}

      {performanceOpen && workerType ? (
        <Suspense fallback={<div className="worker-mobile-lite-lazy-layer">正在加载绩效…</div>}>
          <LazyWorkerMobilePerformanceSheet open session={session} workerType={workerType} onClose={() => setPerformanceOpen(false)} />
        </Suspense>
      ) : null}
    </main>
  );
}
