import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDevSession } from "../../app/DevSessionContext";
import {
  sampleRoomApi,
  type AttachmentAuditLog,
  type AttachmentMetadataInput,
  type OrderAttachment,
  type PatternDeliverable,
  type PatternTask,
  type PatternWorkbench
} from "../../api/sampleRoomApi";
import { ClientAttachmentPicker } from "../../components/ClientAttachmentPicker";
import { UnifiedAttachmentTable } from "../../components/attachments/UnifiedAttachmentTable";
import { attachmentUploadErrorMessage } from "../../components/attachments/attachmentErrors";
import { OrderAttachmentThumbnail } from "../../components/orders/OrderAttachmentThumbnail";
import { useVisibleAutoRefresh } from "../../hooks/useVisibleAutoRefresh";

const requirementLabels: Record<string, string> = {
  pattern_making: "制版",
  pattern_revision: "改版",
  pattern_full_size: "推全码版",
  quote_material_check: "报价核料",
  bulk_material_check: "大货核料",
  pattern_padding_amount: "充棉/绒量",
  pattern_zipper_length: "核拉链长度",
  other: "其他"
};

const allTaskCategoryOptions = Object.entries(requirementLabels).map(([value, label]) => ({ value, label }));

type CompletionValues = {
  workHours: number;
  note?: string;
};

type TaskListFilter = {
  keyword: string;
  requirement: string | null;
  timeRange: "all" | "week" | "month" | "quarter" | "custom";
  dateFrom: string;
  dateTo: string;
  customer: string | null;
  salesperson: string | null;
};

type PatternTaskListKey = "paused" | "pending" | "history";

function storedPatternPageSize(key: PatternTaskListKey) {
  const value = Number(window.localStorage.getItem(`sample-room:pattern-${key}:page-size`));
  return [10, 20, 50].includes(value) ? value : 10;
}

const emptyTaskListFilter: TaskListFilter = {
  keyword: "",
  requirement: null,
  timeRange: "all",
  dateFrom: "",
  dateTo: "",
  customer: null,
  salesperson: null
};

function taskDate(task: PatternTask) {
  return new Date(task.completedAt ?? task.updatedAt ?? task.createdAt).getTime();
}

function matchesTaskDate(task: PatternTask, filter: TaskListFilter) {
  if (filter.timeRange === "all") return true;
  const value = taskDate(task);
  if (filter.timeRange === "custom") {
    const from = filter.dateFrom ? new Date(`${filter.dateFrom}T00:00:00`).getTime() : undefined;
    const to = filter.dateTo ? new Date(`${filter.dateTo}T23:59:59`).getTime() : undefined;
    return (from === undefined || value >= from) && (to === undefined || value <= to);
  }
  const start = new Date();
  if (filter.timeRange === "week") start.setDate(start.getDate() - 7);
  if (filter.timeRange === "month") start.setMonth(start.getMonth() - 1);
  if (filter.timeRange === "quarter") start.setMonth(start.getMonth() - 3);
  return value >= start.getTime();
}

function filterPatternTasks(tasks: PatternTask[], filter: TaskListFilter) {
  const keyword = filter.keyword.trim().toLocaleLowerCase("zh-CN");
  return tasks.filter((task) => {
    const matchesKeyword = !keyword || [
      task.order.orderNo,
      task.order.styleNo,
      task.order.styleName,
      task.order.customerName,
      task.order.salespersonName,
      task.patternMakerName
    ].some((value) => value?.toLocaleLowerCase("zh-CN").includes(keyword));
    const matchesRequirement = !filter.requirement || task.requirements?.includes(filter.requirement);
    const matchesCustomer = !filter.customer || task.order.customerName === filter.customer;
    const matchesSalesperson = !filter.salesperson || task.order.salespersonName === filter.salesperson;
    return matchesKeyword && matchesRequirement && matchesCustomer && matchesSalesperson && matchesTaskDate(task, filter);
  });
}

