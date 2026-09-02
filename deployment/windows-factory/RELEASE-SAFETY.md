# Windows 工厂正式发布安全流程

本文只说明部署实现和验收步骤，不定义业务规则。正式业务规则仍以
`docs/current/CURRENT_PROJECT_RULES.md` 为准。

## 发布候选包生成

1. 发布电脑必须处于已提交、无未保存修改的 Git 状态。
2. `Build-FactoryDeploymentPackage.ps1` 从当前提交构建应用运行镜像和迁移工具镜像，并打包精确的 PostgreSQL 镜像。
   Docker 构建必须显式收到 `VITE_AUTH_MODE=formal` 和
   `VITE_ENABLE_DEV_ENTRY=false`，否则立即失败。
3. Web 构建先删除旧 `apps/web/dist`，再生成新的正式产物和
   `release-config.json`。
4. 脚本检查镜像标签和 API 的 `NODE_ENV=production`，然后导出离线 TAR，
   记录源码提交、镜像 ID 和 TAR 的 SHA-256 校验值。
5. `Build-FactoryDeploymentPackage.ps1` 再次核对当前提交、工作区状态、镜像元数据和
   SHA-256，之后才生成 ZIP。旧 TAR、不同提交生成的 TAR 或开发模式镜像均不能打包。

## 首次部署脚本执行流程

工厂操作员双击 `开始安装.cmd` 后，流程如下：

1. `First-Deploy.cmd` 请求一次 Windows 管理员权限并调用
   `Factory-Deploy.ps1 -Action Install`。
2. 检查 Docker Desktop、Compose 和工厂局域网地址；分别选择系统数据目录、附件存档目录和备份目录。
3. 创建私有 `.env.factory.local`、系统数据目录、附件存档目录、备份目录、更新隔离目录和
   Lifecycle Runner（维护执行器）私有配置，并限制文件权限。
4. 无条件读取发布包中的离线镜像 TAR；不会因电脑上已存在同名旧镜像而跳过。
   TAR 校验、正式模式元数据或镜像标签任一不符，安装立即停止。
5. 启动 PostgreSQL，等待数据库健康；以一次性 Compose 任务执行 migration。
6. 仅在首次安装时交互创建 System Owner；再启动包含正式 Web 的 API 容器。
7. 只为工厂私有网络开放 Windows 防火墙 TCP 3001。
8. 验证 `/health` 仅报告 `ok` 和 `service`；正式模式缺失时由启动阶段直接拒绝运行；验证 `/`、
   `/login` 和 `release-config.json` 是正式 Web；验证未登录写请求及伪造
   `x-dev-role`/`x-dev-user-id` 均被 401/403 拒绝。
9. 安装并启动固定 Windows 账号下的单实例 Lifecycle Runner 计划任务，通过
   仅限本机回环地址的 3002 完成只读诊断。
10. 全部通过后才显示工厂局域网访问地址 `http://<工厂电脑IP>:3001`。

`Start.cmd` 用于以后手工恢复运行：检查正式镜像，启动 PostgreSQL，执行待应用的
migration，启动 API，然后重复 3001 正式发布验收。容器本身使用
`restart: unless-stopped`，Docker Desktop 随固定工厂账号登录启动后会自动恢复。

## 部署后的最终结构

```text
工厂 Windows 电脑
├─ 发布包目录
│  └─ deployment/windows-factory/
│     ├─ .env.factory.local          私有配置和随机凭据，不提交
│     ├─ compose.yml                 容器结构
│     ├─ offline/*.tar + *.json      已校验的正式离线镜像和元数据
│     └─ lifecycle/
│        └─ lifecycle-runner.local.json  Runner 私有配置，不提交
├─ C:\SampleRoomData                 系统数据目录（数据库与应用运行数据）
│  ├─ postgres/                      PostgreSQL 原始数据，仅由 PostgreSQL 使用
│  └─ application/                   orders、local-files、order-folders、cutting-inbox 等
├─ D:\SampleRoomAttachments          独立的正式附件存档目录
├─ D:\SampleRoomBackups              普通备份、恢复点和更新包根目录
│  ├─ manual-backups/
│  ├─ recovery-points/
│  └─ SystemUpdates/
│     ├─ quarantine/
│     ├─ verified/
│     └─ rejected/
├─ Docker Compose: sample-room-factory
│  ├─ postgres                       仅容器网络，无宿主机端口
│  │  └─ C:\SampleRoomData\postgres → /var/lib/postgresql/data
│  └─ api                            正式 Web + API
│     ├─ 0.0.0.0:3001 → 3001        厂内唯一 Web/API 入口
│     ├─ 127.0.0.1:3002 → 3002      仅本机 Runner 控制面
│     ├─ C:\SampleRoomData\application → /data
│     ├─ D:\SampleRoomAttachments → /data/storage
│     └─ FACTORY_UPDATE_ROOT → /updates
└─ Windows Task Scheduler
   └─ Lifecycle Runner               固定账号、单实例、固定动作白名单
```

附件存档与本地备份可以位于同一卷并保持为互不包含的平级目录；此配置不会阻止安装、
Backup、RecoveryPoint 或本地恢复。但这只能覆盖误删、错误更新和逻辑损坏，不能防御
整盘损坏、勒索病毒、设备丢失或物理灾害。不同盘符也不等同于不同物理硬盘。

5173 不属于上述正式结构。它只由本地开发命令启动，用于开发或手工验收；工厂发布包
和 Compose 都不发布 5173。PostgreSQL、SMB、RDP、SSH、WinRM、Docker 和 3002
不得通过 FRP 或等效公网隧道开放；未来公网入口只能映射经过权限检查的 3001 Web/API。
