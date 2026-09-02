import { Button, Card, Empty, Input, Modal, Pagination, Select, Space, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import type { OrderAttachment, PatternDeliverable, PatternDeliverableSummary } from "../../api/sampleRoomApi";
import { formatEntryDate } from "../orders/orderDisplay";
import { isSafeAttachmentPreviewMime } from "../attachments/attachmentPreview";

type MaterialGroup = "client" | "sample_room" | "pattern_maker";
type MaterialFilter = "client" | "qc_delivery" | "pattern_maker" | "cutting" | "receiver" | "planner";
type MaterialSourceFilter = "all" | MaterialGroup | MaterialFilter;

const groupMeta: Record<MaterialGroup, { title: string; color: string }> = {
  client: { title: "客户资料", color: "green" },
  sample_room: { title: "打样间资料", color: "blue" },
  pattern_maker: { title: "版师交付", color: "purple" }
};

const materialFilterOptions: Array<{ label: string; value: MaterialFilter }> = [
  { label: "客户资料", value: "client" },
  { label: "组检/出库", value: "qc_delivery" },
  { label: "版师", value: "pattern_maker" },
  { label: "裁剪", value: "cutting" },
  { label: "接单员", value: "receiver" },
  { label: "计划员", value: "planner" }
];

const patternTaskCategoryLabels: Record<string, string> = {
  pattern_making: "制版",
  pattern_revision: "改版",
  pattern_full_size: "推全码版",
  quote_material_check: "报价核料",
  bulk_material_check: "大货核料",
  pattern_padding_amount: "充棉/绒量",
  pattern_zipper_length: "核拉链长度"
};

const patternDeliverableTypeLabels: Record<string, string> = {
  pattern_file: "版师文件",
  cutting_pattern_file: "裁剪版文件",
  revision_note: "改版说明",
  full_size_pattern: "全码纸样",
  material_consumption: "核料/耗用",
  zipper_length: "拉链长度",
  padding_consumption: "充棉/绒量",
  process_note: "过程说明",
  other: "其他"
};

function groupFor(attachment: OrderAttachment, audience: "internal" | "client"): MaterialGroup {
  if (audience === "client") {
    if (attachment.sourceCategory === "client_upload") return "client";
    if (attachment.sourceCategory === "pattern_maker_upload") return "pattern_maker";
    return "sample_room";
  }
  if (attachment.sourceCategory === "client_upload" || attachment.uploadedByRole === "client_admin" || attachment.uploadedByRole === "client_business_user") {
    return "client";
  }
  if (attachment.sourceCategory === "pattern_maker_upload" || attachment.uploadedByRole === "pattern_maker") {
    return "pattern_maker";
  }
  return "sample_room";
}

function filterForAttachment(attachment: OrderAttachment): MaterialFilter | undefined {
  if (attachment.sourceCategory === "client_upload" || attachment.uploadedByRole === "client_admin" || attachment.uploadedByRole === "client_business_user") {
    return "client";
  }
  if (attachment.sourceCategory === "pattern_maker_upload" || attachment.uploadedByRole === "pattern_maker") {
    return "pattern_maker";
  }
  if (attachment.uploadedByRole === "receiver") return "receiver";
  if (attachment.uploadedByRole === "planner") return "planner";
  if (attachment.uploadedByRole === "worker") {
    return attachment.category === "qc_sample_photo" || attachment.category === "qc_measurement_photo"
      ? "qc_delivery"
      : "cutting";
  }
  return undefined;
}

function isQcReportAttachment(attachment: OrderAttachment) {
  return attachment.category === "qc_sample_photo" || attachment.category === "qc_measurement_photo";
}

export function ThreeSourceMaterials<
  TAttachment extends OrderAttachment = OrderAttachment,
  TDeliverable extends PatternDeliverable | PatternDeliverableSummary =
    | PatternDeliverable
    | PatternDeliverableSummary
>({
  attachments = [],
  deliverables = [],
  onDownload,
  onDownloadDeliverable,
  onPreview,
  onPreviewDeliverable,
  onDelete,
  canDelete,
  onDeleteDeliverable,
  canDeleteDeliverable,
  audience = "internal",
  compact = false,
  showAdvancedFilters = false
}: {
  attachments?: TAttachment[];
  deliverables?: TDeliverable[];
  onDownload?: (attachment: TAttachment) => Promise<void> | void;
  onDownloadDeliverable?: (deliverable: TDeliverable) => Promise<void> | void;
  onPreview?: (attachment: TAttachment) => Promise<void> | void;
  onPreviewDeliverable?: (deliverable: TDeliverable) => Promise<void> | void;
  onDelete?: (attachment: TAttachment) => Promise<void> | void;
  canDelete?: (attachment: TAttachment) => boolean;
  onDeleteDeliverable?: (deliverable: TDeliverable) => Promise<void> | void;
  canDeleteDeliverable?: (deliverable: TDeliverable) => boolean;
  audience?: "internal" | "client";
  compact?: boolean;
  showAdvancedFilters?: boolean;
}) {
  const [sourceFilter, setSourceFilter] = useState<MaterialSourceFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 6;
  const rows = useMemo(() => [
    ...attachments.map((attachment) => ({
      id: `attachment-${attachment.id}`,
      kind: "attachment" as const,
      source: groupFor(attachment, audience),
      filterRole: filterForAttachment(attachment),
      attachment
    })),
    ...deliverables.map((deliverable) => ({
      id: `deliverable-${deliverable.id}`,
      kind: "deliverable" as const,
      source: "pattern_maker" as const,
      filterRole: "pattern_maker" as const,
      deliverable
    }))
  ], [attachments, audience, deliverables]);
  const categoryOptions = useMemo(() => {
    const options = new Map<string, string>();
    rows.forEach((row) => {
      if (row.kind === "attachment") {
        const value = `attachment:${row.attachment.category}`;
        options.set(value, row.attachment.category);
        return;
      }
      if (row.deliverable.taskCategory) {
        const value = `task:${row.deliverable.taskCategory}`;
        options.set(value, patternTaskCategoryLabels[row.deliverable.taskCategory] ?? row.deliverable.taskCategory);
      } else {
        const value = `deliverable:${row.deliverable.type}`;
        options.set(value, patternDeliverableTypeLabels[row.deliverable.type] ?? row.deliverable.type);
      }
    });
    return Array.from(options, ([value, label]) => ({ value, label }));
  }, [rows]);
  const normalizedKeyword = keyword.trim().toLocaleLowerCase("zh-CN");
  const filteredRows = rows.filter((row) => {
    if (
      sourceFilter !== "all" &&
      (audience === "client" ? row.source !== sourceFilter : row.filterRole !== sourceFilter)
    ) return false;
    const fileName = row.kind === "attachment"
      ? row.attachment.fileName
      : row.deliverable.fileName ?? row.deliverable.textValue ?? "";
    if (normalizedKeyword && !fileName.toLocaleLowerCase("zh-CN").includes(normalizedKeyword)) return false;
    if (categoryFilter === "all") return true;
    if (row.kind === "attachment") return categoryFilter === `attachment:${row.attachment.category}`;
    return row.deliverable.taskCategory
      ? categoryFilter === `task:${row.deliverable.taskCategory}`
      : categoryFilter === `deliverable:${row.deliverable.type}`;
  });
  const safePage = Math.min(page, Math.max(1, Math.ceil(filteredRows.length / pageSize)));
  const visibleRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const sourceOptions = audience === "client"
    ? (Object.keys(groupMeta) as MaterialGroup[])
        .filter((source) => rows.some((row) => row.source === source))
        .map((source) => ({ label: groupMeta[source].title, value: source }))
    : materialFilterOptions;
  const body = (
    <div className="three-source-materials">
      <div className="three-source-materials-group">
        {showAdvancedFilters ? (
          <div className="three-source-materials-filters">
            <Input.Search
              allowClear
              value={keyword}
              placeholder="搜索文件名"
              onChange={(event) => {
                setKeyword(event.target.value);
                setPage(1);
              }}
            />
            <Select
              aria-label="筛选附件来源"
              value={sourceFilter}
              options={[{ label: "全部来源", value: "all" }, ...sourceOptions]}
              onChange={(value) => {
                setSourceFilter(value);
                setPage(1);
              }}
            />
            <Select
              aria-label="筛选附件类别"
              value={categoryFilter}
              options={[{ label: "全部附件类别", value: "all" }, ...categoryOptions]}
              onChange={(value) => {
                setCategoryFilter(value);
                setPage(1);
              }}
            />
            <Button onClick={() => {
              setKeyword("");
              setSourceFilter("all");
              setCategoryFilter("all");
              setPage(1);
            }}>重置</Button>
          </div>
        ) : null}
        <Space className="full-width three-source-materials-heading">
          <Typography.Text strong>全部资料</Typography.Text>
          <Space size={8}>
            {!showAdvancedFilters ? <Select
              aria-label="筛选附件来源"
              size="small"
              value={sourceFilter}
              options={[{ label: "全部来源", value: "all" }, ...sourceOptions]}
              onChange={(value) => {
                setSourceFilter(value);
                setPage(1);
              }}
            /> : null}
            <Typography.Text type="secondary">{filteredRows.length} 份</Typography.Text>
          </Space>
        </Space>
        <div className="three-source-material-scroll">
        {visibleRows.map((row) => {
          if (row.kind === "attachment") {
            const { attachment } = row;
            return (
            <div className="three-source-material-row" key={row.id}>
              <div>
                <Space size={6} wrap>
                  <Typography.Text ellipsis>{attachment.fileName}</Typography.Text>
                  <Tag color={groupMeta[row.source].color}>{groupMeta[row.source].title}</Tag>
                  {isQcReportAttachment(attachment) ? <Tag color="cyan">样衣QC报告</Tag> : null}
                  {attachment.uploadedByRole === "receiver" ? <Tag color="blue">接单员上传</Tag> : null}
                  {attachment.category === "receiver_material_record" ? (
                    <Tag color="gold">面辅料记录</Tag>
                  ) : attachment.uploadedByRole === "receiver" ? (
                    <Tag color="cyan">打样单相关</Tag>
                  ) : null}
                </Space>
                <Typography.Paragraph type="secondary" className="three-source-material-meta">
                  {audience === "client"
                    ? `类型：${attachment.category} · ${formatEntryDate(attachment.createdAt)}`
                    : `类型：${attachment.category} · 上传人：${attachment.uploadedByName ?? attachment.uploadedBy ?? "未知上传人"}（${attachment.uploadedByRole ?? "未知角色"}） · ${formatEntryDate(attachment.createdAt)} · ${attachment.visibility === "client_visible" ? "客户可见" : "仅内部可见"}`}
                </Typography.Paragraph>
                {attachment.note ? <Typography.Paragraph type="secondary" ellipsis={{ rows: 1 }}>{attachment.note}</Typography.Paragraph> : null}
              </div>
              <Space size={6}>
                {attachment.hasFile && onPreview && isSafeAttachmentPreviewMime(attachment.mimeType) ? (
                  <Button size="small" onClick={() => void onPreview(attachment)}>预览</Button>
                ) : null}
                {attachment.hasFile && onDownload ? (
                  <Button size="small" onClick={() => void onDownload(attachment)}>下载</Button>
                ) : null}
                {onDelete && (canDelete?.(attachment) ?? true) ? (
                  <Button danger size="small" onClick={() => Modal.confirm({
                    title: "确认删除附件？",
                    content: <>文件：{attachment.fileName}<br />删除后，操作会永久保留在附件日志中。</>,
                    okText: "确认删除",
                    cancelText: "取消",
                    okButtonProps: { danger: true },
                    onOk: () => onDelete(attachment)
                  })}>删除</Button>
                ) : null}
              </Space>
            </div>
            );
          }
          const { deliverable } = row;
          return (
          <div className="three-source-material-row" key={row.id}>
            <div>
              <Space size={6} wrap>
                <Typography.Text>{deliverable.fileName ?? deliverable.textValue ?? "版师交付记录"}</Typography.Text>
                <Tag color={groupMeta.pattern_maker.color}>{groupMeta.pattern_maker.title}</Tag>
                {deliverable.taskCategory ? (
                  <Tag color="blue">{patternTaskCategoryLabels[deliverable.taskCategory] ?? deliverable.taskCategory}</Tag>
                ) : null}
                <Tag>版本 {deliverable.version}</Tag>
                <Tag>{patternDeliverableTypeLabels[deliverable.type] ?? deliverable.type}</Tag>
              </Space>
              <Typography.Paragraph type="secondary" className="three-source-material-meta">
                {audience === "client"
                  ? formatEntryDate(deliverable.createdAt)
                  : `上传人：${deliverable.uploadedByName ?? ("uploadedBy" in deliverable ? deliverable.uploadedBy : "版师")} · ${formatEntryDate(deliverable.createdAt)} · 仅内部可见`}
              </Typography.Paragraph>
            </div>
            <Space size={6}>
              {deliverable.hasFile && onPreviewDeliverable && isSafeAttachmentPreviewMime(deliverable.mimeType) ? (
                <Button size="small" onClick={() => void onPreviewDeliverable(deliverable)}>预览</Button>
              ) : null}
              {deliverable.hasFile && onDownloadDeliverable ? (
                <Button size="small" onClick={() => void onDownloadDeliverable(deliverable)}>下载</Button>
              ) : null}
              {onDeleteDeliverable && (canDeleteDeliverable?.(deliverable) ?? true) ? (
                <Button danger size="small" onClick={() => Modal.confirm({
                  title: "确认删除附件？",
                  content: <>文件：{deliverable.fileName ?? `${deliverable.version}-${deliverable.type}`}<br />删除后，操作会永久保留在附件日志中。</>,
                  okText: "确认删除",
                  cancelText: "取消",
                  okButtonProps: { danger: true },
                  onOk: () => onDeleteDeliverable(deliverable)
                })}>删除</Button>
              ) : null}
            </Space>
          </div>
          );
        })}
        {filteredRows.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无资料" /> : null}
        </div>
        {filteredRows.length > pageSize ? (
          <Pagination
            className="three-source-material-pagination"
            size="small"
            current={safePage}
            pageSize={pageSize}
            total={filteredRows.length}
            showSizeChanger={false}
            onChange={setPage}
          />
        ) : null}
      </div>
    </div>
  );

  return compact ? body : <Card size="small" title="资料与附件">{body}</Card>;
}
