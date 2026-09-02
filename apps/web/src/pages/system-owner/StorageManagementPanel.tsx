import { Alert, Button, Card, Collapse, Descriptions, Space, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { sampleRoomApi, type StorageManagementOverview } from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";

export function StorageManagementPanel({ session }: { session: DevSession }) {
  const [overview, setOverview] = useState<StorageManagementOverview>();

  const load = useCallback(async () => {
    setOverview(await sampleRoomApi.getStorageManagementOverview(session));
  }, [session]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  return <Card title="存储管理" extra={<Button onClick={() => void load()}>刷新状态</Button>}>
    <Space direction="vertical" size={16} className="full-width">
      <Alert
        type="info"
        showIcon
        message="存储位置更换：当前版本暂未开放"
        description="首次生产版本固定使用安装时确认的系统数据目录、独立附件存档目录和备份目录。本页不提供可执行或模拟成功的迁移操作；后续换盘需要为两个活动数据根另行设计原子切换与回滚。"
      />
      <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
        <Descriptions.Item label="当前系统数据目录">
          {overview?.data.status === "normal"
            ? <><Tag color="green">正常</Tag>{overview.data.displayName}</>
            : <Tag color="red">异常</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label="当前系统备份目录">
          {overview?.backup.status === "normal"
            ? <><Tag color="green">正常</Tag>{overview.backup.displayName}</>
            : <Tag color="red">异常</Tag>}
        </Descriptions.Item>
      </Descriptions>
      <Collapse items={[{
        key: "locations",
        label: "查看详细位置",
        children: <Descriptions size="small" column={1}>
          <Descriptions.Item label="系统数据目录">{overview?.data.detailedPath ?? "未配置"}</Descriptions.Item>
          <Descriptions.Item label="附件存档目录">由安装时的独立 SAMPLE_ROOM_STORAGE_ROOT 配置</Descriptions.Item>
          <Descriptions.Item label="系统备份目录">{overview?.backup.detailedPath ?? "未配置"}</Descriptions.Item>
        </Descriptions>
      }]} />
    </Space>
  </Card>;
}
