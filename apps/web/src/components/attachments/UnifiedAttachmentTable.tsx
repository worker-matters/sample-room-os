import { EditOutlined, SearchOutlined } from "@ant-design/icons";
import {
  Button,
  Checkbox,
  Collapse,
  Input,
  Modal,
  Pagination,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message
} from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  AttachmentAuditLog,
  OrderAttachment,
  PatternDeliverableSummary
} from "../../api/sampleRoomApi";
import { downloadBlob } from "../../utils/downloadBlob";
import { validateAttachmentFileNameBody } from "../attachmentFileName";
import {
  AttachmentPreviewModal,
  type AttachmentPreviewRequest
} from "./AttachmentPreviewModal";
import {
  attachmentRoleLabels,
  attachmentSourceRoleOptions,
  attachmentTagLabel,
  attachmentUploaderLabel
} from "./attachmentPresentation";
import { attachmentOperationErrorMessage } from "./attachmentErrors";
import { NON_SEARCHABLE_PAGE_SIZE_CHANGER } from "../tablet/pagination";

type UnifiedAttachmentRow = {
  id: string;
  kind: "attachment" | "deliverable";
  fileName: string;
  category: string;
  version?: string;
  uploadedBy?: string;
  uploadedByRole: string;
  uploadedByName?: string;
  createdAt: string;
  visibility: "client_visible" | "internal_only";
  mimeType?: string;
  hasFile: boolean;
  original: OrderAttachment | PatternDeliverableSummary;
};

type UnifiedAttachmentTableProps = {
  attachments: OrderAttachment[];
  deliverables?: PatternDeliverableSummary[];
  logs?: AttachmentAuditLog[];
  currentUserId: string;
  currentRole: string;
  compact?: boolean;
  showAdvancedFilters?: boolean;
  enableBulkDelete?: boolean;
  bodyHeight?: number;
  workspace?: boolean;
  pageSizeStorageKey?: string;
  showPageSizeChanger?: boolean;
  showLogs?: boolean;
  loadPreview?: (row: UnifiedAttachmentRow) => Promise<Blob>;
  loadDeliverablePreview?: (deliverable: PatternDeliverableSummary) => Promise<Blob>;
  onRenameAttachment?: (attachment: OrderAttachment, displayName: string) => Promise<void>;
  onRenameDeliverable?: (
    deliverable: PatternDeliverableSummary,
    displayName: string
  ) => Promise<void>;
  onDeleteAttachment?: (attachment: OrderAttachment) => Promise<void>;
  onDeleteDeliverable?: (deliverable: PatternDeliverableSummary) => Promise<void>;
  onChangeAttachmentVisibility?: (
    attachment: OrderAttachment,
    visibility: OrderAttachment["visibility"]
  ) => Promise<void>;
  onChangeDeliverableVisibility?: (
    deliverable: PatternDeliverableSummary,
    visibility: OrderAttachment["visibility"]
  ) => Promise<void>;
  simple?: boolean;
};

function splitName(fileName: string) {
  const index = fileName.lastIndexOf(".");
  if (index <= 0) return { body: fileName, extension: "" };
  return { body: fileName.slice(0, index), extension: fileName.slice(index) };
}

function formatAttachmentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function canManageAll(role: string) {
  return role === "boss" || role === "system_owner";
}

function effectiveVisibility(value?: string): UnifiedAttachmentRow["visibility"] {
  return value === "client_visible" ? "client_visible" : "internal_only";
}

