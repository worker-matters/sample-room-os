import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { DevSession } from "../../app/DevSessionContext";
import {
  cancelPlannerParticipation,
  getPlannerSewingCollaboration,
  updatePlannerParticipationTargets,
  type PlannerSewingCollaboration,
  type PlannerSewingParticipation
} from "../../api/collaborativeSewingApi";

type PlannerCollaborationDialogProps = {
  open: boolean;
  orderId?: string | undefined;
  orderLabel?: string | undefined;
  session: DevSession;
  onClose: () => void;
  onChanged?: (() => void | Promise<void>) | undefined;
};

function statusTag(status: PlannerSewingParticipation["status"]) {
  if (status === "active") return <Tag color="processing">缝制中</Tag>;
  if (status === "completed") return <Tag color="success">已完成</Tag>;
  if (status === "cancelled") return <Tag>已取消</Tag>;
  return <Tag>已替换</Tag>;
}

function editableParticipation(participant: PlannerSewingParticipation) {
  return participant.status === "active";
}

export function PlannerCollaborationDialog({
  open,
  orderId,
  orderLabel,
  session,
  onClose,
  onChanged
}: PlannerCollaborationDialogProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collaboration, setCollaboration] = useState<PlannerSewingCollaboration>();
  const [draftTargets, setDraftTargets] = useState<Record<string, number | undefined>>({});

  const load = useCallback(async () => {
    if (!open || !orderId) return;
    setLoading(true);
    try {
      const result = await getPlannerSewingCollaboration(session, orderId);
      setCollaboration(result.collaboration);
      setDraftTargets(Object.fromEntries(
        result.collaboration.participants.map((participant) => [participant.id, participant.targetPieces])
      ));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "协作分配加载失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi, open, orderId, session]);

  useEffect(() => {
    if (open) void load();
    else {
      setCollaboration(undefined);
      setDraftTargets({});
    }
  }, [load, open]);

  const performanceNeedsReview = collaboration
    ? collaboration.completedPieces >= collaboration.quantity && collaboration.activeParticipantCount > 0
    : false;

  const changedTargets = useMemo(() => {
    if (!collaboration) return [];
    return collaboration.participants.filter((participant) => {
      if (!editableParticipation(participant)) return false;
      const draft = draftTargets[participant.id];
      return typeof draft === "number" && draft > 0 && draft !== participant.targetPieces;
    });
  }, [collaboration, draftTargets]);

  const saveTargets = async () => {
    if (!collaboration || !orderId || changedTargets.length === 0) return;
    setSaving(true);
    try {
      const result = await updatePlannerParticipationTargets(
        session,
        orderId,
        collaboration.revision,
        changedTargets.map((participant) => ({
          participationId: participant.id,
          targetPieces: draftTargets[participant.id]!
        }))
      );
      setCollaboration(result.collaboration);
      setDraftTargets(Object.fromEntries(
        result.collaboration.participants.map((participant) => [participant.id, participant.targetPieces])
      ));
      await onChanged?.();
      messageApi.success("协作分配已更新");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "协作分配保存失败");
    } finally {
      setSaving(false);
    }
  };

  const cancelParticipant = async (participant: PlannerSewingParticipation) => {
    if (!orderId) return;
    setSaving(true);
    try {
      if (!collaboration) return;
      const result = await cancelPlannerParticipation(
        session,
        orderId,
        participant.id,
        collaboration.revision
      );
      await onChanged?.();
      messageApi.success(`${participant.workerName} 已退出本次协作`);
      if (result.participation.sewingMode === "single") onClose();
      else await load();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "取消参与失败");
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<PlannerSewingParticipation> = [
    {
      title: "参与员工",
      dataIndex: "workerName",
      key: "workerName",
      render: (value, participant) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {new Date(participant.joinedAt).toLocaleString("zh-CN")}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: "计划任务",
      key: "targetPieces",
      width: 130,
      render: (_value, participant) => editableParticipation(participant) ? (
        <InputNumber
          min={1}
          precision={0}
          addonAfter="件"
          value={draftTargets[participant.id] ?? null}
          placeholder="待分配"
          onChange={(value) => setDraftTargets((current) => ({
            ...current,
            [participant.id]: typeof value === "number" ? value : undefined
          }))}
          style={{ width: 116 }}
        />
      ) : (
        <Typography.Text type="secondary">
          {participant.targetPieces !== undefined ? `${participant.targetPieces}件` : "-"}
        </Typography.Text>
      )
    },
    {
      title: "已申报绩效",
      key: "completedPieces",
      width: 96,
      render: (_value, participant) => participant.completedPieces !== undefined ? (
        <Space direction="vertical" size={0}>
          <span>{participant.completedPieces}件</span>
          {participant.status === "completed" ? (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>绩效件数仅老板可更正</Typography.Text>
          ) : null}
        </Space>
      ) : "-"
    },
    {
      title: "状态",
      key: "status",
      width: 92,
      render: (_value, participant) => statusTag(participant.status)
    },
    {
      title: "操作",
      key: "actions",
      width: 92,
      render: (_value, participant) => participant.status === "active" ? (
        <Popconfirm
          title={`确认取消 ${participant.workerName} 的参与？`}
          description={(
            <Typography.Text>
              仅适用于误加入或实际未参与的情况。取消后，该员工手机上的本单任务将失效，且不会产生本单绩效。已经实际参与过的员工请勿取消，应由员工提交实际件数后，再由老板更正绩效。
            </Typography.Text>
          )}
          okText="确认取消参与"
          cancelText="返回"
          onConfirm={() => void cancelParticipant(participant)}
        >
          <Button danger type="link" size="small" disabled={saving}>取消参与</Button>
        </Popconfirm>
      ) : null
    }
  ];

  return (
    <Modal
      title={orderLabel ? `协作分配 · ${orderLabel}` : "协作分配"}
      open={open}
      onCancel={onClose}
      width={720}
      destroyOnHidden
      footer={[
        <Button key="close" onClick={onClose}>关闭</Button>,
        <Button
          key="save"
          type="primary"
          loading={saving}
          disabled={changedTargets.length === 0}
          onClick={() => void saveTargets()}
        >
          保存分配
        </Button>
      ]}
    >
      {contextHolder}
      <Space direction="vertical" size={12} className="full-width">
        {collaboration ? (
          <>
            <Space wrap>
              <Tag color="blue">订单：{collaboration.quantity}件</Tag>
              <Tag>计划分配：{collaboration.plannedPieces}件</Tag>
              <Tag color={performanceNeedsReview ? "orange" : "default"}>已申报绩效：{collaboration.completedPieces}件</Tag>
              <Tag color={collaboration.activeParticipantCount > 0 ? "processing" : "default"}>进行中：{collaboration.activeParticipantCount}人</Tag>
              {performanceNeedsReview ? <Tag color="orange">绩效数量待确认</Tag> : null}
            </Space>

            {performanceNeedsReview ? (
              <Alert
                type="warning"
                showIcon
                message={`当前仍有 ${collaboration.activeParticipantCount} 名员工在缝制`}
                description={`员工累计已申报 ${collaboration.completedPieces} 件绩效，但绩效件数不代表订单已经结束。若该员工仍在制作，请保持不变；若其误加入且未实际参与，请取消参与；若已完成人员件数填写错误，请由老板更正绩效。`}
              />
            ) : null}

            <Table
              rowKey="id"
              size="small"
              loading={loading}
              pagination={false}
              columns={columns}
              dataSource={collaboration.participants}
              scroll={{ x: 640 }}
            />
            <Typography.Text type="secondary">
              计划任务只用于生产协调，不影响订单阶段；订单是否结束由参与员工是否全部完成决定。
            </Typography.Text>
          </>
        ) : loading ? null : (
          <Alert type="info" showIcon message="暂无协作参与记录" />
        )}
      </Space>
    </Modal>
  );
}
