import { Button, Form, Input, Modal, Space, Table, Typography, message } from "antd";
import { useState } from "react";
import { sampleRoomApi, type SampleTypeDefinition } from "../../api/sampleRoomApi";
import { useSampleTypeOptions } from "../../app/SampleTypeOptionsContext";
import type { DevSession } from "../../app/DevSessionContext";

type EditTarget = { code: string; name: string } | null;

export function SampleTypeManagementPanel({ session }: { session: DevSession }) {
  const { options, loading, setOptions } = useSampleTypeOptions();
  const [form] = Form.useForm<{ name: string }>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [saving, setSaving] = useState(false);

  const applyItems = (items: SampleTypeDefinition[]) => {
    setOptions(items.map(({ code, name }) => ({ value: code, label: name })));
  };

  const openCreate = () => {
    setEditTarget(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openRename = (code: string, name: string) => {
    setEditTarget({ code, name });
    form.setFieldsValue({ name });
    setModalOpen(true);
  };

  const saveName = async () => {
    const { name } = await form.validateFields();
    setSaving(true);
    try {
      const result = editTarget
        ? await sampleRoomApi.renameSampleType(session, editTarget.code, name)
        : await sampleRoomApi.createSampleType(session, name);
      applyItems(result.items);
      setModalOpen(false);
      message.success(editTarget ? "样衣类型名称已修改" : "样衣类型已新增");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const move = async (code: string, direction: "up" | "down") => {
    try {
      const result = await sampleRoomApi.moveSampleType(session, code, direction);
      applyItems(result.items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "调整顺序失败");
    }
  };

  return (
    <Space direction="vertical" size={16} className="full-width">
      <div>
        <Typography.Title level={3}>样衣类型管理</Typography.Title>
        <Typography.Paragraph type="secondary">
          管理订单中可选择的样衣类型。修改名称后，已有订单会显示最新名称。
        </Typography.Paragraph>
        <Button type="primary" onClick={openCreate}>新增样衣类型</Button>
      </div>
      <Table
        rowKey="value"
        loading={loading}
        pagination={false}
        dataSource={options}
        columns={[
          { title: "样衣类型名称", dataIndex: "label" },
          {
            title: "操作",
            render: (_, item, index) => (
              <Space>
                <Button type="link" onClick={() => openRename(item.value, item.label)}>修改名称</Button>
                <Button type="link" disabled={index === 0} onClick={() => void move(item.value, "up")}>上移</Button>
                <Button type="link" disabled={index === options.length - 1} onClick={() => void move(item.value, "down")}>下移</Button>
              </Space>
            )
          }
        ]}
      />
      <Modal
        title={editTarget ? "修改样衣类型名称" : "新增样衣类型"}
        open={modalOpen}
        confirmLoading={saving}
        onOk={() => void saveName()}
        onCancel={() => setModalOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="样衣类型名称"
            name="name"
            rules={[{ required: true, whitespace: true, message: "请输入样衣类型名称" }]}
          >
            <Input autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
