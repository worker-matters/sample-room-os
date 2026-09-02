# Sample Room OS 微信小程序

这是微信原生小程序 + TypeScript 工程。小程序复用现有 Account、Express API、
权限服务、订单状态机、附件与费用服务，不维护第二套业务逻辑。

## 导入与正式公网地址

微信开发者工具打开当前仓库中的 `apps/wechat-miniprogram`。

复制 `miniprogram/config/environment.local.example.ts` 为同目录下不提交 Git 的
`environment.local.ts`。正式上传前设置：

```ts
export const localEnvironment = {
  publicApiBase: "https://已获批且已加入微信合法域名的-api-域名",
  lanApiBase: "",
  buildMode: "production",
  enableDevIdentityPreview: false,
  enableDevFakeIdentityLogin: false
} as const;
```

正式版只探测和使用 `publicApiBase`，并要求它是无账号、密码、路径、查询参数或片段的
HTTPS API origin。未配置、使用 HTTP 或服务健康检查不匹配时，登录会明确失败。

小程序没有 Android 的“网络设置”按钮，也不扫描 `NETWORK_CONFIG` 二维码。公网地址由
发布人员在上传小程序前写入忽略提交的本地配置。真实域名不得提交到仓库。地址变化时需
更新该本地配置并重新上传小程序版本，同时在微信公众平台同步检查 `request`、
`uploadFile` 和 `downloadFile` 合法域名。

开发联调时可改为 `buildMode: "development"` 并填写 `lanApiBase`；开发模式会先探测
局域网，再尝试公网。微信开发者工具中的“不校验合法域名”只用于本地联调，不能作为
正式版验收依据。

## 界面与角色入口

- 登录页沿用 Android 的灰底、白卡片、业务账号/工序员工切换和统一账号登录结构，
  但不显示网络设置。
- 接单员首页提供订单、现场录入、扫描费用三个功能卡片。
- 计划员首页提供订单、生产计划、扫描费用三个功能卡片。
- 工序员工首页保持扫描订单与个人绩效入口。
- 客户、接单员和计划员的订单、详情、录入、附件及费用页面统一使用 Android 的
  深蓝顶栏、灰色页面背景、白色圆角卡片和青绿色主操作色。

页面只渲染服务端返回的身份、权限和业务数据；客户端不提交可信 Account ID、角色、
WorkerProfile ID 或首页路由。

## 登录与二维码边界

- Business Account 使用与 Web 相同的 `username + password`。
- Worker Account 使用注册时的 `phoneNumber + password`。
- 登录通过 `POST /api/miniapp/auth/login` 创建 `AccountSession(clientType=miniapp)`。
- 小程序业务扫描只接受现有 `SRS2|ORDER|<opaque-token>` 订单码。
- 客户侧页面没有订单扫码入口；小程序不消费身份绑定二维码或 Android 网络配置二维码。

## 验证

```powershell
npm run typecheck -w @sample-room/wechat-miniprogram
npm run test -w @sample-room/wechat-miniprogram
```