export function AttachmentLogList({ logs }: { logs: AttachmentAuditLog[] }) {
  const actionLabel = (action: AttachmentAuditLog["action"]) => {
    if (action === "upload") return "上传附件";
    if (action === "rename") return "附件改名";
    if (action === "visibility_change") return "可见状态变更";
    return "删除附件";
  };

  return (
    <div className="attachment-log-workspace">
      <Table<AttachmentAuditLog>
        className="attachment-log-table"
        rowKey="id"
        size="small"
        bordered
        tableLayout="fixed"
        pagination={false}
        locale={{ emptyText: "暂无附件操作日志" }}
        columns={[
          {
            title: "",
            key: "status",
            width: 48,
            align: "center",
            render: () => (
              <span className="boss-flow-status boss-flow-status-neutral" aria-hidden="true">
                <span className="boss-flow-dot" />
              </span>
            )
          },
          {
            title: "时间",
            dataIndex: "createdAt",
            width: 176,
            render: (value: string) => new Date(value).toLocaleString()
          },
          {
            title: "节点",
            dataIndex: "action",
            width: 152,
            render: (value: AttachmentAuditLog["action"]) => actionLabel(value)
          },
          {
            title: "说明",
            key: "detail",
            render: (_, log) => (
              <span className="attachment-log-detail">
                {attachmentRoleLabels[log.actorRole] ?? log.actorRole} · {log.actorName?.trim() || log.actorId} · {log.originalFileName}
                {log.newFileName ? ` → ${log.newFileName}` : ""}
              </span>
            )
          },
          {
            title: "操作",
            key: "actions",
            width: 72,
            align: "center",
            render: () => <Typography.Text type="secondary">--</Typography.Text>
          }
        ]}
        dataSource={logs}
        scroll={{ x: 760, y: "100%" }}
      />
    </div>
  );
}