function TaskListToolbar({
  value,
  onChange,
  tasks,
  compactSearch = false
}: {
  value: TaskListFilter;
  onChange: (value: TaskListFilter) => void;
  tasks: PatternTask[];
  compactSearch?: boolean;
}) {
  const customers = Array.from(new Set(tasks.map((task) => task.order.customerName).filter(Boolean))).map((item) => ({ label: item!, value: item! }));
  const salespeople = Array.from(new Set(tasks.map((task) => task.order.salespersonName).filter(Boolean))).map((item) => ({ label: item!, value: item! }));
  return (
    <div className={`pattern-task-list-toolbar${compactSearch ? " pattern-task-list-toolbar-compact-search" : ""}`}>
      <Input.Search
        allowClear
        value={value.keyword}
        placeholder="搜索款号、款名、订单号、客户或业务员"
        onChange={(event) => onChange({ ...value, keyword: event.target.value })}
      />
      <Select
        allowClear
        value={value.requirement}
        placeholder="全部版师任务"
        options={allTaskCategoryOptions}
        onChange={(requirement) => onChange({ ...value, requirement: requirement ?? null })}
      />
      <Select value={value.timeRange} options={[
        { label: "全部时间", value: "all" },
        { label: "本周", value: "week" },
        { label: "本月", value: "month" },
        { label: "近三月", value: "quarter" },
        { label: "自定义", value: "custom" }
      ]} onChange={(timeRange) => onChange({ ...value, timeRange })} />
      {value.timeRange === "custom" ? <>
        <Input type="date" value={value.dateFrom} onChange={(event) => onChange({ ...value, dateFrom: event.target.value })} />
        <Input type="date" value={value.dateTo} onChange={(event) => onChange({ ...value, dateTo: event.target.value })} />
      </> : null}
      <Select allowClear value={value.customer} placeholder="全部客户" options={customers} onChange={(customer) => onChange({ ...value, customer: customer ?? null })} />
      <Select allowClear value={value.salesperson} placeholder="全部客户业务员" options={salespeople} onChange={(salesperson) => onChange({ ...value, salesperson: salesperson ?? null })} />
      <Button onClick={() => onChange(emptyTaskListFilter)}>重置</Button>
    </div>
  );
}

function formatDateTime(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN") : "-";
}

function taskSummary(task: PatternTask) {
  return `${task.order.styleNo} · ${task.order.styleName}`;
}

function deliveredTaskCategories(task: PatternTask) {
  return new Set(
    task.deliverables
      .filter((deliverable) => deliverable.hasFile && deliverable.taskCategory)
      .map((deliverable) => deliverable.taskCategory!)
  );
}

function RequirementTags({ task, compact = false, showCompletionPrefix = true }: { task: PatternTask; compact?: boolean; showCompletionPrefix?: boolean }) {
  const delivered = deliveredTaskCategories(task);
  return (
    <div className={compact ? "pattern-requirement-grid pattern-requirement-grid-compact" : "pattern-requirement-grid"}>
      {(task.requirements ?? []).slice(0, 8).map((item) => {
        const complete = delivered.has(item);
        return <Tag key={item} color={showCompletionPrefix ? (complete ? "success" : "error") : "blue"}>{showCompletionPrefix ? (complete ? "✓ " : "未完成 · ") : ""}{requirementLabels[item] ?? item}</Tag>;
      })}
    </div>
  );
}

function taskInstructionText(task: PatternTask) {
  const note = task.order.taskInstructionNote?.trim() || task.note?.trim();
  if (note && /[\u3400-\u9fff]/u.test(note)) return note;
  const requirements = (task.requirements ?? []).map((item) => requirementLabels[item] ?? item).join("、");
  return `请完成${requirements || "所选版师"}任务，并上传对应交付物。`;
}

function TaskIdentity({ task }: { task: PatternTask }) {
  return (
    <Descriptions size="small" column={{ xs: 1, sm: 3, lg: 6 }}>
      <Descriptions.Item label="款号"><span className="pattern-task-identity-value" title={task.order.styleNo}>{task.order.styleNo}</span></Descriptions.Item>
      <Descriptions.Item label="款名"><span className="pattern-task-identity-value" title={task.order.styleName}>{task.order.styleName}</span></Descriptions.Item>
      <Descriptions.Item label="客户">{task.order.customerName ?? "-"}</Descriptions.Item>
      <Descriptions.Item label="客户业务员">{task.order.salespersonName ?? "-"}</Descriptions.Item>
      <Descriptions.Item label="数量">{task.order.quantity}</Descriptions.Item>
      <Descriptions.Item label="交期">{task.order.deliveryDate}</Descriptions.Item>
    </Descriptions>
  );
}

function CompactTaskMaterials({
  task,
  attachments,
  logs,
  loadPreview,
  loadDeliverablePreview,
  onRenameDeliverable,
  onDeleteDeliverable,
  onChangeDeliverableVisibility,
  currentUserId,
  currentRole,
  showAdvancedFilters = false,
  workspace = false
}: {
  task: PatternTask;
  attachments: OrderAttachment[];
  logs: AttachmentAuditLog[];
  loadPreview: (attachment: OrderAttachment) => Promise<Blob>;
  loadDeliverablePreview: (deliverable: PatternDeliverable) => Promise<Blob>;
  onRenameDeliverable: (deliverable: PatternDeliverable, displayName: string) => Promise<void>;
  onDeleteDeliverable: (deliverable: PatternDeliverable) => Promise<void> | void;
  onChangeDeliverableVisibility: (
    deliverable: PatternDeliverable,
    visibility: OrderAttachment["visibility"]
  ) => Promise<void> | void;
  currentUserId: string;
  currentRole: string;
  showAdvancedFilters?: boolean;
  workspace?: boolean;
}) {
  return (
    <UnifiedAttachmentTable
      key={task.orderId}
      attachments={attachments}
      deliverables={task.deliverables}
      logs={logs}
      currentUserId={currentUserId}
      currentRole={currentRole}
      compact
      enableBulkDelete
      workspace={workspace}
      {...(workspace ? { pageSizeStorageKey: "sample-room:pattern-current-materials:page-size" } : {})}
      showPageSizeChanger={workspace}
      loadPreview={(row) => loadPreview(row.original as OrderAttachment)}
      loadDeliverablePreview={(deliverable) =>
        loadDeliverablePreview(deliverable as PatternDeliverable)
      }
      onRenameDeliverable={(deliverable, displayName) =>
        onRenameDeliverable(deliverable as PatternDeliverable, displayName)
      }
      onDeleteDeliverable={(deliverable) =>
        Promise.resolve(onDeleteDeliverable(deliverable as PatternDeliverable))
      }
      onChangeDeliverableVisibility={(deliverable, visibility) =>
        Promise.resolve(onChangeDeliverableVisibility(deliverable as PatternDeliverable, visibility))
      }
      showAdvancedFilters={showAdvancedFilters}
    />
  );
}

