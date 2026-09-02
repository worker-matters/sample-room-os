# Sample Room OS Android

这是现有 Web/API 系统的 Android 移动入口，不是第二套业务系统。

## 本地构建

复制 `local.properties.example` 为 `local.properties`，填写：

- `sdk.dir`：本机 Android SDK 目录。

Release APK 不包含工厂 IP 或公网域名。用户在登录页打开“网络设置”，扫描 System Owner
生成的 `SRS2|NETWORK_CONFIG|1|...` 配置二维码。局域网地址和公网地址分别保存在应用私有
持久化配置中；App 每次冷启动短超时探测 LAN health，失败才尝试公网，不扫描或猜测局域网 IP。

扫码后只接受经严格校验的 HTTP(S) API origin；PUBLIC 必须使用 HTTPS。保存前会检查
共享健康接口 `/api/miniapp/health` 的服务标识和 API 版本。普通网页二维码、裸 URL、带凭证或危险协议的地址都会被拒绝。

## 构建

```powershell
powershell -ExecutionPolicy Bypass -File ..\..\scripts\build-android-for-factory.ps1
```

脚本会先执行无构建缓存的 clean build，再校验 APK 确实包含运行时网络设置且不含固定工厂地址。
可分发 APK 输出到 `artifacts/factory`，文件名包含应用版本和 Git 修订号；同目录的
`android-build-info.json` 和 `.sha256.txt` 用于确认来源与文件完整性。不要分发
`app/build/outputs`、`.tmp` 或旧的 `sample-room-android-v1-*.apk`。

非 `DebugOnly` 构建还会把 release APK 永久归档到
`D:\sample-room-release-archive\v<versionName>-code<versionCode>\<build-time>\`。每次构建
创建新的时间目录，不覆盖或清理历史归档；目录内同时生成 `SHA256.txt` 和
`build-info.txt`。

首次正式签名前，在仓库根目录运行以下命令，并根据安全提示输入 keystore/key 密码：

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\Set-Android-ReleaseSigningConfig.ps1 `
  -KeystorePath "D:\你的安全目录\sample-room-release.jks" `
  -Alias "你的签名别名"
```

配置默认保存在仓库外的
`%LOCALAPPDATA%\SampleRoom\android-release-signing.json`。密码由当前 Windows 用户的
DPAPI 加密，脚本和配置文件都不保存明文密码。之后正常运行打包脚本；检测到有效配置时，
脚本会使用 Android SDK 的 `zipalign` 和 `apksigner` 生成并验证 signed APK。归档目录
同时保留 unsigned 与 signed APK，`SHA256.txt` 分别记录两者哈希。没有签名配置时只归档
unsigned APK，并明确警告该文件不能作为正式安装包分发。

## V1 范围

- Business Account 用户名/密码、Worker Account 手机号/密码登录。
- AccountSession 保存、启动恢复和退出。
- 接单员首页、订单列表、只读详情、面辅料记录拍照/相册/文件上传。
- 计划员订单列表和只读详情。
- 客户订单列表和只读详情。
- Worker 订单二维码扫码入口。
- 老板、System Owner、版师仅显示“移动端尚未开放”占位页。

所有权限和业务状态仍由 API 决定。Android 不修改订单二维码、状态机、生产路线或数据库。