export function UnifiedAttachmentTable({
  attachments,
  deliverables = [],
  logs = [],
  currentUserId,
  currentRole,
  compact = false,
  enableBulkDelete = false,
  bodyHeight = 360,
  workspace = false,
  pageSizeStorageKey,
  showPageSizeChanger = false,
  showLogs = true,
  loadPreview,
  loadDeliverablePreview,
  onRenameAttachment,
  onRenameDeliverable,
  onDeleteAttachment,
  onDeleteDeliverable,
  onChangeAttachmentVisibility,
  onChangeDeliverableVisibility,
  simple = false
}: UnifiedAttachmentTableProps) {
  const [query, setQuery] = useState("");
  const [sourceRole, setSourceRole] = useState("all");
  const [tag, setTag] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    if (!pageSizeStorageKey) return 8;
    const stored = Number(window.localStorage.getItem(pageSizeStorageKey));
    return Number.isInteger(stored) && stored > 0 ? stored : 8;
  });
  const [editing, setEditing] = useState<UnifiedAttachmentRow>();
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewRequest, setPreviewRequest] = useState<AttachmentPreviewRequest>();
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [downloadingSelected, setDownloadingSelected] = useState(false);
  const [changingSelectedVisibility, setChangingSelectedVisibility] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const rows = useMemo<UnifiedAttachmentRow[]>(
    () => [
      ...attachments.map((attachment) => ({
        id: attachment.id,
        kind: "attachment" as const,
        fileName: attachment.fileName,
        category: attachment.patternTaskCategory || attachment.category,
        uploadedByRole: attachment.uploadedByRole || "unknown",
        createdAt: attachment.createdAt,
        visibility: effectiveVisibility(attachment.visibility),
        mimeType: attachment.mimeType,
        hasFile: attachment.hasFile !== false,
        ...(attachment.uploadedBy ? { uploadedBy: attachment.uploadedBy } : {}),
        ...(attachment.uploadedByName
          ? { uploadedByName: attachment.uploadedByName }
          : {}),
        original: attachment
      })),
      ...deliverables
        .filter((deliverable) => Boolean(deliverable.fileName && deliverable.hasFile))
        .map((deliverable) => ({
          id: deliverable.id,
          kind: "deliverable" as const,
          fileName: deliverable.fileName!,
          category: deliverable.taskCategory || deliverable.type,
          uploadedByRole: "pattern_maker",
          createdAt: deliverable.createdAt,
          visibility: effectiveVisibility(deliverable.visibility),
          hasFile: deliverable.hasFile !== false,
          ...(deliverable.mimeType ? { mimeType: deliverable.mimeType } : {}),
          ...(deliverable.version ? { version: deliverable.version } : {}),
          ...(deliverable.uploadedBy ? { uploadedBy: deliverable.uploadedBy } : {}),
          ...(deliverable.uploadedByName
            ? { uploadedByName: deliverable.uploadedByName }
            : {}),
          original: deliverable
        }))
    ],
    [attachments, deliverables]
  );

  const tagOptions = useMemo(
    () => [
      { label: "全部标签", value: "all" },
      ...Array.from(new Set(rows.map((row) => row.category))).map((value) => ({
        label: attachmentTagLabel(value),
        value
      }))
    ],
    [rows]
  );

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (sourceRole === "all" || row.uploadedByRole === sourceRole) &&
        (tag === "all" || row.category === tag) &&
        (!normalized ||
          [row.fileName, row.uploadedByName, attachmentRoleLabels[row.uploadedByRole]]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(normalized))
    );
  }, [query, rows, sourceRole, tag]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = simple
    ? filteredRows
    : filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [query, sourceRole, tag]);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  const canRename = (row: UnifiedAttachmentRow) => {
    const hasHandler = row.kind === "attachment" ? Boolean(onRenameAttachment) : Boolean(onRenameDeliverable);
    return hasHandler && (
      canManageAll(currentRole) ||
      (row.uploadedBy === currentUserId && (
        (row.kind === "attachment" && (currentRole === "receiver" || currentRole === "planner")) ||
        (row.kind === "deliverable" && currentRole === "pattern_maker")
      ))
    );
  };

  const canDelete = (row: UnifiedAttachmentRow) => {
    const hasHandler = row.kind === "attachment" ? Boolean(onDeleteAttachment) : Boolean(onDeleteDeliverable);
    return hasHandler && (canManageAll(currentRole) || row.uploadedBy === currentUserId);
  };

  const canChangeVisibility = (row: UnifiedAttachmentRow) => {
    const hasHandler = row.kind === "attachment"
      ? Boolean(onChangeAttachmentVisibility)
      : Boolean(onChangeDeliverableVisibility);
    return hasHandler && (canManageAll(currentRole) || row.uploadedBy === currentUserId);
  };

  const rowKey = (row: UnifiedAttachmentRow) => `${row.kind}-${row.id}`;
  const deletableVisibleRows = visibleRows.filter(canDelete);
  const selectedKeySet = new Set(selectedRowKeys);
  const selectedRows = rows.filter((row) => selectedKeySet.has(rowKey(row)) && canDelete(row));
  const selectedVisibilityAllowed = selectedRows.length > 0 && selectedRows.every(canChangeVisibility);
  const allVisibleSelected = deletableVisibleRows.length > 0 && deletableVisibleRows.every((row) => selectedKeySet.has(rowKey(row)));
  const someVisibleSelected = deletableVisibleRows.some((row) => selectedKeySet.has(rowKey(row)));

  useEffect(() => {
    setSelectedRowKeys([]);
  }, [query, sourceRole, tag, page]);

  useEffect(() => {
    const validKeys = new Set(rows.filter(canDelete).map(rowKey));
    setSelectedRowKeys((current) => {
      const next = current.filter((key) => validKeys.has(key));
      return next.length === current.length ? current : next;
    });
  }, [attachments, deliverables, currentRole, currentUserId, onDeleteAttachment, onDeleteDeliverable]);

  const previewLoader = (row: UnifiedAttachmentRow) => {
    if (row.kind === "deliverable") {
      return loadDeliverablePreview
        ? () => loadDeliverablePreview(row.original as PatternDeliverableSummary)
        : undefined;
    }
    return loadPreview ? () => loadPreview(row) : undefined;
  };

  const openPreview = (row: UnifiedAttachmentRow) => {
    const load = previewLoader(row);
    if (!load || !row.hasFile) return;
    setPreviewRequest({
      key: rowKey(row),
      fileName: row.fileName,
      ...(row.mimeType ? { mimeType: row.mimeType } : {}),
      load
    });
  };

  const toggleVisibleRows = (checked: boolean) => {
    const pageKeys = deletableVisibleRows.map(rowKey);
    setSelectedRowKeys((current) => checked
      ? Array.from(new Set([...current, ...pageKeys]))
      : current.filter((key) => !pageKeys.includes(key))
    );
  };

  const deleteSelectedRows = async () => {
    if (selectedRows.length === 0) return;
    Modal.confirm({
      title: `删除选中的 ${selectedRows.length} 个附件？`,
      content: "删除后附件将从当前订单资料中移除，现有附件操作日志继续保留。",
      okButtonProps: { danger: true },
      okText: "确认删除",
      cancelText: "取消",
      onOk: async () => {
        setDeletingSelected(true);
        const failedKeys: string[] = [];
        let succeeded = 0;
        for (const row of selectedRows) {
          try {
            if (row.kind === "attachment") {
              await onDeleteAttachment?.(row.original as OrderAttachment);
            } else {
              await onDeleteDeliverable?.(row.original as PatternDeliverableSummary);
            }
            succeeded += 1;
          } catch {
            failedKeys.push(rowKey(row));
          }
        }
        setSelectedRowKeys(failedKeys);
        setDeletingSelected(false);
        if (failedKeys.length === 0) {
          messageApi.success(`已删除 ${succeeded} 个附件`);
        } else {
          messageApi.warning(`已删除 ${succeeded} 个，${failedKeys.length} 个删除失败`);
        }
      }
    });
  };

  const downloadSelectedRows = async () => {
    if (selectedRows.length === 0) return;
    setDownloadingSelected(true);
    let succeeded = 0;
    let failed = 0;
    for (const row of selectedRows) {
      const load = previewLoader(row);
      if (!row.hasFile || !load) {
        failed += 1;
        continue;
      }
      try {
        downloadBlob(await load(), row.fileName);
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }
    setDownloadingSelected(false);
    if (failed === 0) {
      messageApi.success(`已下载 ${succeeded} 个附件`);
    } else {
      messageApi.warning(`已下载 ${succeeded} 个，${failed} 个下载失败`);
    }
  };

  const changeSelectedVisibility = async (visibility: UnifiedAttachmentRow["visibility"]) => {
    if (!selectedVisibilityAllowed) return;
    setChangingSelectedVisibility(true);
    let succeeded = 0;
    let failed = 0;
    for (const row of selectedRows) {
      try {
        if (row.kind === "attachment") {
          await onChangeAttachmentVisibility?.(
            row.original as OrderAttachment,
            visibility
          );
        } else {
          await onChangeDeliverableVisibility?.(
            row.original as PatternDeliverableSummary,
            visibility
          );
        }
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }
    setChangingSelectedVisibility(false);
    const visibilityLabel = visibility === "client_visible" ? "客户可见" : "仅内部";
    if (failed === 0) {
      messageApi.success(`已将 ${succeeded} 个附件设为${visibilityLabel}`);
    } else {
      messageApi.warning(`已更新 ${succeeded} 个，${failed} 个修改失败`);
    }
  };

  const beginRename = (row: UnifiedAttachmentRow) => {
    setEditing(row);
    setDisplayName(splitName(row.fileName).body);
  };

  const nameParts = editing ? splitName(editing.fileName) : undefined;
  const normalizedDisplayName = displayName.trim();
  const nameError = editing && canRename(editing)
    ? validateAttachmentFileNameBody(normalizedDisplayName, nameParts?.extension ?? "")
    : undefined;
  const nameChanged = Boolean(editing && canRename(editing) && normalizedDisplayName !== nameParts?.body);

  const saveEdit = async () => {
    if (!editing || !nameChanged || nameError) return;
    setSaving(true);
    try {
      if (editing.kind === "attachment" && onRenameAttachment) {
        await onRenameAttachment(editing.original as OrderAttachment, normalizedDisplayName);
      } else if (editing.kind === "deliverable" && onRenameDeliverable) {
        await onRenameDeliverable(editing.original as PatternDeliverableSummary, normalizedDisplayName);
      }
      setEditing(undefined);
      messageApi.success("附件名称已更新");
    } catch (error) {
      messageApi.error(attachmentOperationErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space direction="vertical" size={10} className={`full-width unified-attachment-layout${workspace ? " is-workspace" : ""}`}>
      {contextHolder}
      <div className={`unified-attachment-toolbar${enableBulkDelete ? " unified-attachment-toolbar-with-bulk" : ""}${compact ? " unified-attachment-toolbar-compact" : ""}${simple ? " unified-attachment-toolbar-simple" : ""}`}>
        {enableBulkDelete ? (
          <Checkbox
            className="unified-attachment-select-all"
            checked={allVisibleSelected}
            indeterminate={!allVisibleSelected && someVisibleSelected}
            onChange={(event) => toggleVisibleRows(event.target.checked)}
          >
            全选
          </Checkbox>
        ) : null}
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={simple ? "搜索文件名" : "搜索文件名、上传人"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {!simple ? <Select value={sourceRole} options={[...attachmentSourceRoleOptions]} onChange={setSourceRole} /> : null}
        {!simple ? <Select value={tag} options={tagOptions} onChange={setTag} /> : null}
        {enableBulkDelete ? (
          <div className={compact ? "unified-attachment-toolbar-actions" : "unified-attachment-toolbar-actions-default"}>
            <Button
              {...(compact ? { size: "small" as const } : {})}
              loading={downloadingSelected}
              disabled={selectedRows.length === 0}
              onClick={() => void downloadSelectedRows()}
            >
              下载
            </Button>
            <Tooltip
              title={selectedRows.length > 0 && !selectedVisibilityAllowed
                ? "所选附件中包含无权修改可见范围的文件"
                : undefined}
            >
              <span className="unified-attachment-visibility-control">
                <Select<UnifiedAttachmentRow["visibility"]>
                  {...(compact ? { size: "small" as const } : {})}
                  placeholder="可见范围"
                  value={null}
                  loading={changingSelectedVisibility}
                  disabled={!selectedVisibilityAllowed || changingSelectedVisibility}
                  options={[
                    { label: "设为客户可见", value: "client_visible" },
                    { label: "设为仅内部", value: "internal_only" }
                  ]}
                  onChange={(visibility) => void changeSelectedVisibility(visibility)}
                />
              </span>
            </Tooltip>
            <Button
              {...(compact ? { size: "small" as const } : {})}
              danger
              loading={deletingSelected}
              disabled={selectedRows.length === 0}
              onClick={() => void deleteSelectedRows()}
            >
              删除
            </Button>
          </div>
        ) : null}
      </div>
      <div className="unified-attachment-data-region">
      <Table
        className={`unified-attachment-table${compact ? " unified-attachment-table-compact" : ""}${workspace ? " data-workspace-table" : ""}`}
        {...(!workspace ? { style: { "--unified-attachment-body-height": `${bodyHeight}px` } as CSSProperties } : {})}
        size="small"
        rowKey={rowKey}
        dataSource={visibleRows}
        pagination={false}
        scroll={{
          x: simple ? 620 : enableBulkDelete ? 1018 : 1090,
          y: workspace ? "100%" : bodyHeight,
          scrollToFirstRowOnChange: true
        }}
        locale={{ emptyText: "暂无符合条件的附件" }}
        columns={[
          ...(enableBulkDelete ? [{
            title: (
              <Checkbox
                aria-label="选择当前页可删除附件"
                checked={allVisibleSelected}
                indeterminate={!allVisibleSelected && someVisibleSelected}
                onChange={(event) => toggleVisibleRows(event.target.checked)}
              />
            ),
            width: 48,
            render: (_: unknown, row: UnifiedAttachmentRow) => canDelete(row) ? (
              <Checkbox
                aria-label={`选择附件 ${row.fileName}`}
                checked={selectedKeySet.has(rowKey(row))}
                onChange={(event) => setSelectedRowKeys((current) => event.target.checked
                  ? Array.from(new Set([...current, rowKey(row)]))
                  : current.filter((key) => key !== rowKey(row))
                )}
              />
            ) : null
          }] : []),
          {
            title: "文件名",
            dataIndex: "fileName",
            width: 260,
            render: (value, row) => {
              const load = previewLoader(row);
              const canOpen = row.hasFile && Boolean(load);
              return (
                <div className="unified-attachment-file-cell">
                  <Tooltip title={canOpen ? value : row.hasFile ? "当前附件不可读取" : "文件不存在"}>
                    {canOpen ? (
                      <Typography.Link
                        className="unified-attachment-file-name"
                        ellipsis
                        onClick={() => openPreview(row)}
                      >
                        {value}
                      </Typography.Link>
                    ) : (
                      <Typography.Text className="unified-attachment-file-name" ellipsis>
                        {value}
                      </Typography.Text>
                    )}
                  </Tooltip>
                  {canRename(row) ? (
                    <Button
                      type="link"
                      size="small"
                      className="unified-attachment-file-rename"
                      icon={<EditOutlined />}
                      aria-label={`修改文件名：${row.fileName}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        beginRename(row);
                      }}
                    >
                    </Button>
                  ) : null}
                </div>
              );
            }
          },
          ...(!simple ? [{
            title: "附件标签",
            width: 130,
            render: (_: unknown, row: UnifiedAttachmentRow) => <Tag>{attachmentTagLabel(row.category)}</Tag>
          }] : []),
          ...(!simple ? [{
            title: "版本",
            dataIndex: "version",
            width: 78,
            render: (value: string | undefined) => (value ? <Tag className="version-tag">{value}</Tag> : "-")
          }] : []),
          ...(!simple ? [{
            title: "上传角色",
            width: 110,
            render: (_: unknown, row: UnifiedAttachmentRow) => attachmentRoleLabels[row.uploadedByRole] ?? row.uploadedByRole
          }] : []),
          ...(!simple ? [{
            title: "上传人",
            width: 120,
            render: (_: unknown, row: UnifiedAttachmentRow) => attachmentUploaderLabel(row)
          }] : []),
          {
            title: "上传时间",
            dataIndex: "createdAt",
            width: simple ? 180 : 110,
            render: (value: string) => simple ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : formatAttachmentDate(value)
          },
          ...(!simple ? [{
            title: "客户可见",
            dataIndex: "visibility",
            width: 95,
            render: (value: UnifiedAttachmentRow["visibility"]) => value === "client_visible" ? <Tag color="green">是</Tag> : <Tag>否</Tag>
          }] : []),
          ...(!enableBulkDelete ? [{
            title: "操作",
            fixed: "right" as const,
            width: simple ? 72 : 132,
            render: (_: unknown, row: UnifiedAttachmentRow) => {
              const deletable = canDelete(row);
              if (!deletable) return <Typography.Text type="secondary">-</Typography.Text>;
              return (
                <Space size={0} wrap={false} className="unified-attachment-actions">
                  {deletable ? (
                    <Button
                      type="link"
                      danger
                      {...(simple ? { icon: <DeleteOutlined />, "aria-label": `删除附件：${row.fileName}` } : {})}
                      onClick={() => Modal.confirm({
                        title: "删除这个附件？",
                        content: "删除后保留附件操作日志；真实文件按当前存储规则处理。",
                        okButtonProps: { danger: true },
                        okText: "确认删除",
                        cancelText: "取消",
                        onOk: async () => {
                          try {
                            if (row.kind === "attachment") {
                              await onDeleteAttachment?.(row.original as OrderAttachment);
                            } else {
                              await onDeleteDeliverable?.(row.original as PatternDeliverableSummary);
                            }
                            messageApi.success("附件已删除，操作日志已保留");
                          } catch (error) {
                            messageApi.error(attachmentOperationErrorMessage(error));
                            throw error;
                          }
                        }
                      })}
                    >
                      {simple ? null : "删除"}
                    </Button>
                  ) : null}
                </Space>
              );
            }
          }] : [])
        ]}
      />
      </div>
      {!simple ? <Pagination
        className="unified-attachment-pagination"
        current={currentPage}
        pageSize={pageSize}
        total={filteredRows.length}
        showSizeChanger={showPageSizeChanger ? NON_SEARCHABLE_PAGE_SIZE_CHANGER : false}
        pageSizeOptions={Array.from(new Set([8, 10, 20, 50, pageSize])).sort((a, b) => a - b)}
        onChange={(nextPage, nextPageSize) => {
          setSelectedRowKeys([]);
          if (nextPageSize !== pageSize) {
            setPageSize(nextPageSize);
            setPage(1);
            if (pageSizeStorageKey) window.localStorage.setItem(pageSizeStorageKey, String(nextPageSize));
          } else {
            setPage(nextPage);
          }
        }}
      /> : null}
      {showLogs ? <Collapse
        ghost
        className="unified-attachment-log-collapse"
        items={[
          {
            key: "logs",
            label: `附件日志（${logs.length}）`,
            children: <AttachmentLogList logs={logs} />
          }
        ]}
      /> : null}
      <Modal
        title="改名附件"
        open={Boolean(editing)}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ disabled: !nameChanged || Boolean(nameError) }}
        onOk={() => void saveEdit()}
        onCancel={() => setEditing(undefined)}
      >
        {editing ? (
          <div>
            <Typography.Text strong>文件名</Typography.Text>
            <Input
              value={displayName}
              maxLength={120}
              {...(nameError ? { status: "error" as const } : {})}
              addonAfter={nameParts?.extension || "无扩展名"}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            {nameError ? <Typography.Text type="danger">{nameError}</Typography.Text> : null}
          </div>
        ) : null}
      </Modal>
      <AttachmentPreviewModal
        request={previewRequest}
        onClose={() => setPreviewRequest(undefined)}
      />
    </Space>
  );
}

export type { UnifiedAttachmentRow };