export function PatternTaskWorkbenchPage() {
  const { session } = useDevSession();
  const [workbench, setWorkbench] = useState<PatternWorkbench>({ pending: [], paused: [], history: [] });
  const [attachmentsByOrder, setAttachmentsByOrder] = useState<Record<string, OrderAttachment[]>>({});
  const [attachmentLogsByOrder, setAttachmentLogsByOrder] = useState<Record<string, AttachmentAuditLog[]>>({});
  const [previewTask, setPreviewTask] = useState<PatternTask>();
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState<string>();
  const [completing, setCompleting] = useState(false);
  const [completionFiles, setCompletionFiles] = useState<AttachmentMetadataInput[]>([]);
  const [completionTaskCategory, setCompletionTaskCategory] = useState<string>();
  const [completionUploading, setCompletionUploading] = useState(false);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [versionTask, setVersionTask] = useState<PatternTask>();
  const [versionTaskCategory, setVersionTaskCategory] = useState<string>();
  const [versionFiles, setVersionFiles] = useState<AttachmentMetadataInput[]>([]);
  const [versionUploading, setVersionUploading] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState("current");
  const [pendingFilter, setPendingFilter] = useState<TaskListFilter>(emptyTaskListFilter);
  const [pausedFilter, setPausedFilter] = useState<TaskListFilter>(emptyTaskListFilter);
  const [historyFilter, setHistoryFilter] = useState<TaskListFilter>(emptyTaskListFilter);
  const [listPages, setListPages] = useState<Record<PatternTaskListKey, number>>({ paused: 1, pending: 1, history: 1 });
  const [listPageSizes, setListPageSizes] = useState<Record<PatternTaskListKey, number>>(() => ({
    paused: storedPatternPageSize("paused"),
    pending: storedPatternPageSize("pending"),
    history: storedPatternPageSize("history")
  }));
  const [form] = Form.useForm<CompletionValues>();
  const [messageApi, contextHolder] = message.useMessage();

  const refreshTaskMaterials = useCallback(async (orderId: string) => {
    const result = await sampleRoomApi.listPatternOrderAttachments(session, orderId);
    setAttachmentsByOrder((current) => ({ ...current, [orderId]: result.attachments }));
    setAttachmentLogsByOrder((current) => ({ ...current, [orderId]: result.logs }));
  }, [session]);

  const loadWorkbench = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const result = await sampleRoomApi.getPatternWorkbench(session);
      setWorkbench(result);
      if (!silent) setCompletionFiles([]);
      if (result.current) {
        if (!silent) setCompletionTaskCategory(result.current.requirements?.[0]);
        await refreshTaskMaterials(result.current.orderId);
        if (!silent) form.setFieldsValue({
          ...(result.current.totalWorkHours !== undefined ? { workHours: result.current.totalWorkHours } : {}),
          note: result.current.completionNote ?? "",
        });
      } else if (!silent) {
        form.resetFields();
      }
    } catch (error) {
      if (!silent) messageApi.error(error instanceof Error ? error.message : "版师工作台加载失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [form, messageApi, refreshTaskMaterials, session]);

  useEffect(() => {
    void loadWorkbench();
  }, [loadWorkbench]);

  useVisibleAutoRefresh(() => loadWorkbench({ silent: true }));

  useEffect(() => {
    if (!workbench.current && workbench.pending.length > 0) {
      setWorkspaceTab("pending");
    }
  }, [workbench.current, workbench.pending.length]);

  const loadTaskMaterials = async (task: PatternTask) => {
    setPreviewTask(task);
    try {
      await refreshTaskMaterials(task.orderId);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "资料加载失败");
    }
  };

  const startTask = async (task: PatternTask) => {
    setStartingId(task.id);
    try {
      await sampleRoomApi.startPatternTask(session, task.id);
      messageApi.success("任务已领取并开始；原当前任务如有未完成内容会进入未完成任务");
      setPreviewTask(undefined);
      await loadWorkbench();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "任务领取失败，可能已被其他版师领取");
    } finally {
      setStartingId(undefined);
    }
  };

  const resumeTask = async (task: PatternTask) => {
    setStartingId(task.id);
    try {
      await sampleRoomApi.resumePatternTask(session, task.id);
      messageApi.success("已恢复任务");
      await loadWorkbench();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setStartingId(undefined);
    }
  };

  const completeCurrent = async (values: CompletionValues) => {
    const task = workbench.current;
    if (!task) return;
    setCompleting(true);
    try {
      await sampleRoomApi.completePatternTask(session, task.id, {
        completedRequirements: (task.requirements ?? []).filter((requirement) =>
          task.deliverables.some((deliverable) => deliverable.hasFile && deliverable.taskCategory === requirement)
        ),
        workHours: values.workHours,
        note: values.note?.trim() ?? "",
        deliverableType: "process_note",
        attachments: []
      });
      messageApi.success("综合版师任务已完成");
      setCompletionModalOpen(false);
      setCompletionFiles([]);
      await loadWorkbench();
    } catch (error) {
      messageApi.error(attachmentUploadErrorMessage(error));
    } finally {
      setCompleting(false);
    }
  };

  const deleteDeliverable = async (orderId: string, deliverable: PatternDeliverable) => {
    await sampleRoomApi.deleteOwnPatternDeliverable(session, orderId, deliverable.id);
    await Promise.all([loadWorkbench(), refreshTaskMaterials(orderId)]);
  };

  const renameDeliverable = async (
    orderId: string,
    deliverable: PatternDeliverable,
    displayName: string
  ) => {
    await sampleRoomApi.renameOwnPatternDeliverable(
      session,
      orderId,
      deliverable.id,
      displayName
    );
    await Promise.all([loadWorkbench(), refreshTaskMaterials(orderId)]);
  };

  const changeDeliverableVisibility = async (
    orderId: string,
    deliverable: PatternDeliverable,
    visibility: OrderAttachment["visibility"]
  ) => {
    const result = await sampleRoomApi.changeOwnPatternDeliverableVisibility(
      session,
      orderId,
      deliverable.id,
      visibility
    );
    const replaceTask = (task: PatternTask) => task.id === result.task.id ? result.task : task;
    setWorkbench((current) => ({
      ...current,
      ...(current.current ? { current: replaceTask(current.current) } : {}),
      pending: current.pending.map(replaceTask),
      paused: current.paused.map(replaceTask),
      history: current.history.map(replaceTask)
    }));
    await refreshTaskMaterials(orderId);
  };

  const openVersionUpload = (task: PatternTask) => {
    setVersionTask(task);
    setVersionTaskCategory(undefined);
    setVersionFiles([]);
  };

  const uploadVersion = async () => {
    if (!versionTask || versionFiles.length === 0 || !versionTaskCategory) return;
    setVersionUploading(true);
    try {
      await sampleRoomApi.appendPatternDeliverableVersion(
        session,
        versionTask.id,
        {
          attachments: versionFiles.map((file) => ({
            ...file,
            category: "pattern_maker_upload",
            visibility: "internal_only"
          })),
          deliverableType: "pattern_file",
          taskCategory: versionTaskCategory
        }
      );
      messageApi.success("新版本已追加；V1/V2/V3 版本号由服务端顺序生成");
      setVersionTask(undefined);
      setVersionFiles([]);
      await Promise.all([loadWorkbench(), refreshTaskMaterials(versionTask.orderId)]);
    } catch (error) {
      messageApi.error(attachmentUploadErrorMessage(error));
    } finally {
      setVersionUploading(false);
    }
  };

  const requirements = workbench.current?.requirements ?? [];
  const deliveredRequirements = useMemo(
    () => new Set(
      (workbench.current?.deliverables ?? [])
        .filter((deliverable) => deliverable.hasFile && deliverable.taskCategory)
        .map((deliverable) => deliverable.taskCategory!)
    ),
    [workbench.current?.deliverables]
  );
  const blockingRequirements = requirements.filter(
    (requirement) => requirement === "pattern_making" || requirement === "pattern_revision"
  );
  const blockingRequirementsComplete = blockingRequirements.every((requirement) => deliveredRequirements.has(requirement));

  const uploadCurrentDeliverables = async () => {
    const task = workbench.current;
    if (!task || completionFiles.length === 0 || !completionTaskCategory) return;
    setCompletionUploading(true);
    try {
      await sampleRoomApi.appendPatternDeliverableVersion(session, task.id, {
        attachments: completionFiles.map((file) => ({
          ...file,
          category: "pattern_maker_upload",
          visibility: "internal_only"
        })),
        deliverableType: "pattern_file",
        taskCategory: completionTaskCategory
      });
      messageApi.success(`已上传并标记为“${requirementLabels[completionTaskCategory] ?? completionTaskCategory}”`);
      setCompletionFiles([]);
      await Promise.all([loadWorkbench(), refreshTaskMaterials(task.orderId)]);
    } catch (error) {
      messageApi.error(attachmentUploadErrorMessage(error));
    } finally {
      setCompletionUploading(false);
    }
  };

  const filteredPending = useMemo(() => filterPatternTasks(workbench.pending, pendingFilter), [pendingFilter, workbench.pending]);
  const filteredPaused = useMemo(() => filterPatternTasks(workbench.paused, pausedFilter), [pausedFilter, workbench.paused]);
  const filteredHistory = useMemo(() => filterPatternTasks(workbench.history, historyFilter), [historyFilter, workbench.history]);
  const taskOrderCell = (task: PatternTask) => (
    <button type="button" className="pattern-task-order-cell pattern-task-order-trigger" onClick={() => void loadTaskMaterials(task)}>
      <OrderAttachmentThumbnail
        order={{ id: task.orderId, attachments: task.order.attachments ?? [] }}
        loadPreview={(order, attachment) => sampleRoomApi.downloadPatternOrderAttachment(session, order.id, attachment.id)}
      />
      <div className="pattern-task-order-copy">
        <Typography.Text strong>{task.order.styleNo}</Typography.Text>
        <Typography.Text type="secondary">{task.order.styleName}</Typography.Text>
      </div>
    </button>
  );
  const pendingColumns = useMemo(() => [
    { title: "款号 / 款名", width: 360, render: (_: unknown, task: PatternTask) => taskOrderCell(task) },
    { title: "客户 / 业务员", width: 220, render: (_: unknown, task: PatternTask) => <><Typography.Text strong>{task.order.customerName ?? "-"}</Typography.Text><br /><Typography.Text type="secondary">{task.order.salespersonName ?? "-"}</Typography.Text></> },
    { title: "版师任务", width: 320, render: (_: unknown, task: PatternTask) => <RequirementTags task={task} compact showCompletionPrefix={false} /> },
    { title: "创建时间", width: 160, render: (_: unknown, task: PatternTask) => formatDateTime(task.createdAt) },
    { title: "操作", width: 190, render: (_: unknown, task: PatternTask) => <Space><Button onClick={() => void loadTaskMaterials(task)}>先看资料</Button><Button type="primary" loading={startingId === task.id} onClick={() => void startTask(task)}>开始任务</Button></Space> }
  ], [session, startingId]);

  const pausedColumns = useMemo(() => [
    ...pendingColumns.slice(0, 2),
    { title: "版师任务", width: 500, render: (_: unknown, task: PatternTask) => <RequirementTags task={task} compact /> },
    ...pendingColumns.slice(3, -1),
    { title: "操作", render: (_: unknown, task: PatternTask) => <Space><Button onClick={() => void loadTaskMaterials(task)}>查看资料</Button><Button type="primary" loading={startingId === task.id} onClick={() => void resumeTask(task)}>恢复任务</Button></Space> }
  ], [pendingColumns, startingId]);

  const historyColumns = [
    { title: "款号 / 款名", width: 360, render: (_: unknown, task: PatternTask) => taskOrderCell(task) },
    { title: "版师", width: 90, render: (_: unknown, task: PatternTask) => task.patternMakerName ?? "-" },
    { title: "要求完成", width: 420, render: (_: unknown, task: PatternTask) => <RequirementTags task={task} /> },
    { title: "工时", width: 70, render: (_: unknown, task: PatternTask) => task.totalWorkHours !== undefined ? `${task.totalWorkHours} 小时` : "-" },
    { title: "完成时间", width: 150, render: (_: unknown, task: PatternTask) => formatDateTime(task.completedAt ?? task.updatedAt) },
    { title: "操作", width: 180, render: (_: unknown, task: PatternTask) => <Space><Button onClick={() => void loadTaskMaterials(task)}>查看成果</Button><Button type="primary" onClick={() => openVersionUpload(task)}>追加新版本</Button></Space> }
  ];

  const currentTaskContent = workbench.current ? (
    <div className="pattern-current-task-grid">
      <section className="pattern-current-task-section pattern-current-order-summary">
        <Typography.Text strong className="pattern-current-panel-title">订单摘要</Typography.Text>
        <div className="pattern-current-order-summary-body">
          <OrderAttachmentThumbnail
            order={{ id: workbench.current.orderId, attachments: workbench.current.order.attachments ?? [] }}
            loadPreview={(order, attachment) => sampleRoomApi.downloadPatternOrderAttachment(session, order.id, attachment.id)}
          />
          <div className="pattern-current-order-fields">
            <div><span>款号</span><strong title={workbench.current.order.styleNo}>{workbench.current.order.styleNo}</strong></div>
            <div><span>款名</span><strong title={workbench.current.order.styleName}>{workbench.current.order.styleName}</strong></div>
            <div><span>客户</span><strong>{workbench.current.order.customerName ?? "-"}</strong></div>
            <div><span>客户业务员</span><strong>{workbench.current.order.salespersonName ?? "-"}</strong></div>
            <div><span>数量</span><strong>{workbench.current.order.quantity}</strong></div>
            <div><span>交期</span><strong>{workbench.current.order.deliveryDate}</strong></div>
            <div className="pattern-current-order-instruction"><span>任务说明</span><strong>{taskInstructionText(workbench.current)}</strong></div>
          </div>
        </div>
      </section>
      <section className="pattern-current-task-section pattern-current-materials">
        <Typography.Text strong className="pattern-current-panel-title">资料与附件</Typography.Text>
        <Space direction="vertical" size={10} className="full-width">
          <Collapse
            className="pattern-current-materials-collapse"
            size="small"
            defaultActiveKey={["materials"]}
            items={[{
              key: "materials",
              label: `资料 / 附件（${(attachmentsByOrder[workbench.current.orderId] ?? []).length + workbench.current.deliverables.length}）`,
              children: <CompactTaskMaterials
                task={workbench.current}
                attachments={attachmentsByOrder[workbench.current.orderId] ?? []}
                logs={attachmentLogsByOrder[workbench.current.orderId] ?? []}
                loadPreview={(attachment) =>
                  sampleRoomApi.downloadPatternOrderAttachment(session, workbench.current!.orderId, attachment.id)
                }
                loadDeliverablePreview={(deliverable) =>
                  sampleRoomApi.downloadPatternDeliverable(session, workbench.current!.orderId, deliverable.id)
                }
                onRenameDeliverable={(deliverable, displayName) =>
                  renameDeliverable(workbench.current!.orderId, deliverable, displayName)
                }
                onDeleteDeliverable={(deliverable) => deleteDeliverable(workbench.current!.orderId, deliverable)}
                onChangeDeliverableVisibility={(deliverable, visibility) =>
                  changeDeliverableVisibility(workbench.current!.orderId, deliverable, visibility)
                }
                currentUserId={session.userId}
                currentRole={session.role}
                showAdvancedFilters
                workspace
              />
            }]}
          />
        </Space>
      </section>
      <section className="pattern-current-task-section pattern-current-task-actions">
        <Typography.Text strong className="pattern-current-panel-title">任务</Typography.Text>
        <div className="pattern-auto-requirements">
          <Space size={[4, 4]} wrap>{requirements.map((item) => <Tag key={item} color={deliveredRequirements.has(item) ? "success" : "error"}>{deliveredRequirements.has(item) ? "✓ " : "未完成 · "}{requirementLabels[item] ?? item}</Tag>)}</Space>
          <Typography.Text type="secondary">上传与订单版师任务同名类别的交付物后，对应任务自动标绿；制版和改版之外的任务不阻塞综合任务完成。</Typography.Text>
        </div>
        <Typography.Text strong>本次交付物</Typography.Text>
        <Select value={completionTaskCategory} onChange={setCompletionTaskCategory} options={allTaskCategoryOptions} placeholder="选择版师任务类别" className="full-width" />
        <div className="pattern-deliverable-upload">
          <ClientAttachmentPicker
            value={completionFiles}
            onChange={setCompletionFiles}
            showCamera={false}
            defaultCategory="pattern_deliverable"
            defaultVisibility="client_visible"
            showVisibilityChoice
            title="拖拽或点击选择文件"
            description="支持任意格式文件。"
            compact
            compactLabel="交付附件（可选）"
            compactTrailingAction={(
              <Button
                type="primary"
                loading={completionUploading}
                disabled={!completionTaskCategory || completionFiles.length === 0}
                onClick={() => void uploadCurrentDeliverables()}
              >
                上传本次交付物
              </Button>
            )}
          />
        </div>
        <Button type="primary" block loading={completing} disabled={!blockingRequirementsComplete} onClick={() => setCompletionModalOpen(true)}>完成综合版师任务</Button>
      </section>
    </div>
  ) : <Alert type="info" showIcon message="暂无当前任务。请切换到“任务列表”查看全局任务池并先查看资料。" />;

  const workspaceNavigation = [
    { key: "current", label: "当前任务", count: workbench.current ? 1 : 0 },
    { key: "paused", label: "未完成任务", count: workbench.paused.length },
    { key: "pending", label: "任务列表", count: workbench.pending.length },
    { key: "history", label: "历史任务", count: workbench.history.length }
  ];

  const listPagination = (key: PatternTaskListKey, total: number) => {
    const pageSize = listPageSizes[key];
    const current = Math.min(listPages[key], Math.max(1, Math.ceil(total / pageSize)));
    return {
      current,
      pageSize,
      total,
      showSizeChanger: true,
      pageSizeOptions: [10, 20, 50],
      onChange: (nextPage: number, nextPageSize: number) => {
        const pageSizeChanged = nextPageSize !== pageSize;
        setListPages((value) => ({ ...value, [key]: pageSizeChanged ? 1 : nextPage }));
        if (pageSizeChanged) {
          setListPageSizes((value) => ({ ...value, [key]: nextPageSize }));
          window.localStorage.setItem(`sample-room:pattern-${key}:page-size`, String(nextPageSize));
        }
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`.pattern-task-data-workspace-${key} .ant-table-body`)?.scrollTo({ top: 0 }));
      }
    };
  };

  const listRows = (key: PatternTaskListKey, items: PatternTask[]) => {
    const pageSize = listPageSizes[key];
    const current = Math.min(listPages[key], Math.max(1, Math.ceil(items.length / pageSize)));
    return items.slice((current - 1) * pageSize, current * pageSize);
  };

  const workspaceContent = workspaceTab === "current" ? currentTaskContent : workspaceTab === "paused" ? (
    <div className="pattern-task-data-workspace pattern-task-data-workspace-paused">
      <TaskListToolbar compactSearch tasks={workbench.paused} value={pausedFilter} onChange={(value) => { setPausedFilter(value); setListPages((pages) => ({ ...pages, paused: 1 })); }} />
      <Table className="pattern-paused-task-table data-workspace-table" rowKey="id" size="small" dataSource={listRows("paused", filteredPaused)} columns={pausedColumns} scroll={{ x: 1430, y: "100%", scrollToFirstRowOnChange: true }} pagination={false} locale={{ emptyText: "暂无未完成任务" }} />
      <Pagination className="pattern-task-pagination" {...listPagination("paused", filteredPaused.length)} />
    </div>
  ) : workspaceTab === "pending" ? (
    <div className="pattern-task-data-workspace pattern-task-data-workspace-pending">
      <TaskListToolbar tasks={workbench.pending} value={pendingFilter} onChange={(value) => { setPendingFilter(value); setListPages((pages) => ({ ...pages, pending: 1 })); }} />
      <Table className="data-workspace-table" rowKey="id" size="small" dataSource={listRows("pending", filteredPending)} columns={pendingColumns} scroll={{ x: 1250, y: "100%", scrollToFirstRowOnChange: true }} pagination={false} locale={{ emptyText: "暂无可领取任务" }} />
      <Pagination className="pattern-task-pagination" {...listPagination("pending", filteredPending.length)} />
    </div>
  ) : (
    <div className="pattern-task-data-workspace pattern-task-data-workspace-history">
      <TaskListToolbar compactSearch tasks={workbench.history} value={historyFilter} onChange={(value) => { setHistoryFilter(value); setListPages((pages) => ({ ...pages, history: 1 })); }} />
      <Table className="data-workspace-table" rowKey="id" size="small" dataSource={listRows("history", filteredHistory)} columns={historyColumns} scroll={{ x: 1180, y: "100%", scrollToFirstRowOnChange: true }} pagination={false} locale={{ emptyText: "暂无历史任务" }} />
      <Pagination className="pattern-task-pagination" {...listPagination("history", filteredHistory.length)} />
    </div>
  );

  return (
    <Space direction="vertical" size={16} className="full-width pattern-maker-page">
      {contextHolder}
      <Card className="section-card pattern-workbench-title-card">
        <Space align="center" className="full-width pattern-workbench-title-row">
          <div><Typography.Title level={3} className="no-margin">版师工作台</Typography.Title><Typography.Text type="secondary">制版或改版成果上传后放行实体生产；其他版师任务继续并行。</Typography.Text></div>
          <Button loading={loading} onClick={() => void loadWorkbench()}>刷新</Button>
        </Space>
      </Card>
      <div className="pattern-workbench-stats" aria-label="版师任务统计">
        {[
          { key: "current", mark: "当", label: "当前任务", value: workbench.current ? 1 : 0, hint: "定位当前任务" },
          { key: "pending", mark: "列", label: "任务列表", value: workbench.pending.length, hint: "查看全局任务池" },
          { key: "paused", mark: "暂", label: "未完成任务", value: workbench.paused.length, hint: "查看未完成任务" },
          { key: "history", mark: "今", label: "今日完成", value: workbench.history.filter((task) => task.completedAt && new Date(task.completedAt).toDateString() === new Date().toDateString()).length, hint: "查看本人历史", tone: "green" },
          { key: "history", mark: "版", label: "历史版本", value: workbench.history.reduce((count, task) => count + task.deliverables.filter((item) => item.hasFile).length, 0), hint: "查看交付记录" }
        ].map((item) => (
          <button key={`${item.key}-${item.label}`} type="button" className={`pattern-workbench-stat${item.tone ? ` pattern-workbench-stat-${item.tone}` : ""}`} onClick={() => setWorkspaceTab(item.key)}>
            <span className="pattern-workbench-stat-icon">{item.mark}</span>
            <span className="pattern-workbench-stat-label">{item.label}</span>
            <strong>{item.value}</strong>
            <em>{item.hint}</em>
          </button>
        ))}
      </div>
      <Card className="section-card pattern-workbench-tabs-card" loading={loading}>
        <div className="pattern-workspace-layout">
          <nav className="pattern-workspace-nav" aria-label="版师任务区域">
            {workspaceNavigation.map((item) => (
              <button key={item.key} type="button" className={workspaceTab === item.key ? "pattern-workspace-nav-item pattern-workspace-nav-item-active" : "pattern-workspace-nav-item"} onClick={() => setWorkspaceTab(item.key)}>
                <span>{item.label}</span><strong>{item.count}</strong>
              </button>
            ))}
          </nav>
          <section className="pattern-workspace-content">{workspaceContent}</section>
        </div>
      </Card>

      <Modal
        title={previewTask ? `任务资料 · ${taskSummary(previewTask)}` : "任务资料"}
        width={1080}
        centered
        open={Boolean(previewTask)}
        onCancel={() => setPreviewTask(undefined)}
        className="pattern-task-materials-modal"
        footer={previewTask ? [
          <Button key="close" onClick={() => setPreviewTask(undefined)}>关闭</Button>,
          previewTask.status === "pending" ? (
            <Button key="start" type="primary" loading={startingId === previewTask.id} onClick={() => void startTask(previewTask)}>开始任务</Button>
          ) : null
        ] : null}
      >
        {previewTask ? (
          <Space direction="vertical" size={14} className="full-width">
            <div className="pattern-task-preview-summary">
              <OrderAttachmentThumbnail
                order={{ id: previewTask.orderId, attachments: previewTask.order.attachments ?? [] }}
                loadPreview={(order, attachment) => sampleRoomApi.downloadPatternOrderAttachment(session, order.id, attachment.id)}
              />
              <TaskIdentity task={previewTask} />
            </div>
            <div className="pattern-task-preview-context">
              <section className="pattern-task-preview-context-panel">
                <Typography.Text strong>任务说明：</Typography.Text>
                <Typography.Text className="pattern-task-instruction" title={taskInstructionText(previewTask)}>{taskInstructionText(previewTask)}</Typography.Text>
              </section>
              <section className="pattern-task-preview-context-panel pattern-task-preview-requirements">
                <Typography.Text strong>版师任务：</Typography.Text>
                <RequirementTags task={previewTask} />
              </section>
            </div>
            <CompactTaskMaterials
              task={previewTask}
              attachments={attachmentsByOrder[previewTask.orderId] ?? []}
              logs={attachmentLogsByOrder[previewTask.orderId] ?? []}
              loadPreview={(attachment) =>
                sampleRoomApi.downloadPatternOrderAttachment(session, previewTask.orderId, attachment.id)
              }
              loadDeliverablePreview={(deliverable) =>
                sampleRoomApi.downloadPatternDeliverable(session, previewTask.orderId, deliverable.id)
              }
              onRenameDeliverable={(deliverable, displayName) =>
                renameDeliverable(previewTask.orderId, deliverable, displayName)
              }
            onDeleteDeliverable={(deliverable) => deleteDeliverable(previewTask.orderId, deliverable)}
            onChangeDeliverableVisibility={(deliverable, visibility) =>
              changeDeliverableVisibility(previewTask.orderId, deliverable, visibility)
            }
              currentUserId={session.userId}
              currentRole={session.role}
            />
          </Space>
        ) : null}
      </Modal>
      <Modal
        title="完成综合版师任务"
        open={completionModalOpen}
        okText="确认完成"
        cancelText="取消"
        confirmLoading={completing}
        onOk={() => form.submit()}
        onCancel={() => setCompletionModalOpen(false)}
      >
        <Form form={form} layout="vertical" onFinish={(values) => void completeCurrent(values)}>
          <Form.Item label="总工时" name="workHours" rules={[{ required: true, message: "请输入总工时" }]}>
            <InputNumber min={0} addonAfter="小时" className="full-width" />
          </Form.Item>
          <Form.Item label="完成说明（选填）" name="note">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={versionTask ? `追加新版本 · ${taskSummary(versionTask)}` : "追加新版本"}
        open={Boolean(versionTask)}
        className="pattern-version-upload"
        footer={<Button onClick={() => setVersionTask(undefined)}>取消</Button>}
        onCancel={() => setVersionTask(undefined)}
      >
        <Space direction="vertical" size={12} className="full-width">
          <Alert type="info" showIcon message="无需手填版本号；服务端会基于现有记录生成下一个 V1 / V2 / V3。" />
          <Select value={versionTaskCategory} onChange={setVersionTaskCategory} options={allTaskCategoryOptions} placeholder="选择版师任务类别" className="full-width" />
          <ClientAttachmentPicker
            value={versionFiles}
            onChange={setVersionFiles}
            showCamera={false}
            defaultCategory="pattern_maker_upload"
            defaultVisibility="client_visible"
            showVisibilityChoice
            title="拖拽、粘贴或点击选择文件"
            description="可上传任意格式附件；版本号由服务端生成。"
            compact
            compactLabel="新版本附件（可选）"
            compactTrailingAction={(
              <Button
                type="primary"
                loading={versionUploading}
                disabled={versionFiles.length === 0 || !versionTaskCategory}
                onClick={() => void uploadVersion()}
              >
                上传新版本
              </Button>
            )}
          />
        </Space>
      </Modal>
    </Space>
  );
}
