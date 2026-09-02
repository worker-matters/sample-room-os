# Sample Room OS Pad Android shell

这是独立的 Android Pad APK 工程：

- applicationId：`com.sampleroom.tablet`
- 应用名称：`样品间 Pad`
- 第一阶段版本：`0.1.0-internal`（versionCode `1`）
- 业务页面：服务器上的 `/qc/tablet`

它不会读取或写入 `apps/android` 手机应用的数据。两个 APK 的 applicationId、应用私有目录、
Cookie 和网络配置都不同，可以同时安装。工程只复用仓库已固定版本的 Gradle Wrapper 启动器，
不会引用或打包手机 App 的源码。

## 运行原则

1. APK 不包含工厂 IP 或公网域名。
2. 首次打开后扫描 System Owner 生成的 `SRS2|NETWORK_CONFIG|1|...` 二维码。
3. LAN 只接受 RFC1918 私有 IPv4 地址；PUBLIC 必须为 HTTPS。
4. 地址通过 `/api/miniapp/health` 的服务身份和 `v1` 版本校验后才保存。
5. 冷启动短超时检查 LAN，失败后才检查 PUBLIC；不会扫描或猜测局域网。
6. WebView 只允许已验证 origin 的 `/login`、`/qc/tablet` 和强制改密入口。
7. JavaScript Bridge 只有扫码、清会话、下载、分享四项最小能力。

WebView 使用网页已有的 `width=device-width, initial-scale=1.0`，关闭 overview zoom 和页面缩放，
保持默认 100% 显示。应用采用 `sensorLandscape`，软键盘出现时压缩可用内容区域，不遮住输入框。
工具栏“视口信息”会显示真机的 `window.innerWidth`、`window.innerHeight`、
`window.devicePixelRatio`；相同内容也会写到 Logcat 标签 `SampleRoomTabletViewport`。

## 构建

使用现有安全签名配置后，在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-tablet-android-for-factory.ps1
```

脚本会运行 Android 单元测试、构建默认开源 release APK、用现有本机 keystore 安全签名、验证签名和
applicationId/版本，并把 APK、`build-info.json`、`SHA256.txt` 写入：

`artifacts/factory/tablet/`

keystore、密码和本机 `local.properties` 都不得提交。

SDK 是电脑级依赖，不需要为每个 worktree 重装。脚本依次复用 Pad/手机 App 的
`local.properties`、环境变量、现有 Codex Android SDK 和标准用户 SDK 目录；如果都不存在，
脚本只会报告缺失，不会自动下载或安装。

## 精臣 / NIIMBOT B1 可选集成

默认开源构建不包含精臣厂商 SDK，但保留可复用的 B1 集成参考代码。请先从官方渠道取得 SDK，并按
[`vendor/jingchen/README.md`](vendor/jingchen/README.md) 放入本机被 Git 忽略的位置，再使用
`-PenableJingchenSdk=true` 构建 `jingchen` 变体。详细的 PC 与 Pad 使用说明见
[`docs/integrations/JINGCHEN_NIIMBOT_B1.md`](../../docs/integrations/JINGCHEN_NIIMBOT_B1.md)。
