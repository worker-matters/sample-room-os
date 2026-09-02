import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  Space,
  Tag,
  Typography,
  message
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  sampleRoomApi,
  type AndroidAppRelease,
  type AndroidClientType
} from "../../api/sampleRoomApi";
import type { DevSession } from "../../app/DevSessionContext";

type ReleaseMap = {
  phone: AndroidAppRelease | null;
  pad: AndroidAppRelease | null;
};

const CLIENT_LABEL: Record<AndroidClientType, string> = {
  phone: "手机端 Phone",
  pad: "Pad 端"
};

function formatBytes(bytes?: number) {
  if (!bytes) return "-";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "-";
}

function shortHash(value?: string) {
  if (!value) return "-";
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

export function AndroidAppReleasePanel({ session }: { session: DevSession }) {
  const [messageApi, contextHolder] = message.useMessage();
  const [releases, setReleases] = useState<ReleaseMap>({ phone: null, pad: null });
  const [files, setFiles] = useState<Partial<Record<AndroidClientType, File>>>({});
  const [notes, setNotes] = useState<Record<AndroidClientType, string>>({ phone: "", pad: "" });
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState<AndroidClientType | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await sampleRoomApi.getAndroidAppReleases(session);
      setReleases(response.releases);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "App 版本读取失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi, session]);

  useEffect(() => { void refresh(); }, [refresh]);

  const publish = async (clientType: AndroidClientType) => {
    const file = files[clientType];
    if (!file) {
      messageApi.warning("请先选择 APK 安装包。");
      return;
    }
    setPublishing(clientType);
    try {
      const response = await sampleRoomApi.publishAndroidAppRelease(
        session,
        clientType,
        file,
        notes[clientType]
      );
      setReleases((current) => ({ ...current, [clientType]: response.release }));
      setFiles((current) => ({ ...current, [clientType]: undefined }));
      setNotes((current) => ({ ...current, [clientType]: "" }));
      messageApi.success(
        `${CLIENT_LABEL[clientType]} V${response.release.versionName} 已发布`
      );
    } catch (error) {
      const raw = error instanceof Error ? error.message : "发布失败";
      const friendly = raw.startsWith("apk_package_mismatch")
        ? "安装包类型不正确，请确认 Phone/Pad APK 没有选反。"
        : raw.startsWith("apk_version_code_must_increase")
          ? "versionCode 必须高于当前已发布版本。"
          : raw === "apk_signer_mismatch"
            ? "APK 签名与已发布版本不一致，已阻止发布。"
            : raw === "apk_parse_failed"
              ? "无法读取 APK，请确认这是完整的 Android 安装包。"
              : raw;
      messageApi.error(friendly);
    } finally {
      setPublishing(null);
    }
  };

  return (
    <Space direction="vertical" size={16} className="full-width">
      {contextHolder}
      <Alert
        type="info"
        showIcon
        message="Phone 与 Pad 使用独立发布通道"
        description="服务器会从 APK 自动读取包名、versionName、versionCode 和签名证书。不能手填版本号；versionCode 不递增、包名选错或签名变化都会被拒绝。"
      />
      {(["phone", "pad"] as const).map((clientType) => {
        const release = releases[clientType];
        return (
          <Card
            key={clientType}
            size="small"
            loading={loading}
            title={CLIENT_LABEL[clientType]}
            extra={
              release
                ? <Tag color="blue">当前 V{release.versionName}</Tag>
                : <Tag>尚未发布</Tag>
            }
          >
            <Space direction="vertical" size={14} className="full-width">
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="Package">
                  {release?.packageName ?? (clientType === "phone"
                    ? "com.sampleroom.mobile"
                    : "com.sampleroom.tablet")}
                </Descriptions.Item>
                <Descriptions.Item label="versionCode">
                  {release?.versionCode ?? "-"}
                </Descriptions.Item>
                <Descriptions.Item label="安装包">
                  {release ? `${release.fileName} · ${formatBytes(release.sizeBytes)}` : "-"}
                </Descriptions.Item>
                <Descriptions.Item label="SHA-256">
                  <Typography.Text code copyable={Boolean(release?.sha256)}>
                    {shortHash(release?.sha256)}
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="发布时间">
                  {formatTime(release?.publishedAt)}
                </Descriptions.Item>
              </Descriptions>

              <label>
                <Typography.Text strong>选择新 APK</Typography.Text>
                <input
                  style={{ display: "block", marginTop: 8, maxWidth: "100%" }}
                  type="file"
                  accept=".apk,application/vnd.android.package-archive"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    setFiles((current) => ({ ...current, [clientType]: file }));
                  }}
                />
              </label>

              <Input.TextArea
                value={notes[clientType]}
                maxLength={1000}
                autoSize={{ minRows: 2, maxRows: 4 }}
                placeholder="更新说明（可选，例如：修复扫码问题、优化订单列表）"
                onChange={(event) => {
                  const value = event.target.value;
                  setNotes((current) => ({ ...current, [clientType]: value }));
                }}
              />

              <Button
                type="primary"
                loading={publishing === clientType}
                disabled={!files[clientType] || publishing !== null}
                onClick={() => void publish(clientType)}
              >
                发布这个版本
              </Button>
              <Typography.Text type="secondary">
                发布后，安装了更低 versionCode 的对应客户端在登录前会被要求更新。
                同版本设备不会重复更新。
              </Typography.Text>
            </Space>
          </Card>
        );
      })}
    </Space>
  );
}
